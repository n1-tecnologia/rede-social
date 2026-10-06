import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { encodeCursor } from '@rede-social/core/server/paging';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMUNITY_PAGE_SIZE, type CommunityQuery } from '../contracts/index';

/**
 * 2026-10-03 — the admin's order of the Comunidades list, asserted without a database (the
 * `story-highlights.test.ts` shape): the scripted transaction answers by the statement's TEXT,
 * rendered through drizzle's own `PgDialect`, so the script names what each answer is for and the
 * assertions can read the SQL and its bound parameters.
 *
 *  1. **The active list orders `position asc, last_activity_at desc, id desc`** — the index's own
 *     column list — and its cursor carries the position: `n` is `{position}~{instant}`, and feeding
 *     it back binds exactly that triple. A cursor of the old shape, a tampered one, or the ARCHIVED
 *     list's cursor degrades to page 1 (no bound key), never to a cast error.
 *  2. **The archived list is unchanged**, and an active cursor replayed on it is page 1 too.
 *  3. **The reorder locks, compares, and only then writes.** A set that is not exactly the locked
 *     one is `409 { community: 'order_stale' }` and NO renumber statement runs; the exact set (in
 *     any spelling of its uuids) renumbers in the requested order and answers the list's page 1 from
 *     the SAME statement GET runs. A duplicate is refused before any statement at all.
 *
 * The real ordering, paging across a position boundary and the 409 against real rows are proved in
 * `apps/api/tests/integration/communities.test.ts`; the index the order rides is pinned by pgTAP 110.
 */

const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const dialect = new PgDialect();

/** What the lock statement finds — the tenant's CURRENT active set. */
let activeIds: string[] = [];
/** The rows a page statement answers (already "ordered" by the script). */
let pageRows: Record<string, unknown>[] = [];
/** Every statement seen, as `{ kind, sql, params }`. */
let seen: { kind: string; sql: string; params: unknown[] }[] = [];

function classify(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (/^select c\.id from communities c .* for update$/.test(t)) return 'lock';
  if (/^update communities c set position/.test(t)) return 'renumber';
  if (/order by c\.position asc, c\.last_activity_at desc, c\.id desc/.test(t))
    return 'active-page';
  if (/order by c\.updated_at desc, c\.id desc/.test(t)) return 'archived-page';
  return `unknown: ${t.slice(0, 80)}`;
}

const tx = {
  execute: async (query: SQL) => {
    const rendered = dialect.sqlToQuery(query);
    const kind = classify(rendered.sql);
    seen.push({ kind, sql: rendered.sql.replace(/\s+/g, ' ').trim(), params: rendered.params });
    switch (kind) {
      case 'lock':
        return activeIds.map((id) => ({ id }));
      case 'renumber':
        return activeIds.map((id) => ({ id }));
      case 'active-page':
      case 'archived-page':
        return pageRows;
      default:
        return [];
    }
  },
};

vi.mock('@rede-social/core/db/tenant-tx', () => ({
  withTenantTx: <T>(_ctx: unknown, fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
}));

const { listCommunities, reorderCommunities } = await import('../server/service');

function context(): RequestContext {
  return {
    userId: USER_ID,
    tenantId: TENANT_ID,
    role: 'admin_tenant',
    requestId: 'test',
    events: [],
  };
}

/** One projected row, as the driver hands it back (snake_case, the timestamp already ISO text). */
function row(id: string, position: number, at: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `name-${id.slice(0, 4)}`,
    slug: `slug-${id.slice(0, 4)}`,
    description: '',
    cover_asset_id: null,
    cover_variant_widths: null,
    post_count: 0,
    status: 'active',
    last_activity_at: at,
    cursor_position: position,
    ...extra,
  };
}

const query = (overrides: Partial<CommunityQuery> = {}): CommunityQuery => ({
  limit: 2,
  status: 'active',
  ...overrides,
});

const decode = (cursor: string) =>
  JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { n: string; id: string };

