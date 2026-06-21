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
  photo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8 7l1.5-2.5h5L16 7"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>',
  rinvoq: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="8" width="18" height="8" rx="4"/><path d="M12 8v8"/></svg>',
  medication: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="8" width="18" height="8" rx="4"/><path d="M12 8v8"/></svg>',
  summary: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2"/></svg>'
};

// Turn a stored log row into { type, title, detail } for the timeline.
function describeEvent(log) {
  const p = log.payload || {};
  switch (log.type) {
    case 'cream':
      return { type: 'cream', title: p.name || 'Emollient applied', detail: p.name ? 'Cream applied' : '' };
    case 'medication':
      return { type: 'medication', title: p.name || 'Medication', detail: p.dose ? p.dose + ' · taken' : 'taken' };
    case 'itch': {
      const areas = Array.isArray(p.areas) ? p.areas.join(', ') : '';
      return { type: 'itch', title: 'Itch ' + (p.score ?? '?') + '/10', detail: areas };
    }
    case 'note':
      return { type: 'note', title: p.text || 'Note', detail: '' };
    case 'rinvoq':
      return { type: 'rinvoq', title: 'Rinvoq ' + (p.dose || '30 mg'), detail: 'taken' };
    case 'photo':
      return { type: 'photo', title: 'Photo' + (p.region ? ' · ' + p.region : ''), detail: p.overall != null ? 'Severity ' + p.overall + '/10' : '' };
    case 'meal':
      return { type: 'meal', title: p.name || 'Meal', detail: p.tags || '' };
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
  return '<div class="tlitem' + (fresh ? ' fresh' : '') + '">' +
    '<div class="tltime">' + fmtTime(log.ts) + '</div>' +
    '<div class="tlic ' + e.type + '">' + ic + '</div>' +
    '<div class="tlbody"><div class="t">' + escapeHtml(e.title) + '</div>' +
    (e.detail ? '<div class="d">' + escapeHtml(e.detail) + '</div>' : '') +
    '</div></div>';
}

function renderTimeline(logs, freshTop) {
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
}

// ---------- sheets ----------
function openSheet(id) {
  ['itchSheet', 'noteSheet', 'rinvoqSheet', 'creamPicker', 'medPicker'].forEach((s) => {
    const e = $(s);
    if (e) e.hidden = true;
  });
  $(id).hidden = false;
}
function closeSheet(id) { $(id).hidden = true; }

// ---------- capture actions ----------
// Cream and medication logging go through the library pickers in library.js.

function selectedAreas() {
  return Array.from(document.querySelectorAll('#itchAreas .sel[aria-pressed="true"]'))
    .map((b) => b.textContent.trim());
}

async function addItch() {
  const score = Number($('itchRange').value);
  try {
    await apiLog('itch', { score, areas: selectedAreas() });
    closeSheet('itchSheet');
    await loadToday(true);
    toast('Itch logged');
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

// ---------- evening summary ----------
function toggleEve() {
  $('eveFields').hidden = false;
  $('evePrompt').hidden = true;
}

function segValue(name) {
  const seg = document.querySelector('[data-seg="' + name + '"]');
  if (!seg) return '';
  const on = seg.querySelector('button[aria-pressed="true"]');
  return on ? on.textContent.trim() : '';
}

async function saveEve() {
  const payload = {
    overall: segValue('overall'),
    sleep: segValue('sleep'),
    overheated: $('eveOverheated').checked,
    stress: segValue('stress'),
    text: $('eveNote').value.trim()
  };
  try {
    await apiLog('summary', payload);
    $('eveCard').innerHTML =
      '<div class="row" style="border:none;padding:2px 0;"><div><div class="k">Evening summary logged</div>' +
      '<div class="meta">Day complete</div></div><span style="color:var(--gain);font-size:20px;">&#10003;</span></div>';
    await loadToday(false);
    toast('Evening summary saved');
  } catch (e) { toast('Could not save. Check the server.'); }
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
  } else if (screen) {
    go(screen);
  }
}

// Trends and the dermatologist summary are rendered from real data in reports.js.

// ---------- boot ----------
window.addEventListener('DOMContentLoaded', () => {
  $('topdate').textContent = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  wireControls();
  loadToday(false);
  handleDeepLink();
});
