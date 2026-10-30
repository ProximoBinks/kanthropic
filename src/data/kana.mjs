/**
 * Kana dataset — the single source of truth for kanthropic.
 *
 * Ported verbatim from the author's hypertools kana trainer (`convex/kanaData.ts`).
 * Pure data + pure functions, no runtime deps, so both the ambient status-line
 * tick and the typed drill import the exact same tables and answer-checking.
 *
 * @typedef {"hiragana" | "katakana"} Script
 * @typedef {"gojuon" | "dakuten" | "yoon"} KanaGroup
 * @typedef {{ hira: string, kata: string, romaji: string, alt?: string[] }} KanaEntry
 */

/** @param {string} hira @param {string} kata @param {string} romaji @param {...string} alt @returns {KanaEntry} */
function e(hira, kata, romaji, ...alt) {
  return alt.length ? { hira, kata, romaji, alt } : { hira, kata, romaji };
}

// ── Gojūon (base 46) ──────────────────────────────────────────────────────
export const GOJUON_ROWS = [
  [e("あ", "ア", "a"), e("い", "イ", "i"), e("う", "ウ", "u"), e("え", "エ", "e"), e("お", "オ", "o")],
  [e("か", "カ", "ka"), e("き", "キ", "ki"), e("く", "ク", "ku"), e("け", "ケ", "ke"), e("こ", "コ", "ko")],
  [e("さ", "サ", "sa"), e("し", "シ", "shi", "si"), e("す", "ス", "su"), e("せ", "セ", "se"), e("そ", "ソ", "so")],
  [e("た", "タ", "ta"), e("ち", "チ", "chi", "ti"), e("つ", "ツ", "tsu", "tu"), e("て", "テ", "te"), e("と", "ト", "to")],
  [e("な", "ナ", "na"), e("に", "ニ", "ni"), e("ぬ", "ヌ", "nu"), e("ね", "ネ", "ne"), e("の", "ノ", "no")],
  [e("は", "ハ", "ha"), e("ひ", "ヒ", "hi"), e("ふ", "フ", "fu", "hu"), e("へ", "ヘ", "he"), e("ほ", "ホ", "ho")],
  [e("ま", "マ", "ma"), e("み", "ミ", "mi"), e("む", "ム", "mu"), e("め", "メ", "me"), e("も", "モ", "mo")],
  [e("や", "ヤ", "ya"), null, e("ゆ", "ユ", "yu"), null, e("よ", "ヨ", "yo")],
  [e("ら", "ラ", "ra"), e("り", "リ", "ri"), e("る", "ル", "ru"), e("れ", "レ", "re"), e("ろ", "ロ", "ro")],
  [e("わ", "ワ", "wa"), null, null, null, e("を", "ヲ", "wo", "o")],
  [e("ん", "ン", "n", "nn")],
];

// ── Dakuten / handakuten (25) ─────────────────────────────────────────────
export const DAKUTEN_ROWS = [
  [e("が", "ガ", "ga"), e("ぎ", "ギ", "gi"), e("ぐ", "グ", "gu"), e("げ", "ゲ", "ge"), e("ご", "ゴ", "go")],
  [e("ざ", "ザ", "za"), e("じ", "ジ", "ji", "zi"), e("ず", "ズ", "zu"), e("ぜ", "ゼ", "ze"), e("ぞ", "ゾ", "zo")],
  [e("だ", "ダ", "da"), e("ぢ", "ヂ", "ji", "di", "dji"), e("づ", "ヅ", "zu", "du", "dzu"), e("で", "デ", "de"), e("ど", "ド", "do")],
  [e("ば", "バ", "ba"), e("び", "ビ", "bi"), e("ぶ", "ブ", "bu"), e("べ", "ベ", "be"), e("ぼ", "ボ", "bo")],
  [e("ぱ", "パ", "pa"), e("ぴ", "ピ", "pi"), e("ぷ", "プ", "pu"), e("ぺ", "ペ", "pe"), e("ぽ", "ポ", "po")],
];

