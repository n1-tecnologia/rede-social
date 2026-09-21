import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

export { app as api } from '../../src/app';

/** Seed tenants' hosts (D-24), same defaults as scripts/seed.ts. */
export const HOSTS = {
  demo: process.env.TENANT_DEMO_HOST ?? 'tria-demo.localhost',
  lab: process.env.TENANT_LAB_HOST ?? 'tria-lab.localhost',
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
 * `@tria/core/server/supabase-admin`, which Biome restricts to the kernel's admin lane.
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
 * A REAL avatar asset for the given session, through the 03-01 broker end to end: `start` mints the
 * signed target, the bytes go STRAIGHT to Storage (never through the API), `complete` decodes the
 * header, and the worker handler derives the WebP ladder so the row reaches `ready`. Returns the
 * `media_assets` id, which is what `PATCH /v1/me/profile { avatarAssetId }` takes (03-02).
 *
 * The heavy kernel imports (`sharp` through `variants`, pg-boss through `derive-job`) are loaded
 * INSIDE the function on purpose: `setup.ts` is imported by every integration file, including
 * `health-no-db.ts`, and none of them should pay for the media stack just to reach `api`/`adminSql`.
 */
export async function uploadAvatar(token: string, bytes?: Buffer): Promise<string> {
  const { app } = await import('../../src/app');
  const { encodeJpeg } = await import('@tria/core/server/media/variants');
  const { deriveVariantsJob } = await import('@tria/core/server/media/derive-job');

  const body =
    bytes ??
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
      purpose: 'avatar',
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
