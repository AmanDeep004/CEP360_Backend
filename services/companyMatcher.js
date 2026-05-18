/**
 * companyMatcher.js — Pure-JS 6-step company name matching pipeline.
 *
 * Steps 1–3c → Complete match (auto-accepted, no human review)
 * Steps 4–5  → Partial match  (user approves / rejects)
 *
 * No external dependencies. Zero changes needed to duplicate/approve/reject logic.
 */

// ── Abbreviation expansion map ────────────────────────────────────────────────

const ABBREV_MAP = {
  ltd: "limited",
  pvt: "private",
  corp: "corporation",
  inc: "incorporated",
  llc: "limited liability company",
  llp: "limited liability partnership",
  opc: "one person company",
  mfg: "manufacturing",
  mgmt: "management",
  svcs: "services",
  svc: "service",
  assoc: "associates",
  assocs: "associates",
  grp: "group",
  hldgs: "holdings",
  engg: "engineering",
  mktg: "marketing",
  infra: "infrastructure",
  intl: "international",
  natl: "national",
  soln: "solutions",
  solns: "solutions",
  n: "and",
  // logic is simpler if we expand to and not jusr
};

// Words removed by normalize() — company suffixes with no discriminative value.
const SUFFIX_SET = new Set([
  "limited",
  "ltd",
  "private",
  "pvt",
  "corporation",
  "corp",
  "incorporated",
  "inc",
  "llc",
  "llp",
  "opc",
  "co",
  "company",
  "enterprises",
  "enterprise",
  "solutions",
  "services",
  "technologies",
  "technology",
  "india",
  "group",
  "holdings",
  "global",
  "worldwide",
  "international",
  "industries",
  "industry",
  "systems",
  "system",
  "consulting",
  "consultancy",
  "management",
  "manufacturing",
  "associates",
  "trading",
  "and",
  "the",
  "of",
  "engineering",
  "marketing",
  "infrastructure",
  "national",
]);

const PARTIAL_THRESHOLD = 30; // min hybrid score (0–100) to include as a suggestion

// ── Pre-processing ────────────────────────────────────────────────────────────

