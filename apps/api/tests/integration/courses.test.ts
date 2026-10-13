import { randomUUID } from 'node:crypto';
import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import { mediaProviderEventJob } from '@rede-social/core/server/media/video/event-job';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import type {
  Category,
  CategoryList,
  CourseDetail,
  LessonView,
  ModuleView,
} from '@rede-social/module-courses/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs, withModuleEnabled } from './setup';

/**
 * The 08.3 courses tracer (08.3-01, SC 1, SC 2, SC 3, COURSE-01..03, COURSE-12) against the live
 * local stack and the real seed: an admin creates a course, a module and a lesson whose video rides
 * the EXISTING media pipeline as a `lesson`-purpose asset under `VIDEO_PROVIDER=fake`, is refused
 * publishing while that video is not ready (D-413, the publish guard reads `media_assets.status`
 * inside the status transaction), and publishes once the provider's `video.asset.ready` event has
 * been applied. The module switch, the permission and the product-gate seam are enforced in
 * Postgres; the API only asks.
 *
 * The seed leaves `courses` OFF (COURSE-01), so `withModuleEnabled('demo', 'courses')` turns it on
 * in `beforeAll` and its restore puts the previous row back in `afterAll`. Every course and asset
 * this file creates carries the prefix `cr-<run>`, and both hooks sweep that prefix with `adminSql`
 * (courses first — modules, lessons and links cascade — then the lesson assets).
 *
 * What is proved here:
 *  - `courses tracer` (truth 1): `POST /v1/courses` answers 201 `draft`; `POST …/modules` 201 at
 *    position 1; `POST /v1/media/uploads { kind: 'video', purpose: 'lesson' }` is accepted for the
 *    admin; `POST …/lessons` 201 with `videoStatus: 'pending'`; `PUT …/status published` answers
 *    409 `{ courses: 'video_not_ready', lessonIds }` and the course stays `draft`; after the fake
 *    `video.asset.ready` event (the mux-webhook.test.ts shape) the publish answers 200 and the
 *    detail carries `published`, `publishedAt`, the lesson `ready` with the asset's duration. A
 *    second case applies the ready event BEFORE the first publish attempt and publishes at once
 *    (P23's other order). Then `video_in_use`, the practice lesson, and the whole lifecycle
 *    (unpublish, archive, out of archived, idempotent same-status).
 *  - `permission and module matrix`: the seed `member` and `support_tenant` get 403 on all five
 *    routes and a member cannot start a `lesson` upload (COURSE-12); with the module row disabled,
 *    then deleted (P02), every route answers 404 `MODULE_DISABLED` and `app.course_locked_ids()`
 *    answers `{}` for the member while a link row exists; re-enabling twice leaves ONE row (P04);
 *    the member's bootstrap carries no `/cursos` nav item while the module is on (P01, D-401).
 *  - `categories` (08.3-04, D-411, COURSE-04, P13-P16): the list with its counts, create, edit,
 *    remove; names unique ignoring case (`category_exists`), removal refused while any course —
 *    archived included — references the category (`category_in_use` with `courseCount`); the same
 *    name in rede-lab is allowed; member and support get 403; unknown ids are the bare 404.
 *
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

type Envelope = {
  error: { code: string; message?: string; details?: Record<string, unknown> };
};

const RUN = Date.now();
/** The prefix every course and asset THIS FILE writes carries, so the sweep can be exact. */
const PREFIX = `cr-${RUN}`;
/** The fake provider reports this duration in the ready event (well under the 4 h lesson cap). */
const LESSON_SECONDS = 600;

const tokens = { demoAdmin: '', demoMember: '', demoSupport: '', labAdmin: '' };
let demoTenantId = '';
let labTenantId = '';
let demoMemberUserId = '';
let restoreCourses: () => Promise<void> = async () => {};
let restoreLabCourses: () => Promise<void> = async () => {};

