import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { findChuckDir, loadManifest, loadDecisions } from './utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EvalCase {
  description?: string;
  prompt: string;
  expected_domains?: string[];
  expected_decisions?: string[];
}

interface EvalResult {
  file: string;
  description: string;
  passed: boolean;
  matched_domains: string[];
  matched_decisions: string[];
  missed_domains: string[];
  missed_decisions: string[];
  extra_domains: string[];
}

// ── Minimal scoring (mirrors chuck-hook.py logic) ─────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function fuzzyContains(promptTokens: Set<string>, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  if (promptTokens.has(kw)) return true;
  if (kw.length >= 4) {
    const prefix = kw.slice(0, 4);
    for (const t of promptTokens) {
      if (t.startsWith(prefix)) return true;
    }
  }
  return false;
}

function scoreDomain(
  promptTokens: string[],
  promptSet: Set<string>,
  trigger: Record<string, unknown>
): number {
  const keywords = ((trigger.keywords as string[]) ?? []).map(k => k.toLowerCase());
  if (!keywords.length) return 0;

  const useFuzzy = trigger.fuzzy !== false;
  const operator = ((trigger.operator as string) ?? 'OR').toUpperCase();

  if (operator === 'AND') {
    const allMatch = useFuzzy
      ? keywords.every(kw => fuzzyContains(promptSet, kw))
      : keywords.every(kw => promptSet.has(kw));
    if (!allMatch) return 0;
  }

  const hits = useFuzzy
    ? keywords.filter(kw => fuzzyContains(promptSet, kw)).length
    : keywords.filter(kw => promptSet.has(kw)).length;

  return hits / keywords.length;
}

function scoreDecision(
  promptTokens: string[],
  promptSet: Set<string>,
  decision: { tags?: string[]; decision?: string }
): number {
  const tags = (decision.tags ?? []).map(t => t.toLowerCase());
  const words = tokenize(decision.decision ?? '');
  const keywords = [...new Set([...tags, ...words])];
  if (!keywords.length) return 0;
  return scoreDomain(promptTokens, promptSet, { keywords, fuzzy: true });
}

// ── Eval loading ──────────────────────────────────────────────────────────────

function loadEvals(chuckDir: string): Array<{ file: string; eval: EvalCase }> {
  const evalDir = path.join(chuckDir, 'evals');
  if (!fs.existsSync(evalDir)) return [];
  const results: Array<{ file: string; eval: EvalCase }> = [];
  for (const file of fs.readdirSync(evalDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(evalDir, file), 'utf-8'));
      results.push({ file, eval: data });
    } catch {
      console.log(chalk.yellow(`  ⚠ Could not parse ${file} — skipping`));
    }
  }
  return results;
}

// ── Run a single eval case ────────────────────────────────────────────────────

function runEval(
  evalCase: EvalCase,
  manifest: ReturnType<typeof loadManifest>,
  decisions: ReturnType<typeof loadDecisions>
): Pick<EvalResult, 'matched_domains' | 'matched_decisions'> {
  const promptTokens = tokenize(evalCase.prompt);
  const promptSet = new Set(promptTokens);

  // Match domains
  const matched_domains: string[] = [];
  if (manifest) {
    for (const [name, config] of Object.entries(manifest.domains)) {
      if (name === 'GLOBAL') continue;
      if (config.state === 'disabled') continue;
      if (config.always_on) {
        matched_domains.push(name);
        continue;
      }
      const trigger = (config.trigger ?? {}) as Record<string, unknown>;
      const score = scoreDomain(promptTokens, promptSet, trigger);
      if (score > 0.05) matched_domains.push(name);
    }
  }

  // Match decisions
  const matched_decisions: string[] = [];
  for (const d of decisions) {
    if (d.status !== 'active') continue;
    const score = scoreDecision(promptTokens, promptSet, d);
    if (score > 0.05) matched_decisions.push(d.id);
  }

  return { matched_domains, matched_decisions };
}

// ── Command ───────────────────────────────────────────────────────────────────

