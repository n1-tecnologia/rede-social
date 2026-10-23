import { type FkEdge, orderTables, SELF_REF_ORDER } from './fk-order';
import {
  assertUuid,
  type ColumnInfo,
  type Db,
  idsParam,
  MoveError,
  type MovePlan,
  type MoveSide,
  publicTable,
  quoteIdent,
  run,
  type TableCount,
  type TableInfo,
} from './types';

/**
 * The dry run of a move (09.2-22, D-534, D-536). Everything is derived from the catalogs of the SOURCE (and,
 * when given, the TARGET); nothing is a hand-written table list except the two named maps below, which carry
 * the reason for every entry.
 *
 * The plan is the safety net for later phases (planning decision 2): a table that gains rows the engine cannot
 * place appears in `uncovered`, and `assertCoverage` refuses to start the copy until someone decides its
 * handling. Two shapes are uncovered:
 *  - a `public` table WITHOUT a `tenant_id` column that is neither excluded nor special (it is tenant data
 *    reachable only through a parent, which a `tenant_id` filter would silently skip);
 *  - a table WITH `tenant_id` that the TARGET does not hold (a schema older than the source's).
 *
 * Both sides are only ever opened in `read only` transactions here: a dry run writes nothing.
 */

/**
 * Tables the copy leaves alone, with the reason (D-534). Anything with a `tenant_id` column that is NOT listed
 * here is copied.
 */
export const COPY_EXCLUSIONS: Readonly<Record<string, string>> = {
  tenant_domains:
    'central-owned: host to tenant lives in the central project, the tenant project keeps an empty dormant copy',
  media_provider_events:
    'ephemeral dedupe store of provider webhooks, no tenant data (no tenant_id)',
  platform_admins: 'central-owned: the super admin lives in the central project, not tenant data',
  email_allowlist: 'retired in 09.1 (access_grants replaced it), not tenant data',
};

/**
 * Tables copied by hand, with the reason. `tenants` and `tenant_modules` are mirrored (central owns some
 * columns, the tenant project owns others: the target row the bootstrap created is UPDATED); `users` is filled
 * by the Auth copy (the accounts of the tenant's people only).
 */
export const SPECIAL_TABLES: Readonly<Record<string, string>> = {
  tenants:
    'the bootstrap created the target row; branding, rules_text and rules_version are updated from the source',
  tenant_modules: 'only settings are tenant-owned; enabled belongs to the bootstrap and the mirror',
  users: 'filled by the Auth copy for the accounts of this tenant only',
};

// ---------------------------------------------------------------------------------------------------------
// Catalog reads
// ---------------------------------------------------------------------------------------------------------

type TableRow = {
  name: string;
  has_tenant: boolean;
  /** jsonb sent as text and parsed here, so the result does not depend on the caller's driver type parsers. */
  columns: string;
  pk: string;
  triggers: boolean;
};

/** Every ordinary `public` table with its columns, key and triggers. */
export async function introspectTables(db: Db): Promise<TableInfo[]> {
  const rows = await run<TableRow>(
    db,
    `select c.relname as name,
            exists(select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
                      and a.atttypid = 'uuid'::regtype) as has_tenant,
            coalesce((select jsonb_agg(jsonb_build_object('name', a.attname,
                                                          'type', format_type(a.atttypid, a.atttypmod),
                                                          'generated', a.attgenerated <> '') order by a.attnum)
                        from pg_attribute a
                       where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '[]'::jsonb)::text as columns,
            coalesce((select jsonb_agg(a.attname order by array_position(i.indkey::int2[], a.attnum))
                        from pg_index i
                        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
                       where i.indrelid = c.oid and i.indisprimary), '[]'::jsonb)::text as pk,
            exists(select 1 from pg_trigger t
                    where t.tgrelid = c.oid and not t.tgisinternal and t.tgenabled <> 'D') as triggers
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`,
  );
  return rows.map((row) => ({
    name: row.name,
    hasTenantId: row.has_tenant,
    columns: JSON.parse(row.columns) as ColumnInfo[],
    pk: JSON.parse(row.pk) as string[],
    userTriggers: row.triggers,
  }));
}

