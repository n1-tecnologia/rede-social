import { SELF_REF_ORDER } from './fk-order';
import { assertCoverage } from './plan';
import { rewriteStorageOrigins } from './rewrite';
import {
  type CopyReport,
  type CopyTableReport,
  type Db,
  MoveError,
  type MovePlan,
  type MoveSide,
  publicTable,
  quoteIdent,
  run,
} from './types';

/**
 * The row copy (09.2-22, D-534 step 3, RESEARCH Pitfall 8).
 *
 * One TARGET transaction per group of the catalog-derived order; the source is read inside ONE `repeatable
 * read, read only` transaction, so every table comes from the same snapshot and nothing here can write to it.
 * Rows are read as `to_jsonb(t)::text` and joined into a JSON array WITHOUT being parsed in JavaScript (a
 * bigint or a long numeric must not pass through a double), then inserted through `jsonb_populate_recordset`
 * so jsonb, arrays and every other type survive, in batches of 500, with `on conflict do nothing`: a re-run
 * after a crash resumes, and a second run never doubles a count.
 *
 * Triggers. Counters, signals and guards (`feed_comments_count`, `chat_messages_signal_trg`,
 * `member_profiles_from_membership`, `chat_messages_seq_trg`, ...) must NOT fire on a copy: they would double
 * counts, assign new sequence numbers, broadcast to Realtime and create profile rows ahead of the real ones.
 * The user triggers of each table in the group are disabled with `alter table ... disable trigger user` and
 * enabled again before the group commits; both are transactional DDL, so a failed group restores them by
 * rolling back. Foreign keys stay enforced (that is why `session_replication_role = replica` is not used).
 *
 * A group of more than one table is a deferrable cycle (`events` <-> `event_secrets`): it is copied under
 * `set constraints all deferred`. A table in `SELF_REF_ORDER` (`feed_comments`) is read parent-first.
 */

/** Rows per insert. */
export const COPY_BATCH_SIZE = 500;

export type CopyOptions = {
  /** Replace this origin by that one in the public branding URLs of `tenants.branding` (D-534 step 6). */
  origins?: { from: string; to: string };
  /** Called after each group COMMITS, with its tables. A hook that throws stops the run there (resume tests). */
  afterGroup?: (info: { index: number; tables: string[] }) => void | Promise<void>;
  batchSize?: number;
};

const columnList = (names: readonly string[]): string => names.map(quoteIdent).join(', ');

/**
 * Non-generated columns, the only ones an insert may name (a generated column is flagged by
 * `pg_attribute.attgenerated` in `introspectTables`; inserting into one is an error).
 */
function insertableColumns(plan: MovePlan, table: string): string[] {
  const info = plan.info[table];
  if (!info) throw new MoveError('uncovered_tables', [table]);
  return info.columns.filter((column) => !column.generated).map((column) => column.name);
}

/** `order by` of the read: the self-reference column first, then the key (or the physical order). */
function orderBy(plan: MovePlan, table: string): string {
  const info = plan.info[table];
  const rule = SELF_REF_ORDER[table];
  const keys = info && info.pk.length > 0 ? info.pk.map(quoteIdent) : ['ctid'];
  return [...(rule ? [`${quoteIdent(rule)} asc nulls first`] : []), ...keys].join(', ');
}

/**
 * Reads the tenant's rows of `table` in batches of at most `size` JSON documents, each already joined as the
 * text of one JSON array.
 */
async function* batchesOf(
  source: Db,
  plan: MovePlan,
  table: string,
  tenantId: string,
  size: number,
): AsyncGenerator<{ json: string; rows: number }> {
  const query = `select to_jsonb(t)::text as j from ${publicTable(table)} t
                  where tenant_id = $1::uuid order by ${orderBy(plan, table)}`;
  const cursor = source.unsafe(query, [tenantId] as never[]).cursor(size);
  for await (const rows of cursor) {
    const documents = (rows as unknown as { j: string }[]).map((row) => row.j);
    if (documents.length > 0) yield { json: `[${documents.join(',')}]`, rows: documents.length };
  }
}

