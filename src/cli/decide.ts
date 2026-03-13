import * as readline from 'readline';
import chalk from 'chalk';
import {
  findChuckDir,
  loadDecisions,
  saveDecision,
  deleteDecision,
  generateDecisionId,
  Decision,
  loadSessionData,
} from './utils';

// ── helpers ──────────────────────────────────────────────────────────────────

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

function formatStatus(d: Decision): string {
  return d.status === 'superseded'
    ? chalk.dim('[superseded]')
    : chalk.green('[active]');
}

function printDecision(d: Decision, verbose = false): void {
  console.log(`\n${formatStatus(d)} ${chalk.bold(d.id)}`);
  console.log(`  ${chalk.white(d.decision)}`);
  if (verbose || d.rejected.length) {
    console.log(`  ${chalk.dim('Rejected:')} ${d.rejected.join(', ') || '—'}`);
    console.log(`  ${chalk.dim('Reason:')}  ${d.reason}`);
    if (d.constraints.length)
      console.log(`  ${chalk.dim('Constraints:')} ${d.constraints.join(', ')}`);
    if (d.tags.length)
      console.log(`  ${chalk.dim('Tags:')} ${d.tags.join(', ')}`);
    if (d.project)
      console.log(`  ${chalk.dim('Project:')} ${d.project}`);
    console.log(`  ${chalk.dim('Date:')} ${d.date}`);
  }
}

// ── subcommands ───────────────────────────────────────────────────────────────

