import postgres from 'postgres';
import { envValue } from './admin';
import { createThrowawayTenant, deleteTenantBySlug, throwawayOrigin } from './tenant-fixtures';

/**
 * Fixtures for the Eventos e2e specs (06-01), the `feed-admin.ts` shape.
 *
 * The seeded events are written long before any spec runs, so anything that depends on a WINDOW
 * (the check-in opening an hour before the start, RSVP closing at the start) cannot rely on them
 * (Pitfall 7: `page.clock` moves only the browser; the API and the database use real `now()`).
 * `insertEvent` therefore writes an event RELATIVE TO the database's `now()`, both halves in one
 * statement (the deferred keys are checked at its autocommit), and later plans use it for every
 * window-sensitive flow. `createEventsTenant` provisions a throwaway tenant with `events` on for the
 * flows that must not touch the seed.
 *
 * Identity goes through the GoTrue admin API and the rows through a direct superuser connection —
 * the same split `e2e/admin.ts` and `e2e/feed-admin.ts` use.
 */

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 4 },
  );
  return client;
}

/** Release the fixture connection (call from `test.afterAll` so Playwright can exit). */
export async function closeEventsAdmin(): Promise<void> {
  await client?.end();
  client = null;
}

function authHeaders(): Record<string, string> {
  const key = envValue('SUPABASE_SERVICE_KEY');
  return { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' };
}

async function createUser(email: string, password: string): Promise<string> {
  const res = await fetch(`${envValue('SUPABASE_URL')}/auth/v1/admin/users`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`createUser failed for ${email}: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

async function addMembership(
  tenantId: string,
  email: string,
  password: string,
  role: 'member' | 'admin_tenant',
  displayName: string,
): Promise<string> {
  const userId = await createUser(email, password);
  const rows = await sql()<{ id: string }[]>`
    insert into public.memberships (tenant_id, user_id, role, status)
    values (${tenantId}::uuid, ${userId}::uuid, ${role}, 'active')
    returning id`;
  const membershipId = rows[0]?.id;
  if (!membershipId) throw new Error(`could not create a membership for ${email}`);
  await sql()`
    update public.member_profiles
       set display_name = ${displayName}, updated_at = now()
     where membership_id = ${membershipId}::uuid`;
  return membershipId;
}

export type EventsTenant = {
  slug: string;
  origin: string;
  tenantId: string;
  adminEmail: string;
  memberEmail: string;
  password: string;
};

/** Provisions `slug` with `events` enabled, an admin, one member and zero events. Idempotent. */
export async function createEventsTenant(slug: string, password: string): Promise<EventsTenant> {
  await deleteEventsTenant(slug);

  const host = `${slug}.localhost`;
  const { id: tenantId } = await createThrowawayTenant({
    slug,
    displayName: `Comunidade ${slug}`,
    hosts: [{ host, primary: true, verified: true }],
    colors: { primary: '#2e6fd0', secondary: '#7aa7e8' },
  });
  await sql()`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenantId}::uuid, 'events', true)
    on conflict (tenant_id, module_key) do update set enabled = true`;

  const adminEmail = `admin@${slug}.local`;
  const memberEmail = `membro@${slug}.local`;
  await addMembership(tenantId, adminEmail, password, 'admin_tenant', 'Admin Eventos');
  await addMembership(tenantId, memberEmail, password, 'member', 'Membro Eventos');

  return { slug, origin: throwawayOrigin(host), tenantId, adminEmail, memberEmail, password };
}

/**
 * Removes the tenant, its memberships and its GoTrue users. 06-04: the admin spec uploads a real
 * cover, so the tenant also owns `media_assets` rows, whose tenant key does NOT cascade (and which
 * `events.cover_asset_id` references): the events go first, then the assets, then the tenant. The
 * users are found by membership AND by the fixture's `@<slug>.local` domain, so a teardown that was
 * interrupted after the memberships were gone still removes them. The uploaded bytes stay in the
 * local Storage bucket (a few hundred bytes per run; no row points at them).
 */
export async function deleteEventsTenant(slug: string): Promise<void> {
  const users = await sql()<{ user_id: string }[]>`
    select m.user_id from public.memberships m
      join public.tenants t on t.id = m.tenant_id
     where t.slug = ${slug}
    union
    select u.id as user_id from auth.users u where u.email like ${`%@${slug}.local`}`;
  await sql()`
    delete from public.events
     where tenant_id = (select id from public.tenants where slug = ${slug})`;
  await sql()`
    delete from public.media_assets
     where tenant_id = (select id from public.tenants where slug = ${slug})`;
  await deleteTenantBySlug(slug);
  for (const row of users) {
    await fetch(`${envValue('SUPABASE_URL')}/auth/v1/admin/users/${row.user_id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
  }
}

export type EventFixture = {
  title: string;
  /** Plain text; `''` by default. */
  description?: string;
  format?: 'in_person' | 'online';
  venueName?: string;
  address?: string;
  meetingUrl?: string;
  /** Minutes from the DATABASE's `now()`; negative is in the past. */
  startsInMinutes: number;
  endsInMinutes: number;
  cancelled?: boolean;
  checkinCode?: string;
};

/**
 * Writes one event and its secrets row, relative to the database's `now()`, in ONE statement.
 * The author is the tenant's first `admin_tenant`. Returns the event id.
 */
