/**
 * Hand-written phrases for staying with a Japanese family (Hiroshima), on top
 * of the Wikitravel phrasebook. build-phrases.mjs tokenizes them like the
 * rest; `tiles` + `romaji` are given only where kuromoji can't read the
 * phrase (Hiroshima-ben, numbers). Topics are in the order a visit happens.
 *
 * Rules for a fair tile quiz: the English asks for exactly this Japanese
 * (nothing extra, nothing missing), and no two cards share English + note.
 */
export const FAMILY_TOPICS = [
  {
    id: "keep-talking", label: "keep talking",
    phrases: [
      { en: "Once more, please.", ja: "もう一回お願いします。", romaji: "Mō ikkai onegai shimasu.", tiles: ["もう", "いっかい", "おねがい", "します"] },
      { en: "Slowly, please.", ja: "ゆっくりお願いします。", romaji: "Yukkuri onegai shimasu." },
      { en: "What does this mean?", ja: "これはどういう意味ですか。", romaji: "Kore wa dō iu imi desu ka?" },
      { en: "How do you say it in Japanese?", ja: "日本語で何と言いますか。", romaji: "Nihongo de nan to iimasu ka?", tiles: ["にほんごで", "なんと", "いいますか"] },
      { en: "Um...", note: "while you think", ja: "えーと。", tiles: ["えーと"], romaji: "Ēto." },
      { en: "Oh, I see.", note: "reacting", ja: "そうなんですね。", romaji: "Sō nan desu ne.", tiles: ["そう", "なんですね"] },
      { en: "That makes sense.", ja: "なるほど。", romaji: "Naruhodo." },
      { en: "Really?", note: "polite", ja: "本当ですか。", romaji: "Hontō desu ka?" },
      { en: "I understand a little.", ja: "少しわかります。", romaji: "Sukoshi wakarimasu." },
      { en: "Just a moment, please.", ja: "ちょっと待ってください。", romaji: "Chotto matte kudasai." },
    ],
  },
  {
    id: "about-me", label: "about me",
    phrases: [
      { en: "I'm Elliot. Nice to meet you.", ja: "エリオットです。よろしくお願いします。", romaji: "Eriotto desu. Yoroshiku onegai shimasu." },
      { en: "I'm from Adelaide, Australia.", ja: "オーストラリアのアデレードから来ました。", romaji: "Ōsutoraria no Aderēdo kara kimashita." },
      { en: "I graduated from university this year.", ja: "今年、大学を卒業しました。", romaji: "Kotoshi, daigaku o sotsugyō shimashita." },
      { en: "I make apps for work.", ja: "アプリを作る仕事をしています。", romaji: "Apuri o tsukuru shigoto o shite imasu." },
      { en: "I run my own company.", ja: "自分で会社をやっています。", romaji: "Jibun de kaisha o yatte imasu." },
      { en: "I can work from anywhere.", ja: "どこでも仕事ができます。", romaji: "Doko demo shigoto ga dekimasu." },
      { en: "I met Mana at Meiji University.", ja: "マナさんとは明治大学で会いました。", romaji: "Mana-san to wa Meiji Daigaku de aimashita.", tiles: ["マナさんとは", "めいじだいがくで", "あいました"] },
      { en: "I lived in Tokyo for eight months.", ja: "東京に八か月住んでいました。",
        tiles: ["とうきょうに", "はちかげつ", "すんでいました"], romaji: "Tōkyō ni hachikagetsu sunde imashita." },
      { en: "I came to love Japan.", ja: "日本がとても好きになりました。", romaji: "Nihon ga totemo suki ni narimashita." },
      { en: "My parents are well.", ja: "両親は元気です。", romaji: "Ryōshin wa genki desu." },
      { en: "I'll be in Japan until about March.", ja: "三月ごろまで日本にいます。", romaji: "Sangatsu goro made Nihon ni imasu.", tiles: ["さんがつ", "ごろまで", "にほんに", "います"] },
      { en: "I want to study Japanese more.", ja: "日本語をもっと勉強したいです。", romaji: "Nihongo o motto benkyō shitai desu." },
      { en: "I'd like to live in Japan someday.", ja: "いつか日本に住みたいです。", romaji: "Itsuka Nihon ni sumitai desu." },
      { en: "I'll take good care of Mana.", ja: "マナさんを大切にします。", romaji: "Mana-san o taisetsu ni shimasu." },
    ],
  },
  {
    id: "arriving", label: "arriving",
    phrases: [
      { en: "Sorry to intrude.", note: "stepping into someone's home", ja: "お邪魔します。", romaji: "Ojama shimasu." },
      { en: "It's been a while.", ja: "お久しぶりです。", romaji: "Ohisashiburi desu." },
      { en: "I'm happy to see you again.", ja: "またお会いできてうれしいです。", romaji: "Mata oai dekite ureshii desu." },
      { en: "I'm well, thanks to you.", note: "when asked how you are", ja: "おかげさまで元気です。", romaji: "Okagesama de genki desu." },
      { en: "This is a gift from Australia.", ja: "これ、オーストラリアのお土産です。", romaji: "Kore, Ōsutoraria no omiyage desu." },
      { en: "It's only something small, but please.", note: "handing over a gift", ja: "つまらないものですが、どうぞ。", romaji: "Tsumaranai mono desu ga, dōzo." },
      { en: "Thank you for having me.", note: "at the start of a stay", ja: "お世話になります。", romaji: "Osewa ni narimasu." },
    ],
  },
  {
    id: "at-the-table", label: "at the table",
    phrases: [
      { en: "It's really delicious.", ja: "とてもおいしいです。", romaji: "Totemo oishii desu." },
      { en: "What's this?", note: "about food", ja: "これは何ですか。", romaji: "Kore wa nan desu ka?", tiles: ["これは", "なん", "ですか"] },
      { en: "Seconds, please.", ja: "おかわり、お願いします。", romaji: "Okawari, onegai shimasu." },
      { en: "May I have a little more?", ja: "もう少しいただいてもいいですか。", romaji: "Mō sukoshi itadaite mo ii desu ka?" },
      { en: "I'm already full.", ja: "もうおなかいっぱいです。", romaji: "Mō onaka ippai desu.", tiles: ["もう", "おなか", "いっぱい", "です"] },
      { en: "I can eat anything.", ja: "何でも食べられます。", romaji: "Nan demo taberaremasu.", tiles: ["なんでも", "たべられます"] },
      { en: "I'm not great with spicy food.", note: "politely turning food down", ja: "辛いものはちょっと苦手です。", romaji: "Karai mono wa chotto nigate desu.", tiles: ["からい", "ものは", "ちょっと", "にがて", "です"] },
      { en: "I love okonomiyaki.", ja: "お好み焼きが大好きです。", romaji: "Okonomiyaki ga daisuki desu." },
      { en: "Cheers!", ja: "乾杯！" },
    ],
  },
  {
    id: "staying-over", label: "staying over",
    phrases: [
      { en: "Can I help with anything?", ja: "何か手伝いましょうか。", romaji: "Nanika tetsudaimashō ka?" },
      { en: "I'll wash the dishes.", ja: "お皿、洗いますね。", romaji: "Osara, araimasu ne." },
      { en: "Where should I put this?", ja: "これ、どこに置きますか。", romaji: "Kore, doko ni okimasu ka?" },
      { en: "Thank you for the bath.", ja: "お風呂、ありがとうございました。", romaji: "Ofuro, arigatō gozaimashita." },
      { en: "I'm off!", note: "leaving the house", ja: "いってきます。", romaji: "Ittekimasu." },
      { en: "See you later!", note: "to someone leaving the house", ja: "いってらっしゃい。", romaji: "Itterasshai." },
      { en: "I'm home!", ja: "ただいま。", romaji: "Tadaima." },
      { en: "Welcome home!", ja: "おかえりなさい。", romaji: "Okaerinasai." },
      { en: "I'll go to bed first.", note: "excusing yourself", ja: "お先に失礼します。", romaji: "Osaki ni shitsurei shimasu." },
      { en: "Thank you for everything.", note: "leaving at the end of a stay", ja: "お世話になりました。", romaji: "Osewa ni narimashita." },
    ],
  },
  {
    id: "new-year", label: "new year",
    phrases: [
      { en: "Have a good New Year.", note: "before New Year", ja: "よいお年を。", romaji: "Yoi otoshi o." },
      { en: "Happy New Year!", note: "from 1 January", ja: "あけましておめでとうございます。", romaji: "Akemashite omedetō gozaimasu." },
      { en: "Please look after me this year too.", note: "said at New Year", ja: "今年もよろしくお願いします。", romaji: "Kotoshi mo yoroshiku onegai shimasu." },
      { en: "I'd like to go to the shrine with you.", note: "New Year shrine visit", ja: "初詣、一緒に行きたいです。", romaji: "Hatsumōde, issho ni ikitai desu." },
      { en: "I'm looking forward to New Year.", ja: "お正月、楽しみです。", romaji: "Oshōgatsu, tanoshimi desu." },
    ],
  },
  {
    // Recognise, don't produce: the note says how it's said in standard Japanese.
    id: "hiroshima-ben", label: "hiroshima-ben",
    phrases: [
      { en: "Really tasty, right?", note: "Hiroshima-ben for すごくおいしいでしょう", ja: "ぶちうまいじゃろ？",
        tiles: ["ぶち", "うまい", "じゃろ"], romaji: "Buchi umai jaro?" },
      { en: "Have a seat.", note: "Hiroshima-ben for すわってください", ja: "座りんさい。",
        tiles: ["すわりんさい"], romaji: "Suwarinsai." },
      { en: "Try some.", note: "Hiroshima-ben for たべてみてください", ja: "食べてみんさい。",
        tiles: ["たべて", "みんさい"], romaji: "Tabete minsai." },
      { en: "What are you up to?", note: "Hiroshima-ben for なにしているの", ja: "何しよるん？",
        tiles: ["なに", "しよるん"], romaji: "Nani shiyorun?" },
      { en: "What a pain.", note: "Hiroshima-ben for めんどうくさいね", ja: "たいぎいのう。",
        tiles: ["たいぎい", "のう"], romaji: "Taigii nō." },
      { en: "It's cold, so take care.", note: "Hiroshima-ben: けぇ means だから", ja: "寒いけぇ、気をつけてね。",
        tiles: ["さむい", "けぇ", "きをつけてね"], romaji: "Samui kē, ki o tsukete ne." },
      { en: "Don't worry about it.", note: "Hiroshima-ben for きにしなくていいよ", ja: "気にせんでええよ。",
        tiles: ["きに", "せんで", "ええよ"], romaji: "Ki ni sende ē yo." },
      { en: "See you, then.", note: "Hiroshima-ben for じゃあね", ja: "ほいじゃあね。",
        tiles: ["ほいじゃあね"], romaji: "Hoijā ne." },
    ],
  },
];
