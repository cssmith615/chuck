# Chuck — Smarter Context for Claude Code

> Give Claude the right rules at the right time. Nothing more.

Claude Code reads your `CLAUDE.md` on every single prompt — whether it's relevant or not. For large projects that means hundreds of tokens wasted on rules Claude doesn't need right now. And when context fills, Claude forgets the decisions you made weeks ago and re-suggests exactly what you already rejected.

Chuck fixes both problems with a four-layer architecture that eliminates wasted tokens at every level.

---

## What Chuck does

- **Zero-cost path-scoped rules** — `chuck init --native` generates a `CLAUDE.md` hierarchy. Claude Code loads them for free based on which directory you're working in
- **Decisions-only hook** — the injection hook drops from 800–1200t/prompt to ~20t by delivering decisions only
- **On-demand pull via MCP** — Claude asks for rule packs when it needs them instead of receiving everything upfront
- **Remembers your decisions** — "Use Zustand, not Redux" stays in context across every session
- **Catches contradictions** — warns immediately if Claude starts writing code that violates a logged decision
- **Generates session handoffs** — `chuck compact` distills your work into a brief for new sessions or `/compact`
- **Self-improving** — `chuck improve` reads your session data and proposes rule fixes with before/after eval scores
- **Decision health tracking** — `chuck decide:health` shows which decisions are holding and which are being violated
- **Scales back automatically** — tighter budget as context fills

---

## The Architecture

Chuck works in four layers. Use as many as you need:

```
Layer 1: Native CLAUDE.md hierarchy   chuck init --native    0t (path-scoped by Claude Code)
Layer 2: Decisions-only hook          injection_mode flag    ~20t avg (was 800–1200t)
Layer 3: Chuck MCP server (pull)      chuck install-mcp      0t until Claude asks
Layer 4: Quality Monitor              chuck install-monitor  0t when clean
```

**Recommended setup (maximum token efficiency):**
```bash
chuck init --native        # generate CLAUDE.md hierarchy
chuck install-hook         # lean decisions hook (~20t/prompt)
chuck install-mcp          # on-demand rule pull via MCP
chuck install-monitor      # real-time contradiction detection
```

**Classic setup (push model, no CLAUDE.md changes):**
```bash
chuck init                 # generate .chuck/domains/ rule files
chuck install-hook         # TF-IDF smart domain injection
```

---

## Installation

```bash
npm install -g chuck-core
```

Requires Node 18+ and Python 3.

---

## Quick Start

### Native mode (recommended)
```bash
# 1. Generate CLAUDE.md hierarchy — rules at zero token cost
chuck init --native

# 2. Install the lean decisions hook (~20t/prompt)
chuck install-hook

# 3. Install the MCP server — on-demand rule pull
chuck install-mcp

# 4. Install the quality monitor
chuck install-monitor

# 5. Log your first architectural decision
chuck decide "Use Zustand for state management" --tags state,react
```

### Classic mode
```bash
# 1. Initialize with smart domain matching
chuck init

# 2. Install the context injection hook
chuck install-hook

# 3. (Optional) Install the quality monitor
chuck install-monitor

# 4. See what was set up
chuck list
```

Restart Claude Code after installing hooks or the MCP server.

---

## Commands

### Setup
```bash
chuck init                  # Scan project, auto-generate .chuck/domains/ rule files
chuck init --native         # Generate CLAUDE.md hierarchy instead (zero token cost)
chuck init --dry-run        # Preview what would be generated without writing
chuck install-hook          # Install context injection (UserPromptSubmit hook)
chuck install-monitor       # Install quality monitor (PostToolUse hook)
chuck install-mcp           # Register Chuck MCP server in Claude Code settings
```

### Rules
```bash
chuck list                  # Show active rule sets and token costs
chuck add <pack>            # Install a built-in rule pack
chuck audit                 # Find dead, bloated, or conflicting rules
chuck stats                 # See which rules are firing and how effectively
chuck suggest               # Get suggestions for new rules based on your actual prompts
chuck sync                  # Push/pull rules via git for team sharing
```

### Decision Ledger
```bash
chuck decide "Use Zustand for state management" --tags state,react
                            # Log a decision — prompts for rejected alternatives and reason
chuck decide                # List all active decisions
chuck decide:list --tag state           # Filter by tag
chuck decide:list --all                 # Include superseded decisions
chuck decide:show dec_zustand           # Full detail on one decision
chuck decide:supersede dec_zustand      # Mark as replaced (keeps history)
chuck decide:remove dec_zustand         # Hard delete
chuck decide:audit          # Find decisions that have never fired (stale candidates)
chuck decide:health         # Health report — fires, violations, hold rates per decision
```

### Self-Improvement Loop
```bash
chuck eval:seed             # Generate starter test cases from your active rule stack
chuck eval                  # Run all test cases — check domain and decision matching accuracy
chuck eval -v               # Verbose — show full match details per test
chuck improve               # Analyze session data, propose rule fixes, apply with confirm/skip
chuck improve --auto        # Auto-apply changes that improve eval pass rate
```