const request = (method: string, path: string, token: string, body?: unknown, host = HOSTS.demo) =>
  api.request(path, {
    method,
    headers: {
      [TENANT_HOST_HEADER]: host,
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

async function json<T>(res: Response, status: number): Promise<T> {
  expect(res.status).toBe(status);
  return (await res.json()) as T;
}

/** Removes everything a run of this file (or an interrupted earlier run) left behind. */
async function sweep(): Promise<void> {
  // Modules, lessons and product links cascade with the course; categories go after their courses
  // (`on delete restrict`), assets after everything that references them.
  await adminSql`delete from public.courses where title like ${'cr-%'}`;
  await adminSql`delete from public.course_categories where name like ${'cr-%'}`;
  await adminSql`delete from public.store_products where name like ${'cr-%'}`;
  await adminSql`delete from public.media_assets where filename like ${'cr-%'}`;
}

/**
 * One media row in a KNOWN tuple through the admin connection (the communities.test.ts fixture):
 * the covers the category and course cases attach, in a status the service accepts or refuses.
 */
async function seedAsset(
  tenantId: string,
  kind: 'image' | 'video',
  purpose: string,
  status: 'ready' | 'pending',
): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, width, height,
       variant_widths, filename, ready_at)
    select ${tenantId}::uuid, m.user_id, ${kind}, ${purpose}, ${status}, 'supabase',
           ${kind === 'video' ? 'video/mp4' : 'image/webp'}, 262144, 1600, 700,
           ${status === 'ready' ? '{320,640,960,1280}' : '{}'}::int[],
           ${`${PREFIX}-${kind}-${purpose}-${status}.webp`},
           ${status === 'ready' ? new Date().toISOString() : null}::timestamptz
      from public.memberships m
     where m.tenant_id = ${tenantId}::uuid and m.role = 'admin_tenant'
     limit 1
    returning id::text as id`;
  if (!row) throw new Error(`could not seed a ${kind}/${purpose}/${status} asset`);
  return row.id;
}

async function createCourse(extra: Record<string, unknown> = {}): Promise<CourseDetail> {
  return json<CourseDetail>(
    await request('POST', '/v1/courses', tokens.demoAdmin, {
      title: `${PREFIX} curso`,
      instructorName: 'Dra. Ana',
      ...extra,
    }),
    201,
  );
}

async function createModule(courseId: string, body: Record<string, unknown> = {}) {
  return json<ModuleView>(
    await request('POST', `/v1/courses/${courseId}/modules`, tokens.demoAdmin, {
      title: `${PREFIX} módulo`,
      ...body,
    }),
    201,
  );
}

async function createLesson(moduleId: string, body: Record<string, unknown> = {}) {
  return request('POST', `/v1/courses/modules/${moduleId}/lessons`, tokens.demoAdmin, {
    title: `${PREFIX} aula`,
    ...body,
  });
}

async function getCourse(courseId: string, token = tokens.demoAdmin): Promise<CourseDetail> {
  return json<CourseDetail>(await request('GET', `/v1/courses/${courseId}`, token), 200);
}

async function setStatus(courseId: string, status: string, token = tokens.demoAdmin) {
  return request('PUT', `/v1/courses/${courseId}/status`, token, { status });
}

/**
 * A `lesson` video upload through the REAL broker (COURSE-12: the existing `POST /v1/media/uploads`
 * with the new purpose, under the fake provider), so the row carries the provider and its upload
 * id. The bytes are never uploaded: what matters here is the row's status and the webhook's effect.
 */
async function startLessonVideo(
  token = tokens.demoAdmin,
): Promise<{ assetId: string; providerAssetId: string }> {
  const res = await request('POST', '/v1/media/uploads', token, {
    kind: 'video',
    purpose: 'lesson',
    mime: 'video/mp4',
    size: 4096,
    filename: `${PREFIX}-aula.mp4`,
  });
  const { assetId } = await json<{ assetId: string }>(res, 201);
  const [row] = await adminSql<{ provider_asset_id: string | null; status: string }[]>`
    select provider_asset_id, status from public.media_assets where id = ${assetId}::uuid`;
  expect(row?.status).toBe('pending');
  return { assetId, providerAssetId: row?.provider_asset_id ?? '' };
}

/** The NORMALISED `video.asset.ready` event the kernel job consumes (the mux-webhook.test.ts shape). */
async function applyReady(asset: { assetId: string; providerAssetId: string }): Promise<void> {
  await mediaProviderEventJob.handler({
    id: `evt-${randomUUID()}`,
    kind: 'ready',
    rawType: 'video.asset.ready',
    assetId: asset.assetId,
    providerAssetId: asset.providerAssetId,
    playbackId: `pb-${asset.assetId}`,
    durationSeconds: LESSON_SECONDS,
    aspectRatio: '16:9',
    failureReason: null,
  });
  const [row] = await adminSql<{ status: string }[]>`
    select status from public.media_assets where id = ${asset.assetId}::uuid`;
  expect(row?.status).toBe('ready');
}

async function expectForbidden(res: Response): Promise<void> {
  expect(res.status).toBe(403);
  expect(((await res.json()) as Envelope).error.code).toBe('FORBIDDEN');
}

async function expectModuleDisabled(res: Response): Promise<void> {
  expect(res.status).toBe(404);
  expect(((await res.json()) as Envelope).error.code).toBe('MODULE_DISABLED');
}

/** Turns `courses` on for the demo tenant (an upsert) and drops the API's flag cache for it. */
async function coursesOn(): Promise<void> {
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${demoTenantId}::uuid, 'courses', true)
    on conflict (tenant_id, module_key) do update set enabled = true, updated_at = now()`;
  moduleFlags.invalidate(demoTenantId);
}

/** `app.course_locked_ids()` as the member lane would see it, in one admin-connection transaction. */
async function memberLockedIds(): Promise<string[]> {
  return adminSql.begin(async (sql) => {
    const claims = JSON.stringify({
      sub: demoMemberUserId,
      role: 'authenticated',
      tenant_id: demoTenantId,
      tenant_role: 'member',
    });
    await sql`select set_config('request.jwt.claims', ${claims}, true)`;
    await sql`set local role authenticated`;
    const [row] = await sql<{ ids: string[] }[]>`select app.course_locked_ids()::text[] as ids`;
    return row?.ids ?? [];
  });
}

beforeAll(async () => {
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.demoSupport = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  const [demo] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-demo'`;
  demoTenantId = demo?.id ?? '';
  const [lab] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-lab'`;
  labTenantId = lab?.id ?? '';
  const [member] = await adminSql<{ id: string }[]>`
    select u.id::text as id from public.users u
     join auth.users a on a.id = u.id
    where a.email = 'member@rede-demo.local'`;
  demoMemberUserId = member?.id ?? '';
  await sweep();
  restoreCourses = await withModuleEnabled('demo', 'courses');
  restoreLabCourses = await withModuleEnabled('lab', 'courses');
});

afterAll(async () => {
  await restoreLabCourses();
  await restoreCourses();
  await sweep();
});

describe('courses tracer', () => {
  it('an admin creates a course, a module and a video lesson, is refused publishing until the video is ready, then publishes (SC 1-3, D-413)', async () => {
    const course = await createCourse({
      tagline: 'Do zero ao avançado',
      outcomes: ['Avaliar', 'Planejar'],
    });
    expect(course.status).toBe('draft');
    expect(course.publishedAt).toBeNull();
    expect(course.products).toEqual([]);
    expect(course.modules).toEqual([]);
    expect(course.outcomes).toEqual(['Avaliar', 'Planejar']);
    expect(course.hasUnreadyVideo).toBe(false);

    // The first module never requires a previous one, whatever the body says (UI-D-396).
    const module = await createModule(course.id, { requiresPrevious: true });
    expect(module.position).toBe(1);
    expect(module.requiresPrevious).toBe(false);
    expect(module.lessons).toEqual([]);

    const asset = await startLessonVideo();
    const lessonRes = await createLesson(module.id, { videoAssetId: asset.assetId });
    const lesson = await json<LessonView>(lessonRes, 201);
    expect(lesson.moduleId).toBe(module.id);
    expect(lesson.position).toBe(1);
    expect(lesson.videoAssetId).toBe(asset.assetId);
    expect(lesson.videoStatus).toBe('pending');
    expect(lesson.durationSeconds).toBeNull();

    // The publish guard: the video is still processing, so nothing is written.
    const refused = await setStatus(course.id, 'published');
    expect(refused.status).toBe(409);
    const envelope = (await refused.json()) as Envelope;
    expect(envelope.error.code).toBe('CONFLICT');
    expect(envelope.error.details).toEqual({ courses: 'video_not_ready', lessonIds: [lesson.id] });
    const stillDraft = await getCourse(course.id);
    expect(stillDraft.status).toBe('draft');
    expect(stillDraft.publishedAt).toBeNull();
    expect(stillDraft.hasUnreadyVideo).toBe(true);
    expect(stillDraft.unreadyLessonIds).toEqual([lesson.id]);
    expect(stillDraft.modules[0]?.lessons[0]?.videoStatus).toBe('pending');

    // The provider reports the asset ready; the retry publishes.
    await applyReady(asset);
    const published = await json<CourseDetail>(await setStatus(course.id, 'published'), 200);
    expect(published.status).toBe('published');
    expect(published.publishedAt).not.toBeNull();

    const detail = await getCourse(course.id);
    expect(detail.status).toBe('published');
    expect(detail.publishedAt).toBe(published.publishedAt);
    expect(detail.moduleCount).toBe(1);
    expect(detail.lessonCount).toBe(1);
    expect(detail.durationSeconds).toBe(LESSON_SECONDS);
    expect(detail.hasUnreadyVideo).toBe(false);
    expect(detail.unreadyLessonIds).toEqual([]);
    const readLesson = detail.modules[0]?.lessons[0];
    expect(detail.modules[0]?.id).toBe(module.id);
    expect(detail.modules[0]?.durationSeconds).toBe(LESSON_SECONDS);
    expect(readLesson?.id).toBe(lesson.id);
    expect(readLesson?.videoStatus).toBe('ready');
    expect(readLesson?.durationSeconds).toBe(LESSON_SECONDS);
  });

  it('P23, the other order: a ready event applied BEFORE the first publish attempt publishes at once', async () => {
    const course = await createCourse();
    const module = await createModule(course.id);
    const asset = await startLessonVideo();
    await applyReady(asset);
    const lesson = await json<LessonView>(
      await createLesson(module.id, { videoAssetId: asset.assetId }),
      201,
    );
    expect(lesson.videoStatus).toBe('ready');
    expect(lesson.durationSeconds).toBe(LESSON_SECONDS);
    const published = await json<CourseDetail>(await setStatus(course.id, 'published'), 200);
    expect(published.status).toBe('published');
    expect(published.hasUnreadyVideo).toBe(false);
  });

  it('one video per live lesson (P22): the same asset twice is 400 video_in_use; a practice lesson has no video and never blocks publishing', async () => {
    const course = await createCourse();
    const module = await createModule(course.id);
    const asset = await startLessonVideo();
    await json<LessonView>(await createLesson(module.id, { videoAssetId: asset.assetId }), 201);
    const reused = await createLesson(module.id, { videoAssetId: asset.assetId });
    expect(reused.status).toBe(400);
    expect(((await reused.json()) as Envelope).error.details).toEqual({ courses: 'video_in_use' });
    // An unknown asset id is refused by NAME, not by a 404 (the isolation sweep relies on it).
    const unknown = await createLesson(module.id, { videoAssetId: randomUUID() });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as Envelope).error.details).toEqual({
      courses: 'video_invalid',
    });

    const practice = await json<LessonView>(
      await createLesson(module.id, { title: `${PREFIX} prática`, isFree: true }),
      201,
    );
    expect(practice.position).toBe(2);
    expect(practice.videoAssetId).toBeNull();
    expect(practice.videoStatus).toBe('none');
    expect(practice.isFree).toBe(true);

    // Only the pending video blocks; once ready, the practice lesson was never in the way.
    const refused = await setStatus(course.id, 'published');
    expect(refused.status).toBe(409);
    await applyReady(asset);
    const published = await json<CourseDetail>(await setStatus(course.id, 'published'), 200);
    expect(published.lessonCount).toBe(2);
    expect(published.durationSeconds).toBe(LESSON_SECONDS);

    // A second module may require the previous one; the view carries it.
    const second = await createModule(course.id, { requiresPrevious: true });
    expect(second.position).toBe(2);
    expect(second.requiresPrevious).toBe(true);
  });

  it('the lifecycle: unpublish keeps publishedAt, archive sets archivedAt, out of archived is 409 status_invalid, the same status is a no-op', async () => {
    const course = await createCourse();
    const published = await json<CourseDetail>(await setStatus(course.id, 'published'), 200);
    expect(published.publishedAt).not.toBeNull();

    // Idempotent: the same status answers 200 and leaves `updated_at` alone.
    const [before] = await adminSql<{ updated_at: string }[]>`
      select updated_at::text as updated_at from public.courses where id = ${course.id}::uuid`;
    const same = await json<CourseDetail>(await setStatus(course.id, 'published'), 200);
    expect(same.status).toBe('published');
    const [after] = await adminSql<{ updated_at: string }[]>`
      select updated_at::text as updated_at from public.courses where id = ${course.id}::uuid`;
    expect(after?.updated_at).toBe(before?.updated_at);

    const unpublished = await json<CourseDetail>(await setStatus(course.id, 'draft'), 200);
    expect(unpublished.status).toBe('draft');
    expect(unpublished.publishedAt).toBe(published.publishedAt);
    expect(unpublished.archivedAt).toBeNull();

    const archived = await json<CourseDetail>(await setStatus(course.id, 'archived'), 200);
    expect(archived.status).toBe('archived');
    expect(archived.archivedAt).not.toBeNull();

    for (const status of ['published', 'draft']) {
      const res = await setStatus(course.id, status);
      expect(res.status).toBe(409);
      expect(((await res.json()) as Envelope).error.details).toEqual({ courses: 'status_invalid' });
    }
    const stillArchived = await json<CourseDetail>(await setStatus(course.id, 'archived'), 200);
    expect(stillArchived.archivedAt).toBe(archived.archivedAt);
    // Archive never deletes: the row is still the admin's to read.
    expect((await getCourse(course.id)).status).toBe('archived');
  });
});

