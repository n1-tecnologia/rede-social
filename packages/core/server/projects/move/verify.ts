import { type StoragePort, storageTotalsOf } from './copy-storage';
import { accountIdsOf } from './plan';
import { rewriteStorageOrigins, scanForOrigin } from './rewrite';
import {
  type Db,
  idsParam,
  MoveError,
  type MovePlan,
  type MoveSide,
  publicTable,
  quoteIdent,
  run,
  type TableVerify,
  type VerifyReport,
} from './types';

/**
 * The verification (09.2-22, D-536, D-534 step 8). It reads both databases and answers one question: is the
 * target an exact copy of what the source holds for this tenant?
 *
 *  - per-table count equality, and no row of ANOTHER tenant in the target (T-09.2-96);
 *  - `md5(string_agg(to_jsonb(t)::text, ',' order by <pk>))` on every table under 50,000 rows, a sampled hash
 *    (every Nth row of the key order, N chosen so about 5,000 rows are hashed) above that. `to_jsonb` makes the
 *    text independent of column order;
 *  - the special rows: the tenant's `rules_*` and (rewritten) `branding`, the `settings` of every module, the
 *    `public.users` rows of the moved accounts;
 *  - the ordered `encrypted_password` list of the moved accounts, compared as an md5 of the concatenation and
 *    reported only as `match` or `mismatch`;
 *  - Storage count and bytes through the ports, when given;
 *  - the old-origin scan over every `jsonb` and text column of the copied tables (T-09.2-99).
 *
 * The report holds table names, counts and verdicts. Never a row, an e-mail, a password hash or a key
 * (T-09.2-98). A failed check throws `MoveError('verify_failed')` naming `table:check` pairs (or
 * `origin_leftover` when the scan is the only thing wrong); the report rides on the error.
 */

/** Tables up to this many rows are hashed in full. */
export const FULL_CHECKSUM_MAX_ROWS = 50_000;
/** Above it, about this many rows are hashed. */
export const SAMPLE_TARGET_ROWS = 5_000;

export type VerifyOptions = {
  /** The origin the files were served from before the move. When given, the old-origin scan runs. */
  oldOrigin?: string;
  /** The origin they are served from now (to compute the branding the target should hold). */
  newOrigin?: string;
  storage?: { source: StoragePort; target: StoragePort; buckets?: readonly string[] };
  /**
   * The target is a project of its own (the default), so no row of another tenant may exist in it. A shared
   * target (a non-production project that hosts several tenants) passes `true`.
   */
  allowOtherTenants?: boolean;
};

const sampleStep = (rows: number): number =>
  rows <= FULL_CHECKSUM_MAX_ROWS ? 1 : Math.max(1, Math.ceil(rows / SAMPLE_TARGET_ROWS));

function keyOrder(plan: MovePlan, table: string): string {
  const pk = plan.info[table]?.pk ?? [];
  return pk.length > 0 ? pk.map(quoteIdent).join(', ') : 'to_jsonb(t)::text';
}

async function tableDigest(
  db: Db,
  plan: MovePlan,
  table: string,
  step: number,
): Promise<{ rows: number; digest: string | null }> {
  const [row] = await run<{ rows: number; digest: string | null }>(
    db,
    `select count(*)::int as rows,
            md5(string_agg(j, ',' order by rn) filter (where rn % $2::int = 0)) as digest
       from (select to_jsonb(t)::text as j,
                    row_number() over (order by ${keyOrder(plan, table)}) as rn
               from ${publicTable(table)} t where tenant_id = $1::uuid) s`,
    [plan.tenantId, step],
  );
  return { rows: row?.rows ?? 0, digest: row?.digest ?? null };
}

async function scalar<T>(db: Db, query: string, params: readonly unknown[]): Promise<T | null> {
  const [row] = await run<{ v: T | null }>(db, query, params);
  return row?.v ?? null;
}