/** Every foreign key between `public` tables. */
export async function foreignKeyEdges(db: Db): Promise<FkEdge[]> {
  const rows = await run<{ child: string; parent: string; deferrable: boolean }>(
    db,
    `select cl.relname as child, pl.relname as parent, k.condeferrable as deferrable
       from pg_constraint k
       join pg_class cl on cl.oid = k.conrelid
       join pg_class pl on pl.oid = k.confrelid
      where k.contype = 'f'
        and cl.relnamespace = 'public'::regnamespace
        and pl.relnamespace = 'public'::regnamespace
      order by cl.relname, pl.relname, k.conname`,
  );
  return rows;
}

/**
 * The accounts that belong to the tenant: `distinct user_id` of its memberships (any status) plus the invitees
 * it has an `auth` account for. Ids only; nothing identifies a person here.
 */
export async function accountIdsOf(db: Db, tenantId: string): Promise<string[]> {
  assertUuid(tenantId);
  const rows = await run<{ user_id: string }>(
    db,
    `select user_id::text as user_id from public.memberships where tenant_id = $1::uuid
     union
     select user_id::text from public.tenant_invites where tenant_id = $1::uuid and user_id is not null
     order by 1`,
    [tenantId],
  );
  return rows.map((row) => row.user_id);
}

/** Single-column foreign keys from `public` tables to `public.users`, as `table.column` with the table name. */
async function userReferences(db: Db): Promise<{ table: string; column: string }[]> {
  return run<{ table: string; column: string }>(
    db,
    `select cl.relname as "table", a.attname as "column"
       from pg_constraint k
       join pg_class cl on cl.oid = k.conrelid
       join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
      where k.contype = 'f' and array_length(k.conkey, 1) = 1
        and k.confrelid = 'public.users'::regclass
        and cl.relnamespace = 'public'::regnamespace
      order by cl.relname, a.attname`,
  );
}

/** The Storage buckets a move copies. */
export const MOVE_BUCKETS = ['branding', 'media'] as const;

async function storageTotals(
  db: Db,
  tenantId: string,
): Promise<{ objects: number; bytes: number }> {
  const [row] = await run<{ objects: number; bytes: string }>(
    db,
    `select count(*)::int as objects, coalesce(sum((metadata ->> 'size')::bigint), 0)::text as bytes
       from storage.objects
      where bucket_id = any ($1::text[]) and name like $2 escape '\\'`,
    [`{${MOVE_BUCKETS.join(',')}}`, `${tenantId}/%`],
  );
  return { objects: row?.objects ?? 0, bytes: Number(row?.bytes ?? 0) };
}

// ---------------------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------------------

const sameColumns = (a: TableInfo, b: TableInfo): boolean => {
  const live = (info: TableInfo) =>
    info.columns
      .filter((column) => !column.generated)
      .map((column) => `${column.name}:${column.type}`)
      .sort();
  const left = live(a);
  const right = live(b);
  return left.length === right.length && left.every((entry, i) => entry === right[i]);
};

/**
 * Plans the move of `source.tenantId`: the copy set, its order, the counts, the accounts, the files and
 * everything the engine cannot place. `target` is optional so an operator can run the dry run before any
 * target project exists (`targetChecked: false`).
 */