// ── Yōon combos (33) ──────────────────────────────────────────────────────
export const YOON_ROWS = [
  [e("きゃ", "キャ", "kya"), e("きゅ", "キュ", "kyu"), e("きょ", "キョ", "kyo")],
  [e("しゃ", "シャ", "sha", "sya"), e("しゅ", "シュ", "shu", "syu"), e("しょ", "ショ", "sho", "syo")],
  [e("ちゃ", "チャ", "cha", "tya", "cya"), e("ちゅ", "チュ", "chu", "tyu", "cyu"), e("ちょ", "チョ", "cho", "tyo", "cyo")],
  [e("にゃ", "ニャ", "nya"), e("にゅ", "ニュ", "nyu"), e("にょ", "ニョ", "nyo")],
  [e("ひゃ", "ヒャ", "hya"), e("ひゅ", "ヒュ", "hyu"), e("ひょ", "ヒョ", "hyo")],
  [e("みゃ", "ミャ", "mya"), e("みゅ", "ミュ", "myu"), e("みょ", "ミョ", "myo")],
  [e("りゃ", "リャ", "rya"), e("りゅ", "リュ", "ryu"), e("りょ", "リョ", "ryo")],
  [e("ぎゃ", "ギャ", "gya"), e("ぎゅ", "ギュ", "gyu"), e("ぎょ", "ギョ", "gyo")],
  [e("じゃ", "ジャ", "ja", "jya", "zya"), e("じゅ", "ジュ", "ju", "jyu", "zyu"), e("じょ", "ジョ", "jo", "jyo", "zyo")],
  [e("びゃ", "ビャ", "bya"), e("びゅ", "ビュ", "byu"), e("びょ", "ビョ", "byo")],
  [e("ぴゃ", "ピャ", "pya"), e("ぴゅ", "ピュ", "pyu"), e("ぴょ", "ピョ", "pyo")],
];

/** @type {{ id: KanaGroup, label: string, rows: (KanaEntry|null)[][] }[]} */
export const GROUPS = [
  { id: "gojuon", label: "Gojūon", rows: GOJUON_ROWS },
  { id: "dakuten", label: "Dakuten", rows: DAKUTEN_ROWS },
  { id: "yoon", label: "Yōon", rows: YOON_ROWS },
];

/**
 * Base → voiced/p-sound pairs for the dakuten drill.
 * ka/sa/ta/ha rows zip onto が/ざ/だ/ば, plus ha → ぱ (handakuten).
 * @typedef {{ baseHira: string, baseKata: string, baseRomaji: string, voicedHira: string, voicedKata: string, voicedRomaji: string, voicedAlt: string[], mark: "゛" | "゜" }} DakutenPair
 */
function zipVoice(baseRow, voicedRow, mark) {
  /** @type {DakutenPair[]} */
  const out = [];
  for (let i = 0; i < baseRow.length; i++) {
    const b = baseRow[i], v = voicedRow[i];
    if (!b || !v) continue;
    out.push({
      baseHira: b.hira, baseKata: b.kata, baseRomaji: b.romaji,
      voicedHira: v.hira, voicedKata: v.kata, voicedRomaji: v.romaji,
      voicedAlt: v.alt ?? [],
      mark,
    });
  }
  return out;
}

/**
 * Voiced rows sit with their unvoiced family: ka/ga, sa/za, ta/da, ha/ba, ha/pa.
 * @typedef {{ id: string, label: string, mark: "゛" | "゜", pairs: DakutenPair[] }} DakutenGroup
 */
export const DAKUTEN_GROUPS = [
  { id: "ka", label: "ka → ga", mark: "゛", pairs: zipVoice(GOJUON_ROWS[1], DAKUTEN_ROWS[0], "゛") },
  { id: "sa", label: "sa → za", mark: "゛", pairs: zipVoice(GOJUON_ROWS[2], DAKUTEN_ROWS[1], "゛") },
  { id: "ta", label: "ta → da", mark: "゛", pairs: zipVoice(GOJUON_ROWS[3], DAKUTEN_ROWS[2], "゛") },
  { id: "ha", label: "ha → ba", mark: "゛", pairs: zipVoice(GOJUON_ROWS[5], DAKUTEN_ROWS[3], "゛") },
  { id: "pa", label: "ha → pa", mark: "゜", pairs: zipVoice(GOJUON_ROWS[5], DAKUTEN_ROWS[4], "゜") },
];

