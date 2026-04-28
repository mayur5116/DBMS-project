/**
 * ══════════════════════════════════════════════════════════════
 *  NEXABANK — server.js
 *  Node.js / Express Backend
 *
 *  SETUP (run these in terminal first):
 *    npm install
 *    node server.js
 *
 *  Server listens at: http://localhost:3000
 * ══════════════════════════════════════════════════════════════
 */

"use strict";

const express = require("express");
const cors    = require("cors");
const bcrypt  = require("bcrypt");
const jwt     = require("jsonwebtoken");
const mysql   = require("mysql2/promise");

// ─────────────────────────────────────────────────────────────
//  CONFIG — edit before running
// ─────────────────────────────────────────────────────────────
const CONFIG = {
  port: 3000,

  db: {
    host:               "localhost",
    port:               3306,
    user:               "root",
    password:           "mayur@2006", // <── your MySQL Workbench password
    database:           "nexabank",
    waitForConnections: true,
    connectionLimit:    10,
    queueLimit:         0,
  },

  // Change this to a long random string in production!
  jwtSecret:   "nexabank_dev_secret_change_in_prod",
  jwtExpires:  "8h",

  bcryptRounds: 10,
};

// ─────────────────────────────────────────────────────────────
//  DATABASE POOL
// ─────────────────────────────────────────────────────────────
const pool = mysql.createPool(CONFIG.db);

async function testDbConnection() {
  try {
    const conn = await pool.getConnection();
    console.log("✅  MySQL connected.");
    conn.release();
  } catch (err) {
    console.error("❌  MySQL connection failed:", err.message);
    console.error("    → Check CONFIG.db.password in server.js");
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────
//  UTILITY HELPERS
// ─────────────────────────────────────────────────────────────

function generateAccountNumber() {
  return "ACC-" + Math.floor(100000 + Math.random() * 900000);
}

function generateRef(prefix) {
  return prefix + "-" + Math.floor(10000 + Math.random() * 90000);
}

function generateTxnId(type) {
  // e.g. TXN-C-1718234567-a3f
  const tag   = type === "credit" ? "C" : type === "debit" ? "D" : "T";
  const rand  = Math.random().toString(36).slice(2, 5).toUpperCase();
  return "TXN-" + tag + "-" + Date.now() + "-" + rand;
}

// ─────────────────────────────────────────────────────────────
//  JWT MIDDLEWARE
//  Reads "Authorization: Bearer <token>" header,
//  verifies it, and attaches decoded payload to req.user
// ─────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token      = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "No token provided. Please log in." });
  }

  try {
    req.user = jwt.verify(token, CONFIG.jwtSecret);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token. Please log in again." });
  }
}

// ─────────────────────────────────────────────────────────────
//  EXPRESS APP
// ─────────────────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin: "*",             // tighten this in production
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());

// Health check
app.get("/", (_req, res) => res.json({ service: "NexaBank API", status: "ok" }));

// ══════════════════════════════════════════════════════════════
//  ROUTE 1: POST /api/auth/register
//  Creates a new user + account with 0 balance.
//
//  Accepts:  { firstName, lastName, email, password }
//  Returns:  201 { message, accountNumber }
// ══════════════════════════════════════════════════════════════
app.post("/api/auth/register", async (req, res) => {
  const { firstName, lastName, email, password } = req.body;

  // ── Validate input ──────────────────────────────────────────
  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ message: "All fields are required." });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters." });
  }
  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRx.test(email)) {
    return res.status(400).json({ message: "Invalid email address." });
  }

  const conn = await pool.getConnection();
  try {
    // ── Check for duplicate email ───────────────────────────────
    const [existing] = await conn.query(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [email.toLowerCase()]
    );
    if (existing.length > 0) {
      return res.status(409).json({ message: "An account with that email already exists." });
    }

    // ── Hash password ───────────────────────────────────────────
    const password_hash = await bcrypt.hash(password, CONFIG.bcryptRounds);

    // ── Insert user ─────────────────────────────────────────────
    const [userResult] = await conn.query(
      "INSERT INTO users (firstName, lastName, email, password_hash) VALUES (?, ?, ?, ?)",
      [firstName.trim(), lastName.trim(), email.toLowerCase(), password_hash]
    );
    const userId = userResult.insertId;

    // ── Generate unique account number ──────────────────────────
    let accountNumber;
    let isUnique = false;
    while (!isUnique) {
      accountNumber = generateAccountNumber();
      const [check] = await conn.query(
        "SELECT accountNumber FROM accounts WHERE accountNumber = ? LIMIT 1",
        [accountNumber]
      );
      isUnique = check.length === 0;
    }

    // ── Create account with 0 balance ───────────────────────────
    await conn.query(
      "INSERT INTO accounts (accountNumber, user_id, balance) VALUES (?, ?, 0.00)",
      [accountNumber, userId]
    );

    return res.status(201).json({
      message:       `Account created successfully! Welcome to NexaBank, ${firstName}.`,
      accountNumber,
    });

  } catch (err) {
    console.error("[POST /api/auth/register]", err);
    return res.status(500).json({ message: "Server error. Please try again." });
  } finally {
    conn.release();
  }
});

