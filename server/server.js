// Baseline server: serves the PWA over the port Tailscale proxies to HTTPS,
// stores push subscriptions, accepts log events, and starts the reminder scheduler.

require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');
const ai = require('./ai');
const photos = require('./photos');
const scheduler = require('./scheduler');

const app = express();
// Limit is generous because meal/skin photos arrive as base64 JSON (compressed client-side).
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
// Stored photos live outside public/ (in gitignored data/). Serve them read-only.
app.use('/photos', express.static(photos.dir));

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

// Append a log event (meal, cream, itch, photo, note, rinvoq, summary).
app.post('/api/log', (req, res) => {
  const { type, payload } = req.body || {};
  if (!type) return res.status(400).json({ ok: false });
  const row = db.addLog(type, payload);
  res.status(201).json({ ok: true, ...row });
});

// Events for a local day. ?date=YYYY-MM-DD, defaults to today in the server timezone.
app.get('/api/logs', (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : db.localDay();
  res.json(db.getLogsByDay(date));
});

// Most recent events of one type (Meals last-analysis, Skin history).
app.get('/api/recent', (req, res) => {
  if (!req.query.type) return res.status(400).json({ ok: false });
  res.json(db.getLogsByType(req.query.type, req.query.limit));
});

// Whether the AI analyzers are configured, so the client can show the right hint.
app.get('/api/ai/status', (req, res) => {
  res.json({ configured: ai.isConfigured() });
});

// Map analyzer errors to a clear HTTP status + message.
function aiError(res, e) {
  if (e.code === 'NO_KEY') {
    return res.status(503).json({ ok: false, error: 'Analyzer not configured. Add ANTHROPIC_API_KEY to .env and restart.' });
  }
  if (e.code === 'REFUSAL') {
    return res.status(422).json({ ok: false, error: 'The model could not analyze that image. Try another photo.' });
  }
  console.error('analyze error', e.status || '', e.message);
  return res.status(502).json({ ok: false, error: 'Analysis failed. Try again.' });
}

// Build a short timeline summary like "Dairy likely, gluten possible" or "No flags".
function mealSummary(allergens) {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const likely = ai.ALLERGENS.filter((a) => allergens[a] === 'likely');
  const possible = ai.ALLERGENS.filter((a) => allergens[a] === 'possible');
  const parts = likely.map((a) => cap(a) + ' likely').concat(possible.slice(0, 2).map((a) => a + ' possible'));
  return parts.length ? parts.join(', ') : 'No flags';
}

// Analyze a meal photo, store the photo + analysis as a log event.
app.post('/api/analyze/meal', async (req, res) => {
  const { imageBase64, mediaType, description } = req.body || {};
  if (!imageBase64) return res.status(400).json({ ok: false, error: 'No image provided.' });
  if (!ai.isConfigured()) return aiError(res, { code: 'NO_KEY' });
  try {
    const analysis = await ai.analyzeMeal({ imageBase64, mediaType: mediaType || 'image/jpeg', description });
    const photo = photos.savePhoto(imageBase64, mediaType || 'image/jpeg');
    const tags = mealSummary(analysis.allergens);
    const row = db.addLog('meal', { name: analysis.dish, ...analysis, tags, photo });
    res.status(201).json({ ok: true, analysis, photo, tags, ...row });
  } catch (e) {
    aiError(res, e);
  }
});

// Grade a skin photo within an episode, store the photo + scores as a log event.
// photoKind: 'episode' (baseline / current condition) or 'progress' (after).
app.post('/api/analyze/skin', async (req, res) => {
  const { imageBase64, mediaType, region, episodeId, photoKind, creamProductId, creamName, appliedAt } = req.body || {};
  if (!imageBase64) return res.status(400).json({ ok: false, error: 'No image provided.' });
  if (!ai.isConfigured()) return aiError(res, { code: 'NO_KEY' });
  try {
    const scores = await ai.analyzeSkin({ imageBase64, mediaType: mediaType || 'image/jpeg' });
    const photo = photos.savePhoto(imageBase64, mediaType || 'image/jpeg');
    const payload = {
      region: region || '', ...scores, photo,
      episodeId: episodeId ? Number(episodeId) : null,
      photoKind: photoKind === 'progress' ? 'progress' : 'episode',
      creamProductId: creamProductId ? Number(creamProductId) : null,
      creamName: creamName || '',
      appliedAt: appliedAt || null
    };
    const row = db.addLog('photo', payload);
    res.status(201).json({ ok: true, scores, photo, ...row });
  } catch (e) {
    aiError(res, e);
  }
});

// ---------- products library ----------
app.get('/api/products', (req, res) => {
  const kind = req.query.kind === 'cream' || req.query.kind === 'medication' ? req.query.kind : null;
  res.json(db.getProducts(kind));
});

app.get('/api/products/:id', (req, res) => {
  const p = db.getProduct(Number(req.params.id));
  if (!p) return res.status(404).json({ ok: false });
  res.json(p);
});

app.delete('/api/products/:id', (req, res) => {
  db.deleteProduct(Number(req.params.id));
  res.json({ ok: true });
});

