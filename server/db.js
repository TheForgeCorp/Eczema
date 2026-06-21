// SQLite storage for push subscriptions and (stub) log events.

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, 'baseline.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    endpoint TEXT PRIMARY KEY,
    sub TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT
  );
`);

function saveSubscription(sub) {
  db.prepare('INSERT OR REPLACE INTO subscriptions (endpoint, sub) VALUES (?, ?)')
    .run(sub.endpoint, JSON.stringify(sub));
}

function getSubscriptions() {
  return db.prepare('SELECT endpoint, sub FROM subscriptions').all();
}

function removeSubscription(endpoint) {
  db.prepare('DELETE FROM subscriptions WHERE endpoint = ?').run(endpoint);
}

function addLog(type, payload) {
  db.prepare('INSERT INTO logs (ts, type, payload) VALUES (?, ?, ?)')
    .run(new Date().toISOString(), type, JSON.stringify(payload || {}));
}

module.exports = { saveSubscription, getSubscriptions, removeSubscription, addLog };
