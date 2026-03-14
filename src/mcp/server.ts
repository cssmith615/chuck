#!/usr/bin/env node
/**
 * Chuck MCP Server — on-demand pull model for Claude Code
 *
 * Tools:
 *   list_domains        — available domains + token cost
 *   get_rule_pack       — full domain rules on demand
 *   get_decisions       — semantic search over Decision Ledger
 *   surface_decisions   — ambient: top decisions by completeness + recency
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Domain {
  rules_file?: string;
  always_on?: boolean;
  state?: string;
  priority?: number;
  description?: string;
  trigger?: { keywords?: string[] };
}

interface Manifest {
  domains: Record<string, Domain>;
  token_budget?: number;
  injection_mode?: string;
}

interface Decision {
  id: string;
  decision: string;
  rejected?: string[];
  reason?: string;
  constraints?: string[];
  tags?: string[];
  date?: string;
  status?: string;
}

// ── Chuck dir resolution ──────────────────────────────────────────────────────

function findChuckDir(): string | null {
  const local = path.join(process.cwd(), '.chuck');
  const global = path.join(os.homedir(), '.chuck');
  if (fs.existsSync(local)) return local;
  if (fs.existsSync(global)) return global;
  return null;
}

function loadManifest(chuckDir: string): Manifest | null {
  const p = path.join(chuckDir, 'manifest.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function loadRuleFile(chuckDir: string, rulesFile: string): string {
  const p = path.isAbsolute(rulesFile) ? rulesFile : path.join(chuckDir, rulesFile);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.floor(text.length / 4));
}

// ── Decision loading ──────────────────────────────────────────────────────────

function loadDecisions(chuckDir: string): Decision[] {
  const dir = path.join(chuckDir, 'decisions');
  if (!fs.existsSync(dir)) return [];
  const decisions: Decision[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      if (d.status !== 'superseded') decisions.push(d);
    } catch { /* skip corrupt */ }
  }
  return decisions;
}

// ── Semantic scoring ──────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function scoreDecision(topicTokens: string[], d: Decision): number {
  const tags = (d.tags ?? []).map(t => t.toLowerCase());
  const decWords = tokenize(d.decision);
  const allKeywords = [...new Set([...tags, ...decWords])];
  if (allKeywords.length === 0) return 0;

  const topicSet = new Set(topicTokens);
  const hits = allKeywords.filter(k =>
    topicSet.has(k) ||
    (k.length >= 4 && topicTokens.some(t => t.startsWith(k.slice(0, 4))))
  );
  return hits.length / allKeywords.length;
}

/** Score a decision by completeness — used by surface_decisions. */
function completenessScore(d: Decision): number {
  let score = 0;
  if (d.rejected && d.rejected.length > 0) score += 2;
  if (d.reason && d.reason.length > 10) score += 2;
  if (d.tags && d.tags.length > 0) score += 1;
  if (d.constraints && d.constraints.length > 0) score += 1;
  return score;
}

// ── Format helpers ────────────────────────────────────────────────────────────

function formatDecision(d: Decision): string {
  let line = `✓ ${d.decision}`;
  const parts: string[] = [];
  if (d.rejected && d.rejected.length > 0) {
    parts.push(`not ${d.rejected.slice(0, 3).join(', not ')}`);
  }
  if (d.reason) {
    const short = d.reason.split(/[;.]/)[0].trim();
    parts.push(short.length > 60 ? short.slice(0, 57) + '…' : short);
  }
  if (parts.length > 0) line += ` (${parts.join('; ')})`;
  if (d.tags && d.tags.length > 0) line += `\n  tags: ${d.tags.join(', ')}`;
  return line;
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'chuck',
  version: '0.5.0',
});

// ── Tool: list_domains ────────────────────────────────────────────────────────

