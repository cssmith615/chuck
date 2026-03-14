import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';

interface InstallMcpOptions {
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

function windowsPathToWSL(winPath: string): string {
  return winPath
    .replace(/^([A-Za-z]):\\/, (_, drive) => `/mnt/${drive.toLowerCase()}/`)
    .replace(/\\/g, '/');
}

export async function installMcpCommand(options: InstallMcpOptions): Promise<void> {
  const isGlobal = options.global ?? true; // MCP servers are almost always global
  const inWSL = detectWSL();

  // Locate the MCP server entry point
  const serverSrc = path.resolve(__dirname, '../../bin/chuck-mcp.js');
  const serverDist = path.resolve(__dirname, '../../bin/chuck-mcp.js');
  let serverPath = fs.existsSync(serverSrc) ? serverSrc : serverDist;

  if (!fs.existsSync(serverPath)) {
    console.log(chalk.red(`MCP server entry point not found at: ${serverPath}`));
    console.log(chalk.gray('Try reinstalling chuck-core or running: npm run build'));
    return;
  }

  if (inWSL && /^[A-Za-z]:\\/.test(serverPath)) {
    serverPath = windowsPathToWSL(serverPath);
  }

  const settingsPath = isGlobal
    ? path.join(os.homedir(), '.claude', 'settings.json')
    : path.join(process.cwd(), '.claude', 'settings.json');

  console.log(chalk.bold.cyan('\n⚡ Chuck Install MCP\n'));
  if (inWSL) console.log(chalk.gray('Environment: WSL detected'));
  console.log(chalk.gray(`Server:   ${serverPath}`));
  console.log(chalk.gray(`Settings: ${settingsPath}\n`));

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

  const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>;

  if (mcpServers['chuck']) {
    console.log(chalk.yellow('⚠️  Chuck MCP server already registered in Claude Code settings.\n'));
    console.log(chalk.gray(`Current entry:`));
    console.log(chalk.gray(JSON.stringify(mcpServers['chuck'], null, 2)));
    return;
  }

  mcpServers['chuck'] = {
    command: 'node',
    args: [serverPath],
    type: 'stdio',
  };

  settings.mcpServers = mcpServers;

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  console.log(chalk.green('✅ Chuck MCP server installed!\n'));
  console.log(chalk.gray('Available tools in Claude Code:'));
  console.log(chalk.gray('  chuck:list_domains      — see available rule packs'));
  console.log(chalk.gray('  chuck:get_rule_pack     — pull a domain\'s rules on demand'));
  console.log(chalk.gray('  chuck:get_decisions     — search Decision Ledger by topic'));
  console.log(chalk.gray('  chuck:surface_decisions — ambient session-start context'));
  console.log(chalk.gray('\nRestart Claude Code for changes to take effect.\n'));

  if (inWSL) {
    console.log(chalk.gray(`Settings written to: ${settingsPath}`));
    console.log(chalk.gray('If Claude Code is launched from Windows, also run this from PowerShell.\n'));
  }
}
