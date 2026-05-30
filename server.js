require("dotenv").config(); // .env file load karo (local pe)

const express = require("express");
const cors    = require("cors");
const mysql   = require("mysql2");
const path    = require("path");
const os      = require("os");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ── MySQL Connection ──────────────────────────────────────
// Local pe: .env file se values aayengi
// Online pe: FreeSQLDatabase ki default values use hongi
const db = mysql.createPool({
  host:              process.env.DB_HOST     || "sql8.freesqldatabase.com",
  port:              process.env.DB_PORT     || 3306,
  user:              process.env.DB_USER     || "sql8828738",
  password:          process.env.DB_PASSWORD || "8QWWyMKMCE",
  database:          process.env.DB_NAME     || "sql8828738",
  waitForConnections: true,
  connectionLimit:   5,
  queueLimit:        0
});

// Test connection
db.getConnection((err, connection) => {
  if (err) { console.error("❌ MySQL connect failed:", err.message); return; }
  console.log("✅ MySQL connected! Host:", process.env.DB_HOST || "sql8.freesqldatabase.com");
  connection.release();
  setupTables();
});

// ── Tables Setup ─────────────────────────────────────────
function setupTables() {
  db.query(`CREATE TABLE IF NOT EXISTS users (
    id       INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(100) NOT NULL DEFAULT ''
  )`, err => { if(err) console.error("users table:", err.message); });

  db.query(`CREATE TABLE IF NOT EXISTS products (
    id      INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name    VARCHAR(200) NOT NULL,
    price   DECIMAL(10,2) NOT NULL
  )`, err => { if(err) console.error("products table:", err.message); });

  db.query(`CREATE TABLE IF NOT EXISTS bills (
    id       INT AUTO_INCREMENT PRIMARY KEY,
    user_id  INT NOT NULL,
    invoice  VARCHAR(100) NOT NULL,
    customer VARCHAR(200) NOT NULL,
    total    DECIMAL(10,2) NOT NULL,
    date     VARCHAR(50) NOT NULL
  )`, err => { if(err) console.error("bills table:", err.message); });

  db.query(`CREATE TABLE IF NOT EXISTS bill_items (
    id      INT AUTO_INCREMENT PRIMARY KEY,
    bill_id INT NOT NULL,
    name    VARCHAR(200) NOT NULL,
    price   DECIMAL(10,2) NOT NULL,
    qty     INT NOT NULL,
    total   DECIMAL(10,2) NOT NULL
  )`, err => {
    if(err) console.error("bill_items table:", err.message);
    else    console.log("🗄️  Tables ready");
  });
}

// ── AUTH ─────────────────────────────────────────────────
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim()) return res.status(400).json({ error: "Username required" });
  if (!password?.trim()) return res.status(400).json({ error: "Password required" });

  db.query("SELECT * FROM users WHERE username = ?", [username], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    if (rows.length === 0) {
      db.query("INSERT INTO users (username, password) VALUES (?, ?)", [username, password], (err2, result) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ user_id: result.insertId, username });
      });
    } else {
      if (rows[0].password && rows[0].password !== password)
        return res.status(401).json({ error: "Incorrect password." });
      res.json({ user_id: rows[0].id, username: rows[0].username });
    }
  });
});

app.post("/api/signup", (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim()) return res.status(400).json({ error: "Username required" });
  if (!password?.trim()) return res.status(400).json({ error: "Password required" });

  db.query("SELECT id FROM users WHERE username = ?", [username], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    if (rows.length > 0)
      return res.status(400).json({ error: "Username already exists. Please choose another." });

    db.query("INSERT INTO users (username, password) VALUES (?, ?)", [username, password], (err2, result) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ user_id: result.insertId, username, message: "Account created!" });
    });
  });
});

// ── PRODUCTS ─────────────────────────────────────────────
app.get("/api/products/:user_id", (req, res) => {
  db.query("SELECT * FROM products WHERE user_id = ?", [req.params.user_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/api/products", (req, res) => {
  const { user_id, name, price } = req.body;
  if (!user_id || !name || price == null)
    return res.status(400).json({ error: "Missing fields" });

  db.query(
    "SELECT id FROM products WHERE user_id = ? AND LOWER(name) = LOWER(?)",
    [user_id, name],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (rows.length > 0) {
        db.query("UPDATE products SET price = ? WHERE id = ?", [price, rows[0].id], (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ message: "Price updated", updated: true });
        });
      } else {
        db.query(
          "INSERT INTO products (user_id, name, price) VALUES (?, ?, ?)",
          [user_id, name, price],
          (err2, result) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ message: "Product added", id: result.insertId });
          }
        );
      }
    }
  );
});

app.put("/api/products/:id", (req, res) => {
  const { price } = req.body;
  if (price == null) return res.status(400).json({ error: "Price required" });
  db.query("UPDATE products SET price = ? WHERE id = ?", [price, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Price updated" });
  });
});

app.delete("/api/products/:id", (req, res) => {
  db.query("DELETE FROM products WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Product deleted" });
  });
});

// ── BILLS ────────────────────────────────────────────────
app.get("/api/bills/:user_id", (req, res) => {
  db.query(
    "SELECT * FROM bills WHERE user_id = ? ORDER BY id DESC",
    [req.params.user_id],
    (err, bills) => {
      if (err) return res.status(500).json({ error: err.message });
      if (bills.length === 0) return res.json([]);

      let done = 0;
      const result = bills.map(bill => ({ ...bill, items: [] }));
      result.forEach((bill, i) => {
        db.query("SELECT * FROM bill_items WHERE bill_id = ?", [bill.id], (err2, items) => {
          if (!err2) result[i].items = items;
          done++;
          if (done === result.length) res.json(result);
        });
      });
    }
  );
});

app.post("/api/bills", (req, res) => {
  const { user_id, invoice, customer, total, date, items } = req.body;
  if (!user_id || !invoice || !customer || total == null || !date || !items?.length)
    return res.status(400).json({ error: "Missing fields" });

  db.query(
    "INSERT INTO bills (user_id, invoice, customer, total, date) VALUES (?, ?, ?, ?, ?)",
    [user_id, invoice, customer, total, date],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      const bill_id = result.insertId;
      let done = 0;
      items.forEach(item => {
        db.query(
          "INSERT INTO bill_items (bill_id, name, price, qty, total) VALUES (?, ?, ?, ?, ?)",
          [bill_id, item.name, item.price, item.qty, item.total],
          (err2) => {
            if (err2) console.error("item insert error:", err2.message);
            done++;
            if (done === items.length) res.json({ message: "Bill saved", bill_id });
          }
        );
      });
    }
  );
});

app.delete("/api/bills/:id", (req, res) => {
  db.query("DELETE FROM bill_items WHERE bill_id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    db.query("DELETE FROM bills WHERE id = ?", [req.params.id], (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ message: "Bill deleted" });
    });
  });
});

// ── SERVER START ─────────────────────────────────────────
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets))
    for (const net of nets[name])
      if (net.family === "IPv4" && !net.internal) return net.address;
  return "localhost";
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  const ip = getLocalIP();
  console.log("\n🚀 Server is running!");
  console.log(`   Local:   http://localhost:${PORT}/billing_system.html`);
  console.log(`   Network: http://${ip}:${PORT}/billing_system.html\n`);
});