describe('permission and module matrix', () => {
  it('the seed member and support get 403 on all five routes, and a member cannot start a lesson upload (D-403, COURSE-12)', async () => {
    const course = await createCourse();
    const module = await createModule(course.id);
    for (const token of [tokens.demoMember, tokens.demoSupport]) {
      await expectForbidden(
        await request('POST', '/v1/courses', token, { title: `${PREFIX} x`, instructorName: 'x' }),
      );
      await expectForbidden(await request('GET', `/v1/courses/${course.id}`, token));
      await expectForbidden(
        await request('POST', `/v1/courses/${course.id}/modules`, token, { title: 'x' }),
      );
      await expectForbidden(
        await request('POST', `/v1/courses/modules/${module.id}/lessons`, token, { title: 'x' }),
      );
      await expectForbidden(await setStatus(course.id, 'published', token));
    }
    // COURSE-12: the lesson purpose is refused for a member exactly as `post` is (by role).
    const memberUpload = await request('POST', '/v1/media/uploads', tokens.demoMember, {
      kind: 'video',
      purpose: 'lesson',
      mime: 'video/mp4',
      size: 4096,
    });
    await expectForbidden(memberUpload);
    const [count] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.courses where title = ${`${PREFIX} x`}`;
    expect(count?.n).toBe(0);
  });

  it('with the module disabled, then with no row (P02), every route answers 404 MODULE_DISABLED and the gate answers {}; re-enabling twice leaves one row (P04); the member bootstrap carries no /cursos nav (P01)', async () => {
    const course = await createCourse();
    const module = await createModule(course.id);
    // A link row, so the gate has something to lock: a product of the tenant, linked by hand.
    const [product] = await adminSql<{ id: string }[]>`
      insert into public.store_products (tenant_id, created_by_user_id, name, price_cents)
      select ${demoTenantId}::uuid, m.user_id, ${`${PREFIX} produto`}, 1990
        from public.memberships m
       where m.tenant_id = ${demoTenantId}::uuid and m.role = 'admin_tenant'
       limit 1
      returning id::text as id`;
    await adminSql`
      insert into public.course_products (tenant_id, course_id, product_id)
      values (${demoTenantId}::uuid, ${course.id}::uuid, ${product?.id ?? ''}::uuid)`;
    // With the module on and the store on (the seed), the member is locked out of that course.
    expect(await memberLockedIds()).toEqual([course.id]);

    const everyRoute = async (check: (res: Response) => Promise<void>) => {
      await check(
        await request('POST', '/v1/courses', tokens.demoAdmin, {
          title: `${PREFIX} off`,
          instructorName: 'x',
        }),
      );
      await check(await request('GET', `/v1/courses/${course.id}`, tokens.demoAdmin));
      await check(
        await request('POST', `/v1/courses/${course.id}/modules`, tokens.demoAdmin, { title: 'x' }),
      );
      await check(
        await request('POST', `/v1/courses/modules/${module.id}/lessons`, tokens.demoAdmin, {
          title: 'x',
        }),
      );
      await check(await setStatus(course.id, 'published'));
    };

    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${demoTenantId}::uuid and module_key = 'courses'`;
    moduleFlags.invalidate(demoTenantId);
    await everyRoute(expectModuleDisabled);
    expect(await memberLockedIds()).toEqual([]);

    await adminSql`
      delete from public.tenant_modules
       where tenant_id = ${demoTenantId}::uuid and module_key = 'courses'`;
    moduleFlags.invalidate(demoTenantId);
    await everyRoute(expectModuleDisabled);
    expect(await memberLockedIds()).toEqual([]);
    const [offCount] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.courses where title = ${`${PREFIX} off`}`;
    expect(offCount?.n).toBe(0);

    // P04: re-enabling twice leaves ONE row, and the rows the module owns are untouched.
    await coursesOn();
    await coursesOn();
    const [rows] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.tenant_modules
       where tenant_id = ${demoTenantId}::uuid and module_key = 'courses'`;
    expect(rows?.n).toBe(1);
    const back = await getCourse(course.id);
    expect(back.id).toBe(course.id);
    expect(back.modules.map((m) => m.id)).toEqual([module.id]);
    expect(back.products.map((p) => p.id)).toEqual([product?.id]);
    expect(await memberLockedIds()).toEqual([course.id]);

    // P01 / D-401: the module is on, and the member's shell still has nothing to link to.
    const bootstrap = await json<{
      modules: { key: string; nav?: { href: string } }[];
      permissions: string[];
    }>(await request('GET', '/v1/me/bootstrap', tokens.demoMember), 200);
    const coursesEntry = bootstrap.modules.find((m) => m.key === 'courses');
    expect(coursesEntry).toBeDefined();
    expect(coursesEntry?.nav).toBeUndefined();
    expect(bootstrap.modules.some((m) => m.nav?.href === '/cursos')).toBe(false);
    expect(bootstrap.permissions).not.toContain('courses.manage');
    const adminBootstrap = await json<{ permissions: string[] }>(
      await request('GET', '/v1/me/bootstrap', tokens.demoAdmin),
      200,
    );
    expect(adminBootstrap.permissions).toContain('courses.manage');
  });
});

