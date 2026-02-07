"use strict";

require("dotenv").config();
const path = require("path");
const express = require("express");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");

const app = express();
const PORT = process.env.PORT || 5000;

/* =========================
   Middleware
========================= */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret",
    resave: false,
    saveUninitialized: false
  })
);

/* =========================
   Static
========================= */
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

/* =========================
   DB
========================= */
const DB_PATH = path.join(__dirname, "legendario.sqlite");
const db = new sqlite3.Database(DB_PATH, () => {
  console.log("SQLite conectado");
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_premium INTEGER DEFAULT 0
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
   Test
========================= */
app.get("/api/test", (req, res) => {
  res.json({ ok: true });
});

/* =========================
   Start
========================= */
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});