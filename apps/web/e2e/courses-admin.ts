import postgres from 'postgres';
import { envValue } from './admin';
import {
  createThrowawayTenant,
  deleteTenantBySlug,
  setTenantModuleFlag,
  throwawayOrigin,
} from './tenant-fixtures';

/**
 * Fixtures for the Cursos e2e specs (08.3-06), the `store-admin.ts` / `events-admin.ts` shape: rows
 * written through a direct superuser connection, so a spec can stand up a school (a course, its
 * modules and lessons, a lesson video still processing) in a few statements, without driving the
 * forms that later plans build.
 *
 * Two kinds of fixture:
 *
 *  - `createCoursesTenant` provisions a THROWAWAY tenant with `courses` on (and any extra module),
 *    an admin and a member, and no course. The three Playwright projects run in parallel against the
 *    same database, so an "empty state" assertion on rede-demo would read a sibling project's
 *    fixtures; a tenant per project makes "Nenhum curso ainda" and "the module is off" honest. The
 *    seed tenants are never flipped (their flags sit in the API's 30 s cache, shared by the suite).
 *  - `createCourse` writes a course on any tenant by slug, with `modules` × `lessonsPerModule` live
 *    rows and, for `withUnreadyVideo`, a `lesson`-purpose `media_assets` row still `processing` under
 *    the fake provider (the shape `apps/api/tests/integration/mux-webhook.test.ts` seeds), so the
 *    hub's second "Processando" pill has a real row behind it.
 *
 * Every row a spec writes on a shared tenant carries its run prefix in the title, and
 * `deleteCoursesByPrefix` removes progress rows, courses (modules, lessons, materials and links
 * cascade), the lesson assets and categories in that order, since progress and assets do not cascade
 * from the course.
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
export async function closeCoursesAdmin(): Promise<void> {
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

export type CoursesTenant = {
  slug: string;
  displayName: string;
  origin: string;
  tenantId: string;
  adminEmail: string;
  memberEmail: string;
  password: string;
};

/**
 * Provisions `slug` with `courses` enabled (plus `extraModules`), an admin, one member and zero
 * courses, categories, tracks or lives. Idempotent: a leftover from an interrupted run is removed
 * first. The host is `<slug>.localhost`, which Chromium resolves to loopback.
 */
export async function createCoursesTenant(
  slug: string,
  password: string,
  extraModules: readonly string[] = [],
): Promise<CoursesTenant> {
  await deleteCoursesTenant(slug);

  const host = `${slug}.localhost`;
  const displayName = `Escola ${slug}`;
  const { id: tenantId } = await createThrowawayTenant({
    slug,
    displayName,
    hosts: [{ host, primary: true, verified: true }],
    colors: { primary: '#2e6fd0', secondary: '#7aa7e8' },
  });
  for (const key of ['courses', ...extraModules]) {
    await setTenantModuleFlag(slug, key, true);
  }

  const adminEmail = `admin@${slug}.local`;
  const memberEmail = `membro@${slug}.local`;
  await addMembership(tenantId, adminEmail, password, 'admin_tenant', 'Admin Cursos');
  await addMembership(tenantId, memberEmail, password, 'member', 'Membro Cursos');

  return {
    slug,
    displayName,
    origin: throwawayOrigin(host),
    tenantId,
    adminEmail,
    memberEmail,
    password,
  };
}

/**
 * Removes the tenant, its school and its GoTrue users. The courses go first (modules, lessons,
 * materials and links cascade from them; progress rows and lesson assets do not cascade and are
 * removed around them), then the media rows, then the tenant and its memberships. The users are
 * found by membership AND by the fixture's `@<slug>.local` domain, so a teardown interrupted after
 * the memberships were gone still removes them.
 */
