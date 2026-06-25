// Baseline app logic: screen navigation, the Today feed wired to the persistence
// API, capture sheets, evening summary, reminder deep links, and the trend charts.
// Inline onclick handlers in index.html call the globals defined here.

// ---------- small helpers ----------
const $ = (id) => document.getElementById(id);

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Local calendar date as YYYY-MM-DD, matching the server's day bucketing.
function localDay() {
  return new Date().toLocaleDateString('en-CA');
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- API ----------
async function apiLog(type, payload) {
  const res = await fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, payload })
  });
  if (!res.ok) throw new Error('log failed');
  return res.json();
}

async function apiGetLogs(date) {
  const res = await fetch('/api/logs?date=' + encodeURIComponent(date || localDay()));
  if (!res.ok) throw new Error('fetch failed');
  return res.json();
}

// ---------- event presentation ----------
const ICONS = {
  meal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 3v7a3 3 0 0 0 6 0V3M7 3v18M20 3c-2 0-3 2-3 5s1 4 3 4v9"/></svg>',
  cream: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>',
  itch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 12h3l2-6 4 13 2-7h7"/></svg>',
  inflammation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3c1.5 3-1 4.5-1 6.5a3 3 0 0 0 6 0c0-1-.5-2-1.2-3 2.4 1.2 3.2 3.4 3.2 6A6.2 6.2 0 0 1 5.8 12.5C5.8 9 8.5 6.5 12 3z"/></svg>',
  photo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8 7l1.5-2.5h5L16 7"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>',
  rinvoq: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="8" width="18" height="8" rx="4"/><path d="M12 8v8"/></svg>',
  medication: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="8" width="18" height="8" rx="4"/><path d="M12 8v8"/></svg>',
  morning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 18h18M12 9V4M5.6 10.6 4.2 9.2M18.4 10.6l1.4-1.4M7 18a5 5 0 0 1 10 0"/></svg>',
  summary: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2"/></svg>'
};

// Cache of the day's logs by id, so an entry can be opened for edit/delete.
let todayLogs = {};
let editingLog = null;

// Turn a stored log row into { type, title, detail } for the timeline.
function describeEvent(log) {
  const p = log.payload || {};
  switch (log.type) {
    case 'cream': {
      const areas = Array.isArray(p.areas) ? p.areas.join(', ') : '';
      return { type: 'cream', title: p.name || 'Emollient applied', detail: areas ? 'Applied to ' + areas : 'Cream applied' };
    }
    case 'medication':
      return { type: 'medication', title: p.name || 'Medication', detail: p.dose ? p.dose + ' · taken' : 'taken' };
    case 'itch': {
      const areas = Array.isArray(p.areas) ? p.areas.join(', ') : '';
      return { type: 'itch', title: 'Itch ' + (p.score ?? '?') + '/10', detail: areas };
    }
    case 'inflammation': {
      const areas = Array.isArray(p.areas) ? p.areas.join(', ') : '';
      return { type: 'inflammation', title: 'Inflammation ' + (p.level ?? '?') + '/10', detail: areas };
    }
    case 'note':
      return { type: 'note', title: p.text || 'Note', detail: '' };
    case 'rinvoq':
      return { type: 'rinvoq', title: 'Rinvoq ' + (p.dose || '30 mg'), detail: 'taken' };
    case 'photo':
      return { type: 'photo', title: 'Photo' + (p.region ? ' · ' + p.region : ''), detail: p.overall != null ? 'Severity ' + p.overall + '/10' : '' };
    case 'meal':
      return { type: 'meal', title: p.name || 'Meal', detail: p.tags || '' };
    case 'morning': {
      const bits = [];
      if (p.skin) bits.push('Skin ' + String(p.skin).toLowerCase());
      if (p.itch) bits.push('itch ' + String(p.itch).toLowerCase());
      return { type: 'morning', title: 'Morning summary', detail: bits.join(', ') };
    }
    case 'summary': {
      const bits = [];
      if (p.overall) bits.push('Overall ' + String(p.overall).toLowerCase());
      if (p.sleep) bits.push('sleep ' + String(p.sleep).toLowerCase());
      return { type: 'summary', title: 'Evening summary', detail: bits.join(', ') };
    }
    default:
      return { type: 'note', title: log.type, detail: '' };
  }
}

