import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { getChuckDir, saveManifest, Manifest, Domain } from './utils';

interface InitOptions {
  global?: boolean;
  dryRun?: boolean;
}

// ── Stack detection ──────────────────────────────────────────────────────────

interface DetectedStack {
  name: string;
  domains: Record<string, Domain>;
  ruleFiles: Record<string, string>;
}

function detectStack(cwd: string): DetectedStack[] {
  const stacks: DetectedStack[] = [];

  // Node / package.json
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps['react'] || deps['react-native']) {
      const isNative = !!deps['react-native'];
      const isExpo = !!deps['expo'];
      stacks.push({
        name: isExpo ? 'Expo/React Native' : isNative ? 'React Native' : 'React',
        domains: {
          react: {
            trigger: { keywords: ['component', 'react', 'jsx', 'tsx', 'hook', 'state', 'render', 'props'], fuzzy: true },
            rules_file: 'domains/react.md',
            priority: 2,
            description: 'React component and hooks rules',
          },
          ...(isNative && {
            'react-native': {
              trigger: { keywords: ['screen', 'native', 'expo', 'navigation', 'stylesheet', 'flatlist', 'modal'], fuzzy: true },
              rules_file: 'domains/react-native.md',
              priority: 2,
              description: 'React Native / Expo specific rules',
            },
          }),
        },
        ruleFiles: {
          'domains/react.md': generateReactRules(isNative, isExpo),
          ...(isNative && { 'domains/react-native.md': generateRNRules(isExpo) }),
        },
      });
    }

    if (deps['typescript'] || fs.existsSync(path.join(cwd, 'tsconfig.json'))) {
      stacks.push({
        name: 'TypeScript',
        domains: {
          typescript: {
            trigger: { keywords: ['type', 'interface', 'generic', 'typescript', 'ts', 'enum', 'infer'], fuzzy: true },
            rules_file: 'domains/typescript.md',
            priority: 3,
            description: 'TypeScript type safety rules',
          },
        },
        ruleFiles: { 'domains/typescript.md': generateTSRules() },
      });
    }

    if (deps['zustand']) {
      stacks.push({
        name: 'Zustand',
        domains: {
          zustand: {
            trigger: { keywords: ['store', 'zustand', 'state', 'persist', 'slice'], fuzzy: true },
            rules_file: 'domains/zustand.md',
            priority: 3,
            description: 'Zustand state management rules',
          },
        },
        ruleFiles: { 'domains/zustand.md': generateZustandRules() },
      });
    }

    if (deps['@supabase/supabase-js'] || deps['supabase']) {
      stacks.push({
        name: 'Supabase',
        domains: {
          supabase: {
            trigger: { keywords: ['supabase', 'rls', 'migration', 'edge function', 'postgres', 'auth', 'bucket'], fuzzy: true },
            rules_file: 'domains/supabase.md',
            priority: 2,
            description: 'Supabase DB, auth, and edge function rules',
          },
        },
        ruleFiles: { 'domains/supabase.md': generateSupabaseRules() },
      });
    }
  }

  // Python
  if (fs.existsSync(path.join(cwd, 'requirements.txt')) || fs.existsSync(path.join(cwd, 'pyproject.toml'))) {
    stacks.push({
      name: 'Python',
      domains: {
        python: {
          trigger: { keywords: ['python', 'def', 'class', 'import', 'pip', 'pytest', 'async'], fuzzy: true },
          rules_file: 'domains/python.md',
          priority: 2,
          description: 'Python code quality rules',
        },
      },
      ruleFiles: { 'domains/python.md': generatePythonRules() },
    });
  }

  // Read existing CLAUDE.md for additional context
  const claudeMdPath = path.join(cwd, 'CLAUDE.md');
  if (fs.existsSync(claudeMdPath)) {
    stacks.push({
      name: 'CLAUDE.md (migrated)',
      domains: {
        project: {
          always_on: true,
          rules_file: 'domains/project.md',
          priority: 1,
          description: 'Project-specific rules (from CLAUDE.md)',
        },
      },
      ruleFiles: { 'domains/project.md': migrateCLAUDEmd(fs.readFileSync(claudeMdPath, 'utf-8')) },
    });
  }

  return stacks;
}

