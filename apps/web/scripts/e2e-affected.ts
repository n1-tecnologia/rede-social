/**
 * Path-affected e2e selection (quick 261007-kbq, D-03).
 *
 * Reads the changed-file list of a push or pull request and decides which Playwright specs a change
 * can affect, using the versioned map in `apps/web/e2e/affected-map.json`:
 *
 *   none  nothing the e2e can observe changed (docs, .planning, unit tests): the e2e job is skipped.
 *   some  a localized change: ONE job runs only the chosen specs.
 *   all   a shared or unmapped change, or any doubt: every spec, through the usual `--shard` fan-out.
 *
 * Every doubt resolves to `all`, never to `none`: an unreadable map, a missing / zero / unreachable
 * base, an unknown event, a malformed revision, an internal error. The CI step runs this file with
 * plain `node` (Node 24 strips the types), so it is erasable TypeScript only, imports nothing but
 * node built-ins and reads the map and the e2e directory through fs. See docs/deploy/ci.md.
 *
 *   node apps/web/scripts/e2e-affected.ts --event push --base <sha> --head <sha>
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export type Mode = 'none' | 'some' | 'all';

export interface MapGroup {
  id: string;
  why: string;
  globs: string[];
  specs: string[];
}

export interface AffectedMap {
  version: number;
  maxSomeShare: number;
  shared: string[];
  ignored: string[];
  groups: MapGroup[];
}

export interface Inventory {
  /** Bare spec file names, e.g. `feed.spec.ts`. */
  specs: string[];
  /** Spec file name -> line count (the weight used by the valve). */
  weights: Record<string, number>;
  /** Top-level e2e `.ts` file name -> source text. */
  sources: Record<string, string>;
  /** File name -> the files that import it directly (relative `./x` imports only). */
  importers: Record<string, string[]>;
}

export interface Plan {
  mode: Mode;
  /** `e2e/<name>.spec.ts`, relative to apps/web (the Playwright cwd); empty unless `some`. */
  specs: string[];
  /** Selected weight over total weight, 0 when nothing was selected. */
  share: number;
  reasons: string[];
}

export interface Matrix {
  include: { shard: number; total: number }[];
}

export interface SelectorOptions {
  event?: string;
  base?: string;
  head?: string;
  forceAll?: boolean;
  filesFrom?: string;
  repoRoot: string;
}

export interface SelectorResult {
  plan: Plan;
  matrix: Matrix;
  changedCount: number;
  range: string;
}

export const E2E_PREFIX = 'apps/web/e2e/';
const SHARDS_FOR_ALL = 4;
const MAX_REASONS = 50;

// -- glob matching -------------------------------------------------------------------------------

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function globToSource(pattern: string): string {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i] as string;
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 3;
        } else {
          out += '.*';
          i += 2;
        }
      } else {
        out += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      out += '[^/]';
      i += 1;
    } else if (ch === '{') {
      let depth = 0;
      let end = -1;
      for (let j = i; j < pattern.length; j += 1) {
        if (pattern[j] === '{') depth += 1;
        if (pattern[j] === '}') {
          depth -= 1;
          if (depth === 0) {
            end = j;
            break;
          }
        }
      }
      if (end === -1) {
        out += escapeRegExp(ch);
        i += 1;
      } else {
        const alternatives = splitTopLevel(pattern.slice(i + 1, end)).map(globToSource);
        out += `(?:${alternatives.join('|')})`;
        i = end + 1;
      }
    } else {
      out += escapeRegExp(ch);
      i += 1;
    }
  }
  return out;
}

/**
 * Glob -> anchored RegExp. `**` spans directories (and matches none), `*` stays inside one path
 * segment, `?` is one non-slash character, `{a,b}` alternates; every other character, including
 * ( ) [ ], is literal, so Next.js route groups and `[id]` segments match as written.
 */
export function globToRegExp(pattern: string): RegExp {
  return new RegExp(`^${globToSource(pattern)}$`);
}

const globCache = new Map<string, RegExp>();

export function matchesGlob(path: string, pattern: string): boolean {
  let re = globCache.get(pattern);
  if (re === undefined) {
    re = globToRegExp(pattern);
    globCache.set(pattern, re);
  }
  return re.test(path);
}

function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(path, pattern));
}

// -- inventory of apps/web/e2e -------------------------------------------------------------------