function timelineItemHtml(log, fresh) {
  const e = describeEvent(log);
  const ic = ICONS[e.type] || ICONS.note;
  return '<div class="tlitem' + (fresh ? ' fresh' : '') + '" role="button" tabindex="0" onclick="openEdit(' + log.id + ')">' +
    '<div class="tltime">' + fmtTime(log.ts) + '</div>' +
    '<div class="tlic ' + e.type + '">' + ic + '</div>' +
    '<div class="tlbody"><div class="t">' + escapeHtml(e.title) + '</div>' +
    (e.detail ? '<div class="d">' + escapeHtml(e.detail) + '</div>' : '') +
    '</div></div>';
}

function renderTimeline(logs, freshTop) {
  todayLogs = {};
  logs.forEach((l) => { todayLogs[l.id] = l; });
  const tl = $('timeline');
  if (!logs.length) {
    tl.innerHTML = '<div class="empty">No events yet today. Log something above.</div>';
    return;
  }
  tl.innerHTML = logs.map((log, i) => timelineItemHtml(log, freshTop && i === 0)).join('');
}

function renderDaySum(logs) {
  const itch = logs.filter((l) => l.type === 'itch').map((l) => Number(l.payload?.score) || 0);
  const peak = itch.length ? Math.max(...itch) : 0;
  const cream = logs.filter((l) => l.type === 'cream').length;
  const meals = logs.filter((l) => l.type === 'meal').length;
  const photos = logs.filter((l) => l.type === 'photo').length;
  $('sumPeakItch').textContent = peak;
  $('sumCream').innerHTML = cream + '&times;';
  $('sumMeals').textContent = meals;
  $('sumPhotos').textContent = photos;
}

async function loadToday(freshTop) {
  try {
    const logs = await apiGetLogs(localDay());
    renderTimeline(logs, freshTop);
    renderDaySum(logs);
    updateSummaryCards(logs);
  } catch (e) {
    $('timeline').innerHTML = '<div class="empty">Could not load today. Is the server running?</div>';
  }
}

// ---------- navigation ----------
function go(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const screen = $('s-' + name);
  if (screen) screen.classList.add('active');
  document.querySelectorAll('.nav button').forEach((b) =>
    b.classList.toggle('active', b.dataset.go === name));
  document.querySelector('.screens').scrollTop = 0;

  // Refresh the screen's data each time it is opened, so it is always current.
  const refresh = {
    today: () => loadToday(false),
    meals: () => loadMeals(),
    skin: () => loadEpisodes(),
    trends: () => loadTrends(),
    insights: () => loadAnalysis(),
    derm: () => loadDerm(),
    library: () => loadLibrary()
  };
  if (refresh[name]) { try { refresh[name](); } catch (e) { /* loader not ready */ } }
}

// ---------- sheets ----------
function openSheet(id) {
  ['itchSheet', 'inflammationSheet', 'noteSheet', 'rinvoqSheet', 'creamPicker', 'medPicker', 'editSheet'].forEach((s) => {
    const e = $(s);
    if (e) e.hidden = true;
  });
  $(id).hidden = false;
  // The edit sheet is a modal; show its backdrop, hide it for the inline sheets.
  const bd = $('modalBackdrop');
  if (bd) bd.hidden = (id !== 'editSheet');
}
function closeSheet(id) {
  $(id).hidden = true;
  if (id === 'editSheet') { const bd = $('modalBackdrop'); if (bd) bd.hidden = true; }
}

// ---------- capture actions ----------
// Cream and medication logging go through the library pickers in library.js.

