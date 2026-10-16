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

async function readyLessonVideo(tenantId: string, label: string, prefix = PREFIX): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
       mime, bytes, duration_seconds, aspect_ratio, filename, ready_at)
    select ${tenantId}::uuid, m.user_id, 'video', 'lesson', 'ready', 'fake',
           ${`fake-${crypto.randomUUID()}`}, ${`fake-playback-${prefix}-${label}`},
           'video/mp4', 1048576, 600, '16:9', ${`${prefix}-${label}.mp4`}, now()
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
  await sweepFile();
  restores.push(await withModuleEnabled('demo', 'courses'));
  await buildTracerCourse();
});

/**
 * Everything this file writes beyond the learn-fixture sweep (tracks, lives, categories — 08.6-03),
 * swept by the `cma86-` prefix in foreign-key order: tracks (links cascade) and lives (opt-ins
 * cascade) first, then the courses and their assets, then the categories they pointed at.
 */
async function sweepFile(): Promise<void> {
  await adminSql`delete from public.course_tracks where title like ${'cma86-%'}`;
  await adminSql`delete from public.course_lives where title like ${'cma86-%'}`;
  await removeLearnFixture('cma86-');
  await adminSql`delete from public.course_categories where name like ${'cma86-%'}`;
}

afterAll(async () => {
  await sweepFile();
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

/**
 * 08.6-03 (D-436, D-438, COURSE-30, COURSE-31): the overview's "Meus cursos" and "Sua trilha" on
 * rede-demo with `store` ON. The tracer's course is swept first, so the school holds exactly this
 * fixture (the seed publishes no course, track, live or category):
 *  - four PUBLISHED courses in catalogue order A, B, C, D (`published_at` pinned an hour apart):
 *    A and B with two lessons, C with one, D with two and linked to a product the member lacks
 *    (locked); a DRAFT course E;
 *  - tracks in admin order (`created_at` pinned): DRAFT-ONLY [E] (newest, never shown), an ARCHIVED
 *    track [A] (never shown), T1 [B, D], then T2 [C, A].
 * The cases run in declaration order and build on each other's progress.
 */
describe('08.6 overview sections', () => {
  const SEC = `${PREFIX}-s`;
  const sec = {
    tenantId: '',
    courses: {} as Record<'A' | 'B' | 'C' | 'D' | 'E', { id: string; lessonIds: string[] }>,
    productId: '',
    tracks: { draftOnly: '', archived: '', t1: '', t2: '' },
  };
  const send = (method: string, path: string, body?: unknown) =>
    learnRequest(method, path, tokens.admin, HOSTS.demo, body);

  async function buildCourse(key: 'A' | 'B' | 'C' | 'D' | 'E', lessons: number): Promise<void> {
    const id = await created(
      await send('POST', '/v1/courses', {
        title: `${SEC} curso ${key}`,
        instructorName: 'Dra. Ana',
      }),
      `course ${key}`,
    );
    const moduleId = await created(
      await send('POST', `/v1/courses/${id}/modules`, { title: `${SEC} módulo ${key}` }),
      `module ${key}`,
    );
    const lessonIds: string[] = [];
    for (let n = 1; n <= lessons; n += 1) {
      const videoAssetId = await readyLessonVideo(sec.tenantId, `${key}-aula-${n}`, SEC);
      lessonIds.push(
        await created(
          await send('POST', `/v1/courses/modules/${moduleId}/lessons`, {
            title: `${SEC} aula ${key}${n}`,
            videoAssetId,
          }),
          `lesson ${key}${n}`,
        ),
      );
    }
    sec.courses[key] = { id, lessonIds };
  }

  async function insertTrack(title: string, status: string, ageHours: number, path: string[]) {
    const [row] = await adminSql<{ id: string }[]>`
      insert into public.course_tracks (tenant_id, title, status, archived_at, created_at)
      values (${sec.tenantId}::uuid, ${`${SEC} ${title}`}, ${status},
              case when ${status} = 'archived' then now() end,
              now() - make_interval(hours => ${ageHours}))
      returning id::text as id`;
    if (!row) throw new Error(`could not insert the ${title} track`);
    for (const [position, courseId] of path.entries()) {
      await adminSql`
        insert into public.course_track_courses (tenant_id, track_id, course_id, position)
        values (${sec.tenantId}::uuid, ${row.id}::uuid, ${courseId}::uuid, ${position})`;
    }
    return row.id;
  }

  const complete = async (lessonId: string | undefined) => {
    const res = await learnRequest(
      'PUT',
      `/v1/courses/learn/lessons/${lessonId}/progress`,
      tokens.member,
      HOSTS.demo,
      { completed: true },
    );
    expect(res.status).toBe(200);
  };

  const kinds = (overview: LearnOverview) =>
    (overview.shelf ?? []).map((item) => [item.courseId, item.kind]);

  beforeAll(async () => {
    // The tracer's course (and the member's completion on it) leaves the school first.
    await sweepFile();
    restores.push(await withModuleEnabled('demo', 'store'));
    const [tenant] = await adminSql<{ id: string }[]>`
      select id::text as id from public.tenants where slug = 'rede-demo'`;
    sec.tenantId = tenant?.id ?? '';

    await buildCourse('A', 2);
    await buildCourse('B', 2);
    await buildCourse('C', 1);
    await buildCourse('D', 2);
    await buildCourse('E', 1);
    sec.productId = await created(
      await send('POST', '/v1/store/products', {
        name: `${SEC} produto`,
        priceCents: 990,
        courseIds: [sec.courses.D.id],
      }),
      'product',
    );
    for (const key of ['A', 'B', 'C', 'D'] as const) {
      const res = await send('PUT', `/v1/courses/${sec.courses[key].id}/status`, {
        status: 'published',
      });
      expect(res.status).toBe(200);
    }
    // Catalogue order A, B, C, D (published_at desc), pinned so it never depends on request timing.
    for (const [hours, key] of [
      [1, 'A'],
      [2, 'B'],
      [3, 'C'],
      [4, 'D'],
    ] as const) {
      await adminSql`
        update public.courses set published_at = now() - make_interval(hours => ${hours})
         where id = ${sec.courses[key].id}::uuid`;
    }

    const { A, B, C, D, E } = sec.courses;
    sec.tracks.draftOnly = await insertTrack('trilha rascunho', 'active', 1, [E.id]);
    sec.tracks.archived = await insertTrack('trilha arquivada', 'archived', 2, [A.id]);
    sec.tracks.t1 = await insertTrack('trilha T1', 'active', 3, [B.id, D.id]);
    sec.tracks.t2 = await insertTrack('trilha T2', 'active', 4, [C.id, A.id]);
  });

  const neverShown = async (overview: LearnOverview) => {
    const raw = JSON.stringify(overview);
    for (const id of [sec.tracks.draftOnly, sec.tracks.archived, sec.courses.E.id]) {
      expect(raw).not.toContain(id);
    }
  };

  it('a fresh member: the hero starts A; the shelf is B (the track’s next), C, then the locked D; the track is T1, suggested', async () => {
    const { A, B, C, D } = sec.courses;
    const overview = await readOverview(tokens.member);
    expect(overview.hero).toMatchObject({ state: 'comecando', courseId: A.id });
    expect(kinds(overview)).toEqual([
      [B.id, 'proximo_da_trilha'],
      [C.id, 'nao_iniciado'],
      [D.id, 'bloqueado'],
    ]);
    expect(overview.shelf?.[2]).toMatchObject({
      title: `${SEC} curso D`,
      percent: 0,
      done: 0,
      total: 2,
      lessonCount: 2,
      durationSeconds: 1200,
    });
    expect(overview.track).toEqual({
      id: sec.tracks.t1,
      title: `${SEC} trilha T1`,
      coverAssetId: null,
      suggested: true,
      percent: 0,
      total: 2,
      coursesDone: 0,
      currentIndex: 1,
      currentCourseTitle: `${SEC} curso B`,
      resumeCourseId: B.id,
      lastLockedCourseTitle: `${SEC} curso D`,
    });
    await neverShown(overview);
  });

  it('after completing a lesson of A then of B: the hero resumes B, the shelf is A in progress, C (T2’s next), D; the track is T2 at 33%', async () => {
    const { A, B, C, D } = sec.courses;
    await complete(A.lessonIds[0]);
    await complete(B.lessonIds[0]);
    const overview = await readOverview(tokens.member);
    expect(overview.hero).toMatchObject({ state: 'retomando', courseId: B.id });
    // T2 [C, A] is now the member's track, and C is its first unstarted course.
    expect(kinds(overview)).toEqual([
      [A.id, 'em_andamento'],
      [C.id, 'proximo_da_trilha'],
      [D.id, 'bloqueado'],
    ]);
    expect(overview.shelf?.[0]).toMatchObject({ percent: 50, done: 1, total: 2 });
    expect(overview.track).toMatchObject({
      id: sec.tracks.t2,
      suggested: false,
      percent: 33,
      total: 2,
      coursesDone: 0,
      currentIndex: 1,
      currentCourseTitle: `${SEC} curso C`,
      resumeCourseId: C.id,
      lastLockedCourseTitle: null,
    });
    await neverShown(overview);
  });

  it('after completing the whole of C: C is concluido, last; the track moves to its second step', async () => {
    const { A, B, C, D } = sec.courses;
    await complete(C.lessonIds[0]);
    const overview = await readOverview(tokens.member);
    expect(overview.hero).toMatchObject({ state: 'retomando', courseId: B.id });
    expect(kinds(overview)).toEqual([
      [A.id, 'em_andamento'],
      [D.id, 'bloqueado'],
      [C.id, 'concluido'],
    ]);
    expect(overview.shelf?.[2]).toMatchObject({ percent: 100, done: 1, total: 1 });
    expect(overview.track).toMatchObject({
      id: sec.tracks.t2,
      percent: 66,
      coursesDone: 1,
      currentIndex: 2,
      currentCourseTitle: `${SEC} curso A`,
      resumeCourseId: A.id,
    });
    await neverShown(overview);
  });

  it('with the product granted, D leaves bloqueado and becomes an unstarted course', async () => {
    const { A, C, D } = sec.courses;
    const [membership] = await adminSql<{ id: string }[]>`
      select m.id::text as id
        from public.memberships m join public.users u on u.id = m.user_id
       where m.tenant_id = ${sec.tenantId}::uuid and u.email = ${DEMO_MEMBER}`;
    const grant = await send('POST', `/v1/store/products/${sec.productId}/grants`, {
      membershipId: membership?.id,
    });
    expect(grant.status).toBe(200);
    const overview = await readOverview(tokens.member);
    expect(kinds(overview)).toEqual([
      [A.id, 'em_andamento'],
      [D.id, 'nao_iniciado'],
      [C.id, 'concluido'],
    ]);
    expect(overview.track).toMatchObject({ id: sec.tracks.t2, lastLockedCourseTitle: null });
    await neverShown(overview);
  });
});
