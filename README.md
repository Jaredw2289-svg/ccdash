<div align="center">

# dashcc

A rich status bar for [Claude Code](https://claude.ai/code).

[![npm](https://img.shields.io/npm/v/dashcc)](https://www.npmjs.com/package/dashcc)
[![license](https://img.shields.io/npm/l/dashcc)](LICENSE)

<br/>

<img src="https://raw.githubusercontent.com/Jaredw2289-svg/ccdash/main/screenshots/demo.svg" width="800" alt="dashcc demo"/>

</div>

---

## Install

> **Note:** Use `npx` — do not run `npm i dashcc` directly, as it may cause peer dependency conflicts.

```bash
npx dashcc --install
```

Restart Claude Code. Done.

## Uninstall

```bash
npx dashcc --uninstall
```

## Configure

```bash
npx dashcc
```

Opens an interactive TUI to customize widgets, colors, layout, and more.

## Responsive Terminal Behavior

The default terminal width mode is now `Responsive stable`.

- `narrow` terminals reserve 50% of the measured width
- `medium` terminals reserve 30%
- `wide` terminals reserve 20%

That reserve is recalculated on every status line render, so the layout can shrink and expand cleanly between Claude Code turns instead of getting stuck in a compact state.

The default dashboard also compacts high-width widgets by priority:

- context bars shorten first
- session and weekly usage lines shorten their suffixes on medium widths
- session and weekly usage lines keep only the bar and percentage on narrow widths
- long `Goal` and `Now` summaries wrap by display width and clamp to 2 lines

Temporary Claude UI notices such as update messages are rendered as their own auxiliary line instead of competing with the main dashboard row.

---

## Status Bar Layout

The default layout has 4 lines. Each line is fully customizable via the TUI.

```
Opus 4.6 · 1hr 24m · Session spending: $15.78 · [████████░░░░] 63k/200k (32%)
Session: [████░░░░] 26.0% · 0h19m left · Weekly: [██████░░░░] 28.0% · resets Thu 10pm
ccdash · Goal: Publish dashcc to npm
Now: Added --install and --uninstall CLI flags
```

**Line 1** — Model, session duration, cost, and a context window progress bar.

**Line 2** — API usage for the current block and the weekly quota, with countdown timers.

**Line 3** — Project name and the session goal. The model writes the goal on its first response and updates it when the objective shifts.

**Line 4** — What just happened. The model updates this after every response so you can glance at progress without scrolling.

You can change the width strategy in the TUI under `Terminal Width`, but `Responsive stable` is the recommended default for terminal usage.

## All widgets

| Category | Widgets |
|----------|---------|
| Model | Model, Version, Output Style |
| Git | Branch, Changes, Insertions, Deletions, Root Dir, Worktree |
| Tokens | Input, Output, Cached, Total |
| Speed | Input Speed, Output Speed, Total Speed |
| Context | Length, %, % Usable, Context Bar |
| Session | Clock, Cost, Name, ID, Status Summary, Skills |
| Timers | Block Timer, Block Reset, Weekly Reset |
| Usage | Session Usage, Weekly Usage |
| System | Working Dir, Terminal Width, Memory |
| Custom | Custom Text, Custom Command, Link |
| Layout | Separator, Flex Separator |

## License

[MIT](LICENSE)
