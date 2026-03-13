import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { findChuckDir, loadManifest, saveManifest } from './utils';

// Built-in packs (bundled with chuck-core, no npm install needed)
const BUILTIN_PACKS: Record<string, {
  domain: string;
  description: string;
  trigger: { keywords: string[]; fuzzy: boolean };
  rules: string;
}> = {
  'expo': {
    domain: 'expo',
    description: 'Expo SDK best practices',
    trigger: { keywords: ['expo', 'eas', 'managed workflow', 'app.json', 'app.config', 'expo-router'], fuzzy: true },
    rules: `# Expo Rules
- expo-notifications: dynamic require() ONLY — static import crashes Expo Go on Android SDK 53+
- Use expo-secure-store for API keys and tokens (iOS Keychain / Android Keystore)
- babel-preset-expo must be in babel.config.js explicitly for EAS builds
- Managed workflow: prefer expo-* packages over bare React Native equivalents
- EAS profiles: development (Expo Go compatible), preview (APK/IPA), production
- app.json: keep permissions minimal — only request what you actually use
- Bundle ID must match exactly between app.json, eas.json, and store listings`,
  },
  'supabase': {
    domain: 'supabase',
    description: 'Supabase DB, auth, RLS, edge functions',
    trigger: { keywords: ['supabase', 'rls', 'migration', 'edge function', 'postgres', 'auth', 'bucket', 'realtime'], fuzzy: true },
    rules: `# Supabase Rules
- Always enable RLS on every table — never rely on client-side filtering for security
- Migration files: timestamp prefix, SQL only, tested before production
- Edge functions: Deno runtime — no Node.js APIs, use Deno.env for secrets
- Use supabase.from().select('col1, col2') — avoid select('*') in production queries
- Auth: use supabase.auth.getSession() not getUser() for server-side (avoids extra network call)
- RLS policies: test with both anon and authenticated roles before deploying
- Secrets in Supabase Vault, not hardcoded in edge functions`,
  },
  'git': {
    domain: 'git',
    description: 'Git workflow and commit conventions',
    trigger: { keywords: ['commit', 'branch', 'merge', 'pr', 'push', 'pull', 'rebase', 'stash', 'cherry'], fuzzy: true },
    rules: `# Git Rules
- Commit messages: imperative mood ("Add feature" not "Added feature")
- Never amend published commits — new commit instead
- Never --no-verify — fix the hook issue
- Never force push to main/master
- Stage specific files — not git add -A on sensitive repos
- Branch naming: feature/*, fix/*, chore/* conventions`,
  },
  'react': {
    domain: 'react',
    description: 'React best practices',
    trigger: { keywords: ['component', 'react', 'jsx', 'tsx', 'hook', 'state', 'render', 'props', 'context'], fuzzy: true },
    rules: `# React Rules
- Functional components only — no class components
- TypeScript always — .tsx/.ts never .jsx/.js
- Named exports over default exports
- One responsibility per component — extract if growing beyond ~150 lines
- Custom hooks for shared stateful logic
- Avoid prop drilling >2 levels — use context or store
- useCallback/useMemo only when profiling shows a real problem — not preemptively`,
  },
  'typescript': {
    domain: 'typescript',
    description: 'TypeScript type safety rules',
    trigger: { keywords: ['type', 'interface', 'generic', 'typescript', 'enum', 'infer', 'cast', 'assertion'], fuzzy: true },
    rules: `# TypeScript Rules
- Centralize types in src/types/index.ts — no local duplicate definitions
- Prefer interfaces over type aliases for object shapes
- strict mode always — never use 'any', use 'unknown' + type guards
- No non-null assertion (!) — handle nullability explicitly
- Generic constraints over 'any' in utility functions
- Avoid type casting (as) — fix the underlying type instead`,
  },
  'claude-api': {
    domain: 'claude-api',
    description: 'Anthropic Claude API usage rules',
    trigger: { keywords: ['claude', 'anthropic', 'llm', 'prompt', 'completion', 'haiku', 'sonnet', 'opus', 'token'], fuzzy: true },
    rules: `# Claude API Rules
- Model selection: haiku-4-5 for speed/cost, sonnet-4-6 for quality, opus-4-6 for complex reasoning
- System prompt: keep under 500 tokens — move rules to user turn if needed
- Temperature: 0 for deterministic tasks, 0.3-0.7 for creative
- Max tokens: set explicitly — don't rely on defaults
- Stream responses for UX when output will be >200 tokens
- Never log API keys — use environment variables or secure storage
- Handle 429 (rate limit) and 529 (overloaded) with exponential backoff`,
  },
};

export async function addCommand(pack: string): Promise<void> {
  const chuckDir = findChuckDir();
  if (!chuckDir) {
    console.log(chalk.red('No .chuck config found. Run: chuck init first.'));
    return;
  }

  const manifest = loadManifest(chuckDir);
  if (!manifest) {
    console.log(chalk.red('No manifest.json found.'));
    return;
  }

  console.log(chalk.bold.cyan(`\n⚡ Chuck Add: ${pack}\n`));

  // Check built-in packs first
  if (BUILTIN_PACKS[pack]) {
    const p = BUILTIN_PACKS[pack];

    // Write rule file
    const domainsDir = path.join(chuckDir, 'domains');
    fs.mkdirSync(domainsDir, { recursive: true });
    const ruleFile = `domains/${pack}.md`;
    fs.writeFileSync(path.join(chuckDir, ruleFile), p.rules);

    // Add to manifest
    manifest.domains[p.domain] = {
      trigger: p.trigger,
      rules_file: ruleFile,
      priority: 3,
      description: p.description,
      state: 'active',
    };

    saveManifest(chuckDir, manifest);

    console.log(chalk.green(`✓ Added built-in pack: ${pack}`));
    console.log(chalk.gray(`  Rule file: ${path.join(chuckDir, ruleFile)}`));
    console.log(chalk.gray(`  Keywords: ${p.trigger.keywords.slice(0, 5).join(', ')}`));
    console.log(chalk.gray('\n  Edit the rule file to customize for your project.\n'));
    return;
  }

  // Try npm package: chuck-pack-<name>
  const npmPackage = `chuck-pack-${pack}`;
  console.log(chalk.gray(`Checking npm for ${npmPackage}...`));

  try {
    execSync(`npm install ${npmPackage} --save-dev`, { stdio: 'inherit' });

    // Load the pack's manifest contribution
    const packPath = require.resolve(`${npmPackage}/chuck-pack.json`);
    const packManifest = JSON.parse(fs.readFileSync(packPath, 'utf-8'));

    for (const [domainName, domainConfig] of Object.entries(packManifest.domains ?? {})) {
      manifest.domains[domainName] = domainConfig as typeof manifest.domains[string];
    }

    saveManifest(chuckDir, manifest);
    console.log(chalk.green(`✓ Installed ${npmPackage} and merged domains.`));
  } catch {
    console.log(chalk.red(`Pack "${pack}" not found.`));
    console.log(chalk.gray('\nAvailable built-in packs:'));
    Object.keys(BUILTIN_PACKS).forEach(k => {
      console.log(chalk.gray(`  chuck add ${k.padEnd(16)} — ${BUILTIN_PACKS[k].description}`));
    });
    console.log(chalk.gray('\nCommunity packs on npm: chuck-pack-<name>\n'));
  }
}
