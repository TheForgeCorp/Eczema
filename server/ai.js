// Anthropic vision + reasoning for the meal analyzer and skin severity scorer.
// Uses the owner's own API key (from .env) and structured outputs so each call
// returns guaranteed-parseable JSON. The app runs without a key; these throw a
// NO_KEY error that the routes surface as "analyzer not configured".

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const ALLERGENS = ['dairy', 'egg', 'gluten', 'nuts', 'soy', 'shellfish', 'histamine', 'alcohol'];

let client = null;
function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}
function getClient() {
  if (!isConfigured()) {
    const e = new Error('Anthropic API key not set');
    e.code = 'NO_KEY';
    throw e;
  }
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  return client;
}

// Pull the first text block out of a response (works whether or not thinking is on).
function jsonFromResponse(res) {
  if (res.stop_reason === 'refusal') {
    const e = new Error('The model declined to analyze this image');
    e.code = 'REFUSAL';
    throw e;
  }
  const block = res.content.find((b) => b.type === 'text');
  if (!block) {
    const e = new Error('No analysis returned');
    e.code = 'EMPTY';
    throw e;
  }
  return JSON.parse(block.text);
}

const clamp10 = (n) => Math.max(0, Math.min(10, Math.round(Number(n) || 0)));

// ---------- meal analyzer ----------
const MEAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dish: { type: 'string', description: 'Best guess at the dish name, concise.' },
    caloriesLow: { type: 'integer', description: 'Low end of a rough calorie estimate for the portion shown.' },
    caloriesHigh: { type: 'integer', description: 'High end of the rough calorie estimate.' },
    allergens: {
      type: 'object',
      additionalProperties: false,
      description: 'Likelihood each allergen or trigger is present.',
      properties: Object.fromEntries(ALLERGENS.map((a) => [a, {
        type: 'string', enum: ['likely', 'possible', 'unlikely']
      }])),
      required: ALLERGENS
    },
    ingredients: { type: 'array', items: { type: 'string' }, description: 'Visible or strongly implied ingredients.' },
    caveat: { type: 'string', description: 'One or two sentences on hidden ingredients and what drives the flags.' }
  },
  required: ['dish', 'caloriesLow', 'caloriesHigh', 'allergens', 'ingredients', 'caveat']
};

const MEAL_SYSTEM = [
  'You analyze a meal for someone tracking eczema triggers. The input may be a photo, a text',
  'description, or both. Identify the dish, give a rough calorie range for the portion, and rate the',
  'likelihood of each allergen or trigger: dairy, egg, gluten, nuts, soy, shellfish, high-histamine,',
  'and alcohol. Rate each as likely, possible, or unlikely. List the ingredients (visible or implied)',
  'and add a short caveat about hidden ingredients (sauces, oils, cross-contamination). If the person',
  'provides a text description, trust it over the image for anything it states. If there is no photo,',
  'work entirely from the description and reason about typical preparations. Do not use em dashes.',
  'This is not medical advice.'
].join(' ');

async function analyzeMeal({ imageBase64, mediaType, description }) {
  const c = getClient();
  const desc = description && description.trim();
  const content = [];
  if (imageBase64) content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } });
  const text = imageBase64
    ? (desc ? `My description of the meal: ${desc}` : 'No description provided. Judge from the photo.')
    : `There is no photo. Analyze this meal from my description alone: ${desc}`;
  content.push({ type: 'text', text });
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: MEAL_SYSTEM,
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema: MEAL_SCHEMA } }
  });
  const data = jsonFromResponse(res);
  // Normalize allergens to the known keys/values.
  const allergens = {};
  for (const a of ALLERGENS) {
    allergens[a] = ['likely', 'possible', 'unlikely'].includes(data.allergens?.[a]) ? data.allergens[a] : 'unlikely';
  }
  return {
    dish: String(data.dish || 'Meal'),
    caloriesLow: Math.max(0, Math.round(Number(data.caloriesLow) || 0)),
    caloriesHigh: Math.max(0, Math.round(Number(data.caloriesHigh) || 0)),
    allergens,
    ingredients: Array.isArray(data.ingredients) ? data.ingredients.map(String).slice(0, 20) : [],
    caveat: String(data.caveat || '')
  };
}

// ---------- skin severity ----------
const SKIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    overall: { type: 'integer', description: 'Overall eczema severity 0 (clear) to 10 (severe).' },
    redness: { type: 'integer', description: 'Redness / erythema 0 to 10.' },
    scaling: { type: 'integer', description: 'Scaling / dryness / flaking 0 to 10.' },
    area: { type: 'integer', description: 'Extent of affected area in view 0 to 10.' },
    note: { type: 'string', description: 'One short sentence on what stands out.' }
  },
  required: ['overall', 'redness', 'scaling', 'area', 'note']
};

const SKIN_SYSTEM = [
  'You grade a close-up photo of eczema-affected skin for someone tracking severity over time.',
  'Score overall severity and the components redness, scaling, and affected area, each 0 to 10,',
  'where 0 is clear and 10 is severe. Be consistent so scores are comparable across photos.',
  'Add one short note on what stands out. Do not use em dashes. This is not a diagnosis.'
].join(' ');

async function analyzeSkin({ imageBase64, mediaType }) {
  const c = getClient();
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SKIN_SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: 'Grade this skin photo.' }
      ]
    }],
    output_config: { format: { type: 'json_schema', schema: SKIN_SCHEMA } }
  });
  const data = jsonFromResponse(res);
  return {
    overall: clamp10(data.overall),
    redness: clamp10(data.redness),
    scaling: clamp10(data.scaling),
    area: clamp10(data.area),
    note: String(data.note || '')
  };
}

