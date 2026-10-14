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
