/**
 * ══════════════════════════════════════════════════
 *  NEXABANK — app.js
 *  Vanilla ES6+ SPA logic
 *
 *  HOW TO CONNECT YOUR BACKEND:
 *  1. Set BASE_URL to your server (e.g. "http://localhost:3000")
 *  2. Uncomment the `fetch(...)` calls inside each function
 *  3. Remove or comment out the mock-data blocks labelled [MOCK]
 * ══════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────
//  CONFIG — change this when your backend is ready
// ─────────────────────────────────────────────────
const BASE_URL = "http://localhost:3000"; // <-- YOUR BACKEND URL HERE

// ─────────────────────────────────────────────────
//  APP STATE (in-memory session store)
// ─────────────────────────────────────────────────
const state = {
  currentUser: null,   // { id, name, email, accountNumber, balance }
  transactions: [],    // array of transaction objects
  authToken: null,     // JWT or session token from your backend
};

// ─────────────────────────────────────────────────
//  MOCK DATA (remove once backend is connected)
// ─────────────────────────────────────────────────
const MOCK_USER = {
  id: 1,
  name: "Jane Doe",
  email: "jane.doe@example.com",
  accountNumber: "ACC-748291",
  balance: 284750.00,
};

const MOCK_TRANSACTIONS = [
  { id: "TXN001", date: "2025-06-15T09:22:00", description: "Salary Credit — June 2025", type: "credit",   amount: 80000.00,  balance: 284750.00, ref: "NEFT-09182" },
  { id: "TXN002", date: "2025-06-14T14:05:00", description: "Transfer to ACC-193847",    type: "transfer", amount: -15000.00, balance: 204750.00, ref: "TRF-77291"  },
  { id: "TXN003", date: "2025-06-13T11:00:00", description: "Amazon India Purchase",      type: "debit",    amount: -3249.00,  balance: 219750.00, ref: "UPI-00392"  },
  { id: "TXN004", date: "2025-06-12T18:30:00", description: "Freelance Payment Received", type: "credit",   amount: 22000.00,  balance: 222999.00, ref: "IMPS-84421" },
  { id: "TXN005", date: "2025-06-11T08:15:00", description: "Electricity Bill — MSEB",    type: "debit",    amount: -1820.00,  balance: 200999.00, ref: "BBPS-11039" },
  { id: "TXN006", date: "2025-06-10T20:00:00", description: "ATM Withdrawal",             type: "debit",    amount: -5000.00,  balance: 202819.00, ref: "ATM-29301"  },
  { id: "TXN007", date: "2025-06-09T12:45:00", description: "Zomato Gold Subscription",   type: "debit",    amount: -299.00,   balance: 207819.00, ref: "UPI-77821"  },
  { id: "TXN008", date: "2025-06-08T10:10:00", description: "Transfer from ACC-302910",   type: "credit",   amount: 10000.00,  balance: 208118.00, ref: "TRF-99102"  },
];

// ─────────────────────────────────────────────────
//  UTILITY HELPERS
// ─────────────────────────────────────────────────

/** Format a number as Indian Rupees */
function formatINR(amount) {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `₹${formatted}`;
}

/** Format ISO date string to readable form */
function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  }) + " · " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

/** Generate a short ref ID for mock transfers */
function genRef() {
  return "TRF-" + Math.floor(10000 + Math.random() * 90000);
}

/** Show or hide loading state on a button */
function setLoading(btnEl, isLoading) {
  const text   = btnEl.querySelector(".btn-text");
  const loader = btnEl.querySelector(".btn-loader");
  btnEl.disabled = isLoading;
  if (text)   text.classList.toggle("hidden", isLoading);
  if (loader) loader.classList.toggle("hidden", !isLoading);
}

/** Show an alert message inside a container */
function showAlert(elId, message, type = "error") {
  const el = document.getElementById(elId);
  el.textContent = message;
  el.className = `alert alert-${type}`;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 5000);
}

/** Get initials from full name */
function getInitials(name) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

// ─────────────────────────────────────────────────
//  SECTION / PAGE NAVIGATION
// ─────────────────────────────────────────────────

/** Switch between auth and app section */
function showSection(id) {
  document.querySelectorAll(".page").forEach(el => el.classList.remove("active"));
  document.getElementById("section-" + id).classList.add("active");
}

