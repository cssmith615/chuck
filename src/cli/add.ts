import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { findChuckDir, loadManifest, saveManifest } from './utils';

// Built-in packs (bundled with chuck-core, no npm install needed)
const BUILTIN_PACKS: Record<string, {
  domain: string;
  description: string;
  trigger: { keywords: string[]; fuzzy: boolean; operator?: 'AND' | 'OR' };
  rules: string;
  extraFiles?: Array<{ path: string; content: string }>;
  postInstall?: string;
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
  'praxis': {
    domain: 'praxis',
    description: 'Praxis AI workflow language (.px) best practices',
    trigger: { keywords: ['praxis', '.px', 'workflow', 'pipeline', 'verb', 'chain', 'par', 'shaun'], fuzzy: true },
    rules: `# Praxis Rules
- Use Praxis chains for multi-step AI workflows (>2 steps) — avoids ad-hoc Python glue code
- PAR(VERB1.a, VERB2.b) for independent steps only — steps must share no $variables
- Verb names: UPPERCASE 2-8 chars; targets: lowercase identifiers; params: key=value pairs
- SET.varname captures the prior step output for later $varname reference in subsequent steps
- CAP.self(role=x, allow=[verb1,verb2]) restricts runtime capability — use for untrusted input
- ASSERT.condition halts the chain on false — place before steps that require preconditions
- GATE halts in prod mode for manual approval — place before irreversible or destructive actions
- ROLLBACK.label reverts to a prior SNAP checkpoint — always SNAP before risky mutations
- praxis validate before executing in prod mode — catches verb and semantic errors early
- praxis compile --target typescript generates async TS module; --target wasm generates WAT
- praxis goal "..." generates a program from natural language via the configured LLM provider
- Constitutional rules in praxis-constitution.md are enforced at runtime — add rules with praxis improve
- Grammar list values are lowercase identifiers — handlers normalize to uppercase internally
- Similarity >= 0.85 triggers program adaptation from memory; lower generates fresh`,
  },

  'praxis-rag': {
    domain: 'praxis-rag',
    description: 'Praxis RAG pipeline — ING.docs, EMBED.text, SEARCH.semantic, RECALL.docs',
    trigger: {
      keywords: [
        'rag', 'embed', 'embedding', 'retrieval', 'retrieve',
        'vector', 'semantic', 'corpus', 'knowledge base',
        'ing.docs', 'embed.text', 'search.semantic', 'recall.docs',
        'index', 'ingest', 'chunk',
      ],
      fuzzy: true,
      operator: 'OR',
    },
    rules: `# Praxis RAG Domain Rules
# Fires when: rag, embed, retrieval, vector, corpus, semantic search, recall.docs mentioned

## Pipeline Order
ALWAYS follow this verb order for RAG programs:
  ING.docs -> EMBED.text -> (store corpus once)
  SET.question -> RECALL.docs -> SET.context -> GEN.answer -> OUT.*

NEVER call SEARCH.semantic without first indexing the corpus with EMBED.text.
NEVER call GEN.answer without a SET.context step immediately before it.

## Chunking
Default chunk_size=400, overlap=50.
For code documentation: chunk_size=200, overlap=25 (smaller = more precise retrieval).
For long-form prose (PDFs, articles): chunk_size=600, overlap=75.
NEVER set overlap >= chunk_size — this produces infinite loop in the chunker.

## Embedding Provider Selection
Use provider=voyage for production RAG (best retrieval quality, requires VOYAGE_API_KEY).
Use provider=local for offline/development (no API key, ~700MB download on first use).
Use provider=openai when OPENAI_API_KEY is set and VOYAGE_API_KEY is not.
NEVER hardcode API keys in .px files — always use env vars.

## Corpus Naming
Name corpora after their content domain, not the project:
  corpus=project_docs     (correct)
  corpus=chuck_decisions  (correct)
  corpus=my_corpus        (too generic — will collide across projects)
Always pass corpus= explicitly — never rely on the default.

## Agentic Retrieval
When writing multi-hop RAG programs:
ALWAYS add a max_hops safety variable before the retrieval loop.
ALWAYS use IF.$hops < $max_hops before issuing a second RECALL.docs.
NEVER use LOOP without until= — open RAG loops will exhaust API quota.

## GEN Prompt Structure for RAG
ALWAYS structure GEN prompts in this order:
  1. Task instruction
  2. Constraints ("Answer using ONLY the provided context")
  3. The question ($question)
  4. The context ($context)
  5. Output format instruction
NEVER put context before the question in GEN prompts.

## RECALL.docs vs SEARCH.semantic
Use RECALL.docs when you want a formatted context block for GEN injection.
Use SEARCH.semantic when you need raw chunk objects (id, similarity, source) for processing.
NEVER use SEARCH.semantic output directly in GEN prompts without formatting it first.

## Indexing vs Querying
Separate index programs from query programs — never combine them.
  index.px -> ING.docs -> EMBED.text -> LOG.msg
  query.px -> SET.question -> RECALL.docs -> GEN.answer -> OUT.*

Re-indexing calls the embedding API for every chunk. Only re-index when source docs change.
Use LOG.msg at the end of index programs to confirm completion in praxis logs.

## Error Recovery
ALWAYS wrap ING.docs in RETRY(attempts=2) when src= is a URL (network may fail).
ALWAYS add FALLBACK after RECALL.docs for the zero-results case.`,

    extraFiles: [
      {
        path: 'commands/rag-index.md',
        content: `# RAG Index Command
# Load with: *rag-index in your Claude Code prompt

You are helping the developer build or rebuild a Praxis RAG corpus.

## Your job
1. Ask which directory or URLs to index (if not specified in the prompt).
2. Ask which corpus name to use.
3. Ask which embedding provider (voyage, openai, or local).
4. Generate an index.px program using the correct ING.docs -> EMBED.text pattern.
5. Offer to run it immediately with \`praxis run index.px\`.

## Rules to follow
- chunk_size=400, overlap=50 by default unless developer specifies otherwise
- Always name the output file index.px (not ingest.px, not embed.px)
- Always add LOG.msg at the end of the program
- If src= is a URL, wrap in RETRY(attempts=2)
- Remind the developer to set VOYAGE_API_KEY or OPENAI_API_KEY before running

## After indexing
Suggest the developer run:
  praxis memory   (to verify the corpus is in the program library)
  *rag-query      (to test a query against the new corpus)

Do not generate query programs in this command — that is *rag-query's job.
`,
      },
      {
        path: 'commands/rag-query.md',
        content: `# RAG Query Command
# Load with: *rag-query in your Claude Code prompt

You are helping the developer query a Praxis RAG corpus.

## Your job
1. Ask what question they want answered (if not in prompt).
2. Ask which corpus to query (check .chuck/corpora/index.json for available corpora).
3. Ask if they want basic RAG or agentic multi-hop RAG.
4. Generate the appropriate .px program.
5. Offer to run it immediately.

## Basic RAG template
SET.question(value="[QUESTION]") ->
RECALL.docs(query=$question, k=5, corpus=[CORPUS]) ->
SET.context ->
GEN.answer(
  prompt="Answer this question using ONLY the provided context. If the context does not contain the answer, say so.\\n\\nQuestion: $question\\n\\nContext:\\n$context\\n\\nAnswer:"
) ->
OUT.print

## Agentic RAG template (use when question is complex or multi-part)
SET.question(value="[QUESTION]") ->
SET.max_hops(value=3) ->
SET.hops(value=0) ->
RECALL.docs(query=$question, k=5, corpus=[CORPUS]) ->
SET.context ->
SET.hops(value=1) ->
EVAL.sufficient(
  prompt="Is this context sufficient to answer the question?\\nQuestion: $question\\nContext: $context\\nReply only: YES or NO"
) ->
SET.sufficient ->
IF.$sufficient == "NO" AND $hops < $max_hops ->
  GEN.followup_query(
    prompt="Given this partial context, what else should I search for?\\nQuestion: $question\\nContext: $context\\nOutput only a short search query:"
  ) ->
  SET.followup ->
  RECALL.docs(query=$followup, k=3, corpus=[CORPUS]) ->
  MERGE ->
  SET.context ->
GEN.answer(
  prompt="Answer this question using ONLY the provided context. Cite your sources.\\n\\nQuestion: $question\\n\\nContext:\\n$context\\n\\nAnswer:"
) ->
OUT.print
`,
      },
      {
        path: 'corpora/index.json',
        content: JSON.stringify({
          corpora: [
            {
              name: 'chuck_decisions',
              src: '.chuck/decisions/',
              last_indexed: null,
              chunk_count: 0,
              provider: 'local',
              description: 'Architectural decisions from Chuck decision ledger',
            },
            {
              name: 'project_docs',
              src: './docs/',
              last_indexed: null,
              chunk_count: 0,
              provider: 'local',
              description: 'Project documentation',
            },
          ],
        }, null, 2),
      },
      {
        path: 'bootstrap.px',
        content: `// Index all Chuck decisions into the chuck_decisions corpus.
// Run once after chuck add praxis-rag, then auto-reindex happens on chuck decide.
// Usage: praxis run .chuck/bootstrap.px

GOAL:index_chuck_decisions

ING.docs(src=.chuck/decisions/, chunk_size=100, overlap=10) ->
EMBED.text(provider=local, corpus=chuck_decisions) ->
LOG.msg(msg="Chuck decisions indexed. Change provider=local to provider=voyage for better retrieval quality.")
`,
      },
    ],

    postInstall: `
Next steps:
  1. Index your Chuck decisions (run once):
       praxis run .chuck/bootstrap.px

  2. Index your project docs:
       Use *rag-index in Claude Code to generate index.px, then:
       praxis run index.px

  3. Set an embedding provider for better retrieval quality:
       export VOYAGE_API_KEY=...   (recommended)
       export OPENAI_API_KEY=...   (alternative)
       # Default: provider=local (no key, ~700MB first-run download)

  4. Test retrieval:
       Use *rag-query in Claude Code to generate and run a query.

  Requires: pip install praxis-lang[rag]
`,
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

    // Write extra files (commands, corpora index, etc.)
    if (p.extraFiles) {
      for (const f of p.extraFiles) {
        const filePath = path.join(chuckDir, f.path);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, f.content);
        console.log(chalk.green(`✓ Wrote: .chuck/${f.path}`));
      }
    }

    console.log(chalk.green(`✓ Added built-in pack: ${pack}`));
    console.log(chalk.gray(`  Rule file: ${path.join(chuckDir, ruleFile)}`));
    console.log(chalk.gray(`  Keywords: ${p.trigger.keywords.slice(0, 5).join(', ')}`));

    if (p.postInstall) {
      console.log(chalk.cyan(p.postInstall));
    } else {
      console.log(chalk.gray('\n  Edit the rule file to customize for your project.\n'));
    }
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
