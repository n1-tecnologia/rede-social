import { randomUUID } from 'node:crypto';
import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import { mediaProviderEventJob } from '@rede-social/core/server/media/video/event-job';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import type {
  Category,
  CategoryList,
  CourseDetail,
  CoursePage,
  LessonDetail,
  LessonView,
  ModuleView,
  TrackDetail,
  TrackPage,
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
 *  - `catalogue` (08.3-04, COURSE-02, P06, P07, P09): `GET /v1/courses` on rede-lab — empty per
 *    filter, 25 rows as 20 + 5, two same-instant rows across a page boundary never repeat or skip,
 *    the four filters after a publish and an archive, refused cursors and limits; the per-row
 *    counts (`moduleCount`, `lessonCount`, `durationSeconds`, `hasUnreadyVideo`, `categoryName`).
 *  - `course admin` (08.3-04, D-404, D-405, D-412, D-413, COURSE-08, P10, P11, P33-P36): `PATCH`
 *    of every field, the product-link replace (archived / foreign / duplicate ids, the empty set,
 *    the same body twice keeping the link rows, two concurrent patches leaving exactly one set,
 *    links saved with the store off), the lifecycle matrix with its row counts, the same-title
 *    rows, the minimal create, `instructor_required`, 403s and the bare 404.
 *  - `publish guard reading` (08.3-04, P12 — the flagged assumption of 08.3-EDGE-COVERAGE, pinned
 *    here): a soft-deleted lesson is ignored; a lesson whose asset the lane cannot see counts as NOT
 *    ready; a lesson without video never blocks; zero modules or zero lessons may publish; the 409
 *    names only this course's lesson ids; archiving never consults readiness.
 * *  - `tracks` (08.3-10, D-414, D-415, COURSE-10, P39-P43): create with and without a cover, the
 *    keyset list per filter, the ONE write path of membership and order (`PUT …/order`: published
 *    courses only — a draft, an archived, an unknown, a foreign or a non-uuid id is `400
 *    course_invalid`; `[]` clears; the same list twice keeps the rows; a duplicate is 400; a course
 *    in two tracks), the admin read listing a no-longer-published course with its status while the
 *    row's count drops, the idempotent status round trip in both directions, two concurrent lists
 *    leaving exactly one, member and support 403, the bare 404.
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
  // Progress rows reference lessons without a cascade (D-408): an interrupted run's rows go first.
  await adminSql`
    delete from public.course_lesson_progress p
     using public.course_lessons l join public.courses c on c.id = l.course_id
     where p.lesson_id = l.id and c.title like ${'cr-%'}`;
  // Modules, lessons and product links cascade with the course; categories go after their courses
  // (`on delete restrict`), assets after everything that references them.
  // Track link rows cascade with their track; tracks before courses so no link outlives either.
  await adminSql`delete from public.course_tracks where title like ${'cr-%'}`;
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

const patchModule = (
  moduleId: string,
  body: Record<string, unknown>,
  token = tokens.demoAdmin,
  host = HOSTS.demo,
) => request('PATCH', `/v1/courses/modules/${moduleId}`, token, body, host);

const removeModule = (moduleId: string, token = tokens.demoAdmin, host = HOSTS.demo) =>
  request('DELETE', `/v1/courses/modules/${moduleId}`, token, undefined, host);

const reorderModules = (
  courseId: string,
  body: unknown,
  token = tokens.demoAdmin,
  host = HOSTS.demo,
) => request('PUT', `/v1/courses/${courseId}/modules/order`, token, body, host);

/** Every module row of a course as stored, deleted ones included: the stamps a no-op must not touch. */
async function moduleStamps(courseId: string) {
  return adminSql<{ id: string; position: number; deleted: boolean; updated_at: string }[]>`
    select id::text as id, position, deleted_at is not null as deleted, updated_at::text as updated_at
      from public.course_modules
     where course_id = ${courseId}::uuid
     order by id`;
}

/** A member's progress row on a lesson, written through the admin connection (no route writes it in 08.3). */
async function insertProgress(lessonId: string): Promise<void> {
  await adminSql`
    insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, last_position_seconds)
    values (${demoTenantId}::uuid, ${demoMemberUserId}::uuid, ${lessonId}::uuid, 30)`;
}

const getLesson = (lessonId: string, token = tokens.demoAdmin, host = HOSTS.demo) =>
  request('GET', `/v1/courses/lessons/${lessonId}`, token, undefined, host);

const patchLesson = (
  lessonId: string,
  body: Record<string, unknown>,
  token = tokens.demoAdmin,
  host = HOSTS.demo,
) => request('PATCH', `/v1/courses/lessons/${lessonId}`, token, body, host);

const removeLesson = (lessonId: string, token = tokens.demoAdmin, host = HOSTS.demo) =>
  request('DELETE', `/v1/courses/lessons/${lessonId}`, token, undefined, host);

const reorderLessons = (
  moduleId: string,
  body: unknown,
  token = tokens.demoAdmin,
  host = HOSTS.demo,
) => request('PUT', `/v1/courses/modules/${moduleId}/lessons/order`, token, body, host);

/** Every lesson row of a module as stored, deleted ones included. */
async function lessonStamps(moduleId: string) {
  return adminSql<{ id: string; position: number; deleted: boolean; updated_at: string }[]>`
    select id::text as id, position, deleted_at is not null as deleted, updated_at::text as updated_at
      from public.course_lessons
     where module_id = ${moduleId}::uuid
     order by id`;
}

const putMaterials = (
  lessonId: string,
  body: unknown,
  token = tokens.demoAdmin,
  host = HOSTS.demo,
) => request('PUT', `/v1/courses/lessons/${lessonId}/materials`, token, body, host);

const materialUrl = (
  lessonId: string,
  materialId: string,
  token = tokens.demoAdmin,
  host = HOSTS.demo,
) =>
  request(
    'GET',
    `/v1/courses/lessons/${lessonId}/materials/${materialId}/url`,
    token,
    undefined,
    host,
  );

/** The lesson's material rows as stored: asset id, position and the row's own `created_at`. */
async function materialRows(lessonId: string) {
  return adminSql<{ asset_id: string; position: number; created_at: string }[]>`
    select asset_id::text as asset_id, position, created_at::text as created_at
      from public.course_lesson_materials
     where lesson_id = ${lessonId}::uuid
     order by position, id`;
}

/**
 * A READY `attachment` row in a KNOWN tuple through the admin connection: enough for the set rules
 * (purpose, kind, status) — there is no object behind it, so the URL route is proved with
 * `uploadAttachment` below instead.
 */
async function seedAttachment(
  tenantId: string,
  status: 'ready' | 'pending' | 'rejected',
  mime = 'application/pdf',
  filename = `${PREFIX}-material.pdf`,
): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, filename, ready_at)
    select ${tenantId}::uuid, m.user_id, 'file', 'attachment', ${status}, 'supabase', ${mime},
           4096, ${filename}, ${status === 'ready' ? new Date().toISOString() : null}::timestamptz
      from public.memberships m
     where m.tenant_id = ${tenantId}::uuid and m.role = 'admin_tenant'
     limit 1
    returning id::text as id`;
  if (!row) throw new Error('could not seed an attachment');
  return row.id;
}

const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ZIP_BYTES = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(256, 7)]);

/**
 * A real `attachment` through the broker (the media.test.ts round trip): start as `token` on `host`,
 * PUT the bytes straight to Storage, complete — so the row is READY and an object exists for
 * `signReadFor` to sign. The filename carries the run prefix for the sweep.
 */
async function uploadAttachment(
  bytes: Buffer,
  mime: string,
  filename: string,
  token = tokens.demoAdmin,
  host = HOSTS.demo,
): Promise<string> {
  const start = await request(
    'POST',
    '/v1/media/uploads',
    token,
    { kind: 'file', purpose: 'attachment', mime, size: bytes.length, filename },
    host,
  );
  const body = await json<{ assetId: string; signedUrl: string }>(start, 201);
  const put = await fetch(body.signedUrl, {
    method: 'PUT',
    body: new Uint8Array(bytes),
    headers: { 'content-type': mime, 'x-upsert': 'false' },
  });
  expect(put.ok, `PUT ${mime} -> ${put.status}`).toBe(true);
  const done = await request(
    'POST',
    `/v1/media/uploads/${body.assetId}/complete`,
    token,
    undefined,
    host,
  );
  expect(done.status).toBe(200);
  return body.assetId;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function progressCount(lessonId: string): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.course_lesson_progress where lesson_id = ${lessonId}::uuid`;
  return row?.n ?? 0;
}

async function setStatus(courseId: string, status: string, token = tokens.demoAdmin) {
  return request('PUT', `/v1/courses/${courseId}/status`, token, { status });
}

const patchCourse = (
  courseId: string,
  body: Record<string, unknown>,
  token = tokens.demoAdmin,
  host = HOSTS.demo,
) => request('PATCH', `/v1/courses/${courseId}`, token, body, host);

/** One catalogue page as a given session on a given host, parsed. */
async function listCourses(query: string, token = tokens.demoAdmin, host = HOSTS.demo) {
  return json<CoursePage>(
    await request('GET', `/v1/courses${query ? `?${query}` : ''}`, token, undefined, host),
    200,
  );
}