/** Switch between login and register forms */
function showForm(name) {
  document.querySelectorAll(".auth-card").forEach(el => el.classList.remove("active"));
  document.getElementById("form-" + name).classList.add("active");
}

/** Navigate between dashboard / transfer / history pages */
function navigate(page) {
  document.querySelectorAll(".app-page").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
  document.getElementById("page-" + page).classList.add("active");
  document.querySelector(`.nav-item[data-page="${page}"]`).classList.add("active");

  // Lazy-load data on page visit
  if (page === "dashboard") renderDashboard();
  if (page === "history")   renderHistoryTable(state.transactions);
}

// ─────────────────────────────────────────────────
//  AUTH — LOGIN
// ─────────────────────────────────────────────────

/**
 * loginUser()
 * Authenticates a user with email and password.
 *
 * BACKEND: POST /api/auth/login
 * Payload : { email, password }
 * Response: { token, user: { id, name, email, accountNumber, balance } }
 */
async function loginUser() {
  const email    = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const btn      = document.querySelector("#form-login .btn-primary");

  if (!email || !password) {
    showAlert("login-error", "Please fill in all fields.");
    return;
  }

  setLoading(btn, true);

  try {
    /* ── UNCOMMENT BELOW when backend is ready ──────────────────────────────
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Login failed.");
    state.authToken    = data.token;
    state.currentUser  = data.user;
    state.transactions = await fetchTransactions();
    ────────────────────────────────────────────────────────────────────── */

    // [MOCK] Simulate API delay + check email matches mock user
    await new Promise(r => setTimeout(r, 900));
    if (email !== MOCK_USER.email) throw new Error("No account found with that email.");
    if (password.length < 4)       throw new Error("Incorrect password.");

    state.currentUser  = { ...MOCK_USER };
    state.transactions = [...MOCK_TRANSACTIONS];

    onLoginSuccess();
  } catch (err) {
    showAlert("login-error", err.message);
  } finally {
    setLoading(btn, false);
  }
}

// ─────────────────────────────────────────────────
//  AUTH — REGISTER
// ─────────────────────────────────────────────────

/**
 * registerUser()
 * Creates a new user account.
 *
 * BACKEND: POST /api/auth/register
 * Payload : { firstName, lastName, email, password }
 * Response: { message, accountNumber }
 */
async function registerUser() {
  const firstName = document.getElementById("reg-first").value.trim();
  const lastName  = document.getElementById("reg-last").value.trim();
  const email     = document.getElementById("reg-email").value.trim();
  const password  = document.getElementById("reg-password").value;
  const confirm   = document.getElementById("reg-confirm").value;
  const btn       = document.querySelector("#form-register .btn-primary");

  if (!firstName || !lastName || !email || !password || !confirm) {
    showAlert("register-error", "All fields are required."); return;
  }
  if (password.length < 8) {
    showAlert("register-error", "Password must be at least 8 characters."); return;
  }
  if (password !== confirm) {
    showAlert("register-error", "Passwords do not match."); return;
  }

  setLoading(btn, true);

  try {
    /* ── UNCOMMENT BELOW when backend is ready ──────────────────────────────
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName, lastName, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Registration failed.");
    showAlert("register-success", `Account created! Your Account No: ${data.accountNumber}. Please sign in.`, "success");
    ────────────────────────────────────────────────────────────────────── */

    // [MOCK] Simulate registration
    await new Promise(r => setTimeout(r, 1000));
    const mockAcct = "ACC-" + Math.floor(100000 + Math.random() * 900000);
    showAlert("register-success", `Account created! Your Account No: ${mockAcct}. Use jane.doe@example.com to demo login.`, "success");

    setTimeout(() => showForm("login"), 3000);
  } catch (err) {
    showAlert("register-error", err.message);
  } finally {
    setLoading(btn, false);
  }
}

// ─────────────────────────────────────────────────
//  AUTH — LOGOUT
// ─────────────────────────────────────────────────

/**
 * logoutUser()
 * Clears session state and returns to login screen.
 *
 * BACKEND (optional): POST /api/auth/logout  { token }
 */
function logoutUser() {
  /* ── OPTIONAL: call logout endpoint ────────────────────────────────────
  fetch(`${BASE_URL}/api/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.authToken}` }
  });
  ────────────────────────────────────────────────────────────────────── */

  state.currentUser  = null;
  state.transactions = [];
  state.authToken    = null;

  // Clear form inputs
  ["login-email","login-password","reg-first","reg-last","reg-email","reg-password","reg-confirm"]
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });

  showSection("auth");
  showForm("login");
}

