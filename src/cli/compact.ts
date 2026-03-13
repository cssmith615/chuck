import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import {
  findChuckDir,
  loadManifest,
  loadDecisions,
  loadSessionData,
  avgScore,
} from './utils';

interface CompactOptions {
  output?: string;
  sessions?: string;
  plain?: boolean;
}

// ── git helpers ───────────────────────────────────────────────────────────────

function gitLog(n: number): string[] {
  try {
    const out = execSync(`git log --oneline -${n} 2>/dev/null`, { encoding: 'utf-8' });
    return out.trim().split('\n').filter(Boolean);
  } catch { return []; }
}

function gitDiffStat(): string {
  try {
    const out = execSync('git diff --stat HEAD~1 HEAD 2>/dev/null', { encoding: 'utf-8' });
    return out.trim();
  } catch { return ''; }
}

function gitBranch(): string {
  try {
    return execSync('git branch --show-current 2>/dev/null', { encoding: 'utf-8' }).trim();
  } catch { return ''; }
}

function projectName(): string {
  return path.basename(process.cwd());
}

// ── session aggregation ───────────────────────────────────────────────────────

interface AggregatedStats {
  totalPrompts: number;
  sessionCount: number;
  domainHits: Record<string, number>;
  domainScores: Record<string, { total: number; count: number }>;
  decisionHits: Record<string, number>;
  latestSession?: string;
}

function aggregateSessions(chuckDir: string, recentN: number): AggregatedStats {
  const allSessions = loadSessionData(chuckDir);
  const entries = Object.entries(allSessions);

  // Sort by last_active, take most recent N
  const sorted = entries
    .map(([id, data]) => ({ id, data, ts: (data as any).last_active ?? '' }))
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, recentN);

  const agg: AggregatedStats = {
    totalPrompts: 0,
    sessionCount: sorted.length,
    domainHits: {},
    domainScores: {},
    decisionHits: {},
    latestSession: sorted[0]?.id,
  };

  for (const { data } of sorted) {
    const d = data as any;
    agg.totalPrompts += d.prompt_count ?? 0;

    for (const [domain, hits] of Object.entries<number>(d.domain_hits ?? {})) {
      agg.domainHits[domain] = (agg.domainHits[domain] ?? 0) + hits;
    }
    for (const [domain, score] of Object.entries<{ total: number; count: number }>(d.domain_scores ?? {})) {
      if (!agg.domainScores[domain]) agg.domainScores[domain] = { total: 0, count: 0 };
      agg.domainScores[domain].total += score.total;
      agg.domainScores[domain].count += score.count;
    }
    for (const [id, hits] of Object.entries<number>(d.decision_hits ?? {})) {
      agg.decisionHits[id] = (agg.decisionHits[id] ?? 0) + (hits as number);
    }
  }

  return agg;
}

// ── format ────────────────────────────────────────────────────────────────────

function formatDecisionLine(d: any): string {
  let line = `✓ ${d.decision}`;
  const rejected = d.rejected ?? [];
  const reason = d.reason ?? '';
  if (rejected.length || reason) {
    const parts: string[] = rejected.slice(0, 2).map((r: string) => `not ${r}`);
    if (reason) {
      const short = reason.split(/[;.]/)[0].trim().slice(0, 50);
      parts.push(short);
    }
    line += ` (${parts.join('; ')})`;
  }
  return line;
}

// ── main ──────────────────────────────────────────────────────────────────────