async function logDecision(text: string, opts: { tags?: string; project?: string }): Promise<void> {
  const chuckDir = findChuckDir();
  if (!chuckDir) {
    console.error(chalk.red('No .chuck directory found. Run chuck init first.'));
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const id = generateDecisionId(text);

  // Check for duplicate
  const existing = loadDecisions(chuckDir);
  const dup = existing.find(d => d.id === id);
  if (dup) {
    console.log(chalk.yellow(`Decision with ID ${id} already exists:`));
    printDecision(dup, true);
    rl.close();
    return;
  }

  const rejectedRaw = await ask(rl, chalk.cyan('What alternatives were rejected? (comma-separated, or blank): '));
  const reason = await ask(rl, chalk.cyan('Why was this decided? '));
  const constraintsRaw = await ask(rl, chalk.cyan('Any constraints? (e.g. "React Native, mobile") (blank to skip): '));

  rl.close();

  const tagsFromOpt = opts.tags ? opts.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const rejected = rejectedRaw.split(',').map(s => s.trim()).filter(Boolean);
  const constraints = constraintsRaw.split(',').map(s => s.trim()).filter(Boolean);

  const decision: Decision = {
    id,
    decision: text,
    rejected,
    reason,
    constraints,
    tags: tagsFromOpt,
    project: opts.project,
    date: new Date().toISOString().split('T')[0],
    status: 'active',
  };

  saveDecision(chuckDir, decision);
  console.log(chalk.green(`\n✓ Decision logged: ${id}`));
  printDecision(decision, true);
}

function listDecisions(opts: { tag?: string; all?: boolean }): void {
  const chuckDir = findChuckDir();
  if (!chuckDir) {
    console.error(chalk.red('No .chuck directory found.'));
    process.exit(1);
  }

  let decisions = loadDecisions(chuckDir);

  if (!opts.all) {
    decisions = decisions.filter(d => d.status === 'active');
  }
  if (opts.tag) {
    decisions = decisions.filter(d => d.tags.includes(opts.tag!));
  }

  if (decisions.length === 0) {
    console.log(chalk.dim('No decisions found.'));
    return;
  }

  console.log(chalk.bold(`\n${decisions.length} decision(s):\n`));
  for (const d of decisions) {
    console.log(`  ${formatStatus(d)} ${chalk.bold(d.id)}`);
    console.log(`    ${d.decision}`);
    if (d.rejected.length) console.log(chalk.dim(`    Not: ${d.rejected.join(', ')}`));
  }
}

function showDecision(id: string): void {
  const chuckDir = findChuckDir();
  if (!chuckDir) { console.error(chalk.red('No .chuck directory found.')); process.exit(1); }

  const decisions = loadDecisions(chuckDir);
  const d = decisions.find(x => x.id === id || x.id === `dec_${id}`);
  if (!d) { console.log(chalk.yellow(`No decision found with id: ${id}`)); return; }
  printDecision(d, true);
}

function supersedeDecision(id: string, opts: { by?: string }): void {
  const chuckDir = findChuckDir();
  if (!chuckDir) { console.error(chalk.red('No .chuck directory found.')); process.exit(1); }

  const decisions = loadDecisions(chuckDir);
  const d = decisions.find(x => x.id === id || x.id === `dec_${id}`);
  if (!d) { console.log(chalk.yellow(`No decision found with id: ${id}`)); return; }

  d.status = 'superseded';
  if (opts.by) d.superseded_by = opts.by;
  saveDecision(chuckDir, d);
  console.log(chalk.green(`✓ Decision ${d.id} marked as superseded.`));
}

function removeDecision(id: string): void {
  const chuckDir = findChuckDir();
  if (!chuckDir) { console.error(chalk.red('No .chuck directory found.')); process.exit(1); }

  const deleted = deleteDecision(chuckDir, id.startsWith('dec_') ? id : `dec_${id}`);
  if (deleted) {
    console.log(chalk.green(`✓ Decision ${id} removed.`));
  } else {
    console.log(chalk.yellow(`No decision found with id: ${id}`));
  }
}

function auditDecisions(): void {
  const chuckDir = findChuckDir();
  if (!chuckDir) { console.error(chalk.red('No .chuck directory found.')); process.exit(1); }

  const decisions = loadDecisions(chuckDir).filter(d => d.status === 'active');
  if (decisions.length === 0) { console.log(chalk.dim('No active decisions.')); return; }

  // Aggregate decision hits from all sessions
  const allSessions = loadSessionData(chuckDir);
  const hitCounts: Record<string, number> = {};
  for (const session of Object.values(allSessions)) {
    const dh = (session as any).decision_hits ?? {};
    for (const [id, count] of Object.entries(dh)) {
      hitCounts[id] = (hitCounts[id] ?? 0) + (count as number);
    }
  }

  const totalSessions = Object.keys(allSessions).length;

  console.log(chalk.bold(`\nDecision Ledger Audit — ${decisions.length} active decision(s)\n`));

  let flagged = 0;
  for (const d of decisions) {
    const hits = hitCounts[d.id] ?? 0;
    if (hits === 0 && totalSessions > 2) {
      console.log(chalk.yellow(`  ⚠ ${d.id} — never fired (${totalSessions} sessions recorded)`));
      console.log(chalk.dim(`    "${d.decision}"`));
      console.log(chalk.dim(`    Tags: ${d.tags.join(', ') || 'none'} — consider adding more tags`));
      flagged++;
    } else {
      console.log(chalk.green(`  ✓ ${d.id} — ${hits} hit(s)`));
    }
  }

  if (flagged === 0) {
    console.log(chalk.green('\nAll decisions are firing. No dead weight detected.'));
  } else {
    console.log(chalk.yellow(`\n${flagged} decision(s) never fired. Consider: removing stale ones or adding more tags.`));
  }
}

// ── export ────────────────────────────────────────────────────────────────────

export function decideCommand(program: any): void {
  const decide = program
    .command('decide [text]')
    .description('Log, list, or manage architectural decisions');

  decide
    .option('--tags <tags>', 'Comma-separated tags (e.g. state,react,architecture)')
    .option('--project <project>', 'Project name to scope this decision')
    .action(async (text: string | undefined, opts: { tags?: string; project?: string }) => {
      if (text) {
        await logDecision(text, opts);
      } else {
        listDecisions({ all: false });
      }
    });

  program
    .command('decide:list')
    .description('List decisions (alias for: chuck decide)')
    .option('--tag <tag>', 'Filter by tag')
    .option('--all', 'Include superseded decisions')
    .action((opts: { tag?: string; all?: boolean }) => listDecisions(opts));

  program
    .command('decide:show <id>')
    .description('Show full detail for a decision')
    .action(showDecision);

  program
    .command('decide:supersede <id>')
    .description('Mark a decision as superseded (keeps history)')
    .option('--by <id>', 'ID of the new decision that replaces this one')
    .action((id: string, opts: { by?: string }) => supersedeDecision(id, opts));

  program
    .command('decide:remove <id>')
    .description('Hard delete a decision')
    .action(removeDecision);

  program
    .command('decide:audit')
    .description('Find decisions that have never fired (stale candidate)')
    .action(auditDecisions);
}
