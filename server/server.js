"use strict";

/* =========================
   ENV
========================= */
const path = require("path");
require("dotenv").config(); // En Render no usa .env, pero en local sí

/* =========================
   Imports
========================= */
const express = require("express");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");

// node-fetch (Node)
const r = await fetch(url, options);

/* =========================
   App
========================= */
const app = express();
const PORT = process.env.PORT || 5000;

/* =========================
   PayPal config
========================= */
const PAYPAL_ENV = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const PAYPAL_SECRET = process.env.PAYPAL_CLIENT_SECRET || "";

const PREMIUM_PRICE = Number(process.env.PREMIUM_PRICE || "4.99");
const PREMIUM_CURRENCY = (process.env.PREMIUM_CURRENCY || "USD").toUpperCase();

const PAYPAL_API_BASE =
  PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

/* =========================
   Paths
========================= */
const DB_PATH = path.join(__dirname, "legendario.sqlite");
const publicPath = path.join(__dirname, "public");

/* =========================
   Middleware
========================= */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

/* =========================
   Static files
========================= */
app.use(express.static(publicPath));

/* =========================
   DB (SQLite)
========================= */
const db = new sqlite3.Database(DB_PATH, () => {
  console.log("✅ SQLite conectado");
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_premium INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
});

/* =========================
   Helpers
========================= */
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "NO_LOGIN" });
  }
  next();
}

/* =========================
   AUTH
========================= */
app.post("/api/auth/register", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "").trim();

  if (!email || !password) {
    return res.status(400).json({ error: "MISSING_FIELDS" });
  }

  const hash = await bcrypt.hash(password, 10);

  db.run(
    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
    [email, hash],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE")) {
          return res.status(409).json({ error: "USER_EXISTS" });
        }
        return res.status(500).json({ error: "DB_ERROR" });
      }

      req.session.user = {
        id: this.lastID,
        username: email,
        isPremium: false
      };

      res.json({ ok: true, user: req.session.user });
    }
  );
});

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "").trim();

  db.get(
    "SELECT * FROM users WHERE username = ?",
    [email],
    async (err, row) => {
      if (!row) return res.status(401).json({ error: "BAD_CREDENTIALS" });

      const ok = await bcrypt.compare(password, row.password_hash);
      if (!ok) return res.status(401).json({ error: "BAD_CREDENTIALS" });

      req.session.user = {
        id: row.id,
        username: row.username,
        isPremium: !!row.is_premium
      };

      res.json({ ok: true, user: req.session.user });
    }
  );
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/auth/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

/* =========================
   CONFIG FRONTEND
========================= */
app.get("/api/config", (req, res) => {
  res.json({
    paypalEnv: PAYPAL_ENV,
    paypalClientId: PAYPAL_CLIENT_ID,
    premiumPrice: PREMIUM_PRICE,
    premiumCurrency: PREMIUM_CURRENCY
  });
});

/* =========================
   PAYPAL HELPERS
========================= */
async function paypalGetAccessToken() {
  const auth = Buffer.from(
    `${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`
  ).toString("base64");

  const r = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data.access_token;
}

async function paypalCreateOrder() {
  const token = await paypalGetAccessToken();

  const r = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          description: "Ecuador Legendario Premium",
          amount: {
            currency_code: PREMIUM_CURRENCY,
            value: PREMIUM_PRICE.toFixed(2)
          }
        }
      ]
    })
  });

  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function paypalCaptureOrder(orderId) {
  const token = await paypalGetAccessToken();

  const r = await fetch(
    `${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    }
  );

  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data;
}

/* =========================
   PAYPAL API
========================= */
app.post("/api/paypal/create-order", requireLogin, async (req, res) => {
  try {
    const order = await paypalCreateOrder();
    res.json({ id: order.id });
  } catch (e) {
    console.error("PAYPAL CREATE ERROR:", e.message);
    res.status(500).json({ error: "PAYPAL_CREATE_FAILED" });
  }
});

app.post("/api/paypal/capture-order", requireLogin, async (req, res) => {
  const orderID = req.body.orderID;
  if (!orderID) return res.status(400).json({ error: "NO_ORDER_ID" });

  try {
    const capture = await paypalCaptureOrder(orderID);

    if (capture.status === "COMPLETED") {
      db.run("UPDATE users SET is_premium = 1 WHERE id = ?", [
        req.session.user.id
      ]);

      req.session.user.isPremium = true;
      return res.json({ ok: true });
    }

    res.status(400).json({ error: "NOT_COMPLETED" });
  } catch (e) {
    console.error("PAYPAL CAPTURE ERROR:", e.message);
    res.status(500).json({ error: "PAYPAL_CAPTURE_FAILED" });
  }
});

/* =========================
   Start
========================= */
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
