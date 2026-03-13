import { Command } from 'commander';
import { initCommand } from './init';
import { listCommand } from './list';
import { addCommand } from './add';
import { auditCommand } from './audit';
import { statsCommand } from './stats';
import { installHookCommand } from './install-hook';

const program = new Command();

program
  .name('chuck')
  .description('Claude Hook for Universal Context Keeper — smarter Claude Code context')
  .version('0.1.0');

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
  .command('install-hook')
  .description('Install the Chuck hook into Claude Code settings')
  .option('-g, --global', 'Install into global Claude settings (~/.claude/settings.json)')
  .action(installHookCommand);

program.parse();
