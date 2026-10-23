import { type Db, type LeftoverOrigin, MoveError, publicTable, quoteIdent, run } from './types';

/**
 * Storage URLs inside copied data (09.2-22, D-534 step 6, T-09.2-99).
 *
 * The only column family that stores an ABSOLUTE bucket URL is `tenants.branding` (`logoUrl`, `faviconUrl`,
 * `iconUrl`, `iconUrls.*`, written from `getPublicUrl`). After a move the files live in another project, so the
 * origin (`https://<oldref>.supabase.co`) must become the target's, but ONLY in values whose path starts
 * `/storage/v1/object/public/branding/` (the rule `isAllowedIconUrl` in `apps/web/lib/manifest.ts` applies).
 * Every other string, even one that contains the old origin, is left alone and is caught by the scan: a
 * rewrite that guessed would hide the very leftover the scan exists to find.
 */

/** The only path family a rewrite touches. */
export const BRANDING_PUBLIC_PATH = '/storage/v1/object/public/branding/';

const trimOrigin = (origin: string): string => origin.replace(/\/+$/, '');

/**
 * A copy of `value` with the old origin replaced by the new one in every string that is a public branding URL
 * of the old project. Pure and idempotent: a second pass finds no old origin left to replace.
 */
export function rewriteStorageOrigins<T>(value: T, oldOrigin: string, newOrigin: string): T {
  const from = `${trimOrigin(oldOrigin)}${BRANDING_PUBLIC_PATH}`;
  const to = trimOrigin(newOrigin);
  const oldBase = trimOrigin(oldOrigin);

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      return node.startsWith(from) ? `${to}${node.slice(oldBase.length)}` : node;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
    }
    return node;
  };
  return walk(value) as T;
}

type TextColumn = { table: string; column: string };

/** Every `jsonb`, `json` and text-like column of `tables` in the catalog of `db`. */
async function textColumns(db: Db, tables: readonly string[]): Promise<TextColumn[]> {
  if (tables.length === 0) return [];
  const rows = await run<{ table: string; column: string }>(
    db,
    `select c.relname as "table", a.attname as "column"
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname in (select value from jsonb_array_elements_text($1::text::jsonb))
        and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
        and a.atttypid in ('jsonb'::regtype, 'json'::regtype, 'text'::regtype,
                           'varchar'::regtype, 'citext'::regtype)
      order by c.relname, a.attnum`,
    [JSON.stringify(tables)],
  );
  return rows;
}

/**
 * Counts, per column, the rows of the copied tables that still contain `oldOrigin`. Returns table, column and
 * count only: the matching text never leaves the database. A table that carries `tenant_id` is read for the
 * moved tenant only; `tenants` is read by its own id.
 */
export async function scanForOrigin(
  db: Db,
  tables: readonly string[],
  oldOrigin: string,
  tenantId: string,
): Promise<LeftoverOrigin[]> {
  const needle = trimOrigin(oldOrigin);
  const columns = await textColumns(db, tables);
  const found: LeftoverOrigin[] = [];
  for (const { table, column } of columns) {
    const scope = table === 'tenants' ? 'id' : 'tenant_id';
    const hasScope = await run<{ ok: boolean }>(
      db,
      `select exists(select 1 from pg_attribute
                      where attrelid = $1::regclass and attname = $2 and not attisdropped) as ok`,
      [publicTable(table), scope],
    );
    if (!hasScope[0]?.ok) continue;
    const [row] = await run<{ n: number }>(
      db,
      `select count(*)::int as n from ${publicTable(table)}
        where ${quoteIdent(scope)} = $1::uuid and position($2 in ${quoteIdent(column)}::text) > 0`,
      [tenantId, needle],
    );
    if (row && row.n > 0) found.push({ table, column, count: row.n });
  }
  return found;
}

/**
 * `origin_leftover` when the scan found the old origin anywhere (T-09.2-99): a copy that still points at the
 * old project's Storage must fail, not ship. The error names `table.column` pairs, never a value.
 */
export function assertNoLeftover(found: readonly LeftoverOrigin[]): void {
  if (found.length === 0) return;
  throw new MoveError(
    'origin_leftover',
    found.map((entry) => `${entry.table}.${entry.column}`),
    { leftovers: found },
  );
}
