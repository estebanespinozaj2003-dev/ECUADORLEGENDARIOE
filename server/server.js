"use strict";

require("dotenv").config();
const path = require("path");
const express = require("express");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const paypal = require("@paypal/checkout-server-sdk");

const app = express();
const PORT = process.env.PORT || 5000;

/* =========================
   PAYPAL
========================= */
const PAYPAL_CLIENT_ID = "AeX5UOoG51RdnTEvBgt3vrhkCwlr9Fm-n7x6vxijICMlIOvUfGdeBfFLBAnO-Y1FMqz8JU-5rAOME6Yn";
const PAYPAL_SECRET = "EFQs7_w_WOgKwTEPMp2jC3yQQe3He8XyBOwpvxSC3Y6a1d5AmGg61PO0ls2YNxLZZeBT9ZCLTKYVJR4m";
const PAYPAL_ENV = "sandbox"; // sandbox o live

function paypalClient() {
  const environment =
    PAYPAL_ENV === "live"
      ? new paypal.core.LiveEnvironment(
          PAYPAL_CLIENT_ID,
          PAYPAL_SECRET
        )
      : new paypal.core.SandboxEnvironment(
          PAYPAL_CLIENT_ID,
          PAYPAL_SECRET
        );

  return new paypal.core.PayPalHttpClient(environment);
}

/* =========================
   MIDDLEWARE
========================= */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "ecuador-legendario-session",
    secret: "ESCRIBE_AQUI",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true
    }
  })
);

/* =========================
   STATIC
========================= */
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   DATABASE
========================= */
const db = new sqlite3.Database(
  path.join(__dirname, "legendario.sqlite"),
  () => console.log("SQLite conectado")
);

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_premium INTEGER DEFAULT 0
  )
`);

/* =========================
   HELPERS
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
   PAYPAL CREATE ORDER
========================= */
app.post("/api/paypal/create-order", requireLogin, async (req, res) => {
  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer("return=representation");

  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: {
          currency_code: "USD",
          value: "4.99"
        }
      }
    ]
  });

  try {
    const order = await paypalClient().execute(request);
    res.json({ id: order.result.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "PAYPAL_CREATE_ERROR" });
  }
});

/* =========================
   PAYPAL CAPTURE ORDER
========================= */
app.post("/api/paypal/capture-order", requireLogin, async (req, res) => {
  const { orderID } = req.body;

  const request = new paypal.orders.OrdersCaptureRequest(orderID);
  request.requestBody({});

  try {
    await paypalClient().execute(request);

    db.run(
      "UPDATE users SET is_premium = 1 WHERE id = ?",
      [req.session.user.id],
      () => {
        req.session.user.isPremium = true;
        res.json({ ok: true });
      }
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "PAYPAL_CAPTURE_ERROR" });
  }
});

/* =========================
   START
========================= */
app.listen(PORT, () => {
  console.log("Servidor activo en puerto", PORT);
});