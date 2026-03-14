import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { findChuckDir, loadManifest, loadRuleFile, estimateTokens } from './utils';

interface ListOptions {
  verbose?: boolean;
}

export async function listCommand(options: ListOptions): Promise<void> {
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

  const budget = manifest.token_budget ?? 2000;
  const mode = manifest.injection_mode ?? 'smart';
  let totalTokens = 0;

  console.log(chalk.bold.cyan('\n⚡ Chuck Domains\n'));
  console.log(chalk.gray(`Config: ${chuckDir}`));
  console.log(chalk.gray(`Token budget: ${budget}`));
  const modeLabel = mode === 'decisions_only'
    ? chalk.yellow('decisions_only') + chalk.gray(' (domains skipped — use native CLAUDE.md)')
    : chalk.green('smart') + chalk.gray(' (TF-IDF domain matching)');
  console.log(chalk.gray(`Injection mode: `) + modeLabel + '\n');

  const rows: string[] = [];

  for (const [name, config] of Object.entries(manifest.domains)) {
    const state = config.state ?? 'active';
    const stateIcon = state === 'active' ? chalk.green('●') : chalk.gray('○');
    const alwaysOn = config.always_on ? chalk.yellow(' [always-on]') : '';
    const priority = `p${config.priority ?? 5}`;

    const rulesFile = config.rules_file;
    let tokenStr = chalk.gray('no file');
    let tokenCount = 0;

    if (rulesFile) {
      const content = loadRuleFile(chuckDir, rulesFile);
      if (content) {
        tokenCount = estimateTokens(content);
        totalTokens += state === 'active' ? tokenCount : 0;
        const color = tokenCount > 500 ? chalk.red : tokenCount > 200 ? chalk.yellow : chalk.green;
        tokenStr = color(`${tokenCount}t`);
      } else {
        tokenStr = chalk.red('missing!');
      }
    }

    const keywords = config.trigger?.keywords?.slice(0, 4).join(', ') ?? (config.always_on ? 'always' : '—');

    rows.push(
      `${stateIcon} ${chalk.bold(name.padEnd(22))} ${tokenStr.padEnd(8)} ${chalk.gray(priority.padEnd(4))} ${chalk.gray(keywords)}${alwaysOn}`
    );

    if (options.verbose && rulesFile) {
      const content = loadRuleFile(chuckDir, rulesFile);
      if (content) {
        const preview = content.split('\n').slice(0, 3).join('\n');
        rows.push(chalk.gray(`  ${preview.replace(/\n/g, '\n  ')}\n`));
      }
    }
  }

  rows.forEach(r => console.log(r));

  const budgetPct = Math.round((totalTokens / budget) * 100);
  const budgetColor = budgetPct > 90 ? chalk.red : budgetPct > 70 ? chalk.yellow : chalk.green;

  console.log(chalk.gray('\n' + '─'.repeat(60)));
  console.log(`Max possible injection: ${budgetColor(`${totalTokens}t / ${budget}t (${budgetPct}%)`)}`);
  console.log(chalk.gray('(Actual injection depends on which domains match per prompt)\n'));

  if (totalTokens > budget) {
    console.log(chalk.red('⚠️  Total rules exceed token budget — some will be trimmed at runtime.'));
    console.log(chalk.gray('   Run "chuck audit" to identify and trim low-value rules.\n'));
  }
}
