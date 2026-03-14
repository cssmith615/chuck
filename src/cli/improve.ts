import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import chalk from 'chalk';
import {
  findChuckDir,
  loadManifest,
  saveManifest,
  loadSessionData,
  loadDecisions,
  saveDecision,
  avgScore,
  Manifest,
} from './utils';
import { evalCommand } from './eval';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

// ── Proposal types ────────────────────────────────────────────────────────────

interface KeywordProposal {
  type: 'add_keywords';
  domain: string;
  current: string[];
  additions: string[];
  reason: string;
}

interface DecisionViolationProposal {
  type: 'decision_violation';
  id: string;
  text: string;
  violations: number;
  fires: number;
  holdRate: number;
}

type Proposal = KeywordProposal | DecisionViolationProposal;

// ── Analysis ──────────────────────────────────────────────────────────────────

function buildProposals(
  manifest: Manifest,
  sessions: ReturnType<typeof loadSessionData>,
  decisions: ReturnType<typeof loadDecisions>
): Proposal[] {
  const proposals: Proposal[] = [];

  // ── Aggregate session data ────────────────────────────────────────────────
  const missPrompts: string[] = [];
  const domainHits: Record<string, number> = {};
  const domainScores: Record<string, { total: number; count: number }> = {};
  const decisionHits: Record<string, number> = {};
  const contradictionHits: Record<string, number> = {};
  let totalPrompts = 0;

  for (const session of Object.values(sessions)) {
    totalPrompts += session.prompt_count ?? 1;
    missPrompts.push(...(session.miss_prompts ?? []));
    for (const [d, h] of Object.entries(session.domain_hits ?? {})) {
      domainHits[d] = (domainHits[d] ?? 0) + h;
    }
    for (const [d, s] of Object.entries(session.domain_scores ?? {})) {
      if (!domainScores[d]) domainScores[d] = { total: 0, count: 0 };
      domainScores[d].total += s.total;
      domainScores[d].count += s.count;
    }
    for (const [id, h] of Object.entries(session.decision_hits ?? {})) {
      decisionHits[id] = (decisionHits[id] ?? 0) + h;
    }
    for (const [id, h] of Object.entries(session.contradiction_hits ?? {})) {
      contradictionHits[id] = (contradictionHits[id] ?? 0) + h;
    }
  }

  // ── Collect all existing trigger keywords (for dedup) ────────────────────
  const allExistingKeywords = new Set<string>();
  for (const config of Object.values(manifest.domains)) {
    for (const kw of config.trigger?.keywords ?? []) {
      allExistingKeywords.add(kw.toLowerCase());
    }
  }

  // ── Proposal 1: Keyword additions for weak/miss domains ──────────────────
  // Build miss term frequency
  const missFreq: Record<string, number> = {};
  const termPromptsMap: Record<string, string[]> = {}; // term → prompts it appears in

  for (const prompt of missPrompts) {
    const tokens = [...new Set(tokenize(prompt))];
    for (const token of tokens) {
      if (STOP_WORDS.has(token)) continue;
      if (allExistingKeywords.has(token)) continue;
      missFreq[token] = (missFreq[token] ?? 0) + 1;
      if (!termPromptsMap[token]) termPromptsMap[token] = [];
      termPromptsMap[token].push(prompt);
    }
  }

  const qualifiedMissTerms = Object.entries(missFreq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([term]) => term);

  // For each domain, find miss terms with affinity via co-occurrence
  // A miss term has affinity for domain D if it co-occurs in miss prompts with D's existing keywords
  for (const [domainName, config] of Object.entries(manifest.domains)) {
    if (domainName === 'GLOBAL' || config.always_on || config.state === 'disabled') continue;

    const domainKeywords = new Set((config.trigger?.keywords ?? []).map(k => k.toLowerCase()));
    if (!domainKeywords.size) continue;

    // Compute effectiveness
    const hits = domainHits[domainName] ?? 0;
    const hitRate = hits / Math.max(totalPrompts, 1);
    const avg = avgScore(domainScores[domainName]);
    const effectiveness = avg > 0 ? hitRate * avg : hitRate * 0.5;

    // Find miss terms that co-occur with this domain's keywords in miss prompts
    const affinityScores: Record<string, number> = {};
    for (const term of qualifiedMissTerms) {
      const termPrompts = termPromptsMap[term] ?? [];
      let coOccurrences = 0;
      for (const prompt of termPrompts) {
        const promptTokens = new Set(tokenize(prompt));
        if ([...domainKeywords].some(kw => promptTokens.has(kw) || [...promptTokens].some(t => kw.length >= 4 && t.startsWith(kw.slice(0, 4))))) {
          coOccurrences++;
        }
      }
      if (coOccurrences > 0) {
        affinityScores[term] = coOccurrences / termPrompts.length;
      }
    }

    const candidates = Object.entries(affinityScores)
      .filter(([, score]) => score >= 0.3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([term]) => term);

    // Propose if: domain is weak OR has good candidates
    if (candidates.length >= 2 || (effectiveness < 0.05 && candidates.length >= 1 && totalPrompts >= 5)) {
      proposals.push({
        type: 'add_keywords',
        domain: domainName,
        current: config.trigger?.keywords ?? [],
        additions: candidates,
        reason: effectiveness < 0.05
          ? `Low effectiveness (${(effectiveness * 100).toFixed(0)}%) — ${hits} hits / ${totalPrompts} prompts`
          : `${candidates.length} high-affinity miss terms found across ${missPrompts.length} unmatched prompts`,
      });
    }
  }

  // ── Proposal 2: Violated decisions ───────────────────────────────────────
  const violatedDecisions = decisions
    .filter(d => d.status === 'active' && (contradictionHits[d.id] ?? 0) > 0)
    .sort((a, b) => (contradictionHits[b.id] ?? 0) - (contradictionHits[a.id] ?? 0));

  for (const d of violatedDecisions) {
    const violations = contradictionHits[d.id] ?? 0;
    const fires = decisionHits[d.id] ?? 0;
    const total = fires + violations;
    const holdRate = total > 0 ? Math.round((fires / total) * 100) : 100;

    proposals.push({
      type: 'decision_violation',
      id: d.id,
      text: d.decision,
      violations,
      fires,
      holdRate,
    });
  }

  return proposals;
}