/** Split CamelCase: "KestoneGlobal" → "Kestone Global" */
function splitCamelCase(s) {
  return s
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

const _CONNECTOR_RE = /[&+]/g;
const _PUNCT_RE = /[.,\/#!$%^&*+;:{}=\-_`~()\'""\[\]]+/g;

/**
 * normalize — for inverted-index words and TF-IDF vectors.
 * Strips corporate suffixes so only core discriminative words remain.
 *   "Kestone Global Pvt Ltd"       → "kestone global"
 *   "ABP Holdings Private Limited" → "abp"
 *   "H.C.L. Technologies"          → "hcl"
 *   "KestoneGlobal"                → "kestone global"
 */
export function normalize(s) {
  if (!s) return "";
  s = splitCamelCase(String(s));
  s = s.toLowerCase();
  s = s.replace(_PUNCT_RE, " ");
  const words = s.split(/\s+/).filter((w) => w && !SUFFIX_SET.has(w));
  return words.join(" ").trim();
}

/**
 * simplify — for exact lookup (Steps 2 + 3).
 * Keeps ALL words, just strips punctuation and CamelCase.
 *   "A.B.C Corp"           → "abc corp"
 *   "KestoneGlobal"        → "kestone global"
 *   "Kuehne & Nagel (India)" → "kuehne  nagel india"
 */
export function simplify(s) {
  if (!s) return "";
  s = splitCamelCase(String(s));
  s = s.toLowerCase();
  s = s.replace(_PUNCT_RE, " ");
  return s.replace(/\s+/g, " ").trim();
}

/**
 * canonicalize — for abbreviation-equivalence lookup (Step 3c).
 * Expands & / + to "and" then expands ABBREV_MAP.
 *   "ABC Pvt Ltd"     → "abc private limited"
 *   "Kuehne & Nagel"  → "kuehne and nagel"
 *   "XYZ Engg Pvt Ltd"→ "xyz engineering private limited"
 */
export function canonicalize(s) {
  if (!s) return "";
  s = splitCamelCase(String(s));
  s = s.replace(_CONNECTOR_RE, " and ");
  s = s.toLowerCase();
  s = s.replace(_PUNCT_RE, " ");
  const words = s
    .split(/\s+/)
    .filter((w) => w)
    .map((w) => ABBREV_MAP[w] || w);
  return words.join(" ").replace(/\s+/g, " ").trim();
}

// ── TF-IDF ────────────────────────────────────────────────────────────────────

/** Build IDF map: word → log(N/df) + 1 (smoothed) */
function buildIdfMap(allNorms) {
  const df = new Map();
  for (const norm of allNorms) {
    for (const w of new Set(norm.split(/\s+/).filter((w) => w))) {
      df.set(w, (df.get(w) || 0) + 1);
    }
  }
  const N = allNorms.length || 1;
  const idf = new Map();
  for (const [w, freq] of df) idf.set(w, Math.log(N / freq) + 1);
  return idf;
}

/** Build a unit-norm TF-IDF sparse vector (plain object). Returns null if no tokens. */
function buildTfVec(norm, idfMap) {
  const words = norm.split(/\s+/).filter((w) => w);
  if (!words.length) return null;
  const tf = {};
  for (const w of words) tf[w] = (tf[w] || 0) + 1;
  const vec = {};
  let mag2 = 0;
  for (const [w, cnt] of Object.entries(tf)) {
    const val = (cnt / words.length) * (idfMap.get(w) || 1);
    vec[w] = val;
    mag2 += val * val;
  }
  const mag = Math.sqrt(mag2);
  if (mag > 0) for (const w in vec) vec[w] /= mag;
  return vec;
}

/** Cosine similarity of two pre-normalised unit vectors. */
function cosineSim(a, b) {
  let dot = 0;
  // iterate the smaller side for speed
  const [small, big] =
    Object.keys(a).length <= Object.keys(b).length ? [a, b] : [b, a];
  for (const w in small) if (big[w]) dot += small[w] * big[w];
  return dot;
}

// ── Bigram (Dice) similarity ───────────────────────────────────────────────────

function bigramSet(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/** Dice coefficient on character bigrams — handles single-character typos. */
function bigramSim(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ag = bigramSet(a);
  const bg = bigramSet(b);
  let inter = 0;
  for (const g of ag) if (bg.has(g)) inter++;
  return (2 * inter) / (ag.size + bg.size);
}

// ── Hybrid scorer (Steps 5a + 5b) ────────────────────────────────────────────

/**
 * final_score = max(TF-IDF cosine × 100, F1-bigram × 100)
 *
 * F1-bigram: harmonic mean of recall and precision on per-word bigram similarity.
 *   recall    = avg over input words  of (best bigram-sim against any candidate word)
 *   precision = avg over candidate words of (best bigram-sim against any input word)
 *
 * Pure recall would give "assam" vs "assam rifles" a score of 100 because the
 * single input word "assam" perfectly matches — precision brings it down to ~67
 * because "rifles" has no match in the input.
 */
function hybridScore(inputNorm, candNorm, inputVec, candVec) {
  const cosScore = inputVec && candVec ? cosineSim(inputVec, candVec) * 100 : 0;

  const aWords = inputNorm.split(/\s+/).filter((w) => w);
  const bWords = candNorm.split(/\s+/).filter((w) => w);
  if (!aWords.length) return cosScore;

  // Recall: how well input words are covered by candidate words
  let totalRecall = 0;
  for (const aw of aWords) {
    let best = 0;
    for (const bw of bWords) {
      const s = bigramSim(aw, bw);
      if (s > best) best = s;
    }
    totalRecall += best;
  }
  const recall = totalRecall / aWords.length;

  // Precision: how well candidate words are covered by input words
  let totalPrecision = 0;
  for (const bw of bWords) {
    let best = 0;
    for (const aw of aWords) {
      const s = bigramSim(bw, aw);
      if (s > best) best = s;
    }
    totalPrecision += best;
  }
  const precision = totalPrecision / bWords.length;

  // F1: harmonic mean of recall and precision
  const f1Score =
    recall + precision > 0
      ? ((2 * recall * precision) / (recall + precision)) * 100
      : 0;

  return Math.max(cosScore, f1Score);
}

// ── DB index builder ──────────────────────────────────────────────────────────

/**
 * Build all lookup maps from the full company collection.
 * Should be called once and cached (the caller owns the 30-min TTL).
 *
 * @param  {Array<{_id, Company_Name}>} companies
 * @returns {object} dbIndex — consumed by matchOne() / matchBatch()
 */
export function buildDbIndex(companies) {
  const exactMap = new Map(); // raw.lower()                 → meta
  const simpMap = new Map(); // simplify(name)              → meta
  const spaceMap = new Map(); // simplify(name).replace(/ /, "") → meta
  const canonMap = new Map(); // canonicalize(name)          → meta
  const invertedIndex = new Map(); // word → Set<normString>
  const normToMeta = new Map(); // normString → { _id, Company_Name, norm, canon }

  for (const c of companies) {
    const name = (c.Company_Name || "").trim();
    if (!name) continue;

    const meta = { _id: c._id, Company_Name: name };

    // Step 1 — raw exact map
    const raw = name.toLowerCase();
    if (!exactMap.has(raw)) exactMap.set(raw, meta);

    // Steps 2+3 — simplified map
    const simp = simplify(name);
    if (simp && !simpMap.has(simp)) simpMap.set(simp, meta);

    // Step 3b — space-stripped map
    const spaceKey = simp.replace(/ /g, "");
    if (spaceKey && !spaceMap.has(spaceKey)) spaceMap.set(spaceKey, meta);

    // Step 3c — canonical map
    const canon = canonicalize(name);
    if (canon && !canonMap.has(canon)) canonMap.set(canon, meta);

    // Steps 4+5 — inverted index + normToMeta
    const norm = normalize(name);
    if (!norm) continue;
    if (!normToMeta.has(norm)) {
      normToMeta.set(norm, { ...meta, norm, canon });
    }
    for (const w of norm.split(/\s+/).filter((w) => w.length > 1)) {
      if (!invertedIndex.has(w)) invertedIndex.set(w, new Set());
      invertedIndex.get(w).add(norm);
    }
  }

  // TF-IDF — second pass (needs full corpus for IDF)
  const allNorms = Array.from(normToMeta.keys());
  const idfMap = buildIdfMap(allNorms);
  const tfVecMap = new Map(); // normString → unit TF-IDF vector
  for (const norm of allNorms) {
    const vec = buildTfVec(norm, idfMap);
    if (vec) tfVecMap.set(norm, vec);
  }

  return {
    exactMap,
    simpMap,
    spaceMap,
    canonMap,
    invertedIndex,
    normToMeta,
    idfMap,
    tfVecMap,
  };
}

// ── Single-company matcher ────────────────────────────────────────────────────

/**
 * Run the 6-step pipeline for one input company name.
 *
 * Returns one of:
 *   { type: "complete", match: { _id, Company_Name } }
 *   { type: "partial",  suggestions: [{ _id, Company_Name, matchPercent, matchedWith }] }
 *   { type: "none" }
 */
function matchOne(inputName, dbIndex, maxCandidates) {
  const {
    exactMap,
    simpMap,
    spaceMap,
    canonMap,
    invertedIndex,
    normToMeta,
    idfMap,
    tfVecMap,
  } = dbIndex;

  // ── Step 1: raw case-insensitive exact ────────────────────────────────────
  const raw = inputName.toLowerCase();
  if (exactMap.has(raw)) return { type: "complete", match: exactMap.get(raw) };

  // ── Steps 2+3: CamelCase-split + punctuation-stripped exact ──────────────
  const simp = simplify(inputName);
  if (simp !== raw) {
    if (exactMap.has(simp))
      return { type: "complete", match: exactMap.get(simp) };
  }
  if (simpMap.has(simp)) return { type: "complete", match: simpMap.get(simp) };

  // ── Step 3b: space-stripped exact ─────────────────────────────────────────
  const spaceKey = simp.replace(/ /g, "");
  if (spaceMap.has(spaceKey))
    return { type: "complete", match: spaceMap.get(spaceKey) };

  // ── Step 3c: canonical abbreviation exact ─────────────────────────────────
  const canon = canonicalize(inputName);
  if (canonMap.has(canon))
    return { type: "complete", match: canonMap.get(canon) };

  // ── Steps 4+5: inverted-index candidates → hybrid TF-IDF + bigram scoring ─
  const norm = normalize(inputName);
  if (!norm) return { type: "none" };

  const inputWords = norm.split(/\s+/).filter((w) => w.length > 1);
  // Rarest words first — stops common words from filling the candidate cap
  inputWords.sort(
    (a, b) =>
      (invertedIndex.get(a)?.size || 0) - (invertedIndex.get(b)?.size || 0)
  );

  const candidates = new Set();
  outer: for (const w of inputWords) {
    for (const cn of invertedIndex.get(w) || []) {
      candidates.add(cn);
      if (candidates.size >= maxCandidates) break outer;
    }
  }
  if (!candidates.size) return { type: "none" };

  const inputVec = buildTfVec(norm, idfMap);
  const scored = [];

  for (const candNorm of candidates) {
    const meta = normToMeta.get(candNorm);
    if (!meta) continue;
    const score = hybridScore(norm, candNorm, inputVec, tfVecMap.get(candNorm));
    if (score >= PARTIAL_THRESHOLD) scored.push({ meta, candNorm, score });
  }

  if (!scored.length) return { type: "none" };
  scored.sort((a, b) => b.score - a.score);

  // Fuzzy safety check: upgrade best to complete if norm AND canon both identical
  const best = scored[0];
  if (best.candNorm === norm && best.meta.canon === canon) {
    return { type: "complete", match: best.meta };
  }

  return {
    type: "partial",
    suggestions: scored.map((s) => ({
      _id: s.meta._id,
      Company_Name: s.meta.Company_Name,
      matchPercent: Math.min(99, Math.round(s.score)),
      matchedWith: inputName,
    })),
  };
}

// ── Batch matcher ─────────────────────────────────────────────────────────────

/**
 * Match a batch of rows against the DB index.
 * Returns { completelyMatched, partiallyMatched, notMatched } in the exact same
 * shape the controller already uses — no changes to callers needed.
 *
 * @param {Array<{name, companySpecificId?, segment?}>} rows
 * @param {object}   dbIndex           built by buildDbIndex()
 * @param {Function} getSuggestionsLimit  (totalRows) → maxSuggestions
 * @param {number}   maxCandidates     default 300
 */
export function matchBatch(
  rows,
  dbIndex,
  getSuggestionsLimit,
  maxCandidates = 300
) {
  // Use a Map to track the first uploaded name that completely matched each DB company.
  // If a second (different) uploaded name matches the same DB company, it is placed in
  // sameCompanyDuplicates so the total row count stays consistent with the upload.
  const completeMap = new Map(); // _id (string) → entry
  const partiallyMatched = [];
  const notMatched = [];
  const sameCompanyDuplicates = []; // names that map to an already-matched DB company

  for (const { name, companySpecificId, segment } of rows) {
    const result = matchOne(name, dbIndex, maxCandidates);

    if (result.type === "complete") {
      const id = String(result.match._id);
      if (completeMap.has(id)) {
        // Second uploaded name matches the same DB company — treat as duplicate
        sameCompanyDuplicates.push(name);
      } else {
        completeMap.set(id, {
          _id: result.match._id,
          Company_Name: result.match.Company_Name,
          matchedWith: name,
          ...(companySpecificId ? { companySpecificId } : {}),
          ...(segment ? { segment } : {}),
        });
      }
    } else if (result.type === "partial") {
      partiallyMatched.push({
        input: name,
        suggestions: result.suggestions.slice(
          0,
          getSuggestionsLimit(rows.length)
        ),
        ...(companySpecificId ? { companySpecificId } : {}),
        ...(segment ? { segment } : {}),
      });
    } else {
      notMatched.push(name);
    }
  }

  return {
    completelyMatched: [...completeMap.values()],
    partiallyMatched,
    notMatched,
    sameCompanyDuplicates, // caller merges these into the main duplicates array
  };
}
