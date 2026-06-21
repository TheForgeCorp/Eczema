// Shared capture helpers + the meal analyzer flow. Skin/episode capture lives in
// episodes.js; the products library in library.js. Globals here (compressImage,
// dateShort) are reused by those. Relies on $, toast, escapeHtml, loadToday from app.js.

// ---------- shared: image compression ----------
function compressImage(file, maxDim = 1024, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
      else if (height >= width && height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality)); // data:image/jpeg;base64,...
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}
const dateShort = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// Read a chosen file into a compressed base64 string, or null on cancel/error.
async function fileToBase64(input) {
  const f = input.files && input.files[0];
  input.value = '';
  if (!f) return null;
  try { return (await compressImage(f)).split(',')[1]; }
  catch (e) { toast('Could not read that image'); return null; }
}

// ===================== MEALS =====================
let mealImage = null;
const ALLERGEN_ORDER = [
  ['dairy', 'Dairy'], ['gluten', 'Gluten'], ['nuts', 'Nuts'], ['soy', 'Soy'],
  ['egg', 'Egg'], ['shellfish', 'Shellfish'], ['histamine', 'Histamine'], ['alcohol', 'Alcohol']
];

async function handleMealFile(input) {
  const b64 = await fileToBase64(input);
  if (!b64) return;
  mealImage = b64;
  $('mealPreview').src = 'data:image/jpeg;base64,' + b64;
  $('mealPreviewWrap').hidden = false;
  $('mealAnalyzeBtn').disabled = false;
  $('mealHint').textContent = 'Photo ready. Add a description if you like, then analyze.';
}

async function analyzeMeal() {
  if (!mealImage) { toast('Add a photo first'); return; }
  const btn = $('mealAnalyzeBtn');
  btn.disabled = true; btn.textContent = 'Analyzing...';
  try {
    const res = await fetch('/api/analyze/meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: mealImage, mediaType: 'image/jpeg', description: $('mealDesc').value })
    });
    const data = await res.json();
    if (!res.ok) { $('mealHint').textContent = data.error || 'Analysis failed.'; toast(data.error || 'Analysis failed'); return; }
    renderMealResult(data.analysis);
    mealImage = null;
    $('mealPreviewWrap').hidden = true;
    $('mealDesc').value = '';
    $('mealHint').textContent = 'Logged. Analyze another anytime.';
    toast('Meal analyzed and logged');
    if (typeof loadToday === 'function') loadToday(false);
  } catch (e) { toast('Network error'); }
  finally { btn.textContent = 'Analyze meal'; btn.disabled = !mealImage; }
}

function renderMealResult(m) {
  const chips = ALLERGEN_ORDER.map(([k, label]) => {
    const s = (m.allergens && m.allergens[k]) || 'unlikely';
    return '<div class="chip ' + s + '"><span class="name">' + label + '</span><span class="state">' + s + '</span></div>';
  }).join('');
  const ingredients = (m.ingredients || []).map((i) => '<li>' + escapeHtml(i) + '</li>').join('') || '<li>None detected</li>';
  $('mealResult').innerHTML =
    '<div class="card">' +
    '<div style="font-family:\'Space Grotesk\';font-weight:500;font-size:18px;">' + escapeHtml(m.dish || 'Meal') + '</div>' +
    '<p class="cal" style="margin:4px 0 16px;">&#8776; <b>' + m.caloriesLow + '-' + m.caloriesHigh + ' kcal</b><span class="tag">rough</span></p>' +
    '<p class="label">Allergen check</p>' +
    '<div class="chips" style="margin-bottom:16px;">' + chips + '</div>' +
    '<p class="label">Visible ingredients</p>' +
    '<ul class="ingredients" style="margin-bottom:16px;">' + ingredients + '</ul>' +
    '<p class="label">Caveat</p>' +
    '<p class="caveat">' + escapeHtml(m.caveat || '') + '</p>' +
    '</div>';
}

async function loadMeals() {
  try {
    const logs = await (await fetch('/api/recent?type=meal&limit=1')).json();
    if (logs.length) renderMealResult(logs[0].payload);
  } catch (e) { /* leave empty state */ }
}

async function checkMealAi() {
  try {
    const { configured } = await (await fetch('/api/ai/status')).json();
    if (!configured && $('mealHint')) $('mealHint').textContent = 'Analyzer is off until ANTHROPIC_API_KEY is set in .env.';
  } catch (e) { /* ignore */ }
}

window.addEventListener('DOMContentLoaded', () => {
  const mc = $('mealCamera'), mf = $('mealFile');
  if (mc) mc.addEventListener('change', () => handleMealFile(mc));
  if (mf) mf.addEventListener('change', () => handleMealFile(mf));
  loadMeals();
  checkMealAi();
});
