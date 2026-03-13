import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';

interface InstallMonitorOptions {
  global?: boolean;
}

function detectWSL(): boolean {
  try {
    const version = fs.readFileSync('/proc/version', 'utf-8').toLowerCase();
    return version.includes('microsoft') || version.includes('wsl');
  } catch {
    return false;
  }
}

function windowsPathToWSL(winPath: string): string {
  return winPath
    .replace(/^([A-Za-z]):\\/, (_, drive) => `/mnt/${drive.toLowerCase()}/`)
    .replace(/\\/g, '/');
}

export function installMonitorCommand(options: InstallMonitorOptions): void {
  const isGlobal = options.global ?? false;
  const inWSL = detectWSL();

  // Locate the monitor script
  const monitorSrc = path.resolve(__dirname, '../../src/hook/chuck-monitor.py');
  const monitorDist = path.resolve(__dirname, '../hook/chuck-monitor.py');
  let monitorPath = fs.existsSync(monitorSrc) ? monitorSrc : monitorDist;

  if (!fs.existsSync(monitorPath)) {
    console.log(chalk.red(`Monitor script not found at: ${monitorPath}`));
    return;
  }

  if (inWSL && /^[A-Za-z]:\\/.test(monitorPath)) {
    monitorPath = windowsPathToWSL(monitorPath);
  }

  const settingsPath = isGlobal
    ? path.join(os.homedir(), '.claude', 'settings.json')
    : path.join(process.cwd(), '.claude', 'settings.json');

  console.log(chalk.bold.cyan('\n⚡ Chuck Install Monitor\n'));
  if (inWSL) console.log(chalk.gray('Environment: WSL detected — using /mnt/ paths'));
  console.log(chalk.gray(`Monitor script: ${monitorPath}`));
  console.log(chalk.gray(`Settings:       ${settingsPath}\n`));

  // Load or init settings
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      console.log(chalk.red('❌ settings.json is malformed — fix it before installing.'));
      return;
    }
  }

  const monitorEntry = {
    type: 'command',
    command: `python3 ${monitorPath}`,
  };

  const monitorConfig = {
    matcher: '.*',
    hooks: [monitorEntry],
  };

  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const existing = (hooks.PostToolUse ?? []) as Record<string, unknown>[];

  // Avoid duplicate
  const alreadyInstalled = existing.some(h => {
    const hooksArr = h.hooks as { command?: string }[] | undefined;
    return hooksArr?.some(e => e.command?.includes('chuck-monitor.py'));
  });

  if (alreadyInstalled) {
    console.log(chalk.yellow('⚠️  Chuck monitor already installed in Claude Code settings.\n'));
    return;
  }

  existing.push(monitorConfig);
  hooks.PostToolUse = existing;
  settings.hooks = hooks;

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  console.log(chalk.green('✅ Monitor installed!\n'));
  console.log(chalk.gray('Chuck will now watch Write/Edit calls for decision contradictions.'));
  console.log(chalk.gray('Token cost: 0 when clean — warning only fires on contradiction.'));
  console.log(chalk.gray('Restart Claude Code for changes to take effect.\n'));

  try { fs.chmodSync(monitorPath, '755'); } catch { /* non-critical on Windows */ }
}