/** @type {DakutenPair[]} */
export const DAKUTEN_PAIRS = DAKUTEN_GROUPS.flatMap((g) => g.pairs);

/**
 * Dakuten drill: the mark is the lesson. Regular cards are consonant
 * shifts (T→D). Exceptions are the mora that don't follow the letter.
 *
 * @typedef {{
 *   id: string,
 *   kind: "rule" | "exception",
 *   mark: "゛" | "゜",
 *   prompt: string,
 *   promptRomaji?: string,
 *   promptIsKana: boolean,
 *   reveal: string,
 *   answers: string[],
 *   exampleFrom: string,
 *   exampleTo: string,
 *   caption: string,
 * }} DakutenLesson
 */
export const DAKUTEN_LESSONS = [
  {
    id: "t-d", kind: "rule", mark: "゛", prompt: "T", promptIsKana: false,
    reveal: "D", answers: ["d", "da", "de", "do"],
    exampleFrom: "た", exampleTo: "だ",
    caption: "ta te to",
  },
  {
    id: "k-g", kind: "rule", mark: "゛", prompt: "K", promptIsKana: false,
    reveal: "G", answers: ["g", "ga", "gi", "gu", "ge", "go"],
    exampleFrom: "か", exampleTo: "が",
    caption: "ka ki ku ke ko",
  },
  {
    id: "h-b", kind: "rule", mark: "゛", prompt: "H", promptIsKana: false,
    reveal: "B", answers: ["b", "ba", "bi", "bu", "be", "bo"],
    exampleFrom: "は", exampleTo: "ば",
    caption: "ha hi he ho",
  },
  {
    id: "h-p", kind: "rule", mark: "゜", prompt: "H", promptIsKana: false,
    reveal: "P", answers: ["p", "pa", "pi", "pu", "pe", "po"],
    exampleFrom: "は", exampleTo: "ぱ",
    caption: "the circle is a p-sound",
  },
  {
    id: "s-z", kind: "rule", mark: "゛", prompt: "S", promptIsKana: false,
    reveal: "Z", answers: ["z", "za", "zu", "ze", "zo"],
    exampleFrom: "さ", exampleTo: "ざ",
    caption: "sa su se so",
  },
  {
    id: "chi-ji", kind: "exception", mark: "゛", prompt: "ち", promptRomaji: "chi",
    promptIsKana: true, reveal: "ji", answers: ["ji", "ぢ", "ヂ"],
    exampleFrom: "ち", exampleTo: "ぢ",
    caption: "not di",
  },
  {
    id: "shi-ji", kind: "exception", mark: "゛", prompt: "し", promptRomaji: "shi",
    promptIsKana: true, reveal: "ji", answers: ["ji", "zi", "じ", "ジ"],
    exampleFrom: "し", exampleTo: "じ",
    caption: "not si + ゛",
  },
  {
    id: "tsu-zu", kind: "exception", mark: "゛", prompt: "つ", promptRomaji: "tsu",
    promptIsKana: true, reveal: "zu", answers: ["zu", "du", "dzu", "づ", "ヅ"],
    exampleFrom: "つ", exampleTo: "づ",
    caption: "not du",
  },
  {
    id: "fu-bu", kind: "exception", mark: "゛", prompt: "ふ", promptRomaji: "fu",
    promptIsKana: true, reveal: "bu", answers: ["bu", "ぶ", "ブ"],
    exampleFrom: "ふ", exampleTo: "ぶ",
    caption: "h → b, but ふ is fu",
  },
];

/**
 * Chart families: each unvoiced row stacked with its voiced counterpart(s).
 * @type {{ id: string, label: string, rows: (KanaEntry|null)[][] }[]}
 */
