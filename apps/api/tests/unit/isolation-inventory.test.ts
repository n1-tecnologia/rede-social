import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REALTIME_TOPIC_PATTERN } from '@rede-social/contracts/realtime';
import { describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import {
  ISOLATION_INVENTORY,
  REALTIME_TOPIC_INVENTORY,
  STORAGE_BUCKET_INVENTORY,
} from '../isolation-inventory';

/**
 * The isolation gate's machine check (08-10, TENANT-05, D-344): the route table IS the inventory.
 *
 * `app.routes` lists every mounted method + path (the app imports with the unit config's placeholder
 * env, no database, no network — the `mounts.test.ts` precedent). Every non-`ALL` entry must be
 * classified in `tests/isolation-inventory.ts`, every entry there must still exist, and every case
 * id it names must be the prefix of a real `it(` title in the two isolation suites. So a route added
 * without its cross-tenant case turns `pnpm turbo test` red, and so does a case renamed or deleted
 * under an entry that still points at it.
 *
 * The same rule covers the two non-route surfaces: every Realtime topic KIND of the contract's
 * pattern, and every Storage bucket a migration creates, must name a case too (plus the pgTAP file
 * that pins the bucket's policies).
 */

const live = new Set(
  app.routes.filter((route) => route.method !== 'ALL').map((r) => `${r.method} ${r.path}`),
);

const SUITES = ['../integration/isolation.test.ts', '../integration/realtime.test.ts'] as const;

/**
 * Every `it(` title of the two suites, read as TEXT (the suites need a live stack to import).
 * Titles use single, double or back quotes; the regex takes the first string argument of each
 * `it(` call, whichever quote it opens with.
 */
function itTitles(): string[] {
  const titles: string[] = [];
  for (const relative of SUITES) {
    const source = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
    const pattern = /\bit\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
    for (const match of source.matchAll(pattern)) titles.push(match[2] ?? '');
  }
  return titles;
}

/**
 * A case id names a title when the title STARTS with it and the next character ends the id (`.`,
 * `:`, a space, or the end): `b1` must not match `b10. …`, and `b` matches `b. detail` only.
 */
function namesATitle(caseId: string, titles: readonly string[]): boolean {
  return titles.some((title) => {
    if (!title.startsWith(caseId)) return false;
    const next = title.charAt(caseId.length);
    return next === '' || next === '.' || next === ':' || next === ' ';
  });
}

describe('isolation inventory (TENANT-05 gate)', () => {
  it('the route table is not empty (the check cannot pass vacuously)', () => {
    expect(live.size).toBeGreaterThan(100);
    expect(live.has('GET /v1/admin/moderation-log')).toBe(true);
  });

  it('every mounted route is classified: a case id or a reasoned exemption', () => {
    const unmapped = [...live].filter((key) => !(key in ISOLATION_INVENTORY));
    expect(unmapped, 'routes with no isolation case and no exemption').toEqual([]);
  });

  it('no stale entry: every classified route is still mounted', () => {
    const stale = Object.keys(ISOLATION_INVENTORY).filter((key) => !live.has(key));
    expect(stale, 'inventory entries for routes that no longer exist').toEqual([]);
  });

  it('every case id names an it() title in isolation.test.ts or realtime.test.ts', () => {
    const titles = itTitles();
    // Guard against a regex that silently matches nothing.
    expect(titles.length).toBeGreaterThan(40);
    const missing = [
      ...new Set(
        Object.values(ISOLATION_INVENTORY).flatMap((entry) =>
          'case' in entry ? [entry.case] : [],
        ),
      ),
    ].filter((caseId) => !namesATitle(caseId, titles));
    expect(missing, 'case ids with no matching it() title').toEqual([]);
  });

  it('every exemption carries a reason of at least 10 characters', () => {
    const weak = Object.entries(ISOLATION_INVENTORY)
      .filter(([, entry]) => 'exempt' in entry && entry.exempt.trim().length < 10)
      .map(([key]) => key);
    expect(weak).toEqual([]);
  });

  it('exemptions stay inside the reasoned families (health, openapi, public, hooks, webhooks, platform)', () => {
    const allowed = [
      /^GET \/v1\/health$/,
      /^GET \/v1\/openapi\.json$/,
      /^\w+ \/v1\/public\//,
      /^\w+ \/v1\/hooks\//,
      /^\w+ \/v1\/webhooks\//,
      /^\w+ \/v1\/platform\//,
    ];
    const outside = Object.entries(ISOLATION_INVENTORY)
      .filter(([key, entry]) => 'exempt' in entry && !allowed.some((re) => re.test(key)))
      .map(([key]) => key);
    expect(outside, 'a tenant-lane route may not be exempted').toEqual([]);
  });

  it("the web gate's text parse of this map yields exactly its keys", () => {
    // `apps/web/lib/route-handlers.inventory.test.ts` cannot IMPORT this map (`turbo boundaries`
    // refuses an import that leaves the web package), so it reads the file as text with this SAME
    // regex. Pinning the parse here means a key written in a shape the regex misses fails this suite.
    const API_INVENTORY_KEY_RE = /^\s*'((?:GET|POST|PUT|PATCH|DELETE) \/[^']*)':/gm;
    const source = readFileSync(
      fileURLToPath(new URL('../isolation-inventory.ts', import.meta.url)),
      'utf8',
    );
    const parsed = [...source.matchAll(API_INVENTORY_KEY_RE)].map((match) => match[1] ?? '');
    expect(parsed.sort()).toEqual(Object.keys(ISOLATION_INVENTORY).sort());
  });

  it('every Realtime topic kind of REALTIME_TOPIC_PATTERN names a cross-tenant case', () => {
    // The alternation after `tenant:<uuid>:`, each branch reduced to its kind (`user:<uuid>` -> `user`).
    const group = /:\((.+)\)\$$/.exec(REALTIME_TOPIC_PATTERN)?.[1] ?? '';
    const kinds = group.split('|').map((branch) => branch.split(':')[0] ?? '');
    expect(kinds.sort()).toEqual(['all', 'conv', 'support-inbox', 'user']);
    expect(Object.keys(REALTIME_TOPIC_INVENTORY).sort()).toEqual(kinds);
    const titles = itTitles();
    for (const [kind, entry] of Object.entries(REALTIME_TOPIC_INVENTORY)) {
      expect(namesATitle(entry.case, titles), `topic kind ${kind}`).toBe(true);
    }
  });

  it('every Storage bucket a migration creates names a case and an existing pgTAP file', () => {
    const migrations = fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url));
    const buckets = new Set<string>();
    for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql'))) {
      const sql = readFileSync(`${migrations}${file}`, 'utf8');
      for (const match of sql.matchAll(
        /insert into storage\.buckets[^;]*?values\s*\(\s*'([^']+)'/gi,
      )) {
        buckets.add(match[1] ?? '');
      }
    }
    expect([...buckets].sort()).toEqual(['branding', 'media']);
    expect(Object.keys(STORAGE_BUCKET_INVENTORY).sort()).toEqual([...buckets].sort());
    const titles = itTitles();
    const pgtap = fileURLToPath(new URL('../../../../supabase/tests/', import.meta.url));
    for (const [bucket, entry] of Object.entries(STORAGE_BUCKET_INVENTORY)) {
      expect(namesATitle(entry.case, titles), `bucket ${bucket}`).toBe(true);
      expect(existsSync(`${pgtap}${entry.pgtap}`), `pgTAP ${entry.pgtap}`).toBe(true);
    }
  });
});
