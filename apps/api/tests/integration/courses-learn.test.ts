import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { resetFakeVideoInternals } from '@rede-social/core/server/media/video/fake';
import type { LearnCourse, LearnLesson } from '@rede-social/module-courses/contracts';
import { learnCourseSchema, learnLessonSchema } from '@rede-social/module-courses/contracts';
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