/** Every page of the catalogue, following `nextCursor`, at a given page size. */
async function allPages(query: string, limit: number, token: string, host: string) {
  const pages: CoursePage[] = [];
  let cursor: string | null = null;
  do {
    const sep = query ? '&' : '';
    const page = await listCourses(
      `${query}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      token,
      host,
    );
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor && pages.length < 200);
  return pages;
}

/** An admin-lane store product (the store's own route is not this module's business here). */
async function insertProduct(
  tenantId: string,
  name: string,
  status: 'active' | 'archived' = 'active',
): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.store_products (tenant_id, created_by_user_id, name, price_cents, status)
    select ${tenantId}::uuid, m.user_id, ${name}, 990, ${status}
      from public.memberships m
     where m.tenant_id = ${tenantId}::uuid and m.role = 'admin_tenant'
     limit 1
    returning id::text as id`;
  return row?.id ?? '';
}

/** An admin-lane course row, for fixtures the API cannot shape (a fixed `created_at`). */
async function insertCourse(tenantId: string, title: string, createdAt: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.courses (tenant_id, created_by_user_id, title, instructor_name, created_at)
    select ${tenantId}::uuid, m.user_id, ${title}, 'x', ${createdAt}::timestamptz
      from public.memberships m
     where m.tenant_id = ${tenantId}::uuid and m.role = 'admin_tenant'
     limit 1
    returning id::text as id`;
  return row?.id ?? '';
}

/**
 * Runs `fn` with the demo tenant's `store` row set to `enabled`, then puts the seed's value back
 * (the seed has the store ON for rede-demo; D-405 needs it OFF for a moment). The API flag cache is
 * dropped on both edges; the SQL gate reads the row directly.
 */
async function withDemoStore<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const [row] = await adminSql<{ enabled: boolean }[]>`
    select enabled from public.tenant_modules
     where tenant_id = ${demoTenantId}::uuid and module_key = 'store'`;
  const was = row?.enabled ?? false;
  await adminSql`
    update public.tenant_modules set enabled = ${enabled}
     where tenant_id = ${demoTenantId}::uuid and module_key = 'store'`;
  moduleFlags.invalidate(demoTenantId);
  try {
    return await fn();
  } finally {
    await adminSql`
      update public.tenant_modules set enabled = ${was}
       where tenant_id = ${demoTenantId}::uuid and module_key = 'store'`;
    moduleFlags.invalidate(demoTenantId);
  }
}

/** The course's link rows as stored: product id and the row's own `created_at`. */
async function linkRows(courseId: string): Promise<{ product_id: string; created_at: string }[]> {
  return adminSql<{ product_id: string; created_at: string }[]>`
    select l.product_id::text as product_id, l.created_at::text as created_at
      from public.course_products l
     where l.course_id = ${courseId}::uuid
     order by l.product_id`;
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
    const detached = await json<CourseDetail>(
      await patchCourse(course.id, { categoryId: null }),
      200,
    );
    expect(detached.category).toBeNull();
    expect(detached.status).toBe('archived');
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

describe('catalogue', () => {
  const lab = () => ({ token: tokens.labAdmin, host: HOSTS.lab });
  const labIds = (filter: string) =>
    adminSql<{ id: string }[]>`
      select id::text as id from public.courses
       where tenant_id = ${labTenantId}::uuid
         and (${filter}::text = 'all' and status in ('draft', 'published') or status = ${filter}::text)
       order by created_at desc, id desc`;

  it('P07 / P09: an empty tenant answers an empty page per filter; 25 rows page as 20 + 5 with nextCursor null at the end and no duplicate id; two same-instant rows straddle a page boundary without a repeat or a skip', async () => {
    const [existing] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.courses where tenant_id = ${labTenantId}::uuid`;
    expect(existing?.n).toBe(0);
    for (const filter of [
      '',
      'filter=all',
      'filter=draft',
      'filter=published',
      'filter=archived',
    ]) {
      expect(await listCourses(filter, lab().token, lab().host)).toEqual({
        items: [],
        nextCursor: null,
      });
    }

    // 23 rows a second apart through the admin lane, plus 2 in the SAME instant, oldest of all.
    const base = Date.parse('2026-01-01T00:00:00Z');
    for (let i = 0; i < 23; i += 1) {
      await insertCourse(
        labTenantId,
        `${PREFIX} pg-${i}`,
        new Date(base + (i + 1) * 1000).toISOString(),
      );
    }
    const tie = new Date(base).toISOString();
    const tieA = await insertCourse(labTenantId, `${PREFIX} pg-tie-a`, tie);
    const tieB = await insertCourse(labTenantId, `${PREFIX} pg-tie-b`, tie);
    const expected = (await labIds('all')).map((row) => row.id);
    expect(expected).toHaveLength(25);
    expect(new Set(expected).size).toBe(25);

    // The default page size: 20, then 5, then nothing (the over-fetch rule).
    const first = await listCourses('', lab().token, lab().host);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const second = await listCourses(
      `cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
      lab().token,
      lab().host,
    );
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const walked = [...first.items, ...second.items].map((item) => item.id);
    expect(walked).toEqual(expected);
    expect(new Set(walked).size).toBe(25);

    // The two same-instant rows are the last two; a page of 24 ends between them (P09).
    expect(expected.slice(23)).toEqual([tieA, tieB].sort().reverse());
    const boundary = await allPages('', 24, lab().token, lab().host);
    expect(boundary.map((page) => page.items.length)).toEqual([24, 1]);
    expect(boundary.flatMap((page) => page.items.map((item) => item.id))).toEqual(expected);
    // Pages of one walk every row exactly once, in `(created_at desc, id desc)` order.
    const ones = await allPages('', 1, lab().token, lab().host);
    expect(ones.flatMap((page) => page.items.map((item) => item.id))).toEqual(expected);
    expect(ones[ones.length - 1]?.nextCursor).toBeNull();
    // Exactly 25 at limit 25: nothing after them, `nextCursor` null.
    const exact = await listCourses('limit=25', lab().token, lab().host);
    expect(exact.items).toHaveLength(25);
    expect(exact.nextCursor).toBeNull();
    // A fresh row through the API is a plain row with zero counts.
    const row = exact.items[0];
    expect(row).toMatchObject({
      status: 'draft',
      coverAssetId: null,
      categoryName: null,
      level: null,
      moduleCount: 0,
      lessonCount: 0,
      durationSeconds: 0,
      hasUnreadyVideo: false,
      publishedAt: null,
    });
    expect(row?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  });

  it('the four filters after a publish and an archive: all is drafts and published, archived stands alone, and the counts agree with the rows', async () => {
    const [toPublish, toArchive] = (await labIds('draft')).map((row) => row.id);
    expect(toPublish && toArchive).toBeTruthy();
    const published = await json<CourseDetail>(
      await request(
        'PUT',
        `/v1/courses/${toPublish}/status`,
        lab().token,
        { status: 'published' },
        lab().host,
      ),
      200,
    );
    await json<CourseDetail>(
      await request(
        'PUT',
        `/v1/courses/${toArchive}/status`,
        lab().token,
        { status: 'archived' },
        lab().host,
      ),
      200,
    );
    const all = await allPages('filter=all', 50, lab().token, lab().host);
    expect(all).toHaveLength(1);
    expect(all[0]?.items.map((item) => item.id)).toEqual((await labIds('all')).map((r) => r.id));
    expect(all[0]?.items).toHaveLength(24);
    expect(all[0]?.items.some((item) => item.id === toArchive)).toBe(false);
    const drafts = await listCourses('filter=draft&limit=50', lab().token, lab().host);
    expect(drafts.items).toHaveLength(23);
    expect(drafts.items.every((item) => item.status === 'draft')).toBe(true);
    const publishedPage = await listCourses('filter=published', lab().token, lab().host);
    expect(publishedPage.items.map((item) => item.id)).toEqual([toPublish]);
    expect(publishedPage.items[0]?.publishedAt).toBe(published.publishedAt);
    const archived = await listCourses('filter=archived', lab().token, lab().host);
    expect(archived.items.map((item) => item.id)).toEqual([toArchive]);
    expect(archived.items[0]?.status).toBe('archived');
    expect(archived.nextCursor).toBeNull();
  });

  it('T-08.3-19: a tampered or oversized cursor, a bad limit, a bad filter and an unknown key are 400, never a widened read', async () => {
    const bad = (n: string, id = '00000000-0000-4000-8000-000000000000') =>
      Buffer.from(JSON.stringify({ v: 1, n, id })).toString('base64url');
    for (const query of [
      'cursor=not-a-cursor',
      `cursor=${'c'.repeat(513)}`,
      `cursor=${bad('2026-02-30T00:00:00.000000Z')}`,
      `cursor=${bad('yesterday')}`,
      `cursor=${bad('2026-01-01T00:00:00.000000Z', 'not-a-uuid')}`,
      'limit=0',
      'limit=51',
      'limit=abc',
      'filter=rascunho',
      'sort=asc',
    ]) {
      const res = await request('GET', `/v1/courses?${query}`, lab().token, undefined, lab().host);
      expect(res.status, query).toBe(400);
      expect(((await res.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');
    }
    // A cursor of the right shape pointing nowhere is simply the end of the list.
    const past = await listCourses(
      `cursor=${encodeURIComponent(bad('1999-01-01T00:00:00.000000Z'))}`,
      lab().token,
      lab().host,
    );
    expect(past).toEqual({ items: [], nextCursor: null });
  });

  it('the row carries the counts the hub shows — live modules, live lessons, the ready seconds, hasUnreadyVideo, the category name — computed with the row (UI-SPEC)', async () => {
    const category = await json<Category>(
      await request('POST', '/v1/courses/categories', tokens.demoAdmin, { name: `${PREFIX} Rows` }),
      201,
    );
    const course = await createCourse({
      title: `${PREFIX} rows`,
      categoryId: category.id,
      level: 'avancado',
    });
    const module = await createModule(course.id);
    const emptyModule = await createModule(course.id);
    const ready = await startLessonVideo();
    await applyReady(ready);
    const pending = await startLessonVideo();
    await json<LessonView>(await createLesson(module.id, { videoAssetId: ready.assetId }), 201);
    const pendingLesson = await json<LessonView>(
      await createLesson(module.id, { videoAssetId: pending.assetId }),
      201,
    );
    await json<LessonView>(await createLesson(module.id, { title: `${PREFIX} prática` }), 201);

    const find = async (filter = 'all') =>
      (await allPages(`filter=${filter}`, 50, tokens.demoAdmin, HOSTS.demo))
        .flatMap((page) => page.items)
        .find((item) => item.id === course.id);
    expect(await find()).toEqual({
      id: course.id,
      title: `${PREFIX} rows`,
      status: 'draft',
      coverAssetId: null,
      categoryName: `${PREFIX} Rows`,
      level: 'avancado',
      moduleCount: 2,
      lessonCount: 3,
      durationSeconds: LESSON_SECONDS,
      hasUnreadyVideo: true,
      createdAt: course.createdAt,
      publishedAt: null,
    });
    // The row agrees with the detail, which is the same reading.
    const detail = await getCourse(course.id);
    expect(detail.moduleCount).toBe(2);
    expect(detail.lessonCount).toBe(3);
    expect(detail.unreadyLessonIds).toEqual([pendingLesson.id]);

    // Ready: the flag drops and the seconds add up; the row moves to the published filter.
    await applyReady(pending);
    await json<CourseDetail>(await setStatus(course.id, 'published'), 200);
    const publishedRow = await find('published');
    expect(publishedRow?.hasUnreadyVideo).toBe(false);
    expect(publishedRow?.durationSeconds).toBe(LESSON_SECONDS * 2);
    expect(publishedRow?.publishedAt).not.toBeNull();
    expect(await find('draft')).toBeUndefined();
    // A soft-deleted module takes its lessons out of every count (the detail's reading).
    await adminSql`update public.course_modules set deleted_at = now() where id = ${module.id}::uuid`;
    const afterRemoval = await find('published');
    expect(afterRemoval?.moduleCount).toBe(1);
    expect(afterRemoval?.lessonCount).toBe(0);
    expect(afterRemoval?.durationSeconds).toBe(0);
    expect(emptyModule.id).not.toBe(module.id);
    await adminSql`update public.course_modules set deleted_at = null where id = ${module.id}::uuid`;
  });
});

describe('course admin', () => {
  let products: { a: string; b: string; archived: string; lab: string } = {
    a: '',
    b: '',
    archived: '',
    lab: '',
  };

  beforeAll(async () => {
    products = {
      a: await insertProduct(demoTenantId, `${PREFIX} produto A`),
      b: await insertProduct(demoTenantId, `${PREFIX} produto B`),
      archived: await insertProduct(demoTenantId, `${PREFIX} produto arquivado`, 'archived'),
      lab: await insertProduct(labTenantId, `${PREFIX} produto lab`),
    };
  });

  it('PATCH of one field leaves every other field; every optional field round-trips; null detaches category, cover and photo (D-412)', async () => {
    const cover = await seedAsset(demoTenantId, 'image', 'cover', 'ready');
    const photo = await seedAsset(demoTenantId, 'image', 'cover', 'ready');
    const category = await json<Category>(
      await request('POST', '/v1/courses/categories', tokens.demoAdmin, { name: `${PREFIX} Edit` }),
      201,
    );
    const course = await createCourse({
      tagline: 'Antes',
      description: 'Descrição',
      outcomes: ['Um'],
      certificateHours: 10,
      level: 'iniciante',
    });
    const titled = await json<CourseDetail>(
      await patchCourse(course.id, { title: `${PREFIX} novo` }),
      200,
    );
    expect(titled).toEqual({ ...course, title: `${PREFIX} novo` });

    const full = await json<CourseDetail>(
      await patchCourse(course.id, {
        tagline: '  Depois  ',
        description: 'Nova descrição',
        categoryId: category.id,
        level: 'avancado',
        coverAssetId: cover,
        instructorName: 'Dr. Bruno',
        instructorPhotoAssetId: photo,
        outcomes: ['Dois', ' Três '],
        certificateHours: 0,
      }),
      200,
    );
    expect(full).toEqual({
      ...titled,
      tagline: 'Depois',
      description: 'Nova descrição',
      category: { id: category.id, name: `${PREFIX} Edit` },
      level: 'avancado',
      coverAssetId: cover,
      instructorName: 'Dr. Bruno',
      instructorPhotoAssetId: photo,
      outcomes: ['Dois', 'Três'],
      certificateHours: 0,
    });
    expect(await getCourse(course.id)).toEqual(full);

    const cleared = await json<CourseDetail>(
      await patchCourse(course.id, {
        categoryId: null,
        coverAssetId: null,
        instructorPhotoAssetId: null,
        level: null,
        certificateHours: null,
        outcomes: [],
        tagline: '',
      }),
      200,
    );
    expect(cleared.category).toBeNull();
    expect(cleared.coverAssetId).toBeNull();
    expect(cleared.instructorPhotoAssetId).toBeNull();
    expect(cleared.level).toBeNull();
    expect(cleared.certificateHours).toBeNull();
    expect(cleared.outcomes).toEqual([]);
    expect(cleared.tagline).toBe('');

    // Refusals write nothing: the field codes, the reference codes, the empty patch.
    const before = await getCourse(course.id);
    const pendingCover = await seedAsset(demoTenantId, 'image', 'cover', 'pending');
    for (const [body, code] of [
      [{ title: '' }, 'title_required'],
      [{ title: 'x'.repeat(121) }, 'title_too_long'],
      [{ instructorName: '  ' }, 'instructor_required'],
      [{ tagline: 't'.repeat(161) }, 'tagline_too_long'],
      [{ certificateHours: 1000 }, 'hours_invalid'],
      [{ level: 'expert' }, 'level_invalid'],
      [{ outcomes: Array.from({ length: 11 }, () => 'x') }, 'outcomes_too_many'],
      [{ coverAssetId: pendingCover }, 'cover_invalid'],
      [{ coverAssetId: randomUUID() }, 'cover_invalid'],
      [{ instructorPhotoAssetId: randomUUID() }, 'photo_invalid'],
      [{ categoryId: randomUUID() }, 'category_invalid'],
      [{}, 'patch_empty'],
    ] as const) {
      const res = await patchCourse(course.id, body);
      expect(res.status, code).toBe(400);
      expect(((await res.json()) as Envelope).error.details).toEqual({ courses: code });
    }
    // An unknown key beside a valid field is the generic issues list; alone it strips to an empty
    // patch and the `patch_empty` code wins — either way a 400 and nothing written.
    const unknownKey = await patchCourse(course.id, { title: `${PREFIX} ok`, slug: 'x' });
    expect(unknownKey.status).toBe(400);
    expect(((await unknownKey.json()) as Envelope).error.details).toHaveProperty('issues');
    const onlyUnknown = await patchCourse(course.id, { slug: 'x' });
    expect(onlyUnknown.status).toBe(400);
    expect(((await onlyUnknown.json()) as Envelope).error.details).toEqual({
      courses: 'patch_empty',
    });
    expect(await getCourse(course.id)).toEqual(before);
    // An unknown id and a rede-lab course id are the bare 404; member and support are 403.
    const labCourse = await json<CourseDetail>(
      await request(
        'POST',
        '/v1/courses',
        tokens.labAdmin,
        { title: `${PREFIX} lab`, instructorName: 'x' },
        HOSTS.lab,
      ),
      201,
    );
    for (const id of [randomUUID(), labCourse.id]) {
      const res = await patchCourse(id, { title: `${PREFIX} ghost` });
      expect(res.status).toBe(404);
      const envelope = (await res.json()) as Envelope;
      expect(envelope.error.code).toBe('NOT_FOUND');
      expect(envelope.error).not.toHaveProperty('details');
    }
    const labRead = await json<CourseDetail>(
      await request('GET', `/v1/courses/${labCourse.id}`, tokens.labAdmin, undefined, HOSTS.lab),
      200,
    );
    expect(labRead.title).toBe(`${PREFIX} lab`);
    for (const token of [tokens.demoMember, tokens.demoSupport]) {
      await expectForbidden(await patchCourse(course.id, { title: 'x' }, token));
      await expectForbidden(await request('GET', '/v1/courses', token));
    }
    await adminSql`delete from public.courses where id = ${labCourse.id}::uuid`;
  });

  it('D-404 / D-405 / P10 / P33 / P34 / P35: productIds replaces the whole link set, the same body twice keeps the rows, [] clears, links save with the store off and the detail lists products in catalogue order with their status', async () => {
    // D-405: the links must save with the tenant's store OFF and stay dormant. The seed has the demo
    // store on, so it is switched off for this part and the seed row restored afterwards.
    const course = await createCourse();
    const { linked, rowsOnce } = await withDemoStore(false, async () => {
      const linked = await json<CourseDetail>(
        await patchCourse(course.id, { productIds: [products.a, products.b, products.a] }),
        200,
      );
      // Catalogue order `(created_at desc, id desc)`: B was inserted after A (P34); duplicates collapse (P35).
      expect(linked.products.map((p) => p.id)).toEqual([products.b, products.a]);
      expect(linked.products.every((p) => p.status === 'active')).toBe(true);
      const rowsOnce = await linkRows(course.id);
      expect(rowsOnce.map((r) => r.product_id)).toEqual([products.a, products.b].sort());
      // Dormant: the store is off, so the gate locks nothing (D-405)…
      expect(await memberLockedIds()).toEqual([]);
      return { linked, rowsOnce };
    });
    // …and with the store on, the same saved links lock the member out.
    await withDemoStore(true, async () => {
      expect(await memberLockedIds()).toContain(course.id);
    });

    // The same body twice: the detail is identical and the link rows keep their `created_at`.
    const [updatedBefore] = await adminSql<{ updated_at: string }[]>`
      select updated_at::text as updated_at from public.courses where id = ${course.id}::uuid`;
    const again = await json<CourseDetail>(
      await patchCourse(course.id, { productIds: [products.a, products.b] }),
      200,
    );
    expect(again).toEqual(linked);
    expect(await linkRows(course.id)).toEqual(rowsOnce);
    const [updatedAfter] = await adminSql<{ updated_at: string }[]>`
      select updated_at::text as updated_at from public.courses where id = ${course.id}::uuid`;
    expect(updatedAfter?.updated_at).not.toBe(updatedBefore?.updated_at);

    // A narrower set drops the other link; `[]` clears every link (P33).
    const narrowed = await json<CourseDetail>(
      await patchCourse(course.id, { productIds: [products.b] }),
      200,
    );
    expect(narrowed.products.map((p) => p.id)).toEqual([products.b]);
    expect((await linkRows(course.id)).map((r) => r.product_id)).toEqual([products.b]);
    const cleared = await json<CourseDetail>(await patchCourse(course.id, { productIds: [] }), 200);
    expect(cleared.products).toEqual([]);
    expect(await linkRows(course.id)).toEqual([]);

    // Refused ids write nothing: an archived product, a rede-lab product, an unknown id (T-08.3-02).
    await json<CourseDetail>(await patchCourse(course.id, { productIds: [products.a] }), 200);
    for (const productId of [products.archived, products.lab, randomUUID()]) {
      const res = await patchCourse(course.id, { productIds: [products.b, productId] });
      expect(res.status, productId).toBe(400);
      expect(((await res.json()) as Envelope).error.details).toEqual({
        courses: 'product_invalid',
      });
      expect((await linkRows(course.id)).map((r) => r.product_id)).toEqual([products.a]);
    }
    // An archived product ALREADY linked stays in the detail with its status (read-only there)…
    await adminSql`
      update public.store_products set status = 'archived' where id = ${products.a}::uuid`;
    const withArchived = await getCourse(course.id);
    expect(withArchived.products).toEqual([
      { id: products.a, name: `${PREFIX} produto A`, status: 'archived' },
    ]);
    // …and cannot be re-sent, so a save that keeps it must omit `productIds`.
    await json<CourseDetail>(await patchCourse(course.id, { title: `${PREFIX} mantém` }), 200);
    expect((await linkRows(course.id)).map((r) => r.product_id)).toEqual([products.a]);
    await adminSql`
      update public.store_products set status = 'active' where id = ${products.a}::uuid`;
    // `products` on the create path is the same write path and the same validation.
    const created = await createCourse({ productIds: [products.b] });
    expect(created.products.map((p) => p.id)).toEqual([products.b]);
    const refused = await request('POST', '/v1/courses', tokens.demoAdmin, {
      title: `${PREFIX} x`,
      instructorName: 'x',
      productIds: [products.lab],
    });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as Envelope).error.details).toEqual({
      courses: 'product_invalid',
    });
  });

  it('P11 / P36: two concurrent PATCH with different productIds both answer 200 and the final set is exactly one of them, never the union; with the store on, the gate follows the committed set', async () => {
    const course = await createCourse();
    for (let round = 0; round < 5; round += 1) {
      const answers = await Promise.all([
        patchCourse(course.id, { productIds: [products.a] }),
        patchCourse(course.id, { productIds: [products.b] }),
      ]);
      expect(answers.map((res) => res.status)).toEqual([200, 200]);
      const finalSet = (await linkRows(course.id)).map((r) => r.product_id);
      expect([[products.a], [products.b]]).toContainEqual(finalSet);
      const details = await Promise.all(answers.map((res) => res.json() as Promise<CourseDetail>));
      // Each answer saw a whole set: one product, never two.
      for (const detail of details) expect(detail.products).toHaveLength(1);
    }
    // With the store on, the committed set is what the gate reads (the member holds nothing).
    await withDemoStore(true, async () => {
      expect(await memberLockedIds()).toContain(course.id);
      await json<CourseDetail>(await patchCourse(course.id, { productIds: [] }), 200);
      expect(await memberLockedIds()).not.toContain(course.id);
    });
  });

  it('D-413: every transition through the API, archive keeps modules, lessons, links and progress rows, unpublish keeps publishedAt, archived lists under filter=archived, and the same status is a no-op without an updated_at bump', async () => {
    const course = await createCourse({ productIds: [products.a] });
    const module = await createModule(course.id);
    const asset = await startLessonVideo();
    await applyReady(asset);
    const lesson = await json<LessonView>(
      await createLesson(module.id, { videoAssetId: asset.assetId }),
      201,
    );
    await adminSql`
      insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, last_position_seconds)
      values (${demoTenantId}::uuid, ${demoMemberUserId}::uuid, ${lesson.id}::uuid, 30)`;
    const counts = async () => {
      const [row] = await adminSql<Record<string, number>[]>`
        select (select count(*)::int from public.course_modules where course_id = ${course.id}::uuid) as modules,
               (select count(*)::int from public.course_lessons where course_id = ${course.id}::uuid) as lessons,
               (select count(*)::int from public.course_products where course_id = ${course.id}::uuid) as links,
               (select count(*)::int from public.course_lesson_progress where lesson_id = ${lesson.id}::uuid) as progress`;
      return row;
    };
    const before = await counts();
    expect(before).toEqual({ modules: 1, lessons: 1, links: 1, progress: 1 });

    // draft → published → draft (publishedAt kept) → published → archived.
    const published = await json<CourseDetail>(await setStatus(course.id, 'published'), 200);
    expect(published.publishedAt).not.toBeNull();
    const unpublished = await json<CourseDetail>(await setStatus(course.id, 'draft'), 200);
    expect(unpublished.publishedAt).toBe(published.publishedAt);
    expect(unpublished.archivedAt).toBeNull();
    // The same status is a no-op: 200, the unchanged detail, no `updated_at` bump (P10).
    const [stamp] = await adminSql<{ updated_at: string }[]>`
      select updated_at::text as updated_at from public.courses where id = ${course.id}::uuid`;
    expect(await json<CourseDetail>(await setStatus(course.id, 'draft'), 200)).toEqual(unpublished);
    const [stampAfter] = await adminSql<{ updated_at: string }[]>`
      select updated_at::text as updated_at from public.courses where id = ${course.id}::uuid`;
    expect(stampAfter?.updated_at).toBe(stamp?.updated_at);
    await json<CourseDetail>(await setStatus(course.id, 'published'), 200);
    const archived = await json<CourseDetail>(await setStatus(course.id, 'archived'), 200);
    expect(archived.status).toBe('archived');
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.publishedAt).toBe(published.publishedAt);
    expect(await counts()).toEqual(before);
    expect(archived.products.map((p) => p.id)).toEqual([products.a]);
    expect(archived.modules[0]?.lessons[0]?.id).toBe(lesson.id);
    // Out of archived is refused; the archive stays listed under its own filter and nowhere else.
    for (const status of ['draft', 'published']) {
      const res = await setStatus(course.id, status);
      expect(res.status).toBe(409);
      expect(((await res.json()) as Envelope).error.details).toEqual({ courses: 'status_invalid' });
    }
    const inArchive = (await allPages('filter=archived', 50, tokens.demoAdmin, HOSTS.demo))
      .flatMap((page) => page.items)
      .find((item) => item.id === course.id);
    expect(inArchive?.status).toBe('archived');
    expect(inArchive?.lessonCount).toBe(1);
    const inLive = (await allPages('filter=all', 50, tokens.demoAdmin, HOSTS.demo))
      .flatMap((page) => page.items)
      .some((item) => item.id === course.id);
    expect(inLive).toBe(false);
    // A second fresh course goes draft → archived directly.
    const direct = await createCourse();
    expect((await json<CourseDetail>(await setStatus(direct.id, 'archived'), 200)).status).toBe(
      'archived',
    );
    await adminSql`
      delete from public.course_lesson_progress where lesson_id = ${lesson.id}::uuid`;
  });

  it('P06 / P07 / D-412: two courses titled the same are two rows; the minimal body creates with every default; an empty instructorName is 400 instructor_required', async () => {
    const one = await createCourse({ title: `${PREFIX} Mesmo` });
    const two = await createCourse({ title: `${PREFIX} Mesmo` });
    expect(one.id).not.toBe(two.id);
    const [count] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.courses
       where tenant_id = ${demoTenantId}::uuid and title = ${`${PREFIX} Mesmo`}`;
    expect(count?.n).toBe(2);

    const minimal = await json<CourseDetail>(
      await request('POST', '/v1/courses', tokens.demoAdmin, {
        title: `${PREFIX} mínimo`,
        instructorName: 'Só o nome',
      }),
      201,
    );
    expect(minimal).toMatchObject({
      tagline: '',
      description: '',
      category: null,
      level: null,
      coverAssetId: null,
      instructorName: 'Só o nome',
      instructorPhotoAssetId: null,
      outcomes: [],
      certificateHours: null,
      status: 'draft',
      publishedAt: null,
      archivedAt: null,
      products: [],
      modules: [],
      moduleCount: 0,
      lessonCount: 0,
      durationSeconds: 0,
      hasUnreadyVideo: false,
      unreadyLessonIds: [],
    });

    for (const body of [
      { title: `${PREFIX} sem instrutor` },
      { title: `${PREFIX} sem instrutor`, instructorName: '' },
      { title: `${PREFIX} sem instrutor`, instructorName: '   ' },
    ]) {
      const res = await request('POST', '/v1/courses', tokens.demoAdmin, body);
      expect(res.status).toBe(400);
      const details = ((await res.json()) as Envelope).error.details;
      if ('instructorName' in body) expect(details).toEqual({ courses: 'instructor_required' });
    }
    const [none] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.courses where title = ${`${PREFIX} sem instrutor`}`;
    expect(none?.n).toBe(0);
  });
});

describe('publish guard reading', () => {
  /** A course with one module and one lesson carrying a video in the given state. */
  async function courseWithVideoLesson(ready: boolean) {
    const course = await createCourse();
    const module = await createModule(course.id);
    const asset = await startLessonVideo();
    if (ready) await applyReady(asset);
    const lesson = await json<LessonView>(
      await createLesson(module.id, { videoAssetId: asset.assetId }),
      201,
    );
    return { course, module, asset, lesson };
  }
  const expectBlocked = async (res: Response, lessonIds: string[]) => {
    expect(res.status).toBe(409);
    expect(((await res.json()) as Envelope).error.details).toEqual({
      courses: 'video_not_ready',
      lessonIds,
    });
  };

  it('P12 (1): a soft-deleted lesson whose video is still pending is ignored — the course publishes', async () => {
    const { course, lesson } = await courseWithVideoLesson(false);
    await expectBlocked(await setStatus(course.id, 'published'), [lesson.id]);
    await adminSql`
      update public.course_lessons set deleted_at = now() where id = ${lesson.id}::uuid`;
    const published = await json<CourseDetail>(await setStatus(course.id, 'published'), 200);
    expect(published.status).toBe('published');
    expect(published.lessonCount).toBe(0);
    expect(published.hasUnreadyVideo).toBe(false);
    expect(published.unreadyLessonIds).toEqual([]);
  });

  it('P12 (2): a lesson whose video asset was soft-deleted blocks with its id — an asset the lane cannot see counts as NOT ready', async () => {
    const { course, asset, lesson } = await courseWithVideoLesson(true);
    const detailBefore = await getCourse(course.id);
    expect(detailBefore.hasUnreadyVideo).toBe(false);
    await adminSql`
      update public.media_assets set deleted_at = now() where id = ${asset.assetId}::uuid`;
    const detail = await getCourse(course.id);
    expect(detail.modules[0]?.lessons[0]?.videoStatus).toBe('failed');
    expect(detail.modules[0]?.lessons[0]?.durationSeconds).toBeNull();
    expect(detail.hasUnreadyVideo).toBe(true);
    expect(detail.unreadyLessonIds).toEqual([lesson.id]);
    expect(detail.durationSeconds).toBe(0);
    await expectBlocked(await setStatus(course.id, 'published'), [lesson.id]);
    expect((await getCourse(course.id)).status).toBe('draft');
    // The row of the catalogue reads it the same way.
    const row = (await allPages('filter=draft', 50, tokens.demoAdmin, HOSTS.demo))
      .flatMap((page) => page.items)
      .find((item) => item.id === course.id);
    expect(row?.hasUnreadyVideo).toBe(true);
    expect(row?.durationSeconds).toBe(0);
  });

  it('P12 (3): a lesson without video never blocks — a course of practice lessons only publishes at once', async () => {
    const course = await createCourse();
    const module = await createModule(course.id);
    for (let i = 0; i < 3; i += 1) {
      await json<LessonView>(
        await createLesson(module.id, { title: `${PREFIX} prática ${i}` }),
        201,
      );
    }
    const published = await json<CourseDetail>(await setStatus(course.id, 'published'), 200);
    expect(published.status).toBe('published');
    expect(published.lessonCount).toBe(3);
    expect(published.durationSeconds).toBe(0);
    expect(published.hasUnreadyVideo).toBe(false);
  });

  it('P12 (4): a course with zero modules publishes, and one with a module and zero lessons publishes — an empty course is the admin’s call', async () => {
    const empty = await createCourse();
    const publishedEmpty = await json<CourseDetail>(await setStatus(empty.id, 'published'), 200);
    expect(publishedEmpty.status).toBe('published');
    expect(publishedEmpty.moduleCount).toBe(0);
    const shell = await createCourse();
    await createModule(shell.id);
    const publishedShell = await json<CourseDetail>(await setStatus(shell.id, 'published'), 200);
    expect(publishedShell.status).toBe('published');
    expect(publishedShell.moduleCount).toBe(1);
    expect(publishedShell.lessonCount).toBe(0);
  });

  it('P12 (5): the 409 names only lesson ids of THIS course while another course has an unready lesson of its own', async () => {
    const a = await courseWithVideoLesson(false);
    const b = await courseWithVideoLesson(false);
    await expectBlocked(await setStatus(a.course.id, 'published'), [a.lesson.id]);
    await expectBlocked(await setStatus(b.course.id, 'published'), [b.lesson.id]);
    // A second blocked lesson in A lists in position order; B's never appears.
    const second = await json<LessonView>(
      await createLesson(a.module.id, { videoAssetId: (await startLessonVideo()).assetId }),
      201,
    );
    await expectBlocked(await setStatus(a.course.id, 'published'), [a.lesson.id, second.id]);
    await applyReady(b.asset);
    expect((await json<CourseDetail>(await setStatus(b.course.id, 'published'), 200)).status).toBe(
      'published',
    );
    await expectBlocked(await setStatus(a.course.id, 'published'), [a.lesson.id, second.id]);
  });

  it('P12 (6): archiving a course with an unready lesson answers 200 — readiness is never consulted outside a publish', async () => {
    const { course, lesson } = await courseWithVideoLesson(false);
    await expectBlocked(await setStatus(course.id, 'published'), [lesson.id]);
    const archived = await json<CourseDetail>(await setStatus(course.id, 'archived'), 200);
    expect(archived.status).toBe('archived');
    expect(archived.hasUnreadyVideo).toBe(true);
    expect(archived.unreadyLessonIds).toEqual([lesson.id]);
    // Unpublishing a published course never consults readiness either: a video that goes missing
    // after the publish does not trap the course in `published`.
    const other = await courseWithVideoLesson(true);
    await json<CourseDetail>(await setStatus(other.course.id, 'published'), 200);
    await adminSql`
      update public.media_assets set deleted_at = now() where id = ${other.asset.assetId}::uuid`;
    const unpublished = await json<CourseDetail>(await setStatus(other.course.id, 'draft'), 200);
    expect(unpublished.status).toBe('draft');
    expect(unpublished.hasUnreadyVideo).toBe(true);
  });
});

describe('modules', () => {
  const expectBare404 = async (res: Response) => {
    expect(res.status).toBe(404);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error).not.toHaveProperty('details');
  };
  const expectStale = async (res: Response) => {
    expect(res.status).toBe(409);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.details).toEqual({ courses: 'order_stale' });
  };
  /** A course with `n` modules titled m1..mn, in creation order. */
  async function courseWithModules(n: number) {
    const course = await createCourse();
    const modules: ModuleView[] = [];
    for (let i = 1; i <= n; i += 1) {
      modules.push(await createModule(course.id, { title: `${PREFIX} m${i}` }));
    }
    return { course, modules };
  }
  const orderOf = (detail: CourseDetail) => detail.modules.map((m) => m.id);

  it('edit (COURSE-05, D-406, P17): title and summary change alone; requiresPrevious is forced false on the first module and kept on the second; patch_empty and an unknown key are 400; two modules may share a title; an unknown or foreign id is the bare 404', async () => {
    const { course, modules } = await courseWithModules(2);
    const [first, second] = modules as [ModuleView, ModuleView];

    const edited = await json<ModuleView>(
      await patchModule(first.id, { title: `${PREFIX} m1 editado`, summary: 'resumo' }),
      200,
    );
    expect(edited).toEqual({ ...first, title: `${PREFIX} m1 editado`, summary: 'resumo' });
    const titleOnly = await json<ModuleView>(
      await patchModule(first.id, { title: `${PREFIX} m2` }),
      200,
    );
    expect(titleOnly.summary).toBe('resumo');
    // Two modules now share the title `${PREFIX} m2` (P17 adjacency): two rows, both listed.
    const detail = await getCourse(course.id);
    expect(detail.modules.map((m) => m.title)).toEqual([`${PREFIX} m2`, `${PREFIX} m2`]);

    // UI-D-396: the first module can never require a previous one; the second can.
    const forced = await json<ModuleView>(
      await patchModule(first.id, { requiresPrevious: true }),
      200,
    );
    expect(forced.requiresPrevious).toBe(false);
    const kept = await json<ModuleView>(
      await patchModule(second.id, { requiresPrevious: true }),
      200,
    );
    expect(kept.requiresPrevious).toBe(true);
    const off = await json<ModuleView>(
      await patchModule(second.id, { requiresPrevious: false }),
      200,
    );
    expect(off.requiresPrevious).toBe(false);
    // After a reorder the "first" is whoever lists first: the old second, now first, is forced off;
    // the old first, now second, may require the previous one.
    await json<{ items: ModuleView[] }>(
      await reorderModules(course.id, { ids: [second.id, first.id] }),
      200,
    );
    const nowFirst = await json<ModuleView>(
      await patchModule(second.id, { requiresPrevious: true }),
      200,
    );
    expect(nowFirst.requiresPrevious).toBe(false);
    const nowSecond = await json<ModuleView>(
      await patchModule(first.id, { requiresPrevious: true }),
      200,
    );
    expect(nowSecond.requiresPrevious).toBe(true);

    const empty = await patchModule(first.id, {});
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as Envelope).error.details).toEqual({ courses: 'patch_empty' });
    const unknownKey = await patchModule(first.id, { title: 'x', position: 5 });
    expect(unknownKey.status).toBe(400);
    expect(((await unknownKey.json()) as Envelope).error.details).toHaveProperty('issues');
    const tooLong = await patchModule(first.id, { title: 'x'.repeat(121) });
    expect(((await tooLong.json()) as Envelope).error.details).toEqual({
      courses: 'title_too_long',
    });
    await expectBare404(await patchModule(randomUUID(), { title: 'x' }));
    await expectBare404(await patchModule(first.id, { title: 'x' }, tokens.labAdmin, HOSTS.lab));
    // The lesson view rides on the module answer.
    const lesson = await json<LessonView>(await createLesson(first.id), 201);
    const withLesson = await json<ModuleView>(await patchModule(first.id, { summary: 's' }), 200);
    expect(withLesson.lessonCount).toBe(1);
    expect(withLesson.lessons.map((l) => l.id)).toEqual([lesson.id]);
  });

  it('remove (COURSE-05, D-408, P17, PR-5): a soft delete drops the module from the detail, keeps its lesson rows and every progress row, answers the bare 404 the second time, leaves a gap in position until the next reorder renumbers 1..N', async () => {
    const { course, modules } = await courseWithModules(3);
    const [m1, m2, m3] = modules as [ModuleView, ModuleView, ModuleView];
    const lesson = await json<LessonView>(await createLesson(m2.id), 201);
    await insertProgress(lesson.id);
    expect(await progressCount(lesson.id)).toBe(1);

    const removed = await removeModule(m2.id);
    expect(removed.status).toBe(204);
    const detail = await getCourse(course.id);
    expect(orderOf(detail)).toEqual([m1.id, m3.id]);
    expect(detail.moduleCount).toBe(2);
    expect(detail.lessonCount).toBe(0);
    // The gap (P17): positions 1 and 3, relative order kept.
    expect(detail.modules.map((m) => m.position)).toEqual([1, 3]);
    // The row stays, its lessons stay live, the member's record stays.
    const [row] = await adminSql<{ deleted: boolean; lessons: number; live_lessons: number }[]>`
      select m.deleted_at is not null as deleted,
             (select count(*)::int from public.course_lessons l where l.module_id = m.id) as lessons,
             (select count(*)::int from public.course_lessons l
               where l.module_id = m.id and l.deleted_at is null) as live_lessons
        from public.course_modules m where m.id = ${m2.id}::uuid`;
    expect(row).toEqual({ deleted: true, lessons: 1, live_lessons: 1 });
    expect(await progressCount(lesson.id)).toBe(1);
    await expectBare404(await removeModule(m2.id));
    await expectBare404(await patchModule(m2.id, { title: 'x' }));
    await expectBare404(await removeModule(randomUUID()));
    // A new module takes position 4 (max + 1 among live rows), still listed after the gap.
    const m4 = await createModule(course.id, { title: `${PREFIX} m4` });
    expect(m4.position).toBe(4);
    // The next reorder renumbers 1..N.
    const reordered = await json<{ items: ModuleView[] }>(
      await reorderModules(course.id, { ids: [m3.id, m1.id, m4.id] }),
      200,
    );
    expect(reordered.items.map((m) => [m.id, m.position])).toEqual([
      [m3.id, 1],
      [m1.id, 2],
      [m4.id, 3],
    ]);
    // The progress row survives everything an admin can do here.
    expect(await progressCount(lesson.id)).toBe(1);
    await adminSql`delete from public.course_lesson_progress where lesson_id = ${lesson.id}::uuid`;
  });

  it('reorder (COURSE-05, D-414, P18, P19, P20, P21): the reversed order answers 200 in the new order; the same permutation twice writes nothing the second time; [] and a duplicate are 400; a missing, extra, unknown or soft-deleted id is 409 order_stale with nothing written; an unknown or foreign course is the bare 404 before any set is read', async () => {
    const { course, modules } = await courseWithModules(3);
    const [m1, m2, m3] = modules as [ModuleView, ModuleView, ModuleView];
    expect(orderOf(await getCourse(course.id))).toEqual([m1.id, m2.id, m3.id]);

    const reversed = await json<{ items: ModuleView[] }>(
      await reorderModules(course.id, { ids: [m3.id, m2.id, m1.id] }),
      200,
    );
    expect(reversed.items.map((m) => [m.id, m.position])).toEqual([
      [m3.id, 1],
      [m2.id, 2],
      [m1.id, 3],
    ]);
    expect(orderOf(await getCourse(course.id))).toEqual([m3.id, m2.id, m1.id]);
    // P20: the same permutation again answers 200 and touches ZERO rows (`position <> o.ord`): every
    // row's updated_at is byte-identical afterwards.
    const stamps = await moduleStamps(course.id);
    const again = await json<{ items: ModuleView[] }>(
      await reorderModules(course.id, { ids: [m3.id, m2.id, m1.id] }),
      200,
    );
    expect(again).toEqual(reversed);
    expect(await moduleStamps(course.id)).toEqual(stamps);
    // Upper-case spellings of the same uuids are the same set (uuid equality is Postgres').
    const upper = await json<{ items: ModuleView[] }>(
      await reorderModules(course.id, { ids: [m3.id, m2.id, m1.id].map((id) => id.toUpperCase()) }),
      200,
    );
    expect(upper).toEqual(reversed);
    expect(await moduleStamps(course.id)).toEqual(stamps);

    // P18 / P25: malformed input, never a stale set.
    const empty = await reorderModules(course.id, { ids: [] });
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as Envelope).error.details).toHaveProperty('issues');
    const dup = await reorderModules(course.id, { ids: [m1.id, m1.id, m2.id] });
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as Envelope).error.details).toHaveProperty('issues');
    const extraKey = await reorderModules(course.id, { ids: [m1.id, m2.id, m3.id], force: true });
    expect(extraKey.status).toBe(400);

    // 409 order_stale for every set mismatch, nothing written.
    const other = await courseWithModules(1);
    const foreign = (other.modules[0] as ModuleView).id;
    for (const ids of [
      [m1.id, m2.id],
      [m1.id, m2.id, m3.id, randomUUID()],
      [m1.id, m2.id, randomUUID()],
      [m1.id, m2.id, m3.id, foreign],
      [m1.id, m2.id, foreign],
    ]) {
      await expectStale(await reorderModules(course.id, { ids }));
    }
    expect(await moduleStamps(course.id)).toEqual(stamps);
    expect(orderOf(await getCourse(course.id))).toEqual([m3.id, m2.id, m1.id]);
    // A module soft-deleted between the admin's read and write makes the loaded set stale (P21 half).
    expect((await removeModule(m2.id)).status).toBe(204);
    await expectStale(await reorderModules(course.id, { ids: [m1.id, m2.id, m3.id] }));
    const renumbered = await json<{ items: ModuleView[] }>(
      await reorderModules(course.id, { ids: [m1.id, m3.id] }),
      200,
    );
    expect(renumbered.items.map((m) => [m.id, m.position])).toEqual([
      [m1.id, 1],
      [m3.id, 2],
    ]);
    // The course is decided first: an unknown or foreign course is the bare 404, never a 409.
    await expectBare404(await reorderModules(randomUUID(), { ids: [m1.id, m3.id] }));
    await expectBare404(
      await reorderModules(course.id, { ids: [m1.id, m3.id] }, tokens.labAdmin, HOSTS.lab),
    );
  });

  it('P21 concurrency: two concurrent reorders of the same set both answer 200 and the final order is exactly one of the two permutations', async () => {
    const { course, modules } = await courseWithModules(4);
    const ids = modules.map((m) => m.id);
    for (let round = 0; round < 3; round += 1) {
      const a = [...ids].reverse();
      const b = [ids[1], ids[3], ids[0], ids[2]] as string[];
      const [resA, resB] = await Promise.all([
        reorderModules(course.id, { ids: a }),
        reorderModules(course.id, { ids: b }),
      ]);
      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      const finalOrder = orderOf(await getCourse(course.id));
      expect([a, b]).toContainEqual(finalOrder);
      const stamps = await moduleStamps(course.id);
      expect(stamps.map((s) => s.position).sort()).toEqual([1, 2, 3, 4]);
    }
  });

  it('member and support get 403 on the three module routes (D-403)', async () => {
    const { course, modules } = await courseWithModules(1);
    const moduleId = (modules[0] as ModuleView).id;
    for (const token of [tokens.demoMember, tokens.demoSupport]) {
      await expectForbidden(await patchModule(moduleId, { title: 'x' }, token));
      await expectForbidden(await removeModule(moduleId, token));
      await expectForbidden(await reorderModules(course.id, { ids: [moduleId] }, token));
    }
    expect(orderOf(await getCourse(course.id))).toEqual([moduleId]);
  });
});

describe('lessons', () => {
  const expectBare404 = async (res: Response) => {
    expect(res.status).toBe(404);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error).not.toHaveProperty('details');
  };
  const expectIssue = async (res: Response, issue: string) => {
    expect(res.status).toBe(400);
    expect(((await res.json()) as Envelope).error.details).toEqual({ courses: issue });
  };
  const expectStale = async (res: Response) => {
    expect(res.status).toBe(409);
    expect(((await res.json()) as Envelope).error.details).toEqual({ courses: 'order_stale' });
  };
  /** A course, a module and `n` practice lessons titled a1..an, in creation order. */
  async function moduleWithLessons(n: number) {
    const course = await createCourse();
    const module = await createModule(course.id);
    const lessons: LessonView[] = [];
    for (let i = 1; i <= n; i += 1) {
      lessons.push(
        await json<LessonView>(await createLesson(module.id, { title: `${PREFIX} a${i}` }), 201),
      );
    }
    return { course, module, lessons };
  }

  it('detail (COURSE-06, D-407): the lesson view plus materials: [], its module and its course; hasProducts follows a product link; an unknown, foreign or removed lesson is the bare 404', async () => {
    const { course, module, lessons } = await moduleWithLessons(1);
    const lesson = lessons[0] as LessonView;
    const detail = await json<LessonDetail>(await getLesson(lesson.id), 200);
    expect(detail).toEqual({
      ...lesson,
      materials: [],
      module: { id: module.id, title: module.title, position: 1 },
      course: { id: course.id, title: course.title, status: 'draft', hasProducts: false },
    });
    const product = await insertProduct(demoTenantId, `${PREFIX} produto`);
    await json<CourseDetail>(await patchCourse(course.id, { productIds: [product] }), 200);
    const linked = await json<LessonDetail>(await getLesson(lesson.id), 200);
    expect(linked.course.hasProducts).toBe(true);
    await json<CourseDetail>(await setStatus(course.id, 'published'), 200);
    expect((await json<LessonDetail>(await getLesson(lesson.id), 200)).course.status).toBe(
      'published',
    );
    await expectBare404(await getLesson(randomUUID()));
    await expectBare404(await getLesson(lesson.id, tokens.labAdmin, HOSTS.lab));
    expect((await removeLesson(lesson.id)).status).toBe(204);
    await expectBare404(await getLesson(lesson.id));
  });

  it('video (D-409, P22, PR-6): a pending lesson asset attaches as pending and turns ready with the asset’s duration; null detaches; a post asset and a foreign asset are 400 video_invalid by name; the same asset twice leaves the row; a second live lesson is 400 video_in_use until the first is removed', async () => {
    const { lessons } = await moduleWithLessons(2);
    const [first, second] = lessons as [LessonView, LessonView];
    const asset = await startLessonVideo();

    const pending = await json<LessonDetail>(
      await patchLesson(first.id, { videoAssetId: asset.assetId }),
      200,
    );
    expect(pending.videoAssetId).toBe(asset.assetId);
    expect(pending.videoStatus).toBe('pending');
    expect(pending.durationSeconds).toBeNull();
    // P22: the same body again leaves the row — byte-identical answer, nothing re-written but updated_at.
    const again = await json<LessonDetail>(
      await patchLesson(first.id, { videoAssetId: asset.assetId }),
      200,
    );
    expect(again).toEqual(pending);
    await applyReady(asset);
    const ready = await json<LessonDetail>(await getLesson(first.id), 200);
    expect(ready.videoStatus).toBe('ready');
    expect(ready.durationSeconds).toBe(LESSON_SECONDS);
    // The asset on a SECOND live lesson is refused, and the second lesson stays a practice lesson.
    await expectIssue(
      await patchLesson(second.id, { videoAssetId: asset.assetId }),
      'video_in_use',
    );
    expect((await json<LessonDetail>(await getLesson(second.id), 200)).videoAssetId).toBeNull();
    // A `post`-purpose video and a rede-demo lesson asset from the lab admin: by name, nothing written.
    const postVideo = await seedAsset(demoTenantId, 'video', 'post', 'pending');
    await expectIssue(await patchLesson(second.id, { videoAssetId: postVideo }), 'video_invalid');
    await expectIssue(
      await patchLesson(second.id, { videoAssetId: randomUUID() }),
      'video_invalid',
    );
    const labCourse = await json<CourseDetail>(
      await request(
        'POST',
        '/v1/courses',
        tokens.labAdmin,
        { title: `${PREFIX} lab`, instructorName: 'Lab' },
        HOSTS.lab,
      ),
      201,
    );
    const labModule = await json<ModuleView>(
      await request(
        'POST',
        `/v1/courses/${labCourse.id}/modules`,
        tokens.labAdmin,
        { title: `${PREFIX} lab` },
        HOSTS.lab,
      ),
      201,
    );
    const labLesson = await json<LessonView>(
      await request(
        'POST',
        `/v1/courses/modules/${labModule.id}/lessons`,
        tokens.labAdmin,
        { title: `${PREFIX} lab` },
        HOSTS.lab,
      ),
      201,
    );
    const foreignAsset = await startLessonVideo();
    await expectIssue(
      await patchLesson(
        labLesson.id,
        { videoAssetId: foreignAsset.assetId },
        tokens.labAdmin,
        HOSTS.lab,
      ),
      'video_invalid',
    );
    expect(
      (await json<LessonDetail>(await getLesson(labLesson.id, tokens.labAdmin, HOSTS.lab), 200))
        .videoAssetId,
    ).toBeNull();
    // Detach: `none`, no duration; the asset is free again and the second lesson takes it.
    const detached = await json<LessonDetail>(
      await patchLesson(first.id, { videoAssetId: null }),
      200,
    );
    expect(detached.videoAssetId).toBeNull();
    expect(detached.videoStatus).toBe('none');
    expect(detached.durationSeconds).toBeNull();
    const taken = await json<LessonDetail>(
      await patchLesson(second.id, { videoAssetId: asset.assetId }),
      200,
    );
    expect(taken.videoStatus).toBe('ready');
    expect(taken.durationSeconds).toBe(LESSON_SECONDS);
    // P22: with the second lesson soft-deleted, the partial unique index frees the asset for the first.
    await expectIssue(await patchLesson(first.id, { videoAssetId: asset.assetId }), 'video_in_use');
    expect((await removeLesson(second.id)).status).toBe(204);
    const freed = await json<LessonDetail>(
      await patchLesson(first.id, { videoAssetId: asset.assetId }),
      200,
    );
    expect(freed.videoStatus).toBe('ready');
    // isFree, title and description toggle alone; patch_empty; the input has no video url field.
    const free = await json<LessonDetail>(await patchLesson(first.id, { isFree: true }), 200);
    expect(free.isFree).toBe(true);
    expect(free.videoAssetId).toBe(asset.assetId);
    const text = await json<LessonDetail>(
      await patchLesson(first.id, { title: `${PREFIX} a1 editada`, description: 'passo a passo' }),
      200,
    );
    expect(text.title).toBe(`${PREFIX} a1 editada`);
    expect(text.description).toBe('passo a passo');
    expect(text.isFree).toBe(true);
    await expectIssue(await patchLesson(first.id, {}), 'patch_empty');
    const url = await patchLesson(first.id, { videoUrl: 'https://youtu.be/x' });
    expect(url.status).toBe(400);
    const typedDuration = await patchLesson(first.id, { durationSeconds: 1 });
    expect(typedDuration.status).toBe(400);
    await expectBare404(await patchLesson(randomUUID(), { isFree: true }));
    await expectBare404(await patchLesson(first.id, { isFree: true }, tokens.labAdmin, HOSTS.lab));
  });

  it('remove (D-408, PR-5): a soft delete drops the lesson from the module and the course counts, keeps its row and every progress row, and answers the bare 404 the second time', async () => {
    const { course, module, lessons } = await moduleWithLessons(2);
    const [a1, a2] = lessons as [LessonView, LessonView];
    await insertProgress(a1.id);
    expect((await removeLesson(a1.id)).status).toBe(204);
    const detail = await getCourse(course.id);
    expect(detail.lessonCount).toBe(1);
    expect(detail.modules[0]?.lessons.map((l) => l.id)).toEqual([a2.id]);
    const [row] = await adminSql<{ deleted: boolean }[]>`
      select deleted_at is not null as deleted from public.course_lessons where id = ${a1.id}::uuid`;
    expect(row?.deleted).toBe(true);
    expect(await progressCount(a1.id)).toBe(1);
    await expectBare404(await removeLesson(a1.id));
    await expectBare404(await getLesson(a1.id));
    await expectBare404(await removeLesson(randomUUID()));
    await expectBare404(await removeLesson(a2.id, tokens.labAdmin, HOSTS.lab));
    expect(
      (await json<ModuleView>(await patchModule(module.id, { summary: 's' }), 200)).lessonCount,
    ).toBe(1);
    await adminSql`delete from public.course_lesson_progress where lesson_id = ${a1.id}::uuid`;
  });

  it('reorder (D-414, P18, P20, P21): the reversed order answers 200; the same order twice writes nothing; [] is 400; a stale set is 409 order_stale; a module with no live lesson and ids [x] is 409; an unknown or foreign module is the bare 404; two concurrent permutations leave exactly one of them', async () => {
    const { module, lessons } = await moduleWithLessons(3);
    const [a1, a2, a3] = lessons as [LessonView, LessonView, LessonView];
    const reversed = await json<{ items: LessonView[] }>(
      await reorderLessons(module.id, { ids: [a3.id, a2.id, a1.id] }),
      200,
    );
    expect(reversed.items.map((l) => [l.id, l.position])).toEqual([
      [a3.id, 1],
      [a2.id, 2],
      [a1.id, 3],
    ]);
    const stamps = await lessonStamps(module.id);
    const again = await json<{ items: LessonView[] }>(
      await reorderLessons(module.id, { ids: [a3.id, a2.id, a1.id] }),
      200,
    );
    expect(again).toEqual(reversed);
    expect(await lessonStamps(module.id)).toEqual(stamps);
    expect((await reorderLessons(module.id, { ids: [] })).status).toBe(400);
    expect((await reorderLessons(module.id, { ids: [a1.id, a1.id, a2.id] })).status).toBe(400);
    await expectStale(await reorderLessons(module.id, { ids: [a1.id, a2.id] }));
    await expectStale(
      await reorderLessons(module.id, { ids: [a1.id, a2.id, a3.id, randomUUID()] }),
    );
    expect(await lessonStamps(module.id)).toEqual(stamps);
    expect((await removeLesson(a2.id)).status).toBe(204);
    await expectStale(await reorderLessons(module.id, { ids: [a1.id, a2.id, a3.id] }));
    const renumbered = await json<{ items: LessonView[] }>(
      await reorderLessons(module.id, { ids: [a1.id, a3.id] }),
      200,
    );
    expect(renumbered.items.map((l) => [l.id, l.position])).toEqual([
      [a1.id, 1],
      [a3.id, 2],
    ]);
    // P18: a module with no live lesson and a non-empty body is stale, not a 404 and not a 200.
    const { module: emptyModule } = await moduleWithLessons(0);
    await expectStale(await reorderLessons(emptyModule.id, { ids: [a1.id] }));
    await expectBare404(await reorderLessons(randomUUID(), { ids: [a1.id, a3.id] }));
    await expectBare404(
      await reorderLessons(module.id, { ids: [a1.id, a3.id] }, tokens.labAdmin, HOSTS.lab),
    );
    // P21: two concurrent permutations of the same set both answer 200; the final order is one of them.
    const four = await moduleWithLessons(4);
    const ids = four.lessons.map((l) => l.id);
    const a = [...ids].reverse();
    const b = [ids[2], ids[0], ids[3], ids[1]] as string[];
    const [resA, resB] = await Promise.all([
      reorderLessons(four.module.id, { ids: a }),
      reorderLessons(four.module.id, { ids: b }),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const finalOrder = (await getCourse(four.course.id)).modules[0]?.lessons.map((l) => l.id);
    expect([a, b]).toContainEqual(finalOrder);
  });

  it('member and support get 403 on the four lesson routes (D-403)', async () => {
    const { module, lessons } = await moduleWithLessons(1);
    const lessonId = (lessons[0] as LessonView).id;
    for (const token of [tokens.demoMember, tokens.demoSupport]) {
      await expectForbidden(await getLesson(lessonId, token));
      await expectForbidden(await patchLesson(lessonId, { isFree: true }, token));
      await expectForbidden(await removeLesson(lessonId, token));
      await expectForbidden(await reorderLessons(module.id, { ids: [lessonId] }, token));
    }
    expect((await json<LessonDetail>(await getLesson(lessonId), 200)).isFree).toBe(false);
  });
});

describe('materials', () => {
  const expectBare404 = async (res: Response) => {
    expect(res.status).toBe(404);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error).not.toHaveProperty('details');
  };
  const expectIssue = async (res: Response, issue: string) => {
    expect(res.status).toBe(400);
    expect(((await res.json()) as Envelope).error.details).toEqual({ courses: issue });
  };
  async function practiceLesson() {
    const course = await createCourse();
    const module = await createModule(course.id);
    return json<LessonView>(await createLesson(module.id), 201);
  }

  it('the ordered set (D-410, P27, P28, P30, P26): an xlsx and a pdf list with kind, filename, mime, bytes and positions 1, 2; resending reversed swaps the positions and keeps the rows; the same set twice leaves created_at; [] clears; a new lesson has materials: []', async () => {
    const lesson = await practiceLesson();
    expect((await json<LessonDetail>(await getLesson(lesson.id), 200)).materials).toEqual([]);
    const xlsx = await uploadAttachment(ZIP_BYTES, XLSX_MIME, `${PREFIX}-doses ácido.xlsx`);
    const pdf = await uploadAttachment(PDF_BYTES, 'application/pdf', `${PREFIX}-protocolo.pdf`);

    const set = await json<LessonDetail>(
      await putMaterials(lesson.id, { assetIds: [xlsx, pdf] }),
      200,
    );
    expect(set.materials.map(({ id: _id, ...rest }) => rest)).toEqual([
      {
        assetId: xlsx,
        filename: `${PREFIX}-doses ácido.xlsx`,
        mime: XLSX_MIME,
        kind: 'sheet',
        bytes: ZIP_BYTES.length,
        position: 1,
      },
      {
        assetId: pdf,
        filename: `${PREFIX}-protocolo.pdf`,
        mime: 'application/pdf',
        kind: 'pdf',
        bytes: PDF_BYTES.length,
        position: 2,
      },
    ]);
    const rowsBefore = await materialRows(lesson.id);
    // P30: the same set again leaves every row — same created_at, same positions, same ids.
    const again = await json<LessonDetail>(
      await putMaterials(lesson.id, { assetIds: [xlsx, pdf] }),
      200,
    );
    expect(again).toEqual(set);
    expect(await materialRows(lesson.id)).toEqual(rowsBefore);
    // Reversed: positions swap, the rows (and their created_at) survive.
    const reversed = await json<LessonDetail>(
      await putMaterials(lesson.id, { assetIds: [pdf, xlsx] }),
      200,
    );
    expect(reversed.materials.map((m) => [m.assetId, m.position])).toEqual([
      [pdf, 1],
      [xlsx, 2],
    ]);
    expect(reversed.materials.map((m) => m.id).sort()).toEqual(
      set.materials.map((m) => m.id).sort(),
    );
    const rowsAfter = await materialRows(lesson.id);
    expect(rowsAfter.map((r) => r.created_at).sort()).toEqual(
      rowsBefore.map((r) => r.created_at).sort(),
    );
    // The lesson detail route lists them in `position, id` order too.
    expect((await json<LessonDetail>(await getLesson(lesson.id), 200)).materials).toEqual(
      reversed.materials,
    );
    // Dropping one keeps the other's row; [] clears (P26).
    const one = await json<LessonDetail>(await putMaterials(lesson.id, { assetIds: [xlsx] }), 200);
    expect(one.materials.map((m) => [m.assetId, m.position])).toEqual([[xlsx, 1]]);
    const cleared = await json<LessonDetail>(await putMaterials(lesson.id, { assetIds: [] }), 200);
    expect(cleared.materials).toEqual([]);
    expect(await materialRows(lesson.id)).toEqual([]);
  });

  it('the set rules (P24, P25): 10 ids pass and 11 are 400 too_many_materials; a duplicate is 400; the same asset on two lessons is allowed; a pending attachment and a cover image are 400 material_invalid; an unknown id, a rede-demo asset from the lab admin and a non-uuid are refused with nothing written', async () => {
    const lesson = await practiceLesson();
    const ready: string[] = [];
    for (let i = 0; i < 11; i += 1) {
      ready.push(
        await seedAttachment(demoTenantId, 'ready', 'application/pdf', `${PREFIX}-m${i}.pdf`),
      );
    }
    await expectIssue(await putMaterials(lesson.id, { assetIds: ready }), 'too_many_materials');
    expect(await materialRows(lesson.id)).toEqual([]);
    const ten = await json<LessonDetail>(
      await putMaterials(lesson.id, { assetIds: ready.slice(0, 10) }),
      200,
    );
    expect(ten.materials.map((m) => m.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(ten.materials.map((m) => m.assetId)).toEqual(ready.slice(0, 10));
    // P25: a duplicate is malformed input (400, the plain issues list), never silently collapsed.
    const dup = await putMaterials(lesson.id, { assetIds: [ready[0], ready[0]] });
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as Envelope).error.details).toHaveProperty('issues');
    expect((await materialRows(lesson.id)).length).toBe(10);
    // P25: the same asset on another lesson is allowed (the unique is per lesson).
    const other = await practiceLesson();
    const shared = await json<LessonDetail>(
      await putMaterials(other.id, { assetIds: [ready[0] as string] }),
      200,
    );
    expect(shared.materials[0]?.assetId).toBe(ready[0]);
    expect((await materialRows(lesson.id)).length).toBe(10);

    const before = await materialRows(other.id);
    const pending = await seedAttachment(demoTenantId, 'pending');
    await expectIssue(await putMaterials(other.id, { assetIds: [pending] }), 'material_invalid');
    const rejected = await seedAttachment(demoTenantId, 'rejected');
    await expectIssue(await putMaterials(other.id, { assetIds: [rejected] }), 'material_invalid');
    const cover = await seedAsset(demoTenantId, 'image', 'cover', 'ready');
    await expectIssue(await putMaterials(other.id, { assetIds: [cover] }), 'material_invalid');
    const video = await startLessonVideo();
    await expectIssue(
      await putMaterials(other.id, { assetIds: [ready[1] as string, video.assetId] }),
      'material_invalid',
    );
    await expectIssue(await putMaterials(other.id, { assetIds: ['x'] }), 'material_invalid');
    // Unknown and foreign ids are the bare 404 (T-08.3-20: a path-like reference, not a code).
    await expectBare404(await putMaterials(other.id, { assetIds: [randomUUID()] }));
    await expectBare404(
      await putMaterials(other.id, { assetIds: [ready[1] as string, randomUUID()] }),
    );
    const labCourse = await json<CourseDetail>(
      await request(
        'POST',
        '/v1/courses',
        tokens.labAdmin,
        { title: `${PREFIX} lab`, instructorName: 'Lab' },
        HOSTS.lab,
      ),
      201,
    );
    const labModule = await json<ModuleView>(
      await request(
        'POST',
        `/v1/courses/${labCourse.id}/modules`,
        tokens.labAdmin,
        { title: `${PREFIX} lab` },
        HOSTS.lab,
      ),
      201,
    );
    const labLesson = await json<LessonView>(
      await request(
        'POST',
        `/v1/courses/modules/${labModule.id}/lessons`,
        tokens.labAdmin,
        { title: `${PREFIX} lab` },
        HOSTS.lab,
      ),
      201,
    );
    await expectBare404(
      await putMaterials(
        labLesson.id,
        { assetIds: [ready[0] as string] },
        tokens.labAdmin,
        HOSTS.lab,
      ),
    );
    expect(await materialRows(labLesson.id)).toEqual([]);
    await expectBare404(await putMaterials(other.id, { assetIds: [] }, tokens.labAdmin, HOSTS.lab));
    await expectBare404(await putMaterials(randomUUID(), { assetIds: [] }));
    expect(await materialRows(other.id)).toEqual(before);
    // A removed lesson's materials cannot be rewritten; its rows stay.
    expect((await removeLesson(other.id)).status).toBe(204);
    await expectBare404(await putMaterials(other.id, { assetIds: [] }));
    expect(await materialRows(other.id)).toEqual(before);
  });

  it('the signed open (P24, P30, P26, T-08.3-06): 200 with Cache-Control no-store, a token= URL and expiresAt 600 s out; two calls are two URLs; an unknown material, another lesson’s, another tenant’s and a removed lesson’s are the bare 404', async () => {
    const lesson = await practiceLesson();
    const pdf = await uploadAttachment(PDF_BYTES, 'application/pdf', `${PREFIX}-abrir.pdf`);
    const set = await json<LessonDetail>(await putMaterials(lesson.id, { assetIds: [pdf] }), 200);
    const material = set.materials[0] as LessonDetail['materials'][number];

    const t0 = Date.now();
    const res = await materialUrl(lesson.id, material.id);
    const answer = await json<{ url: string; expiresAt: string }>(res, 200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(answer.url).toContain('token=');
    expect(answer.url).toContain(`/${demoTenantId}/media/${pdf}/original`);
    const expiresIn = (new Date(answer.expiresAt).getTime() - t0) / 1000;
    expect(expiresIn).toBeGreaterThanOrEqual(595);
    expect(expiresIn).toBeLessThanOrEqual(605);
    // The URL really opens the object (the capability is live for ten minutes).
    const open = await fetch(answer.url);
    expect(open.status).toBe(200);
    expect(Buffer.from(await open.arrayBuffer()).equals(PDF_BYTES)).toBe(true);
    // P30: no memo — a second call a moment later mints a different URL (the token carries its own
    // issue second), unlike the memoised hour-long `signRead` of the feed.
    await sleep(1100);
    const second = await json<{ url: string }>(await materialUrl(lesson.id, material.id), 200);
    expect(second.url).not.toBe(answer.url);

    // Every miss is the one bare 404.
    await expectBare404(await materialUrl(lesson.id, randomUUID()));
    const otherLesson = await practiceLesson();
    await expectBare404(await materialUrl(otherLesson.id, material.id));
    await expectBare404(await materialUrl(randomUUID(), material.id));
    await expectBare404(await materialUrl(lesson.id, material.id, tokens.labAdmin, HOSTS.lab));
    // A removed asset drops out of the list and its URL is gone.
    const second2 = await uploadAttachment(PDF_BYTES, 'application/pdf', `${PREFIX}-sumir.pdf`);
    const two = await json<LessonDetail>(
      await putMaterials(lesson.id, { assetIds: [pdf, second2] }),
      200,
    );
    await adminSql`update public.media_assets set deleted_at = now() where id = ${second2}::uuid`;
    const listed = await json<LessonDetail>(await getLesson(lesson.id), 200);
    expect(listed.materials.map((m) => m.assetId)).toEqual([pdf]);
    await expectBare404(await materialUrl(lesson.id, two.materials[1]?.id ?? randomUUID()));
    // A removed lesson keeps its rows and answers 404 on the open.
    expect((await removeLesson(lesson.id)).status).toBe(204);
    await expectBare404(await materialUrl(lesson.id, material.id));
    expect((await materialRows(lesson.id)).length).toBe(2);
  });

  it('P31 concurrency: two concurrent PUTs with different sets both answer 200 and the final set is exactly one of them', async () => {
    const lesson = await practiceLesson();
    const assets: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      assets.push(
        await seedAttachment(demoTenantId, 'ready', 'application/pdf', `${PREFIX}-c${i}.pdf`),
      );
    }
    const [a0, a1, a2, a3] = assets as [string, string, string, string];
    for (let round = 0; round < 3; round += 1) {
      const a = [a0, a1, a2];
      const b = [a3, a1];
      const [resA, resB] = await Promise.all([
        putMaterials(lesson.id, { assetIds: a }),
        putMaterials(lesson.id, { assetIds: b }),
      ]);
      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      const final = (await materialRows(lesson.id)).map((r) => r.asset_id);
      expect([a, b]).toContainEqual(final);
    }
  });

  it('member and support get 403 on both material routes (D-403)', async () => {
    const lesson = await practiceLesson();
    const pdf = await seedAttachment(demoTenantId, 'ready');
    const set = await json<LessonDetail>(await putMaterials(lesson.id, { assetIds: [pdf] }), 200);
    const materialId = set.materials[0]?.id ?? '';
    for (const token of [tokens.demoMember, tokens.demoSupport]) {
      await expectForbidden(await putMaterials(lesson.id, { assetIds: [] }, token));
      await expectForbidden(await materialUrl(lesson.id, materialId, token));
    }
    expect((await materialRows(lesson.id)).length).toBe(1);
  });
});

describe('tracks', () => {
  const expectBare404 = async (res: Response) => {
    expect(res.status).toBe(404);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error).not.toHaveProperty('details');
  };
  const expectCourseInvalid = async (res: Response) => {
    expect(res.status).toBe(400);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual({ courses: 'course_invalid' });
  };
  const postTrack = (body: Record<string, unknown>, token = tokens.demoAdmin, host = HOSTS.demo) =>
    request('POST', '/v1/courses/tracks', token, body, host);
  async function createTrack(extra: Record<string, unknown> = {}): Promise<TrackDetail> {
    return json<TrackDetail>(await postTrack({ title: `${PREFIX} trilha`, ...extra }), 201);
  }
  const getTrack = (trackId: string, token = tokens.demoAdmin, host = HOSTS.demo) =>
    request('GET', `/v1/courses/tracks/${trackId}`, token, undefined, host);
  const patchTrack = (
    trackId: string,
    body: Record<string, unknown>,
    token = tokens.demoAdmin,
    host = HOSTS.demo,
  ) => request('PATCH', `/v1/courses/tracks/${trackId}`, token, body, host);
  const putTrackStatus = (
    trackId: string,
    status: string,
    token = tokens.demoAdmin,
    host = HOSTS.demo,
  ) => request('PUT', `/v1/courses/tracks/${trackId}/status`, token, { status }, host);
  const putOrder = (trackId: string, body: unknown, token = tokens.demoAdmin, host = HOSTS.demo) =>
    request('PUT', `/v1/courses/tracks/${trackId}/order`, token, body, host);
  async function listTracks(query: string, token = tokens.demoAdmin, host = HOSTS.demo) {
    return json<TrackPage>(
      await request('GET', `/v1/courses/tracks${query ? `?${query}` : ''}`, token, undefined, host),
      200,
    );
  }
  /** A published course of the demo tenant (no lesson, so it publishes at once — P12 (4)). */
  async function publishedCourse(title = `${PREFIX} curso publicado`): Promise<CourseDetail> {
    const course = await createCourse({ title });
    return json<CourseDetail>(await setStatus(course.id, 'published'), 200);
  }
  /** The link rows of a track as stored: course id, position and the row's own `created_at`. */
  async function linkStamps(trackId: string) {
    return adminSql<{ course_id: string; position: number; created_at: string }[]>`
      select course_id::text as course_id, position, created_at::text as created_at
        from public.course_track_courses
       where track_id = ${trackId}::uuid
       order by course_id`;
  }
  async function trackStamp(trackId: string) {
    const [row] = await adminSql<
      { status: string; archived_at: string | null; updated_at: string }[]
    >`
      select status, archived_at::text as archived_at, updated_at::text as updated_at
        from public.course_tracks where id = ${trackId}::uuid`;
    return row;
  }
  const orderOf = (detail: TrackDetail) => detail.courses.map((c) => [c.id, c.position]);

  it('create (COURSE-10, D-415, P40): the minimal body creates an active track with every default and no course; a ready cover attaches and a pending, foreign or unknown one is 400 cover_invalid by name; the field caps and an unknown key are 400; a track body carries no hours or lessons (PR-11)', async () => {
    const minimal = await createTrack();
    expect(minimal).toMatchObject({
      title: `${PREFIX} trilha`,
      subtitle: '',
      audience: '',
      description: '',
      coverAssetId: null,
      status: 'active',
      archivedAt: null,
      courses: [],
      courseCount: 0,
    });
    expect(Object.keys(minimal).sort()).toEqual(
      [
        'id',
        'title',
        'subtitle',
        'audience',
        'description',
        'coverAssetId',
        'status',
        'archivedAt',
        'createdAt',
        'courses',
        'courseCount',
      ].sort(),
    );
    expect(await json<TrackDetail>(await getTrack(minimal.id), 200)).toEqual(minimal);

    const readyCover = await seedAsset(demoTenantId, 'image', 'cover', 'ready');
    const full = await createTrack({
      title: `${PREFIX} Do zero ao primeiro atendimento`,
      subtitle: 'Quatro cursos em sequência',
      audience: 'Para quem está começando',
      description: 'Comece pelo básico.',
      coverAssetId: readyCover,
    });
    expect(full).toMatchObject({
      subtitle: 'Quatro cursos em sequência',
      audience: 'Para quem está começando',
      description: 'Comece pelo básico.',
      coverAssetId: readyCover,
    });

    const pendingCover = await seedAsset(demoTenantId, 'image', 'cover', 'pending');
    const labCover = await seedAsset(labTenantId, 'image', 'cover', 'ready');
    const postCover = await seedAsset(demoTenantId, 'image', 'post', 'ready');
    for (const coverAssetId of [pendingCover, labCover, postCover, randomUUID()]) {
      const res = await postTrack({ title: `${PREFIX} t`, coverAssetId });
      expect(res.status).toBe(400);
      expect(((await res.json()) as Envelope).error.details).toEqual({ courses: 'cover_invalid' });
    }
    for (const [body, code] of [
      [{ title: '   ' }, 'title_required'],
      [{ title: `${PREFIX} ${'x'.repeat(120)}` }, 'title_too_long'],
      [{ title: `${PREFIX} t`, subtitle: 'y'.repeat(161) }, 'tagline_too_long'],
      [{ title: `${PREFIX} t`, audience: 'y'.repeat(61) }, 'tagline_too_long'],
      [{ title: `${PREFIX} t`, description: 'y'.repeat(2001) }, 'description_too_long'],
    ] as const) {
      const res = await postTrack(body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as Envelope).error.details).toEqual({ courses: code });
    }
    for (const extra of [{ certificateHours: 10 }, { courseIds: [] }, { lessons: [] }]) {
      const res = await postTrack({ title: `${PREFIX} t`, ...extra });
      expect(res.status).toBe(400);
      expect(((await res.json()) as Envelope).error.details).toHaveProperty('issues');
    }
  });

  it('edit (COURSE-10): one field changes alone; null detaches the cover; patch_empty and an unknown key are 400; an unknown or foreign id is the bare 404 on read, edit, status and order', async () => {
    const readyCover = await seedAsset(demoTenantId, 'image', 'cover', 'ready');
    const track = await createTrack({ coverAssetId: readyCover, audience: 'Iniciantes' });
    const edited = await json<TrackDetail>(await patchTrack(track.id, { subtitle: 'Novo' }), 200);
    expect(edited).toEqual({ ...track, subtitle: 'Novo' });
    const detached = await json<TrackDetail>(
      await patchTrack(track.id, { coverAssetId: null, audience: '' }),
      200,
    );
    expect(detached).toEqual({ ...edited, coverAssetId: null, audience: '' });
    const empty = await patchTrack(track.id, {});
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as Envelope).error.details).toEqual({ courses: 'patch_empty' });
    const unknownKey = await patchTrack(track.id, { title: 'x', status: 'archived' });
    expect(unknownKey.status).toBe(400);
    expect(((await unknownKey.json()) as Envelope).error.details).toHaveProperty('issues');
    // D-23: unknown and foreign are one answer, on every id route.
    for (const id of [randomUUID()]) {
      await expectBare404(await getTrack(id));
      await expectBare404(await patchTrack(id, { title: 'x' }));
      await expectBare404(await putTrackStatus(id, 'archived'));
      await expectBare404(await putOrder(id, { ids: [] }));
    }
    await expectBare404(await getTrack(track.id, tokens.labAdmin, HOSTS.lab));
    await expectBare404(await patchTrack(track.id, { title: 'x' }, tokens.labAdmin, HOSTS.lab));
    await expectBare404(await putTrackStatus(track.id, 'archived', tokens.labAdmin, HOSTS.lab));
    await expectBare404(await putOrder(track.id, { ids: [] }, tokens.labAdmin, HOSTS.lab));
    expect(await json<TrackDetail>(await getTrack(track.id), 200)).toEqual(detached);
  });

  it('order (COURSE-10, D-414, D-415, P39, P40, P41, P42): two published courses take positions 1, 2 with courseCount 2; a draft, an archived, a rede-lab, an unknown and a non-uuid id are 400 course_invalid with nothing written; a duplicate is 400; the same list twice keeps the rows; the reversed list swaps positions and keeps created_at; [] clears; the same course sits in two tracks', async () => {
    const [a, b] = [
      await publishedCourse(`${PREFIX} pub A`),
      await publishedCourse(`${PREFIX} pub B`),
    ];
    const draft = await createCourse({ title: `${PREFIX} draft` });
    const archived = await createCourse({ title: `${PREFIX} archived` });
    await json(await setStatus(archived.id, 'archived'), 200);
    const labRes = await request(
      'POST',
      '/v1/courses',
      tokens.labAdmin,
      { title: `${PREFIX} lab`, instructorName: 'x' },
      HOSTS.lab,
    );
    const lab = await json<CourseDetail>(labRes, 201);
    await json(
      await request(
        'PUT',
        `/v1/courses/${lab.id}/status`,
        tokens.labAdmin,
        { status: 'published' },
        HOSTS.lab,
      ),
      200,
    );
    const track = await createTrack();

    const linked = await json<TrackDetail>(await putOrder(track.id, { ids: [a.id, b.id] }), 200);
    expect(orderOf(linked)).toEqual([
      [a.id, 1],
      [b.id, 2],
    ]);
    expect(linked.courseCount).toBe(2);
    expect(linked.courses.map((c) => [c.title, c.status, c.coverAssetId])).toEqual([
      [a.title, 'published', null],
      [b.title, 'published', null],
    ]);
    const stamps = await linkStamps(track.id);
    expect(stamps.map((s) => s.position).sort()).toEqual([1, 2]);

    // Published courses of THIS tenant only — one code for every refusal, nothing written.
    for (const ids of [
      [a.id, draft.id],
      [archived.id],
      [a.id, b.id, lab.id],
      [randomUUID()],
      ['not-a-uuid'],
    ]) {
      await expectCourseInvalid(await putOrder(track.id, { ids }));
    }
    expect(await linkStamps(track.id)).toEqual(stamps);
    // P39: a duplicate (in one or two spellings) is malformed input, never a set.
    for (const ids of [
      [a.id, a.id],
      [a.id, a.id.toUpperCase()],
    ]) {
      const dup = await putOrder(track.id, { ids });
      expect(dup.status).toBe(400);
      expect(((await dup.json()) as Envelope).error.details).toHaveProperty('issues');
    }
    const extraKey = await putOrder(track.id, { ids: [a.id], force: true });
    expect(extraKey.status).toBe(400);
    expect(await linkStamps(track.id)).toEqual(stamps);

    // P42: the same list twice touches no row — created_at AND position byte-identical, and the
    // track row's updated_at too.
    const trackBefore = await trackStamp(track.id);
    const again = await json<TrackDetail>(await putOrder(track.id, { ids: [a.id, b.id] }), 200);
    expect(again).toEqual(linked);
    expect(await linkStamps(track.id)).toEqual(stamps);
    expect(await trackStamp(track.id)).toEqual(trackBefore);
    // Upper-case spellings of the same uuids are the same set.
    const upper = await json<TrackDetail>(
      await putOrder(track.id, { ids: [a.id, b.id].map((id) => id.toUpperCase()) }),
      200,
    );
    expect(upper).toEqual(linked);
    expect(await linkStamps(track.id)).toEqual(stamps);

    // The reversed list renumbers both rows and keeps their created_at (the link is the same row).
    const reversed = await json<TrackDetail>(await putOrder(track.id, { ids: [b.id, a.id] }), 200);
    expect(orderOf(reversed)).toEqual([
      [b.id, 1],
      [a.id, 2],
    ]);
    const reversedStamps = await linkStamps(track.id);
    expect(reversedStamps.map((s) => [s.course_id, s.created_at])).toEqual(
      stamps.map((s) => [s.course_id, s.created_at]),
    );
    // A shorter list unlinks the absent course and keeps the present row.
    const shorter = await json<TrackDetail>(await putOrder(track.id, { ids: [a.id] }), 200);
    expect(orderOf(shorter)).toEqual([[a.id, 1]]);
    expect(shorter.courseCount).toBe(1);
    expect((await linkStamps(track.id)).map((s) => [s.course_id, s.created_at])).toEqual(
      stamps.filter((s) => s.course_id === a.id).map((s) => [s.course_id, s.created_at]),
    );
    // P40: [] clears the membership; the track stays.
    const cleared = await json<TrackDetail>(await putOrder(track.id, { ids: [] }), 200);
    expect(cleared.courses).toEqual([]);
    expect(cleared.courseCount).toBe(0);
    expect(await linkStamps(track.id)).toEqual([]);
    expect((await getTrack(track.id)).status).toBe(200);
    // P39: the same course in a second track is a second link row.
    const second = await createTrack({ title: `${PREFIX} trilha 2` });
    await json<TrackDetail>(await putOrder(track.id, { ids: [a.id, b.id] }), 200);
    const twice = await json<TrackDetail>(await putOrder(second.id, { ids: [a.id] }), 200);
    expect(orderOf(twice)).toEqual([[a.id, 1]]);
    expect(
      (
        await adminSql<{ n: number }[]>`
          select count(*)::int as n from public.course_track_courses
           where course_id = ${a.id}::uuid`
      )[0]?.n,
    ).toBe(2);
  });

  it('read-time drop (D-415, P41): unpublishing a linked course keeps its link row, the admin detail still lists it with status draft and courseCount drops to 1, the list row reads 1, republishing restores 2; archiving the course behaves the same; the list orders by (created_at desc, id desc) per filter and pages by keyset', async () => {
    const [a, b] = [
      await publishedCourse(`${PREFIX} drop A`),
      await publishedCourse(`${PREFIX} drop B`),
    ];
    const track = await createTrack({ title: `${PREFIX} drop` });
    await json<TrackDetail>(await putOrder(track.id, { ids: [a.id, b.id] }), 200);
    const stamps = await linkStamps(track.id);

    await json(await setStatus(b.id, 'draft'), 200);
    const afterUnpublish = await json<TrackDetail>(await getTrack(track.id), 200);
    expect(afterUnpublish.courses.map((c) => [c.id, c.status, c.position])).toEqual([
      [a.id, 'published', 1],
      [b.id, 'draft', 2],
    ]);
    expect(afterUnpublish.courseCount).toBe(1);
    expect(await linkStamps(track.id)).toEqual(stamps);
    const rowAfter = (await listTracks('filter=active&limit=50')).items.find(
      (r) => r.id === track.id,
    );
    expect(rowAfter?.courseCount).toBe(1);
    // The form's rule: the saved list leaves the unpublished course out — and the server would
    // refuse it anyway.
    await expectCourseInvalid(await putOrder(track.id, { ids: [a.id, b.id] }));
    expect(await linkStamps(track.id)).toEqual(stamps);

    await json(await setStatus(b.id, 'published'), 200);
    expect((await json<TrackDetail>(await getTrack(track.id), 200)).courseCount).toBe(2);
    await json(await setStatus(a.id, 'archived'), 200);
    const afterArchive = await json<TrackDetail>(await getTrack(track.id), 200);
    expect(afterArchive.courses.map((c) => [c.id, c.status])).toEqual([
      [a.id, 'archived'],
      [b.id, 'published'],
    ]);
    expect(afterArchive.courseCount).toBe(1);

    // The list: newest first by (created_at desc, id desc) among this file's tracks, paged by keyset
    // with no duplicate and no skip; archived stands alone.
    const t1 = await createTrack({ title: `${PREFIX} list 1` });
    const t2 = await createTrack({ title: `${PREFIX} list 2` });
    const t3 = await createTrack({ title: `${PREFIX} list 3` });
    await json<TrackDetail>(await putTrackStatus(t2.id, 'archived'), 200);
    const mine = new Set([track.id, t1.id, t2.id, t3.id]);
    const active: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: TrackPage = await listTracks(
        `filter=active&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      expect(page.items.length).toBeLessThanOrEqual(2);
      active.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 100);
    expect(new Set(active).size).toBe(active.length);
    expect(active.filter((id) => mine.has(id))).toEqual([t3.id, t1.id, track.id]);
    const archivedPage = await listTracks('filter=archived&limit=50');
    expect(archivedPage.items.filter((r) => mine.has(r.id)).map((r) => r.id)).toEqual([t2.id]);
    expect(archivedPage.items.find((r) => r.id === t2.id)?.status).toBe('archived');
    const defaultPage = await listTracks('limit=50');
    expect(defaultPage.items.some((r) => r.id === t2.id)).toBe(false);
    // Bounds (T-08.3-19): never a widened read.
    for (const query of [
      'filter=all',
      'limit=0',
      'limit=51',
      `cursor=${'c'.repeat(513)}`,
      'cursor=bad',
      'status=active',
    ]) {
      expect((await request('GET', `/v1/courses/tracks?${query}`, tokens.demoAdmin)).status).toBe(
        400,
      );
    }
  });

  it('status (D-415, P42): active → archived sets archivedAt, lists under archived and keeps the link rows; archived → active clears it; the same status answers the unchanged detail and writes nothing', async () => {
    const a = await publishedCourse(`${PREFIX} status A`);
    const track = await createTrack({ title: `${PREFIX} status` });
    await json<TrackDetail>(await putOrder(track.id, { ids: [a.id] }), 200);
    const stamps = await linkStamps(track.id);

    const same = await json<TrackDetail>(await putTrackStatus(track.id, 'active'), 200);
    const before = await trackStamp(track.id);
    expect(same.status).toBe('active');
    expect(same.archivedAt).toBeNull();
    expect(await trackStamp(track.id)).toEqual(before);

    const archived = await json<TrackDetail>(await putTrackStatus(track.id, 'archived'), 200);
    expect(archived.status).toBe('archived');
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.courses.map((c) => c.id)).toEqual([a.id]);
    expect(archived.courseCount).toBe(1);
    expect(await linkStamps(track.id)).toEqual(stamps);
    expect(
      (await listTracks('filter=archived&limit=50')).items.some((r) => r.id === track.id),
    ).toBe(true);
    expect((await listTracks('filter=active&limit=50')).items.some((r) => r.id === track.id)).toBe(
      false,
    );
    const archivedStamp = await trackStamp(track.id);
    const archivedAgain = await json<TrackDetail>(await putTrackStatus(track.id, 'archived'), 200);
    expect(archivedAgain).toEqual(archived);
    expect(await trackStamp(track.id)).toEqual(archivedStamp);

    const reactivated = await json<TrackDetail>(await putTrackStatus(track.id, 'active'), 200);
    expect(reactivated.status).toBe('active');
    expect(reactivated.archivedAt).toBeNull();
    expect(reactivated.courses.map((c) => c.id)).toEqual([a.id]);
    expect((await listTracks('filter=active&limit=50')).items.some((r) => r.id === track.id)).toBe(
      true,
    );
    const bad = await putTrackStatus(track.id, 'draft');
    expect(bad.status).toBe(400);
  });

  it('P43 concurrency: two concurrent PUT …/order with different lists both answer 200 and the final membership equals exactly one submitted list, positions 1..N', async () => {
    const courses = [];
    for (let i = 1; i <= 4; i += 1) courses.push(await publishedCourse(`${PREFIX} conc ${i}`));
    const ids = courses.map((c) => c.id) as [string, string, string, string];
    const track = await createTrack({ title: `${PREFIX} conc` });
    for (let round = 0; round < 3; round += 1) {
      const listA = [ids[3], ids[2], ids[1]];
      const listB = [ids[0], ids[3], ids[1], ids[2]];
      const [resA, resB] = await Promise.all([
        putOrder(track.id, { ids: listA }),
        putOrder(track.id, { ids: listB }),
      ]);
      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      const final = await json<TrackDetail>(await getTrack(track.id), 200);
      const finalIds = final.courses.map((c) => c.id);
      expect([listA, listB]).toContainEqual(finalIds);
      expect(final.courses.map((c) => c.position)).toEqual(finalIds.map((_, i) => i + 1));
      expect((await linkStamps(track.id)).length).toBe(finalIds.length);
    }
  });

  it('member and support get 403 on the six track routes (D-403)', async () => {
    const a = await publishedCourse(`${PREFIX} perm A`);
    const track = await createTrack({ title: `${PREFIX} perm` });
    for (const token of [tokens.demoMember, tokens.demoSupport]) {
      await expectForbidden(await request('GET', '/v1/courses/tracks', token));
      await expectForbidden(await postTrack({ title: `${PREFIX} x` }, token));
      await expectForbidden(await getTrack(track.id, token));
      await expectForbidden(await patchTrack(track.id, { title: 'x' }, token));
      await expectForbidden(await putTrackStatus(track.id, 'archived', token));
      await expectForbidden(await putOrder(track.id, { ids: [a.id] }, token));
    }
    const unchanged = await json<TrackDetail>(await getTrack(track.id), 200);
    expect(unchanged).toEqual(track);
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
