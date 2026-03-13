import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { findChuckDir, loadManifest, loadRuleFile, estimateTokens, loadSessionData } from './utils';

export async function auditCommand(): Promise<void> {
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
  const domainHitTotals: Record<string, number> = {};

  for (const session of Object.values(sessions)) {
    for (const [domain, hits] of Object.entries(session.domain_hits ?? {})) {
      domainHitTotals[domain] = (domainHitTotals[domain] ?? 0) + hits;
    }
  }

  const totalSessions = Object.keys(sessions).length;
  const budget = manifest.token_budget ?? 2000;

  console.log(chalk.bold.cyan('\n⚡ Chuck Audit\n'));
  console.log(chalk.gray(`Sessions analyzed: ${totalSessions}`));
  console.log(chalk.gray(`Token budget: ${budget}\n`));

  const issues: string[] = [];
  let totalActive = 0;

  for (const [name, config] of Object.entries(manifest.domains)) {
    if ((config.state ?? 'active') !== 'active') continue;

    const rulesFile = config.rules_file;
    const hits = domainHitTotals[name] ?? 0;

    // Missing rule file
    if (rulesFile) {
      const content = loadRuleFile(chuckDir, rulesFile);
      if (!content) {
        issues.push(chalk.red(`✗ [MISSING FILE] ${name}: ${rulesFile} not found`));
        continue;
      }

      const tokens = estimateTokens(content);
      totalActive += tokens;

      // Over budget single domain
      if (tokens > budget * 0.5) {
        issues.push(chalk.yellow(`⚠ [BLOATED] ${name}: ${tokens}t is >50% of total budget — trim it`));
      }

      // Dead domain (never triggered in any recorded session)
      if (totalSessions >= 5 && hits === 0 && !config.always_on) {
        issues.push(chalk.yellow(`⚠ [DEAD] ${name}: never triggered across ${totalSessions} sessions — consider removing`));
      }

      // Low hit rate
      if (totalSessions >= 10 && hits < totalSessions * 0.05 && !config.always_on) {
        issues.push(chalk.gray(`ℹ [RARE] ${name}: triggered ${hits}/${totalSessions} sessions (${Math.round(hits/totalSessions*100)}%) — may not be worth keeping`));
      }
    } else if (!config.always_on) {
      issues.push(chalk.yellow(`⚠ [NO FILE] ${name}: no rules_file defined`));
    }

    // No keywords on non-always-on domain (GLOBAL is always-on by convention)
    if (name !== 'GLOBAL' && !config.always_on && !config.trigger?.keywords?.length) {
      issues.push(chalk.yellow(`⚠ [NO TRIGGER] ${name}: no keywords defined — domain will never auto-load`));
    }

    // Keyword overlap detection
    const keywords = config.trigger?.keywords ?? [];
    for (const [otherName, otherConfig] of Object.entries(manifest.domains)) {
      if (otherName === name) continue;
      const otherKeywords = otherConfig.trigger?.keywords ?? [];
      const overlap = keywords.filter(k => otherKeywords.includes(k));
      if (overlap.length > 0) {
        issues.push(chalk.gray(`ℹ [OVERLAP] ${name} ↔ ${otherName}: shared keywords [${overlap.join(', ')}] — check priority ordering`));
      }
    }
  }

  if (issues.length === 0) {
    console.log(chalk.green('✅ No issues found. Rules look healthy.\n'));
  } else {
    issues.forEach(i => console.log(i));
    console.log();
  }

  // Over-budget warning
  if (totalActive > budget) {
    console.log(chalk.red(`⚠ Total active rule tokens (${totalActive}t) exceeds budget (${budget}t)`));
    console.log(chalk.gray(`  At runtime, lowest-scoring domains will be dropped to stay under budget.\n`));
  }

  // Domain hit summary
  if (totalSessions > 0) {
    console.log(chalk.bold('\nDomain usage (last ' + totalSessions + ' sessions):'));
    const sorted = Object.entries(domainHitTotals).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) {
      console.log(chalk.gray('  No domain hits recorded yet — devmode may need to be enabled.\n'));
    } else {
      for (const [domain, hits] of sorted) {
        const pct = Math.round((hits / totalSessions) * 100);
        const bar = '█'.repeat(Math.min(Math.round(pct / 5), 20));
        const color = pct > 50 ? chalk.green : pct > 20 ? chalk.yellow : chalk.gray;
        console.log(color(`  ${domain.padEnd(20)} ${bar} ${pct}%`));
      }
      console.log();
    }
  }
}