// Body areas for symptoms (itch, inflammation) and skin episodes. Granular and
// lateralized, with the flexural creases that flare most in atopic dermatitis.
// Single source of truth: the symptom sheets, the edit sheet, and the episode
// picker all render their chips from this list.
const BODY_AREAS = [
  'Face', 'Scalp', 'Ears', 'Eyelids',
  'Neck front', 'Neck back', 'Neck sides',
  'Chest', 'Stomach', 'Upper back', 'Lower back',
  'Left upper arm', 'Right upper arm',
  'Left forearm', 'Right forearm',
  'Left elbow', 'Right elbow',
  'Left elbow crease', 'Right elbow crease',
  'Left wrist', 'Right wrist',
  'Left hand', 'Right hand',
  'Left thigh', 'Right thigh',
  'Left knee', 'Right knee',
  'Behind left knee', 'Behind right knee',
  'Left shin', 'Right shin',
  'Left calf', 'Right calf',
  'Left ankle', 'Right ankle',
  'Left foot', 'Right foot'
];
// Kept name for the edit sheet, which references SYMPTOM_AREAS.
const SYMPTOM_AREAS = BODY_AREAS;

// Render the multi-select area chips into a container from BODY_AREAS.
function renderAreaChips(containerId, selected) {
  const el = $(containerId);
  if (!el) return;
  const on = Array.isArray(selected) ? selected : [];
  el.innerHTML = BODY_AREAS.map((a) =>
    '<button class="sel" aria-pressed="' + (on.includes(a) ? 'true' : 'false') + '">' + a + '</button>'
  ).join('');
}

function selectedAreas(containerId) {
  return Array.from(document.querySelectorAll('#' + containerId + ' .sel[aria-pressed="true"]'))
    .map((b) => b.textContent.trim());
}

// Reset a rendered area-chip group to nothing selected (keeps the wired listeners).
function clearAreaChips(containerId) {
  document.querySelectorAll('#' + containerId + ' .sel').forEach((b) => b.setAttribute('aria-pressed', 'false'));
}

async function addItch() {
  const score = Number($('itchRange').value);
  try {
    await apiLog('itch', { score, areas: selectedAreas('itchAreas') });
    closeSheet('itchSheet');
    await loadToday(true);
    toast('Itch logged');
  } catch (e) { toast('Could not save. Check the server.'); }
}

async function addInflammation() {
  const level = Number($('inflRange').value);
  try {
    await apiLog('inflammation', { level, areas: selectedAreas('inflammationAreas') });
    closeSheet('inflammationSheet');
    await loadToday(true);
    toast('Inflammation logged');
  } catch (e) { toast('Could not save. Check the server.'); }
}

async function addNote() {
  const t = $('noteText');
  const text = t.value.trim();
  if (!text) { toast('Write a note first'); return; }
  try {
    await apiLog('note', { text });
    t.value = '';
    closeSheet('noteSheet');
    await loadToday(true);
    toast('Note added');
  } catch (e) { toast('Could not save. Check the server.'); }
}

async function addRinvoq() {
  try {
    await apiLog('rinvoq', { dose: '30 mg' });
    closeSheet('rinvoqSheet');
    await loadToday(true);
    toast('Rinvoq logged');
  } catch (e) { toast('Could not save. Check the server.'); }
}

function segValue(name) {
  const seg = document.querySelector('[data-seg="' + name + '"]');
  if (!seg) return '';
  const on = seg.querySelector('button[aria-pressed="true"]');
  return on ? on.textContent.trim() : '';
}

// Programmatically select the segmented-control option whose label matches value.
function setSeg(name, value) {
  const seg = document.querySelector('[data-seg="' + name + '"]');
  if (!seg) return;
  seg.querySelectorAll('button').forEach((b) =>
    b.setAttribute('aria-pressed', b.textContent.trim() === value ? 'true' : 'false'));
}

// ---------- morning + evening summaries (one per day, editable in place) ----------
// These IDs let saveMorning/saveEve update the existing entry instead of adding a duplicate.
let morningLogId = null;
let eveLogId = null;

