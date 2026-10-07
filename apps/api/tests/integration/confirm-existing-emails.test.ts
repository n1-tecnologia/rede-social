import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, authAdmin, removeIdentitiesByPrefix } from './setup';

/**
 * quick 261007-gzu, request (2): the one-time backfill that confirms accounts created before the
 * sign-up confirmation code existed. This suite does not copy the statement: it reads the SHIPPED
 * migration file from `supabase/migrations` and executes its text against the live local database, so
 * what is tested is exactly what a deploy would run.
 *
 * Four fixture identities, forced with FIXED instants (never the wall clock):
 *   legacy     unconfirmed, created long before the cutoff, never invited   -> becomes confirmed
 *   invited    unconfirmed, created before the cutoff, `invited_at` set      -> untouched
 *   pending    unconfirmed, created AFTER the cutoff (a real pending sign-up) -> untouched
 *   confirmed  already confirmed at a fixed instant                           -> untouched
 * Then a second run changes nothing (idempotent). The file may run while other suites hold their own
 * unconfirmed or invited users: those are newer than the cutoff or invited, so it cannot disturb them.
 */

const PREFIX = 'confirm-backfill';
const RUN = crypto.randomUUID().slice(0, 8);
const OLD = '2026-09-01 10:00:00+00';
const AFTER_CUTOFF = '2026-10-07 15:00:00+00';
const CONFIRMED_AT = '2026-09-02 12:00:00+00';

const MIGRATIONS = join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations');

function shippedMigration(): string {
  const files = readdirSync(MIGRATIONS).filter((f) =>
    f.endsWith('_confirm_existing_auth_emails.sql'),
  );
  if (files.length !== 1) {
    throw new Error(
      `expected exactly one *_confirm_existing_auth_emails.sql, found ${files.length}`,
    );
  }
  return readFileSync(join(MIGRATIONS, files[0] as string), 'utf8');
}

type Fixture = { id: string; email: string };
const fx: Record<'legacy' | 'invited' | 'pending' | 'confirmed', Fixture> = {
  legacy: { id: '', email: '' },
  invited: { id: '', email: '' },
  pending: { id: '', email: '' },
  confirmed: { id: '', email: '' },
};

async function createIdentity(label: keyof typeof fx, confirm: boolean): Promise<Fixture> {
  const email = `${PREFIX}-${RUN}-${label}@rede-demo.local`;
  const { data, error } = await authAdmin().createUser({
    email,
    password: `Backfill-${RUN}-senha!`,
    email_confirm: confirm,
  });
  if (error || !data.user) throw new Error(`createUser failed for ${email}: ${error?.message}`);
  return { id: data.user.id, email };
}

type Snapshot = { email_confirmed_at: string | null; confirmed_at: string | null };
async function snapshot(id: string): Promise<Snapshot> {
  const [row] = await adminSql<Snapshot[]>`
    select email_confirmed_at::text, confirmed_at::text from auth.users where id = ${id}::uuid`;
  if (!row) throw new Error(`identity ${id} vanished`);
  return row;
}

async function all(): Promise<Record<keyof typeof fx, Snapshot>> {
  return {
    legacy: await snapshot(fx.legacy.id),
    invited: await snapshot(fx.invited.id),
    pending: await snapshot(fx.pending.id),
    confirmed: await snapshot(fx.confirmed.id),
  };
}

beforeAll(async () => {
  await removeIdentitiesByPrefix(PREFIX);
  fx.legacy = await createIdentity('legacy', false);
  fx.invited = await createIdentity('invited', false);
  fx.pending = await createIdentity('pending', false);
  fx.confirmed = await createIdentity('confirmed', true);

  await adminSql`
    update auth.users set created_at = ${OLD}::timestamptz, email_confirmed_at = null, invited_at = null
     where id = ${fx.legacy.id}::uuid`;
  await adminSql`
    update auth.users set created_at = ${OLD}::timestamptz, email_confirmed_at = null,
           invited_at = ${OLD}::timestamptz
     where id = ${fx.invited.id}::uuid`;
  await adminSql`
    update auth.users set created_at = ${AFTER_CUTOFF}::timestamptz, email_confirmed_at = null,
           invited_at = null
     where id = ${fx.pending.id}::uuid`;
  await adminSql`
    update auth.users set created_at = ${OLD}::timestamptz,
           email_confirmed_at = ${CONFIRMED_AT}::timestamptz
     where id = ${fx.confirmed.id}::uuid`;
});

afterAll(async () => {
  await removeIdentitiesByPrefix(PREFIX);
  await adminSql.end();
});

describe('confirm_existing_auth_emails (the shipped migration file)', () => {
  it('confirms only the legacy, non-invited, pre-cutoff account', async () => {
    const before = await all();
    expect(before.legacy.email_confirmed_at).toBeNull();
    expect(before.legacy.confirmed_at).toBeNull();

    await adminSql.unsafe(shippedMigration());

    const after = await all();
    expect(after.legacy.email_confirmed_at).not.toBeNull();
    expect(after.legacy.confirmed_at).not.toBeNull();
    // Invited, post-cutoff pending sign-up: still unconfirmed.
    expect(after.invited).toEqual(before.invited);
    expect(after.invited.email_confirmed_at).toBeNull();
    expect(after.pending).toEqual(before.pending);
    expect(after.pending.email_confirmed_at).toBeNull();
    // Already confirmed: the instant is exactly what it was.
    expect(after.confirmed).toEqual(before.confirmed);
    expect(after.confirmed.email_confirmed_at).not.toBeNull();
  });

  it('is idempotent: a second run changes nothing, for all four', async () => {
    const before = await all();
    await adminSql.unsafe(shippedMigration());
    expect(await all()).toEqual(before);
    await adminSql.unsafe(shippedMigration());
    expect(await all()).toEqual(before);
  });
});
