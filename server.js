const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const app = express();
app.use(cors());
app.use(express.json());

// HTML file serve karo
app.use(express.static(__dirname));

const DB_FILE = path.join(__dirname, "billing.db");

let db; // global db instance

// ── DB Init ──────────────────────────────────────────────
async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    const fileBuffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(fileBuffer);
    console.log("✅ Existing database loaded");
  } else {
    db = new SQL.Database();
    console.log("✅ New database created");
  }

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL DEFAULT ''
  )`);
  // Add password column if upgrading old DB
  try { db.run("ALTER TABLE users ADD COLUMN password TEXT NOT NULL DEFAULT ''"); } catch(e) {}

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    invoice TEXT NOT NULL,
    customer TEXT NOT NULL,
    total REAL NOT NULL,
    date TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bill_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    qty INTEGER NOT NULL,
    total REAL NOT NULL,
    FOREIGN KEY (bill_id) REFERENCES bills(id)
  )`);

  saveDB();
  console.log("🗄️  Tables ready");
}

// Save DB to file after every write
function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

// Helper: run query and return rows as array of objects
function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    // sql.js returns BigInt for integers - convert all to Number
    const cleaned = {};
    for (const key in row) {
      cleaned[key] = typeof row[key] === "bigint" ? Number(row[key]) : row[key];
    }
    rows.push(cleaned);
  }
  stmt.free();
  return rows;
}

// Helper: run insert/update/delete
function run(sql, params = []) {
  db.run(sql, params);
  const result = db.exec("SELECT last_insert_rowid()");
  const val = result[0]?.values[0][0];
  const id = Number(val);
  saveDB();
  return id;
}

// ── AUTH ─────────────────────────────────────────────────
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim()) return res.status(400).json({ error: "Username required" });
  if (!password?.trim()) return res.status(400).json({ error: "Password required" });

  const existing = query("SELECT id, username, password FROM users WHERE username = ?", [username]);

  if (existing.length === 0) {
    // New user - register
    run("INSERT INTO users (username, password) VALUES (?, ?)", [username, password]);
    const newUser = query("SELECT id, username FROM users WHERE username = ?", [username]);
    return res.json({ user_id: newUser[0].id, username: newUser[0].username });
  } else {
    // Existing user - check password
    if (existing[0].password && existing[0].password !== password) {
      return res.status(401).json({ error: "Incorrect password." });
    }
    // If old user had no password, set it now
    if (!existing[0].password) {
      run("UPDATE users SET password = ? WHERE id = ?", [password, existing[0].id]);
    }
    return res.json({ user_id: existing[0].id, username: existing[0].username });
  }
});

// ── SIGNUP ───────────────────────────────────────────────
app.post("/api/signup", (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim()) return res.status(400).json({ error: "Username required" });
  if (!password?.trim()) return res.status(400).json({ error: "Password required" });

  const existing = query("SELECT id FROM users WHERE username = ?", [username]);
  if (existing.length > 0) {
    return res.status(400).json({ error: "Username already exists. Please choose another." });
  }

  run("INSERT INTO users (username, password) VALUES (?, ?)", [username, password]);
  const newUser = query("SELECT id, username FROM users WHERE username = ?", [username]);
  return res.json({ user_id: newUser[0].id, username: newUser[0].username, message: "Account created!" });
});

// ── PRODUCTS ─────────────────────────────────────────────
app.get("/api/products/:user_id", (req, res) => {
  const rows = query("SELECT * FROM products WHERE user_id = ?", [req.params.user_id]);
  res.json(rows);
});

app.post("/api/products", (req, res) => {
  const { user_id, name, price } = req.body;
  if (!user_id || !name || price == null) return res.status(400).json({ error: "Missing fields" });

  const existing = query(
    "SELECT id FROM products WHERE user_id = ? AND LOWER(name) = LOWER(?)",
    [user_id, name]
  );

  if (existing.length > 0) {
    run("UPDATE products SET price = ? WHERE id = ?", [price, existing[0].id]);
    return res.json({ message: "Price updated", updated: true });
  }

  const id = run("INSERT INTO products (user_id, name, price) VALUES (?, ?, ?)", [user_id, name, price]);
  res.json({ message: "Product added", id });
});

app.put("/api/products/:id", (req, res) => {
  const { price } = req.body;
  if (price == null) return res.status(400).json({ error: "Price required" });
  run("UPDATE products SET price = ? WHERE id = ?", [price, req.params.id]);
  res.json({ message: "Price updated" });
});

app.delete("/api/products/:id", (req, res) => {
  run("DELETE FROM products WHERE id = ?", [req.params.id]);
  res.json({ message: "Product deleted" });
});

// ── BILLS ────────────────────────────────────────────────
app.get("/api/bills/:user_id", (req, res) => {
  const bills = query(
    "SELECT * FROM bills WHERE user_id = ? ORDER BY id DESC",
    [req.params.user_id]
  );

  const result = bills.map(bill => {
    const items = query("SELECT * FROM bill_items WHERE bill_id = ?", [Number(bill.id)]);
    return { ...bill, items };
  });

  res.json(result);
});

app.post("/api/bills", (req, res) => {
  const { user_id, invoice, customer, total, date, items } = req.body;
  console.log("Save bill:", { user_id, customer, total, itemsCount: items?.length });

  if (!user_id || !invoice || !customer || total == null || !date || !items?.length) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    const bill_id = run(
      "INSERT INTO bills (user_id, invoice, customer, total, date) VALUES (?, ?, ?, ?, ?)",
      [Number(user_id), String(invoice), customer, Number(total), date]
    );
    console.log("Bill inserted, id:", bill_id);

    items.forEach((item, i) => {
      console.log("Saving item:", item.name, "bill_id:", bill_id);
      run(
        "INSERT INTO bill_items (bill_id, name, price, qty, total) VALUES (?, ?, ?, ?, ?)",
        [Number(bill_id), item.name, Number(item.price), Number(item.qty), Number(item.total)]
      );
    });

    console.log("All items saved!");
    res.json({ message: "Bill saved", bill_id });
  } catch(err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/bills/:id", (req, res) => {
  run("DELETE FROM bill_items WHERE bill_id = ?", [req.params.id]);
  run("DELETE FROM bills WHERE id = ?", [req.params.id]);
  res.json({ message: "Bill deleted" });
});

// ── START ────────────────────────────────────────────────
const os = require("os");
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

initDB().then(() => {
  app.listen(process.env.PORT || 5000, () => {
    const ip = getLocalIP();
    console.log("\n🚀 Server is running!");
    console.log("   Local:   http://localhost:5000/billing_system.html");
    console.log(`   Network: http://${ip}:5000/billing_system.html\n`);
  });
});
