import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import chalk from 'chalk';

interface InstallOptions {
  global?: boolean;
}

/** Detect WSL (Windows Subsystem for Linux) environment. */
function detectWSL(): boolean {
  try {
    const version = fs.readFileSync('/proc/version', 'utf-8').toLowerCase();
    return version.includes('microsoft') || version.includes('wsl');
  } catch {
    return false;
  }
}

/**
 * Convert a Windows-style path to a WSL /mnt/ path.
 * e.g. C:\Users\charl\chuck -> /mnt/c/Users/charl/chuck
 */
function windowsPathToWSL(winPath: string): string {
  return winPath
    .replace(/^([A-Za-z]):\\/, (_, drive) => `/mnt/${drive.toLowerCase()}/`)
    .replace(/\\/g, '/');
}

/** Verify python3 is accessible and warn if not. */
function checkPython3(): boolean {
  try {
    execSync('python3 --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function installHookCommand(options: InstallOptions): Promise<void> {
  const isGlobal = options.global ?? false;
  const inWSL = detectWSL();

  // Locate the hook script
  const hookScript = path.resolve(__dirname, '../../src/hook/chuck-hook.py');
  const hookScriptDist = path.resolve(__dirname, '../hook/chuck-hook.py');
  let hookPath = fs.existsSync(hookScript) ? hookScript : hookScriptDist;

  if (!fs.existsSync(hookPath)) {
    console.log(chalk.red(`Hook script not found at: ${hookPath}`));
    return;
  }

  // In WSL, normalize any Windows-style path to /mnt/... format
  if (inWSL && /^[A-Za-z]:\\/.test(hookPath)) {
    hookPath = windowsPathToWSL(hookPath);
  }

  // Claude Code settings file
  // In WSL, Claude Code reads from the WSL home (~/.claude/settings.json),
  // NOT from the Windows home. Always target os.homedir() which returns the
  // correct WSL home (/home/<user>) when running inside WSL.
  const settingsPath = isGlobal
    ? path.join(os.homedir(), '.claude', 'settings.json')
    : path.join(process.cwd(), '.claude', 'settings.json');

  console.log(chalk.bold.cyan('\n⚡ Chuck Install Hook\n'));
  if (inWSL) {
    console.log(chalk.gray('Environment: WSL detected — using /mnt/ paths'));
  }
  console.log(chalk.gray(`Hook script: ${hookPath}`));
  console.log(chalk.gray(`Settings:    ${settingsPath}\n`));

  // Warn if python3 is not found
  if (!checkPython3()) {
    console.log(chalk.yellow('⚠️  python3 not found on PATH.'));
    if (inWSL) {
      console.log(chalk.gray('   Install it with: sudo apt install python3'));
    } else {
      console.log(chalk.gray('   Install Python 3 from https://python.org and ensure it is on your PATH.'));
      console.log(chalk.gray('   On Windows, also try: winget install Python.Python.3'));
    }
    console.log(chalk.yellow('   Hook will be installed but will not fire until python3 is available.\n'));
  }

  // Load or init settings
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      console.log(chalk.red('❌ settings.json is malformed — fix it before installing the hook.'));
      console.log(chalk.gray(`   Path: ${settingsPath}`));
      return;
    }
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

  if (inWSL) {
    console.log(chalk.gray(`Settings written to: ${settingsPath}`));
    console.log(chalk.gray('If Claude Code is launched from Windows, also run chuck install-hook from PowerShell.'));
    console.log('');
  }

  // Make hook executable
  try {
    fs.chmodSync(hookPath, '755');
  } catch { /* non-critical on Windows */ }
}
