import { expect, type Locator, type Page, test } from '@playwright/test';
import { createTranslator } from 'next-intl';
import postgres from 'postgres';
import coursesMessages from '../messages/pt-BR/courses.json' with { type: 'json' };
import memberMessages from '../messages/pt-BR/courses.member.json' with { type: 'json' };
import {
  type CoursesTenant,
  closeCoursesAdmin,
  courseModules,
  createCourse,
  createCoursesTenant,
  createLesson,
  deleteCoursesTenant,
  markAssetReady,
  setCourseStatus,
} from './courses-admin';
import { closeCoursesMember, longTitle } from './courses-member';
import { isRemote, login, SEED_PASSWORD } from './fixtures';

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
    await expect(page.getByTestId('member-lesson-thumb-duration')).toHaveText('9:12');
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