// ─────────────────────────────────────────────────
//  BALANCE FETCH (standalone, if needed)
// ─────────────────────────────────────────────────

/**
 * fetchBalance()
 * Fetches the latest account balance from backend.
 *
 * BACKEND: GET /api/account/balance
 * Headers: Authorization: Bearer <token>
 * Response: { balance: number }
 */
async function fetchBalance() {
  /* ── UNCOMMENT BELOW when backend is ready ──────────────────────────────
  const res = await fetch(`${BASE_URL}/api/account/balance`, {
    headers: { Authorization: `Bearer ${state.authToken}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message);
  state.currentUser.balance = data.balance;
  ────────────────────────────────────────────────────────────────────── */

  // [MOCK] Already set in state — nothing to do
  return state.currentUser.balance;
}

// ─────────────────────────────────────────────────
//  TRANSACTIONS — FETCH
// ─────────────────────────────────────────────────

/**
 * fetchTransactions()
 * Retrieves transaction history from backend.
 *
 * BACKEND: GET /api/transactions
 * Headers: Authorization: Bearer <token>
 * Response: { transactions: [...] }
 */
async function fetchTransactions() {
  /* ── UNCOMMENT BELOW when backend is ready ──────────────────────────────
  const res = await fetch(`${BASE_URL}/api/transactions`, {
    headers: { Authorization: `Bearer ${state.authToken}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message);
  return data.transactions;
  ────────────────────────────────────────────────────────────────────── */

  return [...MOCK_TRANSACTIONS]; // [MOCK]
}

// ─────────────────────────────────────────────────
//  MONEY TRANSFER
// ─────────────────────────────────────────────────

/**
 * previewTransfer()
 * Validates inputs and shows a summary confirmation panel.
 */
function previewTransfer() {
  const recipient = document.getElementById("tx-recipient").value.trim();
  const amount    = parseFloat(document.getElementById("tx-amount").value);
  const note      = document.getElementById("tx-note").value.trim() || "—";

  document.getElementById("transfer-error").classList.add("hidden");

  if (!recipient) {
    showAlert("transfer-error", "Please enter a recipient account number."); return;
  }
  if (isNaN(amount) || amount <= 0) {
    showAlert("transfer-error", "Please enter a valid amount."); return;
  }
  if (recipient === state.currentUser.accountNumber) {
    showAlert("transfer-error", "You cannot transfer to your own account."); return;
  }
  if (amount > state.currentUser.balance) {
    showAlert("transfer-error", `Insufficient balance. Available: ${formatINR(state.currentUser.balance)}`); return;
  }

  document.getElementById("sum-recipient").textContent = recipient;
  document.getElementById("sum-amount").textContent    = formatINR(amount);
  document.getElementById("sum-note").textContent      = note;
  document.getElementById("sum-remaining").textContent = formatINR(state.currentUser.balance - amount);

  document.getElementById("transfer-summary").classList.remove("hidden");
  document.getElementById("btn-confirm-transfer").disabled = false;
}

/**
 * transferMoney()
 * Executes the money transfer.
 *
 * BACKEND: POST /api/transfer
 * Headers: Authorization: Bearer <token>
 * Payload : { recipientAccount, amount, note }
 * Response: { message, newBalance, transactionId }
 */
