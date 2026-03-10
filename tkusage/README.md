# tkusage

Unified local usage and estimated cost reporting for Claude Code and Codex.

`tkusage` is a standalone CLI. It reads local logs directly from `~/.claude/projects` and `~/.codex/sessions`, so normal report generation is fully offline.

## Commands

```bash
# merged daily report
npx tkusage daily

# monthly report for one source
npx tkusage monthly 2026-03 --source codex

# session report
npx tkusage session --source all --compact

# one-line bar/status output
npx tkusage statusline
```

## Flags

```bash
--source all|claude|codex
--since YYYY-MM-DD
--until YYYY-MM-DD
--timezone America/Los_Angeles
--locale en-US
--json
--compact
--breakdown
--claude-home /path/to/.claude
--codex-home /path/to/.codex
--format plain|json   # statusline only
```

## Notes

- `Cost` is an estimated USD equivalent derived from embedded token pricing tables.
- It is not the same thing as your actual ChatGPT/Codex subscription billing or Anthropic invoice.
- Claude usage is deduplicated by `requestId` because transcript logs can repeat the same assistant usage entry more than once.
