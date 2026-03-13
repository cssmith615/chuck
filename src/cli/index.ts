import { Command } from 'commander';
import { initCommand } from './init';
import { listCommand } from './list';
import { addCommand } from './add';
import { auditCommand } from './audit';
import { statsCommand } from './stats';
import { suggestCommand } from './suggest';
import { syncCommand } from './sync';
import { installHookCommand } from './install-hook';
import { decideCommand } from './decide';

const program = new Command();

program
  .name('chuck')
  .description('Claude Hook for Universal Context Keeper — smarter Claude Code context')
  .version('0.3.0');

program
  .command('init')
  .description('Scan project and generate starter rules')
  .option('-g, --global', 'Initialize global (~/.chuck) config instead of local')
  .option('--dry-run', 'Preview what would be generated without writing')
  .action(initCommand);

program
  .command('list')
  .description('Show active domains and estimated token usage')
  .option('-v, --verbose', 'Show rule content preview')
  .action(listCommand);

program
  .command('add <pack>')
  .description('Install a community rule pack (e.g. chuck add react)')
  .action(addCommand);

program
  .command('audit')
  .description('Find dead, conflicting, or over-budget rules')
  .action(auditCommand);

program
  .command('stats')
  .description('Show token savings and domain usage over time')
  .action(statsCommand);

program
  .command('suggest')
  .description('Analyze unmatched prompts and suggest new domains or keywords')
  .action(suggestCommand);

program
  .command('sync')
  .description('Push or pull .chuck/ rules via git for team sharing')
  .option('--push', 'Commit and push rule changes (default)')
  .option('--pull', 'Pull latest rules from remote')
  .option('-m, --message <msg>', 'Custom commit message for push')
  .action(syncCommand);

program
  .command('install-hook')
  .description('Install the Chuck hook into Claude Code settings')
  .option('-g, --global', 'Install into global Claude settings (~/.claude/settings.json)')
  .action(installHookCommand);

// Decision Ledger — chuck decide [text], chuck decide:list, etc.
decideCommand(program);

program.parse();