export async function insertEvent(tenantId: string, fields: EventFixture): Promise<string> {
  const format = fields.format ?? 'in_person';
  const online = format === 'online';
  const rows = await sql()<{ id: string }[]>`
    with author as (
      select user_id from public.memberships
       where tenant_id = ${tenantId}::uuid and role = 'admin_tenant' and deleted_at is null
       order by joined_at limit 1
    ), e as (
      insert into public.events (tenant_id, created_by_user_id, title, description, format,
                                 venue_name, address, starts_at, ends_at, status, cancelled_at)
      select ${tenantId}::uuid, author.user_id, ${fields.title}, ${fields.description ?? ''},
             ${format},
             ${online ? null : (fields.venueName ?? 'Auditorio da sede')},
             ${online ? null : (fields.address ?? 'Rua das Flores, 100')},
             now() + make_interval(mins => ${fields.startsInMinutes}),
             now() + make_interval(mins => ${fields.endsInMinutes}),
             ${fields.cancelled ? 'cancelled' : 'active'},
             ${fields.cancelled ? sql()`now()` : null}
        from author
      returning id, tenant_id, format
    )
    insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code, meeting_url)
    select id, tenant_id, format, ${fields.checkinCode ?? 'K7QM'},
           ${online ? (fields.meetingUrl ?? 'https://meet.example.test/e2e') : null}
      from e
    returning event_id as id`;
  const id = rows[0]?.id;
  if (!id)
    throw new Error(`could not insert event ${fields.title} (does the tenant have an admin?)`);
  return id;
}

/**
 * The stored instants of a seeded event, by tenant slug and title, as ISO strings — what a spec
 * formats with `Intl` to compute the copy it expects, instead of hard-coding a wall clock.
 */
export async function readEventInstants(
  tenantSlug: string,
  title: string,
): Promise<{ id: string; startsAt: string; endsAt: string }> {
  const rows = await sql()<{ id: string; starts_at: Date; ends_at: Date }[]>`
    select e.id, e.starts_at, e.ends_at from public.events e
      join public.tenants t on t.id = e.tenant_id
     where t.slug = ${tenantSlug} and e.title = ${title} and e.deleted_at is null
     limit 1`;
  const row = rows[0];
  if (!row) throw new Error(`no event titled ${title} in ${tenantSlug}`);
  return { id: row.id, startsAt: row.starts_at.toISOString(), endsAt: row.ends_at.toISOString() };
}

/** The id of a tenant by slug (the seeded ones included). */
export async function tenantIdBySlug(slug: string): Promise<string> {
  const rows = await sql()<{ id: string }[]>`select id from public.tenants where slug = ${slug}`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`no tenant ${slug}`);
  return id;
}

/** Removes every event of `tenantId` whose title starts with `prefix` (secrets and answers cascade). */
export async function deleteEventsByTitlePrefix(tenantId: string, prefix: string): Promise<void> {
  await sql()`
    delete from public.events
     where tenant_id = ${tenantId}::uuid and title like ${`${prefix}%`}`;
}

/**
 * Moves an event's start to `startsInMinutes` from the DATABASE's `now()` (negative = already
 * started), leaving its end alone. The guard trigger polices ATTENDANCE writes only, so this is the
 * time-travel step (planning decision 4): an open page still draws the old phase, and the next RSVP
 * tap meets the database's refusal (`rsvp_closed`, D-204).
 */
export async function moveEventStart(eventId: string, startsInMinutes: number): Promise<void> {
  await sql()`
    update public.events
       set starts_at = now() + make_interval(mins => ${startsInMinutes}), updated_at = now()
     where id = ${eventId}::uuid`;
}

/**
 * 06-04: an event's admin-only half, read through the superuser connection (test-only). This is how
 * the `events admin` spec proves a format switch stored ONLY the visible side: the meeting URL lives
 * in `event_secrets`, which no member lane and no member payload can read, so the browser cannot
 * observe it and the spec must look at the table itself.
 */
export async function secretsFor(
  eventId: string,
): Promise<{ eventFormat: string; meetingUrl: string | null }> {
  const rows = await sql()<{ event_format: string; meeting_url: string | null }[]>`
    select event_format, meeting_url from public.event_secrets where event_id = ${eventId}::uuid`;
  const row = rows[0];
  if (!row) throw new Error(`no event_secrets row for ${eventId}`);
  return { eventFormat: row.event_format, meetingUrl: row.meeting_url };
}

/**
 * 06-04: waits until the worker has derived a `cover` image uploaded to `tenantId` after `since`
 * (the `waitForReadyPostImages` shape). A cover is only accepted by the API once it is `ready`
 * (the 05-09 tuple rule), so the form must not be submitted before this settles.
 */
export async function waitForReadyCover(
  tenantId: string,
  since: Date,
  timeoutMs = 120_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let seen = '(no rows at all)';
  while (Date.now() < deadline) {
    const rows = await sql()<{ id: string; status: string }[]>`
      select id, status from public.media_assets
       where tenant_id = ${tenantId}::uuid
         and kind = 'image' and purpose = 'cover'
         and created_at >= ${since.toISOString()}::timestamptz
       order by created_at desc`;
    seen = rows.map((row) => row.status).join(', ') || '(no rows at all)';
    const ready = rows.find((row) => row.status === 'ready');
    if (ready) return ready.id;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no ready cover for ${tenantId} within ${timeoutMs} ms; statuses: ${seen}`);
}
