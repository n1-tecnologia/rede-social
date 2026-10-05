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

/**
 * Provisions `slug` with `events` enabled, an admin, one member and zero events. Idempotent.
 * `extraModules` (06-08) turns more modules on too — the tab-dot spec needs `feed`, so `/inicio`
 * has its feed (and, since 2026-10-03, no "Próximo evento" card above it).
 */
export async function createEventsTenant(
  slug: string,
  password: string,
  extraModules: readonly string[] = [],
): Promise<EventsTenant> {
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
  for (const key of extraModules) {
    await sql()`
      insert into public.tenant_modules (tenant_id, module_key, enabled)
      values (${tenantId}::uuid, ${key}, true)
      on conflict (tenant_id, module_key) do update set enabled = true`;
  }

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

/** The phase bounds a now-relative window must keep while it is moved onto one local day. */
export type WindowBounds = {
  /** The earliest acceptable start, in minutes from now (the case's phase still holds). */
  earliestStart: number;
  /** The latest acceptable start, in minutes from now. */
  latestStart: number;
  /** The shortest acceptable duration, in minutes (the case must finish before the end). */
  minDuration: number;
};

/** `2026-09-27` in `timeZone`: the tenant-local calendar day of an instant. */
const localDay = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(ms));

/** Whole minutes from `ms` to the next tenant-local midnight (1 … 1440). */
function minutesToLocalMidnight(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return 1440 - (part('hour') * 60 + part('minute'));
}

/**
 * 06-09: a now-relative event window that starts AND ends on ONE tenant-local calendar day, as close
 * to the requested one as the case's `bounds` allow. Pure (the clock and the zone are arguments) so
 * it can be proved over every minute of a day.
 *
 * Why: the product prints an event that ends on another local day as a RANGE (`27 a 28 de set.`, the
 * multi-day time line), so a fixture written as "starts in 30 min, lasts 2 h" silently changes the
 * copy a spec measures whenever the gate runs after ~21:30 in the tenant's zone. The candidates, in
 * order: the requested window; the requested start with its end pulled back before midnight; the
 * earliest allowed start, likewise; a start just after the next local midnight (the whole window on
 * tomorrow). The first that keeps `bounds` wins; none throws, naming the clock, rather than
 * returning a window that would make the case prove something else.
 */
export function sameDayWindowAt(
  nowMs: number,
  timeZone: string,
  want: { startsInMinutes: number; endsInMinutes: number },
  bounds: WindowBounds,
): { startsInMinutes: number; endsInMinutes: number } {
  const duration = want.endsInMinutes - want.startsInMinutes;
  const at = (minutes: number) => nowMs + minutes * 60_000;
  const fits = (start: number, end: number) =>
    start >= bounds.earliestStart &&
    start <= bounds.latestStart &&
    end - start >= bounds.minDuration &&
    localDay(at(start), timeZone) === localDay(at(end), timeZone);

  const afterMidnight = (start: number) => start + minutesToLocalMidnight(at(start), timeZone);
  const clamped = (start: number) => Math.min(start + duration, afterMidnight(start) - 1);
  const nextDayStart = Math.max(afterMidnight(0) + 1, bounds.earliestStart);
  const candidates: [number, number][] = [
    [want.startsInMinutes, want.endsInMinutes],
    [want.startsInMinutes, clamped(want.startsInMinutes)],
    [bounds.earliestStart, clamped(bounds.earliestStart)],
    [nextDayStart, clamped(nextDayStart)],
  ];
  for (const [start, end] of candidates) {
    if (fits(start, end)) return { startsInMinutes: start, endsInMinutes: end };
  }
  throw new Error(
    `no one-day window for ${JSON.stringify(want)} within ${JSON.stringify(bounds)} at ${new Date(nowMs).toISOString()} in ${timeZone}`,
  );
}