function morningSummaryText(p) {
  const bits = [];
  if (p.skin) bits.push('Skin ' + String(p.skin).toLowerCase() + ' vs last night');
  if (p.itch) bits.push('itch on waking ' + String(p.itch).toLowerCase());
  if (p.woke) bits.push('woke scratching');
  let s = bits.join(', ');
  if (p.text) s += (s ? '. ' : '') + p.text;
  return s || 'Logged for today';
}
function eveSummaryText(p) {
  const bits = [];
  if (p.overall) bits.push('Overall ' + String(p.overall).toLowerCase());
  if (p.sleep) bits.push('sleep ' + String(p.sleep).toLowerCase());
  if (p.overheated) bits.push('overheated at night');
  if (p.stress) bits.push('stress ' + String(p.stress).toLowerCase());
  let s = bits.join(', ');
  if (p.text) s += (s ? '. ' : '') + p.text;
  return s || 'Day complete';
}
function summaryDoneHtml(label, text, editFn) {
  return '<p class="label" style="margin-bottom:8px;">' + label + '</p>' +
    '<div class="row" style="border:none;padding:0;align-items:flex-start;">' +
    '<div style="font-size:13px;color:var(--steel);max-width:68%;">' + escapeHtml(text) + '</div>' +
    '<button class="ghost" style="width:auto;padding:10px 15px;" onclick="' + editFn + '()">Edit</button></div>';
}

// Reflect whether today's morning / evening summary already exists, so the user
// can review what they logged and reopen it to edit, rather than logging twice.
function updateSummaryCards(logs) {
  const m = logs.find((l) => l.type === 'morning');
  const e = logs.find((l) => l.type === 'summary');
  morningLogId = m ? m.id : null;
  eveLogId = e ? e.id : null;

  $('morningFields').hidden = true;
  $('morningPrompt').hidden = !!m;
  $('morningDone').hidden = !m;
  $('morningDone').innerHTML = m ? summaryDoneHtml('Morning summary', morningSummaryText(m.payload || {}), 'toggleMorning') : '';

  $('eveFields').hidden = true;
  $('evePrompt').hidden = !!e;
  $('eveDone').hidden = !e;
  $('eveDone').innerHTML = e ? summaryDoneHtml('Evening summary', eveSummaryText(e.payload || {}), 'toggleEve') : '';
}

function toggleMorning() {
  const p = morningLogId && todayLogs[morningLogId] ? (todayLogs[morningLogId].payload || {}) : null;
  setSeg('mskin', p ? (p.skin || 'Same') : 'Same');
  setSeg('mitch', p ? (p.itch || 'None') : 'None');
  $('mWoke').checked = p ? !!p.woke : false;
  $('morningNote').value = p ? (p.text || '') : '';
  $('morningPrompt').hidden = true;
  $('morningDone').hidden = true;
  $('morningFields').hidden = false;
}

async function saveMorning() {
  const payload = { skin: segValue('mskin'), itch: segValue('mitch'), woke: $('mWoke').checked, text: $('morningNote').value.trim() };
  try {
    await upsertSummary('morning', morningLogId, payload);
    await loadToday(false);
    toast('Morning summary saved');
  } catch (e) { toast('Could not save. Check the server.'); }
}

function toggleEve() {
  const p = eveLogId && todayLogs[eveLogId] ? (todayLogs[eveLogId].payload || {}) : null;
  setSeg('overall', p ? (p.overall || 'Same') : 'Same');
  setSeg('sleep', p ? (p.sleep || 'OK') : 'OK');
  setSeg('stress', p ? (p.stress || 'Low') : 'Low');
  $('eveOverheated').checked = p ? !!p.overheated : false;
  $('eveNote').value = p ? (p.text || '') : '';
  $('evePrompt').hidden = true;
  $('eveDone').hidden = true;
  $('eveFields').hidden = false;
}

async function saveEve() {
  const payload = {
    overall: segValue('overall'), sleep: segValue('sleep'),
    overheated: $('eveOverheated').checked, stress: segValue('stress'), text: $('eveNote').value.trim()
  };
  try {
    await upsertSummary('summary', eveLogId, payload);
    await loadToday(false);
    toast('Evening summary saved');
  } catch (e) { toast('Could not save. Check the server.'); }
}

// PATCH an existing summary entry, or POST a new one.
async function upsertSummary(type, id, payload) {
  if (id) {
    const res = await fetch('/api/logs/' + id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload })
    });
    if (!res.ok) throw new Error('update failed');
    return res.json();
  }
  return apiLog(type, payload);
}

