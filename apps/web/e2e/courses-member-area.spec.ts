import { expect, type Locator, type Page, test } from '@playwright/test';
import { createTranslator } from 'next-intl';
import postgres from 'postgres';
import coursesMessages from '../messages/pt-BR/courses.json' with { type: 'json' };
import memberMessages from '../messages/pt-BR/courses.member.json' with { type: 'json' };
import {
  type CoursesTenant,
  closeCoursesAdmin,
  courseModules,
  createCategory,
  createCourse,
  createCoursesTenant,
  createLesson,
  deleteCoursesTenant,
  linkCourseProduct,
  markAssetReady,
  setCourseStatus,
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
    await page.goto(`${tenant.origin}/cursos`);

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
    await page.goto(`${tenant.origin}/cursos`);

    // The member registry: Início · Cursos · Lives, Início first and selected at bare /cursos.
    await expectInicio(page);
    const tabs = page.getByRole('tablist', { name: C.hub.tabs.label }).getByRole('tab');
    await expect(tabs).toHaveText([C.hub.tabs.home, C.hub.tabs.courses, C.hub.tabs.lives]);
    await expect(areaTab(page, C.hub.tabs.home)).toHaveAttribute('href', '/cursos');
    await expect(areaTab(page, C.hub.tabs.courses)).toHaveAttribute('href', '/cursos?aba=cursos');

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

    await page.goto(`${tenant.origin}/cursos`);
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

  test('EP-01 / EP-02 (COURSE-28): an empty, unknown, repeated or not-yet-registered ?aba= renders Início; ?aba=cursos renders the catalogue', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    for (const path of [
      '/cursos?aba=',
      '/cursos?aba=xyz',
      '/cursos?aba=lives&aba=cursos',
      // Until plan 08.6-10 registers the member Trilhas body.
      '/cursos?aba=trilhas',
    ]) {
      await page.goto(`${tenant.origin}${path}`);
      await expectInicio(page);
    }

    await page.goto(`${tenant.origin}/cursos?aba=cursos`);
    await expect(page.getByTestId('courses-member-courses')).toBeVisible();
    await expect(home(page)).toHaveCount(0);
    await expect(areaTab(page, C.hub.tabs.courses)).toHaveAttribute('aria-selected', 'true');

    await page.goto(`${tenant.origin}/cursos?aba=lives`);
    await expect(page.getByTestId('courses-member-lives')).toBeVisible();
    await expect(home(page)).toHaveCount(0);
  });

  test('D-422 / UI-D-437: the admin’s ?ver=aluno lands on Início with "Sem sequência"; ?aba=cursos&ver=aluno is the catalogue with preview links', async ({
    page,
  }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos`);
    await expect(page.getByTestId('courses-hub')).toBeVisible();

    await page.goto(`${tenant.origin}/cursos?ver=aluno`);
    await expectInicio(page);
    await expect(page.getByTestId('courses-hub')).toHaveCount(0);
    await expect(streak(page)).toHaveText(H.streak.none);
    await expect(areaTab(page, C.hub.tabs.home)).toHaveAttribute('href', '/cursos?ver=aluno');
    await expect(areaTab(page, C.hub.tabs.courses)).toHaveAttribute(
      'href',
      '/cursos?aba=cursos&ver=aluno',
    );
    // The preview writes no progress (D-422): the admin starts at the first lesson, flag kept.
    await expect(page.getByTestId('courses-home-hero-cta')).toHaveAttribute(
      'href',
      `/cursos/${course.id}/aulas/${course.lessons[0]}?ver=aluno`,
    );

    await page.goto(`${tenant.origin}/cursos?aba=cursos&ver=aluno`);
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
    await page.goto(`${longTenant.origin}/cursos`);
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
    await page.goto(`${tenant.origin}/cursos`);
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
      '/cursos?aba=trilhas',
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
    await expect(tiles.nth(1)).toHaveAttribute('href', `/cursos?aba=cursos&categoria=${ids.short}`);
    await expect(tiles.locator('svg')).toHaveCount(0);

    // "Ver tudo" on the shelf lands on the catalogue (?aba=cursos).
    await shelf.getByRole('link', { name: H.seeAllCourses, exact: true }).click();
    await expect(page).toHaveURL(/\/cursos\?aba=cursos$/);
    await expect(page.getByTestId('courses-member-courses')).toBeVisible();
  });

  test('UI-D-455: a category tile lands on the catalogue filtered by that category', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos`);
    await expectInicio(page);
    await page
      .getByRole('list', { name: H.sections.categories })
      .getByRole('link', { name: tm('home.categories.aria', { category: titles.short, n: 2 }) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/cursos\\?aba=cursos&categoria=${ids.short}$`));
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
    await page.goto(`${tenant.origin}/cursos`);
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
    await page.goto(`${tenant.origin}/cursos`);
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
