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
import { compactCommand } from './compact';
import { installMonitorCommand } from './install-monitor';
import { installMcpCommand } from './install-mcp';
import { evalCommand, evalSeedCommand } from './eval';

const program = new Command();

program
  .name('chuck')
  .description('Claude Hook for Universal Context Keeper — smarter Claude Code context')
  .version('0.6.0');

program
  .command('init')
  .description('Scan project and generate starter rules')
  .option('-g, --global', 'Initialize global (~/.chuck) config instead of local')
  .option('--dry-run', 'Preview what would be generated without writing')
  .option('--native', 'Generate CLAUDE.md hierarchy instead of .chuck/domains/ (zero-cost path-scoped rules)')
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

program
  .command('install-monitor')
  .description('Install the Chuck quality monitor (PostToolUse hook) into Claude Code settings')
  .option('-g, --global', 'Install into global Claude settings (~/.claude/settings.json)')
  .action(installMonitorCommand);

program
  .command('compact')
  .description('Generate a session handoff brief for /compact or new session start')
  .option('-o, --output <file>', 'Write brief to a file instead of stdout')
  .option('-s, --sessions <n>', 'Number of recent sessions to analyze (default: 5)', '5')
  .option('--plain', 'Plain output — no decorative borders')
  .action(compactCommand);

program
  .command('eval')
  .description('Run eval test cases — check domain and decision matching accuracy')
  .option('-v, --verbose', 'Show full match details for every test')
  .action(evalCommand);

program
  .command('eval:seed')
  .description('Generate starter eval cases from your active rule stack')
  .action(evalSeedCommand);

program
  .command('install-mcp')
  .description('Register the Chuck MCP server in Claude Code settings (on-demand pull model)')
  .option('-g, --global', 'Install into global Claude settings (default)', true)
  .action(installMcpCommand);

program.parse();
