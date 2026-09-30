import postgres from 'postgres';
import { envValue } from './admin';
import { hosts, SEED_PASSWORD } from './fixtures';

/**
 * Fixtures for the Notificações e2e specs (07-01), the `events-admin.ts` shape: identity through
 * GoTrue, rows through a direct superuser connection.
 *
 * `publishPostAs` publishes through the REAL API (`POST /v1/feed/posts` with the admin's own
 * session), not through a row insert: the tracer must cross the bus, the sink and the fan-out job
 * exactly as a composer publish does. `feed-admin.ts` has no publish helper and the composer flow is
 * `feed-composer.spec.ts`'s own subject, so the API call is the narrowest honest producer.
 */

const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 4 },
  );
  return client;
}

/** Release the fixture connection (call from `test.afterAll` so Playwright can exit). */
export async function closeNotificationsAdmin(): Promise<void> {
  await client?.end();
  client = null;
}

/** The host the API resolves the demo tenant from (the same one the browser navigates). */
export const demoHost = new URL(hosts.demo).hostname;

async function accessToken(email: string, password: string): Promise<string> {
  const session = await fetch(`${envValue('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: envValue('SUPABASE_PUBLISHABLE_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!session.ok) throw new Error(`${email} sign-in failed: ${session.status}`);
  return ((await session.json()) as { access_token: string }).access_token;
}

/** Publishes a text post as `email` on `host` through the real API; returns the post id. */
export async function publishPostAs(
  email: string,
  caption: string,
  host = demoHost,
  password = SEED_PASSWORD,
): Promise<string> {
  const token = await accessToken(email, password);
  const res = await fetch(`${API_URL}/v1/feed/posts`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': host,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ caption }),
  });
  if (res.status !== 201) {
    throw new Error(`POST /v1/feed/posts as ${email}: ${res.status} ${await res.text()}`);
  }
  return ((await res.json()) as { id: string }).id;
}

/** Deletes every notification row of `tenantSlug` (the bell starts from zero). */
export async function clearNotifications(tenantSlug: string): Promise<void> {
  await sql()`
    delete from public.notifications
     where tenant_id in (select id from public.tenants where slug = ${tenantSlug})`;
}

/** Deletes the posts this spec wrote, by caption prefix, and the rows pointing at them. */
export async function deletePostsByCaptionPrefix(prefix: string): Promise<void> {
  await sql()`
    delete from public.notifications
     where subject_type = 'post'
       and subject_id in (select id from public.feed_posts where caption like ${`${prefix}%`})`;
  await sql()`delete from public.feed_posts where caption like ${`${prefix}%`}`;
}