export async function evalCommand(options: { verbose?: boolean }): Promise<void> {
  const chuckDir = findChuckDir();
  if (!chuckDir) {
    console.log(chalk.red('No .chuck config found. Run: chuck init'));
    return;
  }

  const evalDir = path.join(chuckDir, 'evals');
  if (!fs.existsSync(evalDir)) {
    console.log(chalk.yellow('\nNo evals found.'));
    console.log(chalk.gray(`Create test cases in ${evalDir}/ as JSON files:\n`));
    console.log(chalk.gray('  {'));
    console.log(chalk.gray('    "description": "state question matches zustand domain",'));
    console.log(chalk.gray('    "prompt": "how should I manage global state?",'));
    console.log(chalk.gray('    "expected_domains": ["zustand", "react"],'));
    console.log(chalk.gray('    "expected_decisions": ["dec_use_zustand_for_state_management"]'));
    console.log(chalk.gray('  }\n'));
    console.log(chalk.gray('Run: chuck eval:seed   to generate starter evals from your stack'));
    return;
  }

  const manifest = loadManifest(chuckDir);
  const decisions = loadDecisions(chuckDir);
  const evalCases = loadEvals(chuckDir);

  if (!evalCases.length) {
    console.log(chalk.yellow(`\nNo .json files in ${evalDir}/ — nothing to run.`));
    return;
  }

  console.log(chalk.bold.cyan(`\n⚡ Chuck Eval — ${evalCases.length} test${evalCases.length > 1 ? 's' : ''}\n`));

  const results: EvalResult[] = [];

  for (const { file, eval: evalCase } of evalCases) {
    const { matched_domains, matched_decisions } = runEval(evalCase, manifest, decisions);

    const expected_domains = evalCase.expected_domains ?? [];
    const expected_decisions = evalCase.expected_decisions ?? [];

    const missed_domains = expected_domains.filter(d => !matched_domains.includes(d));
    const missed_decisions = expected_decisions.filter(d => !matched_decisions.includes(d));
    const extra_domains = matched_domains.filter(d => !expected_domains.includes(d));

    const passed = missed_domains.length === 0 && missed_decisions.length === 0;
    const description = evalCase.description ?? evalCase.prompt.slice(0, 60);

    results.push({
      file,
      description,
      passed,
      matched_domains,
      matched_decisions,
      missed_domains,
      missed_decisions,
      extra_domains,
    });

    const icon = passed ? chalk.green('✓') : chalk.red('✗');
    const label = chalk.gray(file.replace('.json', '').padEnd(30));
    const desc = passed
      ? chalk.green(description.slice(0, 55))
      : chalk.red(description.slice(0, 55));

    console.log(`  ${icon} ${label} ${desc}`);

    if (!passed || options.verbose) {
      if (missed_domains.length) {
        console.log(chalk.red(`      missed domains:    ${missed_domains.join(', ')}`));
      }
      if (missed_decisions.length) {
        console.log(chalk.red(`      missed decisions:  ${missed_decisions.join(', ')}`));
      }
      if (options.verbose && extra_domains.length) {
        console.log(chalk.gray(`      extra domains:     ${extra_domains.join(', ')}`));
      }
      if (options.verbose && matched_domains.length) {
        console.log(chalk.gray(`      matched domains:   ${matched_domains.join(', ')}`));
      }
      if (options.verbose && matched_decisions.length) {
        console.log(chalk.gray(`      matched decisions: ${matched_decisions.join(', ')}`));
      }
    }
  }

  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const rate = Math.round((passed / total) * 100);
  const rateColor = rate === 100 ? chalk.green : rate >= 75 ? chalk.yellow : chalk.red;

  console.log();
  console.log(chalk.bold('Results: ') + rateColor(`${passed}/${total} passed (${rate}%)`));

  if (passed < total) {
    const failures = results.filter(r => !r.passed);
    console.log(chalk.gray(`\nFailing tests:`));
    for (const f of failures) {
      console.log(chalk.gray(`  ${f.file}`));
      if (f.missed_domains.length) {
        console.log(chalk.gray(`    → add keywords to trigger these domains: ${f.missed_domains.join(', ')}`));
      }
      if (f.missed_decisions.length) {
        console.log(chalk.gray(`    → check tags on these decisions: ${f.missed_decisions.join(', ')}`));
      }
    }
  }

  console.log();
  process.exit(passed === total ? 0 : 1);
}

// ── eval:seed — generate starter evals from active stack ────────────────────

export async function evalSeedCommand(): Promise<void> {
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

  const evalDir = path.join(chuckDir, 'evals');
  fs.mkdirSync(evalDir, { recursive: true });

  const SEED_EVALS: Record<string, EvalCase[]> = {
    react: [
      {
        description: 'Component question matches react domain',
        prompt: 'how should I structure this React component with props and state?',
        expected_domains: ['react'],
      },
    ],
    typescript: [
      {
        description: 'Type definition question matches typescript domain',
        prompt: 'what is the best way to define this TypeScript interface?',
        expected_domains: ['typescript'],
      },
    ],
    zustand: [
      {
        description: 'State management question matches zustand domain',
        prompt: 'how should I manage global state in my React app?',
        expected_domains: ['zustand'],
      },
    ],
    supabase: [
      {
        description: 'Database query question matches supabase domain',
        prompt: 'how do I write a Supabase query with row level security?',
        expected_domains: ['supabase'],
      },
    ],
    expo: [
      {
        description: 'Mobile build question matches expo domain',
        prompt: 'how do I configure EAS build for my Expo app?',
        expected_domains: ['expo'],
      },
    ],
    git: [
      {
        description: 'Commit workflow question matches git domain',
        prompt: 'what is our git commit message convention?',
        expected_domains: ['git'],
      },
    ],
    'claude-api': [
      {
        description: 'Claude API question matches claude-api domain',
        prompt: 'how should I call the Claude API with streaming?',
        expected_domains: ['claude-api'],
      },
    ],
  };

  const domains = Object.keys(manifest.domains).filter(d => d !== 'GLOBAL');
  let seeded = 0;

  for (const domain of domains) {
    const cases = SEED_EVALS[domain];
    if (!cases) continue;
    for (const evalCase of cases) {
      const filename = `${domain}-basic.json`;
      const filePath = path.join(evalDir, filename);
      if (fs.existsSync(filePath)) {
        console.log(chalk.gray(`  skip  ${filename} (already exists)`));
        continue;
      }
      fs.writeFileSync(filePath, JSON.stringify(evalCase, null, 2));
      console.log(chalk.green(`  +     ${filename}`));
      seeded++;
    }
  }

  if (seeded === 0) {
    console.log(chalk.gray('\nAll seed evals already exist. Run: chuck eval'));
  } else {
    console.log(chalk.green(`\nSeeded ${seeded} eval${seeded > 1 ? 's' : ''} into ${evalDir}/`));
    console.log(chalk.gray('Run: chuck eval'));
  }
}
