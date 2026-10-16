import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { resetFakeVideoInternals } from '@rede-social/core/server/media/video/fake';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import type {
  LearnMyProgress,
  LearnOverview,
  LearnTracks,
} from '@rede-social/module-courses/contracts';
import {
  learnMyProgressSchema,
  learnOverviewSchema,
  learnTracksSchema,
  progressResultSchema,
} from '@rede-social/module-courses/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { learnRequest, removeLearnFixture } from './learn-fixture';
import {
  adminSql,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  SEED_PASSWORD,
  signInAs,
  withModuleEnabled,
} from './setup';

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
const DEMO_SUPPORT = 'support@rede-demo.local';

const tokens = { admin: '', member: '', support: '' };
const restores: Array<() => Promise<void>> = [];
const fixture = { courseId: '', lessonIds: [] as string[] };

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

/** The overview as its raw JSON text (for the leak checks) and parsed by the strict contract. */
async function readOverviewText(
  token: string,
  host = HOSTS.demo,
): Promise<{ overview: LearnOverview; raw: string }> {
  const res = await learnRequest('GET', '/v1/courses/learn/overview', token, host);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  const raw = await res.text();
  return { overview: learnOverviewSchema.parse(JSON.parse(raw)), raw };
}

async function readOverview(token: string): Promise<LearnOverview> {
  return (await readOverviewText(token)).overview;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  [tokens.admin, tokens.member, tokens.support] = await Promise.all([
    signInAs(DEMO_ADMIN, SEED_PASSWORD),
    signInAs(DEMO_MEMBER, SEED_PASSWORD),
    signInAs(DEMO_SUPPORT, SEED_PASSWORD),
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
  // 08.6-05: the reminder jobs the opt-in cases armed for lives that no longer exist.
  await adminSql`
    delete from pgboss.job
     where name = 'courses.live_reminder'
       and not exists (select 1 from public.course_lives v where v.id::text = data->>'liveId')`;
  await removeLearnFixture('cma86-');
  await adminSql`delete from public.course_categories where name like ${'cma86-%'}`;
  // The empty-school case's throwaway tenant and its identity.
  await removeIdentitiesByPrefix('cma86');
  await adminSql`delete from public.tenant_modules where tenant_id in (
    select id from public.tenants where slug like ${'cma86-%'})`;
  await adminSql`delete from public.tenant_domains where host like ${'cma86-%'}`;
  await adminSql`delete from public.tenants where slug like ${'cma86-%'}`;
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
  type CourseKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
  const sec = {
    tenantId: '',
    courses: {} as Record<CourseKey, { id: string; lessonIds: string[] }>,
    productId: '',
    tracks: { draftOnly: '', archived: '', t1: '', t2: '' },
  };
  const send = (method: string, path: string, body?: unknown) =>
    learnRequest(method, path, tokens.admin, HOSTS.demo, body);

  async function buildCourse(key: CourseKey, lessons: number): Promise<void> {
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

  // ── The next live (D-444, D-446, COURSE-32; EP-11's pinned boundaries) ──────────────────────

  const lives = { recorded: '', cancelled: '', near: '', far: '', now: '' };
  const ROOM = `https://meet.example.com/${SEC}`;

  async function insertLive(label: string, startsInMin: number, cancelled = false) {
    const [row] = await adminSql<{ id: string }[]>`
      insert into public.course_lives
             (tenant_id, created_by_user_id, title, description, starts_at, duration_min,
              external_url, cancelled_at)
      select m.tenant_id, m.user_id, ${`${SEC} live ${label}`}, ${`${SEC} descrição ${label}`},
             now() + make_interval(mins => ${startsInMin}), 60, ${`${ROOM}-${label}`},
             case when ${cancelled} then now() end
        from public.memberships m
       where m.tenant_id = ${sec.tenantId}::uuid and m.role = 'admin_tenant'
       order by m.joined_at
       fetch first 1 rows only
      returning id::text as id`;
    if (!row) throw new Error(`could not insert the ${label} live`);
    return row.id;
  }

  /** No room link, no description, no replay pointer, in any form, anywhere in the answer. */
  const noLiveLeak = (raw: string) => {
    for (const leak of ['externalUrl', 'external_url', 'joinUrl', ROOM, 'descrição', 'replay']) {
      expect(raw).not.toContain(leak);
    }
  };

  it('EP-11: a cancelled and a recorded live are never the answer; the nearest scheduled live is, with exactly the overview fields', async () => {
    lives.recorded = await insertLive('gravada', -180);
    lives.cancelled = await insertLive('cancelada', 30, true);
    lives.near = await insertLive('amanha', 24 * 60);
    lives.far = await insertLive('depois', 48 * 60);
    // The far live is sold by a product the member lacks: locked for the member.
    await created(
      await send('POST', '/v1/store/products', {
        name: `${SEC} produto live`,
        priceCents: 990,
        liveIds: [lives.far],
      }),
      'live product',
    );
    const { overview, raw } = await readOverviewText(tokens.member);
    expect(overview.live).toEqual({
      id: lives.near,
      title: `${SEC} live amanha`,
      coverAssetId: null,
      startsAt: expect.any(String),
      durationMin: 60,
      status: 'scheduled',
      locked: false,
      reminderOn: false,
    });
    noLiveLeak(raw);
  });

  it('EP-11: reminderOn reflects only the caller’s own opt-in row', async () => {
    const userOf = async (email: string) => {
      const [row] = await adminSql<{ id: string }[]>`
        select id::text as id from public.users where email = ${email}`;
      return row?.id ?? '';
    };
    // Another user's row on the same live does not count for the member.
    await adminSql`
      insert into public.course_live_reminders (tenant_id, user_id, live_id)
      values (${sec.tenantId}::uuid, ${await userOf(DEMO_ADMIN)}::uuid, ${lives.near}::uuid)`;
    expect((await readOverview(tokens.member)).live).toMatchObject({
      id: lives.near,
      reminderOn: false,
    });
    await adminSql`
      insert into public.course_live_reminders (tenant_id, user_id, live_id)
      values (${sec.tenantId}::uuid, ${await userOf(DEMO_MEMBER)}::uuid, ${lives.near}::uuid)`;
    expect((await readOverview(tokens.member)).live).toMatchObject({
      id: lives.near,
      reminderOn: true,
    });
  });

  it('EP-11: a live happening now beats the scheduled ones', async () => {
    lives.now = await insertLive('agora', -10);
    const { overview, raw } = await readOverviewText(tokens.member);
    expect(overview.live).toMatchObject({ id: lives.now, status: 'live', locked: false });
    noLiveLeak(raw);
  });

  it('EP-11: a locked live is still chosen and answers locked: true, with no room link anywhere', async () => {
    await adminSql`update public.course_lives set cancelled_at = now() where id = ${lives.now}::uuid`;
    await adminSql`delete from public.course_lives where id = ${lives.near}::uuid`;
    const { overview, raw } = await readOverviewText(tokens.member);
    expect(overview.live).toMatchObject({
      id: lives.far,
      status: 'scheduled',
      locked: true,
      reminderOn: false,
    });
    noLiveLeak(raw);
  });

  // ── "Novas aulas da semana" (COURSE-33; EP-12, EP-13, EP-14) ────────────────────────────────

  it('EP-13: with every lesson and publication older than a week, newLessons is absent', async () => {
    const ids = (['A', 'B', 'C', 'D', 'E'] as const).map((key) => sec.courses[key].id);
    await adminSql`
      update public.course_lessons set created_at = now() - interval '30 days'
       where course_id = any(${ids}::uuid[])`;
    for (const [days, key] of [
      [40, 'A'],
      [41, 'B'],
      [42, 'C'],
      [43, 'D'],
    ] as const) {
      await adminSql`
        update public.courses set published_at = now() - make_interval(days => ${days})
         where id = ${sec.courses[key].id}::uuid`;
    }
    const overview = await readOverview(tokens.member);
    expect(overview).not.toHaveProperty('newLessons');
  });

  it('EP-12/13/14: open lessons inside the week, newest first; 7 days and 1 second is out; a locked lesson never appears; an old lesson of a course published today does', async () => {
    const { A, B, C } = sec.courses;
    // Inside the week: A1 (6 days 23 hours), C1 (1 day). Just outside: B1 (7 days and 1 second).
    await adminSql`
      update public.course_lessons set created_at = now() - interval '6 days 23 hours'
       where id = ${A.lessonIds[0] ?? ''}::uuid`;
    await adminSql`
      update public.course_lessons set created_at = now() - interval '1 day'
       where id = ${C.lessonIds[0] ?? ''}::uuid`;
    await adminSql`
      update public.course_lessons set created_at = now() - interval '7 days 1 second'
       where id = ${B.lessonIds[0] ?? ''}::uuid`;
    // F: published now and locked (a product the member lacks): its lesson is new but never listed.
    await buildCourse('F', 1);
    const F = sec.courses.F;
    await created(
      await send('POST', '/v1/store/products', {
        name: `${SEC} produto F`,
        priceCents: 990,
        courseIds: [F.id],
      }),
      'product F',
    );
    // G: open, its lesson created 30 days ago, first published NOW (new-date = published_at).
    await buildCourse('G', 1);
    const G = sec.courses.G;
    for (const course of [F, G]) {
      const res = await send('PUT', `/v1/courses/${course.id}/status`, { status: 'published' });
      expect(res.status).toBe(200);
    }
    await adminSql`
      update public.course_lessons set created_at = now() - interval '30 days'
       where course_id = ${G.id}::uuid`;

    const { overview, raw } = await readOverviewText(tokens.member);
    expect(overview.newLessons?.map((item) => item.lessonId)).toEqual([
      G.lessonIds[0],
      C.lessonIds[0],
      A.lessonIds[0],
    ]);
    expect(overview.newLessons?.[1]).toEqual({
      lessonId: C.lessonIds[0],
      courseId: C.id,
      courseTitle: `${SEC} curso C`,
      title: `${SEC} aula C1`,
      durationSeconds: 600,
      coverAssetId: null,
      done: true,
    });
    expect(overview.newLessons?.[0]?.done).toBe(false);
    // D-423: the locked lesson's title and id appear nowhere in the answer.
    expect(raw).not.toContain(`${SEC} aula F1`);
    expect(raw).not.toContain(F.lessonIds[0]);
  });

  // ── "Explore por categoria" (COURSE-34; EP-15..EP-20) ───────────────────────────────────────

  const NUDE = `${SEC} Maquiagem “Nude” ✨`;

  it('EP-15..20: categories with published courses only, counted in SQL, ordered by lower(name) then id, names byte-identical', async () => {
    const { A, B, C, D, E } = sec.courses;
    // H: published then archived, inside the Zeta category (must not count).
    await buildCourse('H', 1);
    const H = sec.courses.H;
    for (const status of ['published', 'archived']) {
      const res = await send('PUT', `/v1/courses/${H.id}/status`, { status });
      expect(res.status).toBe(200);
    }
    const category = async (name: string, courseIds: string[]) => {
      const [row] = await adminSql<{ id: string }[]>`
        insert into public.course_categories (tenant_id, name)
        values (${sec.tenantId}::uuid, ${name})
        returning id::text as id`;
      await adminSql`
        update public.courses set category_id = ${row?.id ?? ''}::uuid
         where id = any(${courseIds}::uuid[])`;
      return row?.id ?? '';
    };
    // Uppercase "Zeta" before lowercase "alfa" byte-wise; lower(name) puts alfa first.
    const zeta = await category(`${SEC} Zeta`, [B.id, H.id]);
    const nude = await category(NUDE, [A.id]);
    const alfa = await category(`${SEC} alfa`, [C.id, D.id]);
    const draftOnly = await category(`${SEC} só rascunho`, [E.id]);

    const { overview, raw } = await readOverviewText(tokens.member);
    expect(overview.categories).toEqual([
      { id: alfa, name: `${SEC} alfa`, count: 2, coverAssetId: null },
      { id: nude, name: NUDE, count: 1, coverAssetId: null },
      { id: zeta, name: `${SEC} Zeta`, count: 1, coverAssetId: null },
    ]);
    expect(raw).not.toContain(draftOnly);
    // EP-18: the name round-trips byte-identical (UTF-8 of the parsed answer equals the stored one).
    const [stored] = await adminSql<{ name: string }[]>`
      select name from public.course_categories where id = ${nude}::uuid`;
    expect(Buffer.from(overview.categories?.[1]?.name ?? '')).toEqual(
      Buffer.from(stored?.name ?? 'never'),
    );
  });

  // ── The empty school (COURSE-34; EP-17) ──────────────────────────────────────────────────────

  it('EP-17: a tenant with no published course and one scheduled live answers only serverNow, streakDays and live', async () => {
    const slug = `${SEC}-vazia`;
    const host = `${slug}.localhost`;
    const [tenant] = await adminSql<{ id: string }[]>`
      insert into public.tenants (slug, display_name, rules_text, rules_version)
      values (${slug}, 'Escola Vazia', 'Regras de teste.', 1)
      returning id::text as id`;
    const tenantId = tenant?.id ?? '';
    await adminSql`
      insert into public.tenant_modules (tenant_id, module_key, enabled)
      values (${tenantId}::uuid, 'courses', true)`;
    await adminSql`
      insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
      values (${tenantId}::uuid, ${host}, true, now())`;
    moduleFlags.invalidate(tenantId);
    const member = await createSharedIdentity({
      prefix: SEC,
      memberships: [{ tenantSlug: slug }],
    });
    const token = await signInAs(member.email, member.password);
    // A category with no course and a scheduled live: only the live may answer.
    await adminSql`
      insert into public.course_categories (tenant_id, name)
      values (${tenantId}::uuid, ${`${SEC} vazia categoria`})`;
    const [emptyLive] = await adminSql<{ id: string }[]>`
      insert into public.course_lives
             (tenant_id, created_by_user_id, title, starts_at, duration_min, external_url)
      values (${tenantId}::uuid, ${member.userId}::uuid, ${`${SEC} live vazia`},
              now() + interval '2 days', 60, ${`${ROOM}-vazia`})
      returning id::text as id`;

    const { overview, raw } = await readOverviewText(token, host);
    expect(Object.keys(overview).sort()).toEqual(['live', 'serverNow', 'streakDays']);
    expect(overview.streakDays).toBe(0);
    expect(overview.live).toMatchObject({ id: emptyLive?.id, status: 'scheduled', locked: false });
    noLiveLeak(raw);
  });
});

// ── 08.6-04: the member's tracks and own progress (D-439, D-442, COURSE-35, COURSE-36, COURSE-38) ─

/** The rede-demo tenant id (the seed's). */
async function demoTenantId(): Promise<string> {
  const [tenant] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-demo'`;
  if (!tenant) throw new Error('tenant rede-demo is not seeded');
  return tenant.id;
}

/**
 * A course of `lessons` lessons built through the admin API (one module), published unless
 * `draft`. `noVideo` lists the 1-based lessons created WITHOUT a video (publishable: the publish
 * gate refuses only a lesson whose video is not ready). Each ready video is 600 seconds.
 */
async function buildMemberCourse(
  prefix: string,
  key: string,
  lessons: number,
  options: { draft?: boolean; noVideo?: number[] } = {},
): Promise<{ id: string; moduleId: string; lessonIds: string[] }> {
  const tenantId = await demoTenantId();
  const send = (method: string, path: string, body?: unknown) =>
    learnRequest(method, path, tokens.admin, HOSTS.demo, body);
  const id = await created(
    await send('POST', '/v1/courses', {
      title: `${prefix} curso ${key}`,
      instructorName: 'Dra. Ana',
    }),
    `course ${key}`,
  );
  const moduleId = await created(
    await send('POST', `/v1/courses/${id}/modules`, { title: `${prefix} módulo ${key}` }),
    `module ${key}`,
  );
  const lessonIds: string[] = [];
  for (let n = 1; n <= lessons; n += 1) {
    const videoAssetId = options.noVideo?.includes(n)
      ? undefined
      : await readyLessonVideo(tenantId, `${key}-aula-${n}`, prefix);
    lessonIds.push(
      await created(
        await send('POST', `/v1/courses/modules/${moduleId}/lessons`, {
          title: `${prefix} aula ${key}${n}`,
          ...(videoAssetId ? { videoAssetId } : {}),
        }),
        `lesson ${key}${n}`,
      ),
    );
  }
  if (!options.draft) {
    const res = await send('PUT', `/v1/courses/${id}/status`, { status: 'published' });
    expect(res.status).toBe(200);
  }
  return { id, moduleId, lessonIds };
}

/** An admin-API product selling `courseIds` (a member lacking it reads the courses locked). */
async function productFor(prefix: string, label: string, courseIds: string[]): Promise<string> {
  return created(
    await learnRequest('POST', '/v1/store/products', tokens.admin, HOSTS.demo, {
      name: `${prefix} produto ${label}`,
      priceCents: 990,
      courseIds,
    }),
    `product ${label}`,
  );
}

/** Grants `productId` to the seed member; answers the entitlement id (for the revoke). */
async function grantDemoMember(productId: string): Promise<string> {
  const tenantId = await demoTenantId();
  const [membership] = await adminSql<{ id: string }[]>`
    select m.id::text as id
      from public.memberships m join public.users u on u.id = m.user_id
     where m.tenant_id = ${tenantId}::uuid and u.email = ${DEMO_MEMBER}`;
  const res = await learnRequest(
    'POST',
    `/v1/store/products/${productId}/grants`,
    tokens.admin,
    HOSTS.demo,
    { membershipId: membership?.id },
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { entitlementId: string }).entitlementId;
}

/** An ACTIVE or ARCHIVED track over `path`, its `created_at` pinned `ageHours` ago. */
async function insertMemberTrack(
  prefix: string,
  title: string,
  status: 'active' | 'archived',
  ageHours: number,
  path: string[],
): Promise<string> {
  const tenantId = await demoTenantId();
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.course_tracks (tenant_id, title, status, archived_at, created_at)
    values (${tenantId}::uuid, ${`${prefix} ${title}`}, ${status},
            case when ${status} = 'archived' then now() end,
            now() - make_interval(hours => ${ageHours}))
    returning id::text as id`;
  if (!row) throw new Error(`could not insert the ${title} track`);
  for (const [position, courseId] of path.entries()) {
    await adminSql`
      insert into public.course_track_courses (tenant_id, track_id, course_id, position)
      values (${tenantId}::uuid, ${row.id}::uuid, ${courseId}::uuid, ${position})`;
  }
  return row.id;
}

/** The member's progress PUT (the shipped 08.5 route). */
async function putMemberProgress(
  token: string,
  lessonId: string | undefined,
  body: { completed?: true; positionSeconds?: number },
): Promise<void> {
  const res = await learnRequest(
    'PUT',
    `/v1/courses/learn/lessons/${lessonId}/progress`,
    token,
    HOSTS.demo,
    body,
  );
  expect(res.status).toBe(200);
}

/** The tracks answer as its raw JSON text and parsed by the strict contract. */
async function readTracksText(
  token: string,
  host = HOSTS.demo,
): Promise<{ tracks: LearnTracks['tracks']; raw: string }> {
  const res = await learnRequest('GET', '/v1/courses/learn/tracks', token, host);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  const raw = await res.text();
  return { tracks: learnTracksSchema.parse(JSON.parse(raw)).tracks, raw };
}

/**
 * 08.6-04 (D-439, COURSE-35; EP-21..EP-25): the member's Trilhas on rede-demo with `store` ON. The
 * earlier describes' rows are swept first, so the school holds exactly this fixture:
 *  - PUBLISHED courses P (2 lessons), Q (1 lesson) and R (2 lessons, sold by a product the member
 *    lacks: locked); a DRAFT course S;
 *  - tracks in admin order (`created_at` pinned): DRAFT-ONLY [S] (newest, never shown), ARCHIVED [P]
 *    (never shown), TA [P, Q], then TB [Q, R] — Q sits in both.
 * The cases run in declaration order and build on each other's progress.
 */
describe('08.6 tracks', () => {
  const TRK = `${PREFIX}-t`;
  const fx = {
    P: { id: '', lessonIds: [] as string[] },
    Q: { id: '', lessonIds: [] as string[] },
    R: { id: '', lessonIds: [] as string[] },
    S: { id: '', lessonIds: [] as string[] },
    productR: '',
    tracks: { draftOnly: '', archived: '', ta: '', tb: '' },
  };

  beforeAll(async () => {
    await sweepFile();
    restores.push(await withModuleEnabled('demo', 'store'));
    fx.P = await buildMemberCourse(TRK, 'P', 2);
    fx.Q = await buildMemberCourse(TRK, 'Q', 1);
    fx.R = await buildMemberCourse(TRK, 'R', 2);
    fx.S = await buildMemberCourse(TRK, 'S', 1, { draft: true });
    fx.productR = await productFor(TRK, 'R', [fx.R.id]);
    fx.tracks.draftOnly = await insertMemberTrack(TRK, 'trilha rascunho', 'active', 1, [fx.S.id]);
    fx.tracks.archived = await insertMemberTrack(TRK, 'trilha arquivada', 'archived', 2, [fx.P.id]);
    fx.tracks.ta = await insertMemberTrack(TRK, 'trilha TA', 'active', 3, [fx.P.id, fx.Q.id]);
    fx.tracks.tb = await insertMemberTrack(TRK, 'trilha TB', 'active', 4, [fx.Q.id, fx.R.id]);
  });

  const neverShown = (raw: string) => {
    for (const id of [fx.tracks.draftOnly, fx.tracks.archived, fx.S.id]) {
      expect(raw).not.toContain(id);
    }
  };
  const states = (track: LearnTracks['tracks'][number] | undefined) =>
    (track?.courses ?? []).map((course) => [course.id, course.state]);

  it('EP-23/24: a fresh member reads TA then TB (admin order), paths in path order, TA suggested, R bloqueada and locked; the draft-only and archived tracks are absent', async () => {
    const { tracks, raw } = await readTracksText(tokens.member);
    expect(tracks.map((track) => [track.id, track.mine, track.suggested])).toEqual([
      [fx.tracks.ta, false, true],
      [fx.tracks.tb, false, false],
    ]);
    expect(tracks[0]).toEqual({
      id: fx.tracks.ta,
      title: `${TRK} trilha TA`,
      coverAssetId: null,
      percent: 0,
      coursesDone: 0,
      total: 2,
      currentIndex: 1,
      lessonCount: 3,
      durationSeconds: 1800,
      resumeCourseId: fx.P.id,
      mine: false,
      suggested: true,
      courses: [
        {
          id: fx.P.id,
          title: `${TRK} curso P`,
          coverAssetId: null,
          state: 'a_seguir',
          locked: false,
          lessonCount: 2,
          durationSeconds: 1200,
          done: 0,
          percent: 0,
        },
        {
          id: fx.Q.id,
          title: `${TRK} curso Q`,
          coverAssetId: null,
          state: 'a_seguir',
          locked: false,
          lessonCount: 1,
          durationSeconds: 600,
          done: 0,
          percent: 0,
        },
      ],
    });
    expect(states(tracks[1])).toEqual([
      [fx.Q.id, 'a_seguir'],
      [fx.R.id, 'bloqueada'],
    ]);
    // D-421: the locked course is listed in full (its numbers too), flagged locked.
    expect(tracks[1]?.courses[1]).toMatchObject({ locked: true, lessonCount: 2, done: 0 });
    neverShown(raw);
  });

  it('EP-22/25: after completing Q both tracks read 33%, Q is concluida with the same numbers in both, and TA (earlier in admin order) is mine', async () => {
    await putMemberProgress(tokens.member, fx.Q.lessonIds[0], { completed: true });
    const { tracks, raw } = await readTracksText(tokens.member);
    expect(tracks.map((track) => [track.id, track.mine, track.suggested, track.percent])).toEqual([
      [fx.tracks.ta, true, false, 33],
      [fx.tracks.tb, false, false, 33],
    ]);
    const [ta, tb] = tracks;
    expect(states(ta)).toEqual([
      [fx.P.id, 'a_seguir'],
      [fx.Q.id, 'concluida'],
    ]);
    expect(ta).toMatchObject({ coursesDone: 1, currentIndex: 1, resumeCourseId: fx.P.id });
    expect(tb).toMatchObject({ coursesDone: 1, currentIndex: 2, resumeCourseId: fx.R.id });
    const qIn = (track: typeof ta) => track?.courses.find((course) => course.id === fx.Q.id);
    expect(qIn(ta)).toEqual(qIn(tb));
    expect(qIn(ta)).toMatchObject({ state: 'concluida', done: 1, percent: 100 });
    // The overview's "Sua trilha" names the same track (D-438).
    expect((await readOverview(tokens.member)).track).toMatchObject({
      id: fx.tracks.ta,
      suggested: false,
    });
    neverShown(raw);
  });

  it('a touched, incomplete course reads em_andamento', async () => {
    await putMemberProgress(tokens.member, fx.P.lessonIds[0], { positionSeconds: 30 });
    const { tracks } = await readTracksText(tokens.member);
    expect(states(tracks[0])).toEqual([
      [fx.P.id, 'em_andamento'],
      [fx.Q.id, 'concluida'],
    ]);
    expect(tracks[0]?.percent).toBe(33);
  });

  it('EP-21: every live lesson of TA complete → 100%, currentIndex equals total, resume at the first course', async () => {
    await putMemberProgress(tokens.member, fx.P.lessonIds[0], { completed: true });
    await putMemberProgress(tokens.member, fx.P.lessonIds[1], { completed: true });
    const { tracks } = await readTracksText(tokens.member);
    expect(tracks[0]).toMatchObject({
      id: fx.tracks.ta,
      percent: 100,
      coursesDone: 2,
      total: 2,
      currentIndex: 2,
      resumeCourseId: fx.P.id,
      mine: true,
    });
    expect(states(tracks[0])).toEqual([
      [fx.P.id, 'concluida'],
      [fx.Q.id, 'concluida'],
    ]);
  });

  it('complete wins over locked: R completed under a grant then revoked reads concluida with locked: true', async () => {
    const entitlementId = await grantDemoMember(fx.productR);
    const granted = await readTracksText(tokens.member);
    expect(granted.tracks[1]?.courses[1]).toMatchObject({ state: 'a_seguir', locked: false });
    for (const lessonId of fx.R.lessonIds) {
      await putMemberProgress(tokens.member, lessonId, { completed: true });
    }
    const revoked = await learnRequest(
      'DELETE',
      `/v1/store/products/${fx.productR}/entitlements/${entitlementId}`,
      tokens.admin,
      HOSTS.demo,
    );
    expect(revoked.status).toBe(200);
    const { tracks } = await readTracksText(tokens.member);
    expect(tracks[1]?.courses[1]).toMatchObject({
      id: fx.R.id,
      state: 'concluida',
      locked: true,
      done: 2,
      percent: 100,
    });
    expect(tracks[1]).toMatchObject({ percent: 100, coursesDone: 2, currentIndex: 2 });
  });

  it('EP-23: a draft course leaves its track at read time; a track left with no published course is absent', async () => {
    const send = (method: string, path: string, body?: unknown) =>
      learnRequest(method, path, tokens.admin, HOSTS.demo, body);
    // Archiving Q drops it from both paths; archiving P too empties TA, which disappears.
    for (const id of [fx.Q.id, fx.P.id]) {
      const res = await send('PUT', `/v1/courses/${id}/status`, { status: 'archived' });
      expect(res.status).toBe(200);
    }
    const { tracks, raw } = await readTracksText(tokens.member);
    expect(tracks.map((track) => track.id)).toEqual([fx.tracks.tb]);
    expect(tracks[0]?.courses.map((course) => course.id)).toEqual([fx.R.id]);
    expect(raw).not.toContain(fx.tracks.ta);
  });

  it('EP-23: a tenant with no track answers { tracks: [] }', async () => {
    const slug = `${TRK}-sem-trilha`;
    const host = `${slug}.localhost`;
    const [tenant] = await adminSql<{ id: string }[]>`
      insert into public.tenants (slug, display_name, rules_text, rules_version)
      values (${slug}, 'Escola Sem Trilha', 'Regras de teste.', 1)
      returning id::text as id`;
    const tenantId = tenant?.id ?? '';
    await adminSql`
      insert into public.tenant_modules (tenant_id, module_key, enabled)
      values (${tenantId}::uuid, 'courses', true)`;
    await adminSql`
      insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
      values (${tenantId}::uuid, ${host}, true, now())`;
    moduleFlags.invalidate(tenantId);
    const member = await createSharedIdentity({ prefix: TRK, memberships: [{ tenantSlug: slug }] });
    const token = await signInAs(member.email, member.password);
    const res = await learnRequest('GET', '/v1/courses/learn/tracks', token, host);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tracks: [] });
  });
});

/** The caller's own progress answer, parsed by the strict contract. */
async function readMyProgress(token: string, host = HOSTS.demo): Promise<LearnMyProgress> {
  const res = await learnRequest('GET', '/v1/courses/learn/progress', token, host);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  return learnMyProgressSchema.parse(await res.json());
}

/**
 * 08.6-04 (D-442, COURSE-36, COURSE-38; EP-26..EP-30, EP-34..EP-36): the member's own numbers on
 * rede-demo with `store` ON. The earlier describes' rows (and the member's completions on them) are
 * swept first, so the school holds exactly:
 *  - K: three lessons, K1 and K2 with 600-second ready videos, K3 WITHOUT a video;
 *  - M: one lesson (600 s);
 *  - N: two lessons, sold by a product the member lacks (locked).
 * Six live lessons in all, locked ones included. The cases build on each other in order.
 */
describe('08.6 my progress', () => {
  const PRG = `${PREFIX}-p`;
  const fx = {
    K: { id: '', moduleId: '', lessonIds: [] as string[] },
    M: { id: '', moduleId: '', lessonIds: [] as string[] },
    N: { id: '', moduleId: '', lessonIds: [] as string[] },
    productN: '',
  };

  beforeAll(async () => {
    await sweepFile();
    restores.push(await withModuleEnabled('demo', 'store'));
    fx.K = await buildMemberCourse(PRG, 'K', 3, { noVideo: [3] });
    fx.M = await buildMemberCourse(PRG, 'M', 1);
    fx.N = await buildMemberCourse(PRG, 'N', 2);
    fx.productN = await productFor(PRG, 'N', [fx.N.id]);
  });

  it('EP-28: with no progress row courses is [] and every counter is 0 while lessonsTotal counts the school’s live lessons (locked included)', async () => {
    expect(await readMyProgress(tokens.member)).toEqual({
      streakDays: 0,
      lessonsDone: 0,
      lessonsTotal: 6,
      percent: 0,
      secondsWatched: 0,
      coursesDone: 0,
      courses: [],
    });
  });

  it('EP-34: completed by the button, at 90% and without a ready video → 3 lessons, 1200 s (the third adds 0), K complete, streak 1', async () => {
    const [k1, k2, k3] = fx.K.lessonIds;
    await putMemberProgress(tokens.member, k1, { completed: true });
    await putMemberProgress(tokens.member, k2, { positionSeconds: 540 });
    await putMemberProgress(tokens.member, k3, { completed: true });
    const progress = await readMyProgress(tokens.member);
    expect(progress).toEqual({
      streakDays: 1,
      lessonsDone: 3,
      lessonsTotal: 6,
      percent: 50,
      secondsWatched: 1200,
      coursesDone: 1,
      courses: [
        {
          id: fx.K.id,
          title: `${PRG} curso K`,
          coverAssetId: null,
          percent: 100,
          done: 3,
          total: 3,
          locked: false,
        },
      ],
    });
  });

  it('EP-26/29: a course with one incomplete progress row is listed at 0%, first, because it was touched last', async () => {
    await putMemberProgress(tokens.member, fx.M.lessonIds[0], { positionSeconds: 30 });
    const progress = await readMyProgress(tokens.member);
    expect(progress.courses.map((course) => [course.id, course.percent, course.done])).toEqual([
      [fx.M.id, 0, 0],
      [fx.K.id, 100, 3],
    ]);
    expect(progress).toMatchObject({ lessonsDone: 3, secondsWatched: 1200, coursesDone: 1 });
  });

  it('EP-36: a repeated completion counts once; a lesson added to the complete course takes it out of coursesDone on the next read', async () => {
    await putMemberProgress(tokens.member, fx.K.lessonIds[0], { completed: true });
    // The repeated write touched K1 again: K is now the course touched last.
    expect(await readMyProgress(tokens.member)).toMatchObject({
      lessonsDone: 3,
      secondsWatched: 1200,
      coursesDone: 1,
    });
    const tenantId = await demoTenantId();
    const videoAssetId = await readyLessonVideo(tenantId, 'K-aula-4', PRG);
    await created(
      await learnRequest(
        'POST',
        `/v1/courses/modules/${fx.K.moduleId}/lessons`,
        tokens.admin,
        HOSTS.demo,
        { title: `${PRG} aula K4`, videoAssetId },
      ),
      'lesson K4',
    );
    const progress = await readMyProgress(tokens.member);
    expect(progress).toMatchObject({
      lessonsDone: 3,
      lessonsTotal: 7,
      percent: 42,
      secondsWatched: 1200,
      coursesDone: 0,
    });
    expect(
      progress.courses.map((course) => [course.id, course.percent, course.done, course.total]),
    ).toEqual([
      [fx.K.id, 75, 3, 4],
      [fx.M.id, 0, 0, 1],
    ]);
  });

  it('R-A3: a locked course never started is absent; started under a grant then revoked, it stays with locked: true', async () => {
    expect((await readMyProgress(tokens.member)).courses.map((course) => course.id)).not.toContain(
      fx.N.id,
    );
    const entitlementId = await grantDemoMember(fx.productN);
    await putMemberProgress(tokens.member, fx.N.lessonIds[0], { completed: true });
    const revoked = await learnRequest(
      'DELETE',
      `/v1/store/products/${fx.productN}/entitlements/${entitlementId}`,
      tokens.admin,
      HOSTS.demo,
    );
    expect(revoked.status).toBe(200);
    const progress = await readMyProgress(tokens.member);
    expect(progress.courses[0]).toEqual({
      id: fx.N.id,
      title: `${PRG} curso N`,
      coverAssetId: null,
      percent: 50,
      done: 1,
      total: 2,
      locked: true,
    });
    expect(progress).toMatchObject({ lessonsDone: 4, lessonsTotal: 7, secondsWatched: 1800 });
  });
});

/**
 * 08.6-04 (COURSE-50, D-422, EP-67): the admin preview and support. The earlier rows are swept;
 * the school holds V (two lessons, sold by a product: locked for the member) and W (one lesson),
 * and one active track [V, W].
 *  - the seed admin (the `?ver=aluno` preview reads the same routes) writes no rows: zeros, an
 *    empty course list, a `comecando` hero, and `locked: false` everywhere;
 *  - the seed support user reads `locked: false` on the product-linked course, and its OWN
 *    completion counts in its numbers and streak — and never in the member's (T-08.6-22).
 */
describe('08.6 preview and support', () => {
  const PRV = `${PREFIX}-v`;
  const fx = {
    V: { id: '', moduleId: '', lessonIds: [] as string[] },
    W: { id: '', moduleId: '', lessonIds: [] as string[] },
    track: '',
  };

  beforeAll(async () => {
    await sweepFile();
    restores.push(await withModuleEnabled('demo', 'store'));
    fx.V = await buildMemberCourse(PRV, 'V', 2);
    fx.W = await buildMemberCourse(PRV, 'W', 1);
    await productFor(PRV, 'V', [fx.V.id]);
    fx.track = await insertMemberTrack(PRV, 'trilha', 'active', 1, [fx.V.id, fx.W.id]);
  });

  it('control: the member reads V locked in the track and bloqueada', async () => {
    const { tracks } = await readTracksText(tokens.member);
    expect(tracks[0]?.courses[0]).toMatchObject({ id: fx.V.id, locked: true, state: 'bloqueada' });
  });

  it('EP-67: the seed admin reads streak 0, a comecando hero, zero numbers, courses [] and locked: false everywhere', async () => {
    const { overview, raw } = await readOverviewText(tokens.admin);
    expect(overview.streakDays).toBe(0);
    expect(overview.hero).toMatchObject({ state: 'comecando', done: 0 });
    expect(raw).not.toContain('"locked":true');

    expect(await readMyProgress(tokens.admin)).toEqual({
      streakDays: 0,
      lessonsDone: 0,
      lessonsTotal: 3,
      percent: 0,
      secondsWatched: 0,
      coursesDone: 0,
      courses: [],
    });

    const { tracks } = await readTracksText(tokens.admin);
    expect(tracks.map((track) => track.id)).toEqual([fx.track]);
    expect(tracks[0]?.courses.map((course) => [course.id, course.locked, course.state])).toEqual([
      [fx.V.id, false, 'a_seguir'],
      [fx.W.id, false, 'a_seguir'],
    ]);
    expect(tracks[0]).toMatchObject({ mine: false, suggested: true });
  });

  it('EP-67: the support user reads V open, and its own completion counts in its numbers and streak, never in the member’s', async () => {
    const before = await readTracksText(tokens.support);
    expect(before.tracks[0]?.courses[0]).toMatchObject({ id: fx.V.id, locked: false });

    await putMemberProgress(tokens.support, fx.V.lessonIds[0], { completed: true });
    expect(await readMyProgress(tokens.support)).toEqual({
      streakDays: 1,
      lessonsDone: 1,
      lessonsTotal: 3,
      percent: 33,
      secondsWatched: 600,
      coursesDone: 0,
      courses: [
        {
          id: fx.V.id,
          title: `${PRV} curso V`,
          coverAssetId: null,
          percent: 50,
          done: 1,
          total: 2,
          locked: false,
        },
      ],
    });
    const after = await readTracksText(tokens.support);
    expect(after.tracks[0]).toMatchObject({ mine: true, percent: 33 });
    expect(after.tracks[0]?.courses[0]).toMatchObject({ state: 'em_andamento', locked: false });

    // T-08.6-22: the member's numbers never include the support user's completion.
    expect(await readMyProgress(tokens.member)).toMatchObject({
      lessonsDone: 0,
      secondsWatched: 0,
      courses: [],
    });
  });
});

// ── 08.6-05: the live reminder opt-in (D-444, D-445, D-446, COURSE-39, COURSE-40) ────────────────

/** One `courses.live_reminder` row as these cases assert it. */
type LiveReminderJobRow = { state: string; singleton_key: string | null; start_after: Date };

/** The `courses.live_reminder` jobs armed for `liveId` (any state). */
async function reminderJobsFor(liveId: string): Promise<LiveReminderJobRow[]> {
  return adminSql<LiveReminderJobRow[]>`
    select state::text as state, singleton_key, start_after
      from pgboss.job_common
     where name = 'courses.live_reminder' and data->>'liveId' = ${liveId}
     order by created_on`;
}

/** How many opt-in rows `liveId` holds, for every user (the migration role reads past RLS). */
async function reminderRows(liveId: string, userId?: string): Promise<number> {
  const [row] = userId
    ? await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.course_live_reminders
         where live_id = ${liveId}::uuid and user_id = ${userId}::uuid`
    : await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.course_live_reminders where live_id = ${liveId}::uuid`;
  return row?.n ?? 0;
}

/** The seed user id behind `email`. */
async function seedUserId(email: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    select id::text as id from public.users where email = ${email}`;
  if (!row) throw new Error(`no seed user ${email}`);
  return row.id;
}

describe('08.6 reminder opt-in', () => {
  const REM = `${PREFIX}-r`;
  const MINUTE = 60_000;
  const lives = { V: '', VC: '', VD: '', V5: '', started: '', cancelled: '', W: '' };
  const starts: Record<string, string> = {};
  let otherMember = '';
  let otherUserId = '';
  let memberUserId = '';

  const reminderPath = (liveId: string) => `/v1/courses/learn/lives/${liveId}/reminder`;
  const call = (method: string, liveId: string, token = tokens.member) =>
    learnRequest(method, reminderPath(liveId), token, HOSTS.demo);

  /** A live built by the admin API on rede-demo, starting `startsInMin` from now. */
  async function adminLive(key: string, startsInMin: number): Promise<string> {
    const startsAt = new Date(Date.now() + startsInMin * MINUTE).toISOString();
    const id = await created(
      await learnRequest('POST', '/v1/courses/lives', tokens.admin, HOSTS.demo, {
        title: `${REM} live ${key}`,
        startsAt,
        durationMin: 60,
        externalUrl: `https://meet.example.com/${REM}-${key}`,
      }),
      `live ${key}`,
    );
    starts[id] = startsAt;
    return id;
  }

  /** Expects `{ on }` with `Cache-Control: no-store`. */
  async function expectOn(res: Response, on: boolean): Promise<void> {
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ on });
  }

  beforeAll(async () => {
    restores.push(await withModuleEnabled('demo', 'store'));
    memberUserId = await seedUserId(DEMO_MEMBER);
    const other = await createSharedIdentity({
      prefix: 'cma86-rem',
      memberships: [{ host: 'demo' }],
    });
    otherUserId = other.userId;
    otherMember = await signInAs(other.email, other.password);
    lives.V = await adminLive('V', 120);
    lives.VC = await adminLive('VC', 180);
    lives.VD = await adminLive('VD', 240);
    lives.V5 = await adminLive('V5', 5);
    lives.started = await adminLive('iniciada', -1);
    lives.cancelled = await adminLive('cancelada', 300);
    await adminSql`
      update public.course_lives set cancelled_at = now() where id = ${lives.cancelled}::uuid`;
    lives.W = await adminLive('W', 360);
    await created(
      await learnRequest('POST', '/v1/store/products', tokens.admin, HOSTS.demo, {
        name: `${REM} produto live W`,
        priceCents: 990,
        liveIds: [lives.W],
      }),
      'live W product',
    );
  });

  it('EP-40: with no row GET answers { on: false } and DELETE answers 200 { on: false }', async () => {
    await expectOn(await call('GET', lives.V), false);
    await expectOn(await call('DELETE', lives.V), false);
    expect(await reminderRows(lives.V)).toBe(0);
  });

  it('EP-41: PUT, DELETE, PUT leaves one row and { on: true }; a GET after each step reads the state just written', async () => {
    await expectOn(await call('PUT', lives.V), true);
    await expectOn(await call('GET', lives.V), true);
    await expectOn(await call('DELETE', lives.V), false);
    await expectOn(await call('GET', lives.V), false);
    await expectOn(await call('PUT', lives.V), true);
    await expectOn(await call('GET', lives.V), true);
    expect(await reminderRows(lives.V, memberUserId)).toBe(1);
  });

  it('D-445: the opt-in armed ONE waiting job keyed {liveId}:{startsAtEpochSeconds}, starting 15 minutes before the live', async () => {
    const startsMs = Date.parse(starts[lives.V] ?? '');
    const jobs = await reminderJobsFor(lives.V);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.state).toBe('created');
    expect(jobs[0]?.singleton_key).toBe(`${lives.V}:${Math.floor(startsMs / 1000)}`);
    expect(new Date(jobs[0]?.start_after ?? 0).getTime()).toBe(startsMs - 15 * MINUTE);
  });

  it('EP-42: PUT twice leaves one row and one waiting job; DELETE twice answers 200 both times', async () => {
    await expectOn(await call('PUT', lives.V), true);
    await expectOn(await call('PUT', lives.V), true);
    expect(await reminderRows(lives.V, memberUserId)).toBe(1);
    expect(await reminderJobsFor(lives.V)).toHaveLength(1);
    await expectOn(await call('DELETE', lives.V), false);
    await expectOn(await call('DELETE', lives.V), false);
    expect(await reminderRows(lives.V, memberUserId)).toBe(0);
  });

  it('EP-38: two concurrent PUTs from one member both answer { on: true } and leave one row and one waiting job', async () => {
    const [a, b] = await Promise.all([call('PUT', lives.VC), call('PUT', lives.VC)]);
    await expectOn(a as Response, true);
    await expectOn(b as Response, true);
    expect(await reminderRows(lives.VC)).toBe(1);
    const jobs = await reminderJobsFor(lives.VC);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.state).toBe('created');
  });

  it('EP-43: two members opting into one live concurrently leave two rows and ONE waiting job', async () => {
    const [a, b] = await Promise.all([call('PUT', lives.VD), call('PUT', lives.VD, otherMember)]);
    await expectOn(a as Response, true);
    await expectOn(b as Response, true);
    expect(await reminderRows(lives.VD)).toBe(2);
    expect(await reminderRows(lives.VD, otherUserId)).toBe(1);
    expect(await reminderJobsFor(lives.VD)).toHaveLength(1);
  });

  it('EP-39: a live starting in 5 minutes accepts the opt-in (row written, no job: its fire instant is past)', async () => {
    await expectOn(await call('PUT', lives.V5), true);
    expect(await reminderRows(lives.V5, memberUserId)).toBe(1);
    expect(await reminderJobsFor(lives.V5)).toEqual([]);
  });

  it('EP-39: a live that started a minute ago answers 409 reminder_closed and writes nothing', async () => {
    const res = await call('PUT', lives.started);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: 'CONFLICT', details: { courses: 'reminder_closed' } },
    });
    expect(await reminderRows(lives.started)).toBe(0);
    expect(await reminderJobsFor(lives.started)).toEqual([]);
  });

  it('D-446: a cancelled live answers 409 reminder_closed on PUT, and DELETE is never refused', async () => {
    const res = await call('PUT', lives.cancelled);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: 'CONFLICT', details: { courses: 'reminder_closed' } },
    });
    expect(await reminderRows(lives.cancelled)).toBe(0);
    await expectOn(await call('DELETE', lives.cancelled), false);
  });

  it('T-08.6-02: the locked live W answers 403 live_locked for a non-buyer and 200 once the member holds its product', async () => {
    const refused = await call('PUT', lives.W);
    expect(refused.status).toBe(403);
    const body = await refused.json();
    expect(body).toMatchObject({
      error: { code: 'FORBIDDEN', details: { courses: 'live_locked' } },
    });
    expect(JSON.stringify(body)).not.toContain('meet.example.com');
    expect(await reminderRows(lives.W)).toBe(0);
    expect(await reminderJobsFor(lives.W)).toEqual([]);

    const [product] = await adminSql<{ id: string }[]>`
      select id::text as id from public.store_products where name = ${`${REM} produto live W`}`;
    await grantDemoMember(product?.id ?? '');
    await expectOn(await call('PUT', lives.W), true);
    expect(await reminderRows(lives.W, memberUserId)).toBe(1);
    expect(await reminderJobsFor(lives.W)).toHaveLength(1);
  });

  it('T-08.6-10: the admin preview PUT and DELETE answer 204 with no body and write nothing; its GET reads { on: false }', async () => {
    const put = await call('PUT', lives.V, tokens.admin);
    expect(put.status).toBe(204);
    expect(await put.text()).toBe('');
    const del = await call('DELETE', lives.V, tokens.admin);
    expect(del.status).toBe(204);
    await expectOn(await call('GET', lives.V, tokens.admin), false);
    expect(await reminderRows(lives.V, await seedUserId(DEMO_ADMIN))).toBe(0);
  });

  it('support writes its own row like a member and reads it back', async () => {
    await expectOn(await call('PUT', lives.V, tokens.support), true);
    await expectOn(await call('GET', lives.V, tokens.support), true);
    expect(await reminderRows(lives.V, await seedUserId(DEMO_SUPPORT))).toBe(1);
    // The member's own answer is still its own (its row was removed in EP-42).
    await expectOn(await call('GET', lives.V), false);
  });

  it('T-08.6-07: an unknown live id is the bare 404 on all three verbs and writes nothing', async () => {
    const unknown = crypto.randomUUID();
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await call(method, unknown);
      expect(res.status, method).toBe(404);
      const body = (await res.json()) as { error: { code: string; details?: unknown } };
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.details).toBeUndefined();
    }
    expect(await reminderRows(unknown)).toBe(0);
  });
});
