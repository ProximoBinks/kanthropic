<h1 align="center">kanthropic</h1>

<p align="center"><em>Learn hiragana &amp; katakana in the dead time while Claude Code is thinking.</em></p>

---

`kanthropic` turns the seconds you spend waiting on Claude Code into kana practice.
Run `kanthropic session` and you get a tmux layout where **Claude is on top** and a
**kana flashcard pane pops up underneath the moment Claude starts thinking** — type
the rōmaji, and it closes again when Claude is done. Your keyboard focus auto-switches
between the two. On terminals that support inline images, the kana render as **real,
crisp glyphs** (not ASCII art).

It's spaced-repetition backed ([FSRS](https://github.com/open-spaced-repetition/ts-fsrs)),
so it surfaces the characters you don't know yet, and your progress shows in the Claude
status line.

```
┌─────────────────────────────┐
│  claude  >  explain promises │   ← you ask Claude something
│  ⋯ thinking ⋯                │
├─────────────────────────────┤
│            ┌──┐             │
│            ばば              │   ← kana pane opens below while it thinks
│            └──┘             │
│  → ba ✓                     │   ← type the reading; focus is here automatically
└─────────────────────────────┘
```

## Requirements

- **macOS or Linux** (Windows via WSL) — the session uses tmux
- **Node.js ≥ 18** (`node -v`)
- **tmux** built with **sixel** support — for the in-session image rendering.
  `brew install tmux` on macOS ships a sixel-enabled build (3.5+). Check with:
  ```sh
  tmux -V && (strings "$(which tmux)" | grep -qi sixel && echo "sixel: yes" || echo "sixel: no")
  ```
  (Without sixel-tmux the session still works — it just falls back to chafa braille.)
- **Claude Code** CLI (`claude`)
- An **image-capable terminal** for the crisp rendering (see *Enable images* below). Anything
  else degrades to chafa braille symbol-art automatically.

