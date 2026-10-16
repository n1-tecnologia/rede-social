import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { resetFakeVideoInternals } from '@rede-social/core/server/media/video/fake';
import type { LearnOverview } from '@rede-social/module-courses/contracts';
import { learnOverviewSchema, progressResultSchema } from '@rede-social/module-courses/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { learnRequest, removeLearnFixture } from './learn-fixture';
import { adminSql, HOSTS, SEED_PASSWORD, signInAs, withModuleEnabled } from './setup';

/**
 * The 08.6 tracer (08.6-01, SC 1, SC 4, COURSE-29, COURSE-37; D-437, D-440, D-441, D-422) against
 * the live local stack and the real seed: on rede-demo (`courses` on) ONE published course with ONE
 * module and THREE lessons with ready videos, linked to no product (so open for every member), that
 * the seed member never watched.
 *
 * What is proved here, through every server layer the phase adds (the custom definer migration's
 * `app.course_member_lessons()` over the 08.5 evaluator and `app.course_member_streak()`, the pure
 * `heroResume`, the overview contract, the member service and `GET /v1/courses/learn/overview`):
 *  - the member's overview answers 200, `Cache-Control: no-store`, `streakDays: 0`, `serverNow` and
 *    `hero.state: 'comecando'` naming the course's first lesson;
 *  - after the member completes lesson 1 through the SHIPPED progress PUT (`completed: true`), the
 *    same read answers `hero.state: 'retomando'` naming lesson 2 and `streakDays: 1` (a completion
 *    today, bucketed in the tenant's timezone, by the database);
 *  - the seed admin's read (the `?ver=aluno` preview reads the same route) answers `streakDays: 0`
 *    and `hero.state: 'comecando'`: the admin writes no rows (D-422).
 *
 * The run assumes a freshly reset and seeded stack (the plan's verify runs `pnpm db:reset && pnpm
 * db:seed` first): the seed member holds no completion anywhere in rede-demo before this file.
 * Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

const PREFIX = `cma86-${Date.now()}`;
const DEMO_ADMIN = 'admin@rede-demo.local';
const DEMO_MEMBER = 'member@rede-demo.local';

const tokens = { admin: '', member: '' };
const restores: Array<() => Promise<void>> = [];
const fixture = { courseId: '', lessonIds: [] as string[] };

const get = (path: string, token: string) => learnRequest('GET', path, token, HOSTS.demo);

async function readyLessonVideo(tenantId: string, label: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
       mime, bytes, duration_seconds, aspect_ratio, filename, ready_at)
    select ${tenantId}::uuid, m.user_id, 'video', 'lesson', 'ready', 'fake',
           ${`fake-${crypto.randomUUID()}`}, ${`fake-playback-${PREFIX}-${label}`},
           'video/mp4', 1048576, 600, '16:9', ${`${PREFIX}-${label}.mp4`}, now()
      from public.memberships m
     where m.tenant_id = ${tenantId}::uuid and m.role = 'admin_tenant'
     order by m.joined_at
     fetch first 1 rows only
    returning id::text as id`;
  if (!row) throw new Error(`could not seed the ${label} lesson video`);
  return row.id;
}

async function created(res: Response, what: string): Promise<string> {
  expect(res.status, `${what} -> ${res.status}`).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** The tracer course, built through the admin API; only the ready videos are written by SQL. */
async function buildTracerCourse(): Promise<void> {
  const [tenant] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-demo'`;
  if (!tenant) throw new Error('tenant rede-demo is not seeded');
  const send = (method: string, path: string, body?: unknown) =>
    learnRequest(method, path, tokens.admin, HOSTS.demo, body);

  fixture.courseId = await created(
    await send('POST', '/v1/courses', {
      title: `${PREFIX} curso`,
      instructorName: 'Dra. Ana',
      tagline: 'Do zero ao primeiro projeto',
    }),
    'course',
  );
  const moduleId = await created(
    await send('POST', `/v1/courses/${fixture.courseId}/modules`, { title: `${PREFIX} módulo` }),
    'module',
  );
  for (const n of [1, 2, 3]) {
    const videoAssetId = await readyLessonVideo(tenant.id, `aula-${n}`);
    fixture.lessonIds.push(
      await created(
        await send('POST', `/v1/courses/modules/${moduleId}/lessons`, {
          title: `${PREFIX} aula ${n}`,
          videoAssetId,
        }),
        `lesson ${n}`,
      ),
    );
  }
  const published = await send('PUT', `/v1/courses/${fixture.courseId}/status`, {
    status: 'published',
  });
  expect(published.status).toBe(200);
}

async function readOverview(token: string): Promise<LearnOverview> {
  const res = await get('/v1/courses/learn/overview', token);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  return learnOverviewSchema.parse(await res.json());
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  [tokens.admin, tokens.member] = await Promise.all([
    signInAs(DEMO_ADMIN, SEED_PASSWORD),
    signInAs(DEMO_MEMBER, SEED_PASSWORD),
  ]);
  await removeLearnFixture('cma86-');
  restores.push(await withModuleEnabled('demo', 'courses'));
  await buildTracerCourse();
});

afterAll(async () => {
  await removeLearnFixture('cma86-');
  for (const restore of restores.reverse()) await restore();
  resetFakeVideoInternals();
  await stopBoss();
  await adminSql.end();
});

describe('08.6 tracer', () => {
  it('a member who never watched the course reads comecando at its first lesson, streak 0, no-store', async () => {
    const overview = await readOverview(tokens.member);
    expect(overview.streakDays).toBe(0);
    expect(Number.isNaN(Date.parse(overview.serverNow))).toBe(false);
    expect(overview.hero).toMatchObject({
      state: 'comecando',
      courseId: fixture.courseId,
      courseTitle: `${PREFIX} curso`,
      courseTagline: 'Do zero ao primeiro projeto',
      lessonId: fixture.lessonIds[0],
      lessonTitle: `${PREFIX} aula 1`,
      lessonDurationSeconds: 600,
      moduleNumber: 1,
      moduleTitle: `${PREFIX} módulo`,
      lessonNumber: 1,
      moduleLessonsLeft: 3,
      isFree: false,
      percent: 0,
      done: 0,
      total: 3,
      lessonCount: 3,
      durationSeconds: 1800,
    });
  });

  it('after completing lesson 1 through the shipped progress PUT the member reads retomando at lesson 2 and streak 1', async () => {
    const write = await learnRequest(
      'PUT',
      `/v1/courses/learn/lessons/${fixture.lessonIds[0]}/progress`,
      tokens.member,
      HOSTS.demo,
      { completed: true },
    );
    expect(write.status).toBe(200);
    expect(progressResultSchema.parse(await write.json()).completedAt).not.toBeNull();

    const overview = await readOverview(tokens.member);
    expect(overview.streakDays).toBe(1);
    expect(overview.hero).toMatchObject({
      state: 'retomando',
      courseId: fixture.courseId,
      lessonId: fixture.lessonIds[1],
      lessonNumber: 2,
      done: 1,
      total: 3,
      percent: 33,
      moduleLessonsLeft: 2,
    });
  });

  it('the seed admin (the ?ver=aluno preview) reads streak 0 and comecando: the admin writes no rows (D-422)', async () => {
    const overview = await readOverview(tokens.admin);
    expect(overview.streakDays).toBe(0);
    expect(overview.hero).toMatchObject({
      state: 'comecando',
      courseId: fixture.courseId,
      lessonId: fixture.lessonIds[0],
      done: 0,
    });
  });
});
