// Skin screen reworked around episodes (flares). An episode has a baseline
// ("current condition", the before) photo and progress (after) photos, each
// optionally linked to a cream application so the UI shows "12h after X".
// Relies on $, toast, escapeHtml, go, segValue, openSheet, closeSheet, loadToday
// from app.js, and compressImage/fileToBase64/dateShort from capture.js.

let baselineImage = null;
let progressImage = null;
let currentEpisode = null;
let currentEpisodePhotos = [];
let selectedCream = null;

function bar(label, val) {
  return '<div class="bar"><div class="bl"><span>' + label + '</span><span>' + val + ' / 10</span></div>' +
    '<div class="track"><div class="fill" style="width:' + (val * 10) + '%"></div></div></div>';
}

function fmtElapsed(ms) {
  const h = ms / 3600000;
  if (h < 1) return Math.max(0, Math.round(ms / 60000)) + 'm';
  if (h < 48) return Math.round(h) + 'h';
  return Math.round(h / 24) + 'd';
}

// ---------- episode list ----------
async function loadEpisodes() {
  try {
    const eps = await (await fetch('/api/episodes')).json();
    renderEpisodeList(eps);
  } catch (e) { $('episodeList').innerHTML = '<div class="card"><p class="meta" style="margin:0;">Could not load episodes.</p></div>'; }
}

function renderEpisodeList(eps) {
  const el = $('episodeList');
  if (!eps.length) { el.innerHTML = '<div class="card"><p class="meta" style="margin:0;">No episodes yet. Tap New episode to start one.</p></div>'; return; }
  el.innerHTML = eps.map((e) => {
    const sev = e.latestSeverity != null ? e.latestSeverity + '/10' : 'no photo yet';
    const trend = (e.baselineSeverity != null && e.latestSeverity != null && e.photoCount > 1)
      ? ' (from ' + e.baselineSeverity + ')' : '';
    return '<button class="card" style="display:block;width:100%;text-align:left;cursor:pointer;" onclick="openEpisode(' + e.id + ')">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
      '<div style="font-weight:500;">' + escapeHtml(e.region || 'Episode') + '</div>' +
      '<span class="badge ' + e.status + '">' + e.status + '</span></div>' +
      '<div class="meta" style="margin-top:4px;">Started ' + dateShort(e.started_at) + ' &middot; ' + e.photoCount + ' photo' + (e.photoCount === 1 ? '' : 's') + ' &middot; now ' + sev + trend + '</div>' +
      '</button>';
  }).join('');
}

// ---------- new episode ----------
// Single-select area picker, rendered from the shared BODY_AREAS list (app.js).
// Uses .pick chips so the generic .sel multi-select handler leaves them alone.
function renderEpisodeAreas() {
  const el = $('episodeAreas');
  if (!el || typeof BODY_AREAS === 'undefined') return;
  el.innerHTML = BODY_AREAS.map((a, i) =>
    '<button class="pick" aria-pressed="' + (i === 0 ? 'true' : 'false') + '" onclick="pickEpisodeArea(this)">' + escapeHtml(a) + '</button>'
  ).join('');
}
function pickEpisodeArea(btn) {
  document.querySelectorAll('#episodeAreas .pick').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  btn.setAttribute('aria-pressed', 'true');
}
function selectedEpisodeArea() {
  const on = document.querySelector('#episodeAreas .pick[aria-pressed="true"]');
  return on ? on.textContent.trim() : '';
}

function newEpisode() {
  baselineImage = null;
  $('episodeNote').value = '';
  $('baselineWrap').hidden = true;
  $('episodeHint').textContent = '';
  renderEpisodeAreas();
  $('episodeSheet').hidden = false;
  $('episodeSheet').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function cancelEpisodeSheet() { $('episodeSheet').hidden = true; baselineImage = null; }

async function handleBaselineFile(input) {
  const b64 = await fileToBase64(input);
  if (!b64) return;
  baselineImage = b64;
  $('baselineImg').src = 'data:image/jpeg;base64,' + b64;
  $('baselineWrap').hidden = false;
}

async function createEpisode() {
  const region = selectedEpisodeArea();
  if (!baselineImage) { $('episodeHint').textContent = 'Take a baseline photo of the current condition first.'; return; }
  const btn = $('createEpisodeBtn');
  btn.disabled = true; btn.textContent = 'Creating...';
  try {
    const epRes = await fetch('/api/episodes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region, note: $('episodeNote').value.trim() })
    });
    const ep = (await epRes.json()).episode;
    btn.textContent = 'Grading photo...';
    const res = await fetch('/api/analyze/skin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: baselineImage, mediaType: 'image/jpeg', region, episodeId: ep.id, photoKind: 'episode' })
    });
    const data = await res.json();
    if (!res.ok) { $('episodeHint').textContent = data.error || 'Could not grade the photo.'; toast(data.error || 'Grading failed'); return; }
    $('episodeSheet').hidden = true;
    baselineImage = null;
    toast('Episode started');
    if (typeof loadToday === 'function') loadToday(false);
    openEpisode(ep.id);
  } catch (e) { toast('Network error'); }
  finally { btn.textContent = 'Create episode'; btn.disabled = false; }
}

