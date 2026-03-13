import chalk from 'chalk';
import { findChuckDir, loadManifest, loadSessionData, avgScore } from './utils';

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'is','it','its','be','was','are','were','have','has','do','does','did',
  'i','we','you','he','she','they','this','that','these','those','my','our',
  'can','could','would','should','will','want','need','make','get','let',
  'how','what','why','when','where','which','who','there','here','so','just',
  'some','any','all','no','not','also','then','than','more','very','please',
  'add','new','update','fix','change','create','remove','use','using',
]);

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? [];
}

export async function suggestCommand(): Promise<void> {
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

  console.log(chalk.bold.cyan('\n⚡ Chuck Suggest\n'));

  if (totalSessions === 0) {
    console.log(chalk.gray('No session data yet — use Claude Code with the hook active first.\n'));
    return;
  }

  // Collect all miss prompts (prompts where no domain fired)
  const missPrompts: string[] = [];
  for (const session of Object.values(sessions)) {
    missPrompts.push(...(session.miss_prompts ?? []));
  }

  // Collect all existing domain keywords
  const existingKeywords = new Set<string>();
  for (const config of Object.values(manifest.domains)) {
    for (const kw of config.trigger?.keywords ?? []) {
      existingKeywords.add(kw.toLowerCase());
    }
  }

  // ── Suggestion 1: New keywords for existing domains ───────────────────────
  // Find low-effectiveness domains and suggest keyword improvements
  const domainHits: Record<string, number> = {};
  const domainScores: Record<string, { total: number; count: number }> = {};
  let totalPrompts = 0;
  for (const session of Object.values(sessions)) {
    totalPrompts += session.prompt_count ?? 1;
    for (const [d, h] of Object.entries(session.domain_hits ?? {})) {
      domainHits[d] = (domainHits[d] ?? 0) + h;
    }
    for (const [d, s] of Object.entries(session.domain_scores ?? {})) {
      if (!domainScores[d]) domainScores[d] = { total: 0, count: 0 };
      domainScores[d].total += s.total;
      domainScores[d].count += s.count;
    }
  }

  const weakDomains = Object.entries(manifest.domains).filter(([name, config]) => {
    if (name === 'GLOBAL' || config.always_on) return false;
    const hits = domainHits[name] ?? 0;
    const hitRate = hits / Math.max(totalPrompts, 1);
    const avg = avgScore(domainScores[name]);
    const eff = avg > 0 ? hitRate * avg : hitRate * 0.5;
    return eff < 0.05 && totalPrompts >= 5;
  });

  if (weakDomains.length > 0) {
    console.log(chalk.bold('Low-effectiveness domains — consider expanding keywords:\n'));
    for (const [name, config] of weakDomains) {
      const hits = domainHits[name] ?? 0;
      const avg = avgScore(domainScores[name]);
      console.log(chalk.yellow(`  ${name}`));
      console.log(chalk.gray(`    Current keywords: ${(config.trigger?.keywords ?? []).join(', ') || 'none'}`));
      console.log(chalk.gray(`    Hit rate: ${hits}/${totalPrompts} | Avg score: ${avg > 0 ? avg.toFixed(2) : 'n/a'}`));
      console.log();
    }
  }

  // ── Suggestion 2: New domains from unmatched prompts ─────────────────────
  if (missPrompts.length === 0) {
    console.log(chalk.gray('No unmatched prompts recorded yet — miss tracking requires recent sessions.\n'));
    console.log(chalk.gray('Tip: enable devmode in manifest.json to accelerate data collection.\n'));
    return;
  }

  // Frequency count all tokens from miss prompts, excluding stop words + existing keywords
  const freq: Record<string, number> = {};
  for (const prompt of missPrompts) {
    const seen = new Set<string>();
    for (const token of tokenize(prompt)) {
      if (STOP_WORDS.has(token)) continue;
      if (existingKeywords.has(token)) continue;
      if (seen.has(token)) continue; // count once per prompt
      seen.add(token);
      freq[token] = (freq[token] ?? 0) + 1;
    }
  }

  // Group into potential domain clusters by co-occurrence
  const topTerms = Object.entries(freq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);

  if (topTerms.length === 0) {
    console.log(chalk.green('✅ All common prompt patterns are covered by existing domains.\n'));
    return;
  }

  console.log(chalk.bold(`Unmatched prompt analysis (${missPrompts.length} prompts with no domain match):\n`));
  console.log(chalk.gray('  These terms appear frequently in prompts that Chuck didn\'t help with:\n'));

  // Show top terms with frequency bar
  for (const [term, count] of topTerms.slice(0, 15)) {
    const pct = Math.round((count / missPrompts.length) * 100);
    const bar = '█'.repeat(Math.min(count, 10));
    const color = pct > 30 ? chalk.cyan : pct > 15 ? chalk.yellow : chalk.gray;
    console.log(color(`  ${term.padEnd(20)} ${bar.padEnd(12)} ${count}/${missPrompts.length} prompts (${pct}%)`));
  }
  console.log();

  // Suggest domain groupings based on known tech clusters
  const CLUSTERS: Record<string, string[]> = {
    'testing':     ['test', 'spec', 'jest', 'describe', 'expect', 'mock', 'coverage', 'unit', 'integration'],
    'styling':     ['style', 'css', 'color', 'theme', 'font', 'layout', 'flex', 'padding', 'margin', 'spacing'],
    'api':         ['api', 'fetch', 'request', 'endpoint', 'rest', 'graphql', 'response', 'header', 'auth'],
    'database':    ['database', 'query', 'table', 'schema', 'migration', 'index', 'row', 'column', 'sql'],
    'performance': ['performance', 'optimize', 'slow', 'cache', 'memory', 'bundle', 'load', 'render', 'lag'],
    'error':       ['error', 'exception', 'crash', 'bug', 'fix', 'debug', 'stack', 'trace', 'undefined'],
  };

  const termSet = new Set(topTerms.map(([t]) => t));
  const suggestions: Array<{ domain: string; matched: string[] }> = [];

  for (const [domain, clusterTerms] of Object.entries(CLUSTERS)) {
    if (manifest.domains[domain]) continue; // already exists
    const matched = clusterTerms.filter(t => termSet.has(t));
    if (matched.length >= 2) {
      suggestions.push({ domain, matched });
    }
  }

  if (suggestions.length > 0) {
    console.log(chalk.bold('Suggested new domains:\n'));
    for (const { domain, matched } of suggestions) {
      console.log(chalk.green(`  chuck add ${domain}`));
      console.log(chalk.gray(`    Matched terms: ${matched.join(', ')}\n`));
    }
    console.log(chalk.gray('  Run the above commands to add these domains, then customize the rules.\n'));
  } else {
    console.log(chalk.gray('  No strong cluster matches found — consider adding a custom domain:\n'));
    console.log(chalk.gray(`  Top terms to use as keywords: ${topTerms.slice(0, 5).map(([t]) => t).join(', ')}\n`));
  }
}