describe('categories', () => {
  const categoriesPath = '/v1/courses/categories';
  const createCategory = (
    body: Record<string, unknown>,
    token = tokens.demoAdmin,
    host = HOSTS.demo,
  ) => request('POST', categoriesPath, token, body, host);
  const patchCategory = (
    id: string,
    body: Record<string, unknown>,
    token = tokens.demoAdmin,
    host = HOSTS.demo,
  ) => request('PATCH', `${categoriesPath}/${id}`, token, body, host);
  const deleteCategory = (id: string, token = tokens.demoAdmin, host = HOSTS.demo) =>
    request('DELETE', `${categoriesPath}/${id}`, token, undefined, host);
  const listCategories = async (token = tokens.demoAdmin, host = HOSTS.demo) =>
    json<CategoryList>(await request('GET', categoriesPath, token, undefined, host), 200);
  /** The categories THIS FILE created, in the API's order (the seed may carry others). */
  const ours = (list: CategoryList) => list.items.filter((item) => item.name.startsWith(PREFIX));

  it('P14 / P16: the list is empty on a tenant with no category, two categories list by name with courseCount 0, and the count follows a course through attach, archive and detach', async () => {
    // rede-lab has no category at all: the empty answer is observable there (P14).
    expect(await listCategories(tokens.labAdmin, HOSTS.lab)).toEqual({ items: [] });
    expect(ours(await listCategories())).toEqual([]);

    const beta = await json<Category>(await createCategory({ name: `${PREFIX} Beta` }), 201);
    const alfa = await json<Category>(await createCategory({ name: `  ${PREFIX} alfa  ` }), 201);
    expect(beta).toEqual({
      id: beta.id,
      name: `${PREFIX} Beta`,
      coverAssetId: null,
      courseCount: 0,
    });
    expect(alfa.name).toBe(`${PREFIX} alfa`);
    // `lower(name), id`: the lower-case "alfa" sorts before "Beta" (P16).
    expect(ours(await listCategories()).map((item) => item.id)).toEqual([alfa.id, beta.id]);

    // A course in the category counts while it is not archived.
    const course = await createCourse({ categoryId: alfa.id });
    expect(course.category).toEqual({ id: alfa.id, name: alfa.name });
    expect(ours(await listCategories()).map((item) => item.courseCount)).toEqual([1, 0]);
    // An unknown category id on a course is 400 category_invalid, and a lab category too.
    const labCategory = await json<Category>(
      await createCategory({ name: `${PREFIX} lab` }, tokens.labAdmin, HOSTS.lab),
      201,
    );
    for (const categoryId of [randomUUID(), labCategory.id]) {
      const res = await request('POST', '/v1/courses', tokens.demoAdmin, {
        title: `${PREFIX} x`,
        instructorName: 'x',
        categoryId,
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as Envelope).error.details).toEqual({
        courses: 'category_invalid',
      });
    }

    // Archived: the hub count drops to 0 (P16)…
    await json<CourseDetail>(await setStatus(course.id, 'archived'), 200);
    expect(ours(await listCategories()).map((item) => item.courseCount)).toEqual([0, 0]);
    // …but the delete still refuses, naming EVERY course including the archived one.
    const inUse = await deleteCategory(alfa.id);
    expect(inUse.status).toBe(409);
    const envelope = (await inUse.json()) as Envelope;
    expect(envelope.error.code).toBe('CONFLICT');
    expect(envelope.error.details).toEqual({ courses: 'category_in_use', courseCount: 1 });
    expect(ours(await listCategories()).map((item) => item.id)).toEqual([alfa.id, beta.id]);
    expect((await getCourse(course.id)).category?.id).toBe(alfa.id);

    // Detached (the course keeps everything else), the empty category goes with a 204 and no body.
    await adminSql`update public.courses set category_id = null where id = ${course.id}::uuid`;
    expect((await getCourse(course.id)).category).toBeNull();
    const removed = await deleteCategory(alfa.id);
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe('');
    expect(ours(await listCategories()).map((item) => item.id)).toEqual([beta.id]);
    expect((await getCourse(course.id)).status).toBe('archived');
    // Deleting the last empty category leaves every course untouched (P14).
    expect((await deleteCategory(beta.id)).status).toBe(204);
    expect(ours(await listCategories())).toEqual([]);
    expect((await getCourse(course.id)).id).toBe(course.id);
    // A second delete of the same id is the bare 404.
    const gone = await deleteCategory(beta.id);
    expect(gone.status).toBe(404);
    expect((await gone.json()) as Envelope).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect((await deleteCategory(labCategory.id, tokens.labAdmin, HOSTS.lab)).status).toBe(204);
  });

  it('P13 / P15: names are unique per tenant ignoring case on create and rename, the same name in rede-lab is allowed, and the 60-code-point cap is measured after the trim', async () => {
    const labios = await json<Category>(await createCategory({ name: `${PREFIX} Lábios` }), 201);
    const dup = await createCategory({ name: `${PREFIX} lábios` });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as Envelope).error.details).toEqual({ courses: 'category_exists' });
    const padded = await createCategory({ name: `  ${PREFIX} LÁBIOS  ` });
    expect(padded.status).toBe(409);
    expect(ours(await listCategories()).map((item) => item.id)).toEqual([labios.id]);

    // Renaming onto another's name ignoring case is 409; onto its own in another case is 200.
    const olhos = await json<Category>(await createCategory({ name: `${PREFIX} Olhos` }), 201);
    const clash = await patchCategory(olhos.id, { name: `${PREFIX} LÁBIOS` });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as Envelope).error.details).toEqual({
      courses: 'category_exists',
    });
    const recased = await json<Category>(
      await patchCategory(olhos.id, { name: `${PREFIX} OLHOS` }),
      200,
    );
    expect(recased.name).toBe(`${PREFIX} OLHOS`);
    const renamed = await json<Category>(
      await patchCategory(olhos.id, { name: `${PREFIX} Sobrancelhas` }),
      200,
    );
    expect(renamed).toEqual({ ...olhos, name: `${PREFIX} Sobrancelhas` });

    // The same name in another tenant is its own row (P13).
    const labTwin = await createCategory({ name: `${PREFIX} Lábios` }, tokens.labAdmin, HOSTS.lab);
    expect(labTwin.status).toBe(201);
    const labTwinId = ((await labTwin.json()) as Category).id;
    expect(labTwinId).not.toBe(labios.id);
    expect((await listCategories(tokens.labAdmin, HOSTS.lab)).items.map((i) => i.id)).toEqual([
      labTwinId,
    ]);

    // P15: 60 code points pass (emoji count once), 61 fail; the trim happens first.
    const sixty = `${PREFIX}-${'é'.repeat(60 - PREFIX.length - 1)}`;
    expect(sixty.length).toBe(60);
    const atCap = await createCategory({ name: `  ${sixty}  ` });
    expect(atCap.status).toBe(201);
    expect(((await atCap.json()) as Category).name).toBe(sixty);
    const overCap = await createCategory({ name: `${sixty}x` });
    expect(overCap.status).toBe(400);
    expect(((await overCap.json()) as Envelope).error.details).toEqual({
      courses: 'title_too_long',
    });
    const emoji = `${PREFIX} ${'😀'.repeat(60 - PREFIX.length - 1)}`;
    expect([...emoji].length).toBe(60);
    expect((await createCategory({ name: emoji })).status).toBe(201);
    const blank = await createCategory({ name: '   ' });
    expect(blank.status).toBe(400);
    expect(((await blank.json()) as Envelope).error.details).toEqual({ courses: 'title_required' });
    // Strict bodies: an unknown key and an empty patch are 400 without a courses code.
    const unknownKey = await createCategory({ name: `${PREFIX} z`, icon: 'star' });
    expect(unknownKey.status).toBe(400);
    expect(((await unknownKey.json()) as Envelope).error.details).toHaveProperty('issues');
    const empty = await patchCategory(labios.id, {});
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as Envelope).error.details).toEqual({ courses: 'patch_empty' });

    await adminSql`delete from public.course_categories where id = ${labTwinId}::uuid`;
  });

  it('a cover must be a ready cover image of this tenant: ready attaches and detaches, pending / another kind / unknown / rede-lab are 400 cover_invalid by name (T-08.3-02)', async () => {
    const ready = await seedAsset(demoTenantId, 'image', 'cover', 'ready');
    const pending = await seedAsset(demoTenantId, 'image', 'cover', 'pending');
    const avatar = await seedAsset(demoTenantId, 'image', 'avatar', 'ready');
    const labCover = await seedAsset(labTenantId, 'image', 'cover', 'ready');

    const created = await json<Category>(
      await createCategory({ name: `${PREFIX} Capa`, coverAssetId: ready }),
      201,
    );
    expect(created.coverAssetId).toBe(ready);
    for (const coverAssetId of [pending, avatar, randomUUID(), labCover]) {
      const res = await createCategory({ name: `${PREFIX} Capa 2`, coverAssetId });
      expect(res.status, coverAssetId).toBe(400);
      expect(((await res.json()) as Envelope).error.details).toEqual({ courses: 'cover_invalid' });
      const patched = await patchCategory(created.id, { coverAssetId });
      expect(patched.status, coverAssetId).toBe(400);
      expect(((await patched.json()) as Envelope).error.details).toEqual({
        courses: 'cover_invalid',
      });
    }
    expect(ours(await listCategories()).filter((i) => i.name === `${PREFIX} Capa 2`)).toEqual([]);
    const cleared = await json<Category>(
      await patchCategory(created.id, { coverAssetId: null }),
      200,
    );
    expect(cleared.coverAssetId).toBeNull();
    const back = await json<Category>(
      await patchCategory(created.id, { coverAssetId: ready }),
      200,
    );
    expect(back.coverAssetId).toBe(ready);
    // The lab's own cover on its own category is the positive control for the foreign refusal.
    const labOwn = await createCategory(
      { name: `${PREFIX} Capa lab`, coverAssetId: labCover },
      tokens.labAdmin,
      HOSTS.lab,
    );
    expect(labOwn.status).toBe(201);
    await adminSql`
      delete from public.course_categories where id = ${((await labOwn.json()) as Category).id}::uuid`;
  });

  it('member and support get 403 on all four category routes; an unknown or foreign id is the bare 404 for the admin (D-403, T-08.3-20)', async () => {
    const category = await json<Category>(await createCategory({ name: `${PREFIX} Perm` }), 201);
    const labCategory = await json<Category>(
      await createCategory({ name: `${PREFIX} Perm lab` }, tokens.labAdmin, HOSTS.lab),
      201,
    );
    for (const token of [tokens.demoMember, tokens.demoSupport]) {
      await expectForbidden(await request('GET', categoriesPath, token));
      await expectForbidden(await createCategory({ name: `${PREFIX} nope` }, token));
      await expectForbidden(await patchCategory(category.id, { name: `${PREFIX} nope` }, token));
      await expectForbidden(await deleteCategory(category.id, token));
    }
    // Nothing was written by the refused calls; the four named rows still list in `lower(name)` order.
    const names = ours(await listCategories()).map((item) => item.name);
    expect(names).not.toContain(`${PREFIX} nope`);
    const named = names.filter((name) => / (Capa|Lábios|Perm|Sobrancelhas)$/.test(name));
    expect(named).toEqual([
      `${PREFIX} Capa`,
      `${PREFIX} Lábios`,
      `${PREFIX} Perm`,
      `${PREFIX} Sobrancelhas`,
    ]);
    for (const id of [randomUUID(), labCategory.id]) {
      for (const res of [
        await patchCategory(id, { name: `${PREFIX} ghost` }),
        await deleteCategory(id),
      ]) {
        expect(res.status).toBe(404);
        const body = (await res.json()) as Envelope;
        expect(body.error.code).toBe('NOT_FOUND');
        expect(body.error).not.toHaveProperty('details');
      }
    }
    // The lab's row is untouched by the demo admin's attempts, and its own admin removes it.
    expect((await listCategories(tokens.labAdmin, HOSTS.lab)).items).toEqual([labCategory]);
    expect((await deleteCategory(labCategory.id, tokens.labAdmin, HOSTS.lab)).status).toBe(204);
  });
});

describe('two-tenant media', () => {
  it('a rede-lab admin asking for the rede-demo lesson asset gets the bare 404 on the asset read and on playback, beside the demo positive control (COURSE-13)', async () => {
    const labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
    const asset = await startLessonVideo();
    const paths = [`/v1/media/${asset.assetId}`, `/v1/media/${asset.assetId}/playback`];
    // Positive control first: the demo admin reads its own pending asset (the playback is 409
    // `not_ready` until the provider reports ready, then 200).
    const own = await request('GET', paths[0] ?? '', tokens.demoAdmin);
    expect(own.status).toBe(200);
    expect(((await own.json()) as { purpose: string }).purpose).toBe('lesson');
    await applyReady(asset);
    const ownPlayback = await request('GET', paths[1] ?? '', tokens.demoAdmin);
    expect(ownPlayback.status).toBe(200);
    // The lab admin, on the lab host, resolves the id under ITS tenant, where nothing exists.
    for (const path of paths) {
      const res = await request('GET', path, labAdmin, undefined, HOSTS.lab);
      expect(res.status, path).toBe(404);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error).not.toHaveProperty('details');
    }
  });
});