export function compactCommand(opts: CompactOptions): void {
  const chuckDir = findChuckDir();
  if (!chuckDir) {
    console.error(chalk.red('No .chuck directory found. Run chuck init first.'));
    process.exit(1);
  }

  const manifest = loadManifest(chuckDir);
  const recentN = parseInt(opts.sessions ?? '5', 10);
  const stats = aggregateSessions(chuckDir, recentN);
  const decisions = loadDecisions(chuckDir).filter(d => d.status === 'active');

  const project = projectName();
  const branch = gitBranch();
  const commits = gitLog(8);
  const diffStat = gitDiffStat();
  const now = new Date().toISOString().split('T')[0];

  // ── Top domains by hits ───────────────────────────────────────────────────
  const topDomains = Object.entries(stats.domainHits)
    .filter(([name]) => name !== 'GLOBAL')
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);

  // ── Fired decisions ───────────────────────────────────────────────────────
  const firedDecisions = decisions.filter(d => stats.decisionHits[d.id]);
  const unfiredDecisions = decisions.filter(d => !stats.decisionHits[d.id]);

  // ── Build output ──────────────────────────────────────────────────────────
  const lines: string[] = [];

  lines.push(`## Chuck Compact Brief`);
  lines.push(`**Project:** ${project}${branch ? ` (${branch})` : ''}  |  **Generated:** ${now}`);
  lines.push(`**Sessions analyzed:** ${stats.sessionCount} most recent  |  **Total prompts:** ${stats.totalPrompts}`);
  lines.push('');

  // Active work areas
  lines.push('### Active Work Areas');
  if (topDomains.length) {
    for (const [domain, hits] of topDomains) {
      const score = avgScore(stats.domainScores[domain]);
      const eff = Math.round(score * 100);
      lines.push(`- **${domain}** — ${hits} hits${eff > 0 ? ` (avg relevance ${eff}%)` : ''}`);
    }
  } else {
    lines.push('- No domain activity recorded yet');
  }
  lines.push('');

  // Active decisions
  lines.push('### Active Decisions');
  if (decisions.length === 0) {
    lines.push('- No decisions logged yet. Use `chuck decide` to log architectural choices.');
  } else {
    // Fired decisions first, then unfired
    for (const d of firedDecisions) {
      lines.push(`- ${formatDecisionLine(d)}`);
    }
    for (const d of unfiredDecisions) {
      lines.push(`- ${formatDecisionLine(d)}  _(not fired in recent sessions)_`);
    }
  }
  lines.push('');

  // Recent git activity
  if (commits.length) {
    lines.push('### Recent Git Activity');
    for (const c of commits) {
      lines.push(`- ${c}`);
    }
    lines.push('');
  }

  if (diffStat) {
    lines.push('### Last Commit Changes');
    lines.push('```');
    lines.push(diffStat);
    lines.push('```');
    lines.push('');
  }

  // Domain rules reminder (active domains from manifest)
  if (manifest?.domains) {
    const activeDomains = Object.keys(manifest.domains).filter(n => {
      const d = manifest.domains[n];
      return d.state !== 'disabled';
    });
    lines.push('### Chuck Domains Configured');
    lines.push(activeDomains.join(' · '));
    lines.push('');
  }

  // Handoff instructions
  lines.push('---');
  lines.push('_Paste this brief at the start of a new Claude Code session to restore context._');
  lines.push('_Chuck will automatically re-inject relevant rules and decisions as you work._');

  const brief = lines.join('\n');

  // ── Output ────────────────────────────────────────────────────────────────
  if (opts.output) {
    fs.writeFileSync(opts.output, brief, 'utf-8');
    console.log(chalk.green(`✓ Compact brief written to ${opts.output}`));
    console.log(chalk.dim(`  ${lines.length} lines · paste at session start or use with /compact`));
  } else {
    // Print to stdout — ready for copy-paste or pipe
    if (!opts.plain) {
      console.log(chalk.dim('─'.repeat(60)));
      console.log(chalk.bold.cyan('Chuck Compact Brief') + chalk.dim(' — copy and paste to start a new session'));
      console.log(chalk.dim('─'.repeat(60)));
    }
    console.log(brief);
    if (!opts.plain) {
      console.log(chalk.dim('─'.repeat(60)));
      console.log(chalk.dim(`Tip: chuck compact -o handoff.md  to save to file`));
    }
  }
}