beforeEach(() => {
  activeIds = [];
  pageRows = [];
  seen = [];
});

describe('the ACTIVE list — position first, and a cursor that carries it', () => {
  it('1. orders by the index’s own columns, and nextCursor is {position}~{instant} of the last row', async () => {
    pageRows = [
      row(A, 1, '2026-10-01T10:00:00.000001Z'),
      row(B, 2, '2026-10-02T10:00:00.000000Z'),
      // The over-fetched sentinel row: it proves another page exists and is never returned.
      row(C, 2, '2026-09-01T10:00:00.000000Z'),
    ];

    const page = await listCommunities(context(), query());

    expect(page.items.map((item) => item.id)).toEqual([A, B]);
    expect(page.nextCursor).not.toBeNull();
    expect(decode(page.nextCursor as string)).toMatchObject({
      n: '2~2026-10-02T10:00:00.000000Z',
      id: B,
    });
    // The position is a CURSOR key, never a payload field: the published summary is unchanged.
    expect(Object.keys(page.items[0] ?? {})).not.toContain('position');
    expect(Object.keys(page.items[0] ?? {})).not.toContain('cursorPosition');

    const [statement] = seen;
    expect(statement?.kind).toBe('active-page');
    expect(statement?.sql).toContain("c.status = 'active'");
    // Page 1: every cursor parameter (the position thrice, the instant, the id) is null.
    expect(statement?.params.slice(1, 6)).toEqual([null, null, null, null, null]);
  });

  it('2. the cursor fed back binds exactly (position, instant, id) — mixed directions, one boundary', async () => {
    pageRows = [row(C, 3, '2026-09-01T10:00:00.000000Z')];
    const cursor = encodeCursor({ n: '2~2026-10-02T10:00:00.000000Z', id: B });

    const page = await listCommunities(context(), query({ cursor }));

    expect(page.items.map((item) => item.id)).toEqual([C]);
    expect(page.nextCursor).toBeNull();
    const statement = seen[0];
    // `position >= p` first (the index seeks to the cursor's group), then the mixed-direction rest.
    expect(statement?.sql).toMatch(
      /or \( c\.position >= \$\d+::int and \( c\.position > \$\d+::int or \(c\.last_activity_at, c\.id\) < \(\$\d+::timestamptz, \$\d+::uuid\) \) \)/,
    );
    expect(statement?.params).toContain(2);
    expect(statement?.params).toContain('2026-10-02T10:00:00.000000Z');
    expect(statement?.params).toContain(B);
  });

  it('3. an old-shape, tampered or archived-list cursor degrades to page 1 — nothing reaches a cast', async () => {
    const hostile = [
      // The pre-2026-10-03 shape: a bare instant, no position.
      encodeCursor({ n: '2026-10-02T10:00:00.000000Z', id: B }),
      // Not an integer, not an instant, an out-of-range int4, an impossible calendar date.
      encodeCursor({ n: 'x~2026-10-02T10:00:00.000000Z', id: B }),
      encodeCursor({ n: '2~not-an-instant', id: B }),
      encodeCursor({ n: '9999999999~2026-10-02T10:00:00.000000Z', id: B }),
      encodeCursor({ n: '2~2026-02-30T10:00:00.000000Z', id: B }),
      'not-base64-at-all',
    ];
    for (const cursor of hostile) {
      seen = [];
      await listCommunities(context(), query({ cursor }));
      const params = seen[0]?.params ?? [];
      // Every cursor parameter is null: the statement ran as page 1.
      expect(params.slice(1, 6), cursor).toEqual([null, null, null, null, null]);
    }
  });
});