/** `sameDayWindowAt` for a tenant, on its stored `tenants.timezone` and the real clock. */
export async function sameDayWindow(
  tenantId: string,
  want: { startsInMinutes: number; endsInMinutes: number },
  bounds: WindowBounds,
): Promise<{ startsInMinutes: number; endsInMinutes: number }> {
  const rows = await sql()<{ timezone: string }[]>`
    select timezone from public.tenants where id = ${tenantId}::uuid`;
  const timeZone = rows[0]?.timezone;
  if (!timeZone) throw new Error(`no tenant ${tenantId}`);
  return sameDayWindowAt(Date.now(), timeZone, want, bounds);
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
 * 2026-10-03: moves an event's END to `seconds` from the DATABASE's `now()`, to the second, leaving
 * its start alone (it must stay before the end) — how the tab-dot spec puts the last event's end a
 * few seconds ahead and then waits out the REAL boundary (Pitfall 7: the server clock is real).
 * It replaced 06-08's `moveEventStartSeconds`, whose only caller was the removed Início card spec.
 */
export async function moveEventEndSeconds(eventId: string, seconds: number): Promise<void> {
  await sql()`
    update public.events
       set ends_at = now() + make_interval(secs => ${seconds}), updated_at = now()
     where id = ${eventId}::uuid`;
}

/**
 * 06-09: moves BOTH ends of an event relative to the DATABASE's `now()` (negative = the past), in one
 * statement so `events_window_chk` sees the new pair. The phase smoke's "over time" step: an event
 * the admin created for next week is, a moment later, an event that ended an hour ago, and the
 * member's Passados has to list it (the guard trigger polices attendance writes only).
 */
export async function moveEventWindow(
  eventId: string,
  startsInMinutes: number,
  endsInMinutes: number,
): Promise<void> {
  await sql()`
    update public.events
       set starts_at = now() + make_interval(mins => ${startsInMinutes}),
           ends_at = now() + make_interval(mins => ${endsInMinutes}),
           updated_at = now()
     where id = ${eventId}::uuid`;
}

/**
 * 06-09: sets a tenant's `tenants.timezone` and returns the value it replaced, so the caller can put
 * it back in a `finally`. The bootstrap reads the column on every request (no cache), which is what
 * lets the phase smoke switch the seeded tenant to `America/Manaus` for one reload.
 */
export async function setTenantTimezone(slug: string, timeZone: string): Promise<string> {
  const before = await sql()<{ timezone: string }[]>`
    select timezone from public.tenants where slug = ${slug}`;
  const previous = before[0]?.timezone;
  if (!previous) throw new Error(`no tenant ${slug}`);
  await sql()`update public.tenants set timezone = ${timeZone} where slug = ${slug}`;
  return previous;
}

/** 06-08: cancels an event through the superuser connection (the admin UI is 06-04's spec). */
export async function cancelEventNow(eventId: string): Promise<void> {
  await sql()`
    update public.events
       set status = 'cancelled', cancelled_at = now(), updated_at = now()
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
): Promise<{ eventFormat: string; meetingUrl: string | null; checkinCode: string }> {
  const rows = await sql()<
    { event_format: string; meeting_url: string | null; checkin_code: string }[]
  >`
    select event_format, meeting_url, checkin_code
      from public.event_secrets where event_id = ${eventId}::uuid`;
  const row = rows[0];
  if (!row) throw new Error(`no event_secrets row for ${eventId}`);
  return {
    eventFormat: row.event_format,
    meetingUrl: row.meeting_url,
    // 06-05: the venue code the organiser reads aloud. A spec may only learn it HERE: no member
    // payload carries it (T-06-31), which is what makes typing it a proof of presence.
    checkinCode: row.checkin_code,
  };
}

/**
 * 06-05: one more member of a throwaway events tenant (`<local>@<slug>.local`, so `deleteEventsTenant`
 * removes the GoTrue user with the tenant). Returns the email.
 */
export async function addEventsMember(
  tenant: Pick<EventsTenant, 'slug' | 'tenantId' | 'password'>,
  local: string,
  displayName: string,
): Promise<string> {
  const email = `${local}@${tenant.slug}.local`;
  await addMembership(tenant.tenantId, email, tenant.password, 'member', displayName);
  return email;
}

/**
 * 06-05: one member's attendance row at one event, read through the superuser connection — how the
 * check-in spec proves a walk-in was RECORDED as `walk_in` (the status is admin-only in the UI).
 */
export async function attendanceFor(
  eventId: string,
  email: string,
): Promise<{ status: string; checkinVia: string | null } | null> {
  const rows = await sql()<{ status: string; checkin_via: string | null }[]>`
    select a.status, a.checkin_via from public.event_attendances a
      join public.users u on u.id = a.user_id
     where a.event_id = ${eventId}::uuid and u.email = ${email}`;
  const row = rows[0];
  return row ? { status: row.status, checkinVia: row.checkin_via } : null;
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

/** The API the Playwright config starts (or reuses) as a webServer. */
const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';

/**
 * 06-07: calls the events API AS a member of a throwaway tenant (a real GoTrue password session,
 * presented on the tenant's own host), so a fixture's answers and check-ins go through the SAME
 * member routes a phone uses (`PUT /rsvp`, `POST /check-in`), guard trigger and SECURITY DEFINER
 * function included, rather than being written into the table. Throws on a non-2xx answer.
 */
export async function eventsApiAs(
  tenant: Pick<EventsTenant, 'slug' | 'password'>,
  email: string,
  path: string,
  init: { method: string; body?: unknown },
): Promise<unknown> {
  const session = await fetch(`${envValue('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: envValue('SUPABASE_PUBLISHABLE_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: tenant.password }),
  });
  if (!session.ok) throw new Error(`${email} sign-in failed: ${session.status}`);
  const { access_token } = (await session.json()) as { access_token: string };
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${access_token}`,
      'x-tenant-host': `${tenant.slug}.localhost`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok)
    throw new Error(`${init.method} ${path} as ${email}: ${res.status} ${await res.text()}`);
  return res.json();
}
