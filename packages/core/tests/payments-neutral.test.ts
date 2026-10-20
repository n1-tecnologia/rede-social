import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * PAY-02 / D-486 (09.1-05): the neutral layer carries no gateway brand name. Tables, columns, queue
 * and job names, contracts, routes, logs and member-facing strings speak of "a gateway"; only an
 * ADAPTER and the adapter list may name one (the real gateway's adapter file arrives with plan 08). The
 * admin copy reaches the gateway's display name only through the `{gateway}` placeholder (A-UI-8).
 *
 * The rule is a text rule enforced by a walk over the neutral paths, so a future edit that sneaks the
 * name into a column, a log field or a catalogue string fails here, in the unit suite, not in review.
 *
 * The brand is assembled from pieces so that THIS file does not itself contain the literal (and a
 * repository-wide grep for the brand finds the adapters, the planning documents and nothing else).
 */

const BRAND = ['ki', 'wify'].join('');
/** The match is deliberately blunt: the brand anywhere, in any case, including `<brand>_…` prefixes. */
const BRAND_PATTERN = new RegExp(BRAND, 'i');

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** The ONLY files allowed to name a gateway: the adapter list and the real adapter (plan 08). */
const EXEMPT = new Set([
  'packages/core/server/payments/adapters.ts',
  `packages/core/server/payments/${BRAND}.ts`,
]);

const rel = (file: string) => relative(ROOT, file).split('\\').join('/');

function listDir(dir: string, keep: (name: string) => boolean): string[] {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter(keep)
    .map((name) => join(full, name))
    .filter((file) => statSync(file).isFile());
}

function walk(dir: string): string[] {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.turbo') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(join(ROOT, path));
  }
  return out;
}

/** The neutral layer, grouped so an empty glob cannot pass silently. */
function neutralFiles() {
  return {
    schema: [
      ...listDir('packages/core/db/schema', (n) => /^payment-.*\.ts$/.test(n)),
      ...listDir('packages/core/db/schema', (n) => n === 'access-grants.ts'),
    ],
    server: listDir('packages/core/server/payments', (n) => n.endsWith('.ts')),
    contracts: listDir('packages/contracts/src', (n) => n === 'payments.ts'),
    route: listDir('apps/api/src/routes/webhooks', (n) => n === 'payments.ts'),
    migrations: listDir(
      'supabase/migrations',
      (n) => /(payments|access)/.test(n) && n.endsWith('.sql'),
    ),
    module: walk('packages/modules/payments'),
    messages: listDir('apps/web/messages/pt-BR', (n) => n.endsWith('.json')),
  };
}

/** Pure: the files whose text names the brand, minus the exempt ones. */
function offenders(files: string[], read: (file: string) => string, exempt = EXEMPT): string[] {
  return files
    .filter((file) => !exempt.has(rel(file)))
    .filter((file) => BRAND_PATTERN.test(read(file)))
    .map(rel);
}

describe('the matcher', () => {
  it('flags the brand in any case, as a prefix and inside an identifier, and nothing else', () => {
    const read = (file: string) => file;
    expect(offenders([`/x/${BRAND}.ts`], read, new Set())).toHaveLength(1);
    expect(offenders([`/x/${BRAND.toUpperCase()}_orders.sql`], read, new Set())).toHaveLength(1);
    expect(offenders([`/x/my_${BRAND}_ref.ts`], read, new Set())).toHaveLength(1);
    expect(offenders(['/x/payments.ts', '/x/gateway_orders.sql'], read, new Set())).toHaveLength(0);
  });

  it('honours the exemption list by repository-relative path', () => {
    const adapters = join(ROOT, 'packages/core/server/payments/adapters.ts');
    expect(offenders([adapters], () => BRAND)).toHaveLength(0);
    expect(offenders([adapters], () => BRAND, new Set())).toHaveLength(1);
  });
});

describe('the neutral layer names no gateway (PAY-02)', () => {
  const groups = neutralFiles();

  it('walked at least the expected files (an empty glob cannot pass)', () => {
    expect(groups.schema.length).toBeGreaterThanOrEqual(4);
    expect(groups.server.length).toBeGreaterThanOrEqual(7);
    expect(groups.contracts).toHaveLength(1);
    expect(groups.route).toHaveLength(1);
    expect(groups.migrations.length).toBeGreaterThanOrEqual(6);
    expect(groups.messages.length).toBeGreaterThanOrEqual(30);
  });

  for (const [name, files] of Object.entries(groups)) {
    it(`${name}: no file names the brand outside the two exempt files`, () => {
      expect(offenders(files, (file) => readFileSync(file, 'utf8'))).toEqual([]);
    });
  }

  it('the exempt files are the only files of the kernel payments folder that may match', () => {
    const matching = groups.server
      .filter((file) => BRAND_PATTERN.test(readFileSync(file, 'utf8')))
      .map(rel);
    for (const file of matching) expect(EXEMPT.has(file)).toBe(true);
  });

  it('the route segment is the provider name from the path, never a literal', () => {
    const route = readFileSync(join(ROOT, 'apps/api/src/routes/webhooks/payments.ts'), 'utf8');
    expect(route).toContain("'/:provider/:integrationId'");
  });
});