export const CHART_FAMILIES = [
  { id: "a", label: "a", rows: [GOJUON_ROWS[0]] },
  { id: "ka", label: "ka / ga", rows: [GOJUON_ROWS[1], DAKUTEN_ROWS[0]] },
  { id: "sa", label: "sa / za", rows: [GOJUON_ROWS[2], DAKUTEN_ROWS[1]] },
  { id: "ta", label: "ta / da", rows: [GOJUON_ROWS[3], DAKUTEN_ROWS[2]] },
  { id: "na", label: "na", rows: [GOJUON_ROWS[4]] },
  { id: "ha", label: "ha / ba / pa", rows: [GOJUON_ROWS[5], DAKUTEN_ROWS[3], DAKUTEN_ROWS[4]] },
  { id: "ma", label: "ma", rows: [GOJUON_ROWS[6]] },
  { id: "ya", label: "ya", rows: [GOJUON_ROWS[7]] },
  { id: "ra", label: "ra", rows: [GOJUON_ROWS[8]] },
  { id: "wa", label: "wa", rows: [GOJUON_ROWS[9]] },
  { id: "n", label: "n", rows: [GOJUON_ROWS[10]] },
  { id: "kya", label: "kya / gya", rows: [YOON_ROWS[0], YOON_ROWS[7]] },
  { id: "sha", label: "sha / ja", rows: [YOON_ROWS[1], YOON_ROWS[8]] },
  { id: "cha", label: "cha", rows: [YOON_ROWS[2]] },
  { id: "nya", label: "nya", rows: [YOON_ROWS[3]] },
  { id: "hya", label: "hya / bya / pya", rows: [YOON_ROWS[4], YOON_ROWS[9], YOON_ROWS[10]] },
  { id: "mya", label: "mya", rows: [YOON_ROWS[5]] },
  { id: "rya", label: "rya", rows: [YOON_ROWS[6]] },
];

/** Flattened, non-null list of every entry with its group.
 *  @type {(KanaEntry & { group: KanaGroup })[]} */
export const ENTRIES = GROUPS.flatMap((g) =>
  g.rows.flat().filter((c) => c !== null).map((c) => ({ ...c, group: g.id }))
);

/** @param {KanaEntry} entry @param {Script} script @returns {string} */
export function glyph(entry, script) {
  return script === "hiragana" ? entry.hira : entry.kata;
}

// Per-script glyph → entry lookup, built once.
const BY_GLYPH = {
  hiragana: new Map(ENTRIES.map((en) => [en.hira, en])),
  katakana: new Map(ENTRIES.map((en) => [en.kata, en])),
};

/** @param {Script} script @param {string} kana @returns {(KanaEntry & { group: KanaGroup }) | undefined} */
export function entryByGlyph(script, kana) {
  return BY_GLYPH[script]?.get(kana);
}

/** @param {string} s @returns {string} */
function normalize(s) {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

/** Fullwidth ASCII (ｋａ, ＞) → halfwidth, so IME leftovers still read as romaji. */
function halfwidth(s) {
  return s.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
}

/**
 * Drop leading/trailing junk that isn't a letter or kana — "ka>", "ka.", " が! "
 * still count. Extra *letters* are not stripped: "na" must not pass as ん ("n").
 * @param {string} s
 */
export function peelJunk(s) {
  return halfwidth(s).trim()
    .replace(/^[^A-Za-z\u3040-\u30FF\u31F0-\u31FFーゝゞヽヾ]+/, "")
    .replace(/[^A-Za-z\u3040-\u30FF\u31F0-\u31FFーゝゞヽヾ]+$/, "");
}

/** @param {string} raw @param {{ romaji: string, alt?: string[], hira?: string, kata?: string }} entry */
function matchesReading(raw, entry) {
  const peeled = peelJunk(raw);
  const forms = [raw.trim(), peeled].filter(Boolean);
  for (const form of forms) {
    if (entry.hira && form === entry.hira) return true;
    if (entry.kata && form === entry.kata) return true;
    const v = normalize(halfwidth(form));
    if (!v) continue;
    if (v === entry.romaji) return true;
    if ((entry.alt ?? []).some((a) => a === v)) return true;
  }
  return false;
}

/** True if the typed romaji matches the entry's canonical reading or an alternate.
 *  The glyph itself (hira or kata) also counts — useful when a Japanese IME is on.
 *  Trailing/leading symbols (ka>, ka.) are ignored; extra letters are not.
 *  @param {string} input @param {KanaEntry} entry @returns {boolean} */
export function checkAnswer(input, entry) {
  return matchesReading(input, entry);
}
