// Trends and the Dermatologist summary, computed from real logged data.
// Relies on $, escapeHtml from app.js and dateShort from capture.js.

// Generic 0-10 line chart. points = [{ label, v }].
function drawSeries(elId, points, ariaLabel) {
  const el = $(elId);
  if (!el) return;
  if (!points.length) { el.innerHTML = '<p class="meta" style="margin:0;">Not enough data yet. Keep logging and this fills in.</p>'; return; }
  const W = 360, H = 210, padL = 26, padR = 12, padT = 18, padB = 26;
  const iw = W - padL - padR, ih = H - padT - padB;
  const n = points.length;
  const x = (i) => (n === 1 ? padL + iw / 2 : padL + (i / (n - 1)) * iw);
  const y = (v) => padT + (1 - v / 10) * ih;
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + ariaLabel + '">';
  [0, 5, 10].forEach((g) => {
    svg += '<line x1="' + padL + '" y1="' + y(g) + '" x2="' + (W - padR) + '" y2="' + y(g) + '" stroke="#E4E1D7" stroke-width="1"/>';
    svg += '<text x="' + (padL - 7) + '" y="' + (y(g) + 3) + '" font-size="9" fill="#888780" text-anchor="end">' + g + '</text>';
  });
  if (n > 1) {
    svg += '<polyline points="' + points.map((p, i) => x(i) + ',' + y(p.v)).join(' ') + '" fill="none" stroke="#2C2C2A" stroke-width="2" stroke-linejoin="round"/>';
  }
  points.forEach((p, i) => { svg += '<circle cx="' + x(i) + '" cy="' + y(p.v) + '" r="2.6" fill="#2C2C2A"/>'; });
  const step = Math.max(1, Math.floor(n / 5));
  points.forEach((p, i) => {
    if (i % step === 0 || i === n - 1) svg += '<text x="' + x(i) + '" y="' + (H - 9) + '" font-size="9" fill="#888780" text-anchor="middle">' + escapeHtml(p.label) + '</text>';
  });
  svg += '</svg>';
  el.innerHTML = svg;
}

function statCard(n, label, detail, cls) {
  return '<div class="stat"><div class="n">' + n + '</div><div class="l">' + label + '</div>' +
    (detail ? '<div class="d ' + (cls || '') + '">' + detail + '</div>' : '') + '</div>';
}

// ---------- Trends ----------
async function loadTrends() {
  try {
    const t = await (await fetch('/api/trends?days=21')).json();
    const points = t.series.filter((s) => s.score != null).map((s) => ({ label: s.day.slice(8), v: s.score }));
    drawSeries('chart', points, 'Itch score trend');
    const infl = (t.inflammationSeries || []).filter((s) => s.level != null).map((s) => ({ label: s.day.slice(8), v: s.level }));
    drawSeries('inflChart', infl, 'Inflammation trend');

    const s = t.stats;
    const avg = s.avgThisWeek != null ? s.avgThisWeek : '--';
    let delta = '';
    if (s.avgThisWeek != null && s.avgLastWeek != null) {
      const d = Math.round((s.avgThisWeek - s.avgLastWeek) * 10) / 10;
      delta = d <= 0 ? '▼ ' + Math.abs(d) + ' from last week' : '▲ ' + d + ' from last week';
    }
    const adher = s.rinvoqDays + ' of ' + s.days + ' days';
    $('trendStats').innerHTML =
      statCard(avg, 'Avg itch this week', delta, s.avgThisWeek != null && s.avgLastWeek != null && s.avgThisWeek <= s.avgLastWeek ? 'down' : '') +
      statCard(s.rinvoqDays, 'Rinvoq days logged', adher) +
      statCard(s.overheatedNights, 'Overheated nights', 'last 14 days') +
      statCard(s.dairyMeals, 'Meals flagged dairy', 'last 14 days');
  } catch (e) { /* leave defaults */ }
}

