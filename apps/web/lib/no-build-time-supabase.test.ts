import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Pitfall 12 guard (09.2-17, DBT-39, D-538): no per-tenant Supabase value may come from the build-time
 * variables. `NEXT_PUBLIC_*` values are INLINED into every client bundle at build time, so a tenant's
 * project address read from them would be one value for every tenant (and the central project's, for a
 * tenant that lives elsewhere). The only readers of the pair are `lib/env.ts` (validation and
 * declaration) and `lib/supabase-coordinates.ts`, which turns the host's by-host answer into the values
 * the rest of the app receives (as arguments on the server, as props on a client component).
 *
 * The scan is textual and deliberately blunt: any mention of either variable in code (comments are
 * stripped first) outside the allowed files fails, whether it is a `process.env.` read, an `env.` read
 * or a destructure. Tests are skipped: they stub the environment on purpose.
 */

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SKIPPED_DIRS = new Set(['node_modules', '.next', 'e2e', 'test-results', 'public', '.turbo']);
const ALLOWED_FILES = new Set(['lib/env.ts', 'lib/supabase-coordinates.ts']);
const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const FORBIDDEN = /NEXT_PUBLIC_SUPABASE_(?:URL|PUBLISHABLE_KEY)/;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(name) || name.startsWith('.env')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* sources(full);
    else if (SOURCE.test(name) && !TEST_FILE.test(name)) yield full;
  }
}

/** The files (relative to `apps/web`) that read a build-time Supabase variable outside the allow-list. */
function offenders(root: string): string[] {
  const found: string[] = [];
  for (const file of sources(root)) {
    const rel = relative(root, file);
    if (ALLOWED_FILES.has(rel)) continue;
    if (FORBIDDEN.test(stripComments(readFileSync(file, 'utf8')))) found.push(rel);
  }
  return found.sort();
}

describe('no per-tenant Supabase value from the build-time variables (Pitfall 12)', () => {
  it('apps/web reads NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY only in lib/env.ts and lib/supabase-coordinates.ts', () => {
    expect(offenders(WEB_ROOT)).toEqual([]);
  });

  it('the scan sees the allowed readers, so an empty result is not a scan that found nothing to read', () => {
    const seen = [...sources(WEB_ROOT)].map((file) => relative(WEB_ROOT, file));
    expect(seen).toEqual(expect.arrayContaining(['lib/env.ts', 'lib/supabase-coordinates.ts']));
    for (const allowed of ALLOWED_FILES) {
      expect(FORBIDDEN.test(readFileSync(join(WEB_ROOT, allowed), 'utf8')), allowed).toBe(true);
    }
    expect(seen.length).toBeGreaterThan(100);
  });

  it('the pattern catches the reads the guard exists for, and ignores a comment', () => {
    for (const read of [
      'const u = process.env.NEXT_PUBLIC_SUPABASE_URL;',
      'const k = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;',
      'const { NEXT_PUBLIC_SUPABASE_URL: url } = process.env;',
      'export const T = base + process.env.NEXT_PUBLIC_SUPABASE_URL + path;',
    ]) {
      expect(FORBIDDEN.test(stripComments(read)), read).toBe(true);
    }
    for (const quiet of [
      '// reads NEXT_PUBLIC_SUPABASE_URL today',
      '/** NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, passed by the layout */',
      'const x = 1; // NEXT_PUBLIC_SUPABASE_URL',
    ]) {
      expect(FORBIDDEN.test(stripComments(quiet)), quiet).toBe(false);
    }
  });
});
