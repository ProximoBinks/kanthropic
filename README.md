<h1 align="center">kanthropic</h1>

<p align="center"><em>Learn hiragana &amp; katakana in the dead time while Grok thinks.</em></p>

---

`kanthropic` is a **macOS menu bar app**. Click **あ** for a flashcard; type the rōmaji. While [Grok Build](https://grok.x.ai) is working, the card pops up on its own — same idea as the old Claude/tmux pane, without any of that wiring.

Two modes, that's the whole product:

- **Learn** — the next row, one character at a time, with the reading and a mnemonic. Then those glyphs enter your deck.
- **Revise** — FSRS-backed drill of what you've learned. Due cards first; when you're caught up it **keeps going** on the set you're still learning, then the whole deck. No check-in menu, no `/f` `/r` `/s`.

Progress lives in `~/.kanthropic/progress.json` and is shared with the CLI.

```
     あ          ← menu bar
 ┌────────────┐
 │ learn  revise   あ / ア  │
 │            │
 │     き     │
 │            │
 │ ki         │  ← type, return
 └────────────┘
```

## Install (macOS)

```sh
git clone https://github.com/ProximoBinks/kanthropic.git
cd kanthropic && npm install
npx kanthropic app          # builds ~/Applications/Kanthropic.app, installs Grok hooks, launches
```

Needs **Node 18+** and **Xcode Command Line Tools** (`xcode-select --install`) for the one-time Swift build.

Look for **あ** on the right of the menu bar:

- **Left-click** — flashcard
- **Right-click** — pop while Grok thinks, open at login, quit
- **Escape** or click away — dismiss
- **Return** — grade (revise) / continue (learn)
- **Drag a window corner** — enlarge the content with sharp text; dismissing resets the size

**Drill all → pick a set** saves each character's practice streak and your score for the local calendar day, separately for each script and set. Reopening a set or restarting the app resumes that progress. Characters with three consecutive correct answers leave the practice pool. Daily practice resets at local midnight; learned characters and FSRS review history are preserved.

Grok hooks live in `~/.grok/hooks/kanthropic.json` (one file; delete it to uninstall). They only write a tiny state file — they do **not** open tmux panes or edit a shared settings.json. The app pops on the idle→thinking edge, once per turn, so it doesn't yank focus on every tool call.

```sh
npx kanthropic grok-uninstall   # remove the hooks; the app still works standalone
```

## How practice works

New characters only enter the deck through **Learn** (the next unlearned row, in gojūon order). Revise never ambushes you with a glyph you haven't seen.

A correct answer is FSRS *Good*, a miss is *Again*. A character is **mastered** only after it has graduated to Review **and** been recalled on two separate local days (≥ 8 hours apart) — cramming in one sitting can't fake it.

Hiragana auto-advances to katakana once hiragana is fully mastered. Toggle **あ / ア** any time.

## Sync + phone app (optional)

Progress can sync through [Convex](https://convex.dev) to a PWA you add to your phone's home screen. The menu bar app, the CLI and the phone run the same engine. Sync is per card: studying different characters on two devices merges cleanly, and when both devices graded the same card, the more recent review wins.

```sh
npx convex dev --once                     # deploy convex/ (first run creates the project, writes .env.local)
npm run web:build                         # PWA → web/dist (reads VITE_CONVEX_URL from .env.local)
# host web/dist anywhere with HTTPS (e.g. `vercel deploy web/dist`)

npx kanthropic sync setup --url https://<deployment>.convex.cloud --web https://<your pwa>
```

`sync setup` prints a pairing link and a QR code. Open it on your phone, then **Share → Add to Home Screen**. The menu bar app syncs when you open or close the panel, and every few minutes in between. The PWA syncs live and works offline. `kanthropic sync` syncs by hand, `sync link` shows the QR code again, and `sync off` stops syncing on this machine.

The pairing key is the only credential, so anyone with the link can read and edit your progress.

## Phrases (phone app)

The **progress** tab (calendar icon) logs how long you practise each day, across every device that syncs: today's time against a 15-minute goal, your streak, the last 7 days and all time, a month calendar shaded by time practised (tap a day for its answers, accuracy, and phrases built / heard / said), and how far through hiragana, katakana and the phrases you are. Time is active time, measured between answers: a gap of more than 90 seconds counts as a break, so leaving the app open doesn't inflate it.

The **phrases** tab teaches 517 phrases in 24 topics, in three groups: visiting family (staying with a Japanese family, including Hiroshima-ben to recognise), everyday, and travel & emergencies. You see a new phrase once, then each review moves through three modes as it sticks: **build** it from shuffled kana tiles while you're learning it, **listen** to it with no text and pick the meaning once it graduates, and **say it** out loud from the English and grade yourself (again / hard / good / easy) once it's stable (FSRS stability of a week or more and 80%+ accuracy). For extra practice outside the schedule, **drill the shaky ones** (phrases you've met but not mastered, worst first) from the top of the topic list or inside a topic, or **drill now** to run through everything you've met in a topic. A drill is a round of up to 10 that ends when each one is right; a miss comes back a few cards later as tiles. Drills count toward your practice time but don't move FSRS, so cramming can't push real reviews out. Every third review of a spoken phrase is a listening one, a miss drops it back to tiles, Hiroshima-ben stops at listening, and no phrase goes longer than a month between reviews. Answers are scheduled with the same FSRS engine as the kana, and phrases you got wrong come back first. You get 10 new phrases a day, and reviews are never capped. Each phrase is pre-recorded in four Google Chirp 3 HD voices (Iapetus, Orus, Rasalgethi, Sadaltager), and a random one plays each time unless you pick one in settings; the device's Japanese voice is the fallback.

The phrases come from the [Japanese Phrasebook](https://github.com/Lorti/phrasebook), which is built on [Wikitravel's Japanese phrasebook](https://wikitravel.org/en/Japanese_phrasebook) and licensed **CC BY-SA 3.0**. To rebuild the deck (readings and tiles come from kuromoji, checked against the source romaji):

```sh
node scripts/build-phrases.mjs path/to/phrasebook/bin/markup
```

## CLI (optional / Linux)

The same engine, in a terminal:

```sh
npx kanthropic learn            # pick a row (or `kanthropic app` and click Learn)
npx kanthropic drill            # revise; q quit · /n next row · /h /k script
npx kanthropic reset            # wipe progress (asks first)
npx kanthropic status
```

Legacy Claude/tmux (`session`, `watch`, `hooks-install`) still exists if you want it. The menu bar app is the supported path.

## Uninstall

Right-click **あ** → Quit. Then:

```sh
npx kanthropic grok-uninstall
rm -rf ~/Applications/Kanthropic.app
```

Progress stays in `~/.kanthropic` until you delete that folder.

## Tests

```sh
npm test
```

## Star History

<a href="https://www.star-history.com/?type=date&amp;repos=ProximoBinks%2Fkanthropic">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=ProximoBinks/kanthropic&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=ProximoBinks/kanthropic&amp;type=date&amp;legend=top-left" />
    <img alt="Star History Chart for kanthropic" src="https://api.star-history.com/chart?repos=ProximoBinks/kanthropic&amp;type=date&amp;legend=top-left" />
  </picture>
</a>

## License

MIT
