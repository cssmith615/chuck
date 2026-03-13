import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';

interface InstallOptions {
  global?: boolean;
}

export async function installHookCommand(options: InstallOptions): Promise<void> {
  const isGlobal = options.global ?? false;

  // Locate the hook script
  const hookScript = path.resolve(__dirname, '../../src/hook/chuck-hook.py');
  const hookScriptDist = path.resolve(__dirname, '../hook/chuck-hook.py');
  const hookPath = fs.existsSync(hookScript) ? hookScript : hookScriptDist;

  if (!fs.existsSync(hookPath)) {
    console.log(chalk.red(`Hook script not found at: ${hookPath}`));
    return;
  }

  // Claude Code settings file
  const settingsPath = isGlobal
    ? path.join(os.homedir(), '.claude', 'settings.json')
    : path.join(process.cwd(), '.claude', 'settings.json');

  console.log(chalk.bold.cyan('\n⚡ Chuck Install Hook\n'));
  console.log(chalk.gray(`Hook script: ${hookPath}`));
  console.log(chalk.gray(`Settings:    ${settingsPath}\n`));

  // Load or init settings
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  }

  const hookEntry = {
    type: 'command',
    command: `python3 ${hookPath}`,
  };

  const hookConfig = {
    matcher: '.*',
    hooks: [hookEntry],
  };

  // Merge into hooks.UserPromptSubmit
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const existing = (hooks.UserPromptSubmit ?? []) as Record<string, unknown>[];

  // Avoid duplicate
  const alreadyInstalled = existing.some(h => {
    const hooksArr = h.hooks as { command?: string }[] | undefined;
    return hooksArr?.some(e => e.command?.includes('chuck-hook.py'));
  });

  if (alreadyInstalled) {
    console.log(chalk.yellow('⚠️  Chuck hook already installed in Claude Code settings.\n'));
    return;
  }

  existing.push(hookConfig);
  hooks.UserPromptSubmit = existing;
  settings.hooks = hooks;

  // Ensure directory exists
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  console.log(chalk.green('✅ Hook installed!\n'));
  console.log(chalk.gray('Chuck will now inject relevant rules on every Claude Code prompt.'));
  console.log(chalk.gray('Restart Claude Code for changes to take effect.\n'));

  // Make hook executable
  try {
    fs.chmodSync(hookPath, '755');
  } catch { /* non-critical */ }
}