export async function planMove(source: MoveSide, target?: MoveSide): Promise<MovePlan> {
  const tenantId = assertUuid(source.tenantId);

  const read = await source.sql.begin('read only', async (tx) => {
    const tables = await introspectTables(tx);
    const edges = await foreignKeyEdges(tx);
    const [tenant] = await run<{ n: number }>(
      tx,
      'select count(*)::int as n from public.tenants where id = $1::uuid',
      [tenantId],
    );
    if (tenant?.n !== 1) throw new MoveError('tenant_not_found');

    const candidates = tables.filter(
      (table) =>
        table.hasTenantId && !(table.name in COPY_EXCLUSIONS) && !(table.name in SPECIAL_TABLES),
    );
    const counts: TableCount[] = [];
    for (const table of candidates) {
      const [row] = await run<{ n: number }>(
        tx,
        `select count(*)::int as n from ${publicTable(table.name)} where tenant_id = $1::uuid`,
        [tenantId],
      );
      counts.push({ name: table.name, rows: row?.n ?? 0 });
    }

    const ids = await accountIdsOf(tx, tenantId);
    const [accounts] = await run<{ n: number }>(
      tx,
      `select count(*)::int as n from auth.users
        where id in (select value::uuid from jsonb_array_elements_text($1::text::jsonb))`,
      [idsParam(ids)],
    );
    const storage = await storageTotals(tx, tenantId);

    // A row that references a user outside the tenant's accounts cannot be placed: say so now, by name.
    const dangling: string[] = [];
    const candidateNames = new Set(candidates.map((table) => table.name));
    for (const reference of await userReferences(tx)) {
      if (!candidateNames.has(reference.table)) continue;
      const [row] = await run<{ n: number }>(
        tx,
        `select count(*)::int as n from ${publicTable(reference.table)}
          where tenant_id = $1::uuid and ${quoteIdent(reference.column)} is not null
            and ${quoteIdent(reference.column)} not in (
                  select value::uuid from jsonb_array_elements_text($2::text::jsonb))`,
        [tenantId, idsParam(ids)],
      );
      if ((row?.n ?? 0) > 0) dangling.push(`${reference.table}.${reference.column}`);
    }
    return { tables, edges, candidates, counts, accounts: accounts?.n ?? 0, storage, dangling };
  });

  const info: Record<string, TableInfo> = Object.fromEntries(
    read.tables.map((table) => [table.name, table]),
  );

  // Tables the engine cannot place: tenant data reachable only through a parent, never silently skipped.
  const uncovered = new Set<string>(
    read.tables
      .filter(
        (table) =>
          !table.hasTenantId && !(table.name in COPY_EXCLUSIONS) && !(table.name in SPECIAL_TABLES),
      )
      .map((table) => table.name),
  );

  const schemaMismatch: string[] = [];
  let targetChecked = false;
  if (target) {
    const held = await target.sql.begin('read only', (tx) => introspectTables(tx));
    const heldByName = new Map(held.map((table) => [table.name, table]));
    targetChecked = true;
    for (const table of read.candidates) {
      const there = heldByName.get(table.name);
      if (!there) uncovered.add(table.name);
      else if (!sameColumns(table, there)) schemaMismatch.push(table.name);
    }
    for (const name of Object.keys(SPECIAL_TABLES)) {
      const here = info[name];
      const there = heldByName.get(name);
      if (here && !there) uncovered.add(name);
      else if (here && there && !sameColumns(here, there)) schemaMismatch.push(name);
    }
  }

  const copyable = read.candidates
    .map((table) => table.name)
    .filter((name) => !uncovered.has(name) && !schemaMismatch.includes(name));
  // Edges to a table outside the copy set other than `tenants`/`users`/`tenant_modules` mean the copy would
  // leave a dangling reference; they surface as uncovered rather than as a constraint violation mid-copy.
  const known = new Set<string>([...copyable, ...Object.keys(SPECIAL_TABLES)]);
  for (const edge of read.edges) {
    if (copyable.includes(edge.child) && !known.has(edge.parent) && edge.parent !== edge.child) {
      uncovered.add(edge.parent);
    }
  }
  const { order } = orderTables(read.edges, copyable, { selfRefOrder: SELF_REF_ORDER });

  return {
    tenantId,
    targetChecked,
    tables: read.counts.filter((count) => copyable.includes(count.name)),
    order: order.flat(),
    groups: order,
    special: Object.keys(SPECIAL_TABLES).filter((name) => name in info),
    authUsers: read.accounts,
    storageObjects: read.storage.objects,
    storageBytes: read.storage.bytes,
    uncovered: [...uncovered].sort(),
    schemaMismatch: schemaMismatch.sort(),
    danglingUsers: read.dangling,
    info,
  };
}

/**
 * Refuses a plan the engine cannot carry out. `uncovered_tables` first (a later phase added data the engine
 * does not place), then `schema_mismatch` (the target is not at the source's schema), then `account_missing`
 * (a row references a user who is not one of the tenant's accounts). Names only.
 */
export function assertCoverage(plan: MovePlan): void {
  if (plan.uncovered.length > 0) throw new MoveError('uncovered_tables', plan.uncovered);
  if (plan.schemaMismatch.length > 0) throw new MoveError('schema_mismatch', plan.schemaMismatch);
  if (plan.danglingUsers.length > 0) throw new MoveError('account_missing', plan.danglingUsers);
}
