import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_LANE_INVENTORY,
  type AdminLaneEntry,
  type AdminLaneSite,
  ALLOW_PENDING,
  AREAS,
  checkInventory,
  checkOrder,
  maskSource,
  scanAdminLaneSites,
} from '../admin-lane-inventory';

/**
 * The admin-lane gate's machine check (09.2-04, D-538, DBT-08): every `withAdminTx(` call site outside tests
 * is a classified, countable row of `tests/admin-lane-inventory/` with the plan that migrates it. No database,
 * no network: the source is read as TEXT and scanned (TypeScript 7 ships no compiler API, so a regex scanner
 * over the comment- and string-masked source, planning decision 3).
 *
 * Fails when a site has no entry (P16: entries are per site, not per file), an entry has no site (P17:
 * stale), the inventory is empty, a status disagrees with the form the site uses (a `migrated` entry still
 * on the deprecated overload, a `pending` entry already passing a target), the list is out of order (P18), or
 * `ALLOW_PENDING` is false while a site is pending. Comment lines and strings that mention `withAdminTx(` are
 * not sites.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'coverage',
  'tests',
  '.git',
]);
/** The two files that DEFINE the lane (the overload declarations and the factory call): not call sites. */
const DEFINITION_FILES = new Set(['packages/core/db/admin-tx.ts', 'packages/core/db/lanes.ts']);
const NEGATIVE_FIXTURE = 'packages/boundary-fixture/';

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) sourceFiles(join(directory, entry.name), found);
    } else if (/\.(ts|tsx|mts)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      found.push(relative(ROOT, join(directory, entry.name)).split('\\').join('/'));
    }
  }
  return found;
}

function realSites(): Record<string, AdminLaneSite[]> {
  const out: Record<string, AdminLaneSite[]> = {};
  for (const directory of ['packages', 'apps', 'scripts']) {
    for (const file of sourceFiles(join(ROOT, directory))) {
      if (DEFINITION_FILES.has(file) || file.startsWith(NEGATIVE_FIXTURE)) continue;
      const sites = scanAdminLaneSites(readFileSync(join(ROOT, file), 'utf8'));
      if (sites.length > 0) out[file] = sites;
    }
  }
  return out;
}

const entry = (
  file: string,
  fn: string,
  overrides: Partial<AdminLaneEntry> = {},
): AdminLaneEntry => ({
  file,
  fn,
  class: 'T',
  status: 'pending',
  plan: 5,
  ...overrides,
});

const site = (fn: string, legacy = true): AdminLaneSite => ({ fn, legacy, line: 1 });

describe('the real repository', () => {
  const sites = realSites();

  it('every withAdminTx site outside tests has an inventory entry, and every entry has a site', () => {
    expect(checkInventory(sites, ADMIN_LANE_INVENTORY, ALLOW_PENDING)).toEqual([]);
  });

  it('the inventory covers every site: the totals agree and none is zero', () => {
    const found = Object.values(sites).reduce((sum, list) => sum + list.length, 0);
    expect(found).toBeGreaterThan(100);
    expect(ADMIN_LANE_INVENTORY).toHaveLength(found);
  });

  it('each area module is already in file order with no interleaving (P18)', () => {
    for (const [area, entries] of Object.entries(AREAS)) {
      expect({ area, problems: checkOrder(entries) }).toEqual({ area, problems: [] });
    }
  });

  it('prints the pending list in inventory order (file, then site)', () => {
    const pending = ADMIN_LANE_INVENTORY.filter((e) => e.status === 'pending');
    const byClass: Record<string, number> = {};
    for (const e of pending) byClass[e.class] = (byClass[e.class] ?? 0) + 1;
    console.info(
      `admin-lane inventory: ${ADMIN_LANE_INVENTORY.length} sites, ${pending.length} pending ${JSON.stringify(byClass)}`,
    );
    for (const e of pending)
      console.info(`  pending ${e.class} plan ${e.plan}  ${e.file}  ${e.fn}`);
    expect(ALLOW_PENDING || pending.length === 0).toBe(true);
  });

  it('the legacy overload is only used where the inventory says pending', () => {
    for (const [file, list] of Object.entries(sites)) {
      const entries = ADMIN_LANE_INVENTORY.filter((e) => e.file === file);
      expect(list.filter((s) => s.legacy)).toHaveLength(
        entries.filter((e) => e.status === 'pending').length,
      );
    }
  });
});