export async function verifyCopy(
  plan: MovePlan,
  source: MoveSide,
  target: MoveSide,
  options: VerifyOptions = {},
): Promise<VerifyReport> {
  const tenantId = plan.tenantId;
  const failures: string[] = [];
  const tables: TableVerify[] = [];
  let accounts: VerifyReport['accounts'] = { count: 0, passwords: 'mismatch' };

  await source.sql.begin('isolation level repeatable read read only', async (src) => {
    const tgt = target.sql;

    // 1. Rows of every copied table.
    for (const { name } of plan.tables) {
      const [from] = await run<{ n: number }>(
        src,
        `select count(*)::int as n from ${publicTable(name)} where tenant_id = $1::uuid`,
        [tenantId],
      );
      const rows = from?.n ?? 0;
      const step = sampleStep(rows);
      const [a, b] = await Promise.all([
        tableDigest(src, plan, name, step),
        tableDigest(tgt, plan, name, step),
      ]);
      const countOk = a.rows === b.rows;
      const checksumOk = countOk && a.digest === b.digest;
      tables.push({
        name,
        source: a.rows,
        target: b.rows,
        checksum: checksumOk ? (step === 1 ? 'match' : 'sampled') : 'mismatch',
      });
      if (!countOk) failures.push(`${name}:count`);
      else if (!checksumOk) failures.push(`${name}:checksum`);

      if (!options.allowOtherTenants) {
        const foreign = await scalar<number>(
          tgt,
          `select count(*)::int as v from ${publicTable(name)} where tenant_id <> $1::uuid`,
          [tenantId],
        );
        if ((foreign ?? 0) > 0) failures.push(`${name}:foreign_tenant_rows`);
      }
    }
    if (!options.allowOtherTenants) {
      const foreign = await scalar<number>(
        tgt,
        'select count(*)::int as v from public.tenants where id <> $1::uuid',
        [tenantId],
      );
      if ((foreign ?? 0) > 0) failures.push('tenants:foreign_tenant_rows');
    }

    // 2. The mirrored rows: rules, branding (as it should have been rewritten) and module settings.
    const sourceTenant = await scalar<string>(
      src,
      'select to_jsonb(t)::text as v from public.tenants t where id = $1::uuid',
      [tenantId],
    );
    if (!sourceTenant) throw new MoveError('tenant_not_found');
    const parsed = JSON.parse(sourceTenant) as {
      branding: unknown;
      rules_text: string;
      rules_version: number;
    };
    const expectedBranding =
      options.oldOrigin && options.newOrigin
        ? rewriteStorageOrigins(parsed.branding, options.oldOrigin, options.newOrigin)
        : parsed.branding;
    const tenantOk = await scalar<boolean>(
      tgt,
      `select (branding = $2::text::jsonb and rules_text = $3 and rules_version = $4::int) as v
         from public.tenants where id = $1::uuid`,
      [tenantId, JSON.stringify(expectedBranding), parsed.rules_text, parsed.rules_version],
    );
    if (tenantOk !== true) failures.push('tenants:mirrored_columns');

    const moduleDigest = `select md5(coalesce(string_agg(module_key || ':' || settings::text, ',' order by module_key), '')) as v
                            from public.tenant_modules where tenant_id = $1::uuid`;
    const [fromModules, toModules] = await Promise.all([
      scalar<string>(src, moduleDigest, [tenantId]),
      scalar<string>(tgt, moduleDigest, [tenantId]),
    ]);
    if (fromModules !== toModules) failures.push('tenant_modules:settings');

    // 3. Accounts: the people of the tenant, their mirror rows and their password hashes.
    const ids = await accountIdsOf(src, tenantId);
    const idList = idsParam(ids);
    const inIds = (column: string) =>
      `${column} in (select value::uuid from jsonb_array_elements_text($1::text::jsonb))`;
    const authDigest = `select md5(coalesce(string_agg(coalesce(encrypted_password, '') || ':' || id::text, ',' order by id), '')) as v
                          from auth.users where ${inIds('id')}`;
    const [fromAuth, toAuth] = await Promise.all([
      scalar<string>(src, authDigest, [idList]),
      scalar<string>(tgt, authDigest, [idList]),
    ]);
    const passwords: 'match' | 'mismatch' =
      fromAuth !== null && fromAuth === toAuth ? 'match' : 'mismatch';
    if (passwords === 'mismatch') failures.push('auth.users:passwords');

    const countUsers = `select count(*)::int as v from auth.users where ${inIds('id')}`;
    const [fromUsers, toUsers] = await Promise.all([
      scalar<number>(src, countUsers, [idList]),
      scalar<number>(tgt, countUsers, [idList]),
    ]);
    if (fromUsers !== toUsers) failures.push('auth.users:count');

    const countIdentities = `select count(*)::int as v from auth.identities where ${inIds('user_id')}`;
    const [fromIdentities, toIdentities] = await Promise.all([
      scalar<number>(src, countIdentities, [idList]),
      scalar<number>(tgt, countIdentities, [idList]),
    ]);
    if (fromIdentities !== toIdentities) failures.push('auth.identities:count');

    const mirror = `select md5(coalesce(string_agg(to_jsonb(u)::text, ',' order by id), '')) as v
                      from public.users u where ${inIds('id')}`;
    const [fromMirror, toMirror] = await Promise.all([
      scalar<string>(src, mirror, [idList]),
      scalar<string>(tgt, mirror, [idList]),
    ]);
    if (fromMirror !== toMirror) failures.push('users:rows');

    accounts = { count: ids.length, passwords };
  });

  // 4. Storage, through the ports.
  let storage: VerifyReport['storage'] = null;
  if (options.storage) {
    const [from, to] = await Promise.all([
      storageTotalsOf(options.storage.source, tenantId, options.storage.buckets),
      storageTotalsOf(options.storage.target, tenantId, options.storage.buckets),
    ]);
    storage = { source: from, target: to };
    if (from.objects !== to.objects || from.bytes !== to.bytes) failures.push('storage:totals');
  }

  // 5. The old origin must not occur anywhere in what was copied.
  const leftovers = options.oldOrigin
    ? await scanForOrigin(
        target.sql,
        [...plan.tables.map((table) => table.name), 'tenants'],
        options.oldOrigin,
        tenantId,
      )
    : [];

  const report: VerifyReport = {
    ok: failures.length === 0 && leftovers.length === 0,
    tables,
    failures,
    accounts,
    storage,
    leftovers,
  };
  if (failures.length > 0) throw new MoveError('verify_failed', failures, report);
  if (leftovers.length > 0) {
    throw new MoveError(
      'origin_leftover',
      leftovers.map((entry) => `${entry.table}.${entry.column}`),
      report,
    );
  }
  return report;
}