// ---------- edit / delete an entry ----------
function editSeg(btn) {
  btn.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  btn.setAttribute('aria-pressed', 'true');
}
function esegVal(name) {
  const on = document.querySelector('#editFields [data-eseg="' + name + '"] button[aria-pressed="true"]');
  return on ? on.textContent.trim() : '';
}
function eChip(label, pressed) {
  return '<button class="sel" aria-pressed="' + (pressed ? 'true' : 'false') +
    '" onclick="this.setAttribute(\'aria-pressed\', this.getAttribute(\'aria-pressed\')===\'true\'?\'false\':\'true\')">' + label + '</button>';
}
function eSeg(name, options, current) {
  return '<div class="seg" data-eseg="' + name + '">' + options.map((o) =>
    '<button aria-pressed="' + (o === current ? 'true' : 'false') + '" onclick="editSeg(this)">' + o + '</button>').join('') + '</div>';
}

// Open the edit sheet for a log object that may not be in today's feed (e.g. an
// older episode photo). Caching it under its id lets openEdit/saveEdit reuse it.
function openEditLog(log) {
  if (!log) return;
  todayLogs[log.id] = log;
  openEdit(log.id);
}

function openEdit(id) {
  const log = todayLogs[id];
  if (!log) return;
  editingLog = log;
  const p = log.payload || {};
  $('editTitle').textContent = 'Edit ' + describeEvent(log).title.toLowerCase() + ' · ' + fmtTime(log.ts);
  let html = '';
  let canSave = true;
  switch (log.type) {
    case 'itch':
      html = '<div style="margin-bottom:10px;"><span class="mini"><span id="editScoreVal">' + (p.score ?? 5) + '</span><span style="font-size:14px;color:var(--mid);">/10</span></span></div>' +
        '<input type="range" id="editScore" min="0" max="10" value="' + (p.score ?? 5) + '" oninput="document.getElementById(\'editScoreVal\').textContent=this.value">' +
        '<div class="scaleends"><span>None</span><span>Unbearable</span></div>' +
        '<div class="meta" style="margin:14px 0 7px;">Areas</div><div class="chiprow arearow" id="editAreas">' +
        SYMPTOM_AREAS.map((a) => eChip(a, (p.areas || []).includes(a))).join('') + '</div>';
      break;
    case 'inflammation':
      html = '<div style="margin-bottom:10px;"><span class="mini"><span id="editScoreVal">' + (p.level ?? 5) + '</span><span style="font-size:14px;color:var(--mid);">/10</span></span></div>' +
        '<input type="range" id="editScore" min="0" max="10" value="' + (p.level ?? 5) + '" oninput="document.getElementById(\'editScoreVal\').textContent=this.value">' +
        '<div class="scaleends"><span>None</span><span>Intense</span></div>' +
        '<div class="meta" style="margin:14px 0 7px;">Areas</div><div class="chiprow arearow" id="editAreas">' +
        SYMPTOM_AREAS.map((a) => eChip(a, (p.areas || []).includes(a))).join('') + '</div>';
      break;
    case 'note':
      html = '<textarea id="editText">' + escapeHtml(p.text || '') + '</textarea>';
      break;
    case 'rinvoq':
      html = '<div class="meta" style="margin-bottom:7px;">Dose</div><input type="text" class="field" id="editDose" value="' + escapeHtml(p.dose || '30 mg') + '">';
      break;
    case 'meal':
      html = '<div class="meta" style="margin-bottom:7px;">Dish</div><input type="text" class="field" id="editName" value="' + escapeHtml(p.name || p.dish || '') + '">' +
        '<p class="meta" style="margin-top:10px;">Allergen flags stay as analyzed. To re-analyze, delete and add a new photo.</p>';
      break;
    case 'photo':
      html = '<div style="margin-bottom:10px;"><span class="mini"><span id="editScoreVal">' + (p.overall ?? 5) + '</span><span style="font-size:14px;color:var(--mid);">/10</span></span>' +
        '<span class="meta" style="margin-left:8px;">overall severity</span></div>' +
        '<input type="range" id="editScore" min="0" max="10" value="' + (p.overall ?? 5) + '" oninput="document.getElementById(\'editScoreVal\').textContent=this.value">' +
        '<div class="scaleends"><span>Clear</span><span>Severe</span></div>' +
        '<div class="meta" style="margin:14px 0 7px;">Area</div><input type="text" class="field" id="editRegion" value="' + escapeHtml(p.region || '') + '">' +
        '<p class="meta" style="margin-top:10px;">Saving re-checks the photo against your rating and rewrites the observation to match it.</p>';
      break;
    case 'cream':
      html = '<div style="font-weight:500;margin-bottom:4px;">' + escapeHtml(p.name || 'Cream') + '</div>' +
        '<div class="meta" style="margin:10px 0 7px;">Where applied</div><div class="chiprow arearow" id="editAreas">' +
        SYMPTOM_AREAS.map((a) => eChip(a, (p.areas || []).includes(a))).join('') + '</div>';
      break;
    case 'summary':
      html = '<div style="margin-bottom:14px;"><div class="meta" style="margin-bottom:7px;">Overall today vs yesterday</div>' + eSeg('overall', ['Worse', 'Same', 'Better'], p.overall) + '</div>' +
        '<div style="margin-bottom:14px;"><div class="meta" style="margin-bottom:7px;">Sleep quality</div>' + eSeg('sleep', ['Poor', 'OK', 'Good'], p.sleep) + '</div>' +
        '<div class="row" style="border:none;padding:0;margin-bottom:14px;"><div class="k">Overheated at night</div><label class="switch"><input type="checkbox" id="editOverheated"' + (p.overheated ? ' checked' : '') + '><span class="slider"></span></label></div>' +
        '<div style="margin-bottom:14px;"><div class="meta" style="margin-bottom:7px;">Stress</div>' + eSeg('stress', ['Low', 'Medium', 'High'], p.stress) + '</div>' +
        '<textarea id="editText2">' + escapeHtml(p.text || '') + '</textarea>';
      break;
    case 'morning':
      html = '<div style="margin-bottom:14px;"><div class="meta" style="margin-bottom:7px;">Skin this morning vs last night</div>' + eSeg('mskin', ['Worse', 'Same', 'Better'], p.skin) + '</div>' +
        '<div style="margin-bottom:14px;"><div class="meta" style="margin-bottom:7px;">Itch on waking</div>' + eSeg('mitch', ['None', 'Mild', 'Strong'], p.itch) + '</div>' +
        '<div class="row" style="border:none;padding:0;margin-bottom:14px;"><div class="k">Woke up scratching</div><label class="switch"><input type="checkbox" id="editWoke"' + (p.woke ? ' checked' : '') + '><span class="slider"></span></label></div>' +
        '<textarea id="editText2">' + escapeHtml(p.text || '') + '</textarea>';
      break;
    default: // cream, medication
      html = '<p class="meta" style="margin:0;">To change this, delete it and log it again.</p>';
      canSave = false;
  }
  $('editFields').innerHTML = html;
  $('editSaveBtn').style.display = canSave ? '' : 'none';
  $('editHint').textContent = '';
  openSheet('editSheet');
}

