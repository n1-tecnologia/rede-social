import { createHmac } from 'node:crypto';
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
 * `deleteCoursesByPrefix` removes progress rows, the store's course links, courses (modules, lessons
 * and materials cascade), the lesson assets and categories in that order, since progress and assets do not cascade
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
  /** The one-line "frase de venda" under the hero (`''` by default); 08.3-12's E05 backstop seeds 160 characters. */
  tagline?: string;
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
        (tenant_id, created_by_user_id, title, tagline, instructor_name, cover_asset_id, status,
         published_at, archived_at, created_at, updated_at)
      values
        (${tenantId}::uuid, ${userId}::uuid, ${fields.title}, ${fields.tagline ?? ''},
         'Instrutora Fixture', ${fields.coverAssetId ?? null}::uuid, ${status},
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
    // The store's link rows go with the course (hand FK, on delete cascade); deleted first anyway,
    // so a cleanup never depends on a constraint it does not own.
    await tx`
      delete from public.store_product_courses
       where course_id in (select id from public.courses where title like ${like})`;
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

/**
 * The product ids that open a course, sorted (a SET; the order is not the contract). The links live
 * in the store's `store_product_courses` since 08.4 (D-418: written only through the product form).
 */
export async function courseProductIds(courseId: string): Promise<string[]> {
  const rows = await sql()<{ product_id: string }[]>`
    select product_id::text as product_id from public.store_product_courses
     where course_id = ${courseId}::uuid
     order by product_id`;
  return rows.map((row) => row.product_id);
}

/** The product ids that open a live, sorted (`store_product_lives`, 08.4). */
export async function liveProductIds(liveId: string): Promise<string[]> {
  const rows = await sql()<{ product_id: string }[]>`
    select product_id::text as product_id from public.store_product_lives
     where live_id = ${liveId}::uuid
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

// ── 08.3-09: the lesson form, its video and its materials ─────────────────────────────────────

/**
 * A live lesson whose `lesson` video is still `processing` under the fake provider — the state the
 * form's processing card draws until `markAssetReady` flips it. `createLesson` with the flag, named
 * for what the lesson-form spec means by it.
 */
export async function createLessonWithProcessingVideo(fields: {
  tenantSlug: string;
  courseId: string;
  moduleId: string;
  title: string;
}): Promise<{ id: string; videoAssetId: string }> {
  const created = await createLesson({ ...fields, withUnreadyVideo: true });
  if (!created.videoAssetId) throw new Error(`"${fields.title}" has no video asset`);
  return { id: created.id, videoAssetId: created.videoAssetId };
}

/**
 * `n` READY `attachment` rows (the `courses.test.ts` `seedAttachment` shape: a 4 KiB PDF each, no
 * Storage object — the cap case never opens one) joined to `lessonId` at positions 1..n. Returns the
 * material (join row) ids in position order.
 */
export async function createMaterials(
  tenantSlug: string,
  lessonId: string,
  n: number,
  prefix: string,
): Promise<string[]> {
  const { tenantId, userId } = await tenantAdmin(tenantSlug);
  return sql().begin(async (tx) => {
    const ids: string[] = [];
    for (let position = 1; position <= n; position += 1) {
      const assets = await tx<{ id: string }[]>`
        insert into public.media_assets
          (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, filename, ready_at)
        values (${tenantId}::uuid, ${userId}::uuid, 'file', 'attachment', 'ready', 'supabase',
                'application/pdf', 4096, ${`${prefix} material ${position}.pdf`}, now())
        returning id::text as id`;
      const assetId = assets[0]?.id;
      if (!assetId) throw new Error(`could not seed material ${position}`);
      const rows = await tx<{ id: string }[]>`
        insert into public.course_lesson_materials (tenant_id, lesson_id, asset_id, position)
        values (${tenantId}::uuid, ${lessonId}::uuid, ${assetId}::uuid, ${position})
        returning id::text as id`;
      const id = rows[0]?.id;
      if (!id) throw new Error(`could not join material ${position}`);
      ids.push(id);
    }
    return ids;
  });
}

/**
 * Links a store product to a course straight in the store's `store_product_courses` (08.4, D-418:
 * the row the product form writes), so a spec can stand up a gated course without driving the Loja.
 * The tenant is the course's.
 */
export async function linkCourseProduct(courseId: string, productId: string): Promise<void> {
  await sql()`
    insert into public.store_product_courses (tenant_id, product_id, course_id)
    select c.tenant_id, ${productId}::uuid, c.id from public.courses c where c.id = ${courseId}::uuid
    on conflict do nothing`;
}

/** Links a store product to a live straight in `store_product_lives` (08.4); the tenant is the live's. */
export async function linkLiveProduct(liveId: string, productId: string): Promise<void> {
  await sql()`
    insert into public.store_product_lives (tenant_id, product_id, live_id)
    select l.tenant_id, ${productId}::uuid, l.id from public.course_lives l where l.id = ${liveId}::uuid
    on conflict do nothing`;
}

export type SavedLesson = {
  id: string;
  moduleId: string;
  isFree: boolean;
  videoAssetId: string | null;
  removed: boolean;
};

/** The newest lesson titled exactly `title` (removed ones included), or null. */
export async function lessonByTitle(title: string): Promise<SavedLesson | null> {
  const rows = await sql()<
    {
      id: string;
      module_id: string;
      is_free: boolean;
      video_asset_id: string | null;
      removed: boolean;
    }[]
  >`
    select id::text as id, module_id::text as module_id, is_free, video_asset_id::text as video_asset_id,
           (deleted_at is not null) as removed
      from public.course_lessons
     where title = ${title}
     order by created_at desc
     limit 1`;
  const row = rows[0];
  return row
    ? {
        id: row.id,
        moduleId: row.module_id,
        isFree: row.is_free,
        videoAssetId: row.video_asset_id,
        removed: row.removed,
      }
    : null;
}

/** A lesson's materials as the API lists them: the stored filename and position, by position. */
export async function lessonMaterials(
  lessonId: string,
): Promise<{ filename: string; position: number }[]> {
  return sql()<{ filename: string; position: number }[]>`
    select a.filename, m.position
      from public.course_lesson_materials m
      join public.media_assets a on a.id = m.asset_id
     where m.lesson_id = ${lessonId}::uuid
     order by m.position asc, m.id asc`;
}

// ── 08.3-10: the Trilhas tab and the track form ───────────────────────────────────────────────

/**
 * Sets a course's `status` column straight in the table — what the course page's publish zone writes
 * (D-413) — so the tracks spec can unpublish a linked course and watch it drop out of the track at
 * read time (D-415) without driving the course page.
 */
export async function setCourseStatus(
  courseId: string,
  status: 'draft' | 'published' | 'archived',
): Promise<void> {
  await sql()`
    update public.courses
       set status = ${status},
           published_at = case when ${status} = 'published' then coalesce(published_at, now()) else published_at end,
           archived_at = case when ${status} = 'archived' then now() else archived_at end,
           updated_at = now()
     where id = ${courseId}::uuid`;
}

/** Removes every track whose title starts with `prefix` (the link rows cascade). */
export async function deleteTracksByPrefix(prefix: string): Promise<void> {
  await sql()`delete from public.course_tracks where title like ${`${prefix}%`}`;
}

export type SavedTrack = { id: string; status: string; subtitle: string; audience: string };

/** The newest track titled exactly `title` (what the form just wrote), or null. */
export async function trackByTitle(title: string): Promise<SavedTrack | null> {
  const rows = await sql()<{ id: string; status: string; subtitle: string; audience: string }[]>`
    select id::text as id, status, subtitle, audience
      from public.course_tracks
     where title = ${title}
     order by created_at desc
     limit 1`;
  const row = rows[0];
  return row
    ? { id: row.id, status: row.status, subtitle: row.subtitle, audience: row.audience }
    : null;
}

/** A track's course ids in stored `position` order (the ONE write path's result). */
export async function trackCourseIds(trackId: string): Promise<string[]> {
  const rows = await sql()<{ course_id: string }[]>`
    select course_id::text as course_id
      from public.course_track_courses
     where track_id = ${trackId}::uuid
     order by position asc, course_id asc`;
  return rows.map((row) => row.course_id);
}

// ── 08.3-11: the Lives tab and the live form ───────────────────────────────────────────────────

/** The IANA zone the tenant's dates are formatted in (`tenants.timezone`, the bootstrap's value). */
export async function tenantTimezone(tenantSlug: string): Promise<string> {
  const rows = await sql()<{ timezone: string }[]>`
    select timezone from public.tenants where slug = ${tenantSlug}`;
  const zone = rows[0]?.timezone;
  if (!zone) throw new Error(`no tenant ${tenantSlug}`);
  return zone;
}

export type LiveFixture = {
  tenantSlug: string;
  title: string;
  /** The UTC instant the live starts at (an ISO string). */
  startsAt: string;
  durationMin?: number;
  externalUrl?: string;
  /** Sets `cancelled_at` (now), the only stored state (D-416). */
  cancelled?: boolean;
};

/**
 * A live in `tenantSlug`, created by the tenant's admin, straight in the table: the spec stands up
 * an on-air live (started 30 min ago) and an ended one (3 h ago) without waiting for a clock. Its
 * state is NOT written anywhere — the API derives it from `starts_at + duration_min` when it answers
 * (D-416). Returns the live id.
 */
export async function createLive(fields: LiveFixture): Promise<string> {
  const { tenantId, userId } = await tenantAdmin(fields.tenantSlug);
  const rows = await sql()<{ id: string }[]>`
    insert into public.course_lives
      (tenant_id, created_by_user_id, title, starts_at, duration_min, external_url, cancelled_at)
    values (${tenantId}::uuid, ${userId}::uuid, ${fields.title}, ${fields.startsAt}::timestamptz,
            ${fields.durationMin ?? 60}, ${fields.externalUrl ?? 'https://youtu.be/e2e-live'},
            ${fields.cancelled ? new Date().toISOString() : null}::timestamptz)
    returning id::text as id`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not create live "${fields.title}"`);
  return id;
}

