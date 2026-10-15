import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { resetFakeVideoInternals } from '@rede-social/core/server/media/video/fake';
import type {
  LearnCataloguePage,
  LearnCourse,
  LearnCourseCard,
  LearnLesson,
  LearnLive,
  LearnLivesPage,
  LessonDetail,
  ProgressResult,
} from '@rede-social/module-courses/contracts';
import {
  learnCataloguePageSchema,
  learnCourseSchema,
  learnLessonSchema,
  learnLiveSchema,
  learnLivesPageSchema,
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

// ── 08.5-04: the member catalogue (COURSE-17; D-420, D-421, D-426, D-430) ────────────────────────

/** Every title and category name of this describe starts with it (swept in its `afterAll`). */
const CAT = `${PREFIX}-cat`;

async function catalogue(query = '', token = tokens.member): Promise<LearnCataloguePage> {
  const res = await get(`/v1/courses/learn/courses${query}`, token);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  return learnCataloguePageSchema.parse(await res.json());
}

/** Every card of the catalogue, following `nextCursor`; fails on a repeated id (EP-07). */
async function allCards(
  params: Record<string, string> = {},
  token = tokens.member,
): Promise<LearnCourseCard[]> {
  const items: LearnCourseCard[] = [];
  let cursor: string | null = null;
  for (let pages = 0; pages < 100; pages += 1) {
    const query = new URLSearchParams({ ...params, ...(cursor ? { cursor } : {}) });
    const page = await catalogue(`?${query}`, token);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  return items;
}

/** A category of rede-demo written by the admin connection. */
async function sqlCategory(name: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.course_categories (tenant_id, name)
    select id, ${`${CAT} ${name}`} from public.tenants where slug = 'rede-demo'
    returning id::text as id`;
  if (!row) throw new Error(`could not seed the category ${name}`);
  return row.id;
}

/**
 * A course of rede-demo written by the admin connection, with its `status` and `published_at` set
 * by hand (the catalogue's order is `published_at desc, id desc`; EP-07 needs two equal instants).
 */
async function sqlCourse(
  label: string,
  input: { status?: string; publishedAt?: string | null; categoryId?: string | null } = {},
): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.courses
           (tenant_id, created_by_user_id, title, instructor_name, status, published_at, archived_at,
            category_id)
    select m.tenant_id, m.user_id, ${`${CAT} ${label}`}, 'Dra. Ana', ${input.status ?? 'published'},
           ${input.publishedAt === undefined ? new Date().toISOString() : input.publishedAt}::timestamptz,
           case when ${input.status ?? 'published'} = 'archived' then now() end,
           ${input.categoryId ?? null}::uuid
      from public.memberships m join public.tenants t on t.id = m.tenant_id
     where t.slug = 'rede-demo' and m.role = 'admin_tenant'
     order by m.joined_at
     fetch first 1 rows only
    returning id::text as id`;
  if (!row) throw new Error(`could not seed the course ${label}`);
  return row.id;
}

/** `minutes` before a fixed instant, ISO (the bulk courses' distinct `published_at`). */
const minutesBefore = (base: number, minutes: number) =>
  new Date(base - minutes * 60_000).toISOString();

describe('08.5 catalogue', () => {
  /** Courses of rede-demo published before this describe (other files' residue): unpublished, then restored. */
  let hidden: string[] = [];
  const base = Date.now() - 24 * 60 * 60_000;
  const bulk: string[] = [];
  let gama = '';

  beforeAll(async () => {
    // The earlier describes of this file are done: sweep them so the catalogue starts empty.
    await removeLearnFixture('cl85-');
    const rows = await adminSql<{ id: string }[]>`
      update public.courses c set status = 'draft'
        from public.tenants t
       where t.id = c.tenant_id and t.slug = 'rede-demo' and c.status = 'published'
      returning c.id::text as id`;
    hidden = rows.map((row) => row.id);
  });

  afterAll(async () => {
    await removeLearnFixture('cl85-');
    await adminSql`delete from public.course_categories where name like ${`${CAT}%`}`;
    if (hidden.length > 0) {
      await adminSql`
        update public.courses set status = 'published' where id = any (${hidden}::uuid[])`;
    }
  });

  it('EP-08 (COURSE-17): a tenant with no published course answers { items: [], categories: [], nextCursor: null } for the member, the support and the admin', async () => {
    await sqlCategory('Vazia');
    for (const token of [tokens.member, tokens.support, tokens.admin]) {
      expect(await catalogue('', token)).toEqual({ items: [], categories: [], nextCursor: null });
    }
  });

  it('EP-06 (COURSE-17): 21 published courses are a page of 20 with a cursor and a page of 1 with a null cursor, newest published first; the chips list exactly the one category holding a published course', async () => {
    gama = await sqlCategory('Gama');
    const draftOnly = await sqlCategory('Rascunho');
    await sqlCourse('rascunho', { status: 'draft', publishedAt: null, categoryId: draftOnly });
    for (let i = 1; i <= 21; i += 1) {
      bulk.push(
        await sqlCourse(`bulk-${i}`, {
          publishedAt: minutesBefore(base, i),
          categoryId: i === 21 ? gama : null,
        }),
      );
    }

    const first = await catalogue();
    expect(first.items.map((item) => item.id)).toEqual(bulk.slice(0, 20));
    expect(first.nextCursor).not.toBeNull();
    expect(first.categories).toEqual([{ id: gama, name: `${CAT} Gama` }]);

    const second = await catalogue(`?cursor=${encodeURIComponent(first.nextCursor ?? '')}`);
    expect(second.items.map((item) => item.id)).toEqual([bulk[20]]);
    expect(second.nextCursor).toBeNull();
    // The chips ride every page, whatever the cursor.
    expect(second.categories).toEqual(first.categories);
    expect(second.items[0]?.category).toEqual({ id: gama, name: `${CAT} Gama` });

    // A tampered cursor is refused, never a widened read (T-08.5-24).
    const bad = await get('/v1/courses/learn/courses?cursor=bm90LWEtY3Vyc29y', tokens.member);
    expect(bad.status).toBe(400);
  });

  it('EP-09 (COURSE-17): items follow published_at desc, id desc and a republish keeps the first published_at; the chips follow lower(name), id', async () => {
    await sqlCategory('beta');
    const alfa = await sqlCategory('Alfa');
    const betaId = (
      await adminSql<{ id: string }[]>`
        select id::text as id from public.course_categories where name = ${`${CAT} beta`}`
    )[0]?.id;
    await sqlCourse('alfa', { publishedAt: minutesBefore(base, 30), categoryId: alfa });
    await sqlCourse('beta', { publishedAt: minutesBefore(base, 31), categoryId: betaId });

    // R is published through the API (now), then a newer N lands, then R is unpublished and
    // republished: R keeps its first published_at, so N stays above it.
    const republished = await createdId(
      await admin('POST', '/v1/courses', { title: `${CAT} republicado`, instructorName: 'Ana' }),
      'republished course',
    );
    expect(
      (await admin('PUT', `/v1/courses/${republished}/status`, { status: 'published' })).status,
    ).toBe(200);
    const newer = await sqlCourse('mais-novo', {
      publishedAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(
      (await admin('PUT', `/v1/courses/${republished}/status`, { status: 'draft' })).status,
    ).toBe(200);
    expect(
      (await admin('PUT', `/v1/courses/${republished}/status`, { status: 'published' })).status,
    ).toBe(200);

    const items = await allCards({ limit: '7' });
    const [stored] = await adminSql<{ ids: string[] }[]>`
      select array_agg(c.id::text order by c.published_at desc, c.id desc) as ids
        from public.courses c join public.tenants t on t.id = c.tenant_id
       where t.slug = 'rede-demo' and c.status = 'published'`;
    expect(items.map((item) => item.id)).toEqual(stored?.ids);
    expect(items[0]?.id).toBe(newer);
    expect(items[1]?.id).toBe(republished);

    const { categories } = await catalogue();
    expect(categories.map((chip) => chip.name)).toEqual([
      `${CAT} Alfa`,
      `${CAT} beta`,
      `${CAT} Gama`,
    ]);
  });

  it('EP-07 and the category filter (COURSE-17, D-421): two courses published at the same instant page by id desc with limit 1, neither repeated nor skipped; an unknown category is items: []; a malformed one is 400', async () => {
    const delta = await sqlCategory('Delta');
    const instant = minutesBefore(base, 40);
    const tiedA = await sqlCourse('empate-a', { publishedAt: instant, categoryId: delta });
    const tiedB = await sqlCourse('empate-b', { publishedAt: instant, categoryId: delta });
    const older = await sqlCourse('empate-c', {
      publishedAt: minutesBefore(base, 41),
      categoryId: delta,
    });

    const paged = await allCards({ categoryId: delta, limit: '1' });
    expect(paged.map((item) => item.id)).toEqual([...[tiedA, tiedB].sort().reverse(), older]);

    const unknown = await catalogue(`?categoryId=${crypto.randomUUID()}`);
    expect(unknown.items).toEqual([]);
    expect(unknown.nextCursor).toBeNull();
    expect(unknown.categories.length).toBeGreaterThan(0);
    expect((await get('/v1/courses/learn/courses?categoryId=x', tokens.member)).status).toBe(400);
  });

  it('D-426 (COURSE-17): a draft and an archived course are absent for the member, the support and the admin', async () => {
    const draft = await sqlCourse('rascunho-2', { status: 'draft', publishedAt: null });
    const archived = await sqlCourse('arquivado', {
      status: 'archived',
      publishedAt: minutesBefore(base, 5),
    });
    for (const token of [tokens.member, tokens.support, tokens.admin]) {
      const ids = (await allCards({ limit: '50' }, token)).map((item) => item.id);
      expect(ids).not.toContain(draft);
      expect(ids).not.toContain(archived);
      expect(ids).toContain(bulk[0]);
    }
  });

  it('D-420 / D-430 / A-UI-5: a linked course is locked with its FULL counts for the member, open for the staff; a completed free lesson counts on the locked card; after the grant the card opens', async () => {
    const locked = await buildLearnFixture({
      prefix: `${CAT}-lk`,
      adminToken: tokens.admin,
      host: 'demo',
      materials: false,
    });
    const cardOf = async (token = tokens.member) =>
      (await allCards({ limit: '50' }, token)).find((item) => item.id === locked.courseId);

    expect(await cardOf()).toEqual({
      id: locked.courseId,
      title: `${CAT}-lk curso`,
      coverAssetId: null,
      category: null,
      level: null,
      lessonCount: 2,
      durationSeconds: 1200,
      completedCount: 0,
      locked: true,
    });
    expect((await cardOf(tokens.support))?.locked).toBe(false);
    expect((await cardOf(tokens.admin))?.locked).toBe(false);

    await progressOk(await putProgress(locked.freeLessonId, { completed: true }));
    expect(await cardOf()).toMatchObject({ locked: true, completedCount: 1, lessonCount: 2 });
    // The completion is the caller's own: the support's card still reads 0.
    expect((await cardOf(tokens.support))?.completedCount).toBe(0);

    await grantFixtureProduct(locked, tokens.admin, 'demo', DEMO_MEMBER);
    expect(await cardOf()).toMatchObject({ locked: false, completedCount: 1 });
  });

  it('EP-10 (COURSE-17): durationSeconds is the integer sum of the ready videos and lessonCount counts live lessons under live modules — a removed lesson and a lesson under a removed module count for neither', async () => {
    const course = await publishedCourse('cat-ep10', [
      [
        { title: 'a', seconds: 101 },
        { title: 'b' },
        { title: 'c', seconds: 37 },
        { title: 'x', seconds: 500 },
      ],
      [{ title: 'm2', seconds: 70 }],
    ]);
    const cardOf = async () =>
      (await allCards({ limit: '50' })).find((item) => item.id === course.courseId);
    expect(await cardOf()).toMatchObject({ lessonCount: 5, durationSeconds: 708 });

    expect((await admin('DELETE', `/v1/courses/lessons/${course.lessonIds[0]?.[3]}`)).status).toBe(
      204,
    );
    expect((await admin('DELETE', `/v1/courses/modules/${course.moduleIds[1]}`)).status).toBe(204);
    expect(await cardOf()).toMatchObject({
      lessonCount: 3,
      durationSeconds: 138,
      completedCount: 0,
      locked: false,
    });
  });
});

// ── 08.5-04: the member lives (COURSE-23, COURSE-24; D-431..D-434, UI-D-436, UI-D-441) ───────────

/** Every live, product and course of the lives describes starts with it (swept in `afterAll`). */
const LIV = `${PREFIX}-liv`;
const LIVE_CARD_KEYS = [
  'id',
  'title',
  'coverAssetId',
  'startsAt',
  'durationMin',
  'endsAt',
  'status',
  'locked',
  'hasReplay',
].sort();

/** The room link a live carries: distinctive, so a leak is a plain substring search. */
const roomUrl = (label: string) => `https://meet.example.com/${LIV}-${label}`;

/**
 * A live of `slug` written by the admin connection, its start `startsInSeconds` from the DATABASE's
 * `now()` (negative is the past), so every fixture is relative to the instant it was written.
 */
async function sqlLive(
  label: string,
  input: {
    startsInSeconds: number;
    durationMin?: number;
    cancelled?: boolean;
    replayLessonId?: string | null;
    slug?: 'rede-demo' | 'rede-lab';
  },
): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.course_lives
           (tenant_id, created_by_user_id, title, starts_at, duration_min, external_url,
            replay_lesson_id, cancelled_at)
    select m.tenant_id, m.user_id, ${`${LIV} ${label}`},
           now() + make_interval(secs => ${input.startsInSeconds}),
           ${input.durationMin ?? 60}, ${roomUrl(label)}, ${input.replayLessonId ?? null}::uuid,
           case when ${input.cancelled ?? false} then now() end
      from public.memberships m join public.tenants t on t.id = m.tenant_id
     where t.slug = ${input.slug ?? 'rede-demo'} and m.role = 'admin_tenant'
     order by m.joined_at
     fetch first 1 rows only
    returning id::text as id`;
  if (!row) throw new Error(`could not seed the live ${label}`);
  return row.id;
}

/** A product of rede-demo opening `liveIds`, through the admin's product route (D-418). */
async function liveProduct(label: string, liveIds: string[]): Promise<string> {
  return createdId(
    await admin('POST', '/v1/store/products', {
      name: `${LIV} produto ${label}`,
      priceCents: 990,
      liveIds,
    }),
    `${label} product`,
  );
}

async function agenda(query = '', token = tokens.member): Promise<LearnLivesPage> {
  const res = await get(`/v1/courses/learn/lives${query}`, token);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  const raw = await res.text();
  // No room link anywhere in the agenda, and every card carries exactly the card keys (PR-1).
  expect(raw).not.toContain('meet.example.com');
  const page = learnLivesPageSchema.parse(JSON.parse(raw));
  for (const card of [...page.upcoming, ...page.recorded]) {
    expect(Object.keys(card).sort()).toEqual(LIVE_CARD_KEYS);
  }
  return page;
}

async function livePage(
  liveId: string,
  token = tokens.member,
): Promise<{ live: LearnLive; raw: string }> {
  const res = await get(`/v1/courses/learn/lives/${liveId}`, token);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  const raw = await res.text();
  return { live: learnLiveSchema.parse(JSON.parse(raw)), raw };
}

/** `YYYY-MM-DD` in `timeZone`, the test's own reading of `startsToday` (UI-D-436). */
const dayIn = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);

/**
 * The lives fixture, shared by `08.5 lives` and `08.5 live page` (built once, in declaration order):
 *  - `course`: a locked course (product P_c nobody holds) with a free and a paid lesson, each with a
 *    material; `open`: an open course whose second lesson requires the first (sequence-locked for
 *    the member) and has no material;
 *  - the lives, relative to the database clock: `onAir` (started 10 min ago), `locked` (in 5 min,
 *    product P_l1 the member lacks), `in10`, `cancelledAhead` (in 60 min, cancelled, also behind P_l1
 *    — EP-33: cancelled wins over locked), `in2h`, `endedJust` (planned end 1 s before it was
 *    written, replay), `cancelledJust` (cancelled, planned end 1 s before), `recorded` (replay = the
 *    sequence-locked lesson of `open`), `liveDoor` (replay = the PAID lesson of `course`, behind
 *    product P_l2), `courseDoorOnly` (replay = the paid lesson, behind P_l3 the member never gets),
 *    `noReplay` (ended, no replay), `cancelledPast` (cancelled, ended), 21 `bulk` recorded lives and
 *    a rede-lab live.
 */
const lives = {
  course: undefined as unknown as LearnFixture,
  open: undefined as unknown as Awaited<ReturnType<typeof publishedCourse>>,
  ids: {} as Record<string, string>,
  bulk: [] as string[],
  products: {} as Record<string, string>,
  timezone: '',
};
/** Lives of rede-demo that existed before (other files' residue): pushed out of the agenda, then restored. */
let parkedLives: {
  id: string;
  starts_at: string;
  cancelled_at: string | null;
  replay_lesson_id: string | null;
}[] = [];

describe('08.5 lives', () => {
  beforeAll(async () => {
    parkedLives = await adminSql`
      select v.id::text as id, v.starts_at::text as starts_at, v.cancelled_at::text as cancelled_at,
             v.replay_lesson_id::text as replay_lesson_id
        from public.course_lives v join public.tenants t on t.id = v.tenant_id
       where t.slug = 'rede-demo'`;
    if (parkedLives.length > 0) {
      await adminSql`
        update public.course_lives
           set cancelled_at = now() - interval '30 days', starts_at = now() - interval '30 days'
         where id = any (${parkedLives.map((live) => live.id)}::uuid[])`;
    }
    const [tenant] = await adminSql<{ timezone: string }[]>`
      select timezone from public.tenants where slug = 'rede-demo'`;
    lives.timezone = tenant?.timezone ?? '';
  });

  it('EP-29 (COURSE-23): a tenant with no listable live answers { upcoming: [], recorded: [], nextCursor: null }', async () => {
    // An ended live without a replay and a cancelled live after its planned end are not listable.
    await sqlLive('so-encerrada', { startsInSeconds: -3 * 3600 });
    await sqlLive('so-cancelada', { startsInSeconds: -3 * 3600, cancelled: true });
    expect(await agenda()).toEqual({ upcoming: [], recorded: [], nextCursor: null });
  });

  it('D-431, EP-28, EP-30 (COURSE-23): the upcoming group is live, scheduled and cancelled-before-its-end lives, starts asc; recorded lives with a replay page desc by 20 without a repeat; ended-without-replay and cancelled-after-end lives are absent; a locked live is listed locked', async () => {
    lives.course = await buildLearnFixture({
      prefix: `${LIV}-c`,
      adminToken: tokens.admin,
      host: 'demo',
    });
    lives.open = await publishedCourse('liv-open', [
      [
        { title: 'r1', seconds: 100 },
        { title: 'r2', seconds: 100, requiresPrevious: true },
      ],
    ]);
    const r1 = lives.open.lessonIds[0]?.[0] ?? '';
    const r2 = lives.open.lessonIds[0]?.[1] ?? '';
    const paid = lives.course.paidLessonId;
    const ids = lives.ids;
    ids.onAir = await sqlLive('ao-vivo', { startsInSeconds: -10 * 60 });
    ids.locked = await sqlLive('bloqueada', { startsInSeconds: 5 * 60 });
    ids.in10 = await sqlLive('em-10', { startsInSeconds: 10 * 60 });
    // Linked to P_l1 below while still scheduled (the store links non-cancelled lives only, T-08.4-01),
    // then cancelled: EP-33's cancelled-over-locked case.
    ids.cancelledAhead = await sqlLive('cancelada-adiante', { startsInSeconds: 60 * 60 });
    ids.in2h = await sqlLive('em-2h', { startsInSeconds: 2 * 3600 });
    // EP-28 (± 1 s documented): the planned end is 1 s before the row is written, so by the request
    // the live is past its end — `recorded` (half-open, the contract pins the exact instant) and a
    // cancelled one has left the upcoming group.
    ids.endedJust = await sqlLive('acabou-agora', {
      startsInSeconds: -3600 - 1,
      replayLessonId: r1,
    });
    ids.cancelledJust = await sqlLive('cancelada-acabou', {
      startsInSeconds: -3600 - 1,
      cancelled: true,
    });
    ids.recorded = await sqlLive('gravada', { startsInSeconds: -180 * 60, replayLessonId: r2 });
    ids.liveDoor = await sqlLive('porta-live', {
      startsInSeconds: -200 * 60,
      replayLessonId: paid,
    });
    ids.courseDoorOnly = await sqlLive('so-curso', {
      startsInSeconds: -220 * 60,
      replayLessonId: paid,
    });
    ids.noReplay = await sqlLive('sem-replay', { startsInSeconds: -240 * 60 });
    ids.cancelledPast = await sqlLive('cancelada-passada', {
      startsInSeconds: -260 * 60,
      cancelled: true,
    });
    for (let i = 1; i <= 21; i += 1) {
      lives.bulk.push(
        await sqlLive(`lote-${i}`, { startsInSeconds: -(300 + i) * 60, replayLessonId: r1 }),
      );
    }
    ids.lab = await sqlLive('lab', { startsInSeconds: 5 * 60, slug: 'rede-lab' });
    lives.products.l1 = await liveProduct('l1', [ids.locked, ids.cancelledAhead]);
    await adminSql`
      update public.course_lives set cancelled_at = now() where id = ${ids.cancelledAhead}::uuid`;
    lives.products.l2 = await liveProduct('l2', [ids.liveDoor]);
    lives.products.l3 = await liveProduct('l3', [ids.courseDoorOnly]);

    const first = await agenda();
    expect(first.upcoming.map((card) => card.id)).toEqual([
      ids.onAir,
      ids.locked,
      ids.in10,
      ids.cancelledAhead,
      ids.in2h,
    ]);
    expect(first.upcoming.map((card) => card.status)).toEqual([
      'live',
      'scheduled',
      'scheduled',
      'cancelled',
      'scheduled',
    ]);
    expect(first.upcoming.map((card) => card.locked)).toEqual([false, true, false, true, false]);
    const expectedRecorded = [
      ids.endedJust,
      ids.recorded,
      ids.liveDoor,
      ids.courseDoorOnly,
      ...lives.bulk,
    ];
    expect(first.recorded.map((card) => card.id)).toEqual(expectedRecorded.slice(0, 20));
    expect(first.recorded.every((card) => card.status === 'recorded' && card.hasReplay)).toBe(true);
    expect(first.recorded.find((card) => card.id === ids.liveDoor)?.locked).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = await agenda(`?cursor=${encodeURIComponent(first.nextCursor ?? '')}`);
    expect(second.upcoming).toEqual([]);
    expect(second.recorded.map((card) => card.id)).toEqual(expectedRecorded.slice(20));
    expect(second.nextCursor).toBeNull();

    const listed = new Set(
      [...first.upcoming, ...first.recorded, ...second.recorded].map((card) => card.id),
    );
    for (const absent of [ids.cancelledJust, ids.noReplay, ids.cancelledPast, ids.lab]) {
      expect(listed.has(absent)).toBe(false);
    }
    // The card's endsAt is startsAt + durationMin.
    const onAir = first.upcoming[0];
    expect(Date.parse(onAir?.endsAt ?? '') - Date.parse(onAir?.startsAt ?? '')).toBe(60 * 60_000);
    // A tampered cursor is refused (T-08.5-24).
    expect((await get('/v1/courses/learn/lives?cursor=bm9wZQ', tokens.member)).status).toBe(400);
  });

  it('the staff see every live unlocked; the agenda never names a replay lesson', async () => {
    const page = await agenda('', tokens.support);
    expect(page.upcoming.every((card) => card.locked === false)).toBe(true);
    const raw = await (await get('/v1/courses/learn/lives', tokens.member)).text();
    expect(raw).not.toContain(lives.course.paidLessonId);
    expect(raw).not.toContain(lives.open.lessonIds[0]?.[1] ?? 'never');
  });
});

describe('08.5 live page', () => {
  afterAll(async () => {
    const like = `${LIV}%`;
    await adminSql`
      delete from public.store_entitlements e
       using public.store_products p
       where e.product_id = p.id and p.name like ${like}`;
    await adminSql`delete from public.store_products where name like ${like}`;
    await adminSql`delete from public.course_lives where title like ${like}`;
    for (const live of parkedLives) {
      await adminSql`
        update public.course_lives
           set starts_at = ${live.starts_at}::timestamptz,
               cancelled_at = ${live.cancelled_at}::timestamptz,
               replay_lesson_id = ${live.replay_lesson_id}::uuid
         where id = ${live.id}::uuid`;
    }
  });

  it('D-432 (COURSE-24): inside the window the live answers its link — on air and 10 min before the start — with joinOpensAt, endsAt, serverNow and startsToday decided on the server', async () => {
    for (const [key, status] of [
      ['onAir', 'live'],
      ['in10', 'scheduled'],
    ] as const) {
      const { live } = await livePage(lives.ids[key] ?? '');
      expect(live.state).toBe('open');
      expect(live.status).toBe(status);
      expect(live.joinUrl).toBe(roomUrl(key === 'onAir' ? 'ao-vivo' : 'em-10'));
      expect(live.replay).toBeNull();
      expect(Date.parse(live.joinOpensAt)).toBe(Date.parse(live.startsAt) - 15 * 60_000);
      expect(Date.parse(live.endsAt)).toBe(Date.parse(live.startsAt) + 60 * 60_000);
      expect(Math.abs(Date.parse(live.serverNow) - Date.now())).toBeLessThan(10_000);
      expect(live.startsToday).toBe(
        dayIn(new Date(live.startsAt), lives.timezone) ===
          dayIn(new Date(live.serverNow), lives.timezone),
      );
    }
  });

  it('EP-32 / EP-33 (COURSE-24): two hours ahead is before with no link; ended without a replay is ended with replay null; a locked live inside its window is locked with no link and no replay', async () => {
    const before = await livePage(lives.ids.in2h ?? '');
    expect(before.live).toMatchObject({ state: 'before', joinUrl: null, replay: null });
    expect(before.raw).not.toContain('meet.example.com');

    const ended = await livePage(lives.ids.noReplay ?? '');
    expect(ended.live).toMatchObject({
      state: 'ended',
      status: 'recorded',
      joinUrl: null,
      replay: null,
      hasReplay: false,
    });

    const locked = await livePage(lives.ids.locked ?? '');
    expect(locked.live).toMatchObject({
      state: 'locked',
      locked: true,
      joinUrl: null,
      replay: null,
    });
    expect(locked.raw).not.toContain('meet.example.com');
    // The staff open the same live inside its window (no product gate for staff).
    const staff = await livePage(lives.ids.locked ?? '', tokens.support);
    expect(staff.live).toMatchObject({ state: 'open', joinUrl: roomUrl('bloqueada') });
  });

  it('UI-D-441 / EP-33: a cancelled live keeps its page before and after its planned end — cancelled wins over locked — with no link and no replay', async () => {
    for (const key of ['cancelledAhead', 'cancelledJust', 'cancelledPast']) {
      const { live, raw } = await livePage(lives.ids[key] ?? '');
      expect(live).toMatchObject({
        state: 'cancelled',
        status: 'cancelled',
        joinUrl: null,
        replay: null,
      });
      expect(raw).not.toContain('meet.example.com');
    }
  });

  it('D-433 / EP-32 (COURSE-24): a recorded open live plays its replay through the live door — a sequence-locked lesson of an open course, with materials: [] — while the course curriculum still holds that lesson behind its rule', async () => {
    const r2 = lives.open.lessonIds[0]?.[1] ?? '';
    const { live } = await livePage(lives.ids.recorded ?? '');
    expect(live.state).toBe('replay');
    expect(live.joinUrl).toBeNull();
    expect(live.replay).toEqual({
      lessonId: r2,
      videoAssetId: expect.any(String),
      videoStatus: 'ready',
      durationSeconds: 100,
      materials: [],
      progress: { completedAt: null, lastPositionSeconds: 0 },
    });
    // The course's own curriculum (course door only, 08.5-01 decision 5) still holds r2 behind its
    // "Exige concluir a aula anterior" rule: the replay ignored the sequential lock.
    const outline = learnCourseSchema.parse(
      await (await get(`/v1/courses/learn/courses/${lives.open.courseId}`, tokens.member)).json(),
    );
    expect(outline.modules[0]?.lessons[1]?.lockReason).toBe('lesson');
  });

  it('D-433 live door: a member without the replay lesson’s course reads the replay once they hold the live’s product, and a member holding the course but not the live reads the page locked', async () => {
    const paid = lives.course.paidLessonId;
    const lockedFirst = await livePage(lives.ids.liveDoor ?? '');
    expect(lockedFirst.live).toMatchObject({ state: 'locked', replay: null, joinUrl: null });
    expect(lockedFirst.raw).not.toContain(paid);

    await grantMember(lives.products.l2 ?? '');
    const opened = await livePage(lives.ids.liveDoor ?? '');
    expect(opened.live.state).toBe('replay');
    expect(opened.live.locked).toBe(false);
    expect(opened.live.replay?.lessonId).toBe(paid);
    expect(opened.live.replay?.videoAssetId).toBe(lives.course.paidVideoId);
    expect(opened.live.replay?.materials).toHaveLength(1);
    expect(JSON.stringify(opened.live.replay)).not.toContain(
      lives.course.paidMaterialAssetId ?? 'never',
    );

    await grantFixtureProduct(lives.course, tokens.admin, 'demo', DEMO_MEMBER);
    const courseOnly = await livePage(lives.ids.courseDoorOnly ?? '');
    expect(courseOnly.live).toMatchObject({ state: 'locked', locked: true, replay: null });
  });

  it('the own progress on the replay rides the page; an unknown and another tenant’s live are the bare 404; a malformed id is 400', async () => {
    const r1 = lives.open.lessonIds[0]?.[0] ?? '';
    await progressOk(await putProgress(r1, { completed: true }));
    const { live } = await livePage(lives.ids.endedJust ?? '');
    expect(live.state).toBe('replay');
    expect(live.replay?.progress.completedAt).not.toBeNull();

    await expectBare404(await get(`/v1/courses/learn/lives/${crypto.randomUUID()}`, tokens.member));
    await expectBare404(await get(`/v1/courses/learn/lives/${lives.ids.lab}`, tokens.member));
    expect((await get('/v1/courses/learn/lives/x', tokens.member)).status).toBe(400);
  });
});
