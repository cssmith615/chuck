import chalk from 'chalk';
import { findChuckDir, loadManifest, loadSessionData, estimateTokens, loadRuleFile } from './utils';

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

  // Domain hit totals
  const domainHits: Record<string, number> = {};
  for (const session of Object.values(sessions)) {
    for (const [domain, hits] of Object.entries((session as { domain_hits?: Record<string, number> }).domain_hits ?? {})) {
      domainHits[domain] = (domainHits[domain] ?? 0) + hits;
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
    console.log(chalk.bold('Domain Usage'));
    const sorted = Object.entries(domainHits).sort((a, b) => b[1] - a[1]);
    for (const [domain, hits] of sorted) {
      const pct = Math.round((hits / totalPrompts) * 100);
      const bar = '█'.repeat(Math.min(Math.round(pct / 5), 20));
      const color = pct > 50 ? chalk.green : pct > 20 ? chalk.yellow : chalk.gray;
      console.log(color(`  ${domain.padEnd(20)} ${bar.padEnd(20)} ${hits} hits (${pct}%)`));
    }
    console.log();
  }
}