/**
 * Removes every live whose title starts with `prefix` and its `store_product_lives` rows (which would
 * cascade anyway; the replay pointer is a column).
 */
export async function deleteLivesByPrefix(prefix: string): Promise<void> {
  const like = `${prefix}%`;
  await sql().begin(async (tx) => {
    await tx`
      delete from public.store_product_lives
       where live_id in (select id from public.course_lives where title like ${like})`;
    await tx`delete from public.course_lives where title like ${like}`;
  });
}

export type SavedLive = {
  id: string;
  startsAt: string;
  durationMin: number;
  externalUrl: string;
  cancelledAt: string | null;
  replayLessonId: string | null;
};

/** The newest live titled exactly `title` (what the form just wrote), or null. `startsAt` is the UTC ISO instant. */
export async function liveByTitle(title: string): Promise<SavedLive | null> {
  const rows = await sql()<
    {
      id: string;
      starts_at: string;
      duration_min: number;
      external_url: string;
      cancelled_at: string | null;
      replay_lesson_id: string | null;
    }[]
  >`
    select id::text as id,
           to_char(starts_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as starts_at,
           duration_min, external_url,
           to_char(cancelled_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as cancelled_at,
           replay_lesson_id::text as replay_lesson_id
      from public.course_lives
     where title = ${title}
     order by created_at desc
     limit 1`;
  const row = rows[0];
  return row
    ? {
        id: row.id,
        startsAt: row.starts_at,
        durationMin: row.duration_min,
        externalUrl: row.external_url,
        cancelledAt: row.cancelled_at,
        replayLessonId: row.replay_lesson_id,
      }
    : null;
}