// ---------- episode detail ----------
async function openEpisode(id) {
  try {
    const data = await (await fetch('/api/episodes/' + id)).json();
    currentEpisode = data.episode;
    renderEpisodeDetail(data.episode, data.photos);
    go('episode');
  } catch (e) { toast('Could not open that episode'); }
}

function backToSkin() { go('skin'); loadEpisodes(); }

function renderEpisodeDetail(ep, photos) {
  currentEpisodePhotos = photos || [];
  const baselineTs = photos.length ? new Date(photos[0].ts).getTime() : null;
  const header =
    '<div class="card">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
    '<div><div style="font-family:\'Space Grotesk\';font-weight:500;font-size:20px;">' + escapeHtml(ep.region || 'Episode') + '</div>' +
    '<div class="meta">Started ' + dateShort(ep.started_at) + (ep.status === 'resolved' && ep.resolved_at ? ' &middot; resolved ' + dateShort(ep.resolved_at) : '') + '</div></div>' +
    '<span class="badge ' + ep.status + '">' + ep.status + '</span></div>' +
    (ep.note ? '<p class="meta" style="margin:8px 0 0;">' + escapeHtml(ep.note) + '</p>' : '') +
    (ep.status === 'active' ? '<button class="ghost" style="margin-top:12px;" onclick="resolveEpisodeUI(' + ep.id + ')">Mark resolved</button>' : '') +
    '<button class="ghost" style="margin-top:9px;color:var(--loss);border-color:var(--loss);" onclick="deleteEpisodeUI(' + ep.id + ')">Delete episode</button>' +
    '</div>';

  let timeline;
  if (!photos.length) {
    timeline = '<div class="card"><p class="meta" style="margin:0;">No baseline photo yet.</p></div>';
  } else {
    timeline = photos.map((l, i) => {
      const p = l.payload;
      const isBaseline = i === 0 || p.photoKind === 'episode';
      let context;
      if (isBaseline) {
        context = 'Baseline &middot; current condition';
      } else {
        const since = baselineTs ? fmtElapsed(new Date(l.ts).getTime() - baselineTs) + ' since baseline' : '';
        const cream = (p.creamName && p.appliedAt)
          ? fmtElapsed(new Date(l.ts).getTime() - new Date(p.appliedAt).getTime()) + ' after ' + escapeHtml(p.creamName)
          : (p.creamName ? 'after ' + escapeHtml(p.creamName) : '');
        context = [cream, since].filter(Boolean).join(' &middot; ') || 'Progress';
      }
      return '<div class="card">' +
        '<div class="photo" style="background-image:url(\'/photos/' + p.photo + '\')"><span class="ptag">' + dateShort(l.ts) + '</span></div>' +
        '<div class="sev"><div class="sevnum">' + p.overall + '<span class="of">/10</span></div>' +
        '<div class="meta">' + context + '</div></div>' +
        (p.note ? '<p class="meta" style="margin:4px 0 0;">' + escapeHtml(p.note) + '</p>' : '') +
        '<div class="bars">' + bar('Redness', p.redness) + bar('Scaling', p.scaling) + bar('Affected area', p.area) + '</div>' +
        '<button class="ghost" style="margin-top:6px;" onclick="editEpisodePhoto(' + l.id + ')">Adjust severity</button>' +
        '<button class="ghost" style="margin-top:6px;color:var(--loss);border-color:var(--loss);" onclick="deletePhoto(' + l.id + ')">Delete photo</button>' +
        '</div>';
    }).join('');
  }

  const addBtn = ep.status === 'active'
    ? '<button class="primary" onclick="openProgress()" style="margin-bottom:14px;">+ Add progress photo</button>'
    : '';

  $('episodeDetail').innerHTML = header + addBtn + timeline;
}

