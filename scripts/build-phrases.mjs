#!/usr/bin/env node
/**
 * Build src/data/phrases.mjs from the Japanese Phrasebook markup
 * (github.com/Lorti/phrasebook, bin/markup/*.txt — data from Wikitravel,
 * CC BY-SA 3.0). Run: node scripts/build-phrases.mjs <markup dir>
 *
 * For each phrase it adds a hiragana/katakana reading and splits it into
 * word tiles with kuromoji, so the app ships a ready deck and never needs a
 * morphological analyser at runtime.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { applyFix } from "./phrase-fixes.mjs";
import { FAMILY_TOPICS } from "./family-phrases.mjs";

const require = createRequire(import.meta.url);
const kuromoji = require("kuromoji");

const dir = process.argv[2];
if (!dir) { console.error("usage: build-phrases.mjs <phrasebook bin/markup dir>"); process.exit(1); }

// File stem → topic. Sub-pages fold into their parent.
const TOPICS = [
  ["basics", "basics"], ["typical-expressions", "expressions"], ["problems", "problems"],
  ["eating", "eating"], ["bars", "bars"], ["shopping", "shopping"], ["transportation", "getting around"],
  ["loding", "lodging"], ["money", "money"], ["phone-calls", "phone"], ["family", "family"],
  ["time", "time"], ["numbers", "numbers"], ["colors", "colors"], ["countries", "countries"],
  ["driving", "driving"], ["authority", "authority"], ["signs", "signs"],
];
// Picker sections, in the order they're shown. Topic ids, not labels; a
// topic in no group is left out of the deck. Card ids are per topic
// (basics-3), so moving a topic between groups never loses progress.
const GROUPS = [
  { label: "visiting family", topics: FAMILY_TOPICS.map((t) => t.id) },
  { label: "everyday", topics: ["basics", "expressions", "eating", "bars", "shopping", "getting-around", "family", "time", "numbers", "phone", "money"] },
  { label: "travel & emergencies", topics: ["problems", "signs", "lodging", "driving", "authority", "countries"] },
];
const SKIP_FILES = /^offensive-language/;

const JA = /[぀-ヿ㐀-鿿]/;
const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const isKata = (s) => /^[゠-ヿ]+$/.test(s);

// Hepburn, enough to cross-check kuromoji's readings against the source romaji.
const KANA = {
  あ:"a",い:"i",う:"u",え:"e",お:"o",か:"ka",き:"ki",く:"ku",け:"ke",こ:"ko",さ:"sa",し:"shi",す:"su",せ:"se",そ:"so",
  た:"ta",ち:"chi",つ:"tsu",て:"te",と:"to",な:"na",に:"ni",ぬ:"nu",ね:"ne",の:"no",は:"ha",ひ:"hi",ふ:"fu",へ:"he",ほ:"ho",
  ま:"ma",み:"mi",む:"mu",め:"me",も:"mo",や:"ya",ゆ:"yu",よ:"yo",ら:"ra",り:"ri",る:"ru",れ:"re",ろ:"ro",わ:"wa",を:"o",ん:"n",
  が:"ga",ぎ:"gi",ぐ:"gu",げ:"ge",ご:"go",ざ:"za",じ:"ji",ず:"zu",ぜ:"ze",ぞ:"zo",だ:"da",ぢ:"ji",づ:"zu",で:"de",ど:"do",
  ば:"ba",び:"bi",ぶ:"bu",べ:"be",ぼ:"bo",ぱ:"pa",ぴ:"pi",ぷ:"pu",ぺ:"pe",ぽ:"po",ゔ:"vu",
  ぁ:"a",ぃ:"i",ぅ:"u",ぇ:"e",ぉ:"o",
};
function romanize(kana, particle = false) {
  const h = toHira(kana);
  if (particle && h === "は") return "wa";
  if (particle && h === "へ") return "e";
  let out = "";
  for (let i = 0; i < h.length; i++) {
    const c = h[i], next = h[i + 1];
    // っ doubles the next consonant, which may be in the next token: mark it, fix on join.
    if (c === "っ") { out += "Q"; continue; }
    if (c === "ー") { out += out.at(-1) || ""; continue; }
    if (next && "ゃゅょ".includes(next) && KANA[c]) {
      const base = KANA[c];
      const y = { ゃ: "a", ゅ: "u", ょ: "o" }[next];
      out += /^(shi|chi|ji)$/.test(base) ? base.slice(0, -1) + y : base.slice(0, -1) + "y" + y;
      i++; continue;
    }
    if (next && "ぁぃぅぇぉ".includes(next) && KANA[c]) { out += KANA[c].slice(0, -1) + KANA[next]; i++; continue; }
    out += KANA[c] ?? c;
  }
  return out;
}
/** Resolve っ markers once a tile's romaji is assembled: Q + te → tte, Q + chi → tchi. */
const geminate = (s) => s.replace(/Q(\s*)([a-z])/g, (_, sp, c) => (c === "c" ? "t" : c) + sp + c).replace(/Q/g, "");
/** Loose form for comparing romanizations: no case, spaces, punctuation or vowel length. */
const loose = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z]/g, "").replace(/sh/g, "sy").replace(/syi/g, "si").replace(/wo/g, "o").replace(/wa/g, "ha").replace(/ou/g, "o").replace(/([aeiou])\1+/g, "$1").replace(/ei/g, "e").replace(/nn/g, "n")
  .replace(/m([bmp])/g, "n$1");

