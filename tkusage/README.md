# tkusage

Unified local usage reporting for Claude Code, Codex, and OpenClaw.

`tkusage` reads your local logs from `~/.claude/projects`, `~/.codex/sessions`, and `~/.openclaw/agents/*/sessions`, builds a cache, and prints source-aware daily, monthly, session, and statusline reports. It does not depend on `ccusage` or `@ccusage/codex` at runtime.

Feature update: `tkusage` now supports OpenClaw daily token and cost reporting with `--source openclaw`.

![tkusage demo](https://raw.githubusercontent.com/Jaredw2289-svg/ccdash/main/tkusage/assets/demo.gif)

## Why it exists

- One CLI for Claude Code, Codex, and OpenClaw
- Fully local reporting after install
- Estimated USD output with embedded pricing tables
- Daily output that merges the date column while keeping Claude and Codex separate
- Normalized token columns so Claude and Codex rows are directly comparable
- Fast warm-cache runs for bars and repeated checks

## Install

```bash
# one-off
npx tkusage daily --source all

# bun users
bunx tkusage daily --source all

# global install
npm install -g tkusage
```

## Quick start

```bash
# merged daily report
npx tkusage daily --source all

# date-filtered daily report
npx tkusage daily --source all --since 2026-03-01 --until 2026-03-09
```

## Date filters

Use `--since` and `--until` to limit the report range:

```bash
npx tkusage daily --source all --since 2026-03-01 --until 2026-03-09
```

## What it shows

- `daily`: token and cost estimates grouped by day
- `monthly`: the same rollup grouped by month
- `session`: per-session usage and recency
- `statusline`: a compact one-line summary for shell bars or window managers

## Common flags

```bash
--source all|claude|codex|openclaw
--since YYYY-MM-DD
--until YYYY-MM-DD
--timezone America/Los_Angeles
--locale en-US
--json
--compact
--breakdown
--claude-home /path/to/.claude
--codex-home /path/to/.codex
--openclaw-home /path/to/.openclaw
--main-thread-only         # Claude only: exclude sidechains/subagents
--format plain|json   # statusline only
```

## Example output

```text
tkusage daily report
Selection: all
Pricing: Estimated USD using embedded Claude and Codex token pricing plus native OpenClaw session-log costs when available. Claude totals include sidechains/subagents by default unless --main-thread-only is set. Not a vendor billing statement.
Tokens: Input = total prompt input, Cached = cached subset of input, Output includes reasoning, Total = Input + Output.

┌────────────┬────────┬──────┬──────────────┬─────────────┬─────────────┬───────────┬─────────────┬─────────┐
│ Date       │ Source │ Sess │ Models       │       Input │      Cached │    Output │       Total │    Cost │
├────────────┼────────┼──────┼──────────────┼─────────────┼─────────────┼───────────┼─────────────┼─────────┤
│ 2026-03-07 │ Claude │   13 │ • opus-4-6   │  57,192,635 │  57,186,549 │   477,030 │  57,669,665 │  $72.43 │
│            ├────────┼──────┼──────────────┼─────────────┼─────────────┼───────────┼─────────────┼─────────┤
│            │ Codex  │    6 │ • gpt-5.4    │  38,799,713 │  36,998,144 │   302,821 │  39,102,534 │  $18.30 │
├────────────┼────────┼──────┼──────────────┼─────────────┼─────────────┼───────────┼─────────────┼─────────┤
│ 2026-03-08 │ Claude │    4 │ • opus-4-6   │   8,729,612 │   8,724,119 │    70,994 │   8,800,606 │  $10.56 │
│            ├────────┼──────┼──────────────┼─────────────┼─────────────┼───────────┼─────────────┼─────────┤
│            │ Codex  │    1 │ • gpt-5.4    │   9,237,933 │   8,838,400 │   107,986 │   9,345,919 │   $4.83 │
├────────────┼────────┼──────┼──────────────┼─────────────┼─────────────┼───────────┼─────────────┼─────────┤
│ Total      │        │      │              │ 333,038,959 │ 321,292,317 │ 2,565,045 │ 335,604,004 │ $259.03 │
└────────────┴────────┴──────┴──────────────┴─────────────┴─────────────┴───────────┴─────────────┴─────────┘
```

## Data sources

- Claude Code: `~/.claude/projects/**/*.jsonl`
- Codex: `~/.codex/sessions/**/*.jsonl`
- OpenClaw: `~/.openclaw/agents/*/sessions/*.jsonl`

If you store logs elsewhere, use `--claude-home`, `--codex-home`, or `--openclaw-home`.

## Cost model

- `Cost` is an estimated USD equivalent derived from embedded token pricing tables for Claude/Codex
- OpenClaw uses the native `usage.cost.total` value already stored in its session logs when available
- Claude reports include sidechains/subagents by default; use `--main-thread-only` to restore the older main-transcript-only view
- It is not your Anthropic invoice
- It is not your ChatGPT subscription or Codex credits statement
- It is not your OpenClaw vendor billing statement

## Notes

- `Input` is normalized to total prompt input for both sources
- `Cached` is the cached subset of `Input`
- `Output` includes reasoning tokens when the source exposes them
- `Total` is `Input + Output`
- Claude usage is deduplicated by `requestId` because transcript logs can repeat usage events
- Claude request deduping also collapses duplicate request IDs that appear in both main and subagent transcripts
- Codex usage is reconstructed from cumulative token snapshots, so repeated snapshots do not double count
- OpenClaw usage is read from assistant message usage blocks and skips zero-usage/internal mirror events
- The first run may take a while on large session folders because it builds the local cache

## Development

```bash
cd tkusage
bun install
bun run test
bun run build
bun run demo
```

`bun run demo` regenerates the GIF used in the README at `tkusage/assets/demo.gif`.