// ---------- Dermatologist summary ----------
async function loadDerm() {
  try {
    const d = await (await fetch('/api/derm')).json();
    const s = d.stats;
    const verdict = s.avgNow != null
      ? 'Itch averages ' + s.avgNow + '/10 over the last 6 weeks' + (s.peakItch != null && s.peakItch > s.avgNow ? ', down from a peak of ' + s.peakItch + '.' : '.')
      : 'Not enough recent data for a read yet. Keep logging.';

    const stats =
      statCard((s.avgNow != null ? s.avgNow : '--') + ' / 10', 'Avg itch now', s.peakItch != null ? 'peak ' + s.peakItch + '/10' : '') +
      statCard(s.flares, 'Flares this period', d.episodes.filter((e) => e.status === 'resolved').length + ' resolved') +
      statCard(s.rinvoqDays, 'Rinvoq days logged', 'last 6 months') +
      statCard(s.loggedDays, 'Days logged', 'last 6 months');

    const flares = d.episodes.length
      ? d.episodes.map((e) =>
        '<div class="flare"><div class="fr"><b>' + escapeHtml(e.region || 'Episode') + ' &middot; ' + dateShort(e.started_at) + '</b>' +
        (e.peak != null ? '<span class="conf med">Peak ' + e.peak + '/10</span>' : '') + '</div>' +
        '<div class="fd">' + (e.status === 'resolved' && e.resolved_at ? 'Resolved ' + dateShort(e.resolved_at) : 'Active') + ' &middot; ' + e.photos.length + ' photo' + (e.photos.length === 1 ? '' : 's') + '</div></div>'
      ).join('')
      : '<p class="meta" style="margin:0;">No flares recorded in this period.</p>';

    const finding = (f) => '<div class="flare"><div class="fr"><b>' + escapeHtml(f.factor) + '</b><span class="conf ' + (f.confidence === 'high' ? 'high' : f.confidence === 'medium' ? 'med' : 'low') + '">' + escapeHtml(f.confidence) + '</span></div><div class="fd">' + escapeHtml(f.evidence) + '</div></div>';
    const triggers = d.triggers.length ? d.triggers.map(finding).join('') : '<p class="meta" style="margin:0;">Run a pattern analysis on the Insights screen to populate this.</p>';
    const helps = d.helps.length ? d.helps.map(finding).join('') : '';

    const progressionPhotos = d.episodes.flatMap((e) => e.photos).sort((a, b) => new Date(a.ts) - new Date(b.ts));
    const progression = progressionPhotos.length
      ? '<div class="grid3">' + progressionPhotos.slice(-6).map((p) =>
        '<div class="pgrid" style="background-image:url(\'/photos/' + p.photo + '\')"><span>' + dateShort(p.ts) + ' &middot; ' + p.overall + '/10</span></div>'
      ).join('') + '</div>'
      : '<p class="meta" style="margin:0;">No photos yet.</p>';

    const questions = d.clinicianNote
      ? '<p style="margin:0;color:var(--steel);font-size:13px;">' + escapeHtml(d.clinicianNote) + '</p>'
      : '<p class="meta" style="margin:0;">Run a pattern analysis to generate questions.</p>';

    $('dermBody').innerHTML =
      '<div class="card"><p class="verdict">' + escapeHtml(verdict) + '</p></div>' +
      '<div class="stats" style="margin-bottom:14px;">' + stats + '</div>' +
      '<div class="card"><p class="label">Severity over 6 months</p><div class="chartwrap" id="dermchart"></div></div>' +
      '<div class="card"><p class="label">Flares</p>' + flares + '</div>' +
      '<div class="card"><p class="label">Suspected triggers from tracking</p>' +
      '<p style="font-size:12px;color:var(--mid);margin:-4px 0 12px;">Patterns from self-logging and research, for your clinician to weigh.</p>' + triggers + '</div>' +
      (helps ? '<div class="card"><p class="label">What appears to help</p>' + helps + '</div>' : '') +
      '<div class="card"><p class="label">Photo progression</p>' + progression + '</div>' +
      '<div class="card"><p class="label">For your dermatologist</p>' + questions + '</div>' +
      '<button class="primary" onclick="window.print()">Export as PDF</button>' +
      '<p class="disc" style="margin-top:14px;">Generated from your self-tracked data and AI analysis grounded in atopic dermatitis research. Severity scores are AI-assisted estimates from photos. Treatment changes are for your clinician to decide.</p>';

    drawSeries('dermchart', d.severity.map((p) => ({ label: dateShort(p.ts), v: p.v })), 'Six month severity trend');
  } catch (e) { /* leave default */ }
}

window.addEventListener('DOMContentLoaded', () => { loadTrends(); loadDerm(); });