### Session Management
```bash
chuck compact               # Generate a session handoff brief (paste to start new session)
chuck compact -o brief.md   # Write to file
chuck compact -s 10         # Analyze last 10 sessions (default: 5)
```

---

## Native Mode: CLAUDE.md Hierarchy

`chuck init --native` maps your detected stack to a `CLAUDE.md` hierarchy that Claude Code loads at zero token cost, path-scoped automatically:

| File | Contents | Loaded when |
|---|---|---|
| `CLAUDE.md` | Global + Git rules | Always |
| `src/CLAUDE.md` | React / RN / TypeScript / Zustand | Working in `src/` |
| `supabase/CLAUDE.md` | Supabase rules | Working in `supabase/` |

The manifest is created with `injection_mode: "decisions_only"` automatically — the hook injects decisions only (~20t) while domain rules live in the hierarchy for free.

Existing `CLAUDE.md` files are appended, not overwritten.

---

## MCP Server: Pull Model

The Chuck MCP server lets Claude ask for context on demand rather than receiving it every prompt.

```bash
chuck install-mcp
```

Four tools available in Claude Code:

| Tool | What it does |
|---|---|
| `chuck:list_domains` | Discover available rule packs + token costs |
| `chuck:get_rule_pack(domain)` | Pull a full domain's rules when needed |
| `chuck:get_decisions(topic)` | Semantic search over Decision Ledger by topic |
| `chuck:surface_decisions()` | Top decisions by completeness — call at session start |

With the MCP server installed, Claude can say "let me check the Supabase rules before I write this migration" and pull exactly what it needs, exactly when it needs it.

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
  "date": "2026-03-14",
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

## Self-Improvement Loop

Chuck gets smarter the more you use it. The hook and monitor collect data every session — `chuck improve` turns that data into concrete rule changes.

### The loop

```
chuck eval:seed     → seed test cases from your stack
chuck eval          → baseline: how well do your rules match now?
                          ↓
   [use Claude Code — hook fires, monitor watches]
                          ↓
chuck stats         → Decision Health: fires, violations, hold rates
chuck improve       → proposes keyword additions + surfaces violated decisions
                      confirm y/n/skip per proposal, shows eval delta
chuck sync --push   → share improved rules with team
```

### `chuck eval` — test cases for your rules

Define what prompts should match which domains and decisions:

```json
{
  "description": "state management question should match zustand + react",
  "prompt": "how should I manage global state in my React app?",
  "expected_domains": ["react", "zustand"],
  "expected_decisions": ["dec_use_zustand_for_state_management"]
}
```

```bash
chuck eval:seed     # auto-generate starter cases from your stack
chuck eval          # run all cases — exits 0 on full pass (CI-friendly)
```

### `chuck improve` — close the feedback loop

```bash
chuck improve
```

Chuck reads your session data and proposes targeted fixes:

- **Keyword gaps** — finds terms that appear in unmatched prompts and co-occur with your domain keywords, then proposes adding them to the right trigger
- **Violated decisions** — surfaces decisions that the monitor has flagged and lets you expand `rejected[]` interactively
- Shows eval pass rate before and after — you only apply changes that help

```
[1/2] Domain: react — 4 common miss terms
  Reason: 6 unmatched prompts contain react-related terms
  Current keywords: react, component, jsx
  Proposed additions: hook, useState, useEffect, memo
  Apply? [y/n/skip]

Results: Before: 75%  After: 100%  +25%
```

Use `chuck improve --auto` to apply all changes that improve pass rate without prompting — the unattended loop.

### `chuck decide:health` — know which decisions are holding

```bash
chuck decide:health
```

```
⚡ Decision Health Report

3 active decisions  |  26 total fires  |  2 total violations

  ID                                           Fires  Violations  Hold
  ──────────────────────────────────────────────────────────────────────
  ✗ dec_use_safe_area_context                      4           3   57%
  ⚠ dec_never_use_uuid_package                     8           2   80%
  ✓ dec_use_zustand_for_state_management          18           0    —

Flags:
  ✗ dec_use_safe_area_context — holding 57% — review or supersede
  ⚠ dec_never_use_uuid_package — expand rejected[] to cover more alternatives
```

Also catches decisions that fire often but have an empty `rejected[]` — those are invisible to the monitor.

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

After `chuck init` (classic):

```
.chuck/
├── manifest.json         # Rule config, token budget, injection_mode
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

After `chuck init --native`:

```
CLAUDE.md                 # Global + Git rules (always loaded)
src/CLAUDE.md             # React / TypeScript / Zustand (path-scoped)
supabase/CLAUDE.md        # Supabase rules (path-scoped)
.chuck/
├── manifest.json         # injection_mode: "decisions_only"
├── decisions/            # Decision Ledger
└── sessions/             # Local usage data
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
  "injection_mode": "smart",
  "devmode": false
}
```

### `injection_mode`

| Value | Behavior |
|---|---|
| `"smart"` (default) | TF-IDF domain matching — injects relevant domains each prompt |
| `"decisions_only"` | Skips domain injection — use with `--native` or MCP pull model |

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

**Run `chuck install-hook`, `chuck install-monitor`, and `chuck install-mcp` from WSL, not PowerShell.**
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
