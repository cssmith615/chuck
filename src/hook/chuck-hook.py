#!/usr/bin/env python3
"""
Chuck Hook — Claude Hook for Universal Context Keeper
Dynamic rule injection for Claude Code with semantic matching and token budgeting.

Fires on UserPromptSubmit hook. Reads stdin JSON, injects matched rules, prints to stdout.
"""

import sys
import json
import os
import re
import math
import uuid
import hashlib
from pathlib import Path
from datetime import datetime, timedelta
from collections import Counter

# ── Config ──────────────────────────────────────────────────────────────────

CHUCK_LOCAL = Path(".chuck")
CHUCK_GLOBAL = Path.home() / ".chuck"
SESSION_DIR_NAME = "sessions"
DEFAULT_TOKEN_BUDGET = 2000
MAX_GLOBAL_TOKENS = 200
SESSION_MAX_AGE_HOURS = 24

# ── Token estimation ─────────────────────────────────────────────────────────

def estimate_tokens(text: str) -> int:
    """Rough token estimate: ~4 chars per token."""
    return max(1, len(text) // 4)

# ── Semantic / fuzzy matching ────────────────────────────────────────────────

def tokenize(text: str) -> list[str]:
    """Lowercase word tokens, strip punctuation."""
    return re.findall(r"[a-z0-9]+", text.lower())

def tfidf_score(prompt_tokens: list[str], keyword_tokens: list[str]) -> float:
    """
    Simple TF-IDF-inspired relevance score.
    Returns 0.0–1.0 representing how well the keywords match the prompt.
    """
    if not prompt_tokens or not keyword_tokens:
        return 0.0

    prompt_freq = Counter(prompt_tokens)
    total = len(prompt_tokens)
    score = 0.0

    for kw in keyword_tokens:
        tf = prompt_freq.get(kw, 0) / total
        # IDF: penalize very common words (rough approximation)
        idf = math.log(10 / (1 + prompt_freq.get(kw, 0)))
        score += tf * max(idf, 0.1)

    return min(score / max(len(keyword_tokens), 1), 1.0)

def fuzzy_contains(prompt_tokens: set[str], keyword: str) -> bool:
    """Check if keyword (or a close variant) appears in prompt tokens."""
    kw = keyword.lower()
    if kw in prompt_tokens:
        return True
    # Prefix match: "react" matches "reactive", "reactnative"
    return any(t.startswith(kw[:4]) for t in prompt_tokens if len(kw) >= 4)

def score_domain(prompt_tokens: list[str], prompt_set: set[str], trigger: dict) -> float:
    """
    Score a domain's trigger against the current prompt.
    Returns relevance score 0.0–1.0.
    """
    keywords = [k.lower() for k in trigger.get("keywords", [])]
    use_fuzzy = trigger.get("fuzzy", True)
    operator = trigger.get("operator", "OR").upper()

    if not keywords:
        return 0.0

    keyword_tokens = tokenize(" ".join(keywords))

    if operator == "AND":
        # All keywords must match
        if use_fuzzy:
            matched = all(fuzzy_contains(prompt_set, kw) for kw in keywords)
        else:
            matched = all(kw in prompt_set for kw in keywords)
        if not matched:
            return 0.0

    # Score via TF-IDF
    base_score = tfidf_score(prompt_tokens, keyword_tokens)

    # Boost: direct keyword hits
    if use_fuzzy:
        hits = sum(1 for kw in keywords if fuzzy_contains(prompt_set, kw))
    else:
        hits = sum(1 for kw in keywords if kw in prompt_set)

    hit_ratio = hits / len(keywords)
    return min(base_score + (hit_ratio * 0.4), 1.0)

# ── Decision Ledger ──────────────────────────────────────────────────────────

DECISIONS_DIR_NAME = "decisions"
MAX_DECISION_TOKENS = 100  # hard cap for decisions block per prompt

def load_decisions(chuck_dir: Path) -> list[dict]:
    """Load all active decisions from .chuck/decisions/*.json"""
    decisions_dir = chuck_dir / DECISIONS_DIR_NAME
    if not decisions_dir.exists():
        return []
    decisions = []
    for f in decisions_dir.glob("*.json"):
        try:
            d = json.loads(f.read_text())
            if d.get("status", "active") == "active":
                decisions.append(d)
        except Exception:
            pass
    return decisions

def score_decision(prompt_tokens: list[str], prompt_set: set[str], decision: dict) -> float:
    """Score a decision's tags + keywords against the prompt."""
    tags = [t.lower() for t in decision.get("tags", [])]
    # Also score against the decision text itself
    decision_words = tokenize(decision.get("decision", ""))
    all_keywords = list(set(tags + decision_words))
    if not all_keywords:
        return 0.0
    return score_domain(prompt_tokens, prompt_set, {"keywords": all_keywords, "fuzzy": True})

def format_decision_line(d: dict) -> str:
    """Format a decision as a dense one-liner for injection."""
    line = f"✓ {d['decision']}"
    rejected = d.get("rejected", [])
    reason = d.get("reason", "")
    if rejected or reason:
        parts = []
        for r in rejected[:3]:
            parts.append(f"not {r}")
        if reason:
            # Take first sentence fragment before semicolons or periods
            short = re.split(r'[;.]', reason)[0].strip()
            if len(short) > 45:
                short = short[:42].rsplit(' ', 1)[0] + '…'
            parts.append(short)
        line += f" ({'; '.join(parts)})"
    return line

# ── Manifest loading ─────────────────────────────────────────────────────────

def find_chuck_dir() -> Path | None:
    """Find .chuck dir: prefer local, fall back to global."""
    if CHUCK_LOCAL.exists():
        return CHUCK_LOCAL
    if CHUCK_GLOBAL.exists():
        return CHUCK_GLOBAL
    return None

def load_manifest(chuck_dir: Path) -> dict:
    manifest_path = chuck_dir / "manifest.json"
    if not manifest_path.exists():
        return {}
    with open(manifest_path) as f:
        return json.load(f)

# ── Session management ───────────────────────────────────────────────────────

def get_session_id() -> str:
    """Derive session ID from environment (Claude Code sets CLAUDE_SESSION_ID) or generate."""
    env_id = os.environ.get("CLAUDE_SESSION_ID") or os.environ.get("TERM_SESSION_ID")
    if env_id:
        return hashlib.md5(env_id.encode()).hexdigest()[:12]
    return str(uuid.uuid4())[:12]

def load_session(chuck_dir: Path, session_id: str) -> dict:
    session_file = chuck_dir / SESSION_DIR_NAME / f"{session_id}.json"
    if session_file.exists():
        with open(session_file) as f:
            return json.load(f)
    return {"id": session_id, "prompt_count": 0, "domain_hits": {}, "created_at": datetime.now().isoformat()}

def save_session(chuck_dir: Path, session: dict) -> None:
    session_dir = chuck_dir / SESSION_DIR_NAME
    session_dir.mkdir(exist_ok=True)
    session["prompt_count"] = session.get("prompt_count", 0) + 1
    session["last_active"] = datetime.now().isoformat()
    session_file = session_dir / f"{session['id']}.json"
    with open(session_file, "w") as f:
        json.dump(session, f, indent=2)

def cleanup_stale_sessions(chuck_dir: Path) -> None:
    session_dir = chuck_dir / SESSION_DIR_NAME
    if not session_dir.exists():
        return
    cutoff = datetime.now() - timedelta(hours=SESSION_MAX_AGE_HOURS)
    for f in session_dir.glob("*.json"):
        try:
            mtime = datetime.fromtimestamp(f.stat().st_mtime)
            if mtime < cutoff:
                f.unlink()
        except Exception:
            pass

# ── Star-command detection ───────────────────────────────────────────────────

def extract_star_commands(prompt: str) -> list[str]:
    return re.findall(r"\*([a-zA-Z0-9_\-]+)", prompt)

def load_command(chuck_dir: Path, command: str) -> str | None:
    cmd_file = chuck_dir / "commands" / f"{command}.md"
    if cmd_file.exists():
        return cmd_file.read_text()
    return None

# ── Rule loading ─────────────────────────────────────────────────────────────

def load_rule_file(chuck_dir: Path, rules_file: str) -> str:
    path = chuck_dir / rules_file
    if path.exists():
        return path.read_text()
    # Try absolute
    abs_path = Path(rules_file)
    if abs_path.exists():
        return abs_path.read_text()
    return ""

# ── Context bracket ───────────────────────────────────────────────────────────

def get_context_bracket() -> str:
    """
    Estimate context fill from hook input if available.
    Returns: FRESH | MODERATE | DEPLETED | CRITICAL
    """
    usage = os.environ.get("CLAUDE_CONTEXT_TOKENS_USED")
    limit = os.environ.get("CLAUDE_CONTEXT_TOKENS_LIMIT")
    if usage and limit:
        try:
            pct = int(usage) / int(limit)
            if pct < 0.3:
                return "FRESH"
            elif pct < 0.6:
                return "MODERATE"
            elif pct < 0.85:
                return "DEPLETED"
            else:
                return "CRITICAL"
        except Exception:
            pass
    return "FRESH"

# ── Global exclude check ──────────────────────────────────────────────────────

def is_globally_excluded(prompt_tokens: set[str], global_exclude: list[str]) -> bool:
    return any(kw.lower() in prompt_tokens for kw in global_exclude)

# ── Main injection logic ──────────────────────────────────────────────────────

def run() -> None:
    try:
        raw = sys.stdin.read()
        hook_input = json.loads(raw) if raw.strip() else {}
    except Exception:
        hook_input = {}

    prompt = hook_input.get("prompt", "")

    chuck_dir = find_chuck_dir()
    if not chuck_dir:
        # No chuck config found — pass through silently
        sys.exit(0)

    manifest = load_manifest(chuck_dir)
    if not manifest:
        sys.exit(0)

    # Session
    session_id = get_session_id()
    cleanup_stale_sessions(chuck_dir)
    session = load_session(chuck_dir, session_id)

    # Tokenize prompt
    prompt_tokens = tokenize(prompt)
    prompt_set = set(prompt_tokens)

    token_budget = manifest.get("token_budget", DEFAULT_TOKEN_BUDGET)
    global_exclude = manifest.get("global_exclude", [])
    domains = manifest.get("domains", {})

    # Global exclude check
    if is_globally_excluded(prompt_set, global_exclude):
        sys.exit(0)

    injected_parts = []
    tokens_used = 0
    active_domains = []
    skipped_domains = []
    decision_lines = []

    # ── Decision Ledger — inject matching decisions at priority 0 ─────────────
    all_decisions = load_decisions(chuck_dir)
    if all_decisions:
        scored_decisions = []
        for d in all_decisions:
            s = score_decision(prompt_tokens, prompt_set, d)
            if s > 0.05:
                scored_decisions.append((d, s))

        scored_decisions.sort(key=lambda x: -x[1])
        decisions_tokens = 0
        decision_hits = session.setdefault("decision_hits", {})

        for d, s in scored_decisions:
            line = format_decision_line(d)
            lt = estimate_tokens(line)
            if decisions_tokens + lt > MAX_DECISION_TOKENS:
                break
            decision_lines.append(line)
            decisions_tokens += lt
            # Track hit
            decision_hits[d["id"]] = decision_hits.get(d["id"], 0) + 1

        if decision_lines:
            block = "\n".join(decision_lines)
            injected_parts.append(("DECISIONS", block, decisions_tokens))
            tokens_used += decisions_tokens
            active_domains.append(f"DECISIONS ({decisions_tokens}t, {len(decision_lines)} matched)")

    # ── Global domain (always on, no keyword check) ───────────────────────────
    global_domain = domains.get("GLOBAL")
    if global_domain and global_domain.get("state", "active") == "active":
        rules_file = global_domain.get("rules_file", "")
        content = load_rule_file(chuck_dir, rules_file) if rules_file else ""
        if content:
            t = estimate_tokens(content)
            if t <= MAX_GLOBAL_TOKENS:
                injected_parts.append(("GLOBAL", content, t))
                tokens_used += t
                active_domains.append(f"GLOBAL ({t}t)")

    # ── Star-commands ─────────────────────────────────────────────────────────
    star_commands = extract_star_commands(prompt)
    for cmd in star_commands:
        content = load_command(chuck_dir, cmd)
        if content:
            t = estimate_tokens(content)
            if tokens_used + t <= token_budget:
                injected_parts.append((f"*{cmd}", content, t))
                tokens_used += t
                active_domains.append(f"*{cmd} ({t}t)")

    # ── Domain matching ───────────────────────────────────────────────────────
    context_bracket = get_context_bracket()

    # Budget modifier based on context fill
    budget_modifier = {"FRESH": 1.0, "MODERATE": 0.75, "DEPLETED": 0.5, "CRITICAL": 0.25}
    effective_budget = int(token_budget * budget_modifier.get(context_bracket, 1.0))

    scored = []
    for domain_name, config in domains.items():
        if domain_name == "GLOBAL":
            continue
        if config.get("state", "active") != "active":
            continue

        # Domain-level exclude check
        domain_exclude = config.get("exclude_keywords", [])
        if any(kw.lower() in prompt_set for kw in domain_exclude):
            skipped_domains.append(domain_name)
            continue

        trigger = config.get("trigger", {})

        # Always-on domains
        if config.get("always_on", False):
            scored.append((domain_name, config, 1.0))
            continue

        score = score_domain(prompt_tokens, prompt_set, trigger)
        if score > 0.05:  # Minimum relevance threshold
            scored.append((domain_name, config, score))

    # Sort by priority then score
    scored.sort(key=lambda x: (x[1].get("priority", 5), -x[2]))

    for domain_name, config, score in scored:
        rules_file = config.get("rules_file", "")
        if not rules_file:
            continue

        content = load_rule_file(chuck_dir, rules_file)
        if not content:
            continue

        t = estimate_tokens(content)
        if tokens_used + t > effective_budget:
            skipped_domains.append(f"{domain_name} (over budget)")
            continue

        injected_parts.append((domain_name, content, t))
        tokens_used += t
        active_domains.append(f"{domain_name} ({t}t, score:{score:.2f})")

        # Track domain hits for effectiveness scoring
        session["domain_hits"] = session.get("domain_hits", {})
        session["domain_hits"][domain_name] = session["domain_hits"].get(domain_name, 0) + 1

        # Track avg relevance score per domain
        ds = session.setdefault("domain_scores", {})
        entry = ds.setdefault(domain_name, {"total": 0.0, "count": 0})
        entry["total"] += score
        entry["count"] += 1

    # ── Context bracket warning ───────────────────────────────────────────────
    bracket_warning = ""
    if context_bracket == "CRITICAL":
        bracket_warning = "\n⚠️ CONTEXT CRITICAL: Summarize completed work and compact soon."
    elif context_bracket == "DEPLETED":
        bracket_warning = "\n⚠️ Context filling up — prefer concise responses."

    # ── Nothing matched — store miss prompt for chuck suggest ─────────────────
    if not injected_parts:
        misses = session.setdefault("miss_prompts", [])
        misses.append(prompt[:200])
        session["miss_prompts"] = misses[-50:]  # keep last 50
        save_session(chuck_dir, session)
        sys.exit(0)

    # ── Format output ─────────────────────────────────────────────────────────
    rules_block = "\n\n---\n".join(f"<!-- {name} -->\n{content}" for name, content, _ in injected_parts)

    debug_info = ""
    if manifest.get("devmode", False):
        debug_info = f"""
<!-- CHUCK DEBUG
  Active: {', '.join(active_domains)}
  Skipped: {', '.join(skipped_domains) or 'none'}
  Tokens injected: {tokens_used}/{effective_budget} (context: {context_bracket})
  Session: {session_id} | Prompt #{session.get('prompt_count', 0) + 1}
-->"""

    output = f"""<chuck_context>
{rules_block}{bracket_warning}{debug_info}
</chuck_context>"""

    save_session(chuck_dir, session)
    print(output)

if __name__ == "__main__":
    run()
