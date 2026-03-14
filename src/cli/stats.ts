import chalk from 'chalk';
import { findChuckDir, loadManifest, loadSessionData, loadDecisions, estimateTokens, loadRuleFile, avgScore } from './utils';

export async function statsCommand(): Promise<void> {
  const chuckDir = findChuckDir();
  if (!chuckDir) {
    console.log(chalk.red('No .chuck config found. Run: chuck init'));
    return;
  }

  const manifest = loadManifest(chuckDir);
  if (!manifest) {
    console.log(chalk.red('No manifest.json found.'));
    return;
  }

  const sessions = loadSessionData(chuckDir);
  const totalSessions = Object.keys(sessions).length;
  const totalPrompts = Object.values(sessions).reduce((sum, s) => sum + ((s as { prompt_count?: number }).prompt_count ?? 1), 0);

  console.log(chalk.bold.cyan('\n⚡ Chuck Stats\n'));

  if (totalSessions === 0) {
    console.log(chalk.gray('No session data yet — start using Claude Code with the hook installed.\n'));
    return;
  }

  // Domain hit totals + score aggregation
  const domainHits: Record<string, number> = {};
  const domainScores: Record<string, { total: number; count: number }> = {};
  const decisionHits: Record<string, number> = {};
  const contradictionHits: Record<string, number> = {};
  for (const session of Object.values(sessions)) {
    for (const [domain, hits] of Object.entries(session.domain_hits ?? {})) {
      domainHits[domain] = (domainHits[domain] ?? 0) + hits;
    }
    for (const [domain, scores] of Object.entries(session.domain_scores ?? {})) {
      if (!domainScores[domain]) domainScores[domain] = { total: 0, count: 0 };
      domainScores[domain].total += scores.total;
      domainScores[domain].count += scores.count;
    }
    for (const [id, hits] of Object.entries(session.decision_hits ?? {})) {
      decisionHits[id] = (decisionHits[id] ?? 0) + hits;
    }
    for (const [id, hits] of Object.entries(session.contradiction_hits ?? {})) {
      contradictionHits[id] = (contradictionHits[id] ?? 0) + hits;
    }
  }

  // Estimate token savings
  // Without chuck: every prompt would have full CLAUDE.md loaded
  const totalRuleTokens = Object.entries(manifest.domains).reduce((sum, [, config]) => {
    if (!config.rules_file) return sum;
    const content = loadRuleFile(chuckDir, config.rules_file);
    return sum + estimateTokens(content);
  }, 0);

  const avgDomainsPerPrompt = Object.values(domainHits).reduce((a, b) => a + b, 0) / Math.max(totalPrompts, 1);
  const avgTokensPerPrompt = Math.round((avgDomainsPerPrompt / Object.keys(manifest.domains).length) * totalRuleTokens);
  const wouldHaveCost = totalRuleTokens * totalPrompts;
  const actualCost = avgTokensPerPrompt * totalPrompts;
  const savedTokens = Math.max(0, wouldHaveCost - actualCost);

  console.log(chalk.bold('Session Summary'));
  console.log(chalk.gray(`  Sessions:       ${totalSessions}`));
  console.log(chalk.gray(`  Total prompts:  ${totalPrompts}`));
  console.log();

  console.log(chalk.bold('Token Efficiency'));
  console.log(chalk.gray(`  Rules available:       ${totalRuleTokens}t (all domains combined)`));
  console.log(chalk.gray(`  Avg injected/prompt:   ~${avgTokensPerPrompt}t`));
  console.log(chalk.green(`  Estimated tokens saved: ~${savedTokens.toLocaleString()}t vs always-on approach`));
  console.log();

  if (Object.keys(domainHits).length > 0) {
    console.log(chalk.bold('Domain Effectiveness'));
    console.log(chalk.gray('  (hit rate × avg relevance score = effectiveness)\n'));

    // Compute effectiveness = hit_rate * avg_score, sort by it
    const scored = Object.entries(domainHits).map(([domain, hits]) => {
      const hitRate = hits / totalPrompts;
      const avg = avgScore(domainScores[domain]);
      const effectiveness = avg > 0 ? hitRate * avg : hitRate * 0.5; // no score data = neutral
      return { domain, hits, hitRate, avg, effectiveness };
    });
    scored.sort((a, b) => b.effectiveness - a.effectiveness);

    for (const { domain, hits, hitRate, avg, effectiveness } of scored) {
      const pct = Math.round(hitRate * 100);
      const bar = '█'.repeat(Math.min(Math.round(pct / 5), 20));
      const avgStr = avg > 0 ? `  avg score: ${avg.toFixed(2)}` : '  avg score: n/a';
      const effStr = `  eff: ${(effectiveness * 100).toFixed(0)}%`;
      const color = effectiveness > 0.15 ? chalk.green : effectiveness > 0.05 ? chalk.yellow : chalk.gray;
      const warning = effectiveness < 0.03 && hits > 3 ? chalk.red(' ⚠ low — consider revising keywords') : '';
      console.log(color(`  ${domain.padEnd(20)} ${bar.padEnd(20)} ${hits} hits (${pct}%)${avgStr}${effStr}`) + warning);
    }
    console.log();
  }

  // Decision Health — fire counts + violation counts from monitor
  const allDecisionIds = new Set([...Object.keys(decisionHits), ...Object.keys(contradictionHits)]);
  if (allDecisionIds.size > 0) {
    const decisions = loadDecisions(chuckDir);
    const decisionMap = new Map(decisions.map(d => [d.id, d.decision]));

    console.log(chalk.bold('Decision Health'));
    console.log(chalk.gray('  (fires = injected by hook  |  violations = rejected alternative written  |  hold rate = fires/(fires+violations))\n'));

    // Sort by violation count desc, then by fires desc
    const rows = [...allDecisionIds].map(id => ({
      id,
      label: decisionMap.get(id) ?? id,
      fires: decisionHits[id] ?? 0,
      violations: contradictionHits[id] ?? 0,
    }));
    rows.sort((a, b) => b.violations - a.violations || b.fires - a.fires);

    for (const { id, label, fires, violations } of rows) {
      const total = fires + violations;
      const holdRate = total > 0 ? Math.round((fires / total) * 100) : 100;
      const shortLabel = label.length > 50 ? label.slice(0, 47) + '…' : label;
      const holdColor = violations === 0 ? chalk.green : holdRate >= 80 ? chalk.yellow : chalk.red;
      const violationStr = violations > 0
        ? chalk.red(` ⚠ ${violations} violation${violations > 1 ? 's' : ''}`)
        : chalk.green(' ✓ clean');
      console.log(
        holdColor(`  ${shortLabel.padEnd(52)}`) +
        chalk.gray(`fires: ${String(fires).padStart(3)}`) +
        violationStr +
        chalk.gray(`  hold: ${holdRate}%`)
      );
    }
    console.log();
  }
}
