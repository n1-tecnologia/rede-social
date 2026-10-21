import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sqlClient } from '@rede-social/core/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  createSharedIdentity,
  disallowEmail,
  removeIdentitiesByPrefix,
  setPaymentsRow,
} from './setup';

/**
 * 09.1-18 (PAY-28, WR-01, P66): `docs/deploy/payments-hooks-lockout.sql`, the read-only report the owner
 * runs in the Supabase SQL editor BEFORE enabling the production Auth hooks. It calls the REAL token hook
 * `public.hook_custom_access_token_allowlist` once per account and lists the accounts it would refuse
 * (`locked_out`) plus the tenants whose payment gate is on (`gate_on`). This suite runs the committed
 * file, unchanged, against the local seeded database:
 *
 *   09.1 tracer  the report names nobody the hook admits (seeded accounts, staff, a member of an ungated
 *                tenant, a member with a manual release) and names exactly the throwaway member who has
 *                no access row and no other door, with the gated tenant beside it.
 *   09.1 report  stable order across two runs, the empty set, an account counted once however many
 *                memberships it has, and the file being one read-only statement.
 */

const REPORT_PATH = fileURLToPath(
  new URL('../../../../docs/deploy/payments-hooks-lockout.sql', import.meta.url),
);
const REPORT_SQL = readFileSync(REPORT_PATH, 'utf8');

const PREFIX = 'plr';
const RUN = crypto.randomUUID().slice(0, 8);
const GATED_SLUG = `plr-gated-${RUN}`;
const GATED_TWIN_SLUG = `plr-twin-${RUN}`;
const SUPER_ADMIN_EMAIL = (
  process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test'
).toLowerCase();

type ReportRow = { finding: string; ref: string; detail: string };

/** Runs the committed file exactly as the SQL editor would, through the owner connection. */
const runReport = async (): Promise<ReportRow[]> =>
  [...(await adminSql.unsafe<ReportRow[]>(REPORT_SQL))].map((row) => ({
    finding: row.finding,
    ref: row.ref,
    detail: row.detail,
  }));

const lockedOut = (rows: ReportRow[]) => rows.filter((row) => row.finding === 'locked_out');
const gateOn = (rows: ReportRow[]) => rows.filter((row) => row.finding === 'gate_on');

/** The statement without its trailing semicolon, so it can sit inside a sub-select. */
const statement = () => REPORT_SQL.trim().replace(/;\s*$/, '');