/** One markup line → { en, note, ja, romaji } or null. */
function parse(line) {
  const body = line.replace(/^;\s*/, "").replace(/<br\s*\/?>.*$/i, "").trim();
  // Split on the " : " (or ":") that separates the two sides.
  const m = body.match(/^(.*?)\s*:\s+(.*)$/) || body.match(/^(.*?):(.*)$/);
  if (!m) return null;
  let [left, right] = [m[1].trim(), m[2].trim()];
  let jaSide, enSide;
  if (JA.test(left[0] || "")) [jaSide, enSide] = [left, right];
  else [jaSide, enSide] = [right, left];
  if (!JA.test(jaSide[0] || "")) return null;

  const romajiM = jaSide.match(/''(.+?)''/);
  let ja = jaSide.replace(/\(?''.*$/, "").trim();
  let romaji = romajiM ? romajiM[1].trim() : "";
  let en = enSide.replace(/''/g, "").replace(/^"|"$/g, "").trim();

  if (/[…_／/・]|\.\.\./.test(ja) || /\.\.\.|_|\/|\?\s*$(?<=\s\?)/.test(en) || /^-/.test(romaji) || !en) return null;
  // Optional bits — 日本語が（よく）話せません — keep the shorter, always-correct form.
  ja = ja.replace(/（[^）]*）|\([^)]*\)/g, "").trim();
  romaji = romaji.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  let note = "";
  const nm = en.match(/\s*\(([^)]*)\)\s*/);
  if (nm) { note = nm[1].trim(); en = en.replace(nm[0], " ").trim(); }
  if (!en) [en, note] = [note.replace(/^./, (c) => c.toUpperCase()), ""]; // いただきます is only "(when starting a meal)"
  if (!ja || ja.length > 40) return null;
  return { en, note, ja, romaji };
}

// Words kuromoji reads differently from how the phrasebook (and everyday speech) says them.
const READINGS = {
  日本: "にほん", 日本人: "にほんじん", 日本酒: "にほんしゅ", 鶏肉: "とりにく", 羊肉: "ようにく", 火傷: "やけど",
  良い: "いい", 他: "ほか", 辺: "へん", 一杯: "いっぱい", 三百: "さんびゃく", 六百: "ろっぴゃく", 八百: "はっぴゃく",
};

/** Group kuromoji tokens into word tiles: particles, auxiliaries and suffixes
 *  ride on the word before them; a prefix (お, ご) on the word after. */
function chunk(tokens) {
  const chunks = [];
  let pendingPrefix = null;
  for (const t of tokens) {
    if (t.pos === "記号" || !/[\p{L}\p{N}]/u.test(t.surface_form)) continue;
    const reading = READINGS[t.surface_form] ?? (isKata(t.surface_form) ? t.surface_form
      : JA.test(t.surface_form) ? toHira(t.reading || t.surface_form) : t.surface_form);
    const piece = { text: t.surface_form, kana: reading, romaji: romanize(reading, t.pos === "助詞") };
    if (t.pos === "接頭詞") { pendingPrefix = piece; continue; }
    if (pendingPrefix) {
      piece.text = pendingPrefix.text + piece.text;
      piece.kana = pendingPrefix.kana + piece.kana;
      piece.romaji = pendingPrefix.romaji + piece.romaji;
      pendingPrefix = null;
    }
    // です / だ (and でした, でしょう…) get their own tile, as in most course
    // material: お元気 / ですか, not one block.
    const copula = t.pos === "助動詞" && (t.basic_form === "です" || t.basic_form === "だ");
    const attach = chunks.length > 0 && !copula && (
      t.pos === "助詞" || t.pos === "助動詞" || t.pos_detail_1 === "接尾"
      || (t.pos === "動詞" && t.pos_detail_1 === "非自立" && t.basic_form !== "くださる")
      || (t.pos === "名詞" && t.pos_detail_1 === "数" && /^[0-9０-９]/.test(chunks.at(-1).text)));
    if (attach) {
      const last = chunks.at(-1);
      last.text += piece.text;
      last.kana += piece.kana;
      last.romaji += piece.romaji;
    } else chunks.push(piece);
  }
  if (pendingPrefix) chunks.push(pendingPrefix);
  for (const c of chunks) c.romaji = geminate(c.romaji);
  return chunks;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const tokenizer = await new Promise((ok, no) =>
  kuromoji.builder({ dicPath: join(require.resolve("kuromoji"), "../../dict") }).build((e, t) => (e ? no(e) : ok(t))));

const byTopic = new Map(TOPICS.map(([, label]) => [label, []]));
const seen = new Set();
const dropped = [];
for (const file of readdirSync(dir).sort()) {
  if (!file.endsWith(".txt") || SKIP_FILES.test(file)) continue;
  const stem = file.replace(/\.txt$/, "");
  const topic = TOPICS.find(([k]) => stem === k || stem.startsWith(k + "-"));
  if (!topic) { console.warn("no topic for", file); continue; }
  for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
    if (!line.startsWith(";")) continue;
    const p = parse(line);
    if (!p || seen.has(p.ja)) continue;
    seen.add(p.ja);
    const tiles = chunk(tokenizer.tokenize(p.ja));
    if (!tiles.length || tiles.length > 8) continue;
    const ours = tiles.map((t) => t.romaji).join(" ");
    if (p.romaji && loose(ours) !== loose(p.romaji)) {
      dropped.push(`${p.ja}  ours=${ours}  source=${p.romaji}`);
      continue;
    }
    if (!p.romaji) p.romaji = ours;
    byTopic.get(topic[1]).push({ ...p, tiles });
  }
}

