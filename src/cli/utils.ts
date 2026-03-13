import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const CHUCK_LOCAL = path.join(process.cwd(), '.chuck');
export const CHUCK_GLOBAL = path.join(os.homedir(), '.chuck');

export interface DomainTrigger {
  keywords?: string[];
  file_types?: string[];
  git_branch?: string;
  operator?: 'AND' | 'OR';
  fuzzy?: boolean;
}

export interface Domain {
  trigger?: DomainTrigger;
  rules_file?: string;
  always_on?: boolean;
  state?: 'active' | 'disabled';
  priority?: number;
  exclude_keywords?: string[];
  description?: string;
}

export interface Manifest {
  domains: Record<string, Domain>;
  global_exclude?: string[];
  token_budget?: number;
  devmode?: boolean;
}

export function getChuckDir(global = false): string {
  return global ? CHUCK_GLOBAL : CHUCK_LOCAL;
}

export function loadManifest(chuckDir: string): Manifest | null {
  const manifestPath = path.join(chuckDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
}

export function saveManifest(chuckDir: string, manifest: Manifest): void {
  fs.mkdirSync(chuckDir, { recursive: true });
  fs.writeFileSync(
    path.join(chuckDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.floor(text.length / 4));
}

export function loadRuleFile(chuckDir: string, rulesFile: string): string {
  const p = path.isAbsolute(rulesFile) ? rulesFile : path.join(chuckDir, rulesFile);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

export function findChuckDir(): string | null {
  if (fs.existsSync(CHUCK_LOCAL)) return CHUCK_LOCAL;
  if (fs.existsSync(CHUCK_GLOBAL)) return CHUCK_GLOBAL;
  return null;
}

export interface SessionData {
  domain_hits: Record<string, number>;
  domain_scores: Record<string, { total: number; count: number }>;
  miss_prompts: string[];
  prompt_count: number;
}

export function loadSessionData(chuckDir: string): Record<string, SessionData> {
  const sessionDir = path.join(chuckDir, 'sessions');
  if (!fs.existsSync(sessionDir)) return {};

  const sessions: Record<string, SessionData> = {};
  for (const file of fs.readdirSync(sessionDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(sessionDir, file), 'utf-8'));
      sessions[file.replace('.json', '')] = data;
    } catch { /* skip corrupt sessions */ }
  }
  return sessions;
}

export function avgScore(scores: { total: number; count: number } | undefined): number {
  if (!scores || scores.count === 0) return 0;
  return scores.total / scores.count;
}