export async function deleteCoursesTenant(slug: string): Promise<void> {
  const users = await sql()<{ user_id: string }[]>`
    select m.user_id from public.memberships m
      join public.tenants t on t.id = m.tenant_id
     where t.slug = ${slug}
    union
    select u.id as user_id from auth.users u where u.email like ${`%@${slug}.local`}`;
  await sql().begin(async (tx) => {
    await tx`
      delete from public.course_lesson_progress
       where tenant_id = (select id from public.tenants where slug = ${slug})`;
    await tx`
      delete from public.courses
       where tenant_id = (select id from public.tenants where slug = ${slug})`;
    await tx`
      delete from public.media_assets
       where tenant_id = (select id from public.tenants where slug = ${slug})`;
  });
  await deleteTenantBySlug(slug);
  for (const row of users) {
    await fetch(`${envValue('SUPABASE_URL')}/auth/v1/admin/users/${row.user_id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
  }
}

/**
 * `tenant_modules.enabled` for `key` on `tenantSlug`. Scoped to a throwaway tenant by every caller
 * (the seed tenants' flags sit in the API's 30 s cache, shared by the whole suite). The API reads
 * the row again once its cache entry expires, so a spec that flips a flag waits for the screen to
 * follow rather than asserting it at once.
 */
export async function setModuleEnabled(
  tenantSlug: string,
  key: string,
  enabled: boolean,
): Promise<void> {
  await setTenantModuleFlag(tenantSlug, key, enabled);
}

/** The id and admin of a tenant, by slug (the seeded admin on the seed tenants). */
async function tenantAdmin(tenantSlug: string): Promise<{ tenantId: string; userId: string }> {
  const rows = await sql()<{ tenant_id: string; user_id: string }[]>`
    select m.tenant_id::text as tenant_id, m.user_id::text as user_id
      from public.memberships m
      join public.tenants t on t.id = m.tenant_id
     where t.slug = ${tenantSlug} and m.role = 'admin_tenant' and m.deleted_at is null
     order by m.joined_at asc
     limit 1`;
  const row = rows[0];
  if (!row) throw new Error(`no admin_tenant in ${tenantSlug}`);
  return { tenantId: row.tenant_id, userId: row.user_id };
}

export type CourseFixture = {
  tenantSlug: string;
  title: string;
  status?: 'draft' | 'published' | 'archived';
  /** Live modules, each with `lessonsPerModule` live lessons (1 × 2 by default). */
  modules?: number;
  lessonsPerModule?: number;
  /** The first lesson gets a `lesson` video asset still `processing` (the hub's second pill). */
  withUnreadyVideo?: boolean;
  coverAssetId?: string | null;
  /** Back-dates `created_at`, so the newest-first order of a spec's courses is deterministic. */
  minutesAgo?: number;
};

/**
 * A course (and its modules and lessons) in `tenantSlug`, created by the tenant's admin. The
 * instructor is a fixed name; every other optional field is empty. Returns the course id.
 */
export async function createCourse(fields: CourseFixture): Promise<string> {
  const { tenantId, userId } = await tenantAdmin(fields.tenantSlug);
  const stamp = new Date(Date.now() - (fields.minutesAgo ?? 0) * 60_000).toISOString();
  const status = fields.status ?? 'draft';
  const modules = fields.modules ?? 1;
  const lessonsPerModule = fields.lessonsPerModule ?? 2;
  return sql().begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      insert into public.courses
        (tenant_id, created_by_user_id, title, instructor_name, cover_asset_id, status,
         published_at, archived_at, created_at, updated_at)
      values
        (${tenantId}::uuid, ${userId}::uuid, ${fields.title}, 'Instrutora Fixture',
         ${fields.coverAssetId ?? null}::uuid, ${status},
         ${status === 'draft' ? null : stamp}::timestamptz,
         ${status === 'archived' ? stamp : null}::timestamptz,
         ${stamp}::timestamptz, ${stamp}::timestamptz)
      returning id::text as id`;
    const courseId = rows[0]?.id;
    if (!courseId) throw new Error(`could not create course "${fields.title}"`);

    let videoAssetId: string | null = null;
    if (fields.withUnreadyVideo) {
      const token = Math.random().toString(36).slice(2);
      const assets = await tx<{ id: string }[]>`
        insert into public.media_assets
          (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, mime,
           bytes, filename, created_at)
        values (${tenantId}::uuid, ${userId}::uuid, 'video', 'lesson', 'processing', 'fake',
                ${`fake-e2e-lesson-${token}`}, 'video/mp4', 1048576,
                ${`${fields.title} aula.mp4`}, ${stamp}::timestamptz)
        returning id::text as id`;
      videoAssetId = assets[0]?.id ?? null;
      if (!videoAssetId) throw new Error(`could not create the lesson video of "${fields.title}"`);
    }

    for (let m = 1; m <= modules; m += 1) {
      const moduleRows = await tx<{ id: string }[]>`
        insert into public.course_modules (tenant_id, course_id, title, position, created_at, updated_at)
        values (${tenantId}::uuid, ${courseId}::uuid, ${`${fields.title} módulo ${m}`}, ${m},
                ${stamp}::timestamptz, ${stamp}::timestamptz)
        returning id::text as id`;
      const moduleId = moduleRows[0]?.id;
      if (!moduleId) throw new Error(`could not create module ${m} of "${fields.title}"`);
      for (let l = 1; l <= lessonsPerModule; l += 1) {
        const video = m === 1 && l === 1 ? videoAssetId : null;
        await tx`
          insert into public.course_lessons
            (tenant_id, course_id, module_id, title, position, video_asset_id, created_at, updated_at)
          values (${tenantId}::uuid, ${courseId}::uuid, ${moduleId}::uuid,
                  ${`${fields.title} aula ${m}.${l}`}, ${l}, ${video}::uuid,
                  ${stamp}::timestamptz, ${stamp}::timestamptz)`;
      }
    }
    return courseId;
  });
}

