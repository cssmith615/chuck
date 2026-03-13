# Chuck — Smarter Context for Claude Code

> Give Claude the right rules at the right time. Nothing more.

Claude Code reads your `CLAUDE.md` on every single prompt — whether it's relevant or not. For large projects that means hundreds of tokens wasted on rules Claude doesn't need right now. And when context fills, Claude forgets the decisions you made weeks ago and re-suggests exactly what you already rejected.

Chuck fixes both problems. It watches what you type, injects only the rules that matter, remembers your architectural decisions, and catches contradictions before they land in your code.

---

## What Chuck does

- **Injects only relevant rules** — React rules when building components, Git rules when committing, nothing for unrelated prompts
- **Remembers your decisions** — "Use Zustand, not Redux" stays in context across every session
- **Catches contradictions** — warns immediately if Claude starts writing code that violates a logged decision
- **Generates session handoffs** — `chuck compact` distills your work into a brief for new sessions or `/compact`
- **Learns over time** — tracks which rules fire and surfaces dead weight
- **Scales back automatically** — tighter budget as context fills

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

# 2. Install the context injection hook
chuck install-hook

# 3. (Optional) Install the quality monitor hook
chuck install-monitor

# 4. See what was set up
chuck list
```

Restart Claude Code. Chuck runs silently in the background on every prompt.

---

## Commands

### Rules & Setup
```bash
chuck init              # Scan project, auto-generate starter rules from your stack
chuck list              # Show active rule sets and token costs
chuck add <pack>        # Install a built-in rule pack
chuck audit             # Find dead, bloated, or conflicting rules
chuck stats             # See which rules are firing and how effectively
chuck suggest           # Get suggestions for new rules based on your actual prompts
chuck sync              # Push/pull rules via git for team sharing
chuck install-hook      # Install context injection (UserPromptSubmit hook)
chuck install-monitor   # Install quality monitor (PostToolUse hook)
```

### Decision Ledger
```bash
chuck decide "Use Zustand for state management" --tags state,react
                        # Log a decision — prompts for rejected alternatives and reason
chuck decide            # List all active decisions
chuck decide:list --tag state        # Filter by tag
chuck decide:list --all              # Include superseded decisions
chuck decide:show dec_zustand        # Full detail on one decision
chuck decide:supersede dec_zustand   # Mark as replaced (keeps history)
chuck decide:remove dec_zustand      # Hard delete
chuck decide:audit      # Find decisions that have never fired (stale candidates)
```

### Session Management
```bash
chuck compact           # Generate a session handoff brief (paste to start new session)
chuck compact -o brief.md            # Write to file
chuck compact -s 10     # Analyze last 10 sessions (default: 5)
```

---

## Decision Ledger

Every project accumulates decisions: "Use Zustand, not Redux", "Never use the uuid package — ESM breaks Metro", "All types in src/types/index.ts". These live in developer heads or get buried in CLAUDE.md. New session — Claude forgets. You re-explain. Quality drifts.

Chuck stores decisions as structured records and automatically injects relevant ones when the topic surfaces:

```
<!-- DECISIONS -->
✓ Use Zustand for state management (not Redux — boilerplate; not Context API — re-renders)
✓ UUID: inline crypto.getRandomValues — no uuid package (ESM/Metro)
```

Dense. One line per decision. Claude reads it, adjusts, moves on.

### Logging a decision

```bash
chuck decide "Use Zustand for state management" --tags state,react,architecture
# Chuck prompts:
#   What alternatives were rejected? Redux, Context API
#   Why was this decided? Redux boilerplate too heavy for mobile
#   Any constraints? React Native, mobile performance
```

Decisions live in `.chuck/decisions/` as JSON — versioned with your project, shared via `chuck sync`.

### Decision format

```json
{
  "id": "dec_use_zustand_for_state_management",
  "decision": "Use Zustand for state management",
  "rejected": ["Redux", "Context API"],
  "reason": "Redux boilerplate too heavy for mobile; Context API caused re-render issues",
  "constraints": ["React Native", "mobile performance"],
  "tags": ["state", "architecture", "react"],
  "date": "2026-03-13",
  "status": "active"
}
```

---

## Output Quality Monitor

Install a second hook that watches code being written in real time:

```bash
chuck install-monitor
```

After every `Write` or `Edit` tool call, Chuck checks the content against your active decisions. If Claude starts writing code that contradicts one:

```
⚠️  Chuck detected possible decision conflict in Write(myStore.ts):

  • Writing "Redux" conflicts with decision:
    ✓ Use Zustand for state management
    Reason: Redux boilerplate too heavy for mobile
    ID: dec_use_zustand_for_state_management

If this decision has changed: chuck decide:supersede dec_use_zustand_for_state_management
If intentional: ignore this warning.
```

**Token cost:** 0 on clean code. ~30–50 tokens only when a contradiction is caught — which prevents the 200–500 token correction loop you'd have otherwise.

---

## Session Handoff

When context fills or you start a fresh session, `chuck compact` generates a structured brief from your session history:

```bash
chuck compact
chuck compact -o handoff.md
```

Output includes active work areas (by domain hit frequency), all logged decisions, recent git commits, and last diff stat. Paste it at the start of a new session — Chuck re-injects the rules automatically as you work.

---

## How the intelligence works

### Semantic matching
Chuck uses TF-IDF scoring — not a simple keyword list. "I'm building a new screen" triggers React Native rules even without the word "react". Fuzzy prefix matching means "component", "components", and "componentize" all count.

### Effectiveness tracking
Every rule injection is scored. `chuck stats` shows which domains are genuinely useful vs noise. `chuck suggest` clusters unmatched prompts and recommends what to add.

### Context-aware budgeting
Chuck tightens its token budget automatically as context fills:

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
├── decisions/
│   ├── dec_use_zustand.json
│   └── ...               # One file per logged decision
├── commands/
│   └── review.md         # Load manually with *review in your prompt
└── sessions/             # Local usage data (gitignored)
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
- **`*command`** — type `*review` in your prompt to manually load `commands/review.md`

---

## Team sharing

```bash
chuck sync              # Commit and push .chuck/ to your repo
chuck sync --pull       # Pull latest rules from remote
chuck sync -m "Add API rules"
```

Session data (`.chuck/sessions/`) is automatically excluded from git — only rule files and decisions are shared.

---

## WSL (Windows Subsystem for Linux)

Chuck detects WSL automatically and handles path normalization.

**Run `chuck install-hook` and `chuck install-monitor` from WSL, not PowerShell.**
Claude Code running in WSL reads settings from `~/.claude/settings.json` (your WSL home). Running installs from WSL ensures paths are written in `/mnt/c/...` format.

**If Claude Code becomes unusable after installing:**
1. At startup, choose **"Continue without these settings"** to bypass hooks.
2. Or open `~/.claude/settings.json` and delete the `"hooks"` block.

**Verify hook paths look like:**
```json
"command": "python3 /mnt/c/Users/yourname/chuck/src/hook/chuck-hook.py"
```

**Python 3 required in WSL:**
```bash
python3 --version
# If not found:
sudo apt install python3
```

---

## License

MIT