// ── Apply keyword proposal ────────────────────────────────────────────────────

function applyKeywordProposal(chuckDir: string, manifest: Manifest, proposal: KeywordProposal): Manifest {
  const domain = manifest.domains[proposal.domain];
  if (!domain) return manifest;

  if (!domain.trigger) domain.trigger = {};
  const existing = domain.trigger.keywords ?? [];
  const merged = [...new Set([...existing, ...proposal.additions])];
  domain.trigger.keywords = merged;

  return manifest;
}

// ── Run evals in-process and return pass rate ─────────────────────────────────

async function getEvalPassRate(chuckDir: string): Promise<number | null> {
  const evalDir = path.join(chuckDir, 'evals');
  if (!fs.existsSync(evalDir)) return null;
  const files = fs.readdirSync(evalDir).filter(f => f.endsWith('.json'));
  if (!files.length) return null;

  // Capture process.exit calls temporarily
  let passed = 0;
  let total = 0;

  const manifest = loadManifest(chuckDir);
  const decisions = loadDecisions(chuckDir);

  for (const file of files) {
    try {
      const evalCase = JSON.parse(fs.readFileSync(path.join(evalDir, file), 'utf-8'));
      const { evalCommand: _unused, ...rest } = { evalCommand: null };
      void rest;

      // Inline the scoring to avoid process.exit
      const promptTokens = evalCase.prompt.toLowerCase().match(/[a-z0-9]+/g) ?? [];
      const promptSet = new Set<string>(promptTokens);

      const matchedDomains: string[] = [];
      if (manifest) {
        for (const [name, config] of Object.entries(manifest.domains)) {
          if (name === 'GLOBAL' || config.state === 'disabled') continue;
          if (config.always_on) { matchedDomains.push(name); continue; }
          const keywords = (config.trigger?.keywords ?? []).map((k: string) => k.toLowerCase());
          if (!keywords.length) continue;
          const hits = keywords.filter((kw: string) => {
            if (promptSet.has(kw)) return true;
            if (kw.length >= 4) return [...promptSet].some(t => t.startsWith(kw.slice(0, 4)));
            return false;
          }).length;
          if (hits / keywords.length > 0.05) matchedDomains.push(name);
        }
      }

      const matchedDecisions: string[] = [];
      for (const d of decisions) {
        if (d.status !== 'active') continue;
        const tags = (d.tags ?? []).map((t: string) => t.toLowerCase());
        const words = (d.decision ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
        const keywords = [...new Set([...tags, ...words])];
        const hits = keywords.filter(kw => {
          if (promptSet.has(kw)) return true;
          if (kw.length >= 4) return [...promptSet].some(t => t.startsWith(kw.slice(0, 4)));
          return false;
        }).length;
        if (keywords.length && hits / keywords.length > 0.05) matchedDecisions.push(d.id);
      }

      const expectedDomains: string[] = evalCase.expected_domains ?? [];
      const expectedDecisions: string[] = evalCase.expected_decisions ?? [];
      const missedDomains = expectedDomains.filter((d: string) => !matchedDomains.includes(d));
      const missedDecisions = expectedDecisions.filter((d: string) => !matchedDecisions.includes(d));
      total++;
      if (!missedDomains.length && !missedDecisions.length) passed++;
    } catch { /* skip */ }
  }

  return total > 0 ? passed / total : null;
}

// ── Command ───────────────────────────────────────────────────────────────────

export async function improveCommand(options: { auto?: boolean }): Promise<void> {
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
  const decisions = loadDecisions(chuckDir);

  if (Object.keys(sessions).length === 0) {
    console.log(chalk.yellow('\nNo session data yet — use Claude Code with the hook active first.'));
    return;
  }

  console.log(chalk.bold.cyan('\n⚡ Chuck Improve\n'));

  // Baseline eval pass rate
  const baseline = await getEvalPassRate(chuckDir);
  if (baseline !== null) {
    const pct = Math.round(baseline * 100);
    const color = pct === 100 ? chalk.green : pct >= 75 ? chalk.yellow : chalk.red;
    console.log(chalk.gray('Baseline eval: ') + color(`${pct}%`) + chalk.gray(' passing\n'));
  }

  // Build proposals
  const proposals = buildProposals(manifest, sessions, decisions);

  if (!proposals.length) {
    console.log(chalk.green('✅ Nothing to improve — rules and decisions look healthy.\n'));
    console.log(chalk.gray('Tip: run more sessions then try again, or add evals with: chuck eval:seed'));
    return;
  }

  console.log(chalk.bold(`─── ${proposals.length} improvement${proposals.length > 1 ? 's' : ''} found ─────────────────────────\n`));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let appliedKeywordProposals: KeywordProposal[] = [];
  let workingManifest = JSON.parse(JSON.stringify(manifest)) as Manifest; // deep clone

  for (let i = 0; i < proposals.length; i++) {
    const proposal = proposals[i];
    console.log(chalk.bold(`[${i + 1}/${proposals.length}]`));

    if (proposal.type === 'add_keywords') {
      const p = proposal as KeywordProposal;
      console.log(chalk.cyan(`  Domain: ${p.domain}`));
      console.log(chalk.gray(`  Reason: ${p.reason}`));
      console.log(chalk.gray(`  Current keywords: ${p.current.join(', ') || 'none'}`));
      console.log(chalk.green(`  Proposed additions: ${p.additions.join(', ')}`));
      console.log();

      if (options.auto) {
        console.log(chalk.gray('  --auto: applying'));
        appliedKeywordProposals.push(p);
        workingManifest = applyKeywordProposal(chuckDir, workingManifest, p);
      } else {
        const answer = await ask(rl, chalk.white('  Apply? [y/n/skip] '));
        console.log();
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
          appliedKeywordProposals.push(p);
          workingManifest = applyKeywordProposal(chuckDir, workingManifest, p);
          console.log(chalk.green(`  ✓ Queued: ${p.domain} +${p.additions.length} keywords`));
        } else {
          console.log(chalk.gray('  Skipped'));
        }
        console.log();
      }
    }

    if (proposal.type === 'decision_violation') {
      const p = proposal as DecisionViolationProposal;
      const holdColor = p.holdRate >= 80 ? chalk.yellow : chalk.red;
      console.log(chalk.cyan(`  Decision: ${p.text.slice(0, 70)}`));
      console.log(chalk.gray(`  ID: ${p.id}`));
      console.log(chalk.gray(`  Fires: ${p.fires}  `) + chalk.red(`Violations: ${p.violations}  `) + holdColor(`Hold rate: ${p.holdRate}%`));
      console.log(chalk.gray('  This decision is being violated — review its rejected[] and trigger tags.'));
      console.log();

      if (!options.auto) {
        const answer = await ask(rl, chalk.white('  Open in decide:show? [y/n] '));
        console.log();
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
          const decision = decisions.find(d => d.id === p.id);
          if (decision) {
            console.log(chalk.bold(`\n  ${p.id}`));
            console.log(`  Decision:    ${decision.decision}`);
            console.log(`  Rejected:    ${decision.rejected.join(', ') || '—'}`);
            console.log(`  Reason:      ${decision.reason}`);
            console.log(`  Tags:        ${decision.tags.join(', ') || '—'}`);
            console.log();
            const edit = await ask(rl, chalk.white('  Add rejected alternatives (comma-separated, blank to skip): '));
            if (edit.trim()) {
              const newRejected = edit.split(',').map(s => s.trim()).filter(Boolean);
              decision.rejected = [...new Set([...decision.rejected, ...newRejected])];
              saveDecision(chuckDir, decision);
              console.log(chalk.green(`  ✓ Updated rejected[]: ${decision.rejected.join(', ')}`));
            }
            console.log();
          }
        } else {
          console.log(chalk.gray('  Skipped'));
          console.log();
        }
      }
    }
  }

  rl.close();

  // Apply keyword changes to manifest
  if (appliedKeywordProposals.length > 0) {
    console.log(chalk.bold('─── Applying changes ─────────────────────────────────\n'));
    for (const p of appliedKeywordProposals) {
      console.log(chalk.green(`  ✓ ${p.domain} — added ${p.additions.length} keyword${p.additions.length > 1 ? 's' : ''}: ${p.additions.join(', ')}`));
    }
    saveManifest(chuckDir, workingManifest);
    console.log();

    // Re-run evals to show delta
    if (baseline !== null) {
      const after = await getEvalPassRate(chuckDir);
      if (after !== null) {
        const beforePct = Math.round(baseline * 100);
        const afterPct = Math.round(after * 100);
        const delta = afterPct - beforePct;
        const deltaStr = delta > 0 ? chalk.green(`+${delta}%`) : delta < 0 ? chalk.red(`${delta}%`) : chalk.gray('no change');
        console.log(chalk.bold('Eval results:'));
        console.log(chalk.gray(`  Before: ${beforePct}%  After: ${afterPct}%  `) + deltaStr);
        console.log();
      }
    }

    console.log(chalk.green('✅ Changes saved to .chuck/manifest.json'));
    console.log(chalk.gray('Run: chuck sync --push   to share with team'));
    console.log(chalk.gray('Run: chuck eval          to recheck full test suite'));
  } else {
    console.log(chalk.gray('No changes applied.'));
  }

  console.log();
}
