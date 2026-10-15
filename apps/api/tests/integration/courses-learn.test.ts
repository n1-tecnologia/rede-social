import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { resetFakeVideoInternals } from '@rede-social/core/server/media/video/fake';
import type {
  LearnCourse,
  LearnLesson,
  LessonDetail,
  ProgressResult,
} from '@rede-social/module-courses/contracts';
import {
  learnCourseSchema,
  learnLessonSchema,
  materialUrlSchema,
  progressResultSchema,
} from '@rede-social/module-courses/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildLearnFixture,
  FREE_LESSON_TITLE,
  grantFixtureProduct,
  type LearnFixture,
  learnRequest,
  PAID_LESSON_DESCRIPTION,
  removeLearnFixture,
} from './learn-fixture';
import { adminSql, HOSTS, SEED_PASSWORD, signInAs, withModuleEnabled } from './setup';

/**
 * The 08.5 tracer (08.5-01, SC 1-3, COURSE-18, COURSE-19, COURSE-20; D-423, D-426, D-433) against
 * the live local stack and the real seed: on rede-demo (store and courses on) a PUBLISHED course
 * linked to a product the seed member does not hold, with a free lesson F and a paid lesson P, each
 * with a ready `lesson` video and one material.
 *
 * What is proved here, through every server layer the phase changes (the definer projections, the
 * one access answer, the kernel asset gate, the learn routes):
 *  - the member reads the course (200, `locked: true`) with every live lesson BY TITLE — F open, P
 *    `purchase` — and P's outline row carries exactly the EP-14 keys (no description, no video, no
 *    material); F's title with quotes, accents and an emoji round-trips byte-identical;
 *  - the member opens F (200, its video and material) and is refused P (`403 lesson_locked`, nothing
 *    of P in the body); P's video playback and P's material `/original` are the bare 404 by
 *    remembered asset id, while F's video mints and F's material answers its 302;
 *  - after a grant of the product, P reads 200 and its video mints; the seed admin reads P at any
 *    time;
 *  - D-426: once the course is unpublished, the member, the support and the admin all get the bare
 *    404 for the course and both lessons, and the member's progress row is untouched.
 *
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };

const PREFIX = `cl85-${Date.now()}`;
const DEMO_ADMIN = 'admin@rede-demo.local';
const DEMO_MEMBER = 'member@rede-demo.local';
const DEMO_SUPPORT = 'support@rede-demo.local';

const tokens = { admin: '', member: '', support: '' };
const restores: Array<() => Promise<void>> = [];
let fixture: LearnFixture;

const get = (path: string, token: string) => learnRequest('GET', path, token, HOSTS.demo);

async function expectBare404(res: Response): Promise<void> {
  expect(res.status).toBe(404);
  const body = (await res.json()) as Envelope;
  expect(body.error.code).toBe('NOT_FOUND');
  expect(body.error.details).toBeUndefined();
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  [tokens.admin, tokens.member, tokens.support] = await Promise.all([
    signInAs(DEMO_ADMIN, SEED_PASSWORD),
    signInAs(DEMO_MEMBER, SEED_PASSWORD),
    signInAs(DEMO_SUPPORT, SEED_PASSWORD),
  ]);
  await removeLearnFixture('cl85-');
  restores.push(await withModuleEnabled('demo', 'store'));
  restores.push(await withModuleEnabled('demo', 'courses'));
  fixture = await buildLearnFixture({ prefix: PREFIX, adminToken: tokens.admin, host: 'demo' });
});

afterAll(async () => {
  await removeLearnFixture('cl85-');
  for (const restore of restores.reverse()) await restore();
  resetFakeVideoInternals();
  await stopBoss();
  await adminSql.end();
});

describe('08.5 tracer', () => {
  it('a member reads the locked course as titles: F open, P purchase-locked with exactly the EP-14 keys, and F’s title round-trips', async () => {
    const res = await get(`/v1/courses/learn/courses/${fixture.courseId}`, tokens.member);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const raw = await res.text();
    const course: LearnCourse = learnCourseSchema.parse(JSON.parse(raw));
    expect(course.locked).toBe(true);
    expect(course.modules).toHaveLength(1);
    const [module] = course.modules;
    expect(module?.number).toBe(1);
    expect(module?.lockReason).toBe('purchase');
    const lessons = module?.lessons ?? [];
    expect(lessons.map((lesson) => lesson.id)).toEqual([
      fixture.freeLessonId,
      fixture.paidLessonId,
    ]);
    const [free, paid] = lessons;
    expect(free?.lockReason).toBeNull();
    expect(free?.title).toBe(FREE_LESSON_TITLE);
    expect(free?.number).toBe(1);
    expect(paid?.lockReason).toBe('purchase');
    expect(paid?.number).toBe(2);
    expect(paid?.durationSeconds).toBe(600);
    expect(paid?.hasVideo).toBe(true);
    expect(Object.keys(paid ?? {}).sort()).toEqual(
      [
        'id',
        'title',
        'position',
        'number',
        'durationSeconds',
        'hasVideo',
        'isFree',
        'requiresPrevious',
        'lockReason',
        'completedAt',
        'lastPositionSeconds',
      ].sort(),
    );
    // Nothing of P's content anywhere in the answer (PR-1).
    expect(raw).not.toContain(PAID_LESSON_DESCRIPTION);
    expect(raw).not.toContain(fixture.paidVideoId);
    expect(raw).not.toContain(fixture.freeVideoId);
    expect(raw).not.toContain(fixture.paidMaterialAssetId ?? 'never');
    expect(course.progress).toEqual({
      done: 0,
      total: 2,
      percent: 0,
      nextLessonId: fixture.freeLessonId,
      firstLessonId: fixture.freeLessonId,
      firstFreeLessonId: fixture.freeLessonId,
    });
  });

  it('the member opens F with its video and material, and is refused P with 403 lesson_locked and nothing of P', async () => {
    const res = await get(`/v1/courses/learn/lessons/${fixture.freeLessonId}`, tokens.member);
    expect(res.status).toBe(200);
    const lesson: LearnLesson = learnLessonSchema.parse(await res.json());
    expect(lesson.videoAssetId).toBe(fixture.freeVideoId);
    expect(lesson.videoStatus).toBe('ready');
    expect(lesson.title).toBe(FREE_LESSON_TITLE);
    expect(lesson.materials).toHaveLength(1);
    expect(lesson.materials[0]?.kind).toBe('pdf');
    expect(JSON.stringify(lesson)).not.toContain(fixture.freeMaterialAssetId ?? 'never');
    expect(lesson.moduleNumber).toBe(1);
    expect(lesson.lessonNumber).toBe(1);
    expect(lesson.previous).toBeNull();
    expect(lesson.next).toEqual({ id: fixture.paidLessonId, lockReason: 'purchase' });

    const refused = await get(`/v1/courses/learn/lessons/${fixture.paidLessonId}`, tokens.member);
    expect(refused.status).toBe(403);
    const raw = await refused.text();
    const body = JSON.parse(raw) as Envelope;
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.details).toEqual({ courses: 'lesson_locked' });
    expect(raw).not.toContain(PAID_LESSON_DESCRIPTION);
    expect(raw).not.toContain(fixture.paidVideoId);
  });

  it('by remembered asset id: P’s video and material are the bare 404; F’s video mints and F’s material answers its 302', async () => {
    await expectBare404(await get(`/v1/media/${fixture.paidVideoId}/playback`, tokens.member));
    await expectBare404(
      await get(`/v1/media/${fixture.paidMaterialAssetId}/original`, tokens.member),
    );

    const freeVideo = await get(`/v1/media/${fixture.freeVideoId}/playback`, tokens.member);
    expect(freeVideo.status).toBe(200);
    const freeMaterial = await get(
      `/v1/media/${fixture.freeMaterialAssetId}/original`,
      tokens.member,
    );
    expect(freeMaterial.status).toBe(302);
    expect(freeMaterial.headers.get('location')).toContain(
      `/${fixture.tenantId}/media/${fixture.freeMaterialAssetId}/original`,
    );
  });

  it('the seed admin reads P at any time, and mints its video', async () => {
    const res = await get(`/v1/courses/learn/lessons/${fixture.paidLessonId}`, tokens.admin);
    expect(res.status).toBe(200);
    const lesson = learnLessonSchema.parse(await res.json());
    expect(lesson.description).toBe(PAID_LESSON_DESCRIPTION);
    const course = learnCourseSchema.parse(
      await (await get(`/v1/courses/learn/courses/${fixture.courseId}`, tokens.admin)).json(),
    );
    expect(course.locked).toBe(false);
    expect(course.modules[0]?.lessons.map((lesson) => lesson.lockReason)).toEqual([null, null]);
    expect((await get(`/v1/media/${fixture.paidVideoId}/playback`, tokens.admin)).status).toBe(200);
  });

  it('after the member is granted the product, P reads 200 and its video mints', async () => {
    await grantFixtureProduct(fixture, tokens.admin, 'demo', DEMO_MEMBER);

    const res = await get(`/v1/courses/learn/lessons/${fixture.paidLessonId}`, tokens.member);
    expect(res.status).toBe(200);
    const lesson = learnLessonSchema.parse(await res.json());
    expect(lesson.videoAssetId).toBe(fixture.paidVideoId);
    expect(lesson.materials).toHaveLength(1);
    expect(lesson.previous).toEqual({ id: fixture.freeLessonId, lockReason: null });
    expect((await get(`/v1/media/${fixture.paidVideoId}/playback`, tokens.member)).status).toBe(
      200,
    );
    expect(
      (await get(`/v1/media/${fixture.paidMaterialAssetId}/original`, tokens.member)).status,
    ).toBe(302);

    const course = learnCourseSchema.parse(
      await (await get(`/v1/courses/learn/courses/${fixture.courseId}`, tokens.member)).json(),
    );
    expect(course.locked).toBe(false);
    expect(course.modules[0]?.lockReason).toBeNull();
  });

  it('D-426: an unpublished course and its lessons are the bare 404 for the member, the support and the admin; progress rows are untouched', async () => {
    // A completion recorded while the course is published (the route lands in plan 03).
    await adminSql`
      insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, completed_at)
      select ${fixture.tenantId}::uuid, u.id, ${fixture.freeLessonId}::uuid, now()
        from public.users u where u.email = ${DEMO_MEMBER}`;
    const done = learnCourseSchema.parse(
      await (await get(`/v1/courses/learn/courses/${fixture.courseId}`, tokens.member)).json(),
    );
    expect(done.progress).toMatchObject({ done: 1, total: 2, percent: 50 });
    expect(done.progress.nextLessonId).toBe(fixture.paidLessonId);

    const unpublished = await learnRequest(
      'PUT',
      `/v1/courses/${fixture.courseId}/status`,
      tokens.admin,
      HOSTS.demo,
      { status: 'draft' },
    );
    expect(unpublished.status).toBe(200);

    for (const token of [tokens.member, tokens.support, tokens.admin]) {
      await expectBare404(await get(`/v1/courses/learn/courses/${fixture.courseId}`, token));
      for (const lessonId of [fixture.freeLessonId, fixture.paidLessonId]) {
        await expectBare404(await get(`/v1/courses/learn/lessons/${lessonId}`, token));
      }
    }
    // An unknown id is the same bare body.
    await expectBare404(
      await get(`/v1/courses/learn/courses/${crypto.randomUUID()}`, tokens.member),
    );
    await expectBare404(
      await get(`/v1/courses/learn/lessons/${crypto.randomUUID()}`, tokens.member),
    );

    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.course_lesson_progress
       where lesson_id = ${fixture.freeLessonId}::uuid and completed_at is not null`;
    expect(row?.n).toBe(1);
  });
});

// ── 08.5-03: the member's writes (progress) and material open ────────────────────────────────────

/** A READY `lesson` video of rede-demo with `seconds` of duration, swept by the file's prefix. */
async function readyVideo(seconds: number, label: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
       mime, bytes, duration_seconds, aspect_ratio, filename, ready_at)
    select t.id, m.user_id, 'video', 'lesson', 'ready', 'fake', ${`fake-${crypto.randomUUID()}`},
           ${`fake-playback-${PREFIX}-${label}`}, 'video/mp4', 1048576, ${seconds}, '16:9',
           ${`${PREFIX}-${label}.mp4`}, now()
      from public.tenants t
      join public.memberships m on m.tenant_id = t.id and m.role = 'admin_tenant'
     where t.slug = 'rede-demo'
     order by m.joined_at
     fetch first 1 rows only
    returning id::text as id`;
  if (!row) throw new Error(`could not seed the ${label} video`);
  return row.id;
}

const admin = (method: string, path: string, body?: unknown) =>
  learnRequest(method, path, tokens.admin, HOSTS.demo, body);

async function createdId(res: Response, what: string): Promise<string> {
  expect(res.status, `${what} -> ${res.status}`).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

type LessonSpec = {
  title: string;
  seconds?: number;
  free?: boolean;
  requiresPrevious?: boolean;
  materialAssetId?: string | null;
};

/**
 * An OPEN (no product) course of rede-demo built through the admin API and published: one module
 * per `modules` entry, its lessons in order (a ready video of `seconds` when given, a practice
 * lesson otherwise; `materialAssetId` attaches an already uploaded attachment).
 */
async function publishedCourse(label: string, modules: LessonSpec[][]) {
  const courseId = await createdId(
    await admin('POST', '/v1/courses', { title: `${PREFIX} ${label}`, instructorName: 'Dra. Ana' }),
    `${label} course`,
  );
  const moduleIds: string[] = [];
  const lessonIds: string[][] = [];
  for (const [index, specs] of modules.entries()) {
    const moduleId = await createdId(
      await admin('POST', `/v1/courses/${courseId}/modules`, {
        title: `${PREFIX} ${label} m${index + 1}`,
      }),
      `${label} module`,
    );
    moduleIds.push(moduleId);
    const ids: string[] = [];
    for (const spec of specs) {
      const videoAssetId = spec.seconds
        ? await readyVideo(spec.seconds, `${label}-${spec.title}`)
        : null;
      const lessonId = await createdId(
        await admin('POST', `/v1/courses/modules/${moduleId}/lessons`, {
          title: `${PREFIX} ${spec.title}`,
          videoAssetId,
          isFree: spec.free ?? false,
          requiresPrevious: spec.requiresPrevious ?? false,
        }),
        `${label} lesson ${spec.title}`,
      );
      if (spec.materialAssetId) {
        const res = await admin('PUT', `/v1/courses/lessons/${lessonId}/materials`, {
          assetIds: [spec.materialAssetId],
        });
        expect(res.status).toBe(200);
      }
      ids.push(lessonId);
    }
    lessonIds.push(ids);
  }
  const published = await admin('PUT', `/v1/courses/${courseId}/status`, { status: 'published' });
  expect(published.status).toBe(200);
  return { courseId, moduleIds, lessonIds };
}

/** The first material id of a lesson, read through the admin lesson detail. */
async function materialIdOf(lessonId: string): Promise<string> {
  const res = await admin('GET', `/v1/courses/lessons/${lessonId}`);
  expect(res.status).toBe(200);
  const detail = (await res.json()) as LessonDetail;
  const id = detail.materials[0]?.id;
  if (!id) throw new Error(`lesson ${lessonId} has no material`);
  return id;
}

const readLesson = (lessonId: string, token = tokens.member) =>
  get(`/v1/courses/learn/lessons/${lessonId}`, token);
const materialUrlOf = (lessonId: string, materialId: string, token = tokens.member) =>
  get(`/v1/courses/learn/lessons/${lessonId}/materials/${materialId}/url`, token);
const putProgress = (lessonId: string, body: unknown, token = tokens.member) =>
  learnRequest('PUT', `/v1/courses/learn/lessons/${lessonId}/progress`, token, HOSTS.demo, body);

async function expectRefused(res: Response, status: 403 | 409): Promise<void> {
  expect(res.status).toBe(status);
  const body = (await res.json()) as Envelope;
  expect(body.error.code).toBe(status === 403 ? 'FORBIDDEN' : 'CONFLICT');
  expect(body.error.details).toEqual({
    courses: status === 403 ? 'lesson_locked' : 'lesson_sequence_locked',
  });
}

async function progressOk(res: Response): Promise<ProgressResult> {
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  return progressResultSchema.parse(await res.json());
}

/** Every progress row on a lesson, by the writer's e-mail (the admin connection reads them all). */
async function progressRows(lessonId: string, email?: string) {
  return adminSql<{ email: string; completed_at: string | null; last_position_seconds: number }[]>`
    select u.email, p.completed_at::text as completed_at, p.last_position_seconds
      from public.course_lesson_progress p
      join public.users u on u.id = p.user_id
     where p.lesson_id = ${lessonId}::uuid
       and (${email ?? null}::text is null or u.email = ${email ?? null}::text)`;
}

/** Grants a fixture's product to the seed member and answers the entitlement id (for the revoke). */
async function grantMember(productId: string): Promise<string> {
  const [membership] = await adminSql<{ id: string }[]>`
    select m.id::text as id
      from public.memberships m join public.users u on u.id = m.user_id
      join public.tenants t on t.id = m.tenant_id
     where t.slug = 'rede-demo' and u.email = ${DEMO_MEMBER}`;
  const res = await admin('POST', `/v1/store/products/${productId}/grants`, {
    membershipId: membership?.id,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { entitlementId: string }).entitlementId;
}

describe('08.5 lesson', () => {
  let locked: LearnFixture;
  let seq: Awaited<ReturnType<typeof publishedCourse>>;
  let labLessonId = '';
  let freeMaterialId = '';
  let paidMaterialId = '';
  let seqMaterialId = '';

  beforeAll(async () => {
    locked = await buildLearnFixture({
      prefix: `${PREFIX}-lk`,
      adminToken: tokens.admin,
      host: 'demo',
    });
    // s1 open, s2 behind "Exige concluir a aula anterior" with a material; s3 under a module that
    // is removed after publishing.
    seq = await publishedCourse('seq', [
      [
        { title: 's1' },
        { title: 's2', requiresPrevious: true, materialAssetId: locked.freeMaterialAssetId },
      ],
      [{ title: 's3' }],
    ]);
    expect((await admin('DELETE', `/v1/courses/modules/${seq.moduleIds[1]}`)).status).toBe(204);
    freeMaterialId = await materialIdOf(locked.freeLessonId);
    paidMaterialId = await materialIdOf(locked.paidLessonId);
    seqMaterialId = await materialIdOf(seq.lessonIds[0]?.[1] ?? '');
    // A published rede-lab lesson, written by the admin connection (rede-lab's school stays off).
    const [lab] = await adminSql<{ id: string }[]>`
      with c as (
        insert into public.courses
               (tenant_id, created_by_user_id, title, instructor_name, status, published_at)
        select m.tenant_id, m.user_id, ${`${PREFIX} lab curso`}, 'x', 'published', now()
          from public.memberships m join public.tenants t on t.id = m.tenant_id
         where t.slug = 'rede-lab' and m.role = 'admin_tenant'
         order by m.joined_at
         fetch first 1 rows only
        returning id, tenant_id
      ), mo as (
        insert into public.course_modules (tenant_id, course_id, title, position)
        select tenant_id, id, ${`${PREFIX} lab módulo`}, 1 from c
        returning id, course_id, tenant_id
      )
      insert into public.course_lessons (tenant_id, course_id, module_id, title, position)
      select tenant_id, course_id, id, ${`${PREFIX} lab aula`}, 1 from mo
      returning id::text as id`;
    labLessonId = lab?.id ?? '';
    expect(labLessonId).not.toBe('');
  });

  it('the refusal matrix (COURSE-19, D-428): an unknown, a rede-lab and a removed-module lesson are the bare 404; a paid lesson is 403 lesson_locked; a sequence-locked lesson is 409 lesson_sequence_locked — on the lesson read and on the material URL alike', async () => {
    const s1 = seq.lessonIds[0]?.[0] ?? '';
    const s2 = seq.lessonIds[0]?.[1] ?? '';
    const s3 = seq.lessonIds[1]?.[0] ?? '';
    for (const lessonId of [crypto.randomUUID(), labLessonId, s3]) {
      await expectBare404(await readLesson(lessonId));
      await expectBare404(await materialUrlOf(lessonId, crypto.randomUUID()));
      await expectBare404(await materialUrlOf(lessonId, freeMaterialId));
    }
    await expectRefused(await readLesson(locked.paidLessonId), 403);
    await expectRefused(await materialUrlOf(locked.paidLessonId, paidMaterialId), 403);
    // The access answer comes first: even a material id of another lesson reads the lock.
    await expectRefused(await materialUrlOf(locked.paidLessonId, crypto.randomUUID()), 403);
    await expectRefused(await readLesson(s2), 409);
    await expectRefused(await materialUrlOf(s2, seqMaterialId), 409);
    // The open lessons: s1 reads; F's material opens; another lesson's or an unknown material
    // under an open lesson is the bare 404.
    expect((await readLesson(s1)).status).toBe(200);
    const open = await materialUrlOf(locked.freeLessonId, freeMaterialId);
    expect(open.status).toBe(200);
    expect(open.headers.get('cache-control')).toBe('no-store');
    await expectBare404(await materialUrlOf(locked.freeLessonId, paidMaterialId));
    await expectBare404(await materialUrlOf(locked.freeLessonId, seqMaterialId));
    await expectBare404(await materialUrlOf(locked.freeLessonId, crypto.randomUUID()));
    await expectBare404(await materialUrlOf(s1, seqMaterialId));
  });

  it('EP-17 (COURSE-19): two consecutive material-URL calls both answer 200 no-store with a ten-minute URL and their own expiresAt, and neither writes a row', async () => {
    const before = await progressRows(locked.freeLessonId);
    const [materialRow] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.course_lesson_materials
       where lesson_id = ${locked.freeLessonId}::uuid`;
    const answers = [];
    for (let i = 0; i < 2; i += 1) {
      const sent = Date.now();
      const res = await materialUrlOf(locked.freeLessonId, freeMaterialId);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const answer = materialUrlSchema.parse(await res.json());
      expect(answer.url).toContain('token=');
      expect(answer.url).toContain(
        `/${locked.tenantId}/media/${locked.freeMaterialAssetId}/original`,
      );
      const ttl = Date.parse(answer.expiresAt) - sent;
      expect(ttl).toBeGreaterThan(590_000);
      expect(ttl).toBeLessThanOrEqual(605_000);
      answers.push(answer);
    }
    expect(answers).toHaveLength(2);
    expect(await progressRows(locked.freeLessonId)).toEqual(before);
    const [after] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.course_lesson_materials
       where lesson_id = ${locked.freeLessonId}::uuid`;
    expect(after?.n).toBe(materialRow?.n);
  });

  it('EP-18 (COURSE-19): after a grant the paid lesson reads, writes and opens its material; after the revoke the very next read is 403 lesson_locked and the next write is refused with the row untouched (PR-5)', async () => {
    const entitlementId = await grantMember(locked.productId);
    expect((await readLesson(locked.paidLessonId)).status).toBe(200);
    expect((await materialUrlOf(locked.paidLessonId, paidMaterialId)).status).toBe(200);
    const written = await progressOk(
      await putProgress(locked.paidLessonId, { positionSeconds: 42 }),
    );
    expect(written).toEqual({ completedAt: null, lastPositionSeconds: 42 });

    const revoked = await admin(
      'DELETE',
      `/v1/store/products/${locked.productId}/entitlements/${entitlementId}`,
    );
    expect(revoked.status).toBe(200);
    await expectRefused(await readLesson(locked.paidLessonId), 403);
    await expectRefused(await putProgress(locked.paidLessonId, { positionSeconds: 300 }), 403);
    await expectRefused(await putProgress(locked.paidLessonId, { completed: true }), 403);
    await expectRefused(await materialUrlOf(locked.paidLessonId, paidMaterialId), 403);
    // The revoke never deletes or rewrites what the member recorded.
    expect(await progressRows(locked.paidLessonId, DEMO_MEMBER)).toEqual([
      { email: DEMO_MEMBER, completed_at: null, last_position_seconds: 42 },
    ]);
  });

  it('COURSE-25 staff: support and admin read the paid and the sequence-locked lesson and open their materials', async () => {
    const s2 = seq.lessonIds[0]?.[1] ?? '';
    for (const token of [tokens.support, tokens.admin]) {
      expect((await readLesson(locked.paidLessonId, token)).status).toBe(200);
      expect((await materialUrlOf(locked.paidLessonId, paidMaterialId, token)).status).toBe(200);
      expect((await readLesson(s2, token)).status).toBe(200);
      expect((await materialUrlOf(s2, seqMaterialId, token)).status).toBe(200);
    }
  });
});

describe('08.5 progress', () => {
  let course: Awaited<ReturnType<typeof publishedCourse>>;
  let ordered: Awaited<ReturnType<typeof publishedCourse>>;
  let free: LearnFixture;
  const lesson = (n: number) => course.lessonIds[0]?.[n - 1] ?? '';

  beforeAll(async () => {
    // p1, p2 (behind p1), p3, p5 carry a 100 s ready video; p4 has none.
    course = await publishedCourse('prog', [
      [
        { title: 'p1', seconds: 100 },
        { title: 'p2', seconds: 100, requiresPrevious: true },
        { title: 'p3', seconds: 100 },
        { title: 'p4' },
        { title: 'p5', seconds: 100 },
      ],
    ]);
    // o1, o2 (behind o1) in module A; o3 (behind o2) in module B.
    ordered = await publishedCourse('ord', [
      [{ title: 'o1' }, { title: 'o2', requiresPrevious: true }],
      [{ title: 'o3', requiresPrevious: true }],
    ]);
    // A product-locked course: F free, P paid behind F.
    free = await buildLearnFixture({
      prefix: `${PREFIX}-fr`,
      adminToken: tokens.admin,
      host: 'demo',
      materials: false,
    });
    const rule = await admin('PATCH', `/v1/courses/lessons/${free.paidLessonId}`, {
      requiresPrevious: true,
    });
    expect(rule.status).toBe(200);
    expect(((await rule.json()) as LessonDetail).requiresPrevious).toBe(true);
  });

  it('SC 4 sequence unlock end to end: the second lesson reads 409 and its write is 409 with nothing written; completing the first answers 200 with completedAt; the second then reads 200', async () => {
    await expectRefused(await readLesson(lesson(2)), 409);
    await expectRefused(await putProgress(lesson(2), { positionSeconds: 10 }), 409);
    await expectRefused(await putProgress(lesson(2), { completed: true }), 409);
    expect(await progressRows(lesson(2))).toEqual([]);

    const done = await progressOk(await putProgress(lesson(1), { completed: true }));
    expect(done.completedAt).not.toBeNull();
    expect(done.lastPositionSeconds).toBe(0);
    const read = await readLesson(lesson(2));
    expect(read.status).toBe(200);
    const opened = learnLessonSchema.parse(await read.json());
    expect(opened.previous).toEqual({ id: lesson(1), lockReason: null });
    // The course page reads the completion back.
    const page = learnCourseSchema.parse(
      await (await get(`/v1/courses/learn/courses/${course.courseId}`, tokens.member)).json(),
    );
    expect(page.progress).toMatchObject({
      done: 1,
      total: 5,
      percent: 20,
      nextLessonId: lesson(2),
    });
  });

  it('EP-20 (COURSE-21): on a 100 s video a tick at 89 s leaves completedAt null and a tick at exactly 90 s sets it', async () => {
    const at89 = await progressOk(await putProgress(lesson(2), { positionSeconds: 89 }));
    expect(at89).toEqual({ completedAt: null, lastPositionSeconds: 89 });
    const at90 = await progressOk(await putProgress(lesson(2), { positionSeconds: 90 }));
    expect(at90.completedAt).not.toBeNull();
    expect(at90.lastPositionSeconds).toBe(90);
  });

  it('the clamp and EP-22 (COURSE-21): 500 s on a 100 s video stores 100 and completes; a lower tick after completion keeps completedAt and stores the lower position; the button alone keeps the position', async () => {
    const clamped = await progressOk(await putProgress(lesson(3), { positionSeconds: 500 }));
    expect(clamped.lastPositionSeconds).toBe(100);
    expect(clamped.completedAt).not.toBeNull();
    const lower = await progressOk(await putProgress(lesson(3), { positionSeconds: 30 }));
    expect(lower).toEqual({ completedAt: clamped.completedAt, lastPositionSeconds: 30 });
    const button = await progressOk(await putProgress(lesson(3), { completed: true }));
    expect(button).toEqual({ completedAt: clamped.completedAt, lastPositionSeconds: 30 });
    expect(await progressRows(lesson(3))).toHaveLength(1);
  });

  it('EP-21 (COURSE-21): {} is 400 patch_empty; completed false, 14401, a fraction and an unknown key are 400; a lesson with no video clamps every position to 0 and completes only by completed: true', async () => {
    const empty = await putProgress(lesson(4), {});
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as Envelope).error.details).toEqual({ courses: 'patch_empty' });
    for (const body of [
      { completed: false },
      { positionSeconds: 14401 },
      { positionSeconds: -1 },
      { positionSeconds: 1.5 },
      { positionSeconds: 10, userId: crypto.randomUUID() },
    ]) {
      expect((await putProgress(lesson(4), body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await progressRows(lesson(4))).toEqual([]);

    const tick = await progressOk(await putProgress(lesson(4), { positionSeconds: 14400 }));
    expect(tick).toEqual({ completedAt: null, lastPositionSeconds: 0 });
    const button = await progressOk(await putProgress(lesson(4), { completed: true }));
    expect(button.completedAt).not.toBeNull();
    expect(button.lastPositionSeconds).toBe(0);
  });

  it('EP-24 and EP-23 (COURSE-21): two concurrent writes both answer 200 and leave exactly one row; the same completed: true twice answers the SAME completedAt', async () => {
    const [a, b] = await Promise.all([
      putProgress(lesson(5), { positionSeconds: 20 }),
      putProgress(lesson(5), { positionSeconds: 40 }),
    ]);
    const answers = [await progressOk(a), await progressOk(b)];
    expect(answers.map((x) => x.completedAt)).toEqual([null, null]);
    const rows = await progressRows(lesson(5));
    expect(rows).toHaveLength(1);
    expect([20, 40]).toContain(rows[0]?.last_position_seconds);

    const first = await progressOk(await putProgress(lesson(5), { completed: true }));
    expect(first.completedAt).not.toBeNull();
    const second = await progressOk(await putProgress(lesson(5), { completed: true }));
    expect(second.completedAt).toBe(first.completedAt);
    expect(await progressRows(lesson(5))).toHaveLength(1);
  });

  it('EP-34 (COURSE-25, D-422): on the same open lesson the admin write answers 204 with no body and zero rows, and the support write answers 200 with one own row', async () => {
    const adminWrite = await putProgress(lesson(1), { positionSeconds: 10 }, tokens.admin);
    expect(adminWrite.status).toBe(204);
    expect(await adminWrite.text()).toBe('');
    // The backstop answers before any read: the button on another lesson writes nothing either.
    expect((await putProgress(lesson(2), { completed: true }, tokens.admin)).status).toBe(204);
    expect(await progressRows(lesson(1), DEMO_ADMIN)).toEqual([]);
    expect(await progressRows(lesson(2), DEMO_ADMIN)).toEqual([]);

    const supportWrite = await progressOk(
      await putProgress(lesson(1), { positionSeconds: 10 }, tokens.support),
    );
    expect(supportWrite).toEqual({ completedAt: null, lastPositionSeconds: 10 });
    expect(await progressRows(lesson(1), DEMO_SUPPORT)).toEqual([
      { email: DEMO_SUPPORT, completed_at: null, last_position_seconds: 10 },
    ]);
    // The member's own completion of p1 is untouched by the staff writes.
    const member = await progressRows(lesson(1), DEMO_MEMBER);
    expect(member).toHaveLength(1);
    expect(member[0]?.completed_at).not.toBeNull();
  });

  it('D-429: a non-buyer writes progress on the free lesson; once the product is bought, that completion already opens the paid lesson that requires it', async () => {
    await expectRefused(await readLesson(free.paidLessonId), 403);
    const done = await progressOk(await putProgress(free.freeLessonId, { completed: true }));
    expect(done.completedAt).not.toBeNull();
    // The purchase lock comes first: the non-buyer cannot write the paid lesson either.
    await expectRefused(await putProgress(free.paidLessonId, { positionSeconds: 5 }), 403);

    await grantMember(free.productId);
    const read = await readLesson(free.paidLessonId);
    expect(read.status).toBe(200);
    expect(learnLessonSchema.parse(await read.json()).previous).toEqual({
      id: free.freeLessonId,
      lockReason: null,
    });
    expect((await putProgress(free.paidLessonId, { positionSeconds: 5 })).status).toBe(200);
  });

  it('EP-27 read side (COURSE-22): moving the first lesson down and moving the first module down clear the rule on the lesson that becomes first, and the next member read reflects the new order at once', async () => {
    const [o1, o2] = ordered.lessonIds[0] ?? [];
    const o3 = ordered.lessonIds[1]?.[0] ?? '';
    const [mA, mB] = ordered.moduleIds;
    await expectRefused(await readLesson(o2 ?? ''), 409);
    await expectRefused(await readLesson(o3), 409);

    // Lesson reorder: o2 becomes first and opens at once; o1 (now second, no rule) stays open.
    const lessonOrder = await admin('PUT', `/v1/courses/modules/${mA}/lessons/order`, {
      ids: [o2, o1],
    });
    expect(lessonOrder.status).toBe(200);
    expect((await readLesson(o2 ?? '')).status).toBe(200);
    expect((await readLesson(o1 ?? '')).status).toBe(200);
    await expectRefused(await readLesson(o3), 409);

    // Module reorder: o3 becomes first in course order and opens at once.
    const moduleOrder = await admin('PUT', `/v1/courses/${ordered.courseId}/modules/order`, {
      ids: [mB, mA],
    });
    expect(moduleOrder.status).toBe(200);
    expect((await readLesson(o3)).status).toBe(200);
    const [row] = await adminSql<{ requires_previous: boolean }[]>`
      select requires_previous from public.course_lessons where id = ${o3}::uuid`;
    expect(row?.requires_previous).toBe(false);
  });
});
