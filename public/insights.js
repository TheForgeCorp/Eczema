// AI pattern analysis. Sends recent meals, medications, creams, itch, and skin
// severity to the model and renders research-grounded findings: what aggravates
// the eczema and what controls it. Relies on $, escapeHtml from app.js.

function dirChip(d) {
  if (d === 'aggravates') return '<span style="color:var(--loss);font-size:12px;font-weight:500;">&#9650; Aggravates</span>';
  if (d === 'improves') return '<span style="color:var(--gain);font-size:12px;font-weight:500;">&#9660; Helps</span>';
  return '<span style="color:var(--mid);font-size:12px;">Unclear</span>';
}
function confChip(c) {
  const cls = c === 'high' ? 'high' : (c === 'medium' ? 'med' : 'low');
  return '<span class="conf ' + cls + '">' + escapeHtml(c) + '</span>';
}

function renderAnalysis(data, ts) {
  if (ts) $('insightsMeta').textContent = 'Last analyzed ' + new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const findings = (data.findings || []).map((f) =>
    '<div class="insight">' +
    '<div class="top">' + dirChip(f.direction) + confChip(f.confidence) + '</div>' +
    '<h3>' + escapeHtml(f.factor) + '</h3>' +
    '<p>' + escapeHtml(f.evidence) + '</p>' +
    '<div class="test"><b>Basis:</b><span>' + escapeHtml(f.basis) + '</span></div>' +
    '<div class="test" style="margin-top:6px;"><b>Test:</b><span>' + escapeHtml(f.test) + '</span></div>' +
    '</div>'
  ).join('') || '<div class="card"><p class="meta" style="margin:0;">No clear patterns yet. Keep logging meals, meds, and photos.</p></div>';

  const clinician = data.clinicianNote
    ? '<div class="card" style="border-color:#C9C5B8;"><p class="label" style="margin-bottom:8px;">For your dermatologist</p>' +
      '<p style="margin:0;color:var(--steel);font-size:13px;">' + escapeHtml(data.clinicianNote) + '</p></div>'
    : '';

  $('insightsResult').innerHTML =
    (data.summary ? '<div class="card"><p class="verdict">' + escapeHtml(data.summary) + '</p></div>' : '') +
    findings + clinician;
}

async function runAnalysis() {
  const btn = $('analyzeBtn');
  btn.disabled = true; btn.textContent = 'Analyzing your data...';
  $('insightsResult').innerHTML = '<div class="card"><p class="meta" style="margin:0;">Reading your meals, medications, creams, and severity over the last 30 days. This can take a moment.</p></div>';
  try {
    const res = await fetch('/api/analyze/patterns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 30 }) });
    const data = await res.json();
    if (!res.ok) { $('insightsResult').innerHTML = '<div class="card"><p class="meta" style="margin:0;">' + escapeHtml(data.error || 'Analysis failed.') + '</p></div>'; return; }
    renderAnalysis(data, data.ts);
  } catch (e) { $('insightsResult').innerHTML = '<div class="card"><p class="meta" style="margin:0;">Network error.</p></div>'; }
  finally { btn.textContent = 'Analyze my patterns'; btn.disabled = false; }
}

async function loadAnalysis() {
  try {
    const latest = await (await fetch('/api/analysis')).json();
    if (latest && latest.data) renderAnalysis(latest.data, latest.ts);
  } catch (e) { /* leave prompt */ }
  try {
    const { configured } = await (await fetch('/api/ai/status')).json();
    if (!configured) $('insightsHint').textContent = 'Analysis is off until ANTHROPIC_API_KEY is set in .env.';
  } catch (e) { /* ignore */ }
}

window.addEventListener('DOMContentLoaded', loadAnalysis);
