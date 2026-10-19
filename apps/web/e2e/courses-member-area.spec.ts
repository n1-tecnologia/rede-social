import { expect, type Locator, type Page, test } from '@playwright/test';
import { createTranslator } from 'next-intl';
import postgres from 'postgres';
import coursesMessages from '../messages/pt-BR/courses.json' with { type: 'json' };
import memberMessages from '../messages/pt-BR/courses.member.json' with { type: 'json' };
import notificationsMessages from '../messages/pt-BR/notifications.json' with { type: 'json' };
import {
  type CoursesTenant,
  closeCoursesAdmin,
  courseModules,
  createCategory,
  createCourse,
  createCoursesTenant,
  createLesson,
  createLive,
  deleteCoursesTenant,
  linkCourseProduct,
  linkLiveProduct,
  markAssetReady,
  setCourseStatus,
  tenantTimezone,
} from './courses-admin';
import { closeCoursesMember, completeLessonAs, longTitle } from './courses-member';
import { isRemote, login, SEED_PASSWORD } from './fixtures';
import { closeStoreAdmin, createProduct } from './store-admin';

/** The catalog is the source of copy (UI-SPEC Copywriting Contract), never a literal in a spec. */
const C = coursesMessages.courses;
const M = memberMessages.courses.member;
const H = M.home;
/** The ICU plurals (streak, module-left line) go through next-intl, as the page does. */
const tm = createTranslator({
  locale: 'pt-BR',
  messages: memberMessages,
  namespace: 'courses.member',
});

/** ICU `{name}` placeholders filled the way next-intl does for the plain arguments these use. */
function fill(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}

/** The one local write this spec needs beyond the shared fixtures: a module's own title. */
let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 1 },
  );
  return client;
}

async function renameModule(moduleId: string, title: string): Promise<void> {
  await sql()`update public.course_modules set title = ${title} where id = ${moduleId}::uuid`;
}

type SeededCourse = { id: string; title: string; moduleTitle: string; lessons: string[] };

/**
 * A course on `tenant` with ONE module (renamed to `moduleTitle`) and one ready-video lesson per
 * entry of `lessons` (title, seconds), created as a draft so a case can publish it when it wants.
 */
async function seedCourse(
  tenant: CoursesTenant,
  fields: {
    title: string;
    moduleTitle: string;
    lessons: { title: string; seconds: number }[];
    status: 'draft' | 'published';
  },
): Promise<SeededCourse> {
  const id = await createCourse({
    tenantSlug: tenant.slug,
    title: fields.title,
    status: 'draft',
    modules: 1,
    lessonsPerModule: 0,
  });
  const [module] = await courseModules(id);
  if (!module) throw new Error(`no module on "${fields.title}"`);
  await renameModule(module.id, fields.moduleTitle);
  const lessons: string[] = [];
  for (const lesson of fields.lessons) {
    const created = await createLesson({
      tenantSlug: tenant.slug,
      courseId: id,
      moduleId: module.id,
      title: lesson.title,
      withUnreadyVideo: true,
    });
    if (created.videoAssetId) {
      await markAssetReady(created.videoAssetId, { durationSeconds: lesson.seconds });
    }
    lessons.push(created.id);
  }
  if (fields.status === 'published') await setCourseStatus(id, 'published');
  return { id, title: fields.title, moduleTitle: fields.moduleTitle, lessons };
}

const home = (page: Page): Locator =>
  page.getByTestId('courses-member-catalogue').getByTestId('courses-member-home');
const streak = (page: Page): Locator => page.getByTestId('courses-member-streak');
const hero = (page: Page): Locator => page.getByTestId('courses-home-hero');
const areaTab = (page: Page, name: string): Locator =>
  page.getByRole('tablist', { name: C.hub.tabs.label }).getByRole('tab', { name, exact: true });

/** Início is the open body: the home testid inside the frame, the catalogue body absent. */
async function expectInicio(page: Page): Promise<void> {
  await expect(home(page)).toBeVisible();
  await expect(page.getByTestId('courses-member-courses')).toHaveCount(0);
  await expect(page.getByTestId('courses-member-lives')).toHaveCount(0);
  await expect(page.getByTestId('courses-member-tracks')).toHaveCount(0);
  await expect(page.getByTestId('courses-member-progress')).toHaveCount(0);
  await expect(areaTab(page, C.hub.tabs.home)).toHaveAttribute('aria-selected', 'true');
}

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('the element has no box');
  return box;
}

/**
 * 08.6-08 — Início, the member area's front door (D-435, D-437, D-440, D-443, UI-D-446..UI-D-449,
 * COURSE-28, COURSE-29, COURSE-34, COURSE-37), on the phone and on the desktop.
 *
 * A throwaway tenant per project (`e2e-ma-<project>`, the courses-admin shape): one member, one
 * admin and one course seeded as a draft, so the first case reads the empty school and the next
 * publishes the course. The cases run in order: the second one completes lesson 1 for the member.
 * The 320px long-text backstop runs on its own throwaway tenant (`e2e-mb-<project>`) so its course
 * never becomes the main tenant's hero.
 *
 * `serviceWorkers: 'block'`: a worker answering navigations from its cache would have these
 * assertions read what a previous run left behind (the 03-05 lesson).
 */
test.use({ serviceWorkers: 'block' });
test.describe.configure({ timeout: 120_000 });