// ══════════════════════════════════════════════════════════════
//  ROUTE 2: POST /api/auth/login
//  Verifies credentials, issues JWT.
//
//  Accepts:  { email, password }
//  Returns:  200 { token, user: { id, name, email, accountNumber, balance } }
// ══════════════════════════════════════════════════════════════
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  try {
    // ── Fetch user + account in one join ────────────────────────
    const [rows] = await pool.query(
      `SELECT
         u.id,
         u.firstName,
         u.lastName,
         u.email,
         u.password_hash,
         a.accountNumber,
         a.balance
       FROM users u
       INNER JOIN accounts a ON a.user_id = u.id
       WHERE u.email = ?
       LIMIT 1`,
      [email.toLowerCase()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: "No account found with that email address." });
    }

    const user = rows[0];

    // ── Compare password ────────────────────────────────────────
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ message: "Incorrect password. Please try again." });
    }

    // ── Sign JWT ────────────────────────────────────────────────
    // Embed userId + accountNumber in the token so protected
    // routes can query without extra DB lookups.
    const token = jwt.sign(
      {
        userId:        user.id,
        accountNumber: user.accountNumber,
        email:         user.email,
      },
      CONFIG.jwtSecret,
      { expiresIn: CONFIG.jwtExpires }
    );

    return res.status(200).json({
      token,
      user: {
        id:            user.id,
        name:          `${user.firstName} ${user.lastName}`,
        email:         user.email,
        accountNumber: user.accountNumber,
        balance:       parseFloat(user.balance),
      },
    });

  } catch (err) {
    console.error("[POST /api/auth/login]", err);
    return res.status(500).json({ message: "Server error. Please try again." });
  }
});

// ══════════════════════════════════════════════════════════════
//  ROUTE 3: GET /api/account/balance
//  Returns the current balance for the authenticated user.
//  (Used by frontend fetchBalance() if called separately)
//
//  Header:  Authorization: Bearer <token>
//  Returns: 200 { balance }
// ══════════════════════════════════════════════════════════════
app.get("/api/account/balance", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT balance FROM accounts WHERE accountNumber = ? LIMIT 1",
      [req.user.accountNumber]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Account not found." });
    }

    return res.status(200).json({ balance: parseFloat(rows[0].balance) });
  } catch (err) {
    console.error("[GET /api/account/balance]", err);
    return res.status(500).json({ message: "Server error." });
  }
});

// ══════════════════════════════════════════════════════════════
//  ROUTE 4: GET /api/transactions
//  Fetch all transactions for the authenticated user, newest first.
//
//  Header:  Authorization: Bearer <token>
//  Returns: 200 { transactions: [...] }
//
//  Each transaction object matches frontend expectations exactly:
//  { id, date, description, type, amount, balance, ref }
// ══════════════════════════════════════════════════════════════
app.get("/api/transactions", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         id,
         date,
         description,
         type,
         amount,
         balance_after AS \`balance\`,
         ref
       FROM transactions
       WHERE accountNumber = ?
       ORDER BY date DESC`,
      [req.user.accountNumber]
    );

    // Ensure numeric types for JS consumption
    const transactions = rows.map(t => ({
      ...t,
      amount:  parseFloat(t.amount),
      balance: parseFloat(t.balance),
    }));

    return res.status(200).json({ transactions });

  } catch (err) {
    console.error("[GET /api/transactions]", err);
    return res.status(500).json({ message: "Server error." });
  }
});

