import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 09.4-13 (D-573, D-574, UI-D-551, CTK-33, T-09.4-49): the token state is its OWN axis, and only the platform
 * panel's paths may read it. The stored check (`token_check`, `tokenCheck`), the derivation (`tokenStateOf`) and
 * the answer schema (`tokenSummarySchema`) appear in an explicit allow-list of files: the central schema, the
 * health check that writes the check, the token-state module, the overview and the tenant list that answer the
 * panel, the token kernel, and the platform components and routes of the web app. A member route, a
 * `server/tenancy` file or the `tenant-host` answer reading any of them would let a dead token hold a tenant
 * out, which is exactly what D-574 forbids.
 *
 * Tests are skipped (they name the identifiers on purpose), and so are `node_modules`, `.next` and `dist`. The
 * failure message lists offenders by path only, never a line of their content.
 */

const REPO = join(import.meta.dirname, '..', '..', '..');
const SCANNED = ['packages/core/server', 'packages/core/db', 'apps/api/src', 'apps/web'];
const SKIPPED_DIRS = new Set(['node_modules', '.next', 'dist', '.turbo', 'test-results']);

const IDENTIFIERS = ['tokenCheck', 'token_check', 'tokenStateOf', 'tokenSummarySchema'];

/** Exact files that may name the token check. */
const ALLOWED_FILES = new Set([
  'packages/core/db/central/health.ts',
  'packages/core/server/projects/health.ts',
  'packages/core/server/projects/token-state.ts',
  'packages/core/server/projects/overview.ts',
  'packages/core/server/platform/tenants.ts',
  'packages/core/server/projects/token.ts',
]);

/** Prefixes (platform panel paths in the web app) that may name it. */
const ALLOWED_PREFIXES = [
  'apps/web/components/platform',
  'apps/web/app/(platform)',
  'apps/web/lib/platform',
];

/** Member-facing paths that must never name it, asserted on their own so the intent is explicit. */
const FORBIDDEN_PREFIXES = ['packages/core/server/tenancy/', 'apps/web/components/members'];

const isTest = (path: string): boolean =>
  /\.(test|spec)\.(ts|tsx)$/.test(path) || path.includes('/e2e/') || path.includes('/tests/');

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (SKIPPED_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) found.push(...sourceFiles(path));
    else if ((path.endsWith('.ts') || path.endsWith('.tsx')) && !isTest(path)) found.push(path);
  }
  return found;
}

const rel = (file: string): string => relative(REPO, file).split('\\').join('/');

const readers = (): string[] =>
  SCANNED.flatMap((dir) => sourceFiles(join(REPO, dir)))
    .filter((file) => {
      const text = readFileSync(file, 'utf8');
      return IDENTIFIERS.some((name) => text.includes(name));
    })
    .map(rel)
    .sort();

describe('the token axis stays inside the platform paths (09.4-13, CTK-33, D-574)', () => {
  it('the scan finds the files it is meant to protect (it is not scanning an empty tree)', () => {
    const found = readers();
    expect(found).toContain('packages/core/server/projects/overview.ts');
    expect(found).toContain('packages/core/server/platform/tenants.ts');
    expect(found).toContain('packages/core/server/projects/token-state.ts');
  });

  it('only the allow-listed files name tokenCheck, token_check, tokenStateOf or tokenSummarySchema', () => {
    const offenders = readers().filter(
      (file) =>
        !ALLOWED_FILES.has(file) && !ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix)),
    );
    expect(
      offenders,
      `files outside the allow-list read the token check: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('no server/tenancy file, no tenant-host file and no member component or route names it', () => {
    const offenders = readers().filter(
      (file) =>
        FORBIDDEN_PREFIXES.some((prefix) => file.startsWith(prefix)) ||
        file.includes('tenant-host') ||
        /apps\/(api\/src|web\/app)\/.*\/(members?|membros|area-membros|feed|chat|me)\//.test(file),
    );
    expect(offenders, `member paths read the token check: ${offenders.join(', ')}`).toEqual([]);
  });

  it('databaseState and summarizeDatabase take no token input (the token is a separate axis)', () => {
    const overview = readFileSync(join(REPO, 'packages/core/server/projects/overview.ts'), 'utf8');
    const facts = /export type DatabaseFacts = \{[\s\S]*?\n\};/.exec(overview)?.[0] ?? '';
    expect(facts.length).toBeGreaterThan(0);
    expect(facts).not.toMatch(/token/i);
    const call = /databaseState\(\{[\s\S]*?\}\);/.exec(overview)?.[0] ?? '';
    expect(call.length).toBeGreaterThan(0);
    expect(call).not.toMatch(/token/i);
  });

  it('tokenStateOf is called by the overview and the tenant list (the two panel answers) and no other server file', () => {
    const callers = readers().filter((file) =>
      readFileSync(join(REPO, file), 'utf8').includes('tokenStateOf('),
    );
    expect(callers.filter((file) => !file.endsWith('token-state.ts')).sort()).toEqual([
      'packages/core/server/platform/tenants.ts',
      'packages/core/server/projects/health.ts',
      'packages/core/server/projects/overview.ts',
    ]);
  });
});
