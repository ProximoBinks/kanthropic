/**
 * Minimal-diff, JSONC-tolerant editing of a top-level object's keys.
 *
 * `~/.claude/settings.json` may contain comments and the user's own keys in a
 * meaningful order. We mutate RAW TEXT — never re-serialize — so comments,
 * whitespace, and key order survive. A tiny state machine walks the bytes
 * tracking string / line-comment / block-comment context.
 *
 * This is an independent implementation of the well-known "raw-text minimal
 * edit" technique. (Kickbacks ships a proprietary version; none of its code is
 * used here.)
 *
 * @typedef {"code" | "str" | "line" | "block"} Ctx
 */

/** Strip JSONC comments + a single trailing comma so JSON.parse can validate.
 *  Used ONLY for parse/idempotency checks, never for emitted text.
 *  @param {string} src @returns {string} */
function stripJsonc(src) {
  let out = "";
  /** @type {Ctx} */ let ctx = "code";
  let i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (ctx === "code") {
      if (c === '"') { ctx = "str"; out += c; i++; continue; }
      if (c === "/" && n === "/") { ctx = "line"; i += 2; continue; }
      if (c === "/" && n === "*") { ctx = "block"; i += 2; continue; }
      out += c; i++; continue;
    }
    if (ctx === "str") {
      out += c;
      if (c === "\\") { out += src[i + 1] ?? ""; i += 2; continue; }
      if (c === '"') ctx = "code";
      i++; continue;
    }
    if (ctx === "line") { if (c === "\n") { ctx = "code"; out += c; } i++; continue; }
    // block
    if (c === "*" && n === "/") { ctx = "code"; i += 2; continue; }
    i++;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/** @param {string} src @returns {boolean} */
export function parseable(src) {
  try { JSON.parse(stripJsonc(src)); return true; } catch { return false; }
}

/** Find the [start, end) raw-text span of the VALUE of a top-level `key`, or
 *  null if absent. Comment/string aware; only depth-1 keys match. Throws if
 *  the text is not parseable JSONC.
 *  @param {string} src @param {string} key @returns {[number, number] | null} */
function findTopLevelValueSpan(src, key) {
  if (!parseable(src)) throw new Error("settings.json not parseable");
  /** @type {Ctx} */ let ctx = "code";
  let depth = 0, i = 0;
  /** @type {string | null} */ let pendingKey = null;
  let keyStart = -1;

  /** @param {number} j @returns {number} */
  const skipWs = (j) => {
    /** @type {Ctx} */ let c2 = "code";
    while (j < src.length) {
      const c = src[j], n = src[j + 1];
      if (c2 === "code") {
        if (c === "/" && n === "/") { c2 = "line"; j += 2; continue; }
        if (c === "/" && n === "*") { c2 = "block"; j += 2; continue; }
        if (/\s/.test(c) || c === ":") { j++; continue; }
        return j;
      }
      if (c2 === "line") { if (c === "\n") c2 = "code"; j++; continue; }
      if (c === "*" && n === "/") { c2 = "code"; j += 2; continue; }
      j++;
    }
    return j;
  };

  /** @param {number} j @returns {number} */
  const valueEnd = (j) => {
    /** @type {Ctx} */ let c2 = "code";
    let d = 0;
    for (; j < src.length; j++) {
      const c = src[j], n = src[j + 1];
      if (c2 === "str") {
        if (c === "\\") { j++; continue; }
        if (c === '"') c2 = "code";
        continue;
      }
      if (c2 === "line") { if (c === "\n") c2 = "code"; continue; }
      if (c2 === "block") { if (c === "*" && n === "/") { c2 = "code"; j++; } continue; }
      if (c === '"') { c2 = "str"; continue; }
      if (c === "/" && n === "/") { c2 = "line"; j++; continue; }
      if (c === "/" && n === "*") { c2 = "block"; j++; continue; }
      if (c === "{" || c === "[") d++;
      else if (c === "}" || c === "]") {
        if (d === 0) return j;       // hit the PARENT's close → primitive value ended
        d--;
        if (d === 0) return j + 1;   // closed the value's OWN structure → end right after it
      }
      else if (c === "," && d === 0) return j;
    }
    return j;
  };

  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (ctx === "str") {
      if (c === "\\") { i += 2; continue; }
      if (c === '"') {
        ctx = "code";
        if (depth === 1) pendingKey = src.slice(keyStart + 1, i);
      }
      i++; continue;
    }
    if (ctx === "line") { if (c === "\n") ctx = "code"; i++; continue; }
    if (ctx === "block") { if (c === "*" && n === "/") { ctx = "code"; i += 2; continue; } i++; continue; }
    if (c === "/" && n === "/") { ctx = "line"; i += 2; continue; }
    if (c === "/" && n === "*") { ctx = "block"; i += 2; continue; }
    if (c === '"') { ctx = "str"; keyStart = i; i++; continue; }
    if (c === "{" || c === "[") { depth++; i++; continue; }
    if (c === "}" || c === "]") { depth--; i++; continue; }
    if (c === ":" && depth === 1 && pendingKey === key) {
      const vs = skipWs(i + 1);
      return [vs, valueEnd(vs)];
    }
    if (c === ",") pendingKey = null;
    i++;
  }
  return null;
}