// Open the shared edit sheet (severity slider) for one episode photo.
function editEpisodePhoto(id) {
  const log = (currentEpisodePhotos || []).find((p) => p.id === id);
  if (log && typeof openEditLog === 'function') openEditLog(log);
}

async function resolveEpisodeUI(id) {
  try {
    await fetch('/api/episodes/' + id + '/resolve', { method: 'POST' });
    toast('Episode resolved');
    openEpisode(id);
  } catch (e) { toast('Could not update'); }
}

async function deleteEpisodeUI(id) {
  if (!confirm('Delete this episode and all its photos?')) return;
  try {
    await fetch('/api/episodes/' + id, { method: 'DELETE' });
    toast('Episode deleted');
    backToSkin();
  } catch (e) { toast('Could not delete'); }
}

async function deletePhoto(logId) {
  if (!confirm('Delete this photo?')) return;
  try {
    await fetch('/api/logs/' + logId, { method: 'DELETE' });
    toast('Photo deleted');
    if (currentEpisode) openEpisode(currentEpisode.id);
    if (typeof loadToday === 'function') loadToday(false);
  } catch (e) { toast('Could not delete'); }
}

// ---------- progress photo ----------
function openProgress() {
  progressImage = null; selectedCream = null;
  $('progressWrap').hidden = true;
  $('progressHours').value = '';
  $('progressHint').textContent = '';
  $('progressSheet').hidden = false;
  loadProgressCreams();
  $('progressSheet').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function cancelProgress() { $('progressSheet').hidden = true; progressImage = null; }

async function handleProgressFile(input) {
  const b64 = await fileToBase64(input);
  if (!b64) return;
  progressImage = b64;
  $('progressImg').src = 'data:image/jpeg;base64,' + b64;
  $('progressWrap').hidden = false;
}

async function loadProgressCreams() {
  const el = $('progressCreams');
  try {
    const creams = await (await fetch('/api/products?kind=cream')).json();
    if (!creams.length) { el.innerHTML = '<p class="meta" style="margin:0;">No creams in your library yet.</p>'; return; }
    el.innerHTML = creams.map((c) =>
      '<button class="pick" aria-pressed="false" onclick="selectCream(this,' + c.id + ',&quot;' + escapeHtml(c.name).replace(/"/g, '&quot;') + '&quot;)">' + escapeHtml(c.name) + '</button>'
    ).join('');
  } catch (e) { el.innerHTML = '<p class="meta" style="margin:0;">Could not load creams.</p>'; }
}

function selectCream(btn, id, name) {
  const on = btn.getAttribute('aria-pressed') === 'true';
  document.querySelectorAll('#progressCreams .pick').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  if (on) { selectedCream = null; }
  else { btn.setAttribute('aria-pressed', 'true'); selectedCream = { id, name }; }
}

async function submitProgress() {
  if (!progressImage) { $('progressHint').textContent = 'Take a progress photo first.'; return; }
  let appliedAt = null;
  if (selectedCream) {
    const hours = parseFloat($('progressHours').value);
    appliedAt = (!isNaN(hours) && hours >= 0) ? new Date(Date.now() - hours * 3600000).toISOString() : new Date().toISOString();
  }
  const btn = $('progressBtn');
  btn.disabled = true; btn.textContent = 'Grading...';
  try {
    const res = await fetch('/api/analyze/skin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: progressImage, mediaType: 'image/jpeg', region: currentEpisode.region,
        episodeId: currentEpisode.id, photoKind: 'progress',
        creamProductId: selectedCream ? selectedCream.id : null,
        creamName: selectedCream ? selectedCream.name : '', appliedAt
      })
    });
    const data = await res.json();
    if (!res.ok) { $('progressHint').textContent = data.error || 'Could not grade the photo.'; toast(data.error || 'Grading failed'); return; }
    $('progressSheet').hidden = true;
    progressImage = null;
    toast('Progress photo added');
    if (typeof loadToday === 'function') loadToday(false);
    openEpisode(currentEpisode.id);
  } catch (e) { toast('Network error'); }
  finally { btn.textContent = 'Add progress photo'; btn.disabled = false; }
}

// ---------- boot ----------
window.addEventListener('DOMContentLoaded', () => {
  const b = $('episodeBaselineFile'), p = $('progressFile');
  if (b) b.addEventListener('change', () => handleBaselineFile(b));
  if (p) p.addEventListener('change', () => handleProgressFile(p));
  renderEpisodeAreas();
  loadEpisodes();
});