function editedPayload() {
  const p = editingLog.payload || {};
  switch (editingLog.type) {
    case 'itch':
      return { score: Number($('editScore').value), areas: Array.from(document.querySelectorAll('#editAreas .sel[aria-pressed="true"]')).map((b) => b.textContent.trim()) };
    case 'inflammation':
      return { level: Number($('editScore').value), areas: Array.from(document.querySelectorAll('#editAreas .sel[aria-pressed="true"]')).map((b) => b.textContent.trim()) };
    case 'note':
      return { ...p, text: $('editText').value.trim() };
    case 'rinvoq':
      return { ...p, dose: $('editDose').value.trim() };
    case 'meal': {
      const v = $('editName').value.trim();
      return { ...p, name: v, dish: v };
    }
    case 'photo':
      return { ...p, region: $('editRegion').value.trim() };
    case 'cream':
      return { ...p, areas: Array.from(document.querySelectorAll('#editAreas .sel[aria-pressed="true"]')).map((b) => b.textContent.trim()) };
    case 'summary':
      return { overall: esegVal('overall'), sleep: esegVal('sleep'), overheated: $('editOverheated').checked, stress: esegVal('stress'), text: $('editText2').value.trim() };
    case 'morning':
      return { skin: esegVal('mskin'), itch: esegVal('mitch'), woke: $('editWoke').checked, text: $('editText2').value.trim() };
    default:
      return p;
  }
}

