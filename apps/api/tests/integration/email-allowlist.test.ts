import { ALLOWLIST_REJECTION_MESSAGE, isAllowlistRejection } from '@rede-social/contracts';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  allowEmail,
  api,
  authAdmin,
  createSharedIdentity,
  disallowEmail,
  removeIdentitiesByPrefix,
  SEED_PASSWORD,
} from './setup';

/**
 * Quick 261018-owq: the global e-mail allowlist against REAL GoTrue. Both hooks are enabled on the
 * local stack (`supabase/config.toml`), so what runs here is the production call path:
 *
 *   1-8   the two Postgres hooks, called by GoTrue itself (password, refresh, verifyOtp, invite,
 *         generateLink) through a publishable-key client built like `signInAs`.
 *
 * pgTAP 175 pins the SQL literal and the function facts; this suite compares the contracts constant
 * with GoTrue's real error, so the three stay in lockstep.
 */

const PREFIX = 'owq';
const RUN = crypto.randomUUID().slice(0, 8);
const email = (name: string) => `${PREFIX}-${RUN}-${name}@rede-demo.local`;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for integration tests`);
  return value;
}

const publicClient = () =>
  createClient(required('SUPABASE_URL'), required('SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const decodePayload = (jwt: string) =>
  JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;

const authUsersCount = async (address: string) => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from auth.users where email = ${address}`;
  return row?.n ?? 0;
};

/** A throwaway identity with one seed-host membership, listed (createUser lists it). */
const identity = (name: string) =>
  createSharedIdentity({ prefix: `${PREFIX}-${RUN}-${name}`, memberships: [{ host: 'demo' }] });

beforeAll(async () => {
  await removeIdentitiesByPrefix(PREFIX);
});

afterAll(async () => {
  await removeIdentitiesByPrefix(PREFIX);
  await adminSql.end();
});

describe('token issuance through real GoTrue (custom_access_token hook)', () => {
  it('1. a listed identity signs in, its token keeps the required claims and the API accepts it', async () => {
    const who = await identity('listed');
    const { data, error } = await publicClient().auth.signInWithPassword({
      email: who.email,
      password: who.password,
    });
    expect(error).toBeNull();
    const token = data.session?.access_token ?? '';
    const payload = decodePayload(token);
    for (const claim of ['sub', 'email', 'role', 'aal', 'session_id', 'is_anonymous']) {
      expect(payload, `claim ${claim}`).toHaveProperty(claim);
    }
    const res = await api.request('/v1/me/bootstrap', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('2. after disallowEmail the sign-in is refused with 403 and the sentinel', async () => {
    const who = await identity('gone');
    await disallowEmail(who.email);
    const { data, error } = await publicClient().auth.signInWithPassword({
      email: who.email,
      password: who.password,
    });
    expect(data.session).toBeNull();
    expect(error?.status).toBe(403);
    expect(error?.message).toBe(ALLOWLIST_REJECTION_MESSAGE);
    expect(isAllowlistRejection(error)).toBe(true);
  });

  it('3. a bloqueado e-mail is refused the same way', async () => {
    const who = await identity('blocked');
    await allowEmail(who.email, 'bloqueado');
    const { error } = await publicClient().auth.signInWithPassword({
      email: who.email,
      password: who.password,
    });
    expect(error?.status).toBe(403);
    expect(isAllowlistRejection(error)).toBe(true);
  });

  it('4. a padded, mixed-case list row matches the identity created in lowercase', async () => {
    const who = await identity('case');
    await disallowEmail(who.email);
    await allowEmail(`  ${who.email.toUpperCase()} `);
    const { data, error } = await publicClient().auth.signInWithPassword({
      email: who.email,
      password: who.password,
    });
    expect(error).toBeNull();
    expect(data.session).not.toBeNull();
  });

  it('5. a refresh is refused once the e-mail turns bloqueado', async () => {
    const who = await identity('refresh');
    const client = publicClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: who.email,
      password: who.password,
    });
    expect(error).toBeNull();
    await allowEmail(who.email, 'bloqueado');
    const refreshed = await client.auth.refreshSession({
      refresh_token: data.session?.refresh_token ?? '',
    });
    expect(refreshed.data.session).toBeNull();
    expect(refreshed.error?.status).toBe(403);
    expect(isAllowlistRejection(refreshed.error)).toBe(true);
  });

  it('6. a platform_admins identity with no list row still signs in (super_admin exempt)', async () => {
    const who = await identity('super');
    await adminSql`insert into public.platform_admins (user_id) values (${who.userId}::uuid)`;
    await disallowEmail(who.email);
    const { data, error } = await publicClient().auth.signInWithPassword({
      email: who.email,
      password: who.password,
    });
    expect(error).toBeNull();
    expect(data.session).not.toBeNull();
  });

  it('7. a refused verifyOtp is rolled back: the SAME recovery hash works once the e-mail is listed', async () => {
    const who = await identity('otp');
    await disallowEmail(who.email);
    const link = await authAdmin().generateLink({ type: 'recovery', email: who.email });
    expect(link.error).toBeNull();
    const hash = link.data.properties?.hashed_token ?? '';
    expect(hash).not.toBe('');

    const refused = await publicClient().auth.verifyOtp({ type: 'recovery', token_hash: hash });
    expect(refused.data.session).toBeNull();
    expect(refused.error?.status).toBe(403);
    expect(isAllowlistRejection(refused.error)).toBe(true);

    await allowEmail(who.email);
    const accepted = await publicClient().auth.verifyOtp({ type: 'recovery', token_hash: hash });
    expect(accepted.error).toBeNull();
    expect(accepted.data.session).not.toBeNull();
  });
});

describe('account creation through GoTrue (before_user_created hook)', () => {
  it('8. inviteUserByEmail and generateLink(signup) for an unlisted address are refused and create nothing', async () => {
    const unlisted = email('invite');
    const invited = await authAdmin().inviteUserByEmail(unlisted);
    expect(invited.error?.status).toBe(403);
    expect(isAllowlistRejection(invited.error)).toBe(true);

    const signup = await authAdmin().generateLink({
      type: 'signup',
      email: unlisted,
      password: SEED_PASSWORD,
    });
    expect(signup.error?.status).toBe(403);
    expect(isAllowlistRejection(signup.error)).toBe(true);
    expect(await authUsersCount(unlisted)).toBe(0);

    await allowEmail(unlisted);
    const accepted = await authAdmin().inviteUserByEmail(unlisted);
    expect(accepted.error).toBeNull();
    expect(accepted.data.user?.email).toBe(unlisted);
    if (accepted.data.user) await authAdmin().deleteUser(accepted.data.user.id);
  });
});
