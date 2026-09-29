import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

export { app as api } from '../../src/app';

/** Seed tenants' hosts (D-24), same defaults as scripts/seed.ts. */
export const HOSTS = {
  demo: process.env.TENANT_DEMO_HOST ?? 'rede-demo.localhost',
  lab: process.env.TENANT_LAB_HOST ?? 'rede-lab.localhost',
};

export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? '';

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is required for integration tests (see scripts/local-env.sh)`);
  return value;
}

/** Real GoTrue session for a seeded user: the token the API verifies against the local JWKS. */
export async function signInAs(email: string, password: string): Promise<string> {
  const client = createClient(required('SUPABASE_URL'), required('SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session)
    throw new Error(`signInWithPassword failed for ${email}: ${error?.message}`);
  return data.session.access_token;
}

/**
 * GoTrue admin API for throwaway fixtures (service key). Built here on purpose instead of importing
 * `@rede-social/core/server/supabase-admin`, which Biome restricts to the kernel's admin lane.
 */
export function authAdmin() {
  return createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.admin;
}

/** Superuser-ish connection for fixtures only (never used by application code). */
export const adminSql = postgres('postgres://postgres:postgres@127.0.0.1:54322/postgres', {
  prepare: false,
  max: 1,
});

/**
 * A REAL image asset for the given session, through the 03-01 broker end to end: `start` mints the
 * signed target, the bytes go STRAIGHT to Storage (never through the API), `complete` decodes the
 * header, and the worker handler derives the WebP ladder so the row reaches `ready`. Returns the
 * `media_assets` id, which is what `PATCH /v1/me/profile { avatarAssetId }` takes (03-02).
 *
 * `purpose` is a parameter so a test can build the NEGATIVE fixture the avatar gate exists for — an
 * otherwise perfectly valid `post` image, which the profile must still refuse.
 *
 * The heavy kernel imports (`sharp` through `variants`, pg-boss through `derive-job`) are loaded
 * INSIDE the function on purpose: `setup.ts` is imported by every integration file, including
 * `health-no-db.ts`, and none of them should pay for the media stack just to reach `api`/`adminSql`.
 */
export async function uploadAvatar(
  token: string,
  opts: { purpose?: 'avatar' | 'post'; bytes?: Buffer } = {},
): Promise<string> {
  const { app } = await import('../../src/app');
  const { encodeJpeg } = await import('@rede-social/core/server/media/variants');
  const { deriveVariantsJob } = await import('@rede-social/core/server/media/derive-job');

  const body =
    opts.bytes ??
    (await encodeJpeg(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"><rect width="640" height="640" fill="#7c3aed"/><circle cx="320" cy="320" r="200" fill="#fde68a"/></svg>`,
      ),
    ));

  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const started = await app.request('/v1/media/uploads', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      kind: 'image',
      purpose: opts.purpose ?? 'avatar',
      mime: 'image/jpeg',
      size: body.length,
      filename: 'foto.jpg',
    }),
  });
  if (started.status !== 201) throw new Error(`start failed: ${started.status}`);
  const target = (await started.json()) as { assetId: string; signedUrl: string };

  const put = await fetch(target.signedUrl, {
    method: 'PUT',
    body: new Uint8Array(body),
    headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' },
  });
  if (!put.ok) throw new Error(`PUT to Storage failed: ${put.status}`);

  const completed = await app.request(`/v1/media/uploads/${target.assetId}/complete`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  if (completed.status !== 200) throw new Error(`complete failed: ${completed.status}`);

  const [row] = await adminSql<
    { tenant_id: string }[]
  >`select tenant_id from public.media_assets where id = ${target.assetId}::uuid`;
  if (!row) throw new Error('the asset row disappeared after complete');
  await deriveVariantsJob.handler({ tenantId: row.tenant_id, assetId: target.assetId, attempt: 0 });

  return target.assetId;
}

/** One `kernel.invite-send` row as the integration suites assert it (quick 260929-g0s). */
export type InviteSendJobRow = {
  id: string;
  state: string;
  singleton_key: string | null;
  start_after: Date;
  retry_limit: number;
  retry_backoff: boolean;
  data: Record<string, unknown>;
};

/** Every `kernel.invite-send` job scheduled for `tenantId`, oldest first (any state). */
export async function inviteSendJobsOf(tenantId: string): Promise<InviteSendJobRow[]> {
  return adminSql<InviteSendJobRow[]>`
    select id, state::text as state, singleton_key, start_after, retry_limit, retry_backoff, data
      from pgboss.job_common
     where name = 'kernel.invite-send' and data->>'tenantId' = ${tenantId}
     order by created_on`;
}

/**
 * Plays the worker for `tenantId`'s waiting `kernel.invite-send` jobs, ignoring `start_after`: each
 * `created` row's payload goes through the real `inviteSendJob.handler` (errors propagate, the row
 * stays `created`), and a row whose handler resolved is marked `completed` like `boss.work` would —
 * so a later verify can schedule the same invite again. The kernel job is imported INSIDE the
 * function (this file's "heavy kernel imports" rule). Returns how many handlers ran.
 */
export async function runInviteSendJobs(tenantId: string): Promise<number> {
  const { inviteSendJob } = await import('@rede-social/core/server/platform/invite-send-job');
  const rows = (await inviteSendJobsOf(tenantId)).filter((row) => row.state === 'created');
  for (const row of rows) {
    await inviteSendJob.handler(row.data as { tenantId: string; inviteId: string });
    await adminSql`
      update pgboss.job_common set state = 'completed', completed_on = now()
       where name = 'kernel.invite-send' and id = ${row.id}::uuid`;
  }
  return rows.length;
}