// ── Rule generators ───────────────────────────────────────────────────────────

function generateReactRules(isNative: boolean, isExpo: boolean): string {
  return `# React Rules
- Use functional components only — no class components
- TypeScript always — .tsx/.ts, never .jsx/.js
- Prefer named exports over default exports
- Keep components focused — one responsibility per component
- Extract repeated logic into custom hooks
- Never use inline styles${isNative ? ' — use StyleSheet.create or theme constants' : ''}
${isExpo ? '- Use expo-* packages where available instead of bare RN equivalents\n- Dynamic require() for expo-notifications (static import crashes Expo Go on Android)' : ''}
- Avoid prop drilling more than 2 levels — use context or store instead`;
}

function generateRNRules(isExpo: boolean): string {
  return `# React Native Rules
- SafeAreaView from 'react-native-safe-area-context' (not react-native)
- Alert.prompt is iOS-only — use TextInput in-screen for cross-platform
- Test on both iOS and Android — behaviors differ for keyboards, safe areas, gestures
- Use Dimensions/useWindowDimensions for responsive sizing, not hardcoded pixels
${isExpo ? '- EAS build requires babel-preset-expo explicitly in babel.config.js\n- expo-secure-store for sensitive data (API keys, tokens)' : ''}
- Avoid heavy libraries that break Metro bundler (ESM-only packages)`;
}

function generateTSRules(): string {
  return `# TypeScript Rules
- Centralize all types in src/types/index.ts — no duplicate local type definitions
- Prefer interfaces over type aliases for object shapes
- Use strict mode — never use 'any', use 'unknown' + type guards instead
- Avoid non-null assertion (!) — handle nullability explicitly
- Generic constraints over 'any' in utility functions`;
}

function generateZustandRules(): string {
  return `# Zustand Rules
- All persistent state goes in the Zustand store — no useState for data that survives navigation
- Use persist middleware with AsyncStorage for mobile persistence
- Selectors over full store subscriptions — prevents unnecessary re-renders
- Keep store actions co-located with state in the same slice
- Never mutate state directly — use Immer or spread`;
}

function generateSupabaseRules(): string {
  return `# Supabase Rules
- Always use RLS policies — never rely on client-side security alone
- All migrations as SQL files in supabase/migrations/ with timestamp prefix
- Edge functions in Deno — no Node.js APIs
- Use supabase.from().select() with explicit column lists — avoid select('*') in production
- Test RLS policies before deploying (anon vs authenticated access)
- Store Supabase URL and anon key in env — never hardcode`;
}

function generatePythonRules(): string {
  return `# Python Rules
- Type hints on all function signatures
- Use dataclasses or Pydantic for structured data
- f-strings over .format() or % formatting
- Prefer pathlib.Path over os.path for file operations
- Handle exceptions explicitly — never bare except:
- Virtual environment required — document in README`;
}

function migrateCLAUDEmd(content: string): string {
  return `# Project Rules (migrated from CLAUDE.md)
<!-- Auto-migrated by chuck init. Review and trim as needed. -->

${content}`;
}

// ── Global domain template ────────────────────────────────────────────────────

const GLOBAL_RULES = `# Global Rules
- Be concise — skip preamble, summaries, and trailing "I did X" recaps
- Lead with the action or answer, not the reasoning
- Prefer editing existing files over creating new ones
- Minimal viable solution first — no over-engineering
- No docstrings or comments unless logic is non-obvious`;

// ── Git rules ─────────────────────────────────────────────────────────────────

