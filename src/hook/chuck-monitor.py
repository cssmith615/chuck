#!/usr/bin/env python3
"""
Chuck Monitor — PostToolUse hook for Output Quality monitoring.

Fires after every Write/Edit tool call. Checks the content being written
against active decisions' rejected[] alternatives. If a contradiction is
detected, outputs a warning block that Claude sees immediately.

Token cost: 0t when clean (silent exit), ~30-50t only on contradiction.
"""

import sys
import json
import os
import re
from pathlib import Path
from datetime import datetime

# ── Config ───────────────────────────────────────────────────────────────────

CHUCK_LOCAL = Path(".chuck")
CHUCK_GLOBAL = Path.home() / ".chuck"
DECISIONS_DIR_NAME = "decisions"
MONITORED_TOOLS = {"Write", "Edit"}

# ── Decision loading ──────────────────────────────────────────────────────────

def find_chuck_dir() -> Path | None:
    if CHUCK_LOCAL.exists():
        return CHUCK_LOCAL
    if CHUCK_GLOBAL.exists():
        return CHUCK_GLOBAL
    return None

def load_active_decisions(chuck_dir: Path) -> list[dict]:
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

# ── Contradiction detection ───────────────────────────────────────────────────

def normalize(text: str) -> str:
    """Lowercase, collapse whitespace."""
    return re.sub(r'\s+', ' ', text.lower()).strip()

def extract_content(tool_name: str, tool_input: dict) -> str:
    """Pull the file content being written/edited from tool input."""
    if tool_name == "Write":
        return tool_input.get("content", "")
    if tool_name == "Edit":
        # Check both new_string and old_string (care about what's being added)
        return tool_input.get("new_string", "")
    return ""

def build_rejection_patterns(rejected: list[str]) -> list[tuple[str, str]]:
    """
    Build (pattern, display_name) pairs for each rejected alternative.
    Handles common code patterns: import statements, package names, API calls.
    """
    patterns = []
    for r in rejected:
        r_norm = normalize(r)
        # The raw name as a word boundary match
        word = re.escape(r_norm.split()[0])  # first word (e.g. "redux", "uuid")
        patterns.append((word, r))
    return patterns

def find_contradictions(content: str, decisions: list[dict]) -> list[dict]:
    """
    For each active decision, check if any rejected[] alternatives appear
    in the content. Returns list of contradiction dicts.
    """
    content_norm = normalize(content)
    found = []

    for d in decisions:
        rejected = d.get("rejected", [])
        if not rejected:
            continue

        patterns = build_rejection_patterns(rejected)
        hits = []

        for pattern, display in patterns:
            # Match as word boundary — avoids "redux" matching "non-redux-related"
            if re.search(r'\b' + pattern + r'\b', content_norm):
                hits.append(display)

        if hits:
            found.append({
                "id": d["id"],
                "decision": d["decision"],
                "rejected_found": hits,
                "reason": d.get("reason", ""),
            })

    return found

# ── Session tracking ──────────────────────────────────────────────────────────

def record_contradiction(chuck_dir: Path, decision_id: str) -> None:
    """Record contradiction hit in the most recent session file."""
    session_dir = chuck_dir / "sessions"
    if not session_dir.exists():
        return
    # Find most recently modified session
    sessions = sorted(session_dir.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True)
    if not sessions:
        return
    try:
        session = json.loads(sessions[0].read_text())
        contradictions = session.setdefault("contradiction_hits", {})
        contradictions[decision_id] = contradictions.get(decision_id, 0) + 1
        sessions[0].write_text(json.dumps(session, indent=2))
    except Exception:
        pass

# ── Output formatting ─────────────────────────────────────────────────────────

def format_warning(contradictions: list[dict], tool_name: str, file_path: str) -> str:
    lines = ["<!-- CHUCK MONITOR WARNING -->"]
    lines.append(f"⚠️  Chuck detected possible decision conflict in {tool_name}({file_path or 'file'}):\n")

    for c in contradictions:
        found_str = ", ".join(f'"{r}"' for r in c["rejected_found"])
        lines.append(f"  • Writing {found_str} conflicts with decision:")
        lines.append(f"    ✓ {c['decision']}")
        if c["reason"]:
            short = c["reason"].split(";")[0].strip()[:80]
            lines.append(f"    Reason: {short}")
        lines.append(f"    ID: {c['id']}")
        lines.append("")

    lines.append("If this decision has changed: chuck decide:supersede <id>")
    lines.append("If intentional: ignore this warning.")

    return "\n".join(lines)