// ---------- product label extraction ----------
const CREAM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    activeIngredients: { type: 'array', items: { type: 'string' }, description: 'Active ingredients listed on the label.' },
    keyIngredients: { type: 'array', items: { type: 'string' }, description: 'Other notable ingredients (humectants, occlusives, fragrance, etc.).' },
    purpose: { type: 'string', description: 'What the product is for.' },
    efficacy: { type: 'string', description: 'Efficacy for atopic dermatitis, grounded in dermatology research and reported results.' },
    sideEffects: { type: 'array', items: { type: 'string' }, description: 'Common or notable side effects / irritation risks.' },
    fragranceFree: { type: 'string', enum: ['yes', 'no', 'unclear'], description: 'Whether the product is fragrance free.' },
    eczemaRelevance: { type: 'string', description: 'How this helps or could aggravate eczema specifically.' },
    caveat: { type: 'string', description: 'Anything uncertain from the label photos.' }
  },
  required: ['activeIngredients', 'keyIngredients', 'purpose', 'efficacy', 'sideEffects', 'fragranceFree', 'eczemaRelevance', 'caveat']
};

const MED_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    activeIngredient: { type: 'string', description: 'Primary active ingredient.' },
    drugClass: { type: 'string', description: 'Drug class (e.g. antihistamine, JAK inhibitor).' },
    purpose: { type: 'string', description: 'What it treats.' },
    efficacy: { type: 'string', description: 'Efficacy for eczema / itch management, grounded in research and reported results.' },
    sideEffects: { type: 'array', items: { type: 'string' }, description: 'Common or notable side effects.' },
    sedating: { type: 'string', enum: ['yes', 'no', 'unclear'], description: 'Whether it commonly causes drowsiness.' },
    typicalDose: { type: 'string', description: 'Typical dose from the label or general use.' },
    caveat: { type: 'string', description: 'Anything uncertain from the label photos.' }
  },
  required: ['activeIngredient', 'drugClass', 'purpose', 'efficacy', 'sideEffects', 'sedating', 'typicalDose', 'caveat']
};

function productSystem(kind) {
  if (kind === 'medication') {
    return [
      'You read photos of a medication package (front and back labels) for someone managing eczema.',
      'Identify the active ingredient and drug class, what it treats, its efficacy for eczema or itch',
      'management grounded in research and reported results, common side effects, whether it is sedating,',
      'and the typical dose. State research-backed facts plainly. Informational, not a prescription. No em dashes.'
    ].join(' ');
  }
  return [
    'You read photos of a skincare product (front and back labels) for someone managing eczema.',
    'Identify active and key ingredients from the label, the purpose, efficacy for atopic dermatitis',
    'grounded in dermatology research and reported results, common side effects or irritation risks,',
    'and whether it is fragrance free. Note how it helps or could aggravate eczema. State research-backed',
    'facts plainly. Informational, not a prescription. No em dashes.'
  ].join(' ');
}

async function extractProduct({ frontBase64, backBase64, mediaType, kind, name }) {
  const c = getClient();
  const content = [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: frontBase64 } }];
  if (backBase64) content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: backBase64 } });
  content.push({ type: 'text', text: (name ? `Product name: ${name}. ` : '') + 'First image is the front label' + (backBase64 ? ', second is the back label.' : '.') });
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: productSystem(kind),
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema: kind === 'medication' ? MED_SCHEMA : CREAM_SCHEMA } }
  });
  return jsonFromResponse(res);
}

// ---------- pattern analysis ----------
const PATTERNS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: 'Two to three sentences on the overall trajectory and the strongest driver.' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          factor: { type: 'string', description: 'The food, medication, cream, or condition.' },
          direction: { type: 'string', enum: ['aggravates', 'improves', 'unclear'], description: 'Effect on the eczema.' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Evidence strength given the data.' },
          evidence: { type: 'string', description: 'What in the tracked data supports this, with dates where possible.' },
          basis: { type: 'string', description: 'The dermatology research or reported results this is grounded in.' },
          test: { type: 'string', description: 'A concrete way to confirm it.' }
        },
        required: ['factor', 'direction', 'confidence', 'evidence', 'basis', 'test']
      }
    },
    clinicianNote: { type: 'string', description: 'What to raise with the dermatologist, especially any treatment changes.' }
  },
  required: ['summary', 'findings', 'clinicianNote']
};

const PATTERNS_SYSTEM = [
  'You are an analyst with dermatology and atopic dermatitis expertise reviewing one person\'s self-tracked',
  'eczema data: itch scores, felt inflammation by body area, skin severity, meals with allergen flags,',
  'medications (including Rinvoq / upadacitinib and any antihistamines), cream and emollient applications,',
  'and sleep, stress, and overheating notes. The person reports inflammation feeling as a separate signal',
  'from itch and finds it varies by area, so weigh it as its own indicator. Find what drives this person\'s',
  'flares and what controls them. You may draw conclusions, not only',
  'hypotheses, where the data and established research support them. Account for a 1 to 3 day trigger lag',
  'between food and skin response. Surface aggravating factors, what makes it worse, as well as protective',
  'ones. Ground every finding in reported results and atopic dermatitis research, and rate the evidence',
  'strength honestly given the sample size. Call out confounds. Give a concrete way to confirm each finding.',
  'Treatment changes such as dose or new drugs are for the dermatologist; put those in clinicianNote.',
  'Order findings strongest first. Do not use em dashes.'
].join(' ');

async function analyzePatterns(summaryText) {
  const c = getClient();
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: PATTERNS_SYSTEM,
    messages: [{ role: 'user', content: summaryText }],
    output_config: { format: { type: 'json_schema', schema: PATTERNS_SCHEMA } }
  });
  return jsonFromResponse(res);
}

module.exports = { isConfigured, analyzeMeal, analyzeSkin, extractProduct, analyzePatterns, ALLERGENS };