async function copyTable(
  source: Db,
  target: Db,
  plan: MovePlan,
  table: string,
  size: number,
): Promise<CopyTableReport> {
  const columns = columnList(insertableColumns(plan, table));
  const statement = `insert into ${publicTable(table)} (${columns})
                     select ${columns} from jsonb_populate_recordset(null::${publicTable(table)}, $1::text::jsonb)
                     on conflict do nothing`;
  let read = 0;
  let inserted = 0;
  for await (const batch of batchesOf(source, plan, table, plan.tenantId, size)) {
    const result = await target.unsafe(statement, [batch.json] as never[]);
    read += batch.rows;
    inserted += result.count;
  }
  return { name: table, read, inserted };
}

/**
 * The two mirrored tables: the row `bootstrap` created in the target takes `branding`, `rules_text` and
 * `rules_version` from the source (same id), and `tenant_modules.settings` is copied by `(tenant_id,
 * module_key)`. `enabled` stays the bootstrap's and the mirror's.
 */
async function copySpecial(
  source: Db,
  target: Db,
  tenantId: string,
  origins: CopyOptions['origins'],
): Promise<{ tenantUpdated: boolean; modulesUpdated: number }> {
  const [row] = await run<{ j: string }>(
    source,
    'select to_jsonb(t)::text as j from public.tenants t where id = $1::uuid',
    [tenantId],
  );
  if (!row) throw new MoveError('tenant_not_found');
  const tenant = JSON.parse(row.j) as {
    branding: unknown;
    rules_text: string;
    rules_version: number;
  };
  const branding = origins
    ? rewriteStorageOrigins(tenant.branding, origins.from, origins.to)
    : tenant.branding;
  const updated = await target.unsafe(
    `update public.tenants set branding = $2::text::jsonb, rules_text = $3, rules_version = $4::int
      where id = $1::uuid`,
    [tenantId, JSON.stringify(branding), tenant.rules_text, tenant.rules_version] as never[],
  );
  // The bootstrap seeds this row (its `tenant` step): without it there is nothing to attach the rows to.
  if (updated.count !== 1) throw new MoveError('target_not_ready', ['tenants']);

  const [modules] = await run<{ j: string }>(
    source,
    `select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb)::text as j
       from public.tenant_modules m where m.tenant_id = $1::uuid`,
    [tenantId],
  );
  const settings = await target.unsafe(
    `update public.tenant_modules t set settings = s.settings
       from jsonb_populate_recordset(null::public.tenant_modules, $1::text::jsonb) s
      where t.tenant_id = s.tenant_id and t.module_key = s.module_key`,
    [modules?.j ?? '[]'] as never[],
  );
  return { tenantUpdated: true, modulesUpdated: settings.count };
}

/**
 * Copies the tenant's rows from `source` to `target` in the plan's order. Run `copyAuth` first: rows reference
 * `public.users`. The plan is checked again here (`assertCoverage`), so an uncovered table can never be
 * skipped by a caller that forgot to.
 */
export async function copyRows(
  plan: MovePlan,
  source: MoveSide,
  target: MoveSide,
  options: CopyOptions = {},
): Promise<CopyReport> {
  assertCoverage(plan);
  if (source.tenantId !== plan.tenantId || target.tenantId !== plan.tenantId) {
    throw new MoveError('schema_mismatch', ['tenant']);
  }
  const size = options.batchSize ?? COPY_BATCH_SIZE;
  const tables: CopyTableReport[] = [];
  let special = { tenantUpdated: false, modulesUpdated: 0 };

  await source.sql.begin('isolation level repeatable read read only', async (src) => {
    special = await target.sql.begin((tgt) =>
      copySpecial(src, tgt, plan.tenantId, options.origins),
    );

    for (const [index, group] of plan.groups.entries()) {
      const done = await target.sql.begin(async (tgt) => {
        if (group.length > 1) await tgt.unsafe('set constraints all deferred');
        const silenced = group.filter((table) => plan.info[table]?.userTriggers);
        for (const table of silenced) {
          await tgt.unsafe(`alter table ${publicTable(table)} disable trigger user`);
        }
        const reports: CopyTableReport[] = [];
        for (const table of group) reports.push(await copyTable(src, tgt, plan, table, size));
        for (const table of silenced) {
          await tgt.unsafe(`alter table ${publicTable(table)} enable trigger user`);
        }
        return reports;
      });
      tables.push(...done);
      await options.afterGroup?.({ index, tables: [...group] });
    }
  });

  return { tables, groups: plan.groups.length, ...special };
}