// ══════════════════════════════════════════════════════════════
//  ROUTE 5: POST /api/transfer
//  Transfers money between two accounts atomically.
//
//  Header:  Authorization: Bearer <token>
//  Accepts: { recipientAccount, amount, note }
//  Returns: 200 { message, newBalance }
//
//  Uses a MySQL transaction with ROLLBACK on any failure.
//  Creates TWO transaction records:
//    - A 'transfer' debit  on the sender's account
//    - A 'credit'          on the recipient's account
// ══════════════════════════════════════════════════════════════
app.post("/api/transfer", requireAuth, async (req, res) => {
  const { recipientAccount, amount, note } = req.body;
  const senderAccount = req.user.accountNumber;

  // ── Validate payload ────────────────────────────────────────
  if (!recipientAccount || !amount) {
    return res.status(400).json({ message: "recipientAccount and amount are required." });
  }

  const transferAmount = parseFloat(amount);
  if (isNaN(transferAmount) || transferAmount <= 0) {
    return res.status(400).json({ message: "Amount must be a positive number." });
  }
  if (senderAccount === recipientAccount) {
    return res.status(400).json({ message: "Cannot transfer to your own account." });
  }

  const conn = await pool.getConnection();
  try {
    // ── BEGIN transaction ───────────────────────────────────────
    await conn.beginTransaction();

    // ── Lock sender's row for update ────────────────────────────
    const [senderRows] = await conn.query(
      "SELECT balance FROM accounts WHERE accountNumber = ? FOR UPDATE",
      [senderAccount]
    );
    if (senderRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: "Sender account not found." });
    }
    const senderBalance = parseFloat(senderRows[0].balance);

    // ── Sufficient funds check ──────────────────────────────────
    if (senderBalance < transferAmount) {
      await conn.rollback();
      return res.status(400).json({
        message: `Insufficient balance. Available: ₹${senderBalance.toFixed(2)}`,
      });
    }

    // ── Lock recipient's row for update ─────────────────────────
    const [recipientRows] = await conn.query(
      "SELECT balance, accountNumber FROM accounts WHERE accountNumber = ? FOR UPDATE",
      [recipientAccount]
    );
    if (recipientRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: `Recipient account '${recipientAccount}' not found.` });
    }
    const recipientBalance = parseFloat(recipientRows[0].balance);

    // ── Calculate new balances ──────────────────────────────────
    const newSenderBalance    = senderBalance    - transferAmount;
    const newRecipientBalance = recipientBalance + transferAmount;

    // ── Deduct from sender ──────────────────────────────────────
    await conn.query(
      "UPDATE accounts SET balance = ? WHERE accountNumber = ?",
      [newSenderBalance, senderAccount]
    );

    // ── Add to recipient ────────────────────────────────────────
    await conn.query(
      "UPDATE accounts SET balance = ? WHERE accountNumber = ?",
      [newRecipientBalance, recipientAccount]
    );

    // ── Shared ref ID (links both legs of the transfer) ─────────
    const sharedRef = generateRef("TRF");
    const txnDate   = new Date();
    const noteStr   = note ? ` — ${note}` : "";

    // ── Transaction record: sender (debit/transfer leg) ─────────
    await conn.query(
      `INSERT INTO transactions
         (id, accountNumber, date, description, type, amount, balance_after, ref)
       VALUES (?, ?, ?, ?, 'transfer', ?, ?, ?)`,
      [
        generateTxnId("transfer"),
        senderAccount,
        txnDate,
        `Transfer to ${recipientAccount}${noteStr}`,
        -transferAmount,          // negative = money leaving
        newSenderBalance,
        sharedRef,
      ]
    );

    // ── Transaction record: recipient (credit leg) ───────────────
    await conn.query(
      `INSERT INTO transactions
         (id, accountNumber, date, description, type, amount, balance_after, ref)
       VALUES (?, ?, ?, ?, 'credit', ?, ?, ?)`,
      [
        generateTxnId("credit"),
        recipientAccount,
        txnDate,
        `Transfer from ${senderAccount}${noteStr}`,
        transferAmount,           // positive = money arriving
        newRecipientBalance,
        sharedRef,
      ]
    );

    // ── COMMIT ──────────────────────────────────────────────────
    await conn.commit();

    return res.status(200).json({
      message:    `Transfer of ₹${transferAmount.toFixed(2)} to ${recipientAccount} was successful.`,
      newBalance: newSenderBalance,
    });

  } catch (err) {
    // ── ROLLBACK on any error ───────────────────────────────────
    await conn.rollback();
    console.error("[POST /api/transfer]", err);
    return res.status(500).json({ message: "Transfer failed due to a server error. No money was moved." });
  } finally {
    conn.release();
  }
});

// ── Optional logout endpoint (stateless JWT — just an ACK) ────
app.post("/api/auth/logout", requireAuth, (_req, res) => {
  // With JWTs there is no server-side session to destroy.
  // If you later add a token blacklist / Redis store, do it here.
  return res.status(200).json({ message: "Logged out successfully." });
});

// ── 404 fallback ───────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ message: "Route not found." }));

// ─────────────────────────────────────────────────────────────
//  START SERVER
// ─────────────────────────────────────────────────────────────
(async () => {
  await testDbConnection();
  app.listen(CONFIG.port, () => {
    console.log(`🚀  NexaBank API running → http://localhost:${CONFIG.port}`);
    console.log(`    Endpoints:`);
    console.log(`      POST /api/auth/register`);
    console.log(`      POST /api/auth/login`);
    console.log(`      GET  /api/account/balance   [JWT]`);
    console.log(`      GET  /api/transactions       [JWT]`);
    console.log(`      POST /api/transfer           [JWT]`);
  });
})();