import type { Sql } from 'postgres';
import { openDdlSql } from '../ddl';
import { COPY_EXCLUSIONS, introspectTables, MOVE_BUCKETS, SPECIAL_TABLES } from './plan';
import { idsParam, publicTable, run } from './types';

/**
 * `pnpm platform:central-clean [--strict-empty]` (09.2-23, D-534, DBT-49, T-09.2-108): proves the CENTRAL
 * project ends up holding platform data only once tenants have moved out.
 *
 * It lists, per copy-set table of the central project in ASCENDING table name (the copy set is derived from
 * the catalog by the same function the move uses, so a table a later phase adds is covered), the rows whose
 * tenant is bound to ANOTHER project; the accounts of the central `auth.users` that are neither platform
 * admins nor members or invitees of a tenant still bound to the central project; and the Storage objects under
 * a moved tenant's key prefix. Counts and table names only: never a row, an address or a key.
 *
 * A tenant still bound to the central project is not residue, and a stack where no tenant has moved prints
 * zero (the account check is a consequence of a move, so it is skipped until one exists; `--strict-empty`
 * always runs it). `--strict-empty` additionally requires every table other than the mirror and the platform
 * tables to hold zero rows: the state after the LAST move, which the production runbook checks before
 * clearing `is_default`.
 *
 * The report is deterministic: tables in ascending name, accounts and objects as counts, so two runs over the
 * same state print the same bytes whatever the catalog order. Exit 0 when clean, 1 otherwise.
 */

/** The mirror and the platform tables: they stay in the central project by design. */
export const CENTRAL_KEEPS: readonly string[] = [
  'tenants',
  'tenant_modules',
  'tenant_domains',
  'platform_admins',
  'email_allowlist',
  // The profile mirror of the accounts that stay (platform admins), and the provider-event dedupe store.
  'users',
  'media_provider_events',
];

export type ResidueLine = Record<string, string | number | boolean>;

export type ResidueResult = { clean: boolean; exitCode: 0 | 1; lines: ResidueLine[] };

export type ResidueOptions = {
  strictEmpty?: boolean;
  /** Test seam: a ready connection to the central database. Default: `openDdlSql` on project 0, read only. */
  sql?: Sql;
};

const ascending = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export async function centralResidue(options: ResidueOptions = {}): Promise<ResidueResult> {
  const strict = options.strictEmpty === true;
  const owned = options.sql === undefined;
  const sql =
    options.sql ??
    openDdlSql(
      { id: 'central', isCentral: true, credentialSource: 'env', ddlUrlSealed: null },
      { readOnly: true },
    );
  try {
    return await sql.begin('isolation level repeatable read read only', async (tx) => {
      const lines: ResidueLine[] = [];
      const moved = (
        await run<{ id: string }>(
          tx,
          `select tp.tenant_id::text as id
             from platform.tenant_projects tp join platform.projects p on p.id = tp.project_id
            where not p.is_central order by 1`,
        )
      ).map((row) => row.id);
      const movedParam = idsParam(moved);

      // 1. Residual rows, per copy-set table, ascending.
      const tables = await introspectTables(tx);
      const copySet = tables
        .filter((t) => t.hasTenantId && !(t.name in COPY_EXCLUSIONS) && !(t.name in SPECIAL_TABLES))
        .map((t) => t.name)
        .sort(ascending);
      let rows = 0;
      for (const name of copySet) {
        if (moved.length === 0) break;
        const [row] = await run<{ n: number }>(
          tx,
          `select count(*)::int as n from ${publicTable(name)}
            where tenant_id in (select value::uuid from jsonb_array_elements_text($1::text::jsonb))`,
          [movedParam],
        );
        if ((row?.n ?? 0) > 0) {
          rows += row?.n ?? 0;
          lines.push({ kind: 'table', table: name, rows: row?.n ?? 0 });
        }
      }

      // 2. Accounts that are neither platform admins nor members or invitees of a tenant still in this project.
      let accounts = 0;
      if (moved.length > 0 || strict) {
        const [row] = await run<{ n: number }>(
          tx,
          `select count(*)::int as n from auth.users u
            where not exists (select 1 from public.platform_admins a where a.user_id = u.id)
              and not exists (
                    select 1 from public.memberships m
                      join platform.tenant_projects tp on tp.tenant_id = m.tenant_id
                      join platform.projects p on p.id = tp.project_id
                     where m.user_id = u.id and p.is_central)
              and not exists (
                    select 1 from public.tenant_invites i
                      join platform.tenant_projects tp on tp.tenant_id = i.tenant_id
                      join platform.projects p on p.id = tp.project_id
                     where i.user_id = u.id and p.is_central)`,
        );
        accounts = row?.n ?? 0;
      }

      // 3. Files under a moved tenant's prefix.
      let objects = 0;
      if (moved.length > 0) {
        const [row] = await run<{ n: number }>(
          tx,
          `select count(*)::int as n from storage.objects
            where bucket_id = any ($1::text[])
              and split_part(name, '/', 1) in (select value from jsonb_array_elements_text($2::text::jsonb))`,
          [`{${MOVE_BUCKETS.join(',')}}`, movedParam],
        );
        objects = row?.n ?? 0;
      }

      // 4. Strict: nothing but the mirror and the platform tables may hold a row.
      let strictRows = 0;
      if (strict) {
        for (const table of tables.map((t) => t.name).sort(ascending)) {
          if (CENTRAL_KEEPS.includes(table)) continue;
          const [row] = await run<{ n: number }>(
            tx,
            `select count(*)::int as n from ${publicTable(table)}`,
          );
          if ((row?.n ?? 0) > 0) {
            strictRows += row?.n ?? 0;
            lines.push({ kind: 'strict', table, rows: row?.n ?? 0 });
          }
        }
      }

      const clean = rows === 0 && accounts === 0 && objects === 0 && strictRows === 0;
      lines.push({
        kind: 'summary',
        clean,
        strictEmpty: strict,
        movedTenants: moved.length,
        tables: copySet.length,
        residualRows: rows,
        foreignAccounts: accounts,
        objects,
        strictRows,
      });
      return { clean, exitCode: clean ? 0 : 1, lines } as ResidueResult;
    });
  } finally {
    if (owned) await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}