/**
 * Removes every course whose title starts with `prefix` (progress rows first, then the courses —
 * modules, lessons, materials and links cascade — then the lesson video assets that referenced
 * them) and every category whose name starts with it.
 */
export async function deleteCoursesByPrefix(prefix: string): Promise<void> {
  const like = `${prefix}%`;
  await sql().begin(async (tx) => {
    const assets = await tx<{ id: string }[]>`
      select distinct l.video_asset_id::text as id
        from public.course_lessons l
        join public.courses c on c.id = l.course_id
       where c.title like ${like} and l.video_asset_id is not null`;
    await tx`
      delete from public.course_lesson_progress
       where lesson_id in (
         select l.id from public.course_lessons l
           join public.courses c on c.id = l.course_id
          where c.title like ${like})`;
    await tx`delete from public.courses where title like ${like}`;
    for (const asset of assets) {
      await tx`delete from public.media_assets where id = ${asset.id}::uuid`;
    }
    await tx`delete from public.course_categories where name like ${like}`;
  });
}

// ── 08.3-07: the course form and the category manager ─────────────────────────────────────────

/** A category in `tenantSlug` (D-411: a name and an optional cover). Returns its id. */
export async function createCategory(fields: {
  tenantSlug: string;
  name: string;
  coverAssetId?: string | null;
}): Promise<string> {
  const rows = await sql()<{ id: string }[]>`
    insert into public.course_categories (tenant_id, name, cover_asset_id)
    select t.id, ${fields.name}, ${fields.coverAssetId ?? null}::uuid
      from public.tenants t where t.slug = ${fields.tenantSlug}
    returning id::text as id`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not create category "${fields.name}" in ${fields.tenantSlug}`);
  return id;
}

export type SavedCourse = {
  id: string;
  status: string;
  tagline: string;
  level: string | null;
  certificateHours: number | null;
  outcomes: string[];
  instructorName: string;
  categoryId: string | null;
};

/** The newest course titled exactly `title` (what the form just wrote), or null. */
export async function courseByTitle(title: string): Promise<SavedCourse | null> {
  const rows = await sql()<
    {
      id: string;
      status: string;
      tagline: string;
      level: string | null;
      certificate_hours: number | null;
      outcomes: string[];
      instructor_name: string;
      category_id: string | null;
    }[]
  >`
    select id::text as id, status, tagline, level, certificate_hours, outcomes, instructor_name,
           category_id::text as category_id
      from public.courses
     where title = ${title}
     order by created_at desc
     limit 1`;
  const row = rows[0];
  return row
    ? {
        id: row.id,
        status: row.status,
        tagline: row.tagline,
        level: row.level,
        certificateHours: row.certificate_hours,
        outcomes: row.outcomes,
        instructorName: row.instructor_name,
        categoryId: row.category_id,
      }
    : null;
}

/** The product ids a course links, sorted (a SET; the order is not the contract). */
export async function courseProductIds(courseId: string): Promise<string[]> {
  const rows = await sql()<{ product_id: string }[]>`
    select product_id::text as product_id from public.course_products
     where course_id = ${courseId}::uuid
     order by product_id`;
  return rows.map((row) => row.product_id);
}

/** A category by exact name with how many courses (every status) reference it, or null. */
export async function categoryByName(
  name: string,
): Promise<{ id: string; courseCount: number } | null> {
  const rows = await sql()<{ id: string; course_count: number }[]>`
    select c.id::text as id,
           (select count(*)::int from public.courses k where k.category_id = c.id) as course_count
      from public.course_categories c
     where c.name = ${name}
     limit 1`;
  const row = rows[0];
  return row ? { id: row.id, courseCount: row.course_count } : null;
}

// ── 08.3-08: the course page and the curriculum editor ────────────────────────────────────────

/** A live module of a course as the page lists it: id, title and stored position, in position order. */
export async function courseModules(
  courseId: string,
): Promise<{ id: string; title: string; position: number }[]> {
  return sql()<{ id: string; title: string; position: number }[]>`
    select id::text as id, title, position
      from public.course_modules
     where course_id = ${courseId}::uuid and deleted_at is null
     order by position asc, created_at asc`;
}

/** The course's status column (what publish / unpublish wrote). */
export async function courseStatus(courseId: string): Promise<string | null> {
  const rows = await sql()<{ status: string }[]>`
    select status from public.courses where id = ${courseId}::uuid`;
  return rows[0]?.status ?? null;
}

/**
 * A live lesson at the next position of `moduleId`, created by the tenant's admin. With
 * `withUnreadyVideo` the lesson carries a `lesson`-purpose video asset still `processing` under the
 * fake provider, back-dated past the reconcile grace so the course page's readiness poll reads a
 * stable `processing` (the fake's `getUploadState` answers `waiting`) until `markAssetReady` flips it.
 * Returns the lesson id and the asset id (null without a video).
 */
export async function createLesson(fields: {
  tenantSlug: string;
  courseId: string;
  moduleId: string;
  title: string;
  withUnreadyVideo?: boolean;
  isFree?: boolean;
}): Promise<{ id: string; videoAssetId: string | null }> {
  const { tenantId, userId } = await tenantAdmin(fields.tenantSlug);
  const stamp = new Date(Date.now() - 2 * 60_000).toISOString();
  return sql().begin(async (tx) => {
    let videoAssetId: string | null = null;
    if (fields.withUnreadyVideo) {
      const token = Math.random().toString(36).slice(2);
      const assets = await tx<{ id: string }[]>`
        insert into public.media_assets
          (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, mime,
           bytes, filename, created_at)
        values (${tenantId}::uuid, ${userId}::uuid, 'video', 'lesson', 'processing', 'fake',
                ${`fake-e2e-lesson-${token}`}, 'video/mp4', 1048576,
                ${`${fields.title}.mp4`}, ${stamp}::timestamptz)
        returning id::text as id`;
      videoAssetId = assets[0]?.id ?? null;
      if (!videoAssetId) throw new Error(`could not create the video of "${fields.title}"`);
    }
    const positions = await tx<{ next: number }[]>`
      select coalesce(max(position), 0) + 1 as next
        from public.course_lessons
       where module_id = ${fields.moduleId}::uuid and deleted_at is null`;
    const rows = await tx<{ id: string }[]>`
      insert into public.course_lessons
        (tenant_id, course_id, module_id, title, position, video_asset_id, is_free, created_at, updated_at)
      values (${tenantId}::uuid, ${fields.courseId}::uuid, ${fields.moduleId}::uuid,
              ${fields.title}, ${positions[0]?.next ?? 1}, ${videoAssetId}::uuid,
              ${fields.isFree ?? false}, now(), now())
      returning id::text as id`;
    const id = rows[0]?.id;
    if (!id) throw new Error(`could not create lesson "${fields.title}"`);
    return { id, videoAssetId };
  });
}

/**
 * Flips a fixture video to `ready` under the fake provider — what the provider's webhook would have
 * done — with a playback id and the asset seconds the row then prints as mm:ss (D-409).
 */
export async function markAssetReady(
  assetId: string,
  values: { durationSeconds?: number; playbackId?: string } = {},
): Promise<void> {
  await sql()`
    update public.media_assets
       set status = 'ready',
           playback_id = ${values.playbackId ?? `fake-playback-${assetId}`},
           duration_seconds = ${values.durationSeconds ?? 2},
           aspect_ratio = '16:9',
           ready_at = now()
     where id = ${assetId}::uuid`;
}
