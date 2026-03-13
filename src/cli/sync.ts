import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { findChuckDir, CHUCK_LOCAL } from './utils';

interface SyncOptions {
  push?: boolean;
  pull?: boolean;
  message?: string;
}

function isGitRepo(dir: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: dir, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function ensureChuckInGitignore(projectDir: string): void {
  const gitignorePath = path.join(projectDir, '.gitignore');
  const sessionsPattern = '.chuck/sessions/';

  if (!fs.existsSync(gitignorePath)) return;

  const content = fs.readFileSync(gitignorePath, 'utf-8');
  if (!content.includes(sessionsPattern)) {
    fs.appendFileSync(gitignorePath, `\n# Chuck session data (local only)\n${sessionsPattern}\n`);
    console.log(chalk.gray(`  Added ${sessionsPattern} to .gitignore`));
  }
}

export async function syncCommand(options: SyncOptions): Promise<void> {
  const chuckDir = findChuckDir();
  if (!chuckDir) {
    console.log(chalk.red('No .chuck config found. Run: chuck init'));
    return;
  }

  if (chuckDir !== CHUCK_LOCAL) {
    console.log(chalk.red('chuck sync only works with a local .chuck/ folder (not global).'));
    return;
  }

  const projectDir = process.cwd();
  if (!isGitRepo(projectDir)) {
    console.log(chalk.red('Not a git repository. chuck sync requires git.'));
    return;
  }

  console.log(chalk.bold.cyan('\n⚡ Chuck Sync\n'));

  // Default: push if no flag given
  const doPush = options.push || (!options.push && !options.pull);
  const doPull = options.pull ?? false;

  if (doPull) {
    console.log(chalk.gray('Pulling latest rules from remote...\n'));
    try {
      const result = execSync('git pull', { cwd: projectDir, encoding: 'utf-8' });
      console.log(chalk.gray(result.trim()));
      console.log(chalk.green('\n✅ Rules pulled. Restart Claude Code to apply changes.\n'));
    } catch (err) {
      console.log(chalk.red('git pull failed:'));
      console.log(chalk.gray(String(err)));
    }
    return;
  }

  if (doPush) {
    ensureChuckInGitignore(projectDir);

    // Stage .chuck/ excluding sessions
    try {
      execSync('git add .chuck/', { cwd: projectDir, stdio: 'ignore' });

      // Check if there's anything staged
      const staged = execSync('git diff --cached --name-only', { cwd: projectDir, encoding: 'utf-8' }).trim();
      const chuckStaged = staged.split('\n').filter(f => f.startsWith('.chuck/'));

      if (chuckStaged.length === 0) {
        console.log(chalk.green('✅ Rules already up to date — nothing to push.\n'));
        return;
      }

      console.log(chalk.gray(`Staging ${chuckStaged.length} rule file(s):`));
      for (const f of chuckStaged) {
        console.log(chalk.gray(`  ${f}`));
      }
      console.log();

      const msg = options.message ?? 'Update chuck rules';
      execSync(`git commit -m "${msg}"`, { cwd: projectDir, encoding: 'utf-8' });

      const pushResult = execSync('git push', { cwd: projectDir, encoding: 'utf-8' });
      console.log(chalk.gray(pushResult.trim() || 'Pushed.'));
      console.log(chalk.green('\n✅ Rules pushed. Team members can run: chuck sync --pull\n'));
    } catch (err) {
      console.log(chalk.red('Sync failed:'));
      console.log(chalk.gray(String(err)));
      console.log(chalk.gray('\nTip: make sure your remote is configured and you have push access.\n'));
    }
  }
}