/** Parse and return the VALUE of a top-level `key`, or undefined when absent or
 *  the text isn't parseable. Read-only.
 *  @param {string} src @param {string} key @returns {unknown} */
export function readTopLevel(src, key) {
  try {
    const span = findTopLevelValueSpan(src, key);
    if (!span) return undefined;
    return JSON.parse(stripJsonc(src.slice(span[0], span[1])));
  } catch { return undefined; }
}

/** Return the RAW TEXT of a top-level key's value (whitespace/formatting
 *  preserved), or undefined when absent/unparseable. Used to capture a
 *  pre-existing statusLine so uninstall can restore it byte-for-byte.
 *  @param {string} src @param {string} key @returns {string | undefined} */
export function readTopLevelRaw(src, key) {
  try {
    const span = findTopLevelValueSpan(src, key);
    return span ? src.slice(span[0], span[1]) : undefined;
  } catch { return undefined; }
}

/** Set top-level `key` to `valueJson` (a JSON value string), editing only that
 *  span. Inserts after the root `{` when absent. Idempotent. Throws if `src`
 *  is not parseable JSONC.
 *  @param {string} src @param {string} key @param {string} valueJson @returns {string} */
export function upsertTopLevel(src, key, valueJson) {
  const span = findTopLevelValueSpan(src, key);
  if (span) return src.slice(0, span[0]) + valueJson + src.slice(span[1]);
  const brace = src.indexOf("{");
  if (brace < 0) throw new Error("settings.json not parseable");
  const after = src.slice(brace + 1);
  const hasKeys = parseable(src) && /\S/.test(stripJsonc(after).replace(/[}\s]/g, ""));
  const insert = `\n  ${JSON.stringify(key)}: ${valueJson}${hasKeys ? "," : ""}`;
  return src.slice(0, brace + 1) + insert + after;
}

/** Remove a top-level key (and a balancing comma) from JSONC text. Idempotent;
 *  comment/string aware; preserves the user's other keys + comments.
 *  @param {string} src @param {string} key @returns {string} */
export function removeTopLevel(src, key) {
  /** @type {[number, number] | null} */ let span;
  try { span = findTopLevelValueSpan(src, key); }
  catch { return src; }
  if (!span) return src;

  let s = span[0];
  while (s > 0 && /\s/.test(src[s - 1])) s--;
  if (s > 0 && src[s - 1] === ":") s--;
  while (s > 0 && /\s/.test(src[s - 1])) s--;
  if (s > 0 && src[s - 1] === '"') {
    let q = s - 2;
    while (q > 0) { if (src[q] === '"' && src[q - 1] !== "\\") break; q--; }
    s = q;
  }

  let e2 = span[1];
  let trailingComma = false;
  let j = e2;
  while (j < src.length && /\s/.test(src[j])) j++;
  if (src[j] === ",") { e2 = j + 1; trailingComma = true; }
  if (trailingComma) {
    while (s > 0 && /\s/.test(src[s - 1])) s--;
  } else {
    let k = s;
    while (k > 0 && /\s/.test(src[k - 1])) k--;
    if (k > 0 && src[k - 1] === ",") s = k - 1;
  }
  return src.slice(0, s) + src.slice(e2);
}