server.registerTool(
  'list_domains',
  {
    description:
      'List all available Chuck domains with their token cost and trigger keywords. ' +
      'Use this to discover what rule packs are available before calling get_rule_pack.',
  },
  async () => {
    const chuckDir = findChuckDir();
    if (!chuckDir) {
      return { content: [{ type: 'text', text: 'No .chuck config found. Run: chuck init' }] };
    }

    const manifest = loadManifest(chuckDir);
    if (!manifest) {
      return { content: [{ type: 'text', text: 'No manifest.json found in .chuck/' }] };
    }

    const mode = manifest.injection_mode ?? 'smart';
    const lines: string[] = [
      `Chuck domains (injection_mode: ${mode})`,
      `Budget: ${manifest.token_budget ?? 2000}t`,
      '',
    ];

    for (const [name, config] of Object.entries(manifest.domains)) {
      if (config.state === 'disabled') continue;
      const rulesFile = config.rules_file ?? '';
      const content = rulesFile ? loadRuleFile(chuckDir, rulesFile) : '';
      const tokens = content ? estimateTokens(content) : 0;
      const keywords = config.trigger?.keywords?.slice(0, 5).join(', ') ??
        (config.always_on ? 'always-on' : '—');
      lines.push(`• ${name.padEnd(20)} ${tokens}t   ${config.description ?? ''}`);
      if (keywords !== '—') lines.push(`  triggers: ${keywords}`);
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── Tool: get_rule_pack ───────────────────────────────────────────────────────

server.registerTool(
  'get_rule_pack',
  {
    description:
      'Retrieve the full rule content for a specific domain (e.g. "react", "typescript", "supabase"). ' +
      'Use list_domains first to see what is available.',
    inputSchema: {
      domain: z.string().describe('Domain name to retrieve rules for (e.g. "react", "git", "typescript")'),
    },
  },
  async ({ domain }) => {
    const chuckDir = findChuckDir();
    if (!chuckDir) {
      return { content: [{ type: 'text', text: 'No .chuck config found.' }] };
    }

    const manifest = loadManifest(chuckDir);
    if (!manifest) {
      return { content: [{ type: 'text', text: 'No manifest.json found.' }] };
    }

    // Case-insensitive domain lookup
    const key = Object.keys(manifest.domains).find(
      k => k.toLowerCase() === domain.toLowerCase()
    );

    if (!key) {
      const available = Object.keys(manifest.domains).join(', ');
      return {
        content: [{
          type: 'text',
          text: `Domain "${domain}" not found. Available: ${available}`,
        }],
      };
    }

    const config = manifest.domains[key];
    const rulesFile = config.rules_file ?? '';
    if (!rulesFile) {
      return { content: [{ type: 'text', text: `Domain "${key}" has no rules_file configured.` }] };
    }

    const content = loadRuleFile(chuckDir, rulesFile);
    if (!content) {
      return {
        content: [{
          type: 'text',
          text: `Rules file not found: ${rulesFile}\nRun: chuck add ${key.toLowerCase()}`,
        }],
      };
    }

    const tokens = estimateTokens(content);
    return {
      content: [{
        type: 'text',
        text: `<!-- chuck: ${key} rules (${tokens}t) -->\n\n${content}`,
      }],
    };
  }
);

// ── Tool: get_decisions ───────────────────────────────────────────────────────

server.registerTool(
  'get_decisions',
  {
    description:
      'Search the Decision Ledger for architectural decisions matching a topic. ' +
      'Returns the most relevant decisions with reasoning and rejected alternatives. ' +
      'Use this when about to make an architectural or library choice to avoid re-litigating past decisions.',
    inputSchema: {
      topic: z.string().describe(
        'Topic or context to search decisions for (e.g. "state management", "auth", "database")'
      ),
    },
  },
  async ({ topic }) => {
    const chuckDir = findChuckDir();
    if (!chuckDir) {
      return { content: [{ type: 'text', text: 'No .chuck config found.' }] };
    }

    const decisions = loadDecisions(chuckDir);
    if (decisions.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No decisions logged yet. Use: chuck decide "your decision"',
        }],
      };
    }

    const topicTokens = tokenize(topic);
    const scored = decisions
      .map(d => ({ d, score: scoreDecision(topicTokens, d) }))
      .filter(x => x.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (scored.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No decisions found matching "${topic}".\n\nAll tags: ${
            [...new Set(decisions.flatMap(d => d.tags ?? []))].join(', ') || 'none'
          }`,
        }],
      };
    }

    const lines = [
      `Decisions matching "${topic}" (${scored.length} of ${decisions.length}):`,
      '',
      ...scored.map(({ d }) => formatDecision(d)),
    ];

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── Tool: surface_decisions ───────────────────────────────────────────────────

server.registerTool(
  'surface_decisions',
  {
    description:
      'Surface the most important active decisions at the start of a session. ' +
      'Returns the top decisions ranked by completeness (those with reasoning and rejected alternatives). ' +
      'Call this at session start or when you want ambient architectural context.',
  },
  async () => {
    const chuckDir = findChuckDir();
    if (!chuckDir) {
      return { content: [{ type: 'text', text: 'No .chuck config found.' }] };
    }

    const decisions = loadDecisions(chuckDir);
    if (decisions.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No decisions logged yet. Use: chuck decide "your decision"',
        }],
      };
    }

    const top = [...decisions]
      .sort((a, b) => completenessScore(b) - completenessScore(a))
      .slice(0, 7);

    const lines = [
      `Active decisions (${decisions.length} total, showing top ${top.length}):`,
      '',
      ...top.map(d => formatDecision(d)),
      '',
      `Run get_decisions(topic) for targeted search across all ${decisions.length} decisions.`,
    ];

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  process.stderr.write(`Chuck MCP server error: ${err.message}\n`);
  process.exit(1);
});