const tenantIdOf = async (slug: string): Promise<string> => {
  const [row] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = ${slug}`;
  if (!row) throw new Error(`no tenant ${slug}`);
  return row.id;
};

/** A throwaway identity with NO manual access anywhere (createUser grants one in rede-demo; undone here). */
async function bareIdentity(
  name: string,
  memberships: Parameters<typeof createSharedIdentity>[0]['memberships'],
) {
  const who = await createSharedIdentity({ prefix: `${PREFIX}-${RUN}-${name}`, memberships });
  await disallowEmail(who.email);
  return who;
}

async function dropThrowawayTenants(): Promise<void> {
  await adminSql`
    delete from public.memberships where tenant_id in
      (select id from public.tenants where slug like 'plr-%')`;
  await adminSql`delete from public.tenants where slug like 'plr-%'`;
}

let gatedId = '';
let twinId = '';

beforeAll(async () => {
  await removeIdentitiesByPrefix(PREFIX);
  await dropThrowawayTenants();
  for (const slug of [GATED_SLUG, GATED_TWIN_SLUG]) {
    await adminSql`
      insert into public.tenants (slug, display_name, rules_text, rules_version)
      values (${slug}, 'Relatorio 9118', 'Regras de teste.', 1)`;
  }
  gatedId = await tenantIdOf(GATED_SLUG);
  twinId = await tenantIdOf(GATED_TWIN_SLUG);
});

afterAll(async () => {
  await removeIdentitiesByPrefix(PREFIX);
  await dropThrowawayTenants();
  await adminSql.end();
  await sqlClient.end();
});

describe('09.1 tracer', () => {
  it('lists nobody the hook admits while every seeded tenant is ungated', async () => {
    const rows = await runReport();
    const seeded = lockedOut(rows).filter(
      (row) =>
        row.detail.toLowerCase() === SUPER_ADMIN_EMAIL ||
        /^[a-z.]+@rede-(demo|lab)\.local$/.test(row.detail),
    );
    expect(seeded, 'a seeded account the real hook would refuse').toEqual([]);
    const seededTenants = gateOn(rows).filter((row) => /^rede-(demo|lab)$/.test(row.detail));
    expect(seededTenants).toEqual([]);
  });

  it('with the gate on it lists the member with no door, the tenant, and nobody the hook admits', async () => {
    const stranded = await bareIdentity('stranded', [{ tenantSlug: GATED_SLUG }]);
    const released = await bareIdentity('released', [{ tenantSlug: GATED_SLUG }]);
    const elsewhere = await bareIdentity('elsewhere', [
      { tenantSlug: GATED_SLUG },
      { host: 'demo' },
    ]);
    const staff = await bareIdentity('staff', [{ tenantSlug: GATED_SLUG, role: 'admin_tenant' }]);
    await adminSql`
      insert into public.access_grants (tenant_id, email, source, status)
      values (${gatedId}::uuid, ${released.email}, 'manual', 'active')`;

    await setPaymentsRow(gatedId, { enabled: true, settings: { gate: true } });
    const rows = await runReport();

    const mine = lockedOut(rows).filter((row) => row.detail.startsWith(`${PREFIX}-${RUN}-`));
    expect(mine).toEqual([{ finding: 'locked_out', ref: stranded.userId, detail: stranded.email }]);
    expect(gateOn(rows).filter((row) => row.ref === gatedId)).toEqual([
      { finding: 'gate_on', ref: gatedId, detail: GATED_SLUG },
    ]);
    // The refusals the report names are the ones the real function gives, nobody else's.
    for (const who of [released, elsewhere, staff]) {
      expect(rows.some((row) => row.ref === who.userId)).toBe(false);
    }
  });

  it('a manual release removes the member from the list', async () => {
    const [victim] = lockedOut(await runReport()).filter((row) =>
      row.detail.startsWith(`${PREFIX}-${RUN}-stranded`),
    );
    expect(victim).toBeDefined();
    await adminSql`
      insert into public.access_grants (tenant_id, email, source, status)
      values (${gatedId}::uuid, ${victim?.detail ?? ''}, 'manual', 'active')`;
    const after = lockedOut(await runReport()).filter((row) =>
      row.detail.startsWith(`${PREFIX}-${RUN}-`),
    );
    expect(after).toEqual([]);
  });
});

describe('09.1 report', () => {
  it('prints the same rows in the same order on two runs, ordered by finding, detail, ref', async () => {
    const lonely = await bareIdentity('order-a', [{ tenantSlug: GATED_SLUG }]);
    const lonelier = await bareIdentity('order-b', [{ tenantSlug: GATED_SLUG }]);
    await setPaymentsRow(gatedId, { enabled: true, settings: { gate: true } });
    await setPaymentsRow(twinId, { enabled: true, settings: { gate: true } });

    const first = await runReport();
    const second = await runReport();
    expect(second).toEqual(first);
    for (const who of [lonely, lonelier]) {
      expect(lockedOut(first).some((row) => row.ref === who.userId)).toBe(true);
    }

    const ordered = await adminSql.unsafe<ReportRow[]>(
      `select finding, ref, detail from (${statement()}) report order by finding, detail, ref`,
    );
    expect([...ordered].map((row) => ({ ...row }))).toEqual(first);
    expect(first.findIndex((row) => row.finding === 'locked_out')).toBeGreaterThan(
      first.map((row) => row.finding).lastIndexOf('gate_on'),
    );
  });

  it('counts an account once however many memberships it has', async () => {
    const twice = await bareIdentity('twice', [
      { tenantSlug: GATED_SLUG },
      { tenantSlug: GATED_TWIN_SLUG },
    ]);
    await setPaymentsRow(gatedId, { enabled: true, settings: { gate: true } });
    await setPaymentsRow(twinId, { enabled: true, settings: { gate: true } });
    const mine = (await runReport()).filter((row) => row.ref === twice.userId);
    expect(mine).toHaveLength(1);
  });

  it('reads the gate the way the hook does: a lookalike value is not a gate, a disabled module is not a gate', async () => {
    await setPaymentsRow(gatedId, { enabled: true, settings: { gate: 'true' } });
    await setPaymentsRow(twinId, { enabled: false, settings: { gate: true } });
    const rows = await runReport();
    expect(gateOn(rows).filter((row) => [gatedId, twinId].includes(row.ref))).toEqual([]);
  });

  it('returns no rows, without an error, when no account and no tenant qualifies', async () => {
    const rows = await adminSql.unsafe<ReportRow[]>(
      `select * from (${statement()}) report where report.detail like 'no-such-detail-%'`,
    );
    expect(rows).toHaveLength(0);
    const shaped = await adminSql.unsafe(`select * from (${statement()}) report limit 0`);
    expect(shaped.columns.map((column) => column.name)).toEqual(['finding', 'ref', 'detail']);
  });

  it('changes nothing: the tables it reads keep their row counts', async () => {
    const counts = async () => {
      const [row] = await adminSql<{ users: number; grants: number; modules: number }[]>`
        select (select count(*) from auth.users)::int as users,
               (select count(*) from public.access_grants)::int as grants,
               (select count(*) from public.tenant_modules)::int as modules`;
      return row;
    };
    const before = await counts();
    await runReport();
    expect(await counts()).toEqual(before);
  });

  it('is one read-only statement: no write keyword outside comments', () => {
    const code = REPORT_SQL.replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    expect(code).not.toMatch(/\b(insert|update|delete|alter|drop|create|truncate)\b/i);
    expect(code.match(/;/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(code.trim().toLowerCase().startsWith('select')).toBe(true);
    expect(REPORT_SQL).toContain('hook_custom_access_token_allowlist');
  });
});