// Add a product: store front/back photos, run AI label extraction, save the row.
app.post('/api/products', async (req, res) => {
  const { kind, name, brand, frontBase64, backBase64, mediaType } = req.body || {};
  if (!name || (kind !== 'cream' && kind !== 'medication')) {
    return res.status(400).json({ ok: false, error: 'Name and kind are required.' });
  }
  if (!frontBase64) return res.status(400).json({ ok: false, error: 'A front label photo is required.' });
  if (!ai.isConfigured()) return aiError(res, { code: 'NO_KEY' });
  try {
    const extracted = await ai.extractProduct({
      frontBase64, backBase64, mediaType: mediaType || 'image/jpeg', kind, name
    });
    const photoFront = photos.savePhoto(frontBase64, mediaType || 'image/jpeg');
    const photoBack = backBase64 ? photos.savePhoto(backBase64, mediaType || 'image/jpeg') : '';
    const product = db.addProduct({ kind, name, brand, photoFront, photoBack, extracted });
    res.status(201).json({ ok: true, product });
  } catch (e) {
    aiError(res, e);
  }
});

// ---------- episodes ----------
app.get('/api/episodes', (req, res) => {
  const episodes = db.getEpisodes().map((e) => {
    const ph = db.getEpisodePhotos(e.id);
    const latest = ph[ph.length - 1];
    return {
      ...e,
      photoCount: ph.length,
      latestSeverity: latest ? latest.payload.overall : null,
      baselineSeverity: ph[0] ? ph[0].payload.overall : null
    };
  });
  res.json(episodes);
});

app.post('/api/episodes', (req, res) => {
  const { region, note } = req.body || {};
  res.status(201).json({ ok: true, episode: db.addEpisode({ region, note }) });
});

app.get('/api/episodes/:id', (req, res) => {
  const episode = db.getEpisode(Number(req.params.id));
  if (!episode) return res.status(404).json({ ok: false });
  res.json({ episode, photos: db.getEpisodePhotos(episode.id) });
});

app.post('/api/episodes/:id/resolve', (req, res) => {
  const episode = db.resolveEpisode(Number(req.params.id));
  if (!episode) return res.status(404).json({ ok: false });
  res.json({ ok: true, episode });
});

// ---------- pattern analysis ----------
// Build a compact, readable summary of recent data for the model.
function buildAnalysisSummary(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const logs = db.getLogsSince(since);
  const byType = (t) => logs.filter((l) => l.type === t);
  const d = (ts) => new Date(ts).toLocaleString('en-CA', { timeZone: process.env.TZ || 'America/Toronto' });
  const lines = [];
  lines.push(`Self-tracked eczema data for the last ${days} days.`);

  const itch = byType('itch').map((l) => `${d(l.ts)}: ${l.payload.score}/10${l.payload.areas && l.payload.areas.length ? ' (' + l.payload.areas.join(', ') + ')' : ''}`);
  lines.push('\nITCH SCORES:\n' + (itch.join('\n') || 'none'));

  const skin = byType('photo').map((l) => `${d(l.ts)}: overall ${l.payload.overall}/10 (redness ${l.payload.redness}, scaling ${l.payload.scaling}, area ${l.payload.area})${l.payload.region ? ' ' + l.payload.region : ''}${l.payload.photoKind === 'progress' && l.payload.creamName ? ', ' + l.payload.creamName + ' applied' : ''}`);
  lines.push('\nSKIN SEVERITY:\n' + (skin.join('\n') || 'none'));

  const meals = byType('meal').map((l) => {
    const a = l.payload.allergens || {};
    const flags = ai.ALLERGENS.filter((k) => a[k] === 'likely' || a[k] === 'possible').map((k) => `${k}:${a[k]}`);
    return `${d(l.ts)}: ${l.payload.name || 'meal'}${flags.length ? ' [' + flags.join(', ') + ']' : ' [no flags]'}`;
  });
  lines.push('\nMEALS (with allergen flags):\n' + (meals.join('\n') || 'none'));

  const rinvoq = byType('rinvoq').map((l) => `${d(l.ts)}: Rinvoq ${l.payload.dose || '30 mg'}`);
  lines.push('\nRINVOQ:\n' + (rinvoq.join('\n') || 'none'));

  const meds = byType('medication').map((l) => `${d(l.ts)}: ${l.payload.name || 'medication'}${l.payload.dose ? ' ' + l.payload.dose : ''}`);
  lines.push('\nOTHER MEDICATIONS:\n' + (meds.join('\n') || 'none'));

  const creams = byType('cream').map((l) => `${d(l.ts)}: ${l.payload.name || 'emollient'}`);
  lines.push('\nCREAMS / EMOLLIENTS APPLIED:\n' + (creams.join('\n') || 'none'));

  const eve = byType('summary').map((l) => `${d(l.ts)}: overall ${l.payload.overall || '?'}, sleep ${l.payload.sleep || '?'}, overheated ${l.payload.overheated ? 'yes' : 'no'}, stress ${l.payload.stress || '?'}${l.payload.text ? ', note: ' + l.payload.text : ''}`);
  lines.push('\nEVENING SUMMARIES:\n' + (eve.join('\n') || 'none'));

  return lines.join('\n');
}