const IMPORT_RE = /\b(?:from|import)\s*\(?\s*['"]\.\/([^'"]+)['"]/g;

/** Resolves a `./x` import written in `source` to a top-level e2e `.ts` file name, when it is one. */
function resolveLocalImport(specifier: string, names: Set<string>): string | undefined {
  const bare = specifier.replace(/\.(?:ts|js|mjs)$/, '');
  const candidate = `${bare}.ts`;
  return names.has(candidate) ? candidate : undefined;
}

export function buildInventory(sources: Record<string, string>): Inventory {
  const names = new Set(Object.keys(sources));
  const specs = [...names].filter((name) => name.endsWith('.spec.ts')).sort();
  const weights: Record<string, number> = {};
  for (const spec of specs) weights[spec] = (sources[spec] as string).split('\n').length;
  const importers: Record<string, string[]> = {};
  for (const [name, text] of Object.entries(sources)) {
    for (const match of text.matchAll(IMPORT_RE)) {
      const target = resolveLocalImport(match[1] as string, names);
      if (target === undefined || target === name) continue;
      const list = importers[target] ?? [];
      if (!list.includes(name)) list.push(name);
      importers[target] = list;
    }
  }
  return { specs, weights, sources, importers };
}

export function loadInventory(repoRoot: string): Inventory {
  const dir = join(repoRoot, E2E_PREFIX);
  const sources: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      sources[entry.name] = readFileSync(join(dir, entry.name), 'utf8');
    }
  }
  return buildInventory(sources);
}

export function loadMap(repoRoot: string): AffectedMap {
  const raw: unknown = JSON.parse(
    readFileSync(join(repoRoot, E2E_PREFIX, 'affected-map.json'), 'utf8'),
  );
  const map = raw as Partial<AffectedMap> | null;
  if (
    map === null ||
    typeof map !== 'object' ||
    typeof map.maxSomeShare !== 'number' ||
    !Array.isArray(map.shared) ||
    !Array.isArray(map.ignored) ||
    !Array.isArray(map.groups)
  ) {
    throw new Error('affected-map.json does not follow the version 1 schema');
  }
  return map as AffectedMap;
}

/** Specs that import `file`, directly or through other helpers. */
function transitiveSpecImporters(file: string, inv: Inventory): string[] {
  const seen = new Set<string>([file]);
  const queue = [file];
  const found = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const importer of inv.importers[current] ?? []) {
      if (seen.has(importer)) continue;
      seen.add(importer);
      if (importer.endsWith('.spec.ts')) found.add(importer);
      else queue.push(importer);
    }
  }
  return [...found];
}

// -- selection -----------------------------------------------------------------------------------

type Resolution = { kind: 'specs'; specs: string[]; why: string } | { kind: 'all'; why: string };

/** Rules for a path under apps/web/e2e that no `shared` or `ignored` glob claimed. */
function resolveE2ePath(path: string, inv: Inventory): Resolution {
  const rel = path.slice(E2E_PREFIX.length);
  const topLevel = !rel.includes('/');
  if (topLevel && rel.endsWith('.spec.ts')) {
    return inv.specs.includes(rel)
      ? { kind: 'specs', specs: [rel], why: 'a changed spec selects itself' }
      : { kind: 'specs', specs: [], why: 'a deleted spec has nothing to run' };
  }
  if (topLevel && rel.endsWith('.ts')) {
    if (inv.sources[rel] === undefined)
      return { kind: 'all', why: 'a helper that is no longer on disk' };
    const specs = transitiveSpecImporters(rel, inv);
    return specs.length > 0
      ? { kind: 'specs', specs, why: `helper imported by ${specs.length} spec(s)` }
      : { kind: 'all', why: 'a helper no spec imports' };
  }
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  const specs = new Set<string>();
  for (const [name, text] of Object.entries(inv.sources)) {
    if (!text.includes(base)) continue;
    if (name.endsWith('.spec.ts')) specs.add(name);
    else for (const spec of transitiveSpecImporters(name, inv)) specs.add(spec);
  }
  return specs.size > 0
    ? { kind: 'specs', specs: [...specs], why: `referenced by name from ${specs.size} spec(s)` }
    : { kind: 'all', why: 'an e2e file no spec or helper mentions' };
}

function pushReason(reasons: string[], reason: string): void {
  if (reasons.length < MAX_REASONS) reasons.push(reason);
}

/**
 * Precedence for each changed path: ignored -> shared -> apps/web/e2e rules -> map groups (the union
 * of every matching group) -> unmapped (all). Then: nothing selected = none; a selection heavier than
 * `maxSomeShare` of the suite = all (one non-sharded job would risk its time limit); otherwise some.
 */
