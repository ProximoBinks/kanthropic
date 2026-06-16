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
│            ┌──┐              │
│         ばば      │   ← kana pane opens below while it thinks
│            └──┘              │
│  → ba ✓                     │   ← type the reading; focus is here automatically
└─────────────────────────────┘
```

## Requirements

- **Node.js ≥ 18** (`node -v`)
- **tmux** built with **sixel** support — for the in-session image rendering.
  `brew install tmux` on macOS ships a sixel-enabled build (3.5+). Check with:
  ```sh
  tmux -V && (strings "$(which tmux)" | grep -qi sixel && echo "sixel: yes" || echo "sixel: no")
  ```
  (Without sixel-tmux the session still works — it just falls back to block-art glyphs.)
- **Claude Code** CLI (`claude`)
- **A Japanese font** on disk so glyphs can be rasterized. macOS usually has one; if not,
  install [Noto Sans JP](https://fonts.google.com/noto/specimen/Noto+Sans+JP) (or point
  `KANTHROPIC_FONT=/path/to/font.ttf`). Without a font it falls back to the plain terminal character.
- An **image-capable terminal** for the crisp rendering (see *Enable images* below). Anything
  else degrades to block-art automatically.

## Install

```sh
git clone https://github.com/ProximoBinks/kanthropic.git
cd kanthropic
npm install
npm link            # puts the `kanthropic` command on your PATH
```

`npm link` symlinks the global `kanthropic` command to this repo, so **keep the folder
where it is** (the hooks and status-line script reference it).

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
   active in this terminal — kanthropic will fall back to block-art (still fine), or run
   `kanthropic config --image off` to force blocks.

> Already using a native image terminal (iTerm2, kitty, WezTerm, Ghostty)? Then standalone
> `kanthropic drill` shows images with no setup. The **session** (tmux) needs sixel-tmux.

## Set it up

```sh
kanthropic install         # adds a kana progress summary to the Claude status line
kanthropic hooks-install   # wires Claude hooks so the kana pane auto-opens/closes
kanthropic config --image on   # always render images (or `auto` to detect, `off` for blocks)
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
when Claude finishes, the pane closes and you're back in Claude. Detach with `Ctrl-b` then `d`;
re-run `kanthropic session` to reattach.

**Practice on its own (any terminal window):**
```sh
kanthropic drill              # endless flashcards, image rendering, FSRS-scored
kanthropic study              # a fixed ~25-card session with a recap
kanthropic drill --script katakana
```

**Check / tune:**
```sh
kanthropic status                       # install state + your progress
kanthropic config --script katakana     # default script
kanthropic config --image on|auto|off   # image rendering mode
kanthropic glyphtest みょ                # compare block-art styles
kanthropic imagetest ば                  # test image rendering here
```

## Commands

| Command | What it does |
| --- | --- |
| `session [claude args]` | tmux layout: Claude + auto-opening kana pane (forwards args to `claude`) |
| `drill [--script k]` | endless image flashcards, FSRS-scored |
| `study [--script k] [--count N]` | a fixed scored session with a recap |
| `install` / `uninstall` | add / remove the kana progress status line |
| `hooks-install` / `hooks-uninstall` | wire / remove the auto-open-pane hooks |
| `status` | install state + progress per script |
| `config [opts]` | set `--script`, `--image on\|auto\|off`, `--style half\|quad\|braille`, `--front`/`--back` ms |
| `glyphtest [glyph]` | preview the block-art styles |
| `imagetest [glyph]` | test real-image rendering |

## How it works

- **Hooks** (`UserPromptSubmit` / `Stop` in `~/.claude/settings.json`) write a state file and,
  inside the `kanthropic` tmux session, split/kill the kana pane and switch focus.
- **Rendering** rasterizes the font outline (opentype.js) and emits a **sixel** image inside
  tmux (which stores it in its grid so it survives redraws), an **iTerm2** image standalone,
  or **block-art** as a universal fallback.
- **Scheduling** uses real FSRS (`ts-fsrs`); progress lives in `~/.kanthropic/progress.json`.
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
- **Session shows block-art instead of images** → run `kanthropic config --image on` to force
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