# ── Praxis RAG: decision auto-embed ──────────────────────────────────────────

def embed_new_decision(file_path: str, chuck_dir: Path) -> None:
    """
    If praxis-rag is installed (corpora/ dir exists) and a new decision JSON
    was written to .chuck/decisions/, re-embed the decisions corpus.
    Runs async via subprocess so it never blocks Claude Code.
    """
    import subprocess

    p = Path(file_path)
    decisions_dir = chuck_dir / DECISIONS_DIR_NAME

    # Only fire for JSON files inside the decisions directory
    try:
        p.relative_to(decisions_dir.resolve())
    except ValueError:
        try:
            p.resolve().relative_to(decisions_dir.resolve())
        except ValueError:
            return

    if p.suffix.lower() != ".json":
        return

    # Only fire if praxis-rag is installed
    if not (chuck_dir / "corpora").exists():
        return

    bootstrap = chuck_dir / "bootstrap.px"
    if not bootstrap.exists():
        return

    # Fire-and-forget: don't block, don't crash on failure
    try:
        subprocess.Popen(
            ["praxis", "run", str(bootstrap)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except FileNotFoundError:
        pass  # praxis not on PATH — skip silently
    except Exception:
        pass


# ── Praxis .px validation ─────────────────────────────────────────────────────

def validate_px_file(file_path: str, content: str) -> str | None:
    """
    Run `praxis validate` on a .px file's content via a temp file.
    Returns an error message string if validation fails, None if clean.
    """
    import subprocess
    import tempfile

    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.px', delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        result = subprocess.run(
            ["praxis", "validate", tmp_path],
            capture_output=True, text=True, timeout=10
        )
        Path(tmp_path).unlink(missing_ok=True)

        if result.returncode != 0:
            err = (result.stderr or result.stdout or "validation failed").strip()
            return err
        return None
    except FileNotFoundError:
        # praxis not on PATH — skip silently
        return None
    except Exception:
        return None


def format_px_warning(file_path: str, error: str) -> str:
    name = Path(file_path).name if file_path else "file"
    lines = [
        "<!-- CHUCK MONITOR WARNING -->",
        f"⚠️  Praxis validation failed for {name}:\n",
        f"  {error}",
        "",
        "Fix the .px syntax before executing with: praxis run <file>",
        "Validate manually: praxis validate <file>",
    ]
    return "\n".join(lines)


# ── Main ──────────────────────────────────────────────────────────────────────

def run() -> None:
    try:
        raw = sys.stdin.read()
        hook_input = json.loads(raw) if raw.strip() else {}
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")

    # Only monitor Write and Edit
    if tool_name not in MONITORED_TOOLS:
        sys.exit(0)

    tool_input = hook_input.get("tool_input", {})
    file_path = tool_input.get("file_path", "") or tool_input.get("path", "")

    # ── Praxis .px validation (independent of Chuck decisions) ────────────────
    if file_path and str(file_path).endswith(".px"):
        content = extract_content(tool_name, tool_input)
        if content.strip():
            px_error = validate_px_file(str(file_path), content)
            if px_error:
                print(format_px_warning(str(file_path), px_error))
                # Don't exit — still run decision checks below

    chuck_dir = find_chuck_dir()

    # ── RAG: auto-embed new decisions ─────────────────────────────────────────
    if chuck_dir and file_path and tool_name == "Write":
        embed_new_decision(str(file_path), chuck_dir)
    if not chuck_dir:
        sys.exit(0)

    decisions = load_active_decisions(chuck_dir)
    if not decisions:
        sys.exit(0)

    content = extract_content(tool_name, tool_input)
    if not content.strip():
        sys.exit(0)

    contradictions = find_contradictions(content, decisions)
    if not contradictions:
        sys.exit(0)

    # Record hits for audit
    for c in contradictions:
        record_contradiction(chuck_dir, c["id"])

    file_name = Path(file_path).name if file_path else ""

    warning = format_warning(contradictions, tool_name, file_name)
    print(warning)

if __name__ == "__main__":
    run()