export function planAffected(changed: string[], map: AffectedMap, inv: Inventory): Plan {
  const reasons: string[] = [];
  // The paths that forced `all` come first in the report: they are the answer to "why everything?".
  const forcing: string[] = [];
  const selected = new Set<string>();
  let forcedAll = false;
  const force = (reason: string): void => {
    forcedAll = true;
    pushReason(forcing, reason);
  };

  for (const raw of changed) {
    const path = raw.replace(/^\.\//, '');
    if (path === '') continue;
    if (matchesAny(path, map.ignored)) {
      pushReason(reasons, `${path}: ignored (cannot change an e2e run)`);
      continue;
    }
    if (matchesAny(path, map.shared)) {
      force(`${path}: shared path, every spec`);
      continue;
    }
    if (path.startsWith(E2E_PREFIX)) {
      const resolution = resolveE2ePath(path, inv);
      if (resolution.kind === 'all') {
        force(`${path}: ${resolution.why}, every spec`);
      } else {
        for (const spec of resolution.specs) selected.add(spec);
        pushReason(reasons, `${path}: ${resolution.why}`);
      }
      continue;
    }
    const groups = map.groups.filter((group) => matchesAny(path, group.globs));
    if (groups.length === 0) {
      force(`${path}: no group claims this path, every spec`);
      continue;
    }
    for (const group of groups) for (const spec of group.specs) selected.add(spec);
    pushReason(reasons, `${path}: group ${groups.map((group) => group.id).join(', ')}`);
  }

  if (forcedAll) {
    return {
      mode: 'all',
      specs: [],
      share: 1,
      reasons: [...forcing, ...reasons].slice(0, MAX_REASONS),
    };
  }
  const names = [...selected].filter((name) => inv.specs.includes(name)).sort();
  if (names.length === 0) return { mode: 'none', specs: [], share: 0, reasons };

  const total = inv.specs.reduce((sum, spec) => sum + (inv.weights[spec] ?? 0), 0);
  const weight = names.reduce((sum, spec) => sum + (inv.weights[spec] ?? 0), 0);
  const share = total > 0 ? weight / total : 1;
  if (share > map.maxSomeShare) {
    pushReason(
      reasons,
      `selection is ${(share * 100).toFixed(1)}% of the suite (limit ${(map.maxSomeShare * 100).toFixed(0)}%): promoted to all`,
    );
    return { mode: 'all', specs: [], share, reasons };
  }
  return { mode: 'some', specs: names.map((name) => `e2e/${name}`), share, reasons };
}

export function buildMatrix(mode: Mode): Matrix {
  if (mode === 'all') {
    return {
      include: Array.from({ length: SHARDS_FOR_ALL }, (_, index) => ({
        shard: index + 1,
        total: SHARDS_FOR_ALL,
      })),
    };
  }
  return { include: [{ shard: 1, total: 1 }] };
}

/** Names in `specNames` that no group lists: the Vitest guard fails on a non-empty result. */
export function findUnmappedSpecs(specNames: string[], map: AffectedMap): string[] {
  const mapped = new Set(map.groups.flatMap((group) => group.specs));
  return specNames.filter((name) => !mapped.has(name));
}

export function formatGithubOutput(plan: Plan): string {
  const specs = plan.mode === 'some' ? plan.specs.join(' ') : '';
  return `mode=${plan.mode}\nspecs=${specs}\nmatrix=${JSON.stringify(buildMatrix(plan.mode))}\n`;
}

// -- changed files -------------------------------------------------------------------------------

const SHA_RE = /^[0-9a-fA-F]{40,64}$/;
const SAFE_REF_RE = /^[A-Za-z0-9_][A-Za-z0-9._~^/@{}-]*$/;
const ZERO_RE = /^0{40,64}$/;

export type ChangedFiles = { files: string[]; range: string } | { fallback: string };

function validRev(rev: string): boolean {
  return SHA_RE.test(rev) || SAFE_REF_RE.test(rev);
}

function splitList(text: string): string[] {
  const separator = text.includes('\0') ? '\0' : '\n';
  return text
    .split(separator)
    .map((entry) => entry.replace(/\r$/, ''))
    .filter((entry) => entry !== '');
}

/** The changed paths for the event, or the reason the answer must be `all`. Git gets argv arrays only. */
export function resolveChangedFiles(opts: SelectorOptions): ChangedFiles {
  if (opts.forceAll) return { fallback: '--force-all: every spec was requested' };
  if (opts.filesFrom !== undefined) {
    const text =
      opts.filesFrom === '-' ? readFileSync(0, 'utf8') : readFileSync(opts.filesFrom, 'utf8');
    return { files: splitList(text), range: 'files-from' };
  }
  if (opts.event !== 'push' && opts.event !== 'pull_request') {
    return { fallback: `event "${opts.event ?? ''}" has no push base, every spec` };
  }
  const base = (opts.base ?? '').trim();
  const head = (opts.head ?? '').trim();
  if (base === '') return { fallback: 'the base revision is empty, every spec' };
  if (ZERO_RE.test(base))
    return { fallback: 'the base is the all-zero sha (new branch), every spec' };
  if (head === '') return { fallback: 'the head revision is empty, every spec' };
  if (!validRev(base) || !validRev(head)) {
    return { fallback: 'the base or head revision is malformed, every spec' };
  }
  try {
    for (const rev of [base, head]) {
      execFileSync('git', ['-C', opts.repoRoot, 'cat-file', '-e', `${rev}^{commit}`], {
        stdio: 'ignore',
      });
    }
    const out = execFileSync(
      'git',
      ['-C', opts.repoRoot, 'diff', '--name-only', '-z', '--no-renames', base, head, '--'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    return { files: splitList(out), range: `${base}..${head}` };
  } catch {
    return { fallback: 'the base is unreachable or git diff failed, every spec' };
  }
}

/** Never throws: any error becomes mode `all` with the error text as the reason. */
export function runSelector(opts: SelectorOptions): SelectorResult {
  const allResult = (reason: string, range: string): SelectorResult => ({
    plan: { mode: 'all', specs: [], share: 1, reasons: [reason] },
    matrix: buildMatrix('all'),
    changedCount: 0,
    range,
  });
  try {
    const changed = resolveChangedFiles(opts);
    if ('fallback' in changed) return allResult(changed.fallback, 'unresolved');
    const plan = planAffected(changed.files, loadMap(opts.repoRoot), loadInventory(opts.repoRoot));
    return {
      plan,
      matrix: buildMatrix(plan.mode),
      changedCount: changed.files.length,
      range: changed.range,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return allResult(`selector error, every spec: ${message}`, 'error');
  }
}

export function formatSummary(result: SelectorResult): string {
  const { plan } = result;
  const lines = [
    '### E2E selection',
    '',
    `- mode: **${plan.mode}**`,
    `- range: \`${result.range}\` (${result.changedCount} changed file(s))`,
    `- specs: ${plan.mode === 'some' ? plan.specs.length : plan.mode === 'all' ? 'all, four shards' : 'none'}`,
    '',
  ];
  for (const reason of plan.reasons.slice(0, 20)) lines.push(`- ${reason}`);
  if (plan.reasons.length > 20) lines.push(`- ... and ${plan.reasons.length - 20} more`);
  return `${lines.join('\n')}\n`;
}

function defaultRepoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

function main(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      event: { type: 'string' },
      base: { type: 'string' },
      head: { type: 'string' },
      'force-all': { type: 'boolean', default: false },
      'files-from': { type: 'string' },
      'github-output': { type: 'string' },
      'summary-file': { type: 'string' },
      'repo-root': { type: 'string' },
    },
  });
  const result = runSelector({
    event: values.event,
    base: values.base,
    head: values.head,
    forceAll: values['force-all'] === true,
    filesFrom: values['files-from'],
    repoRoot: values['repo-root'] ?? defaultRepoRoot(),
  });
  const { plan, matrix } = result;
  console.log(
    JSON.stringify({
      mode: plan.mode,
      specs: plan.specs,
      matrix,
      share: Number(plan.share.toFixed(3)),
      reasons: plan.reasons,
    }),
  );
  console.log(
    `e2e selection: ${plan.mode} (${result.range}, ${result.changedCount} changed file(s))`,
  );
  if (plan.mode === 'some') console.log(`specs: ${plan.specs.join(' ')}`);
  for (const reason of plan.reasons.slice(0, 20)) console.log(`  ${reason}`);
  if (values['github-output'] !== undefined) {
    appendFileSync(values['github-output'], formatGithubOutput(plan));
  }
  if (values['summary-file'] !== undefined) {
    appendFileSync(values['summary-file'], formatSummary(result));
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
