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
    day TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_logs_day ON logs(day);
  CREATE INDEX IF NOT EXISTS idx_logs_type ON logs(type);

  -- Unified library of creams/emollients and medications.
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,            -- 'cream' | 'medication'
    name TEXT NOT NULL,
    brand TEXT,
    photo_front TEXT,
    photo_back TEXT,
    extracted TEXT,               -- JSON of AI-extracted fields
    created_at TEXT NOT NULL
  );

  -- Flares. A baseline (before) photo plus progress (after) photos live as logs tied to an episode.
  CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    region TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'resolved'
    started_at TEXT NOT NULL,
    resolved_at TEXT
  );

  -- Latest AI pattern analyses (kept out of the daily feed).
  CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    data TEXT NOT NULL
  );
`);

// Migrate any pre-existing logs table that lacks the `day` column.
try {
  const cols = db.prepare('PRAGMA table_info(logs)').all().map((c) => c.name);
  if (!cols.includes('day')) {
    db.exec('ALTER TABLE logs ADD COLUMN day TEXT');
    // Backfill day from the stored ISO timestamp's calendar date.
    db.exec("UPDATE logs SET day = substr(ts, 1, 10) WHERE day IS NULL");
  }
} catch (_) { /* fresh database, nothing to migrate */ }

const TZ = process.env.TZ || 'America/Toronto';

// Local calendar date (YYYY-MM-DD) in the configured timezone.
function localDay(d) {
  return (d || new Date()).toLocaleDateString('en-CA', { timeZone: TZ });
}

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
  const ts = new Date().toISOString();
  const day = localDay();
  const info = db.prepare('INSERT INTO logs (ts, day, type, payload) VALUES (?, ?, ?, ?)')
    .run(ts, day, type, JSON.stringify(payload || {}));
  return { id: info.lastInsertRowid, ts, day, type };
}

function getLog(id) {
  const r = db.prepare('SELECT id, ts, type, payload FROM logs WHERE id = ?').get(id);
  return r ? hydrate(r) : null;
}

function updateLog(id, payload) {
  const info = db.prepare('UPDATE logs SET payload = ? WHERE id = ?').run(JSON.stringify(payload || {}), id);
  return info.changes > 0 ? getLog(id) : null;
}

function deleteLog(id) {
  return db.prepare('DELETE FROM logs WHERE id = ?').run(id).changes > 0;
}

function hydrate(r) {
  return { id: r.id, ts: r.ts, type: r.type, payload: r.payload ? JSON.parse(r.payload) : {} };
}

// Events for one local day, newest first, with payload parsed.
function getLogsByDay(day) {
  return db.prepare('SELECT id, ts, type, payload FROM logs WHERE day = ? ORDER BY ts DESC').all(day).map(hydrate);
}

// Most recent events of one type (for the Meals "last analysis" and Skin history).
function getLogsByType(type, limit) {
  const n = Math.max(1, Math.min(500, Number(limit) || 20));
  return db.prepare('SELECT id, ts, type, payload FROM logs WHERE type = ? ORDER BY ts DESC LIMIT ?').all(type, n).map(hydrate);
}

// All events at or after an ISO timestamp (for pattern analysis), oldest first.
function getLogsSince(sinceISO) {
  return db.prepare('SELECT id, ts, type, payload FROM logs WHERE ts >= ? ORDER BY ts ASC').all(sinceISO).map(hydrate);
}

// ---------- products (library) ----------
function addProduct(p) {
  const created = new Date().toISOString();
  const info = db.prepare(
    'INSERT INTO products (kind, name, brand, photo_front, photo_back, extracted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(p.kind, p.name, p.brand || '', p.photoFront || '', p.photoBack || '', JSON.stringify(p.extracted || {}), created);
  return getProduct(info.lastInsertRowid);
}
function productRow(r) {
  return {
    id: r.id, kind: r.kind, name: r.name, brand: r.brand,
    photoFront: r.photo_front, photoBack: r.photo_back,
    extracted: r.extracted ? JSON.parse(r.extracted) : {}, createdAt: r.created_at
  };
}
function getProducts(kind) {
  const rows = kind
    ? db.prepare('SELECT * FROM products WHERE kind = ? ORDER BY name COLLATE NOCASE').all(kind)
    : db.prepare('SELECT * FROM products ORDER BY name COLLATE NOCASE').all();
  return rows.map(productRow);
}
function getProduct(id) {
  const r = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  return r ? productRow(r) : null;
}
function deleteProduct(id) {
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
}

// ---------- episodes ----------
function addEpisode(e) {
  const info = db.prepare(
    'INSERT INTO episodes (region, note, status, started_at) VALUES (?, ?, ?, ?)'
  ).run(e.region || '', e.note || '', 'active', new Date().toISOString());
  return getEpisode(info.lastInsertRowid);
}
function getEpisode(id) {
  return db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) || null;
}
function getEpisodes() {
  return db.prepare('SELECT * FROM episodes ORDER BY started_at DESC').all();
}
function resolveEpisode(id) {
  db.prepare("UPDATE episodes SET status = 'resolved', resolved_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  return getEpisode(id);
}
// Delete an episode and the photo events tied to it.
function deleteEpisode(id) {
  const photoIds = getEpisodePhotos(id).map((l) => l.id);
  const del = db.prepare('DELETE FROM logs WHERE id = ?');
  photoIds.forEach((pid) => del.run(pid));
  return db.prepare('DELETE FROM episodes WHERE id = ?').run(id).changes > 0;
}
// Photos (logs of type photo) tied to one episode, oldest first.
function getEpisodePhotos(episodeId) {
  return db.prepare("SELECT id, ts, type, payload FROM logs WHERE type = 'photo' ORDER BY ts ASC")
    .all().map(hydrate).filter((l) => l.payload && Number(l.payload.episodeId) === Number(episodeId));
}

// ---------- analyses ----------
function saveAnalysis(data) {
  const ts = new Date().toISOString();
  db.prepare('INSERT INTO analyses (ts, data) VALUES (?, ?)').run(ts, JSON.stringify(data));
  return { ts, data };
}
function getLatestAnalysis() {
  const r = db.prepare('SELECT ts, data FROM analyses ORDER BY ts DESC LIMIT 1').get();
  return r ? { ts: r.ts, data: JSON.parse(r.data) } : null;
}

module.exports = {
  saveSubscription, getSubscriptions, removeSubscription,
  addLog, getLog, updateLog, deleteLog, getLogsByDay, getLogsByType, getLogsSince, localDay,
  addProduct, getProducts, getProduct, deleteProduct,
  addEpisode, getEpisode, getEpisodes, resolveEpisode, deleteEpisode, getEpisodePhotos,
  saveAnalysis, getLatestAnalysis
};