describe('the guard fails on drift (in-memory fixtures)', () => {
  const FILE = 'packages/core/server/x/a.ts';

  it('P16: a file with two sites and one entry fails, and two sites in one function count twice', () => {
    const problems = checkInventory({ [FILE]: [site('f'), site('f')] }, [entry(FILE, 'f')], true);
    expect(problems.join('\n')).toMatch(/2 withAdminTx site\(s\) but 1 inventory entry/);
    expect(
      checkInventory(
        { [FILE]: [site('f'), site('f')] },
        [entry(FILE, 'f'), entry(FILE, 'f')],
        true,
      ),
    ).toEqual([]);
  });

  it('P16: a P site and a T site in one file are two entries, and either missing fails', () => {
    const both = [entry(FILE, 'a', { class: 'P' }), entry(FILE, 'b', { class: 'T' })];
    expect(checkInventory({ [FILE]: [site('a'), site('b')] }, both, true)).toEqual([]);
    expect(checkInventory({ [FILE]: [site('a'), site('b')] }, both.slice(0, 1), true)).not.toEqual(
      [],
    );
    expect(checkInventory({ [FILE]: [site('a'), site('b')] }, both.slice(1), true)).not.toEqual([]);
  });

  it('P17: a file with a site and no entry fails with its path', () => {
    const problems = checkInventory({ [FILE]: [site('f')] }, [entry('other/b.ts', 'g')], true);
    expect(problems).toContain(`${FILE}: 1 withAdminTx site(s) and no inventory entry`);
  });

  it('P17: an entry for a file with zero sites is stale', () => {
    const problems = checkInventory({ [FILE]: [] }, [entry(FILE, 'f')], true);
    expect(problems).toContain(`${FILE}: stale entry, the file has no withAdminTx site`);
    expect(checkInventory({}, [entry('gone.ts', 'f')], true)).toContain(
      'gone.ts: stale entry, the file has no withAdminTx site',
    );
  });

  it('P17: an empty inventory fails', () => {
    expect(checkInventory({}, [], true)).toContain('the inventory is empty');
  });

  it('a migrated entry on the deprecated form, and a pending entry on a target, both fail', () => {
    const migratedLegacy = checkInventory(
      { [FILE]: [site('f', true)] },
      [entry(FILE, 'f', { status: 'migrated' })],
      true,
    );
    expect(migratedLegacy.join('\n')).toMatch(/marked migrated but still uses the deprecated form/);
    const pendingTarget = checkInventory({ [FILE]: [site('f', false)] }, [entry(FILE, 'f')], true);
    expect(pendingTarget.join('\n')).toMatch(/marked pending but already passes a target/);
    expect(
      checkInventory(
        { [FILE]: [site('f', false)] },
        [entry(FILE, 'f', { status: 'migrated' })],
        true,
      ),
    ).toEqual([]);
  });

  it('an entry naming another function than the site fails', () => {
    const problems = checkInventory({ [FILE]: [site('real')] }, [entry(FILE, 'claimed')], true);
    expect(problems.join('\n')).toMatch(/is in "real" but its entry says "claimed"/);
  });

  it('P18: files out of order, and a file split in two blocks, are detected', () => {
    expect(checkOrder([entry('b.ts', 'f'), entry('a.ts', 'f')]).join('\n')).toMatch(
      /a\.ts: out of order/,
    );
    expect(
      checkOrder([entry('a.ts', 'f'), entry('b.ts', 'f'), entry('a.ts', 'g')]).join('\n'),
    ).toMatch(/a\.ts: entries are not contiguous/);
    expect(checkOrder([entry('a.ts', 'f'), entry('a.ts', 'g'), entry('b.ts', 'f')])).toEqual([]);
  });

  it('a pending entry fails once ALLOW_PENDING is false', () => {
    expect(checkInventory({ [FILE]: [site('f')] }, [entry(FILE, 'f')], false).join('\n')).toMatch(
      /1 pending entry while ALLOW_PENDING is false/,
    );
  });

  it('an unknown class or status fails', () => {
    const problems = checkInventory(
      { [FILE]: [site('f')] },
      [entry(FILE, 'f', { class: 'Z' as never, status: 'done' as never })],
      true,
    );
    expect(problems.join('\n')).toMatch(/unknown class "Z"/);
    expect(problems.join('\n')).toMatch(/unknown status "done"/);
  });
});

describe('the scanner counts code, not words (P17)', () => {
  it('counts a real call and ignores comment lines, block comments and strings that mention it', () => {
    const source = [
      '// withAdminTx(async (tx) => 1) in a line comment',
      '/** withAdminTx(async (tx) => 2)',
      ' * withAdminTx(async (tx) => 3)',
      '   across lines */',
      "const text = 'withAdminTx(async (tx) => 4)';",
      'const tpl = `withAdminTx(async (tx) => 5)`;',
      'export async function real() {',
      '  return withAdminTx(async (tx) => tx);',
      '}',
    ].join('\n');
    const sites = scanAdminLaneSites(source);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ fn: 'real', legacy: true, line: 8 });
  });

  it('tells the deprecated form from a target, including a generic and a multi-line call', () => {
    const source = [
      'export async function a() {',
      '  await withAdminTx(async (tx) => tx);',
      '  await withAdminTx((tx) => tx.execute(x, y));',
      '  await withAdminTx<number>(async (tx) => 1);',
      '  await withAdminTx(rearm);',
      '  await withAdminTx({ tenantId }, async (tx) => tx);',
      '  await withAdminTx({ projectId: p.id },',
      '    async (tx) => tx);',
      '  await withAdminTx(target, (tx) => tx);',
      '}',
    ].join('\n');
    expect(scanAdminLaneSites(source).map((s) => s.legacy)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it('ignores a member call, a declaration and an import of the name', () => {
    const source = [
      "import { withAdminTx } from '../db/admin-tx';",
      'export function withAdminTx<T>(target: T): void;',
      'lanes.withAdminTx(first);',
      'type X = Parameters<typeof withAdminTx>[0];',
    ].join('\n');
    expect(scanAdminLaneSites(source)).toEqual([]);
  });

  it('keeps line numbers by masking, never by deleting', () => {
    const masked = maskSource("a\n// b\n/* c\nd */\n'e'\n`f\ng`\nh");
    expect(masked.split('\n')).toHaveLength(8);
    expect(masked).not.toMatch(/[bcdefg]/);
  });

  it('names a site outside any function (module)', () => {
    expect(scanAdminLaneSites('const x = await withAdminTx((tx) => tx);')).toEqual([
      { fn: '(module)', legacy: true, line: 1 },
    ]);
  });
});
