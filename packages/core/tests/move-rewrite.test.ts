import { describe, expect, it } from 'vitest';
import {
  assertNoLeftover,
  BRANDING_PUBLIC_PATH,
  rewriteStorageOrigins,
  scanForOrigin,
} from '../server/projects/move/rewrite';
import { type Db, MoveError } from '../server/projects/move/types';

/**
 * 09.2-22: the origin rewrite and the scan, on plain values. The scan against a real database (a leftover in a
 * text column of a copied tenant row) is exercised by `move-copy.test.ts`.
 */

const OLD = 'https://oldref.supabase.co';
const NEW = 'https://newref.supabase.co';
const TENANT = 'e3cbdc5f-787a-4707-a0d6-2ceeeaddad9e';
const url = (origin: string, key: string) =>
  `${origin}${BRANDING_PUBLIC_PATH}${TENANT}/branding/${key}`;

describe('rewriteStorageOrigins (D-534 step 6)', () => {
  it('replaces the origin in every branding shape: logoUrl, faviconUrl, iconUrl and iconUrls.*', () => {
    const branding = {
      colors: { primary: '#0f766e' },
      logoUrl: url(OLD, 'logo.png'),
      faviconUrl: url(OLD, 'favicon.ico'),
      iconUrl: url(OLD, 'icon.png'),
      iconUrls: {
        i192: url(OLD, 'icons/1/icon-192.png'),
        i512: url(OLD, 'icons/1/icon-512.png'),
        maskable512: url(OLD, 'icons/1/maskable.png'),
        apple180: url(OLD, 'icons/1/apple.png'),
      },
    };
    const out = rewriteStorageOrigins(branding, OLD, NEW);
    expect(out.logoUrl).toBe(url(NEW, 'logo.png'));
    expect(out.faviconUrl).toBe(url(NEW, 'favicon.ico'));
    expect(out.iconUrl).toBe(url(NEW, 'icon.png'));
    expect(
      Object.values(out.iconUrls).every((value) =>
        value.startsWith(`${NEW}${BRANDING_PUBLIC_PATH}`),
      ),
    ).toBe(true);
    expect(out.colors).toEqual({ primary: '#0f766e' });
    // The input is not mutated.
    expect(branding.logoUrl).toBe(url(OLD, 'logo.png'));
  });

  it('leaves a URL of the same origin that is not a public branding URL untouched', () => {
    const signed = `${OLD}/storage/v1/object/sign/media/${TENANT}/x.png?token=abc`;
    const other = `${OLD}/rest/v1/tenants`;
    const out = rewriteStorageOrigins({ signed, other, nested: [signed] }, OLD, NEW);
    expect(out).toEqual({ signed, other, nested: [signed] });
  });

  it('leaves a relative logo and a URL of another origin untouched', () => {
    const value = {
      logoUrl: '/seed-logos/rede-lab.svg',
      iconUrl: url('https://elsewhere.example', 'a.png'),
    };
    expect(rewriteStorageOrigins(value, OLD, NEW)).toEqual(value);
  });

  it('walks arrays and nested objects, and keeps non-string values as they are', () => {
    const value = {
      look: [{ banner: url(OLD, 'b.png'), size: 3, on: true, none: null }, [url(OLD, 'c.png')]],
    };
    expect(rewriteStorageOrigins(value, OLD, NEW)).toEqual({
      look: [{ banner: url(NEW, 'b.png'), size: 3, on: true, none: null }, [url(NEW, 'c.png')]],
    });
  });

  it('is idempotent: a second pass finds nothing left to replace', () => {
    const once = rewriteStorageOrigins({ iconUrl: url(OLD, 'a.png') }, OLD, NEW);
    expect(rewriteStorageOrigins(once, OLD, NEW)).toEqual(once);
  });

  it('does not confuse an origin that is a prefix of another (a longer port or host)', () => {
    const lookalike = `${OLD}.evil.example${BRANDING_PUBLIC_PATH}${TENANT}/a.png`;
    const longerPort = `http://127.0.0.1:543210${BRANDING_PUBLIC_PATH}a.png`;
    expect(rewriteStorageOrigins({ lookalike }, OLD, NEW)).toEqual({ lookalike });
    expect(rewriteStorageOrigins({ longerPort }, 'http://127.0.0.1:54321', NEW)).toEqual({
      longerPort,
    });
  });

  it('accepts origins written with a trailing slash', () => {
    expect(rewriteStorageOrigins({ iconUrl: url(OLD, 'a.png') }, `${OLD}/`, `${NEW}/`)).toEqual({
      iconUrl: url(NEW, 'a.png'),
    });
  });
});

/** A database that answers the two shapes of query the scan runs, and records them. */
function fakeDb(options: {
  columns: { table: string; column: string }[];
  counts: Record<string, number>;
}) {
  const queries: string[] = [];
  const db = {
    unsafe: async (query: string, params: unknown[] = []) => {
      queries.push(query);
      if (query.includes('from pg_attribute a')) return options.columns;
      if (query.includes('select exists(select 1 from pg_attribute')) return [{ ok: true }];
      const match = /from public\."(\w+)"[\s\S]*"(\w+)"::text/.exec(query);
      const key = match ? `${match[1]}.${match[2]}` : '';
      expect(params[1]).toBeTypeOf('string');
      return [{ n: options.counts[key] ?? 0 }];
    },
  } as unknown as Db;
  return { db, queries };
}

describe('scanForOrigin and assertNoLeftover (T-09.2-99)', () => {
  it('finds a leftover in a jsonb column and in a text column and returns counts only', async () => {
    const { db, queries } = fakeDb({
      columns: [
        { table: 'tenants', column: 'branding' },
        { table: 'tenants', column: 'rules_text' },
        { table: 'feed_posts', column: 'body' },
      ],
      counts: { 'tenants.branding': 1, 'feed_posts.body': 4 },
    });
    const found = await scanForOrigin(db, ['tenants', 'feed_posts'], OLD, TENANT);
    expect(found).toEqual([
      { table: 'tenants', column: 'branding', count: 1 },
      { table: 'feed_posts', column: 'body', count: 4 },
    ]);
    // The matching text never leaves the database: the statements select a count, not the column.
    const scans = queries.filter((query) => query.includes('position('));
    expect(scans).toHaveLength(3);
    for (const query of scans) {
      expect(query).toContain('count(*)');
      expect(query).not.toMatch(/select\s+"/);
    }
    expect(JSON.stringify(found)).not.toContain(OLD);
  });

  it('returns nothing for a clean copy and for an empty table list', async () => {
    const clean = fakeDb({ columns: [{ table: 'tenants', column: 'branding' }], counts: {} });
    expect(await scanForOrigin(clean.db, ['tenants'], OLD, TENANT)).toEqual([]);
    const none = fakeDb({ columns: [], counts: {} });
    expect(await scanForOrigin(none.db, [], OLD, TENANT)).toEqual([]);
    expect(none.queries).toHaveLength(0);
  });

  it('turns a non-empty scan into origin_leftover naming table.column pairs only', () => {
    expect(() => assertNoLeftover([])).not.toThrow();
    let caught: unknown;
    try {
      assertNoLeftover([{ table: 'feed_posts', column: 'body', count: 2 }]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MoveError);
    expect((caught as MoveError).code).toBe('origin_leftover');
    expect((caught as MoveError).tables).toEqual(['feed_posts.body']);
    expect((caught as MoveError).message).toBe('origin_leftover: feed_posts.body');
  });
});