const GIT_RULES = `# Git Rules
- Commit messages: imperative mood, present tense ("Add feature" not "Added feature")
- Never amend published commits — create new commits instead
- Never skip hooks (--no-verify) — fix the underlying issue
- Never force push to main/master
- Stage specific files — avoid git add -A for sensitive repos`;

// ── Command: init ─────────────────────────────────────────────────────────────

export async function initCommand(options: InitOptions): Promise<void> {
  const isGlobal = options.global ?? false;
  const dryRun = options.dryRun ?? false;
  const chuckDir = getChuckDir(isGlobal);
  const cwd = isGlobal ? process.env.HOME || process.cwd() : process.cwd();

  console.log(chalk.bold.cyan('\n⚡ Chuck Init\n'));
  console.log(chalk.gray(`Scanning: ${cwd}`));
  console.log(chalk.gray(`Config:   ${chuckDir}\n`));

  const detectedStacks = detectStack(cwd);

  if (detectedStacks.length === 0) {
    console.log(chalk.yellow('No recognized stack detected. Creating minimal config.'));
  } else {
    console.log(chalk.green('Detected:'));
    detectedStacks.forEach(s => console.log(chalk.gray(`  ✓ ${s.name}`)));
    console.log();
  }

  // Build manifest
  const manifest: Manifest = {
    domains: {
      GLOBAL: {
        state: 'active',
        rules_file: 'domains/global.md',
        description: 'Always-on global rules (keep < 200 tokens)',
      },
      git: {
        trigger: { keywords: ['commit', 'branch', 'merge', 'pr', 'push', 'pull', 'rebase', 'stash'], fuzzy: true },
        rules_file: 'domains/git.md',
        priority: 4,
        description: 'Git workflow rules',
      },
      ...detectedStacks.reduce((acc, s) => ({ ...acc, ...s.domains }), {}),
    },
    global_exclude: ['ignore rules', 'skip chuck', 'no context'],
    token_budget: 2000,
    devmode: false,
  };

  const ruleFiles: Record<string, string> = {
    'domains/global.md': GLOBAL_RULES,
    'domains/git.md': GIT_RULES,
    ...detectedStacks.reduce((acc, s) => ({ ...acc, ...s.ruleFiles }), {}),
  };

  // Show preview
  console.log(chalk.bold('Domains to create:'));
  Object.entries(manifest.domains).forEach(([name, config]) => {
    const badge = config.always_on ? chalk.yellow('[always-on]') : '';
    console.log(chalk.gray(`  ${name.padEnd(20)} ${config.description || ''} ${badge}`));
  });
  console.log();

  if (dryRun) {
    console.log(chalk.yellow('Dry run — no files written.'));
    return;
  }

  if (!isGlobal && fs.existsSync(path.join(chuckDir, 'manifest.json'))) {
    console.log(chalk.yellow('⚠️  .chuck/manifest.json already exists — skipping to avoid overwrite.'));
    console.log(chalk.gray('   Delete .chuck/ and re-run to regenerate.\n'));
    return;
  }

  // Write files
  fs.mkdirSync(path.join(chuckDir, 'domains'), { recursive: true });
  fs.mkdirSync(path.join(chuckDir, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(chuckDir, 'sessions'), { recursive: true });

  saveManifest(chuckDir, manifest);
  console.log(chalk.green('✓ manifest.json'));

  for (const [relPath, content] of Object.entries(ruleFiles)) {
    const fullPath = path.join(chuckDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    console.log(chalk.green(`✓ ${relPath}`));
  }

  console.log(chalk.bold.green('\n✅ Chuck initialized!\n'));
  console.log(chalk.gray('Next steps:'));
  console.log(chalk.gray('  chuck install-hook    — wire up the Claude Code hook'));
  console.log(chalk.gray('  chuck list            — see active domains'));
  console.log(chalk.gray('  chuck audit           — check for issues'));
  console.log(chalk.gray('  Edit .chuck/domains/  — customize your rules\n'));
}