async function transferMoney() {
  const recipient = document.getElementById("tx-recipient").value.trim();
  const amount    = parseFloat(document.getElementById("tx-amount").value);
  const note      = document.getElementById("tx-note").value.trim();
  const btn       = document.getElementById("btn-confirm-transfer");

  setLoading(btn, true);

  try {
    /* ── UNCOMMENT BELOW when backend is ready ──────────────────────────────
    const res = await fetch(`${BASE_URL}/api/transfer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.authToken}`,
      },
      body: JSON.stringify({ recipientAccount: recipient, amount, note }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Transfer failed.");
    state.currentUser.balance = data.newBalance;
    ────────────────────────────────────────────────────────────────────── */

    // [MOCK] Simulate backend processing
    await new Promise(r => setTimeout(r, 1200));
    state.currentUser.balance -= amount;

    const newTxn = {
      id: "TXN" + (state.transactions.length + 1).toString().padStart(3, "0"),
      date: new Date().toISOString(),
      description: `Transfer to ${recipient}${note ? " — " + note : ""}`,
      type: "transfer",
      amount: -amount,
      balance: state.currentUser.balance,
      ref: genRef(),
    };
    state.transactions.unshift(newTxn);

    showAlert("transfer-success", `✓ Transfer of ${formatINR(amount)} to ${recipient} was successful.`, "success");

    // Reset form
    ["tx-recipient","tx-amount","tx-note"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("transfer-summary").classList.add("hidden");
    btn.disabled = true;

  } catch (err) {
    showAlert("transfer-error", err.message);
  } finally {
    setLoading(btn, false);
  }
}

// ─────────────────────────────────────────────────
//  RENDER — DASHBOARD
// ─────────────────────────────────────────────────
function renderDashboard() {
  const u = state.currentUser;
  if (!u) return;

  document.getElementById("dash-welcome").textContent  = u.name;
  document.getElementById("dash-balance").textContent  = formatINR(u.balance);
  document.getElementById("dash-acct-num").textContent = u.accountNumber;

  // Stats
  const txns = state.transactions;
  const credited  = txns.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0);
  const debited   = txns.filter(t => t.type !== "credit").reduce((s, t) => s + Math.abs(t.amount), 0);
  const transfers = txns.filter(t => t.type === "transfer").length;

  document.getElementById("stat-credited").textContent  = formatINR(credited);
  document.getElementById("stat-debited").textContent   = formatINR(debited);
  document.getElementById("stat-transfers").textContent = transfers;

  // Recent transactions (latest 4)
  const container = document.getElementById("recent-txns");
  container.innerHTML = "";
  txns.slice(0, 4).forEach((t, i) => {
    const div = document.createElement("div");
    div.className = "recent-item";
    div.style.animationDelay = `${i * 60}ms`;
    const sign   = t.amount > 0 ? "+" : "";
    div.innerHTML = `
      <div class="recent-left">
        <span class="txn-dot ${t.type}"></span>
        <div>
          <div class="recent-desc">${t.description}</div>
          <div class="recent-time">${formatDate(t.date)} · ${t.ref}</div>
        </div>
      </div>
      <span class="recent-amount ${t.type}">${sign}${formatINR(Math.abs(t.amount))}</span>
    `;
    container.appendChild(div);
  });
}

// ─────────────────────────────────────────────────
//  RENDER — TRANSACTION TABLE
// ─────────────────────────────────────────────────
function renderHistoryTable(txns) {
  const tbody = document.getElementById("txn-tbody");
  const empty = document.getElementById("txn-empty");
  tbody.innerHTML = "";

  if (!txns || txns.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  txns.forEach(t => {
    const tr = document.createElement("tr");
    const sign = t.amount > 0 ? "+" : "";
    tr.innerHTML = `
      <td class="mono" style="font-size:0.8rem;color:var(--slate-400)">${formatDate(t.date)}</td>
      <td>${t.description}</td>
      <td><span class="badge badge-${t.type}">${t.type}</span></td>
      <td class="mono" style="font-size:0.78rem;color:var(--slate-400)">${t.ref}</td>
      <td class="td-amount ${t.type}">${sign}${formatINR(Math.abs(t.amount))}</td>
      <td class="td-balance">${formatINR(t.balance)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * filterTransactions()
 * Filters the history table by type.
 */
function filterTransactions() {
  const val = document.getElementById("txn-filter").value;
  const filtered = val === "all"
    ? state.transactions
    : state.transactions.filter(t => t.type === val);
  renderHistoryTable(filtered);
}

// ─────────────────────────────────────────────────
//  POST-LOGIN SETUP
// ─────────────────────────────────────────────────
function onLoginSuccess() {
  const u = state.currentUser;
  // Update sidebar user info
  document.getElementById("nav-name").textContent  = u.name;
  document.getElementById("nav-acct").textContent  = u.accountNumber;
  document.getElementById("nav-avatar").textContent = getInitials(u.name);

  // Set greeting time
  const hour = new Date().getHours();
  const tod  = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  document.getElementById("time-of-day").textContent = tod;

  // Set current date display
  document.getElementById("current-date").textContent =
    new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  // Show app shell, go to dashboard
  showSection("app");
  navigate("dashboard");
}

// ─────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  showSection("auth");
  showForm("login");
});