/** @type {Map<string, { id: string, label: string, phrases: object[] }>} */
const built = new Map();
for (const [, label] of TOPICS) {
  const list = byTopic.get(label);
  if (!list.length) continue;
  const id = label.replace(/\s+/g, "-");
  built.set(id, { id, label, phrases: list.map((p, i) => applyFix({
    id: `${id}-${i + 1}`, topic: id, en: p.en, ...(p.note ? { note: p.note } : {}),
    ja: p.ja, romaji: p.romaji,
    kana: p.tiles.map((t) => t.kana).join(""),
    tiles: p.tiles.map((t) => t.kana),
  })) });
}
// Hand-written family phrases: given tiles/romaji win (dialect kuromoji can't
// read); otherwise they're tokenized like the phrasebook.
for (const topic of FAMILY_TOPICS) {
  built.set(topic.id, { id: topic.id, label: topic.label, phrases: topic.phrases.map((p, i) => {
    const auto = p.tiles ? null : chunk(tokenizer.tokenize(p.ja));
    const tiles = p.tiles ?? auto.map((t) => t.kana);
    const phrase = {
      id: `${topic.id}-${i + 1}`, topic: topic.id, en: p.en, ...(p.note ? { note: p.note } : {}),
      ja: p.ja, romaji: p.romaji ?? capitalize(auto.map((t) => t.romaji).join(" ")) + (/[？?]$/.test(p.ja) ? "?" : /！$/.test(p.ja) ? "!" : "."),
      kana: tiles.join(""), tiles,
    };
    // Same cross-check as the phrasebook: the tiles must read as the romaji.
    if (p.romaji && loose(geminate(tiles.map((k) => romanize(k)).join(""))) !== loose(p.romaji)) {
      throw new Error(`${topic.id}-${i + 1} ${p.ja}: tiles ${tiles.join("/")} don't read as "${p.romaji}"`);
    }
    return phrase;
  }) });
}

const topics = [];
const phrases = [];
for (const group of GROUPS) for (const id of group.topics) {
  const t = built.get(id);
  if (!t) throw new Error(`group "${group.label}" names unknown topic ${id}`);
  topics.push({ id, label: t.label, group: group.label, count: t.phrases.length });
  phrases.push(...t.phrases);
}
const grouped = new Set(GROUPS.flatMap((g) => g.topics));
for (const id of built.keys()) if (!grouped.has(id)) console.warn(`topic ${id} is in no group, left out`);

const out = {
  source: "Japanese Phrasebook (github.com/Lorti/phrasebook), from Wikitravel's Japanese phrasebook — CC BY-SA 3.0",
  topics,
  phrases,
};
// A module rather than .json so Node, esbuild (engine.js) and Vite all import it without flags.
writeFileSync(new URL("../src/data/phrases.mjs", import.meta.url),
  "// Generated by scripts/build-phrases.mjs — do not edit by hand.\n"
  + `// ${out.source}\n`
  + "/** @type {{ source: string, topics: { id: string, label: string, group: string, count: number }[], phrases: { id: string, topic: string, en: string, note?: string, ja: string, romaji: string, kana: string, tiles: string[] }[] }} */\n"
  + `export default ${JSON.stringify(out, null, 1)};\n`);
console.log(`${phrases.length} phrases in ${topics.length} topics; dropped ${dropped.length} whose reading didn't match the source:`);
if (process.argv.includes("--verbose")) for (const d of dropped) console.log("  " + d);
