// Products library (creams/emollients + medications) and the pickers used when
// logging a cream application or a medication. Relies on $, toast, escapeHtml,
// go, segValue, loadToday from app.js and fileToBase64 from capture.js.

function libKind() {
  return segValue('libkind') === 'Medications' ? 'medication' : 'cream';
}

// ---------- list ----------
async function loadLibrary() {
  const kind = libKind();
  try {
    const products = await (await fetch('/api/products?kind=' + kind)).json();
    renderProductList(products, kind);
  } catch (e) { $('productList').innerHTML = '<div class="card"><p class="meta" style="margin:0;">Could not load the library.</p></div>'; }
}

function renderProductList(products, kind) {
  const el = $('productList');
  if (!products.length) {
    el.innerHTML = '<div class="card"><p class="meta" style="margin:0;">No ' + (kind === 'cream' ? 'creams' : 'medications') + ' yet. Tap Add to scan one.</p></div>';
    return;
  }
  el.innerHTML = products.map((p) => {
    const x = p.extracted || {};
    const sub = kind === 'cream' ? (x.purpose || '') : (x.drugClass || x.activeIngredient || '');
    const thumb = p.photoFront
      ? '<div class="thumb" style="background-image:url(\'/photos/' + p.photoFront + '\');background-size:cover;background-position:center;"></div>'
      : '<div class="thumb"></div>';
    return '<button class="card" style="display:flex;gap:12px;align-items:center;width:100%;text-align:left;cursor:pointer;" onclick="viewProduct(' + p.id + ')">' +
      thumb +
      '<div style="flex:1;min-width:0;"><div style="font-weight:500;">' + escapeHtml(p.name) + '</div>' +
      '<div class="meta">' + escapeHtml([p.brand, sub].filter(Boolean).join(' · ')) + '</div></div></button>';
  }).join('');
}

// ---------- view one ----------
async function viewProduct(id) {
  try {
    const p = await (await fetch('/api/products/' + id)).json();
    const x = p.extracted || {};
    const list = (arr) => (arr && arr.length ? arr.map(escapeHtml).join(', ') : 'none listed');
    const row = (label, val) => val ? '<p class="label" style="margin-top:14px;">' + label + '</p><p style="margin:0;color:var(--steel);font-size:13px;">' + escapeHtml(val) + '</p>' : '';
    let body;
    if (p.kind === 'cream') {
      body = row('Purpose', x.purpose) +
        '<p class="label" style="margin-top:14px;">Active ingredients</p><p style="margin:0;color:var(--steel);font-size:13px;">' + list(x.activeIngredients) + '</p>' +
        '<p class="label" style="margin-top:14px;">Other ingredients</p><p style="margin:0;color:var(--steel);font-size:13px;">' + list(x.keyIngredients) + '</p>' +
        row('Fragrance free', x.fragranceFree) +
        row('Efficacy', x.efficacy) +
        row('Eczema relevance', x.eczemaRelevance) +
        '<p class="label" style="margin-top:14px;">Side effects</p><p style="margin:0;color:var(--steel);font-size:13px;">' + list(x.sideEffects) + '</p>' +
        row('Caveat', x.caveat);
    } else {
      body = row('Active ingredient', x.activeIngredient) +
        row('Drug class', x.drugClass) +
        row('Purpose', x.purpose) +
        row('Sedating', x.sedating) +
        row('Typical dose', x.typicalDose) +
        row('Efficacy', x.efficacy) +
        '<p class="label" style="margin-top:14px;">Side effects</p><p style="margin:0;color:var(--steel);font-size:13px;">' + list(x.sideEffects) + '</p>' +
        row('Caveat', x.caveat);
    }
    const photos = ['photoFront', 'photoBack'].filter((k) => p[k]).map((k) =>
      '<div class="pgrid" style="background-image:url(\'/photos/' + p[k] + '\');"></div>').join('');
    $('productDetail').innerHTML =
      '<button class="back" onclick="closeProductDetail()">&#8249; Back to library</button>' +
      '<div class="card">' +
      '<div style="font-family:\'Space Grotesk\';font-weight:500;font-size:18px;">' + escapeHtml(p.name) + '</div>' +
      (p.brand ? '<div class="meta">' + escapeHtml(p.brand) + '</div>' : '') +
      (photos ? '<div class="grid3" style="margin-top:12px;">' + photos + '</div>' : '') +
      body +
      '<button class="ghost" style="margin-top:16px;" onclick="deleteProductConfirm(' + p.id + ')">Remove from library</button>' +
      '<p class="meta" style="margin-top:10px;">Informational, from the label and dermatology research. Not a prescription.</p>' +
      '</div>';
    $('productList').hidden = true;
    $('libraryControls').hidden = true;
    $('productDetail').hidden = false;
  } catch (e) { toast('Could not open that product'); }
}

function closeProductDetail() {
  $('productDetail').hidden = true;
  $('productList').hidden = false;
  $('libraryControls').hidden = false;
}

