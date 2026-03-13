# Chuck — Claude Hook for Universal Context Keeper

> Fewer tokens. Smarter context. Zero sacrifice.

Chuck is a dynamic rule injection system for Claude Code. Instead of a bloated static `CLAUDE.md`, Chuck loads only the rules relevant to your current task — automatically.

## How It Works

1. You write domain rule files (markdown) for different contexts (React, Git, TypeScript, etc.)
2. Chuck's hook fires on every prompt via Claude Code's `UserPromptSubmit` hook
3. It semantically matches your prompt against domain triggers using TF-IDF scoring
4. Only matching rules get injected — staying under your token budget
5. Context-aware: injects fewer rules as your context window fills up

## Installation

```bash
npm install -g chuck-core
```

## Quick Start

```bash
# 1. Initialize in your project (auto-detects your stack)
chuck init

# 2. Wire up the Claude Code hook
chuck install-hook

# 3. See what was set up
chuck list
```

Restart Claude Code. Done — Chuck is running.

## Commands

```bash
chuck init              # Scan project, generate starter rules + manifest
chuck list              # Show active domains and token costs
chuck add <pack>        # Install a rule pack (built-in or npm)
chuck audit             # Find dead, bloated, or conflicting rules
chuck stats             # Token savings and domain usage over time
chuck install-hook      # Wire the hook into Claude Code settings
```

## Built-in Packs

```bash
chuck add react         # React best practices
chuck add expo          # Expo SDK rules
chuck add typescript    # TypeScript type safety
chuck add supabase      # Supabase DB/auth/RLS/edge functions
chuck add git           # Git workflow conventions
chuck add claude-api    # Anthropic Claude API usage
```

## Project Structure

After `chuck init`, a `.chuck/` folder is created:

```
.chuck/
├── manifest.json         # Domain config and token budget
├── domains/
│   ├── global.md         # Always-on rules (< 200 tokens)
│   ├── react.md          # Loaded when prompt mentions React
│   ├── git.md            # Loaded on git-related prompts
│   └── ...
├── commands/
│   └── review.md         # Loaded via *review star-command
└── sessions/             # Per-session tracking for effectiveness scoring
```

## Manifest Format

```json
{
  "domains": {
    "react": {
      "trigger": {
        "keywords": ["component", "react", "tsx"],
        "fuzzy": true,
        "operator": "OR"
      },
      "rules_file": "domains/react.md",
      "priority": 2,
      "description": "React component rules"
    }
  },
  "token_budget": 2000,
  "devmode": false
}
```

### Trigger Options

| Option | Default | Description |
|--------|---------|-------------|
| `keywords` | `[]` | Words that activate this domain |
| `fuzzy` | `true` | Match prefix variants ("react" matches "reactnative") |
| `operator` | `"OR"` | `"AND"` requires ALL keywords to match |

### Special Domains

- **`GLOBAL`** — always injected, no keyword check (keep under 200 tokens)
- **`always_on: true`** — injected every prompt regardless of keywords
- **`*command`** — type `*review` in your prompt to manually load `commands/review.md`

### Context Brackets

Chuck automatically reduces injections as context fills:

| Fill | Budget used |
|------|------------|
| < 30% | 100% |
| 30–60% | 75% |
| 60–85% | 50% |
| > 85% | 25% |

## Token Budget

Set `token_budget` in manifest.json (default: 2000). Rules are ranked by relevance score and trimmed from the bottom up when over budget.

Run `chuck audit` to find bloated or unused rules.

## vs CARL

| Feature | CARL | Chuck |
|---------|------|-------|
| Matching | Exact keywords | TF-IDF semantic scoring |
| Rule creation | Manual | Auto-generated from stack detection |
| Learning | None | Session-based effectiveness tracking |
| Conflict resolution | None | Priority + budget system |
| Team sharing | None | Git-friendly JSON manifest |
| CLI | Basic | Full (init/list/add/audit/stats) |
| Rule packs | None | Built-in + npm ecosystem |
| Trigger conditions | Keywords only | Keywords + file types + git branch |

## License

MIT
