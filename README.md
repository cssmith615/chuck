# Chuck — Smarter Context for Claude Code

> Give Claude the right rules at the right time. Nothing more.

Claude Code reads your `CLAUDE.md` on every single prompt — whether it's relevant or not. For large projects that means hundreds of tokens wasted on rules Claude doesn't need right now.

Chuck fixes that. It watches what you type, figures out what kind of work you're doing, and quietly injects only the rules that matter — staying well under your token budget automatically.

---

## What Chuck does

- **Reads your prompt** — before Claude sees it
- **Scores it** against your domain rules using semantic matching (TF-IDF, not dumb keyword search)
- **Injects only what's relevant** — React rules when you're building components, Git rules when you're committing, nothing when you're asking an unrelated question
- **Scales back automatically** as your context window fills up
- **Learns over time** — tracks which rules fire and how strongly, surfaces dead weight

---

## Installation

```bash
npm install -g chuck-core
```

Requires Node 18+ and Python 3.

---

## Quick Start

```bash
# 1. Initialize in your project (auto-detects your stack)
chuck init

# 2. Wire up the hook
chuck install-hook

# 3. See what was set up
chuck list
```

Restart Claude Code. That's it — Chuck is running silently in the background.

---

## Commands

```bash
chuck init              # Scan project, auto-generate starter rules from your stack
chuck list              # Show active rule sets and token costs
chuck add <pack>        # Install a built-in rule pack
chuck audit             # Find dead, bloated, or conflicting rules
chuck stats             # See which rules are firing and how effectively
chuck suggest           # Analyze gaps — get suggestions for new rules based on your actual prompts
chuck sync              # Push/pull rules via git for team sharing
chuck install-hook      # Wire the hook into Claude Code settings
```

---

## Built-in Packs

```bash
chuck add react         # React component best practices
chuck add expo          # Expo SDK + React Native rules
chuck add typescript    # TypeScript type safety
chuck add supabase      # Supabase DB / auth / RLS / edge functions
chuck add git           # Git workflow conventions
chuck add claude-api    # Anthropic Claude API usage
```

---

## How the intelligence works

### Semantic matching
Chuck uses TF-IDF scoring — not a simple word list. "I'm building a new screen" triggers React Native rules even without the word "react". Fuzzy prefix matching means "component", "components", and "componentize" all count.

### Effectiveness tracking
Every time a rule set fires, Chuck records the relevance score. Over time `chuck stats` shows you which domains are genuinely useful and which are just noise. `chuck suggest` analyzes the prompts that *didn't* match anything and recommends what to add.

### Context-aware budgeting
Chuck automatically tightens its token budget as your context fills:

| Context used | Budget |
|---|---|
| < 30% | Full (2000t default) |
| 30–60% | 75% |
| 60–85% | 50% |
| > 85% | 25% |

Late in a long session — when every token counts — Chuck is at its most conservative.

---

## Project structure

After `chuck init`:

```
.chuck/
├── manifest.json         # Rule config and token budget
├── domains/
│   ├── global.md         # Always-on rules (keep under 200 tokens)
│   ├── react.md          # Fires on React-related prompts
│   ├── git.md            # Fires on git-related prompts
│   └── ...
├── commands/
│   └── review.md         # Load manually with *review in your prompt
└── sessions/             # Local usage data for effectiveness scoring
```

---

## Manifest format

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

### Trigger options

| Option | Default | Description |
|--------|---------|-------------|
| `keywords` | `[]` | Terms that activate this rule set |
| `fuzzy` | `true` | Prefix matching — "react" matches "reactnative" |
| `operator` | `"OR"` | `"AND"` requires ALL keywords to match |

### Special domains

- **`GLOBAL`** — always injected regardless of prompt (keep ruthlessly short)
- **`always_on: true`** — same behavior for any named domain
- **`*command`** — type `*review` to manually load `commands/review.md`

---

## Team sharing

```bash
chuck sync           # Commit and push .chuck/ to your repo
chuck sync --pull    # Pull latest rules from remote
chuck sync -m "Add API rules"   # Custom commit message
```

Session data (`.chuck/sessions/`) is automatically excluded from git — only rule files are shared.

---

## WSL (Windows Subsystem for Linux)

Chuck detects WSL automatically and handles path normalization. A few things to know:

**Run `chuck install-hook` from WSL, not PowerShell.**
Claude Code running in WSL reads settings from `~/.claude/settings.json` (your WSL home, e.g. `/home/yourname`). Running the install from WSL ensures the hook path is written in `/mnt/c/...` format that WSL bash can execute.

**If Claude Code becomes unusable after installing the hook:**
1. At the Claude Code startup prompt, choose **"Continue without these settings"** — this bypasses the hook so you can fix things.
2. Or open `~/.claude/settings.json` and delete the `"hooks"` block, then restart.

**Verify your hook path looks like this:**
```json
"command": "python3 /mnt/c/Users/yourname/chuck/src/hook/chuck-hook.py"
```
If you see `C:\Users\...` backslash paths, re-run `chuck install-hook` from WSL.

**Make sure python3 is installed in WSL:**
```bash
python3 --version
# If not found:
sudo apt install python3
```

---

## License

MIT