async function deleteProductConfirm(id) {
  if (!confirm('Remove this product from your library?')) return;
  try {
    await fetch('/api/products/' + id, { method: 'DELETE' });
    closeProductDetail();
    loadLibrary();
    toast('Removed');
  } catch (e) { toast('Could not remove it'); }
}

// ---------- add ----------
let prodFront = null, prodBack = null;

function openAddProduct() {
  prodFront = null; prodBack = null;
  $('prodName').value = ''; $('prodBrand').value = '';
  $('prodFrontWrap').hidden = true; $('prodBackWrap').hidden = true;
  $('addProductTitle').textContent = libKind() === 'medication' ? 'Add a medication' : 'Add a cream';
  $('addProductHint').textContent = '';
  $('addProductSheet').hidden = false;
  $('addProductSheet').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function cancelAddProduct() { $('addProductSheet').hidden = true; }

async function handleProdFront(input) {
  const b64 = await fileToBase64(input);
  if (!b64) return;
  prodFront = b64; $('prodFrontImg').src = 'data:image/jpeg;base64,' + b64; $('prodFrontWrap').hidden = false;
}
async function handleProdBack(input) {
  const b64 = await fileToBase64(input);
  if (!b64) return;
  prodBack = b64; $('prodBackImg').src = 'data:image/jpeg;base64,' + b64; $('prodBackWrap').hidden = false;
}

async function submitProduct() {
  const name = $('prodName').value.trim();
  if (!name) { $('addProductHint').textContent = 'Give it a name.'; return; }
  if (!prodFront) { $('addProductHint').textContent = 'Add a front label photo.'; return; }
  const btn = $('prodSubmitBtn');
  btn.disabled = true; btn.textContent = 'Reading label...';
  try {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: libKind(), name, brand: $('prodBrand').value.trim(), frontBase64: prodFront, backBase64: prodBack, mediaType: 'image/jpeg' })
    });
    const data = await res.json();
    if (!res.ok) { $('addProductHint').textContent = data.error || 'Could not add it.'; toast(data.error || 'Failed'); return; }
    $('addProductSheet').hidden = true;
    loadLibrary();
    toast('Added to library');
  } catch (e) { toast('Network error'); }
  finally { btn.textContent = 'Add to library'; btn.disabled = false; }
}

// ---------- pickers (logging a cream / medication) ----------
async function openCreamPicker() {
  openSheet('creamPicker');
  await renderPicker('cream', 'creamPickerList', 'logCreamFromLibrary');
}
async function openMedPicker() {
  openSheet('medPicker');
  $('medDose').value = '';
  await renderPicker('medication', 'medPickerList', 'logMedFromLibrary');
}

async function renderPicker(kind, listId, fn) {
  const el = $(listId);
  el.innerHTML = '<p class="meta" style="margin:0;">Loading...</p>';
  try {
    const items = await (await fetch('/api/products?kind=' + kind)).json();
    if (!items.length) {
      el.innerHTML = '<p class="meta" style="margin:0 0 10px;">Nothing in your library yet.</p>' +
        '<button class="ghost" onclick="closeSheet(\'' + (kind === 'cream' ? 'creamPicker' : 'medPicker') + '\');go(\'library\')">Open library to add one</button>';
      return;
    }
    el.innerHTML = '<div class="chiprow">' + items.map((p) =>
      '<button class="sel" onclick="' + fn + '(' + p.id + ',&quot;' + escapeHtml(p.name).replace(/"/g, '&quot;') + '&quot;)">' + escapeHtml(p.name) + '</button>'
    ).join('') + '</div>';
  } catch (e) { el.innerHTML = '<p class="meta" style="margin:0;">Could not load.</p>'; }
}

async function logFromLibrary(type, payload, sheetId, msg) {
  try {
    await fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, payload }) });
    closeSheet(sheetId);
    toast(msg);
    if (typeof loadToday === 'function') loadToday(true);
  } catch (e) { toast('Could not save. Check the server.'); }
}
function logCreamFromLibrary(id, name) {
  logFromLibrary('cream', { productId: id, name }, 'creamPicker', 'Cream logged');
}
function logMedFromLibrary(id, name) {
  logFromLibrary('medication', { productId: id, name, dose: $('medDose').value.trim() }, 'medPicker', 'Medication logged');
}

// ---------- boot ----------
window.addEventListener('DOMContentLoaded', () => {
  const front = $('prodFront'), back = $('prodBack');
  if (front) front.addEventListener('change', () => handleProdFront(front));
  if (back) back.addEventListener('change', () => handleProdBack(back));
  // Reload the list when the Creams / Medications toggle changes.
  document.querySelectorAll('[data-seg="libkind"] button').forEach((b) => b.addEventListener('click', () => {
    if ($('productDetail')) closeProductDetail();
    loadLibrary();
  }));
  loadLibrary();
});