// ── 08.3-12: the backstop battery ──────────────────────────────────────────────────────────────

/** A course's stored cover asset id (what the form's upload wrote), or null. */
export async function courseCoverAssetId(courseId: string): Promise<string | null> {
  const rows = await sql()<{ cover_asset_id: string | null }[]>`
    select cover_asset_id::text as cover_asset_id from public.courses where id = ${courseId}::uuid`;
  return rows[0]?.cover_asset_id ?? null;
}

export type LessonAssetState = {
  id: string;
  status: string;
  provider: string;
  providerAssetId: string | null;
  durationSeconds: number | null;
  failureReason: string | null;
};

/** The newest `lesson` video asset of a tenant — the row the lesson form's dropzone just started — or null. */
export async function newestLessonAssetIn(tenantSlug: string): Promise<LessonAssetState | null> {
  const rows = await sql()<
    {
      id: string;
      status: string;
      provider: string;
      provider_asset_id: string | null;
      duration_seconds: number | null;
      failure_reason: string | null;
    }[]
  >`
    select a.id::text as id, a.status, a.provider, a.provider_asset_id, a.duration_seconds,
           a.failure_reason
      from public.media_assets a
      join public.tenants t on t.id = a.tenant_id
     where t.slug = ${tenantSlug} and a.kind = 'video' and a.purpose = 'lesson'
     order by a.created_at desc
     limit 1`;
  const row = rows[0];
  return row
    ? {
        id: row.id,
        status: row.status,
        provider: row.provider,
        providerAssetId: row.provider_asset_id,
        durationSeconds: row.duration_seconds,
        failureReason: row.failure_reason,
      }
    : null;
}

