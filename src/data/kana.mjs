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
  [e("だ", "ダ", "da"), e("ぢ", "ヂ", "ji", "di", "dji"), e("づ", "ヅ", "zu", "du"), e("で", "デ", "de"), e("ど", "ド", "do")],
  [e("ば", "バ", "ba"), e("び", "ビ", "bi"), e("ぶ", "ブ", "bu"), e("べ", "ベ", "be"), e("ぼ", "ボ", "bo")],
  [e("ぱ", "パ", "pa"), e("ぴ", "ピ", "pi"), e("ぷ", "プ", "pu"), e("ぺ", "ペ", "pe"), e("ぽ", "ポ", "po")],
];

// ── Yōon combos (33) ──────────────────────────────────────────────────────
export const YOON_ROWS = [
  [e("きゃ", "キャ", "kya"), e("きゅ", "キュ", "kyu"), e("きょ", "キョ", "kyo")],
  [e("しゃ", "シャ", "sha", "sya"), e("しゅ", "シュ", "shu", "syu"), e("しょ", "ショ", "sho", "syo")],
  [e("ちゃ", "チャ", "cha", "tya", "cya"), e("ちゅ", "チュ", "chu", "tyu"), e("ちょ", "チョ", "cho", "tyo")],
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
  return BY_GLYPH[script].get(kana);
}

/** @param {string} s @returns {string} */
function normalize(s) {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

/** True if the typed romaji matches the entry's canonical reading or an alternate.
 *  @param {string} input @param {KanaEntry} entry @returns {boolean} */
export function checkAnswer(input, entry) {
  const v = normalize(input);
  if (v.length === 0) return false;
  if (v === entry.romaji) return true;
  return (entry.alt ?? []).some((a) => a === v);
}
