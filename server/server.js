// Baseline server: serves the PWA over the port Tailscale proxies to HTTPS,
// stores push subscriptions, accepts log events, and starts the reminder scheduler.

require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');
const scheduler = require('./scheduler');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Client fetches this to subscribe to push.
app.get('/api/vapidPublicKey', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || '' });
});

// Store a push subscription from the installed PWA.
app.post('/api/subscribe', (req, res) => {
  try {
    if (!req.body || !req.body.endpoint) return res.status(400).json({ ok: false });
    db.saveSubscription(req.body);
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false });
  }
});

// Append a log event (meal, cream, itch, photo, note, summary). Expand as the UI grows.
app.post('/api/log', (req, res) => {
  const { type, payload } = req.body || {};
  if (!type) return res.status(400).json({ ok: false });
  db.addLog(type, payload);
  res.status(201).json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Baseline listening on http://localhost:' + PORT);
  if (!process.env.VAPID_PUBLIC_KEY) {
    console.warn('No VAPID keys set. Run: npm run gen-vapid, then add them to .env');
  }
  scheduler.start();
});