/** A video asset as the ready-event job left it: status, the closed failure reason, the seconds. */
export async function lessonAssetState(assetId: string): Promise<LessonAssetState | null> {
  const rows = await sql()<
    {
      id: string;
      status: string;
      provider: string;
      provider_asset_id: string | null;
      duration_seconds: number | null;
      failure_reason: string | null;
    }[]
  >`
    select id::text as id, status, provider, provider_asset_id, duration_seconds, failure_reason
      from public.media_assets
     where id = ${assetId}::uuid`;
  const row = rows[0];
  return row
    ? {
        id: row.id,
        status: row.status,
        provider: row.provider,
        providerAssetId: row.provider_asset_id,
        durationSeconds: row.duration_seconds,
        failureReason: row.failure_reason,
      }
    : null;
}

/**
 * Drops the fake provider's DEFERRED synthetic ready job for `assetId` — the two-second "transcode"
 * its `createDirectUpload` schedules under `singletonKey = fake-ready-<assetId>` — so a spec that
 * plays the provider itself through `markAssetReady` cannot be overtaken by the fake's own 12 s
 * answer should a worker be polling (`apps/api/tests/integration/mux-webhook.test.ts` deletes the
 * same rows). Harmless when no worker runs: the job would only sit in the queue.
 */
export async function dropFakeReadyJob(assetId: string): Promise<void> {
  await sql()`
    delete from pgboss.job_common
     where name = 'kernel.media-provider-event' and singleton_key = ${`fake-ready-${assetId}`}`;
}

/** The API the Playwright config starts (or reuses) as a webServer. */
const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';
/** The fake provider's local-stack throwaway secret (`packages/core/server/media/video/fake.ts`); never a real credential. */
const FAKE_VIDEO_WEBHOOK_SECRET =
  process.env.FAKE_VIDEO_WEBHOOK_SECRET ?? 'rede-social-local-fake-video-webhook-secret';

/**
 * Delivers a `video.asset.ready` webhook for `assetId` to the API the way the provider would — the
 * provider's wire shape, the fake's HMAC-SHA256 over `${t}.${rawBody}` in the `mux-signature` header
 * — so the ready-event JOB (a running `ROLE=worker`, `ensureWorker()`) measures the duration against
 * the asset's purpose cap: 14 401 s on a `lesson` asset is `rejected` / `duration_too_long` and the
 * provider asset is deleted (08.3-03 P46, the E09 long-text backstop). Returns the HTTP status.
 */
export async function deliverFakeReadyEvent(opts: {
  assetId: string;
  providerAssetId: string;
  durationSeconds: number;
}): Promise<number> {
  const raw = JSON.stringify({
    id: `fake-evt-e2e-${opts.assetId}-${Date.now().toString(36)}`,
    type: 'video.asset.ready',
    created_at: new Date().toISOString(),
    object: { type: 'asset', id: opts.providerAssetId },
    environment: { name: 'local', id: 'local' },
    data: {
      id: opts.providerAssetId,
      status: 'ready',
      passthrough: opts.assetId,
      duration: opts.durationSeconds,
      aspect_ratio: '16:9',
      playback_ids: [{ id: `fake-playback-${opts.assetId}`, policy: 'signed' }],
    },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const mac = createHmac('sha256', FAKE_VIDEO_WEBHOOK_SECRET)
    .update(`${timestamp}.${raw}`)
    .digest('hex');
  const res = await fetch(`${API_URL}/v1/webhooks/mux`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'mux-signature': `t=${timestamp},v1=${mac}` },
    body: raw,
  });
  return res.status;
}

/**
 * Removes the provider events the e2e delivered through `deliverFakeReadyEvent` (ids prefixed
 * `fake-evt-e2e-`): `media_provider_events` has no tenant and is pruned by nothing else, and pgTAP
 * `020-tenant-isolation.sql` counts its rows on the stack `pnpm verify` runs it against BEFORE its
 * own `db:reset` — a spec that leaves its deliveries behind fails that assertion on the next gate.
 */
export async function deleteFakeProviderEvents(): Promise<void> {
  await sql()`delete from public.media_provider_events where id like 'fake-evt-e2e-%'`;
}
