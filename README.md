<h1 align="center">kanthropic</h1>

<p align="center"><em>Learn kana in the dead time while Claude Code is thinking.</em></p>

---

`kanthropic` turns the seconds you spend waiting on Claude Code into hiragana &
katakana practice. While Claude thinks, a flashcard quietly flips in your
terminal **status line**: it shows a glyph, you recall the reading in your head,
and a moment later it reveals the answer — then moves to the next card. When you
want real, scored practice, run a typed drill at the idle prompt.

It's two surfaces over one local progress file:

| Surface | When | Input | Scored? |
| --- | --- | --- | --- |
| **Ambient flip** (status line) | while Claude is thinking | none — passive recall | no |
| **Typed drill** (`kanthropic study`) | at the idle prompt, when *you* own the keyboard | you type the romaji | yes — FSRS |

The drill grades your recall with [FSRS](https://github.com/open-spaced-repetition/ts-fsrs)
(the same engine as a full SRS app) and writes the schedule to
`~/.kanthropic/progress.json`. The ambient flip reads that schedule to surface
the glyphs you know least, first.

## Why a status line, and why no typing in ambient mode

While Claude Code runs, **it owns your keyboard and mouse** — the status line is
the only space available to anything else, and it can only *display* text. So
the ambient surface is deliberately passive: glance, recall, verify. It's
genuine spaced exposure with zero friction and nothing to interrupt your flow.
Actual scored recall lives in `kanthropic study`, which you run when Claude has
handed the terminal back to you.

The technique for safely editing `~/.claude/settings.json` (minimal-diff JSONC
edits, a byte-exact backup, chain-capturing any status line you already have,
and a fully reversible uninstall) is modeled on the Kickbacks extension's
approach — reimplemented independently here.

## Install

```sh
npm install            # installs ts-fsrs
node src/cli/index.mjs install
```

Then start a new `claude` session — a kana card will flip in the status line
while it thinks. If you already had a status line, it's preserved and stacks
below the card.

## Usage

```sh
kanthropic install            # add the ambient flashcard line to Claude Code
kanthropic uninstall          # remove it; restores any prior status line (progress kept)
kanthropic study              # typed, FSRS-scored drill — run at the idle prompt
kanthropic study --script katakana --count 15
kanthropic status             # install state + your progress per script
kanthropic config --script katakana --front 3000 --back 2000
kanthropic preview            # print a few sample ambient lines
```

Options: `--script hiragana|katakana`, `--count N`, `--front <ms>` (how long the
glyph shows before revealing), `--back <ms>` (how long the answer shows before
the next card).

## How it works

- **`src/data/kana.mjs`** — the full kana dataset (gojūon + dakuten + yōon, 104
  entries) with canonical + alternate romanizations and `checkAnswer`. Ported
  from the author's hypertools kana trainer.
- **`src/core/jsonc.mjs`** — a raw-text, minimal-diff JSONC editor: it edits
  only the `statusLine` value span, so your comments, key order, and other
  settings survive untouched.
- **`src/core/store.mjs` / `scheduler.mjs` / `ambient.mjs`** — the local JSON
  store, FSRS grading (drill only), and the dependency-free weighted picker the
  status-line tick uses.
- **`src/install/`** — generates `~/.kanthropic/kanthropic-statusline.mjs` (the
  stateless per-refresh tick) and wires it into `~/.claude/settings.json`,
  reversibly.
- **`src/cli/`** — the command router and the interactive typed drill.

Everything is buildless ESM. The status-line tick imports no dependencies and
never throws — on any error it prints nothing and exits 0, so it can never break
Claude Code's status line.

## Uninstall

```sh
kanthropic uninstall
```

Removes only the keys kanthropic added, restores a pre-existing status line
byte-for-byte, and deletes a settings file it created from scratch. Your
learning progress (`~/.kanthropic/progress.json`) is kept.

## Tests

```sh
npm test
```

Covers the JSONC editor, the kana data + answer checking, the ambient picker,
FSRS grading, and the full install/uninstall reversibility round-trip.