app.get('/api/analysis', (req, res) => {
  res.json(db.getLatestAnalysis() || {});
});

app.post('/api/analyze/patterns', async (req, res) => {
  if (!ai.isConfigured()) return aiError(res, { code: 'NO_KEY' });
  try {
    const days = Math.max(7, Math.min(180, Number(req.body && req.body.days) || 30));
    const summary = buildAnalysisSummary(days);
    const result = await ai.analyzePatterns(summary);
    const saved = db.saveAnalysis(result);
    res.json({ ok: true, ts: saved.ts, ...result });
  } catch (e) {
    aiError(res, e);
  }
});

// ---------- trends + dermatologist summary (computed from real logs) ----------
const dayOf = (ts) => db.localDay(new Date(ts));
const ageDays = (ts) => (Date.now() - new Date(ts).getTime()) / 86400000;
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

// Itch trend + headline stats over a window.
app.get('/api/trends', (req, res) => {
  const days = Math.max(7, Math.min(120, Number(req.query.days) || 21));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const logs = db.getLogsSince(since);
  const itch = logs.filter((l) => l.type === 'itch');

  // Daily peak itch.
  const peakByDay = {};
  itch.forEach((l) => {
    const day = dayOf(l.ts);
    peakByDay[day] = Math.max(peakByDay[day] != null ? peakByDay[day] : 0, Number(l.payload.score) || 0);
  });
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = db.localDay(new Date(Date.now() - i * 86400000));
    series.push({ day, score: day in peakByDay ? peakByDay[day] : null });
  }

  const scoresIn = (from, to) => itch.filter((l) => ageDays(l.ts) >= from && ageDays(l.ts) < to).map((l) => Number(l.payload.score) || 0);
  const rinvoqDays = new Set(logs.filter((l) => l.type === 'rinvoq').map((l) => dayOf(l.ts))).size;

  res.json({
    series,
    stats: {
      avgThisWeek: round1(avg(scoresIn(0, 7))),
      avgLastWeek: round1(avg(scoresIn(7, 14))),
      rinvoqDays, days,
      overheatedNights: logs.filter((l) => l.type === 'summary' && l.payload.overheated && ageDays(l.ts) <= 14).length,
      dairyMeals: logs.filter((l) => l.type === 'meal' && ageDays(l.ts) <= 14 &&
        (l.payload.allergens && (l.payload.allergens.dairy === 'likely' || l.payload.allergens.dairy === 'possible'))).length
    }
  });
});

// 6-month dermatologist summary, computed from logs + the latest AI analysis.
app.get('/api/derm', (req, res) => {
  const days = 182;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const logs = db.getLogsSince(since);
  const itch = logs.filter((l) => l.type === 'itch').map((l) => ({ ts: l.ts, v: Number(l.payload.score) || 0 }));
  const photos = logs.filter((l) => l.type === 'photo').map((l) => ({ ts: l.ts, v: Number(l.payload.overall) || 0, region: l.payload.region, photo: l.payload.photo }));
  const recentItch = itch.filter((x) => ageDays(x.ts) <= 42).map((x) => x.v);
  const rinvoqDays = new Set(logs.filter((l) => l.type === 'rinvoq').map((l) => dayOf(l.ts))).size;
  const loggedDays = new Set(logs.map((l) => dayOf(l.ts))).size;

  const episodes = db.getEpisodes().filter((e) => new Date(e.started_at) >= new Date(since)).map((e) => {
    const ph = db.getEpisodePhotos(e.id);
    return {
      region: e.region, status: e.status, started_at: e.started_at, resolved_at: e.resolved_at,
      peak: ph.length ? Math.max(...ph.map((p) => p.payload.overall || 0)) : null,
      photos: ph.map((p) => ({ ts: p.ts, overall: p.payload.overall, photo: p.payload.photo }))
    };
  });

  const latest = db.getLatestAnalysis();
  const findings = latest ? (latest.data.findings || []) : [];

  res.json({
    days,
    stats: {
      avgNow: recentItch.length ? round1(avg(recentItch)) : null,
      peakItch: itch.length ? Math.max(...itch.map((x) => x.v)) : null,
      flares: episodes.length,
      rinvoqDays, loggedDays
    },
    severity: photos.map((p) => ({ ts: p.ts, v: p.v })),
    episodes,
    triggers: findings.filter((f) => f.direction === 'aggravates'),
    helps: findings.filter((f) => f.direction === 'improves'),
    clinicianNote: latest ? latest.data.clinicianNote : '',
    analysisTs: latest ? latest.ts : null
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Baseline listening on http://localhost:' + PORT);
  if (!process.env.VAPID_PUBLIC_KEY) {
    console.warn('No VAPID keys set. Run: npm run gen-vapid, then add them to .env');
  }
  scheduler.start();
});