test.describe('member area: Início', () => {
  test.skip(isRemote, 'the member-area fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  let tenant: CoursesTenant;
  let longTenant: CoursesTenant | null = null;
  let course: SeededCourse;

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    // One slug per project (idempotent): the parallel projects never read each other's school.
    tenant = await createCoursesTenant(`e2e-ma-${testInfo.project.name}`, SEED_PASSWORD);
    const prefix = `e2e-ma-${run}`;
    course = await seedCourse(tenant, {
      title: `${prefix} Olhar do zero`,
      moduleTitle: 'Técnica',
      status: 'draft',
      lessons: [
        { title: `${prefix} Anatomia do terço superior`, seconds: 552 },
        { title: `${prefix} Pontos de aplicação`, seconds: 754 },
        { title: `${prefix} Protocolo de segurança`, seconds: 490 },
      ],
    });
  });

  test.afterAll(async () => {
    if (tenant) await deleteCoursesTenant(tenant.slug);
    if (longTenant) await deleteCoursesTenant(longTenant.slug);
    await client?.end();
    client = null;
    await closeCoursesMember();
    await closeCoursesAdmin();
  });

  test('COURSE-34 / UI-D-447: with no published course, Início shows the greeting, "Sem sequência" and the empty card — no hero', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros`);

    await expectInicio(page);
    await expect(home(page).getByRole('heading', { level: 2, name: H.greeting })).toBeVisible();
    await expect(streak(page)).toHaveText(H.streak.none);
    await expect(streak(page)).toHaveAttribute('aria-label', H.streak.ariaNone);
    await expect(streak(page)).toHaveAttribute('data-active', 'false');

    const empty = page.getByTestId('courses-member-home-empty');
    await expect(empty.getByRole('heading', { name: M.catalogue.empty.title })).toBeVisible();
    await expect(
      empty.getByText(fill(M.catalogue.empty.body, { tenant: tenant.displayName })),
    ).toBeVisible();
    await expect(hero(page)).toHaveCount(0);

    await setCourseStatus(course.id, 'published');
  });

  test('D-435 / D-437 / D-440: the member lands on Início, starts the course from the hero, completes lesson 1 and comes back to "Continue de onde parou" with "1 dia"', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros`);

    // The member registry (08.6-10): Início · Cursos · Trilhas · Lives · Progresso, Início first
    // and selected at bare /area-membros.
    await expectInicio(page);
    const tabs = page.getByRole('tablist', { name: C.hub.tabs.label }).getByRole('tab');
    await expect(tabs).toHaveText([
      C.hub.tabs.home,
      C.hub.tabs.courses,
      C.hub.tabs.tracks,
      C.hub.tabs.lives,
      C.hub.tabs.progress,
    ]);
    await expect(areaTab(page, C.hub.tabs.home)).toHaveAttribute('href', '/area-membros');
    await expect(areaTab(page, C.hub.tabs.courses)).toHaveAttribute(
      'href',
      '/area-membros?aba=cursos',
    );

    await expect(streak(page)).toHaveText(H.streak.none);
    await expect(page.getByTestId('courses-member-home-empty')).toHaveCount(0);

    // "Comece por aqui": the first lesson, the 0% line, "Assistir à primeira aula".
    await expect(hero(page).getByRole('heading', { name: H.hero.title.start })).toBeVisible();
    await expect(page.getByTestId('courses-home-hero-eyebrow')).toHaveText(
      fill(H.hero.eyebrow, { course: course.title, moduleNn: '01', lessonNn: '01' }),
    );
    await expect(page.getByTestId('courses-home-hero-title')).toHaveText(
      `e2e-ma-${run} Anatomia do terço superior`,
    );
    // Scoped to the hero: the new-lessons rail (08.6-09) draws its own duration chips below it.
    await expect(hero(page).getByTestId('member-lesson-thumb-duration')).toHaveText('9:12');
    await expect(hero(page).getByRole('progressbar')).toHaveCount(0);
    const start = page.getByTestId('courses-home-hero-cta');
    await expect(start).toHaveText(H.hero.cta.start);
    await expect(start).toHaveAttribute('href', `/cursos/${course.id}/aulas/${course.lessons[0]}`);
    // Only the CTA is a link inside the hero card.
    await expect(hero(page).getByRole('link')).toHaveCount(1);

    await start.click();
    await expect(page.getByTestId('member-lesson-page')).toHaveAttribute(
      'data-lesson-id',
      course.lessons[0] ?? '',
    );
    await page.getByRole('button', { name: M.player.complete, exact: true }).click();
    await expect(page.getByTestId('lesson-done')).toHaveText(M.player.done);

    await page.goto(`${tenant.origin}/area-membros`);
    await expectInicio(page);
    await expect(hero(page).getByRole('heading', { name: H.hero.title.resume })).toBeVisible();
    await expect(page.getByTestId('courses-home-hero-sub')).toHaveText(
      tm('home.hero.moduleLeft', { n: 2, module: course.moduleTitle }),
    );
    await expect(
      hero(page).getByRole('progressbar', { name: fill(M.progress.aria, { percent: '33' }) }),
    ).toBeVisible();
    await expect(page.getByTestId('courses-home-hero-progress')).toHaveText(
      fill(H.hero.progress, { percent: '33', done: '1', total: '3' }),
    );
    const resume = page.getByTestId('courses-home-hero-cta');
    await expect(resume).toHaveText(H.hero.cta.resume);
    await expect(resume).toHaveAttribute('href', `/cursos/${course.id}/aulas/${course.lessons[1]}`);

    // D-440: the server's streak, one local day.
    await expect(streak(page)).toHaveText(tm('home.streak.days', { n: 1 }));
    await expect(streak(page)).toHaveAttribute('aria-label', tm('home.streak.aria', { n: 1 }));
    await expect(streak(page)).toHaveAttribute('data-active', 'true');
  });

  test('EP-01 / EP-02 (COURSE-28): an empty, unknown or repeated ?aba= renders Início; ?aba=cursos renders the catalogue and ?aba=trilhas the Trilhas body', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    for (const path of [
      '/area-membros?aba=',
      '/area-membros?aba=xyz',
      '/area-membros?aba=lives&aba=cursos',
      '/area-membros?aba=trilhas&aba=progresso',
    ]) {
      await page.goto(`${tenant.origin}${path}`);
      await expectInicio(page);
    }

    await page.goto(`${tenant.origin}/area-membros?aba=cursos`);
    await expect(page.getByTestId('courses-member-courses')).toBeVisible();
    await expect(home(page)).toHaveCount(0);
    await expect(areaTab(page, C.hub.tabs.courses)).toHaveAttribute('aria-selected', 'true');

    await page.goto(`${tenant.origin}/area-membros?aba=lives`);
    await expect(page.getByTestId('courses-member-lives')).toBeVisible();
    await expect(home(page)).toHaveCount(0);

    // 08.6-10: Trilhas is registered; this school has no track, so its body is the empty card.
    await page.goto(`${tenant.origin}/area-membros?aba=trilhas`);
    await expect(page.getByTestId('courses-member-tracks')).toBeVisible();
    await expect(home(page)).toHaveCount(0);
    await expect(
      page
        .getByTestId('courses-member-tracks-empty')
        .getByRole('heading', { name: M.tracks.empty.title }),
    ).toBeVisible();
    await expect(
      page.getByText(fill(M.tracks.empty.body, { tenant: tenant.displayName })),
    ).toBeVisible();
    await expect(areaTab(page, C.hub.tabs.tracks)).toHaveAttribute('aria-selected', 'true');
  });

  test('D-422 / UI-D-437: the admin’s ?ver=aluno lands on Início with "Sem sequência"; ?aba=cursos&ver=aluno is the catalogue with preview links', async ({
    page,
  }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos`);
    await expect(page.getByTestId('courses-hub')).toBeVisible();

    await page.goto(`${tenant.origin}/area-membros?ver=aluno`);
    await expectInicio(page);
    await expect(page.getByTestId('courses-hub')).toHaveCount(0);
    await expect(streak(page)).toHaveText(H.streak.none);
    await expect(areaTab(page, C.hub.tabs.home)).toHaveAttribute('href', '/area-membros?ver=aluno');
    await expect(areaTab(page, C.hub.tabs.courses)).toHaveAttribute(
      'href',
      '/area-membros?aba=cursos&ver=aluno',
    );
    // The preview writes no progress (D-422): the admin starts at the first lesson, flag kept.
    await expect(page.getByTestId('courses-home-hero-cta')).toHaveAttribute(
      'href',
      `/cursos/${course.id}/aulas/${course.lessons[0]}?ver=aluno`,
    );

    await page.goto(`${tenant.origin}/area-membros?aba=cursos&ver=aluno`);
    await expect(page.getByTestId('courses-member-courses')).toBeVisible();
    await expect(home(page)).toHaveCount(0);
    // The course card keeps the preview flag (UI-D-437).
    await expect(
      page.getByTestId('courses-member-grid').locator(`a[href="/cursos/${course.id}?ver=aluno"]`),
    ).toHaveCount(1);
  });

  test('E03 long-text backstop: at 320px a 120-character course and lesson title and a 60-character module name keep the hero CTA whole and on screen', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    longTenant = await createCoursesTenant(`e2e-mb-${testInfo.project.name}`, SEED_PASSWORD);
    const prefix = `e2e-mb-${run}`;
    const courseTitle = longTitle(`${prefix} Curso`, 120);
    const lessonTitle = longTitle(`${prefix} Aula`, 120);
    const moduleTitle = longTitle('Módulo', 60);
    expect([courseTitle.length, lessonTitle.length, moduleTitle.length]).toEqual([120, 120, 60]);
    const long = await seedCourse(longTenant, {
      title: courseTitle,
      moduleTitle,
      status: 'published',
      lessons: [
        { title: lessonTitle, seconds: 754 },
        { title: `${prefix} Segunda aula`, seconds: 490 },
      ],
    });
    // A started course: the hero says "Continue de onde parou" with the module-left line.
    const first = long.lessons[0] ?? '';
    await sql()`
      insert into public.course_lesson_progress
        (tenant_id, user_id, lesson_id, completed_at, last_position_seconds, updated_at)
      select l.tenant_id, u.id, l.id, null, 30, now()
        from public.course_lessons l, public.users u
       where l.id = ${first}::uuid and u.email = ${longTenant.memberEmail}`;

    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, longTenant.memberEmail, longTenant.password, longTenant.origin);
    await page.goto(`${longTenant.origin}/area-membros`);
    await expectInicio(page);
    await expect(hero(page).getByRole('heading', { name: H.hero.title.resume })).toBeVisible();

    // The eyebrow truncates on one line; the title clamps to two; the sub-line wraps.
    const eyebrow = page.getByTestId('courses-home-hero-eyebrow');
    expect(await eyebrow.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    const title = page.getByTestId('courses-home-hero-title');
    await expect(title).toHaveText(lessonTitle);
    expect(
      await title.evaluate((node) => {
        const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
        return Math.round(node.getBoundingClientRect().height / lineHeight);
      }),
    ).toBe(2);
    await expect(page.getByTestId('courses-home-hero-sub')).toHaveText(
      tm('home.hero.moduleLeft', { n: 2, module: moduleTitle }),
    );

    // The badge stays beside the greeting (E02 overflow).
    const greeting = home(page).getByRole('heading', { level: 2, name: H.greeting });
    const greetingBox = await boxOf(greeting);
    const badgeBox = await boxOf(streak(page));
    expect(Math.abs(badgeBox.y - greetingBox.y)).toBeLessThan(greetingBox.height);

    // The CTA: whole, inside the viewport, its label on one line.
    const cta = page.getByTestId('courses-home-hero-cta');
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toHaveText(H.hero.cta.resume);
    const ctaBox = await boxOf(cta);
    expect(ctaBox.x).toBeGreaterThanOrEqual(0);
    expect(ctaBox.x + ctaBox.width).toBeLessThanOrEqual(320);
    expect(ctaBox.height).toBeGreaterThanOrEqual(44);
    expect(await cta.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});

/** The course's live lessons, title and id, in curriculum order (the fixture's own read). */
async function lessonsOf(courseId: string): Promise<{ id: string; title: string }[]> {
  return sql()<{ id: string; title: string }[]>`
    select l.id::text as id, l.title
      from public.course_lessons l
      join public.course_modules m on m.id = l.module_id
     where l.course_id = ${courseId}::uuid and l.deleted_at is null and m.deleted_at is null
     order by m.position asc, l.position asc`;
}

/** The section testids of Início in DOM order (UI-D-447: a section with no data is absent). */
async function sectionOrder(page: Page): Promise<string[]> {
  return home(page).evaluate((root) =>
    Array.from(root.querySelectorAll(':scope > section[data-testid]')).map(
      (node) => node.getAttribute('data-testid') ?? '',
    ),
  );
}

/**
 * 08.6-09 — the rest of Início (D-436, D-438, UI-D-450, UI-D-451, UI-D-454, UI-D-455, COURSE-30,
 * COURSE-31, COURSE-33, COURSE-34), on the phone and on the desktop.
 *
 * Its own throwaway tenant per project (`e2e-mh-<project>`, store on), every row written in
 * `beforeAll`. Catalogue order is newest first, so the minutes back-date the four published courses:
 *
 *  - `paid` (1 min, no category) — linked to an active product the member lacks: LOCKED, no free
 *    lesson, so none of its lessons may ever reach "Novas aulas da semana" (T-08.6-13);
 *  - `first` (2 min) and `second` (3 min), both in the short category, 2 lessons each, no video;
 *  - `third` (4 min), 1 lesson, in the 40-character category (the E09 long-text backstop);
 *  - one active track `first → second → paid`.
 *
 * A fresh member: the hero is `first` (comecando), so the shelf is `second`, `third` (não
 * iniciado, "2 aulas" / "1 aula": no ready video, no duration) and `paid` (Exclusivo); the track is
 * "Sugerido" with the dashed hook on `paid`; the rail holds the four newest open lessons (`first`'s
 * and `second`'s, never `third`'s fifth one nor a `paid` one). After lessons of `first` and then
 * `second` are completed, `second` is the hero and `first` opens the shelf "em andamento".
 */
test.describe('member area: Início sections', () => {
  test.skip(isRemote, 'the member-area fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  const prefix = `e2e-mh-${run}`;
  let tenant: CoursesTenant;
  const ids = { paid: '', first: '', second: '', third: '', short: '', long: '' };
  const titles = {
    paid: `${prefix} Lábios: técnica e segurança`,
    first: `${prefix} Olhar do zero`,
    second: `${prefix} Pele: protocolo`,
    third: `${prefix} Gestão de consultório`,
    track: `${prefix} Do zero à prática`,
    short: `${prefix} Harmonização`,
    long: longTitle(`${prefix} Categoria`, 40),
  };
  const lessons: Record<'paid' | 'first' | 'second' | 'third', { id: string; title: string }[]> = {
    paid: [],
    first: [],
    second: [],
    third: [],
  };

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    tenant = await createCoursesTenant(`e2e-mh-${testInfo.project.name}`, SEED_PASSWORD, ['store']);
    expect(titles.long.length).toBe(40);
    ids.short = await createCategory({ tenantSlug: tenant.slug, name: titles.short });
    ids.long = await createCategory({ tenantSlug: tenant.slug, name: titles.long });

    const course = async (
      key: 'paid' | 'first' | 'second' | 'third',
      minutesAgo: number,
      lessonsPerModule: number,
      categoryId: string | null,
    ) => {
      ids[key] = await createCourse({
        tenantSlug: tenant.slug,
        title: titles[key],
        status: 'published',
        modules: 1,
        lessonsPerModule,
        minutesAgo,
      });
      if (categoryId) {
        await sql()`update public.courses set category_id = ${categoryId}::uuid
                     where id = ${ids[key]}::uuid`;
      }
      lessons[key] = await lessonsOf(ids[key]);
    };
    await course('paid', 1, 2, null);
    await course('first', 2, 2, ids.short);
    await course('second', 3, 2, ids.short);
    await course('third', 4, 1, ids.long);

    const productId = await createProduct({
      tenantSlug: tenant.slug,
      name: `${prefix} Produto`,
      priceCents: 4900,
    });
    await linkCourseProduct(ids.paid, productId);

    const [track] = await sql()<{ id: string }[]>`
      insert into public.course_tracks (tenant_id, title)
      values (${tenant.tenantId}::uuid, ${titles.track})
      returning id::text as id`;
    if (!track) throw new Error('could not create the track');
    let position = 0;
    for (const courseId of [ids.first, ids.second, ids.paid]) {
      position += 1;
      await sql()`
        insert into public.course_track_courses (tenant_id, track_id, course_id, position)
        values (${tenant.tenantId}::uuid, ${track.id}::uuid, ${courseId}::uuid, ${position})`;
    }
  });

  test.afterAll(async () => {
    if (tenant) await deleteCoursesTenant(tenant.slug);
    await client?.end();
    client = null;
    await closeCoursesMember();
    await closeStoreAdmin();
    await closeCoursesAdmin();
  });

  test('D-436 / D-438 / COURSE-33 / COURSE-34: a fresh member sees the shelf cascade with the padlocked shop window, the suggested track and its locked hook, four new lessons and the categories', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros`);
    await expectInicio(page);
    await expect(hero(page).getByRole('heading', { name: H.hero.title.start })).toBeVisible();
    await expect(page.getByTestId('courses-home-hero-cta')).toHaveAttribute(
      'href',
      `/cursos/${ids.first}/aulas/${lessons.first[0]?.id}`,
    );
    // UI-D-447: the order, top to bottom (no live in this school, plan 11's slots stay empty).
    expect(await sectionOrder(page)).toEqual([
      'courses-home-hero',
      'courses-home-shelf',
      'courses-home-track',
      'courses-home-new-lessons',
      'courses-home-categories',
    ]);

    // "Meus cursos": the server's cascade, never the hero's course, a legend in words per kind.
    const shelf = page.getByTestId('courses-home-shelf');
    await expect(shelf.getByRole('heading', { name: H.sections.shelf })).toBeVisible();
    const rows = shelf.getByTestId('courses-home-shelf-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute('href', `/cursos/${ids.second}`);
    await expect(rows.nth(0)).toHaveAttribute('data-kind', 'nao_iniciado');
    await expect(rows.nth(0).getByTestId('courses-home-shelf-legend')).toHaveText(
      tm('home.shelf.notStarted', { N: 2, hasDuration: 'false', duration: '' }),
    );
    await expect(rows.nth(0)).toHaveAttribute(
      'aria-label',
      fill(H.shelf.aria, { course: titles.second, state: H.shelf.stateNotStarted }),
    );
    await expect(rows.nth(1)).toHaveAttribute('href', `/cursos/${ids.third}`);
    await expect(rows.nth(1).getByTestId('courses-home-shelf-legend')).toHaveText(
      tm('home.shelf.notStarted', { N: 1, hasDuration: 'false', duration: '' }),
    );
    // The shop window: the padlock and "Exclusivo", the cover in colour, the course page one tap away.
    await expect(rows.nth(2)).toHaveAttribute('href', `/cursos/${ids.paid}`);
    await expect(rows.nth(2)).toHaveAttribute('data-kind', 'bloqueado');
    await expect(rows.nth(2).getByTestId('courses-home-shelf-legend')).toHaveText(
      tm('home.shelf.locked', { N: 2 }),
    );
    await expect(rows.nth(2)).toHaveAttribute(
      'aria-label',
      fill(H.shelf.aria, { course: titles.paid, state: H.shelf.stateLocked }),
    );
    await expect(shelf.locator(`a[href="/cursos/${ids.first}"]`)).toHaveCount(0);
    // PR-5 / D-421: no "Premium" anywhere, no desaturated cover.
    await expect(page.getByText(/premium/i)).toHaveCount(0);
    await expect(home(page).locator('[class*="grayscale"]')).toHaveCount(0);

    // "Sua trilha": suggested, the first step, the dashed static hook on the locked last step.
    const track = page.getByTestId('courses-home-track');
    await expect(track.getByRole('heading', { name: H.sections.track })).toBeVisible();
    await expect(track).toHaveAttribute('data-state', 'suggested');
    await expect(page.getByTestId('courses-home-track-suggested')).toHaveText(H.track.suggested);
    await expect(page.getByTestId('courses-home-track-card')).toHaveAttribute(
      'href',
      `/cursos/${ids.first}`,
    );
    await expect(page.getByTestId('courses-home-track-eyebrow')).toHaveText(
      fill(H.track.step, { n: '1', total: '3' }),
    );
    await expect(page.getByTestId('courses-home-track-name')).toHaveText(titles.track);
    await expect(track.getByRole('progressbar')).toHaveCount(0);
    await expect(page.getByTestId('courses-home-track-line')).toHaveText(
      tm('home.track.suggestedLine', { total: 3, course: titles.first }),
    );
    const hook = page.getByTestId('courses-home-track-locked');
    await expect(hook).toHaveText(
      fill(H.track.lastLocked.replace(/<\/?b>/g, ''), { course: titles.paid }),
    );
    await expect(hook.getByRole('link')).toHaveCount(0);
    await expect(track.getByRole('link', { name: H.seeAllTracks, exact: true })).toHaveAttribute(
      'href',
      '/area-membros?aba=trilhas',
    );

    // "Novas aulas da semana": the four newest open lessons, never a locked lesson's title.
    const rail = page.getByRole('list', { name: H.sections.newLessons });
    const items = rail.getByTestId('courses-home-new-lesson');
    await expect(items).toHaveCount(4);
    // Newest new-date first (each course's lessons share its stamp), then lesson id asc (EP-14).
    const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const expected = [...[...lessons.first].sort(byId), ...[...lessons.second].sort(byId)];
    for (const [index, lesson] of expected.entries()) {
      const item = items.nth(index);
      await expect(item).toHaveAttribute(
        'href',
        `/cursos/${index < 2 ? ids.first : ids.second}/aulas/${lesson.id}`,
      );
      await expect(item.getByTestId('courses-home-new-lesson-title')).toHaveText(lesson.title);
      await expect(item.getByTestId('member-lesson-thumb-badge')).toHaveText(H.newLessons.badge);
      // No ready video: no chip, the meta is the course alone.
      await expect(item.getByTestId('member-lesson-thumb-duration')).toHaveCount(0);
      await expect(item.getByTestId('member-lesson-thumb')).toHaveAttribute('data-state', 'open');
    }
    for (const locked of lessons.paid) {
      await expect(home(page).getByText(locked.title)).toHaveCount(0);
    }
    await expect(rail.getByText(lessons.third[0]?.title ?? '-')).toHaveCount(0);

    // "Explore por categoria": the server's lower(name) order, counts pluralised, no icon.
    const tiles = page
      .getByRole('list', { name: H.sections.categories })
      .getByTestId('courses-home-category');
    await expect(tiles).toHaveCount(2);
    await expect(tiles.nth(0)).toHaveAttribute(
      'aria-label',
      tm('home.categories.aria', { category: titles.long, n: 1 }),
    );
    await expect(tiles.nth(0).getByTestId('courses-home-category-count')).toHaveText(
      tm('home.categories.count', { n: 1 }),
    );
    await expect(tiles.nth(1).getByTestId('courses-home-category-name')).toHaveText(titles.short);
    await expect(tiles.nth(1).getByTestId('courses-home-category-count')).toHaveText(
      tm('home.categories.count', { n: 2 }),
    );
    await expect(tiles.nth(1)).toHaveAttribute(
      'href',
      `/area-membros?aba=cursos&categoria=${ids.short}`,
    );
    await expect(tiles.locator('svg')).toHaveCount(0);

    // "Ver tudo" on the shelf lands on the catalogue (?aba=cursos).
    await shelf.getByRole('link', { name: H.seeAllCourses, exact: true }).click();
    await expect(page).toHaveURL(/\/area-membros\?aba=cursos$/);
    await expect(page.getByTestId('courses-member-courses')).toBeVisible();
  });

  test('UI-D-455: a category tile lands on the catalogue filtered by that category', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros`);
    await expectInicio(page);
    await page
      .getByRole('list', { name: H.sections.categories })
      .getByRole('link', { name: tm('home.categories.aria', { category: titles.short, n: 2 }) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/area-membros\\?aba=cursos&categoria=${ids.short}$`));
    await expect(page.getByTestId('courses-member-courses')).toBeVisible();
    await expect(
      page
        .getByTestId('courses-member-categories')
        .getByRole('link', { name: titles.short, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    const grid = page.getByTestId('courses-member-grid');
    await expect(grid.locator(`a[href="/cursos/${ids.first}"]`)).toHaveCount(1);
    await expect(grid.locator(`a[href="/cursos/${ids.second}"]`)).toHaveCount(1);
    await expect(grid.locator(`a[href="/cursos/${ids.third}"]`)).toHaveCount(0);
    await expect(grid.locator(`a[href="/cursos/${ids.paid}"]`)).toHaveCount(0);
  });

  test('D-436 / D-438: after lessons of two courses are completed, the shelf opens "em andamento" and the track loses "Sugerido"', async ({
    page,
  }) => {
    const firstLesson = lessons.first[0]?.id ?? '';
    const secondLesson = lessons.second[0]?.id ?? '';
    await completeLessonAs(tenant.memberEmail, firstLesson);
    await completeLessonAs(tenant.memberEmail, secondLesson);

    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros`);
    await expectInicio(page);
    // The most recently touched course is the hero; the other started one opens the shelf.
    await expect(hero(page).getByRole('heading', { name: H.hero.title.resume })).toBeVisible();
    await expect(page.getByTestId('courses-home-hero-cta')).toHaveAttribute(
      'href',
      `/cursos/${ids.second}/aulas/${lessons.second[1]?.id}`,
    );
    const rows = page.getByTestId('courses-home-shelf-row');
    await expect(rows.nth(0)).toHaveAttribute('href', `/cursos/${ids.first}`);
    await expect(rows.nth(0)).toHaveAttribute('data-kind', 'em_andamento');
    await expect(rows.nth(0).getByTestId('courses-home-shelf-legend')).toHaveText(
      fill(H.shelf.progress, { percent: '50', done: '1', total: '2' }),
    );
    await expect(
      rows.nth(0).getByRole('progressbar', { name: fill(M.progress.aria, { percent: '50' }) }),
    ).toHaveCount(1);
    await expect(rows.nth(0)).toHaveAttribute(
      'aria-label',
      fill(H.shelf.aria, {
        course: titles.first,
        state: fill(H.shelf.stateProgress, { percent: '50' }),
      }),
    );

    const track = page.getByTestId('courses-home-track');
    await expect(track).toHaveAttribute('data-state', 'started');
    await expect(page.getByTestId('courses-home-track-suggested')).toHaveCount(0);
    await expect(page.getByTestId('courses-home-track-line')).toHaveText(
      fill(H.track.progress, { percent: '33', course: titles.first }),
    );
    await expect(
      track.getByRole('progressbar', { name: fill(M.progress.aria, { percent: '33' }) }),
    ).toHaveCount(1);

    // The completed lessons show the shipped done thumb and say so in their name.
    const done = page
      .getByRole('list', { name: H.sections.newLessons })
      .locator(`a[href="/cursos/${ids.first}/aulas/${firstLesson}"]`);
    await expect(done).toHaveAttribute('data-done', 'true');
    await expect(done.getByTestId('member-lesson-thumb')).toHaveAttribute('data-state', 'done');
    await expect(done).toHaveAttribute(
      'aria-label',
      fill(H.newLessons.ariaDone, { lesson: lessons.first[0]?.title ?? '', course: titles.first }),
    );
  });

  test('E09 long-text backstop: at 320px a 40-character category name clamps to two lines inside the 112px tile and keeps its count visible', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros`);
    await expectInicio(page);

    const tile = page
      .getByRole('list', { name: H.sections.categories })
      .getByRole('link', { name: tm('home.categories.aria', { category: titles.long, n: 1 }) });
    await tile.scrollIntoViewIfNeeded();
    const tileBox = await boxOf(tile);
    expect(Math.round(tileBox.width)).toBe(112);

    const name = tile.getByTestId('courses-home-category-name');
    await expect(name).toHaveText(titles.long);
    expect(
      await name.evaluate((node) => {
        const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
        return {
          lines: Math.round(node.getBoundingClientRect().height / lineHeight),
          clipped: node.scrollHeight > node.clientHeight + 1,
        };
      }),
    ).toEqual({ lines: 2, clipped: true });

    const count = tile.getByTestId('courses-home-category-count');
    await expect(count).toBeVisible();
    const countBox = await boxOf(count);
    expect(countBox.y).toBeGreaterThanOrEqual(tileBox.y);
    expect(countBox.y + countBox.height).toBeLessThanOrEqual(tileBox.y + tileBox.height + 0.5);
    expect(countBox.x).toBeGreaterThanOrEqual(tileBox.x);
    expect(countBox.x + countBox.width).toBeLessThanOrEqual(tileBox.x + tileBox.width + 0.5);
    // The rail scrolls inside itself: the page never scrolls sideways.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});

/** An ACTIVE track on `tenant` holding `courseIds` in that order, `hoursAgo` back-dating it. */
async function insertTrack(
  tenant: CoursesTenant,
  title: string,
  courseIds: string[],
  hoursAgo: number,
): Promise<string> {
  const [track] = await sql()<{ id: string }[]>`
    insert into public.course_tracks (tenant_id, title, created_at, updated_at)
    values (${tenant.tenantId}::uuid, ${title},
            now() - make_interval(hours => ${hoursAgo}::int), now() - make_interval(hours => ${hoursAgo}::int))
    returning id::text as id`;
  if (!track) throw new Error(`could not create the track "${title}"`);
  let position = 0;
  for (const courseId of courseIds) {
    position += 1;
    await sql()`
      insert into public.course_track_courses (tenant_id, track_id, course_id, position)
      values (${tenant.tenantId}::uuid, ${track.id}::uuid, ${courseId}::uuid, ${position})`;
  }
  return track.id;
}

/** How many lines a block's text takes, from its box and its computed line height. */
async function linesOf(locator: Locator): Promise<number> {
  return locator.evaluate((node) => {
    const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
    return Math.round(node.getBoundingClientRect().height / lineHeight);
  });
}

const tracksBody = (page: Page): Locator => page.getByTestId('courses-member-tracks');
const progressBody = (page: Page): Locator => page.getByTestId('courses-member-progress');
const trackHero = (page: Page): Locator => page.getByTestId('courses-track-hero');
const trackSteps = (page: Page): Locator => page.getByTestId('courses-track-step');

/**
 * 08.6-10 — Trilhas and Meu progresso, and the area row complete with its five tabs (D-435, D-439,
 * D-440, D-442, D-443, UI-D-446, UI-D-456..UI-D-458, COURSE-28, COURSE-35..38), on the phone and
 * on the desktop.
 *
 * Its own throwaway tenant per project (`e2e-mt-<project>`, store on). Four published courses:
 *
 *  - `alpha`, 2 lessons with ready videos of 30 and 60 minutes (the hours line: 1,5 h);
 *  - `beta`, 1 lesson, no video ("1 aula", no duration);
 *  - `paid`, 2 lessons, linked to an active product the member lacks: LOCKED (the "Bloqueada" step
 *    still links to its buy path);
 *  - `gamma`, 1 lesson, no video.
 *
 * Two active tracks: "Principal" `alpha → beta → paid` (the newest, so the suggested one) and
 * "Avançado" `gamma` (an hour older, "Outras trilhas"). The school holds 6 live lessons. The cases run
 * in order: the fresh member first, then lesson 1 of `alpha` completed in the Trilhas case and lesson
 * 2 in the Progresso case. The 320px backstops run last, on the phone only.
 */
test.describe('member area: Trilhas and Progresso', () => {
  test.skip(isRemote, 'the member-area fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  const prefix = `e2e-mt-${run}`;
  let tenant: CoursesTenant;
  let alpha: SeededCourse;
  const ids = { beta: '', paid: '', gamma: '', principal: '', advanced: '' };
  const titles = {
    alpha: `${prefix} Olhar do zero`,
    beta: `${prefix} Pele: protocolo`,
    paid: `${prefix} Lábios: técnica e segurança`,
    gamma: `${prefix} Consultório que cresce`,
    principal: `${prefix} Do zero à prática`,
    advanced: `${prefix} Avançado em harmonização`,
  };

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    tenant = await createCoursesTenant(`e2e-mt-${testInfo.project.name}`, SEED_PASSWORD, ['store']);
    alpha = await seedCourse(tenant, {
      title: titles.alpha,
      moduleTitle: 'Técnica',
      status: 'published',
      lessons: [
        { title: `${prefix} Anatomia`, seconds: 1800 },
        { title: `${prefix} Pontos de aplicação`, seconds: 3600 },
      ],
    });
    const course = (title: string, lessonsPerModule: number, minutesAgo: number) =>
      createCourse({
        tenantSlug: tenant.slug,
        title,
        status: 'published',
        modules: 1,
        lessonsPerModule,
        minutesAgo,
      });
    ids.beta = await course(titles.beta, 1, 2);
    ids.paid = await course(titles.paid, 2, 3);
    ids.gamma = await course(titles.gamma, 1, 4);
    const productId = await createProduct({
      tenantSlug: tenant.slug,
      name: `${prefix} Produto`,
      priceCents: 4900,
    });
    await linkCourseProduct(ids.paid, productId);

    ids.advanced = await insertTrack(tenant, titles.advanced, [ids.gamma], 1);
    ids.principal = await insertTrack(tenant, titles.principal, [alpha.id, ids.beta, ids.paid], 0);
  });

  test.afterAll(async () => {
    if (tenant) await deleteCoursesTenant(tenant.slug);
    await client?.end();
    client = null;
    await closeCoursesMember();
    await closeStoreAdmin();
    await closeCoursesAdmin();
  });

  test('EP-03 / D-435 (COURSE-28): the row lists Início, Cursos, Trilhas, Lives, Progresso in that order and each tab opens its own body', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros`);
    await expectInicio(page);
    const tabs = page.getByRole('tablist', { name: C.hub.tabs.label }).getByRole('tab');
    await expect(tabs).toHaveText([
      C.hub.tabs.home,
      C.hub.tabs.courses,
      C.hub.tabs.tracks,
      C.hub.tabs.lives,
      C.hub.tabs.progress,
    ]);
    await expect(areaTab(page, C.hub.tabs.tracks)).toHaveAttribute(
      'href',
      '/area-membros?aba=trilhas',
    );
    await expect(areaTab(page, C.hub.tabs.progress)).toHaveAttribute(
      'href',
      '/area-membros?aba=progresso',
    );

    const bodies: [string, string][] = [
      [C.hub.tabs.courses, 'courses-member-courses'],
      [C.hub.tabs.tracks, 'courses-member-tracks'],
      [C.hub.tabs.lives, 'courses-member-lives'],
      [C.hub.tabs.progress, 'courses-member-progress'],
      [C.hub.tabs.home, 'courses-member-home'],
    ];
    for (const [name, testId] of bodies) {
      await areaTab(page, name).click();
      await expect(page.getByTestId(testId)).toBeVisible();
      await expect(areaTab(page, name)).toHaveAttribute('aria-selected', 'true');
      for (const [, other] of bodies) {
        if (other !== testId) await expect(page.getByTestId(other)).toHaveCount(0);
      }
    }
  });

  test('D-442 / UI-D-457 (E11 empty): a fresh member sees the ring at 0% and "Seu progresso começa na primeira aula" with "Começar agora" — no numbers, no rows, no certificates', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros?aba=progresso`);
    await expect(progressBody(page)).toBeVisible();
    await expect(page.getByTestId('progress-ring-label')).toHaveText(
      fill(M.myProgress.ring.label, { percent: '0' }),
    );
    await expect(page.getByTestId('courses-progress-ring-done')).toHaveText(
      tm('myProgress.ring.done', { done: 0, total: 6 }),
    );
    await expect(page.getByTestId('courses-progress-ring-sub')).toHaveText(
      tm('myProgress.ring.remaining', { n: 6 }),
    );
    const empty = page.getByTestId('courses-progress-empty');
    await expect(empty.getByRole('heading', { name: M.myProgress.empty.title })).toBeVisible();
    await expect(empty.getByText(M.myProgress.empty.body)).toBeVisible();
    await expect(
      empty.getByRole('link', { name: M.myProgress.empty.cta, exact: true }),
    ).toHaveAttribute('href', '/area-membros');
    await expect(page.getByTestId('courses-progress-stats')).toHaveCount(0);
    await expect(page.getByTestId('courses-progress-courses')).toHaveCount(0);
    await expect(progressBody(page).getByText(/certificad|conquista|em breve/i)).toHaveCount(0);
  });

  test('D-439 / D-438 (COURSE-35): the suggested track, its path with every state in words, a locked step that still links to its buy path, "Outras trilhas" by ?trilha=, an unknown ?trilha=, then "Sua trilha" once started', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros?aba=trilhas`);
    await expect(tracksBody(page)).toBeVisible();
    await expect(areaTab(page, C.hub.tabs.tracks)).toHaveAttribute('aria-selected', 'true');

    // The hero: suggested, nothing started — "Sugerido", "Começar trilha", no bar.
    const hero = trackHero(page);
    await expect(page.getByTestId('courses-track-hero-title')).toHaveText(titles.principal);
    await expect(page.getByTestId('courses-track-hero-pill')).toHaveText(M.tracks.suggested);
    await expect(page.getByTestId('courses-track-hero-eyebrow')).toHaveText(
      fill(M.tracks.step, { n: '1', total: '3' }),
    );
    await expect(hero.getByRole('progressbar')).toHaveCount(0);
    await expect(page.getByTestId('courses-track-hero-line')).toHaveText(
      tm('tracks.progress', { coursesDone: 0, total: 3, percent: 0 }),
    );
    const cta = page.getByTestId('courses-track-hero-cta');
    await expect(cta).toHaveText(M.tracks.cta.start);
    await expect(cta).toHaveAttribute('href', `/cursos/${alpha.id}`);

    // "O caminho": one step per published course, the state in the eyebrow, every card a link.
    await expect(
      page.getByRole('list', { name: fill(M.tracks.path.aria, { track: titles.principal }) }),
    ).toBeVisible();
    const steps = trackSteps(page);
    await expect(steps).toHaveCount(3);
    await expect(steps.getByTestId('courses-track-step-eyebrow')).toHaveText([
      fill(M.tracks.path.eyebrow, { nn: '01', state: M.tracks.path.stateNext }),
      fill(M.tracks.path.eyebrow, { nn: '02', state: M.tracks.path.stateNext }),
      fill(M.tracks.path.eyebrow, { nn: '03', state: M.tracks.path.stateLocked }),
    ]);
    await expect(steps.nth(0).getByTestId('courses-track-step-meta')).toHaveText(
      tm('tracks.path.meta', { N: 2, hasDuration: 'true', duration: '1 h 30 min' }),
    );
    await expect(steps.nth(1).getByTestId('courses-track-step-meta')).toHaveText(
      tm('tracks.path.meta', { N: 1, hasDuration: 'false', duration: '' }),
    );
    await expect(steps.nth(2).getByTestId('courses-track-step-meta')).toHaveText(
      tm('tracks.path.metaLocked', { N: 2 }),
    );
    await expect(steps.nth(2)).toHaveAttribute('data-state', 'bloqueada');
    await expect(steps.nth(2)).toHaveAttribute(
      'aria-label',
      tm('tracks.path.stepAria', { nn: '03', course: titles.paid, state: 'bloqueada' }),
    );
    await expect(steps.getByTestId('courses-track-step-link')).toHaveCount(3);
    await expect(steps.nth(2).getByTestId('courses-track-step-link')).toHaveAttribute(
      'href',
      `/cursos/${ids.paid}`,
    );
    // The last step has no connector; no pulsing ring, no mini button (UI-D-463).
    await expect(page.getByTestId('courses-track-step-connector')).toHaveCount(2);
    await expect(tracksBody(page).locator('[class*="animate-"]')).toHaveCount(0);
    await expect(page.getByText(/premium/i)).toHaveCount(0);

    // "Outras trilhas": the other track, not started, a link that swaps the hero.
    const other = page.getByTestId('courses-track-other');
    await expect(other).toHaveCount(1);
    await expect(other).toContainText(titles.advanced);
    await expect(other).toContainText(M.tracks.others.notStarted);
    await expect(other).toHaveAttribute('href', `/area-membros?aba=trilhas&trilha=${ids.advanced}`);
    await other.click();
    await expect(page).toHaveURL(new RegExp(`/area-membros\\?aba=trilhas&trilha=${ids.advanced}$`));
    await expect(page.getByTestId('courses-track-hero-title')).toHaveText(titles.advanced);
    await expect(page.getByTestId('courses-track-hero-pill')).toHaveCount(0);
    await expect(page.getByTestId('courses-track-hero-cta')).toHaveAttribute(
      'href',
      `/cursos/${ids.gamma}`,
    );
    await expect(page.getByTestId('courses-track-other')).toContainText(titles.principal);

    // An unknown ?trilha= reads as the default track (T-08.6-20).
    await page.goto(`${tenant.origin}/area-membros?aba=trilhas&trilha=xyz`);
    await expect(page.getByTestId('courses-track-hero-title')).toHaveText(titles.principal);

    // The locked step lands on the course page's buy section (D-421, D-424).
    await trackSteps(page).nth(2).getByTestId('courses-track-step-link').click();
    await expect(page).toHaveURL(new RegExp(`/cursos/${ids.paid}$`));
    await expect(page.getByRole('link', { name: M.locked.buy, exact: true })).toBeVisible();

    // Started: one lesson of the first course completed.
    await completeLessonAs(tenant.memberEmail, alpha.lessons[0] ?? '');
    await page.goto(`${tenant.origin}/area-membros?aba=trilhas`);
    await expect(page.getByTestId('courses-track-hero-title')).toHaveText(titles.principal);
    await expect(page.getByTestId('courses-track-hero-pill')).toHaveText(M.tracks.mine);
    await expect(page.getByTestId('courses-track-hero-cta')).toHaveText(M.tracks.cta.continue);
    await expect(page.getByTestId('courses-track-hero-cta')).toHaveAttribute(
      'href',
      `/cursos/${alpha.id}`,
    );
    // Lesson-weighted over the path's 5 live lessons: 1 done → 20%.
    await expect(
      trackHero(page).getByRole('progressbar', { name: fill(M.progress.aria, { percent: '20' }) }),
    ).toBeVisible();
    await expect(page.getByTestId('courses-track-hero-line')).toHaveText(
      tm('tracks.progress', { coursesDone: 0, total: 3, percent: 20 }),
    );
    const first = trackSteps(page).nth(0);
    await expect(first).toHaveAttribute('data-state', 'em_andamento');
    await expect(first.getByTestId('courses-track-step-eyebrow')).toHaveText(
      fill(M.tracks.path.eyebrow, { nn: '01', state: M.tracks.path.stateInProgress }),
    );
    await expect(
      first.getByRole('progressbar', { name: fill(M.progress.aria, { percent: '50' }) }),
    ).toBeVisible();
    await expect(first).toContainText(
      fill(M.tracks.path.progress, { percent: '50', done: '1', total: '2' }),
    );
  });

  test('D-440 / D-442 / D-443 (COURSE-36..38): after two completions the ring, the four numbers and the course row are the server’s', async ({
    page,
  }) => {
    await completeLessonAs(tenant.memberEmail, alpha.lessons[1] ?? '');
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros?aba=progresso`);
    await expect(progressBody(page)).toBeVisible();

    await expect(page.getByTestId('progress-ring-label')).toHaveText(
      fill(M.myProgress.ring.label, { percent: '33' }),
    );
    await expect(page.getByTestId('courses-progress-ring-done')).toHaveText(
      tm('myProgress.ring.done', { done: 2, total: 6 }),
    );
    await expect(page.getByTestId('courses-progress-ring-sub')).toHaveText(
      tm('myProgress.ring.remaining', { n: 4 }),
    );
    await expect(page.getByTestId('courses-progress-empty')).toHaveCount(0);

    const stats = page.getByTestId('courses-progress-stats');
    await expect(stats.locator('dl')).toHaveCount(1);
    await expect(stats.getByTestId('stat-block-label')).toHaveText([
      M.myProgress.stats.lessons,
      M.myProgress.stats.hours,
      M.myProgress.stats.courses,
      M.myProgress.stats.streak,
    ]);
    await expect(stats.getByTestId('stat-block-value')).toHaveText([
      '2',
      fill(M.myProgress.stats.hoursValue, { h: '1,5' }),
      '1',
      tm('myProgress.stats.days', { n: 1 }),
    ]);

    const section = page.getByTestId('courses-progress-courses');
    await expect(section.getByRole('heading', { name: M.myProgress.courses.title })).toBeVisible();
    const rows = section.getByTestId('courses-progress-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toHaveAttribute('href', `/cursos/${alpha.id}`);
    await expect(rows.nth(0)).toHaveAttribute('data-trailing', 'done');
    await expect(rows.nth(0)).toHaveAttribute(
      'aria-label',
      fill(M.myProgress.courses.aria, { course: titles.alpha, percent: '100' }),
    );
    await expect(rows.nth(0)).toContainText(
      fill(M.myProgress.courses.progress, { percent: '100', done: '2', total: '2' }),
    );
    await expect(progressBody(page).getByText(/certificad|conquista|em breve/i)).toHaveCount(0);
  });

  test('E01 / E10 / E11 backstops at 320px: the five-item row fits at 390 and scrolls at 320 with Progresso whole; long track and step titles keep the disc and eyebrow aligned; every number stays on one line', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstops are phone checks');
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    const row = page.getByRole('tablist', { name: C.hub.tabs.label });

    // E01 overflow: at 390px the compact row fits on one line.
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`${tenant.origin}/area-membros`);
    await expectInicio(page);
    expect(await row.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);

    // At 320px it scrolls (hidden scrollbar) and the active Progresso is fully visible.
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`${tenant.origin}/area-membros?aba=progresso`);
    await expect(progressBody(page)).toBeVisible();
    expect(await row.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    const active = areaTab(page, C.hub.tabs.progress);
    await expect(active).toHaveAttribute('aria-selected', 'true');
    await expect(async () => {
      const rowBox = await boxOf(row);
      const tabBox = await boxOf(active);
      expect(tabBox.x).toBeGreaterThanOrEqual(rowBox.x - 0.5);
      expect(tabBox.x + tabBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
    }).toPass({ timeout: 5_000 });

    // E11 overflow: each StatBlock value on one line inside its cell; labels truncate.
    const blocks = page.getByTestId('stat-block');
    await expect(blocks).toHaveCount(4);
    for (let index = 0; index < 4; index += 1) {
      const block = blocks.nth(index);
      const value = block.getByTestId('stat-block-value');
      expect(await linesOf(value)).toBe(1);
      expect(await value.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      const blockBox = await boxOf(block);
      const valueBox = await boxOf(value);
      expect(valueBox.x + valueBox.width).toBeLessThanOrEqual(blockBox.x + blockBox.width + 0.5);
      expect(
        await block
          .getByTestId('stat-block-label')
          .evaluate((node) => getComputedStyle(node).textOverflow),
      ).toBe('ellipsis');
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    // E10 long-text: a 120-character track title and a 120-character step course title.
    const trackTitle = longTitle(`${prefix} Trilha`, 120);
    const courseTitle = longTitle(`${prefix} Curso`, 120);
    expect([trackTitle.length, courseTitle.length]).toEqual([120, 120]);
    const longCourse = await createCourse({
      tenantSlug: tenant.slug,
      title: courseTitle,
      status: 'published',
      modules: 1,
      lessonsPerModule: 1,
      minutesAgo: 5,
    });
    const longTrack = await insertTrack(tenant, trackTitle, [longCourse, ids.beta], 2);
    await page.goto(`${tenant.origin}/area-membros?aba=trilhas&trilha=${longTrack}`);
    // Visible first: the streamed body sits in a hidden boundary until React swaps it in.
    const heroTitle = page.getByTestId('courses-track-hero-title');
    await expect(heroTitle).toBeVisible();
    await expect(heroTitle).toHaveText(trackTitle);
    expect(await linesOf(heroTitle)).toBe(2);
    const heroBox = await boxOf(trackHero(page));
    const eyebrowBox = await boxOf(page.getByTestId('courses-track-hero-eyebrow'));
    expect(eyebrowBox.y).toBeGreaterThanOrEqual(heroBox.y);
    expect(eyebrowBox.x + eyebrowBox.width).toBeLessThanOrEqual(heroBox.x + heroBox.width + 0.5);

    const step = trackSteps(page).nth(0);
    await expect(step.getByTestId('courses-track-step-title')).toHaveText(courseTitle);
    expect(await linesOf(step.getByTestId('courses-track-step-title'))).toBe(2);
    const disc = await boxOf(step.getByTestId('courses-track-step-disc'));
    expect(Math.round(disc.width)).toBe(28);
    const stepEyebrow = await boxOf(step.getByTestId('courses-track-step-eyebrow'));
    // The disc and the eyebrow share a row band.
    expect(stepEyebrow.y).toBeLessThan(disc.y + disc.height);
    expect(stepEyebrow.y + stepEyebrow.height).toBeGreaterThan(disc.y);
    // The meta sits under the title, inside the card, on screen.
    const link = await boxOf(step.getByTestId('courses-track-step-link'));
    const meta = await boxOf(step.getByTestId('courses-track-step-meta'));
    expect(meta.y + meta.height).toBeLessThanOrEqual(link.y + link.height + 0.5);
    expect(link.x + link.width).toBeLessThanOrEqual(320);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});

/**
 * 08.6-11 — the live and its reminder in the member's hands (D-444, D-446, D-422, UI-D-452,
 * UI-D-453, UI-D-459, COURSE-32, COURSE-40, COURSE-50), on the phone and on the desktop.
 *
 * Its own throwaway tenant per project (`e2e-ml-<project>`, store on): one published course (the
 * hero) and one open live two days ahead. The cases run in order and add what they need: the
 * member's toggle on Início and on the live page, the admin's preview (the banner between the row
 * and the body, the disabled toggle, no write), a product-linked live one day ahead (the nearest:
 * the buy path), a live happening now (the neutral row), the two 320px backstops, and last the
 * member turned `support_tenant` (no banner, a working toggle) once the locked and live-now lives
 * are gone. `afterAll` drops the reminder jobs the opt-ins armed, then the tenant.
 */
test.describe('member area: the live and its reminder', () => {
  test.skip(isRemote, 'the member-area fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const R = M.reminder;
  const HL = H.live;
  const run = Date.now().toString(36);
  const prefix = `e2e-ml-${run}`;
  let tenant: CoursesTenant;
  let timeZone = 'America/Sao_Paulo';
  const ids = { open: '', locked: '', now: '', product: '' };
  const titles = {
    open: `${prefix} Tira-dúvidas de outubro`,
    locked: `${prefix} Masterclass de lábios`,
    now: `${prefix} Live de casos clínicos`,
  };
  const startsNow = new Date(Date.now() - 10 * 60_000).toISOString();

  const nextLive = (page: Page): Locator => home(page).getByTestId('courses-home-next-live');
  const toggle = (page: Page): Locator => page.getByTestId('reminder-toggle');
  const toastWith = (page: Page, text: string): Locator =>
    page.getByRole('status').filter({ hasText: text });

  async function remindersOf(email: string): Promise<number> {
    const rows = await sql()<{ n: number }[]>`
      select count(*)::int as n
        from public.course_live_reminders r
        join public.users u on u.id = r.user_id
       where r.tenant_id = ${tenant.tenantId}::uuid and r.live_id = ${ids.open}::uuid
         and u.email = ${email}`;
    return rows[0]?.n ?? 0;
  }

  /** Waits for the optimistic write to settle (aria-busy cleared) in `state`. */
  async function expectSettled(page: Page, state: 'on' | 'off'): Promise<void> {
    await expect(toggle(page)).toHaveAttribute('data-state', state);
    await expect(toggle(page)).not.toHaveAttribute('aria-busy', 'true');
  }

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    tenant = await createCoursesTenant(`e2e-ml-${testInfo.project.name}`, SEED_PASSWORD, ['store']);
    timeZone = await tenantTimezone(tenant.slug);
    await seedCourse(tenant, {
      title: `${prefix} Olhar do zero`,
      moduleTitle: 'Técnica',
      status: 'published',
      lessons: [{ title: `${prefix} Anatomia`, seconds: 552 }],
    });
    ids.open = await createLive({
      tenantSlug: tenant.slug,
      title: titles.open,
      startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    });
  });

  test.afterAll(async () => {
    if (tenant) {
      // The opt-ins armed delayed jobs for lives this teardown removes (they would skip anyway).
      await sql()`
        delete from pgboss.job_common
         where name = 'courses.live_reminder' and data->>'tenantId' = ${tenant.tenantId}`.catch(
        () => undefined,
      );
      await deleteCoursesTenant(tenant.slug);
    }
    await client?.end();
    client = null;
    await closeCoursesMember();
    await closeStoreAdmin();
    await closeCoursesAdmin();
  });

  test("D-444 / UI-D-452 / UI-D-453 (COURSE-32, COURSE-40): the member turns the next live's reminder on from Início, it survives a reload, the live page shows it on, and turning it off there reads off on Início", async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros`);
    await expectInicio(page);

    // "Próxima live": the server's relative day, the when-line, the title, then the toggle off.
    await expect(nextLive(page)).toBeVisible();
    await expect(
      nextLive(page).getByRole('heading', { name: H.sections.nextLive, exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('courses-home-next-live-day')).toHaveText(
      tm('home.live.inDays', { n: 2 }),
    );
    await expect(page.getByTestId('courses-home-next-live-title')).toHaveText(titles.open);
    await expect(page.getByTestId('courses-home-next-live-cover')).toHaveAttribute(
      'href',
      `/cursos/lives/${ids.open}`,
    );
    await expect(page.getByTestId('courses-home-live-now')).toHaveCount(0);
    await expect(page.getByTestId('exclusive-badge')).toHaveCount(0);
    // E06/E07 interaction truth: Início never carries a room link.
    await expect(home(page).locator('a[href^="http"]')).toHaveCount(0);
    await expect(page.getByTestId('live-join')).toHaveCount(0);

    await expect(toggle(page)).toHaveText(R.off);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle(page)).toHaveAttribute('aria-label', fill(R.aria, { live: titles.open }));
    await expect(page.getByTestId('reminder-helper')).toHaveText(R.helper);

    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle(page)).toHaveText(R.on);
    await expect(toastWith(page, R.toasts.on)).toBeVisible();
    await expectSettled(page, 'on');
    expect(await remindersOf(tenant.memberEmail)).toBe(1);

    // The state is the server's: a reload still reads on.
    await page.reload();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle(page)).toHaveText(R.on);

    // The live page, before its window: the toggle under the "Começa em …" card, on.
    await page.getByTestId('courses-home-next-live-cover').click();
    await expect(page.getByTestId('member-live-page')).toHaveAttribute('data-state', 'before');
    const zone = page.getByTestId('live-state-zone');
    await expect(zone.getByTestId('live-starts')).toBeVisible();
    await expect(zone.getByTestId('reminder-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(toastWith(page, R.toasts.off)).toBeVisible();
    await expectSettled(page, 'off');
    expect(await remindersOf(tenant.memberEmail)).toBe(0);

    await page.goto(`${tenant.origin}/area-membros`);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle(page)).toHaveText(R.off);
  });

  test("D-422 / UI-D-459 (COURSE-50, EP-68, EP-69): the admin's ?ver=aluno shows the banner after the row and before the body, the toggle disabled with its hint, and a tap sends no write — on Início and on the live page", async ({
    page,
  }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros?ver=aluno`);
    await expectInicio(page);

    const banner = page.getByTestId('preview-banner');
    await expect(banner).toContainText(M.preview.title);
    await expect(banner).toContainText(M.preview.body);
    await expect(page.getByTestId('preview-banner-back')).toHaveAttribute('href', '/cursos');

    // EP-69: the area row, then the banner, then the body — in DOM order.
    const row = page
      .getByTestId('courses-member-catalogue')
      .getByRole('tablist', { name: C.hub.tabs.label });
    const order = await page.evaluate(
      ([first, second, third]) => {
        const follows = (a: Node | null, b: Node | null) =>
          Boolean(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        return [follows(first, second), follows(second, third)];
      },
      [
        await row.elementHandle(),
        await banner.elementHandle(),
        await home(page).elementHandle(),
      ] as const,
    );
    expect(order).toEqual([true, true]);

    // EP-68: disabled, off, the hint in place of the helper; a tap sends nothing.
    await expect(toggle(page)).toBeDisabled();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle(page)).toHaveText(R.off);
    await expect(page.getByTestId('reminder-helper')).toHaveText(R.previewHint);
    await expect(page.getByTestId('courses-home-next-live-cover')).toHaveAttribute(
      'href',
      `/cursos/lives/${ids.open}?ver=aluno`,
    );

    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/reminder') || request.headers()['next-action']) {
        writes.push(`${request.method()} ${request.url()}`);
      }
    });
    // A disabled button takes no pointer: the click is dispatched, and React must still ignore it.
    await toggle(page).dispatchEvent('click');
    await page.waitForTimeout(500);
    expect(writes).toEqual([]);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');

    // The live page in preview: the member page, no banner (sketch 011 finding 1), the same toggle.
    await page.getByTestId('courses-home-next-live-cover').click();
    await expect(page).toHaveURL(new RegExp(`/cursos/lives/${ids.open}\\?ver=aluno$`));
    await expect(page.getByTestId('member-live-page')).toHaveAttribute('data-state', 'before');
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    await expect(toggle(page)).toBeDisabled();
    await expect(page.getByTestId('reminder-helper')).toHaveText(R.previewHint);
    // A disabled button takes no pointer: the click is dispatched, and React must still ignore it.
    await toggle(page).dispatchEvent('click');
    await page.waitForTimeout(500);
    expect(writes).toEqual([]);
    expect(await remindersOf(tenant.adminEmail)).toBe(0);

    // Without the flag the manager keeps the live form.
    await page.goto(`${tenant.origin}/cursos/lives/${ids.open}`);
    await expect(page.getByTestId('member-live-page')).toHaveCount(0);
  });

  test('D-446 / UI-D-452 / A-UI-8: the nearest live sold by a product the member lacks shows "Exclusiva", "Amanhã" and the outline "Comprar para liberar" — no toggle', async ({
    page,
  }) => {
    ids.product = await createProduct({
      tenantSlug: tenant.slug,
      name: `${prefix} Mentoria`,
      priceCents: 19700,
    });
    ids.locked = await createLive({
      tenantSlug: tenant.slug,
      title: titles.locked,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await linkLiveProduct(ids.locked, ids.product);

    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros`);
    await expectInicio(page);
    await expect(nextLive(page)).toHaveAttribute('data-live-id', ids.locked);
    await expect(page.getByTestId('courses-home-next-live-day')).toHaveText(HL.tomorrow);
    await expect(
      page.getByTestId('courses-home-next-live-pills').getByTestId('exclusive-badge'),
    ).toHaveText(M.tags.exclusiveLive);
    const buy = page.getByTestId('courses-home-live-buy');
    await expect(buy).toHaveText(M.locked.buy);
    await expect(buy).toHaveAttribute('href', `/loja/${ids.product}?live=${ids.locked}`);
    // Outline, never Início's second brand fill (A-UI-8).
    await expect(buy).toHaveClass(/border-border-secondary/);
    await expect(buy).not.toHaveClass(/bg-button/);
    await expect(toggle(page)).toHaveCount(0);
    await expect(page.getByTestId('reminder-helper')).toHaveCount(0);
  });

  test('UI-D-452 (COURSE-32): a live happening now is the neutral "Ao vivo agora" row right under the hero — no join link, no toggle, no "Próxima live"', async ({
    page,
  }) => {
    ids.now = await createLive({
      tenantSlug: tenant.slug,
      title: titles.now,
      startsAt: startsNow,
      durationMin: 60,
    });
    const time = new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(startsNow));

    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros`);
    await expectInicio(page);
    const row = page.getByTestId('courses-home-live-now');
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('href', `/cursos/lives/${ids.now}`);
    await expect(row).toContainText(M.lives.liveNow);
    await expect(page.getByTestId('courses-home-live-now-title')).toHaveText(titles.now);
    await expect(page.getByTestId('courses-home-live-now-meta')).toHaveText(
      fill(HL.startedAt, { time, duration: '60' }),
    );
    await expect(nextLive(page)).toHaveCount(0);
    await expect(toggle(page)).toHaveCount(0);
    await expect(home(page).locator('a[href^="http"]')).toHaveCount(0);
    await expect(page.getByTestId('live-join')).toHaveCount(0);

    // Slot 3: right after the hero.
    const heroFollowed = await page.evaluate(
      ([heroNode, rowNode]) =>
        Boolean(
          heroNode &&
            rowNode &&
            heroNode.compareDocumentPosition(rowNode) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      [await hero(page).elementHandle(), await row.elementHandle()] as const,
    );
    expect(heroFollowed).toBe(true);
  });

  test('E06 long-text backstop: at 320px a 120-character live title over the 16:10 cover and the long when-line keep the pills readable and the title inside two lines', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    const long = longTitle(`${prefix} Live`, 120);
    expect(long.length).toBe(120);
    // Only the open live is left as the next one: the others are moved out of the way.
    await sql()`
      delete from public.course_lives
       where tenant_id = ${tenant.tenantId}::uuid and id <> ${ids.open}::uuid`;
    await sql()`update public.course_lives set title = ${long} where id = ${ids.open}::uuid`;

    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros`);
    await expectInicio(page);
    const cover = page.getByTestId('courses-home-next-live-cover');
    await cover.scrollIntoViewIfNeeded();
    const title = page.getByTestId('courses-home-next-live-title');
    await expect(title).toHaveText(long);
    await expect(title).toBeVisible();

    const coverBox = await boxOf(cover);
    const pills = await boxOf(page.getByTestId('courses-home-next-live-pills'));
    const day = await boxOf(page.getByTestId('courses-home-next-live-day'));
    const when = await boxOf(page.getByTestId('courses-home-next-live-when'));
    const titleBox = await boxOf(title);
    // The pills sit inside the cover, above the when-line and the title.
    expect(pills.x).toBeGreaterThanOrEqual(coverBox.x);
    expect(pills.x + pills.width).toBeLessThanOrEqual(coverBox.x + coverBox.width + 1);
    expect(day.y + day.height).toBeLessThanOrEqual(when.y);
    expect(when.y + when.height).toBeLessThanOrEqual(titleBox.y + 1);
    expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(coverBox.y + coverBox.height);
    expect(
      await title.evaluate((node) => {
        const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
        return Math.round(node.getBoundingClientRect().height / lineHeight);
      }),
    ).toBeLessThanOrEqual(2);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test('E14 long-text backstop: with ?ver=aluno at 320px the banner, the five-item row and the hero keep the hero CTA within the first two screen heights', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 640 });
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros?ver=aluno`);
    await expectInicio(page);
    await expect(page.getByTestId('preview-banner')).toBeVisible();
    const cta = page.getByTestId('courses-home-hero-cta');
    await expect(cta).toBeVisible();
    const top = await cta.evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
    const viewport = await page.evaluate(() => window.innerHeight);
    expect(top).toBeLessThanOrEqual(2 * viewport);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test('UI-D-459 (COURSE-50): a support_tenant gets no banner even with ?ver=aluno and a working toggle', async ({
    page,
  }) => {
    // The locked and live-now lives go, so the open live is the next one again; the member's
    // membership becomes the support user (the role is read at sign-in).
    await sql()`
      delete from public.course_lives
       where tenant_id = ${tenant.tenantId}::uuid and id <> ${ids.open}::uuid`;
    await sql()`
      update public.memberships set "role" = 'support_tenant'
       where tenant_id = ${tenant.tenantId}::uuid
         and user_id = (select id from public.users where email = ${tenant.memberEmail})`;

    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros?ver=aluno`);
    await expectInicio(page);
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    await expect(nextLive(page)).toHaveAttribute('data-live-id', ids.open);
    await expect(toggle(page)).toBeEnabled();
    await expect(page.getByTestId('reminder-helper')).toHaveText(R.helper);

    await toggle(page).click();
    await expect(toastWith(page, R.toasts.on)).toBeVisible();
    await expectSettled(page, 'on');
    expect(await remindersOf(tenant.memberEmail)).toBe(1);

    await page.goto(`${tenant.origin}/cursos/lives/${ids.open}?ver=aluno`);
    await expect(page.getByTestId('member-live-page')).toHaveAttribute('data-state', 'before');
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    await expect(toggle(page)).toBeEnabled();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  });
});

/**
 * 08.6-12 (UI-D-460, D-449, D-454, COURSE-48): the six school notices in the bell. The rows are
 * written as the migration role with the facts the courses sources write (planning decision 1), so
 * the rendering does not wait on the worker; plans 05-07's integration cases prove the delivery.
 */
test.describe('member area: the school notices in the bell', () => {
  test.skip(isRemote, 'the member-area fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const K = notificationsMessages.notifications.kinds;
  const run = Date.now().toString(36);
  const prefix = `e2e-mn-${run}`;
  let tenant: CoursesTenant;
  let course: SeededCourse;
  let liveId = '';
  const titles = { course: `${prefix} Olhar do zero`, live: `${prefix} Tira-dúvidas` };
  const lessonTitle = `${prefix} Aula secreta`;
  const startsAt = new Date(Date.now() + 2 * 86_400_000).toISOString();

  /** One bell row as the migration role: `n` orders them (1 is the newest). */
  async function insertRow(
    n: number,
    row: {
      kind: string;
      subject: { type: 'course' | 'live'; id: string };
      actor: boolean;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await sql()`
      insert into public.notifications
        (tenant_id, user_id, kind, dedupe_key, subject_type, subject_id, actor_user_id, payload,
         created_at)
      select ${tenant.tenantId}::uuid,
             (select id from public.users where email = ${tenant.memberEmail}),
             ${row.kind}, ${`${row.kind}:${prefix}:${n}`}, ${row.subject.type},
             ${row.subject.id}::uuid,
             case when ${row.actor}::boolean
               then (select id from public.users where email = ${tenant.adminEmail}) end,
             ${sql().json(row.payload as never)},
             now() - make_interval(mins => ${n})`;
  }

  /** A row by a literal fragment of its sentence. */
  const rowWith = (page: Page, text: string): Locator =>
    page.getByTestId('notification-item').filter({ hasText: text });

  /** `message` with each `{name}` replaced by its value (titles here carry no ICU syntax). */
  const sentence = (message: string, values: Record<string, string>) =>
    message.replace(/<\/?b>/g, '').replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    tenant = await createCoursesTenant(`e2e-mn-${testInfo.project.name}`, SEED_PASSWORD, [
      'notifications',
    ]);
    course = await seedCourse(tenant, {
      title: titles.course,
      moduleTitle: 'Técnica',
      status: 'published',
      lessons: [{ title: lessonTitle, seconds: 300 }],
    });
    liveId = await createLive({ tenantSlug: tenant.slug, title: titles.live, startsAt });

    const courseSubject = { type: 'course' as const, id: course.id };
    const liveSubject = { type: 'live' as const, id: liveId };
    const liveFacts = { liveId, previewAssetId: null, startsAt, title: titles.live };
    await insertRow(1, {
      kind: 'courses.course_published',
      subject: courseSubject,
      actor: true,
      payload: { courseId: course.id, previewAssetId: null, title: titles.course },
    });
    await insertRow(2, {
      kind: 'courses.lessons_added',
      subject: courseSubject,
      actor: false,
      payload: { count: 3, courseId: course.id, previewAssetId: null, title: titles.course },
    });
    await insertRow(3, {
      kind: 'courses.live_scheduled',
      subject: liveSubject,
      actor: true,
      payload: { ...liveFacts, reactivated: false },
    });
    await insertRow(4, {
      kind: 'courses.live_scheduled',
      subject: liveSubject,
      actor: true,
      payload: { ...liveFacts, reactivated: true },
    });
    await insertRow(5, {
      kind: 'courses.live_reminder',
      subject: liveSubject,
      actor: false,
      payload: liveFacts,
    });
    await insertRow(6, {
      kind: 'courses.live_cancelled',
      subject: liveSubject,
      actor: false,
      payload: liveFacts,
    });
    await insertRow(7, {
      kind: 'courses.replay_available',
      subject: liveSubject,
      actor: false,
      payload: { liveId, previewAssetId: null, title: titles.live },
    });
    // D-454: a retracted course notice keeps only the flag (07-04 keep-and-mark).
    await insertRow(8, {
      kind: 'courses.course_published',
      subject: courseSubject,
      actor: true,
      payload: { removed: true },
    });
  });

  test.afterAll(async () => {
    if (tenant) {
      await sql()`delete from public.notifications where tenant_id = ${tenant.tenantId}::uuid`;
      await deleteCoursesTenant(tenant.slug);
    }
    await client?.end();
    client = null;
    await closeCoursesMember();
    await closeStoreAdmin();
    await closeCoursesAdmin();
  });

  test('D-451 / UI-D-460 (COURSE-48, D-449, D-454): each school notice reads as its sentence, links to its course or live, a retracted one reads "removed", and no row names a lesson', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/notificacoes`);
    await expect(page.getByTestId('notification-item')).toHaveCount(8);

    const courseHref = `/cursos/${course.id}`;
    const liveHref = `/cursos/lives/${liveId}`;
    const actor = 'Admin Cursos';

    const published = rowWith(page, sentence(K.coursePublished, { actor, title: titles.course }));
    await expect(published).toHaveAttribute('href', courseHref);
    await expect(rowWith(page, `3 aulas novas em “${titles.course}”.`)).toHaveAttribute(
      'href',
      courseHref,
    );

    // The when-line is the tenant clock's; its exact text is the unit tests' subject.
    const scheduled = rowWith(page, `${actor} agendou a live “${titles.live}” · `);
    await expect(scheduled).toHaveAttribute('href', liveHref);
    await expect(rowWith(page, `${actor} reativou a live “${titles.live}” · `)).toHaveAttribute(
      'href',
      liveHref,
    );
    await expect(
      page.getByTestId('notification-item').filter({
        hasText: new RegExp(`^.*Em 15 minutos: “${titles.live}” começa às \\d{2}:\\d{2}\\.`),
      }),
    ).toHaveAttribute('href', liveHref);
    const cancelled = page.getByTestId('notification-item').filter({
      hasText: new RegExp(`A live “${titles.live}” de .+ · \\d{2}:\\d{2} foi cancelada\\.`),
    });
    await expect(cancelled).toHaveAttribute('href', liveHref);
    await expect(
      rowWith(page, sentence(K.replayAvailable, { title: titles.live })),
    ).toHaveAttribute('href', liveHref);

    // D-454: the retracted notice is the shipped removed row, a button with nowhere to go.
    const removed = rowWith(page, K.removed);
    await expect(removed).toHaveCount(1);
    expect(await removed.evaluate((el) => el.tagName)).toBe('BUTTON');

    // UI-D-460: the generic row never appears for these kinds; D-449: no row names a lesson.
    await expect(rowWith(page, K.generic)).toHaveCount(0);
    for (const text of await page.getByTestId('notification-item').allTextContents()) {
      expect(text).not.toContain(lessonTitle);
    }

    // A tap opens the course.
    await published.click();
    await expect(page).toHaveURL(new RegExp(`${courseHref}$`));
  });
});