async function saveEdit() {
  if (!editingLog) return;
  const btn = $('editSaveBtn');
  btn.disabled = true;
  try {
    // A photo edit re-grades against the corrected rating, so it takes a moment
    // and rewrites the observation; the score the owner sets is authoritative.
    if (editingLog.type === 'photo') {
      btn.textContent = 'Re-grading...';
      $('editHint').textContent = 'Re-checking the photo against your rating...';
      const res = await fetch('/api/logs/' + editingLog.id + '/regrade-photo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overall: Number($('editScore').value), region: $('editRegion').value.trim() })
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); $('editHint').textContent = d.error || 'Could not re-grade.'; return; }
      closeSheet('editSheet');
      await loadToday(false);
      if (typeof currentEpisode !== 'undefined' && currentEpisode && typeof openEpisode === 'function') openEpisode(currentEpisode.id);
      toast('Re-graded');
      return;
    }
    const res = await fetch('/api/logs/' + editingLog.id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: editedPayload() })
    });
    if (!res.ok) { $('editHint').textContent = 'Could not save.'; return; }
    closeSheet('editSheet');
    await loadToday(false);
    toast('Updated');
  } catch (e) { $('editHint').textContent = 'Network error.'; }
  finally { btn.disabled = false; btn.textContent = 'Save'; }
}

async function deleteEntry() {
  if (!editingLog) return;
  if (!confirm('Delete this entry?')) return;
  try {
    await fetch('/api/logs/' + editingLog.id, { method: 'DELETE' });
    closeSheet('editSheet');
    await loadToday(false);
    toast('Deleted');
  } catch (e) { toast('Could not delete'); }
}

// ---------- shared control wiring ----------
function wireControls() {
  // selectable chips (areas in sheets)
  document.querySelectorAll('.sel').forEach((c) => c.addEventListener('click', () => {
    c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
  }));

  // segmented controls
  document.querySelectorAll('[data-seg]').forEach((seg) => {
    seg.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
    }));
  });

  // bottom nav
  document.querySelectorAll('.nav button').forEach((b) =>
    b.addEventListener('click', () => go(b.dataset.go)));

  // itch slider live readout
  const itchRange = $('itchRange');
  const iwords = ['No itch', 'Barely there', 'Faint', 'Mild', 'Mild, noticeable', 'Moderate',
    'Nagging', 'Strong', 'Hard to ignore', 'Severe', 'Relentless'];
  if (itchRange) itchRange.addEventListener('input', () => {
    $('itchSheetVal').textContent = itchRange.value;
    $('itchSheetWord').textContent = iwords[itchRange.value];
  });

  const inflRange = $('inflRange');
  const fwords = ['None', 'Trace', 'Faint', 'Mild', 'Noticeable', 'Moderate',
    'Warm', 'Sore', 'Hot', 'Burning', 'Intense'];
  if (inflRange) inflRange.addEventListener('input', () => {
    $('inflSheetVal').textContent = inflRange.value;
    $('inflSheetWord').textContent = fwords[inflRange.value];
  });
}

// ---------- deep links from reminder taps ----------
function handleDeepLink() {
  const q = new URLSearchParams(location.search);
  const log = q.get('log');
  const screen = q.get('screen');
  if (log === 'rinvoq') {
    go('today');
    openSheet('rinvoqSheet');
  } else if (screen === 'closeout') {
    go('today');
    toggleEve();
    $('eveCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (screen === 'morning') {
    go('today');
    toggleMorning();
    $('morningCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (screen) {
    go(screen);
  }
}

// Trends and the dermatologist summary are rendered from real data in reports.js.

// ---------- boot ----------
window.addEventListener('DOMContentLoaded', () => {
  $('topdate').textContent = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  renderAreaChips('itchAreas');
  renderAreaChips('inflammationAreas');
  renderAreaChips('creamAreas');
  wireControls(); // attaches the toggle handler to the chips just rendered
  loadToday(false);
  handleDeepLink();
});
