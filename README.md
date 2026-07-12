# 🧾 Anant Billing App — Node.js + SQLite

## Files
- `server.js`  → Node.js backend (Express + sql.js SQLite)
- `billing_system.html` → Frontend
- `billing.db` → SQLite database (auto-banta hai)

---

## ⚙️ Setup

### Step 1 — Dependencies install karo (sirf pehli baar)
```bash
npm install
```

### Step 2 — Server chalao
```bash
node server.js
```
Ya shortcut:
```bash
npm start
```

Terminal mein dikhega:
```
✅ New database created
🗄️  Tables ready
🚀 Server chal raha hai: http://localhost:5000
```

### Step 3 — Browser mein kholo
`billing_system.html` double-click karke browser mein kholo.

---

## 🗄️ Database Tables

| Table        | Kya store hota hai        |
|-------------|---------------------------|
| users        | Login users               |
| products     | Products aur prices       |
| bills        | Saved bills               |
| bill_items   | Bill ke andar items       |

---