describe('the ARCHIVED list — unchanged, and safe from the active cursor', () => {
  it('4. orders updated_at desc and pages on its own instant cursor', async () => {
    pageRows = [
      row(A, 0, '2026-10-01T10:00:00.000000Z', {
        status: 'archived',
        cursor_at: '2026-10-03T09:00:00.000000Z',
      }),
      row(B, 0, '2026-10-01T10:00:00.000000Z', {
        status: 'archived',
        cursor_at: '2026-10-03T08:00:00.000000Z',
      }),
    ];

    const page = await listCommunities(context(), query({ status: 'archived', limit: 1 }));

    expect(seen[0]?.kind).toBe('archived-page');
    expect(seen[0]?.sql).not.toContain('position');
    expect(decode(page.nextCursor as string)).toMatchObject({
      n: '2026-10-03T09:00:00.000000Z',
      id: A,
    });
  });

  it('5. an ACTIVE cursor replayed on the archived list is page 1, never a 500 on the cast', async () => {
    const active = encodeCursor({ n: '3~2026-10-02T10:00:00.000000Z', id: B });

    await listCommunities(context(), query({ status: 'archived', cursor: active }));

    expect(seen[0]?.kind).toBe('archived-page');
    expect(seen[0]?.params.slice(1, 4)).toEqual([null, null, null]);
  });
});

describe('reorderCommunities — lock, compare, and only then write', () => {
  it('6. the exact set renumbers in the requested order and answers the list’s page 1', async () => {
    activeIds = [A, B, C];
    pageRows = [row(C, 1, '2026-09-01T10:00:00.000000Z'), row(A, 2, '2026-10-01T10:00:00.000000Z')];

    const page = await reorderCommunities(context(), { ids: [C, A, B] });

    expect(seen.map((statement) => statement.kind)).toEqual(['lock', 'renumber', 'active-page']);
    const [lock, renumber, read] = seen;
    // ONE fixed lock order, so two racing reorders queue instead of deadlocking.
    expect(lock?.sql).toMatch(/order by c\.id for update$/);
    // The permutation travels as ONE array literal, in the requested order.
    expect(renumber?.params).toContain(`{${[C, A, B].join(',')}}`);
    expect(renumber?.sql).toContain('c.position <> o.ord');
    expect(renumber?.sql).toContain("c.status = 'active'");
    // The answer is read by the SAME statement GET runs, at the list's page size, from page 1.
    expect(read?.params).toContain(COMMUNITY_PAGE_SIZE + 1);
    expect(page.items.map((item) => item.id)).toEqual([C, A]);
  });

  it('7. two spellings of one uuid are one community: upper-case ids still match the locked set', async () => {
    activeIds = [A, B];

    await reorderCommunities(context(), { ids: [B.toUpperCase(), A] });

    const renumber = seen.find((statement) => statement.kind === 'renumber');
    expect(renumber?.params).toContain(`{${[B, A].join(',')}}`);
  });

  it('8. a missing, extra or foreign id is ONE 409 order_stale — and nothing is written', async () => {
    activeIds = [A, B, C];
    const FOREIGN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

    for (const ids of [
      [A, B],
      [A, B, C, FOREIGN],
      [A, B, FOREIGN],
    ]) {
      seen = [];
      const refusal = await reorderCommunities(context(), { ids }).catch((error: unknown) => error);
      expect(refusal, ids.join(',')).toBeInstanceOf(ApiError);
      expect((refusal as ApiError).status).toBe(409);
      expect((refusal as ApiError).code).toBe('CONFLICT');
      expect((refusal as ApiError).details).toEqual({ community: 'order_stale' });
      // Locked, compared, refused: the renumber never ran.
      expect(seen.map((statement) => statement.kind)).toEqual(['lock']);
    }
  });

  it('9. a duplicate is malformed input (400), refused before any statement runs', async () => {
    activeIds = [A, B];

    const refusal = await reorderCommunities(context(), { ids: [A, A.toUpperCase()] }).catch(
      (error: unknown) => error,
    );

    expect(refusal).toBeInstanceOf(ApiError);
    expect((refusal as ApiError).status).toBe(400);
    expect(seen).toHaveLength(0);
  });
});
