/**
 * Short, original shape mnemonics for the base gojūon (hiragana + katakana),
 * keyed by glyph. Dakuten / handakuten / yōon are systematic, so their hints
 * are generated. These are first-draft hooks meant to be refined — they're our
 * own wording, not copied from any kana guide.
 *
 * @typedef {import("./kana.mjs").Script} Script
 */
export const MNEMONICS = {
  // ── hiragana ──────────────────────────────────────────────────────────
  "あ": "Like a capital 'A' with an extra loop — say 'Ahh'.",
  "い": "Two strokes side by side, like the dots over 'ii' in 'skiing'.",
  "う": "A person slouching forward — 'ooh, my back'.",
  "え": "A ninja with a sword, or an exotic bird — 'Eh?'.",
  "お": "Like あ with an extra tail — someone doing tai-chi, 'Oh'.",
  "か": "A katana mid-slash, with a spark (the dot) — 'ka'.",
  "き": "A key with two teeth and a loop at the bottom.",
  "く": "A bird's beak opening — 'cuckoo, ku'.",
  "け": "A keg tipped on its side.",
  "こ": "Two short strokes — two cocoons lying down.",
  "さ": "A cross with a hook — a 'sa'-mooth curve underneath.",
  "し": "A single hook swooping down — long hair, 'she'.",
  "す": "A loop with a long tail — a swirly 'soo'-venir.",
  "せ": "A mouth opening to 'say'.",
  "そ": "A zig-zag line — sewing thread, 'so'.",
  "た": "A 't' and an 'a' stuck together — 'ta-da!'.",
  "ち": "A backwards '5' — a wedge of 'chee'-se.",
  "つ": "One big swooping wave — 'tsu'-nami.",
  "て": "A hand reaching out — 'te'.",
  "と": "A needle with thread through it — a 'toe' with a nail.",
  "な": "A cross with a knot at the foot — a bent 'na'-il.",
  "に": "A needle and thread, two strokes — 'knee'.",
  "ぬ": "Noodles twirled into a loop — 'noo'.",
  "ね": "A loop with a curling tail — a cat, 'nyan'.",
  "の": "A single spiral — a 'no entry' swirl.",
  "は": "An 'h' with a cross — 'ha ha' laughing.",
  "ひ": "A wide grin — 'hee hee'.",
  "ふ": "Scattered strokes like little Mt. Fujis — 'foo'.",
  "へ": "A simple hill, or an arrow — 'heyyy'.",
  "ほ": "Like は plus an extra bar — 'ho ho ho'.",
  "ま": "A cross with a curl — 'ma'-ma waving.",
  "み": "Looks like the number '21' — 'me', myself.",
  "む": "A cow with a tail — 'moo'.",
  "め": "A single eye-shaped loop — 'meh'.",
  "も": "A fish hook with two crossbars — catch 'more'.",
  "や": "A 'y' shape with a flick — 'ya!'.",
  "ゆ": "A fish swimming — 'yoo'.",
  "よ": "A hook with a crossbar — 'yo!' waving.",
  "ら": "A little person standing — 'rah rah'.",
  "り": "Two strokes flowing down — a 'reed'.",
  "る": "A line that loops at the bottom — a 'route'.",
  "れ": "A tall stroke with a kick — 'reh'.",
  "ろ": "Like る without the loop — an open 'row'.",
  "わ": "A waving person (の-family) — 'wah'.",
  "を": "A zig-zag carrying an 'o' — the object marker, 'wo/o'.",
  "ん": "One soft stroke — the hum, 'nnn'.",

  // ── katakana ──────────────────────────────────────────────────────────
  "ア": "A capital 'A' missing a leg — 'Ahh'.",
  "イ": "Two leaning strokes — an eagle's legs, 'ee'.",
  "ウ": "A roof with a chimney — sheltered, 'ooh'.",
  "エ": "An I-beam / a capital 'E' on its side — 'eh'.",
  "オ": "A cross with a kick — 'Oh!'.",
  "カ": "Like か without the spark — a 'ka'-tana slash.",
  "キ": "Like き — a key with crossbars.",
  "ク": "A beak, or a slice taken out — 'coo'.",
  "ケ": "A keg, simplified to three strokes.",
  "コ": "A box open on one side — a 'corner'.",
  "サ": "Crossbars and a slash, like さ — 'sah'.",
  "シ": "Three strokes leaning RIGHT, winking — 'she' (vs ツ).",
  "ス": "A figure sitting cross-legged — 'soo'.",
  "セ": "A mouth, like せ — 'say'.",
  "ソ": "Two strokes dropping straight DOWN — stitches, 'so' (vs ン).",
  "タ": "Like ク with a slash through it — 'ta'.",
  "チ": "A plus sign with a hook — 'chee'.",
  "ツ": "Three strokes pointing DOWN — splashes, 'tsu' (vs シ).",
  "テ": "A 'T' with extra bars — 'te'.",
  "ト": "A simplified 'T' — a 'toe'.",
  "ナ": "A cross, like a knife — 'na'.",
  "ニ": "Two horizontal lines — 'two', 'knee'.",
  "ヌ": "Like ス with a slash — 'noo'-dles.",
  "ネ": "Stacked strokes — a cat sitting, 'nyan'.",
  "ノ": "A single down-slash — 'no'.",
  "ハ": "Two strokes spreading apart — 'ha ha'.",
  "ヒ": "A spoon, or a person sitting — 'hee'.",
  "フ": "One hooked stroke — a hood, 'foo'.",
  "ヘ": "A hill — the same as へ, 'heyyy'.",
  "ホ": "A cross standing on two legs — 'ho ho'.",
  "マ": "A check mark with a hook — 'ma'.",
  "ミ": "Three lines — like 'three', 'me'.",
  "ム": "A little hut / cow shed — 'moo'.",
  "メ": "An 'X' — crossed eyes, 'meh'.",
  "モ": "A hook with a crossbar — 'more'.",
  "ヤ": "A flicking 'y' — 'ya!'.",
  "ユ": "A 'U'-shaped box — 'yoo'.",
  "ヨ": "A backwards 'E' / a comb — 'yo!'.",
  "ラ": "Two strokes, a flag on a pole — 'rah'.",
  "リ": "Two vertical strokes — a 'reed' (like り).",
  "ル": "Two strokes, one hooking up — a 'route'.",
  "レ": "A single check-mark — 'reh'.",
  "ロ": "A square box — an 'O'-ish 'row'.",
  "ワ": "Like ウ without the chimney — 'wah'.",
  "ヲ": "Like ラ with a leg — carrying an 'o', 'wo/o'.",
  "ン": "Two strokes rising from the bottom — the hum 'nnn' (vs ソ).",
};

/**
 * A hint for any glyph. Base gojūon come from MNEMONICS; dakuten / handakuten /
 * yōon are systematic.
 * @param {{ romaji: string, group: string }} entry
 * @param {string} glyph
 * @returns {string}
 */
export function mnemonicFor(entry, glyph) {
  if (MNEMONICS[glyph]) return MNEMONICS[glyph];
  if (entry.group === "yoon") {
    return `A full-size kana + a small ゃ/ゅ/ょ, blended into one syllable — '${entry.romaji}'.`;
  }
  if (entry.group === "dakuten") {
    return /^p/.test(entry.romaji)
      ? `Add ゜ (handakuten, a little circle) for the 'p' sound — '${entry.romaji}'.`
      : `Add ゛ (dakuten, two short strokes) to voice it — '${entry.romaji}'.`;
  }
  return `'${entry.romaji}'.`;
}
