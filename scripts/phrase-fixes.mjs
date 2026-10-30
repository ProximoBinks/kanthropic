/**
 * Hand corrections to the Wikitravel phrasebook, keyed by the source's
 * Japanese. build-phrases.mjs applies them after tokenizing, so they survive
 * a rebuild. Fields replace the generated ones; note "" removes the note;
 * tiles also reset kana. Card ids don't change, so progress is kept.
 *
 * Why these matter: a quiz card is only fair if its English asks for exactly
 * its Japanese. "Fine, thank you." → はい、元気です had no ありがとう, so the
 * ありがとう decoy tile looked right and got marked wrong.
 */
export const PHRASE_FIXES = {
  // English that doesn't say what the Japanese says.
  "はい、元気です。": { en: "Yes, I'm fine." },
  "こんにちは。": { en: "Hello.", note: "daytime" },
  "日本語が話せません。": { en: "I can't speak Japanese.", note: "" },
  "助けて！": { en: "Help!" },
  "そうですね。": { en: "Yeah, that's true." },
  "お疲れさまでした。": { en: "Thanks for your hard work.", note: "after work or effort" },
  "失礼します。": { en: "Excuse me.", note: "entering, leaving or interrupting" },
  "失礼しました。": { en: "Sorry to have bothered you.", note: "also when leaving" },
  "凄い！": { ja: "すごい！", en: "Amazing!" },
  "ウソ！": { en: "No way!", note: "literally: lie" },
  "動くな! 泥棒！": { en: "Don't move! Thief!" },
  "お勧めはありますか？": { en: "Do you have any recommendations?" },
  "いただきます。": { en: "Let's eat.", note: "before a meal" },
  "ご馳走さまでした。": { en: "Thank you for the meal.", note: "after eating" },
  "焼酎": { en: "shochu", note: "Japanese distilled spirit" },
  "オンザロック": { en: "on the rocks" },
  "徐行": { en: "slow down" },
  "何もしていません。": { en: "I haven't done anything.", note: "" },
  "少ない": { en: "few, little", note: "" },
  "多い": { en: "many, a lot", note: "" },
  "腰": { en: "lower back, hips" },
  "足": { en: "leg, foot" },
  "夕食": { en: "dinner" },
  "モンゴル": { en: "Mongolia" },
  "ギリシャ": { en: "Greece", romaji: "Girisha" },
  "海外へ発送出来ますか？": { en: "Do you ship overseas?", note: "" },
  "ガソリンスタンド": { en: "petrol station", note: "" },
  "医者に見てもらいたいです。": { ja: "医者に診てもらいたいです。", en: "I'd like to see a doctor." },

  // Wrong Japanese, kanji or readings.
  "道を迷っています。": { ja: "道に迷っています。", romaji: "Michi ni mayotte imasu.", tiles: ["みちに", "まよっています"] },
  "私のサイズでありますか？": { ja: "私のサイズはありますか？", romaji: "Watashi no saizu wa arimasu ka?", tiles: ["わたしの", "サイズは", "ありますか"] },
  "出口": { romaji: "deguchi", tiles: ["でぐち"] },
  "押": { romaji: "osu", tiles: ["おす"] },
  "引": { romaji: "hiku", tiles: ["ひく"] },
  "始めまして。どうぞ宜しくお願いします。": { ja: "初めまして。どうぞよろしくお願いします。" },
  "お早うございます。": { ja: "おはようございます。", note: "polite" },
  "何かを呑んでしまいました。": { ja: "何かを飲んでしまいました。", en: "I swallowed something." },
  "耳が良く聴こえません。": { ja: "耳がよく聞こえません。", en: "I can't hear well." },
  "鼻血が良くでます。": { ja: "鼻血がよく出ます。", en: "I get a lot of nosebleeds." },
  "警察をよぶよ！。": { ja: "警察を呼ぶよ！" },
  "スープ :": { ja: "スープ" },
  "済みません": { ja: "すみません", en: "Excuse me!", note: "calling a server" },
  "果汁": { ja: "ジュース", romaji: "jūsu", tiles: ["ジュース"] },
  "ええぇ〜": { ja: "えー！", romaji: "Ē!", en: "Whaaat?!", note: "surprise", tiles: ["えー"] },
  "お手洗い, トイレ, 化粧室": { ja: "お手洗い", romaji: "otearai", tiles: ["おてあらい"], note: "also トイレ" },
  "南アフリカ": { tiles: ["みなみ", "アフリカ"] },
  "おつりはいりません。": { romaji: "Otsuri wa irimasen.", tiles: ["おつりは", "いりません"] },
  "袋を貰えますか？": { romaji: "Fukuro o moraemasu ka?" },

  // Same English on several cards: the note says which one is wanted.
  "どうもありがとうございます。": { note: "very polite" },
  "ありがとうございます。": { note: "polite" },
  "ありがとう。": { note: "casual" },
  "どうも。": { note: "casual" },
  "ごめんなさい。": { note: "standard" },
  "お休みなさい。": { en: "Good night.", note: "before sleep" },
  "お休み。": { en: "Good night.", note: "casual, before sleep" },
  "ほっといてくれ。": { note: "blunt" },
  "はい、それにします。": { note: "choosing an item" },
  "はい、これで良いです。": { note: "accepting a room" },
  "コーラ": { note: "" },
  "準備中": { note: "not open yet" },
  "円": { note: "" },
  ...Object.fromEntries(["父", "母", "兄", "姉", "弟", "妹", "祖父", "祖母", "夫", "妻", "息子", "娘", "孫"]
    .map((ja) => [ja, { note: "my own" }])),
  ...Object.fromEntries(["弟さん", "妹さん", "おじさん", "おばさん", "ご主人", "奥さん", "息子さん", "お嬢さん", "お孫さん"]
    .map((ja) => [ja, { note: "someone else's" }])),
  ...Object.fromEntries(["お父さん", "お母さん", "お兄さん", "お姉さん", "おじいさん", "おばあさん"]
    .map((ja) => [ja, { note: "someone else's, or calling your own" }])),
  ...Object.fromEntries(["一つ", "二つ", "三つ", "四つ", "五つ", "六つ", "七つ", "八つ", "九つ"]
    .map((ja) => [ja, { note: "counting things" }])),
  ...Object.fromEntries(["一", "二", "三", "四", "五", "六", "七", "八", "九"]
    .map((ja) => [ja, { note: "the number" }])),
  "韓国": { note: "everyday" },
  "大韓民国": { note: "official name" },
  "オーストラリア": { note: "everyday" },
  "豪州": { note: "formal, in the news" },
  "イギリス": { note: "everyday" },
  "英国": { note: "formal, in the news" },
  "アメリカ": { note: "everyday" },
  "米国": { note: "formal, in the news" },
};

/** Apply a fix to a generated phrase ({ id, topic, en, note?, ja, romaji, kana, tiles }). */
export function applyFix(p, fix = PHRASE_FIXES[p.ja]) {
  if (!fix) return p;
  const out = { ...p, ...fix };
  if (fix.tiles) out.kana = fix.tiles.join("");
  if (!out.note) delete out.note;
  // Keep the generated key order: id, topic, en, note, ja, romaji, kana, tiles.
  const { id, topic, en, note, ja, romaji, kana, tiles } = out;
  return { id, topic, en, ...(note ? { note } : {}), ja, romaji, kana, tiles };
}