A kana font (a subset of [Noto Sans JP](https://github.com/notofonts/noto-cjk), OFL) is
**bundled** in `assets/fonts/`, so glyphs render with no system font needed. Point
`KANTHROPIC_FONT=/path/to/font.ttf` to use a different one.

## Install

```sh
npm install -g kanthropic
```

Or from source (for development):
```sh
git clone https://github.com/ProximoBinks/kanthropic.git
cd kanthropic && npm install && npm link   # `npm link` requires keeping the folder put
```

## Enable images (VS Code / Antigravity / Cursor)

The integrated terminal can show real images, but it's **off by default**. Turn it on:

1. **`Cmd+Shift+P`** → **“Preferences: Open User Settings (JSON)”** and add:
   ```json
   "terminal.integrated.enableImages": true
   ```
2. **`Cmd+Shift+P`** → **“Developer: Reload Window”**.
3. **Open a new terminal** (the setting only applies to terminals opened after the reload).
4. Confirm it works:
   ```sh
   kanthropic imagetest
   ```
   If you see a crisp **ば**, you're set. If you see a wall of text instead, images aren't
   active in this terminal — kanthropic falls back to chafa braille symbol-art (still fine), or run
   `kanthropic config --image off` to force chafa braille.

> Already using a native image terminal (iTerm2, kitty, WezTerm, Ghostty)? Then standalone
> `kanthropic drill` shows images with no setup. The **session** (tmux) needs sixel-tmux.

## Set it up

```sh
kanthropic setup    # installs the status line + hooks, then prints an environment check
```

`kanthropic doctor` re-runs that check any time (node, tmux + sixel, font, terminal image
support, install state). Or do it manually:
```sh
kanthropic install         # adds a kana progress summary to the Claude status line
kanthropic hooks-install   # wires Claude hooks so the kana pane auto-opens/closes
```

Rendering defaults to **`auto`** — real images where the terminal supports them, chafa braille symbol-art
otherwise (it never prints garbage). To force it either way:
```sh
kanthropic config --image on    # always images (e.g. for recording a demo)
kanthropic config --image off   # always chafa braille symbol-art
```

Both edits are **fully reversible** and preserve anything you already had:
```sh
kanthropic uninstall        # remove the status line
kanthropic hooks-uninstall  # remove the hooks
```

## Use it

**The main flow — kana while you code:**
```sh
kanthropic session            # opens tmux: Claude on top, kana pane pops up while it thinks
kanthropic session --resume   # forwards any args to claude (resume a conversation, etc.)
```
Submit a prompt to Claude → the kana pane opens below and focus jumps to it → type rōmaji →
when Claude finishes, the pane closes and you're back in Claude. Scroll Claude's chat with the
**mouse wheel** (hold **Option/Shift** to select text).

### Leaving & coming back

The session runs in the background (a tmux server), so it keeps going even after you close the
terminal.

| You want to… | Do this |
| --- | --- |
| **Step away but keep it running** | **`Ctrl-b` then `d`** (detach). Come back with `kanthropic session`. |
| **Come back to it** | `kanthropic session` (same name) — reattaches to the running session |
| **Quit Claude** (but stay in the session) | `Ctrl-C` a couple times, or type `/exit` in Claude |
| **End the session for good** | quit Claude, then type **`exit`** in the shell (closes the pane → ends the session) |

> ⚠️ `exit` **ends** the session (and the running Claude). If you just want to step away, **detach**
> with `Ctrl-b d` instead — that keeps everything running.

**After a reboot** the tmux session is gone (it lives in RAM), but your **Claude conversation is
saved** — bring it back with `kanthropic session --resume`. Your kana progress is always on disk.

**Run several windows at once** — give each session a name:
```sh
kanthropic session work       # → tmux session "kanthropic-work"
kanthropic session personal   # → a second, independent session
```
Each window gets its **own** Claude pane and its **own** kana pop-up — they open and close
independently. Your FSRS progress is **shared** across them (one unified schedule in
`~/.kanthropic/progress.json`). Pass claude args after the name: `kanthropic session work --resume`.
List sessions with `tmux ls`.

**Learn new kana first (any terminal window):**
```sh
kanthropic learn              # row-by-row: big image + rōmaji + hira↔kata + a mnemonic
```
`learn` is the **only** place new characters enter your rotation. Pick a row, walk it, and it's
added to your practice pool. Everything else (`drill`, the session pane) only reinforces what
you've already learned — so you're never ambushed by a character you haven't seen.

The row list reflects your **actual** mastery, drawn from your FSRS deck (so it updates as you
drill anything): `✓` mastered (every character in the row at FSRS *Review*), `◐ m/n` learning
(some progress), `·` new. Type `-N` to **reset row N** — forget its cards and pull it out of the
pool, so it goes back to `· new`. Press `s` to **switch between hiragana and katakana** without
leaving the menu (or start on one with `kanthropic learn --script katakana`).

**Practice what you've learned (any terminal window):**
```sh
kanthropic drill              # endless flashcards, image rendering, FSRS-scored
kanthropic drill --count 25   # a fixed 25-card session ending in a recap
kanthropic drill --script katakana
```
When you're caught up (nothing due), the drill doesn't auto-add new characters (so it never
ambushes you with one you haven't been taught). Instead it offers two keys — right there, no
terminal-switching:
- **`n` — learn the next row**: runs the proper learn walk (image + mnemonic) for the next
  un-learned row, then drops you straight back into drilling it. Works from the "nothing learned
  yet" screen too, so you can start from zero inside the drill/session.
- **`r` — practice anyway**: keep drilling your whole learned set, ignoring the FSRS due timers
  (handy when you're studying just one row). A `⟳` in the status line marks the mode; it doesn't
  corrupt your real schedule.

**Switch script mid-drill:** type `/h` or `/k` at the answer prompt to flip between hiragana and
katakana without restarting — this works in the **session pane** too, and persists as your
default. (The session otherwise opens on your configured default; set it with `kanthropic config
--script katakana`.)

**Check / tune:**
```sh
kanthropic status                       # install state + your progress
kanthropic config --script katakana     # default script
kanthropic config --image on|auto|off   # image rendering mode
kanthropic config --advance off         # disable auto-advance (see below)
kanthropic imagetest ば                  # check image rendering here
kanthropic reset --script hiragana      # wipe a script's progress (asks first; --yes to skip)
```

**Hiragana &amp; katakana** are both fully supported (all 104 characters each, with separate
progress). By default the drill starts on hiragana and **auto-advances to katakana** once
you've mastered every hiragana (each graduated to FSRS *Review*) — you'll get a 🎉 and it
switches. Turn that off with `kanthropic config --advance off`, or jump straight in with
`--script katakana`.

## Commands

| Command | What it does |
| --- | --- |
| `setup` | install the status line + hooks, then print the environment check |
| `doctor` | environment check — node, tmux + sixel, font, terminal image support, install state |
| `session [name] [claude args]` | tmux layout: Claude + auto-opening kana pane. A `name` makes a separate, independent window; remaining args pass to `claude` |
| `learn [--script k]` | learn new kana row-by-row (image + rōmaji + partner + mnemonic); the only place characters enter your practice pool. In the menu: `N` study row · `-N` reset row · `s` switch script |
| `drill [--script k] [--count N]` | practice your learned kana — endless image flashcards, or `--count N` for a fixed scored session with a recap. At the prompt: `/h` `/k` switch script. When caught up: `n` learn next row · `r` practice anyway |
| `reset [--script k] [--yes]` | wipe FSRS progress + the learned pool for a clean slate (both scripts unless `--script`); asks before deleting |
| `install` / `uninstall` | add / remove the kana progress status line |
| `hooks-install` / `hooks-uninstall` | wire / remove the auto-open-pane hooks |
| `status` | install state + progress per script |
| `config [opts]` | set `--script`, `--image on\|auto\|off`, `--advance on\|off`, `--front`/`--back` ms |
| `imagetest [glyph]` | check image rendering here (else the drill uses chafa braille) |

## How it works

- **Hooks** (`UserPromptSubmit` / `Stop` in `~/.claude/settings.json`) write a state file and,
  inside any `kanthropic*` tmux session, split/kill that session's kana pane (tracked per
  session in `~/.kanthropic/sessions/`, so multiple windows stay independent).
- **Rendering** rasterizes the font outline (opentype.js) and emits a **sixel** image inside
  tmux (which stores it in its grid so it survives redraws), an **iTerm2** image standalone,
  or **chafa braille symbol-art** as a universal fallback.
- **Scheduling** uses real FSRS (`ts-fsrs`); progress lives in `~/.kanthropic/progress.json`,
  shared across all sessions (atomic writes, so concurrent windows never corrupt it).
- **A learned pool gates the drill** — `learn` is the only way a character enters rotation, so
  the drill and session pane only ever reinforce kana you've deliberately studied. The `learn`
  row icons read your live FSRS state (`✓` mastered / `◐` learning / `·` new), and `reset` (or
  `-N` in the menu) clears it back out.
- Everything is **reversible** — the status line and hooks are removed cleanly, preserving any
  config you already had, and your progress is kept.

## Uninstall

```sh
kanthropic uninstall
kanthropic hooks-uninstall
npm unlink -g kanthropic        # remove the global command
```
Your progress (`~/.kanthropic/progress.json`) is kept unless you delete `~/.kanthropic`.

## Notes / troubleshooting

- **Image shows as garbled text** → images aren't active in that terminal. Enable them (above)
  or `kanthropic config --image off`.
- **Session shows chafa braille symbol-art instead of images** → run `kanthropic config --image on` to force
  it (auto-detection can miss when a session is reattached from another window).
- **Can't scroll Claude's chat in the session** → the session enables `mouse on`; scroll the
  Claude pane with the wheel (hold **Option/Shift** to select text).
- **`tmux is not installed`** → `brew install tmux`.

## Tests

```sh
npm test
```

## License

MIT
