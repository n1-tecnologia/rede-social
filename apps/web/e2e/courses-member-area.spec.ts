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
import { untilHydrated } from './hydration';
import {
  closeSchoolMenu,
  currentSchoolScreen,
  goToSchoolScreen,
  hasDesktopRail,
  schoolAreaLabel,
  schoolScreenLabels,
  schoolScreenLink,
  schoolScreenList,
} from './school-area';
import { closeStoreAdmin, createProduct } from './store-admin';

/** The catalog is the source of copy (UI-SPEC Copywriting Contract), never a literal in a spec. */
const M = memberMessages.courses.member;
const H = M.home;
/**
 * 2026-10-22: the area menu's five screens ("· Membros"), in the menu's order — they replaced the
 * tab row under the old "Cursos" title (`courses.hub.tabs.*`, still in the catalog, no longer drawn).
 */
const S = M.area.screens;
const MENU_LABELS = [S.home, S.courses, S.tracks, S.lives, S.progress];
/** 2026-10-23: a manager reads the same menu with a last row, "Gerenciar" (`/cursos/gerenciar`). */
const MANAGE_LABEL = coursesMessages.courses.manage.title;
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

/** A literal text inside a regular expression. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 2026-10-26 — Início's ONE h1, the greeting by the part of the day at the overview's `serverNow`
 * in the school's zone ("Bom dia|Boa tarde|Boa noite, {firstName}!"). The hour a case runs at is
 * unknown, so the pattern takes the three periods, each read from the catalog's ICU sentence. With
 * `name` (the first word of the member's profile name) it pins the name too; without it, any name.
 */
function greeting(name?: string): RegExp {
  const NAME = '\u0000';
  const sentences = (['morning', 'afternoon', 'evening'] as const).map((period) =>
    escapeRegExp(tm('home.greet', { period, hasName: 'true', name: name ?? NAME })).replace(
      NAME,
      '.+',
    ),
  );
  return new RegExp(`^(?:${sentences.join('|')})$`);
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

const frame = (page: Page): Locator => page.getByTestId('courses-member-catalogue');
const home = (page: Page): Locator => frame(page).getByTestId('courses-member-home');
const streak = (page: Page): Locator => page.getByTestId('courses-member-streak');
const hero = (page: Page): Locator => page.getByTestId('courses-home-hero');

/**
 * Início is the open screen (2026-10-22: a page of its own, `/area-membros`): the frame says so
 * (`data-screen`), the home body is drawn and no other body is, and the page's ONE h1 is the
 * greeting (Início has no screen header). 2026-10-26: the greeting is "Boa tarde, {name}!" by the
 * hour (`greeting`); "Bem-vindo de volta." is left to the overview's error state only.
 */
async function expectInicio(page: Page, name?: string): Promise<void> {
  await expect(frame(page)).toHaveAttribute('data-screen', 'inicio');
  await expect(home(page)).toBeVisible();
  await expect(page.getByTestId('courses-member-courses')).toHaveCount(0);
  await expect(page.getByTestId('courses-member-lives')).toHaveCount(0);
  await expect(page.getByTestId('courses-member-tracks')).toHaveCount(0);
  await expect(page.getByTestId('courses-member-progress')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText([greeting(name)]);
}

/**
 * 2026-10-26 — Início's streak (`courses-member-streak`, an image named by the SERVER's days, D-440;
 * since 2026-10-26 a cell of the dashboard's numbers strip, so drawn only with a hero): its name and
 * its state. Its look is the Início redesign's and is not pinned here.
 */
async function expectStreak(page: Page, days: number): Promise<void> {
  const badge = page.getByTestId('courses-member-streak');
  await expect(badge).toHaveAttribute('data-active', String(days > 0));
  await expect(badge).toHaveAttribute(
    'aria-label',
    days > 0 ? tm('home.streak.aria', { n: days }) : H.streak.ariaNone,
  );
}

/**
 * The testids of Início's blocks (`data-home-section`), in document order (UI-D-447: a block with
 * no data is absent). 2026-10-26: the blocks are no longer all children of the body (the resume
 * card sits inside the dashboard panel), so the whole body is read; the live rows and the empty card
 * are not blocks. The cases assert presence, not order: the Início redesign is still moving them.
 */
async function homeSections(page: Page): Promise<string[]> {
  return home(page).evaluate((root) =>
    Array.from(root.querySelectorAll('[data-home-section]')).map(
      (node) => node.getAttribute('data-testid') ?? '',
    ),
  );
}

/** The screens with a header, and the h1 each one's `ScreenHeader` draws (2026-10-22). */
const SCREEN_TITLE = {
  cursos: M.catalogue.title,
  trilhas: M.screens.tracks.title,
  lives: M.screens.lives.title,
  progresso: M.screens.progress.title,
} as const;

/** A screen other than Início is open: the frame says which, and its ONE h1 is the screen's title. */
async function expectScreen(page: Page, screen: keyof typeof SCREEN_TITLE): Promise<void> {
  await expect(frame(page)).toHaveAttribute('data-screen', screen);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText([SCREEN_TITLE[screen]]);
  await expect(home(page)).toHaveCount(0);
}

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('the element has no box');
  return box;
}

/** Whether `first` comes before `second` in the document. */
async function precedes(first: Locator, second: Locator): Promise<boolean> {
  const other = await second.elementHandle();
  return first.evaluate(
    (node, target) =>
      Boolean(target && node.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING),
    other,
  );
}

/**
 * 08.6-08 — Início, the member area's front door (D-435, D-437, D-440, D-443, UI-D-446..UI-D-449,
 * COURSE-28, COURSE-29, COURSE-34, COURSE-37), on the phone and on the desktop.
 *
 * A throwaway tenant per project (`e2e-ma-<project>`, the courses-admin shape): one member, one
 * admin and one course seeded as a draft, so the first case reads the empty school and the next
 * publishes the course. The cases run in order: the second one completes lesson 1 for the member
 * (the cases after it read Início as a member with progress). The 320px long-text backstop runs on
 * its own throwaway tenant (`e2e-mb-<project>`) so its course never becomes the main tenant's hero.
 *
 * 2026-10-22 (the user's rule, `lib/courses-home-plan.ts`): a member who never started a lesson does
 * not land on Início — `/area-membros` sends them to the catalogue (`/area-membros/cursos`), the
 * menu's "Início" too — and Início appears from their first started or completed lesson on. An empty
 * school (no hero) still shows Início with the empty card, and the admin's preview never redirects,
 * so the "Comece por aqui" hero a new member would have seen is read in the preview.
 *
 * `serviceWorkers: 'block'`: a worker answering navigations from its cache would have these
 * assertions read what a previous run left behind (the 03-05 lesson).
 *
 * 2026-10-22 (the courses area redesign on the social-igoralves prototype): each screen is a page of
 * its own (`/area-membros`, `/area-membros/cursos|trilhas|lives|progresso`), reached from the
 * shell's "· Membros" area menu (the TopBar's menu on a phone, the rail's sub-rows on a desktop,
 * driven through `school-area.ts`) instead of the tab row under the old "Cursos" title; the old
 * `?aba=` addresses redirect (on the client: the routes stream a `loading.tsx`, so the URL is what a
 * case waits for). Início's one h1 is the greeting; the other screens' h1 is their `ScreenHeader`.
 *
 * 2026-10-26 (Início rethought on the academy reference): the greeting is "Boa tarde, {name}!" by
 * the hour in the school's zone, with the question and the catalogue search under it; the streak
 * left the greeting row for the dashboard (drawn only with a hero), beside the resume card (the
 * old hero's hooks, `courses-home-hero*`). Every block is marked `data-home-section`. The Início is
 * still being redesigned, so these cases pin only its structure (the greeting, the blocks present,
 * the hero's CTA, the streak, the lives); its cards' details wait (`TODO(2026-10-26)`).
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

  test('COURSE-34 / UI-D-447 (2026-10-26): with no published course, Início shows the greeting by name, then the empty card — no hero, so no dashboard and no streak', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros`);

    // The fixture's member is "Membro Cursos" (`createCoursesTenant`): the greeting says the first
    // word of the profile's name, after the part of the day.
    await expectInicio(page, 'Membro');

    const empty = page.getByTestId('courses-member-home-empty');
    await expect(empty.getByRole('heading', { name: M.catalogue.empty.title })).toBeVisible();
    await expect(
      empty.getByText(fill(M.catalogue.empty.body, { tenant: tenant.displayName })),
    ).toBeVisible();
    // UI-D-447: a block with no data is absent — no hero (and with it no dashboard: the streak
    // lives there since 2026-10-26), no tracks, no courses.
    const sections = await homeSections(page);
    expect(sections).toContain('courses-home-greeting');
    for (const absent of [
      'courses-home-hero',
      'courses-home-track',
      'courses-home-shelf',
      'courses-home-new-lessons',
    ]) {
      expect(sections).not.toContain(absent);
    }
    await expect(hero(page)).toHaveCount(0);
    await expect(streak(page)).toHaveCount(0);

    await setCourseStatus(course.id, 'published');
  });

  test('2026-10-22 / D-435 / D-440: a member who never started a lesson lands on the catalogue, also through the menu’s Início; the course page starts the course, and after lesson 1 /area-membros is Início with "Continuar aula" at lesson 2 and a 1-day streak', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros`);

    // The user's rule (2026-10-22): no lesson started or completed yet, so Início is not drawn —
    // /area-membros lands on the catalogue's own page (a client redirect: the URL is the assertion).
    await expect(page).toHaveURL(/\/area-membros\/cursos$/);
    await expect(page.getByTestId('courses-member-courses')).toBeVisible();
    await expectScreen(page, 'cursos');

    // The member's area menu ("· Membros"): Início · Cursos · Trilhas · Lives · Progresso, each a
    // page of its own, Cursos current here. Início still links to /area-membros...
    if (!hasDesktopRail(page)) await expect(schoolAreaLabel(page)).toContainText(M.area.label);
    expect(await schoolScreenLabels(page)).toEqual(MENU_LABELS);
    expect(await currentSchoolScreen(page)).toBe(S.courses);
    await expect(await schoolScreenLink(page, S.home)).toHaveAttribute('href', '/area-membros');
    await expect(await schoolScreenLink(page, S.courses)).toHaveAttribute(
      'href',
      '/area-membros/cursos',
    );
    await closeSchoolMenu(page);
    // ...and, for this member, leads to the same catalogue (from another screen, so the URL moves).
    await goToSchoolScreen(page, S.lives, { url: /\/area-membros\/lives$/ });
    await goToSchoolScreen(page, S.home, { url: /\/area-membros\/cursos$/ });
    await expect(page.getByTestId('courses-member-courses')).toBeVisible();
    await expect(home(page)).toHaveCount(0);

    // The member starts the course from the catalogue: the card, then the course page's "Começar
    // o curso" at lesson 1 (the start the old Início hero offered a new member).
    await page.getByTestId('courses-member-grid').locator(`a[href="/cursos/${course.id}"]`).click();
    await expect(page.getByTestId('member-course-page')).toBeVisible();
    const start = page.getByTestId('course-action-cta');
    await expect(start).toHaveText(M.course.start);
    await expect(start).toHaveAttribute('href', `/cursos/${course.id}/aulas/${course.lessons[0]}`);
    await start.click();
    await expect(page.getByTestId('member-lesson-page')).toHaveAttribute(
      'data-lesson-id',
      course.lessons[0] ?? '',
    );
    // A click before hydration never reaches React (the lesson page streams in first).
    const complete = page.getByRole('button', { name: M.player.complete, exact: true });
    await untilHydrated(complete);
    await complete.click();
    await expect(page.getByTestId('lesson-done')).toHaveText(M.player.done);

    // From the first completed lesson on, /area-membros IS Início (no redirect any more).
    await page.goto(`${tenant.origin}/area-membros`);
    await expect(page).toHaveURL(/\/area-membros$/);
    await expectInicio(page);
    expect(await currentSchoolScreen(page)).toBe(S.home);
    await expect(page.getByTestId('courses-member-home-empty')).toHaveCount(0);
    expect(await homeSections(page)).toEqual(
      expect.arrayContaining(['courses-home-greeting', 'courses-home-hero']),
    );
    // D-437: the server's hero (`retomando`), its CTA at the lesson the member stopped at.
    const resume = page.getByTestId('courses-home-hero-cta');
    await expect(resume).toHaveText(H.hero.cta.resume);
    await expect(resume).toHaveAttribute('href', `/cursos/${course.id}/aulas/${course.lessons[1]}`);
    // TODO(2026-10-26): Início redesign in progress — the resume card's details (its title, the
    // module-left line, the bar and "{percent}% do curso"), "Cursos" and the numbers strip.

    // D-440: the server's streak, one local day.
    await expectStreak(page, 1);
  });

  test('EP-01 / EP-02 (COURSE-28): an empty, unknown or repeated ?aba= renders Início; the old ?aba=cursos|lives|trilhas addresses land on their own pages, keeping only the query each screen reads', async ({
    page,
  }) => {
    // The member completed lesson 1 in the previous case, so Início is drawn (the user's rule).
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

    // 2026-10-22: the old tab addresses redirect to the screen's own page (client-side, after the
    // route's loading.tsx streamed: the URL is the assertion, never the response status).
    await page.goto(`${tenant.origin}/area-membros?aba=cursos`);
    await expect(page).toHaveURL(/\/area-membros\/cursos$/);
    await expect(page.getByTestId('courses-member-courses')).toBeVisible();
    await expectScreen(page, 'cursos');
    expect(await currentSchoolScreen(page)).toBe(S.courses);

    await page.goto(`${tenant.origin}/area-membros?aba=lives`);
    await expect(page).toHaveURL(/\/area-membros\/lives$/);
    await expect(page.getByTestId('courses-member-lives')).toBeVisible();
    await expectScreen(page, 'lives');

    // `categoria` only follows Cursos and `trilha` only follows Trilhas.
    await page.goto(`${tenant.origin}/area-membros?aba=cursos&categoria=abc&trilha=def`);
    await expect(page).toHaveURL(/\/area-membros\/cursos\?categoria=abc$/);
    await page.goto(`${tenant.origin}/area-membros?aba=trilhas&trilha=def&categoria=abc`);
    await expect(page).toHaveURL(/\/area-membros\/trilhas\?trilha=def$/);

    // 08.6-10: Trilhas is registered; this school has no track, so its body is the empty card.
    await page.goto(`${tenant.origin}/area-membros?aba=trilhas`);
    await expect(page).toHaveURL(/\/area-membros\/trilhas$/);
    await expect(page.getByTestId('courses-member-tracks')).toBeVisible();
    await expectScreen(page, 'trilhas');
    await expect(
      page
        .getByTestId('courses-member-tracks-empty')
        .getByRole('heading', { name: M.tracks.empty.title }),
    ).toBeVisible();
    await expect(
      page.getByText(fill(M.tracks.empty.body, { tenant: tenant.displayName })),
    ).toBeVisible();
    expect(await currentSchoolScreen(page)).toBe(S.tracks);
  });

  // TODO(2026-10-26): Início redesign in progress — once it settles, a desktop case for the floating
  // "Continuar assistindo" (`courses-home-continue`): shown while the resume card is out of view
  // (`data-shown`), hidden with the card in view, "Fechar" dismissing it for the session.

  test('D-422 / UI-D-437: the admin’s ?ver=aluno lands on Início (never the catalogue) with the streak at zero, the hero at the first lesson and the member’s menu in preview links, Gerenciar last; ?aba=cursos&ver=aluno is the catalogue page with preview links; 2026-10-23: without the flag the member pages stay the member view in preview too', async ({
    page,
  }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos`);
    await expect(page.getByTestId('courses-hub')).toBeVisible();

    await page.goto(`${tenant.origin}/area-membros?ver=aluno`);
    // The fixture's admin is "Admin Cursos".
    await expectInicio(page, 'Admin');
    await expect(page.getByTestId('courses-hub')).toHaveCount(0);
    // The preview reads zeros (the admin writes no progress): "Sem sequência de estudo".
    await expectStreak(page, 0);
    // 2026-10-22: under /area-membros the manager's menu is the member's "· Membros", every link
    // keeping the preview flag (UI-D-437). 2026-10-23: then "Gerenciar", the way to authoring.
    expect(await schoolScreenLabels(page)).toEqual([...MENU_LABELS, MANAGE_LABEL]);
    await expect(await schoolScreenLink(page, MANAGE_LABEL)).toHaveAttribute(
      'href',
      '/cursos/gerenciar',
    );
    await expect(await schoolScreenLink(page, S.home)).toHaveAttribute(
      'href',
      '/area-membros?ver=aluno',
    );
    await expect(await schoolScreenLink(page, S.courses)).toHaveAttribute(
      'href',
      '/area-membros/cursos?ver=aluno',
    );
    await closeSchoolMenu(page);
    // The preview NEVER sends the manager to the catalogue (2026-10-22: the admin writes no
    // progress, so it is how a new member's start is drawn): the hero starts at the first lesson,
    // "Assistir à primeira aula", the flag kept (D-422).
    const start = page.getByTestId('courses-home-hero-cta');
    await expect(start).toHaveText(H.hero.cta.start);
    await expect(start).toHaveAttribute(
      'href',
      `/cursos/${course.id}/aulas/${course.lessons[0]}?ver=aluno`,
    );
    // TODO(2026-10-26): Início redesign in progress — the "Comece por aqui" card's details (its
    // title, "{course} · Módulo 01 · Aula 01", the lesson's 9:12, no bar at 0%) and the preview
    // flag on the courses row's links.

    await page.goto(`${tenant.origin}/area-membros?aba=cursos&ver=aluno`);
    await expect(page).toHaveURL(/\/area-membros\/cursos\?ver=aluno$/);
    await expect(page.getByTestId('courses-member-courses')).toBeVisible();
    await expectScreen(page, 'cursos');
    // The course card keeps the preview flag (UI-D-437).
    await expect(
      page.getByTestId('courses-member-grid').locator(`a[href="/cursos/${course.id}?ver=aluno"]`),
    ).toHaveCount(1);

    // 2026-10-23: without ?ver=aluno a member page no longer sends the manager to the admin list:
    // it stays the member's view, still a preview (the links keep the flag, nothing is written).
    await page.goto(`${tenant.origin}/area-membros/cursos`);
    await expect(page).toHaveURL(/\/area-membros\/cursos$/);
    await expectScreen(page, 'cursos');
    await expect(
      page.getByTestId('courses-member-grid').locator(`a[href="/cursos/${course.id}?ver=aluno"]`),
    ).toHaveCount(1);
    await expect(page.getByTestId('courses-hub')).toHaveCount(0);
    await page.goto(`${tenant.origin}/area-membros/trilhas`);
    await expect(page).toHaveURL(/\/area-membros\/trilhas$/);
    await expectScreen(page, 'trilhas');
    await expect(page.getByTestId('courses-hub')).toHaveCount(0);
  });

  test('E03 long-text backstop: at 320px a 120-character course and lesson title and a 60-character module name keep the resume card’s CTA whole and on screen', async ({
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
    // A started course (lesson 1 at 30 s): the hero is `retomando`, at lesson 1.
    const first = long.lessons[0] ?? '';
    await sql()`
      insert into public.course_lesson_progress
        (tenant_id, user_id, lesson_id, completed_at, last_position_seconds, updated_at)
      select l.tenant_id, u.id, l.id, null, 30, now()
        from public.course_lessons l, public.users u
       where l.id = ${first}::uuid and u.email = ${longTenant.memberEmail}`;

    // 2026-10-22: layout is measured at rest — under "reduzir movimento" the bar does not grow in.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, longTenant.memberEmail, longTenant.password, longTenant.origin);
    await page.goto(`${longTenant.origin}/area-membros`);
    await expectInicio(page);
    // TODO(2026-10-26): Início redesign in progress — the resume card's long-text details (the
    // eyebrow and the title clamped, the module-left line with the 60-character module name).

    // E02 overflow (2026-10-26: the greeting stands alone; the streak left its row): the greeting
    // stays inside the screen.
    const greetingBox = await boxOf(page.getByRole('heading', { level: 1 }));
    expect(greetingBox.x).toBeGreaterThanOrEqual(0);
    expect(greetingBox.x + greetingBox.width).toBeLessThanOrEqual(320);

    // The CTA: the lesson in progress, whole and inside the viewport, never overflowing its box.
    const cta = page.getByTestId('courses-home-hero-cta');
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toHaveText(H.hero.cta.resume);
    await expect(cta).toHaveAttribute('href', `/cursos/${long.id}/aulas/${first}`);
    const ctaBox = await boxOf(cta);
    expect(ctaBox.x).toBeGreaterThanOrEqual(0);
    expect(ctaBox.x + ctaBox.width).toBeLessThanOrEqual(320);
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

/**
 * 08.6-09 — the rest of Início (D-436, D-438, UI-D-450, UI-D-451, UI-D-454, UI-D-455, COURSE-30,
 * COURSE-31, COURSE-33, COURSE-34), on the phone and on the desktop.
 *
 * Its own throwaway tenant per project (`e2e-mh-<project>`, store on), every row written in
 * `beforeAll`. Catalogue order is newest first, so the minutes back-date the four published courses:
 *
 *  - `paid` (1 min, no category) — linked to an active product the member lacks: LOCKED, no free
 *    lesson, so none of its lessons may ever reach Início's new lessons (T-08.6-13);
 *  - `first` (2 min) and `second` (3 min), both in the short category, 2 lessons each, no video;
 *  - `third` (4 min), 1 lesson, in the 40-character category (the E09 long-text backstop);
 *  - one active track `first → second → paid`;
 *  - `warmup` (10 min, 1 lesson, no category, outside the track), which the member COMPLETES in
 *    `beforeAll`: since 2026-10-22 a member who never started a lesson lands on the catalogue, not
 *    on Início (the user's rule), so the "fresh" Início below is read by a member whose only progress
 *    is that unrelated, older course. Its lesson is older than the "Últimas aulas" four, and it is in
 *    no category.
 *
 * 2026-10-26 (Início rethought on the academy reference; the same server rules, new shapes): the
 * greeting (with the search and "Populares:", the categories with the most courses, in place of the
 * category tiles), the tracks row (`courses-home-track`), "Cursos" (`courses-home-shelf`, quick
 * access to the catalogue), the dashboard (the streak, the resume card `courses-home-hero`, the new
 * lessons `courses-home-new-lessons`) and "Mais da escola" (`courses-home-areas`: Lives and the Loja
 * here). The Início is still being redesigned: these cases pin the blocks present, the hero's CTA,
 * the streak and the server's absences (no locked lesson, no grey, no "Premium"); the cards'
 * details wait (`TODO(2026-10-26)`). The track's own states are the Trilhas cases'.
 *
 * A member with only `warmup` done: the hero is `first` (comecando — the platform's suggestion is
 * the suggested track's next course, the same one) and no lesson of `paid` ever shows. After
 * lessons of `first` and then `second` are completed, `second` is the hero ("Continuar aula").
 */
test.describe('member area: Início sections', () => {
  test.skip(isRemote, 'the member-area fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  const prefix = `e2e-mh-${run}`;
  let tenant: CoursesTenant;
  const ids = { paid: '', first: '', second: '', third: '', warmup: '', short: '', long: '' };
  const titles = {
    paid: `${prefix} Lábios: técnica e segurança`,
    first: `${prefix} Olhar do zero`,
    second: `${prefix} Pele: protocolo`,
    third: `${prefix} Gestão de consultório`,
    warmup: `${prefix} Boas-vindas à escola`,
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
  /** The product that sells `paid` (the member skin's guards open its page). */
  let productId = '';

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

    productId = await createProduct({
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

    // 2026-10-22 (the user's rule): Início is drawn from the member's first lesson on, so the
    // member finishes `warmup`, an older course outside the track, leaving the four above untouched.
    ids.warmup = await createCourse({
      tenantSlug: tenant.slug,
      title: titles.warmup,
      status: 'published',
      modules: 1,
      lessonsPerModule: 1,
      minutesAgo: 10,
    });
    for (const lesson of await lessonsOf(ids.warmup)) {
      await completeLessonAs(tenant.memberEmail, lesson.id);
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

  test('D-436 / D-438 / COURSE-33 / COURSE-34 (2026-10-26): a member who touched none of these courses sees every block with data — the tracks, "Cursos", the dashboard with the start at `first` and the new lessons, "Mais da escola" — a 1-day streak, and never a locked lesson, a grey cover or "Premium"', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros`);
    await expectInicio(page);
    // D-437: the hero starts the platform's suggestion, `first`, at its first lesson.
    const start = page.getByTestId('courses-home-hero-cta');
    await expect(start).toHaveText(H.hero.cta.start);
    await expect(start).toHaveAttribute(
      'href',
      `/cursos/${ids.first}/aulas/${lessons.first[0]?.id}`,
    );
    // UI-D-447: every block with data is drawn; no live in this school, so neither live row.
    expect(await homeSections(page)).toEqual(
      expect.arrayContaining([
        'courses-home-greeting',
        'courses-home-track',
        'courses-home-shelf',
        'courses-home-hero',
        'courses-home-new-lessons',
        'courses-home-areas',
      ]),
    );
    await expect(page.getByTestId('courses-home-next-live')).toHaveCount(0);
    await expect(page.getByTestId('courses-home-live-now')).toHaveCount(0);
    // D-440: `warmup`'s lesson, completed today.
    await expectStreak(page, 1);
    // TODO(2026-10-26): Início redesign in progress — the tracks row's cards ("Sugerido", the first
    // step), "Cursos" (only the open courses, in progress first, "{done}/{N} aulas", "Ver todos"),
    // the new lessons (the four newest open ones, in the server's order) and "Mais da escola".

    // T-08.6-13 / D-421 / PR-5: no locked lesson's title anywhere on Início, no desaturated cover,
    // no "Premium".
    for (const locked of lessons.paid) {
      await expect(home(page).getByText(locked.title)).toHaveCount(0);
    }
    await expect(home(page).locator('[class*="grayscale"]')).toHaveCount(0);
    await expect(page.getByText(/premium/i)).toHaveCount(0);
  });

  test('UI-D-455 (2026-10-26): a "Populares:" chip lands on the catalogue filtered by its category, which the header’s "Filtros" names; the search under the greeting lands on Cursos with the courses it finds, accents and case aside', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros`);
    await expectInicio(page);
    await page
      .getByTestId('courses-home-popular')
      .getByRole('link', { name: titles.short, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/area-membros/cursos\\?categoria=${ids.short}$`));
    await expect(page.getByTestId('courses-member-courses')).toBeVisible();
    await expectScreen(page, 'cursos');
    // The header's "Filtros" button says the category on screen; its menu marks it current.
    const filter = page.getByTestId('courses-member-categories-button');
    await expect(filter).toHaveAccessibleName(
      fill(M.filters.buttonAria, { current: titles.short }),
    );
    await expect(filter).toContainText(M.filters.button);
    await untilHydrated(filter);
    await filter.click();
    await expect(
      page
        .getByTestId('courses-member-categories')
        .getByRole('link', { name: titles.short, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Escape');
    const grid = page.getByTestId('courses-member-grid');
    await expect(grid.locator(`a[href="/cursos/${ids.first}"]`)).toHaveCount(1);
    await expect(grid.locator(`a[href="/cursos/${ids.second}"]`)).toHaveCount(1);
    await expect(grid.locator(`a[href="/cursos/${ids.third}"]`)).toHaveCount(0);
    await expect(grid.locator(`a[href="/cursos/${ids.paid}"]`)).toHaveCount(0);

    // The search (a plain GET to Cursos, `?busca=`): "GESTAO" finds "Gestão de consultório".
    await page.goto(`${tenant.origin}/area-membros`);
    await expectInicio(page);
    const field = page
      .getByTestId('courses-home-search')
      .getByRole('searchbox', { name: M.search.label });
    await field.fill('GESTAO');
    await field.press('Enter');
    await expect(page).toHaveURL(/\/area-membros\/cursos\?busca=GESTAO$/);
    const results = page.getByTestId('courses-member-search-results');
    await expect(results.getByTestId('courses-member-search-count')).toHaveText(
      tm('search.results', { n: 1, q: 'GESTAO' }),
    );
    await expect(results.getByTestId('courses-member-grid').getByRole('link')).toHaveCount(1);
    await expect(results.locator(`a[href="/cursos/${ids.third}"]`)).toHaveCount(1);
    // The header's own field keeps the words searched.
    await expect(
      page.getByTestId('courses-member-search').getByRole('searchbox', { name: M.search.label }),
    ).toHaveValue('GESTAO');
  });

  test('D-436 / D-437: after lessons of two courses are completed, the most recently touched course is the hero, "Continuar aula" at its next lesson', async ({
    page,
  }) => {
    const firstLesson = lessons.first[0]?.id ?? '';
    const secondLesson = lessons.second[0]?.id ?? '';
    await completeLessonAs(tenant.memberEmail, firstLesson);
    await completeLessonAs(tenant.memberEmail, secondLesson);

    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros`);
    await expectInicio(page);
    const resume = page.getByTestId('courses-home-hero-cta');
    await expect(resume).toHaveText(H.hero.cta.resume);
    await expect(resume).toHaveAttribute(
      'href',
      `/cursos/${ids.second}/aulas/${lessons.second[1]?.id}`,
    );
    await expectStreak(page, 1);
    // TODO(2026-10-26): Início redesign in progress — "Cursos" opening with the two courses in
    // progress (D-436), the track card turning "Sua trilha" at 33% (D-438; pinned on Trilhas), the
    // numbers (3 of the school's 8 lessons) and the completed lesson's check in the new lessons.
  });

  test('E09 long-text backstop (2026-10-26, the "Populares:" chips): at 320px a 40-character category name truncates on one line inside its chip, and the chips scroll inside the search panel — the page never sideways', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    // 2026-10-22: measured at rest ("reduzir movimento": nothing grows or rises in).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros`);
    await expectInicio(page);

    const row = page.getByTestId('courses-home-popular');
    const chip = row.getByRole('link', { name: titles.long, exact: true });
    await expect(chip).toHaveAttribute('href', `/area-membros/cursos?categoria=${ids.long}`);
    const name = chip.locator('span');
    await expect(name).toHaveText(titles.long);
    expect(await linesOf(name)).toBe(1);
    expect(await name.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    // The row scrolls inside itself: the page never scrolls sideways.
    expect(await row.evaluate((node) => getComputedStyle(node).overflowX)).toBe('auto');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test('2026-10-26 (the member skin): the member screens, the course page and the shop window wear it once; a sheet host never sits under a transform, a filter or an isolation; "reduzir movimento" stops the glows', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    for (const path of [
      '/area-membros',
      '/area-membros/cursos',
      '/area-membros/trilhas',
      '/area-membros/lives',
      '/area-membros/progresso',
      `/cursos/${ids.paid}`,
      '/loja',
      `/loja/${productId}`,
    ]) {
      await page.goto(`${tenant.origin}${path}`);
      await expect(page.locator('[data-member-skin]'), path).toHaveCount(1);
      await expect(page.getByTestId('member-skin-backdrop'), path).toHaveCount(1);
    }

    // Sheets and dialogs render inside the page: the locked course's buy zone (the product sheet)
    // and the product's buy box (the purchase dialogs) never sit under anything that would trap a
    // fixed overlay below the TopBar.
    await page.goto(`${tenant.origin}/cursos/${ids.paid}`);
    const zone = page.getByTestId('course-locked-zone');
    await expect(zone).toBeVisible();
    expect(await zone.evaluate(trappingAncestors)).toEqual([]);
    await page.goto(`${tenant.origin}/loja/${productId}`);
    const buybox = page.getByTestId('store-product-buybox');
    await expect(buybox).toBeVisible();
    expect(await buybox.evaluate(trappingAncestors)).toEqual([]);

    // "Reduzir movimento": nothing of the skin moves (the fill's own rest is the Trilhas case's).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${tenant.origin}/area-membros/cursos`);
    expect(
      await page.evaluate(() => {
        const blob = document.querySelector('.ms-blob-a');
        const ambient = document.querySelector('.ms-ambient');
        return [
          blob ? getComputedStyle(blob).animationName : 'missing',
          ambient ? getComputedStyle(ambient, '::before').animationName : 'missing',
        ];
      }),
    ).toEqual(['none', 'none']);
  });

  test("2026-10-26 (the member skin): the manager's screens never wear it", async ({ page }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    for (const path of ['/cursos', '/cursos/gerenciar', '/loja/gerenciar']) {
      await page.goto(`${tenant.origin}${path}`);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('[data-member-skin]'), path).toHaveCount(0);
    }
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

/**
 * The member skin (2026-10-26): what, on `element` or an ancestor, would make a `fixed` sheet or
 * dialog rendered inside it lose the page (a transform, a filter, a backdrop filter, an isolation,
 * a will-change or a containment) or take a z-index of its own. One line per offending element.
 */
function trappingAncestors(element: Element): string[] {
  const found: string[] = [];
  for (
    let node: Element | null = element;
    node && node !== document.documentElement;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node);
    const traps = [
      style.transform !== 'none' ? 'transform' : '',
      style.translate !== 'none' ? 'translate' : '',
      style.scale !== 'none' ? 'scale' : '',
      style.filter !== 'none' ? 'filter' : '',
      style.backdropFilter && style.backdropFilter !== 'none' ? 'backdrop-filter' : '',
      style.isolation === 'isolate' ? 'isolation' : '',
      style.willChange !== 'auto' ? 'will-change' : '',
      style.contain !== 'none' ? 'contain' : '',
      style.position !== 'static' && style.zIndex !== 'auto' ? 'z-index' : '',
    ].filter(Boolean);
    if (traps.length > 0) {
      found.push(
        `${node.tagName.toLowerCase()}[${node.getAttribute('data-testid') ?? ''}] ${traps.join(' ')}`,
      );
    }
  }
  return found;
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
/** The courses of a track's page, in path order (2026-10-26: numbered catalogue cards). */
const trackCourses = (page: Page): Locator => page.getByTestId('courses-track-course');
/**
 * A track card's eyebrow, "{Sua trilha|Trilha sugerida|Trilha} · {n} cursos" (2026-10-26: the
 * member's relation to the track rides in the eyebrow; the "Sua trilha" / "Sugerido" pill left).
 */
const trackEyebrow = (kind: 'mine' | 'suggested' | 'other', n: number): string =>
  tm('home.trackEyebrow', { kind, n });

/**
 * 08.6-10 — Trilhas and Meu progresso, and the area complete with its five screens (D-435, D-439,
 * D-440, D-442, D-443, UI-D-446, UI-D-456..UI-D-458, COURSE-28, COURSE-35..38), on the phone and
 * on the desktop. 2026-10-22: the five screens are the "· Membros" menu's pages (no tab row), and
 * "reduzir movimento" stops every animation of the area.
 *
 * 2026-10-26 (Trilhas on the academy reference): two views of the same read. Without `?trilha=` (or
 * with one naming no track) the LIST — the screen's header and "Todas as trilhas", every track a
 * cover card (`member-track-card`), the member's own first; with `?trilha=` naming a track, the
 * track's PAGE — the hero (its title the page's h1, its chips, the CTA to the course to do now), the
 * progress panel and "Cursos da trilha", the path's courses as numbered catalogue cards with the
 * server's state. The timeline ("O caminho") and "Outras trilhas" are gone.
 *
 * Its own throwaway tenant per project (`e2e-mt-<project>`, store on). Four published courses:
 *
 *  - `alpha`, 2 lessons with ready videos of 30 and 60 minutes (the hours line: 1,5 h);
 *  - `beta`, 1 lesson, no video ("1 aula", no duration);
 *  - `paid`, 2 lessons, linked to an active product the member lacks: LOCKED (its card still links
 *    to its buy path);
 *  - `gamma`, 1 lesson, no video.
 *
 * Two active tracks: "Principal" `alpha → beta → paid` (the newest, so the suggested one) and
 * "Avançado" `gamma` (an hour older). The school holds 6 live lessons. The cases run in order: the
 * fresh member first, then lesson 1 of `alpha` completed in the Trilhas case and lesson 2 in the
 * Progresso case. The 320px backstops run last, on the phone only.
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

  test('EP-03 / D-435 (COURSE-28): the "· Membros" menu lists Início, Cursos, Trilhas, Lives, Progresso in that order and each screen opens its own page and body — Início leads this member, who never started a lesson, to the catalogue', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros`);
    // 2026-10-22 (the user's rule): no lesson started yet → the catalogue, not Início. The cases
    // below keep this member fresh until the Trilhas case completes a lesson.
    await expect(page).toHaveURL(/\/area-membros\/cursos$/);
    await expectScreen(page, 'cursos');
    expect(await schoolScreenLabels(page)).toEqual(MENU_LABELS);
    await expect(await schoolScreenLink(page, S.tracks)).toHaveAttribute(
      'href',
      '/area-membros/trilhas',
    );
    await expect(await schoolScreenLink(page, S.progress)).toHaveAttribute(
      'href',
      '/area-membros/progresso',
    );
    await closeSchoolMenu(page);

    const bodies = [
      'courses-member-courses',
      'courses-member-tracks',
      'courses-member-lives',
      'courses-member-progress',
      'courses-member-home',
    ];
    const screens: [label: string, url: RegExp, testId: string][] = [
      [S.tracks, /\/area-membros\/trilhas$/, 'courses-member-tracks'],
      [S.lives, /\/area-membros\/lives$/, 'courses-member-lives'],
      [S.progress, /\/area-membros\/progresso$/, 'courses-member-progress'],
      // Início, from Progresso: for this member it is the catalogue (the URL moves to /cursos).
      [S.home, /\/area-membros\/cursos$/, 'courses-member-courses'],
    ];
    for (const [label, url, testId] of screens) {
      await goToSchoolScreen(page, label, { url });
      await expect(page.getByTestId(testId)).toBeVisible();
      expect(await currentSchoolScreen(page)).toBe(label === S.home ? S.courses : label);
      for (const other of bodies) {
        if (other !== testId) await expect(page.getByTestId(other)).toHaveCount(0);
      }
    }
  });

  test('D-442 / UI-D-457 (E11 empty): a fresh member sees the ring at 0% and "Seu progresso começa na primeira aula" with "Começar agora" — no numbers, no rows, no certificates', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros/progresso`);
    await expect(progressBody(page)).toBeVisible();
    await expectScreen(page, 'progresso');
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

  test('D-439 / D-438 (COURSE-35; 2026-10-26, a list and a page per track): the list leads with the suggested track; its page says each course’s state on a numbered card, a locked one still linking to its buy path; an unknown ?trilha= is the list; once started the track is "Sua trilha" with its share', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros/trilhas`);
    await expect(tracksBody(page)).toBeVisible();
    await expectScreen(page, 'trilhas');
    expect(await currentSchoolScreen(page)).toBe(S.tracks);

    // The list ("Todas as trilhas"): the member's own track first — "Trilha sugerida" while
    // nothing is started, the first step named, no share — then the other one, not started.
    await expect(tracksBody(page)).toHaveAttribute('data-view', 'list');
    const list = page.getByTestId('courses-track-list');
    await expect(
      list.getByRole('heading', { level: 2, name: M.tracks.list.title, exact: true }),
    ).toBeVisible();
    const cards = list.getByTestId('member-track-card');
    await expect(cards.getByTestId('member-track-card-title')).toHaveText([
      titles.principal,
      titles.advanced,
    ]);
    const principal = cards.nth(0);
    await expect(principal).toHaveAttribute(
      'href',
      `/area-membros/trilhas?trilha=${ids.principal}`,
    );
    await expect(principal).toContainText(trackEyebrow('suggested', 3));
    // Where the member stands: the card's line (drawn on hover from `lg`) and its accessible name.
    const suggestedLine = tm('home.track.suggestedLine', { total: 3, course: titles.alpha });
    await expect(principal.getByTestId('member-track-card-line')).toHaveText(suggestedLine);
    await expect(principal).toHaveAttribute(
      'aria-label',
      fill(H.shelf.aria, { course: titles.principal, state: suggestedLine }),
    );
    await expect(principal.getByTestId('member-track-card-percent')).toHaveCount(0);
    await expect(list.locator('li[data-featured]')).toHaveCount(1);
    const advanced = cards.nth(1);
    await expect(advanced).toHaveAttribute('href', `/area-membros/trilhas?trilha=${ids.advanced}`);
    await expect(advanced).toContainText(trackEyebrow('other', 1));
    await expect(advanced.getByTestId('member-track-card-line')).toHaveText(
      M.tracks.others.notStarted,
    );
    await expect(page.getByText(/premium/i)).toHaveCount(0);

    // A card opens the track's page: the hero (its title the page's one h1), the chips, the CTA to
    // the course to do now; the way back to the list.
    await principal.click();
    await expect(page).toHaveURL(new RegExp(`/area-membros/trilhas\\?trilha=${ids.principal}$`));
    await expect(tracksBody(page)).toHaveAttribute('data-view', 'track');
    await expect(tracksBody(page)).toHaveAttribute('data-track', ids.principal);
    await expect(frame(page)).toHaveAttribute('data-screen', 'trilhas');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText([titles.principal]);
    await expect(page.getByTestId('courses-track-hero-title')).toHaveText(titles.principal);
    await expect(page.getByTestId('courses-track-hero-pill')).toHaveText(M.tracks.suggested);
    await expect(trackHero(page)).toContainText(fill(M.tracks.step, { n: '1', total: '3' }));
    const chips = page.getByTestId('courses-track-hero-chips');
    await expect(chips).toContainText(tm('tracks.detail.courses', { n: 3 }));
    await expect(chips).toContainText(tm('tracks.detail.lessons', { N: 5 }));
    await expect(chips).toContainText('1 h 30 min');
    const cta = page.getByTestId('courses-track-hero-cta');
    await expect(cta).toHaveAttribute('data-cta', 'start');
    await expect(cta).toHaveText(M.tracks.cta.start);
    await expect(cta).toHaveAttribute('href', `/cursos/${alpha.id}`);
    // The way back to the list, in the hero on every screen.
    const back = page.getByTestId('courses-track-back');
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute('href', '/area-membros/trilhas');
    await expect(back).toHaveText(M.tracks.detail.back);

    // The progress panel: no course complete, the bar at 0%, the helper.
    const progress = page.getByTestId('courses-track-progress');
    await expect(progress).toContainText(tm('tracks.detail.progress', { done: 0, total: 3 }));
    await expect(
      progress.getByRole('progressbar', { name: fill(M.progress.aria, { percent: '0' }) }),
    ).toHaveAttribute('aria-valuenow', '0');
    await expect(progress).toContainText(M.tracks.detail.helper);

    // "Cursos da trilha": one numbered card per published course, in path order, each the
    // server's state (A-UI-11) and the step's only link; the course to do now is outlined.
    const section = page.getByTestId('courses-track-courses');
    await expect(
      section.getByRole('heading', { level: 2, name: M.tracks.detail.coursesTitle, exact: true }),
    ).toBeVisible();
    const steps = trackCourses(page);
    await expect(steps).toHaveCount(3);
    expect(
      await steps.evaluateAll((items) => items.map((item) => item.getAttribute('data-state'))),
    ).toEqual(['a_seguir', 'a_seguir', 'bloqueada']);
    await expect(steps.nth(0)).toHaveAttribute('data-current', 'true');
    await expect(section.locator('[data-current]')).toHaveCount(1);
    const card = (index: number) => steps.nth(index).getByTestId('courses-track-course-card');
    for (let index = 0; index < 3; index += 1) {
      await expect(steps.nth(index).getByRole('link')).toHaveCount(1);
      await expect(card(index).getByTestId('course-card-tags')).toHaveText(`0${index + 1}`);
    }
    await expect(card(0)).toHaveAttribute('href', `/cursos/${alpha.id}`);
    await expect(card(0)).toHaveAttribute(
      'aria-label',
      tm('tracks.path.stepAria', { nn: '01', course: titles.alpha, state: 'a_seguir' }),
    );
    await expect(card(0).getByTestId('course-card-meta')).toHaveText(
      tm('tracks.detail.cardLine', { done: 0, N: 2 }),
    );
    await expect(card(0).getByTestId('course-card-duration')).toHaveText('1 h 30 min');
    await expect(card(1).getByTestId('course-card-meta')).toHaveText(
      tm('tracks.detail.cardLine', { done: 0, N: 1 }),
    );
    await expect(card(1).getByTestId('course-card-duration')).toHaveCount(0);
    // The locked course: the padlock disc over its colour, still a link to its buy path (D-421).
    await expect(card(2)).toHaveAttribute('data-locked', 'true');
    await expect(card(2).getByTestId('course-card-lock')).toBeVisible();
    await expect(card(2)).toHaveAttribute('href', `/cursos/${ids.paid}`);
    await expect(card(2)).toHaveAttribute(
      'aria-label',
      tm('tracks.path.stepAria', { nn: '03', course: titles.paid, state: 'bloqueada' }),
    );
    await expect(page.getByText(/premium/i)).toHaveCount(0);

    // The other track's page: no pill, its own first course.
    await page.goto(`${tenant.origin}/area-membros/trilhas?trilha=${ids.advanced}`);
    await expect(page.getByTestId('courses-track-hero-title')).toHaveText(titles.advanced);
    await expect(page.getByTestId('courses-track-hero-pill')).toHaveCount(0);
    await expect(page.getByTestId('courses-track-hero-cta')).toHaveAttribute(
      'href',
      `/cursos/${ids.gamma}`,
    );

    // An unknown ?trilha= is the list (T-08.6-20: never used to build a link or a request).
    await page.goto(`${tenant.origin}/area-membros/trilhas?trilha=xyz`);
    await expect(tracksBody(page)).toHaveAttribute('data-view', 'list');
    await expectScreen(page, 'trilhas');

    // The locked course's card lands on the course page's buy section (D-421, D-424).
    await page.goto(`${tenant.origin}/area-membros/trilhas?trilha=${ids.principal}`);
    await trackCourses(page).nth(2).getByTestId('courses-track-course-card').click();
    await expect(page).toHaveURL(new RegExp(`/cursos/${ids.paid}$`));
    await expect(page.getByRole('link', { name: M.locked.buy, exact: true })).toBeVisible();

    // Started: one lesson of the first course completed.
    await completeLessonAs(tenant.memberEmail, alpha.lessons[0] ?? '');
    await page.goto(`${tenant.origin}/area-membros/trilhas`);
    // The list: "Sua trilha", where the member stands and the lesson-weighted share (1 of 5: 20%).
    const mine = page.getByTestId('member-track-card').first();
    await expect(mine.getByTestId('member-track-card-title')).toHaveText(titles.principal);
    await expect(mine).toContainText(trackEyebrow('mine', 3));
    const progressLine = tm('home.track.progress', { percent: 20, course: titles.alpha });
    await expect(mine.getByTestId('member-track-card-line')).toHaveText(progressLine);
    await expect(mine).toHaveAttribute(
      'aria-label',
      fill(H.shelf.aria, { course: titles.principal, state: progressLine }),
    );
    await expect(mine.getByTestId('member-track-card-percent')).toHaveText('20%');

    // Its page: "Continuar trilha" to the course in progress, the panel at 20% (no course complete
    // yet), and the first course in progress at 50% on its card.
    await page.goto(`${tenant.origin}/area-membros/trilhas?trilha=${ids.principal}`);
    await expect(page.getByTestId('courses-track-hero-pill')).toHaveText(M.tracks.mine);
    const resume = page.getByTestId('courses-track-hero-cta');
    await expect(resume).toHaveAttribute('data-cta', 'continue');
    await expect(resume).toHaveText(M.tracks.cta.continue);
    await expect(resume).toHaveAttribute('href', `/cursos/${alpha.id}`);
    const panel = page.getByTestId('courses-track-progress');
    await expect(
      panel.getByRole('progressbar', { name: fill(M.progress.aria, { percent: '20' }) }),
    ).toBeVisible();
    await expect(panel).toContainText(tm('tracks.detail.progress', { done: 0, total: 3 }));
    const first = trackCourses(page).nth(0);
    await expect(first).toHaveAttribute('data-state', 'em_andamento');
    await expect(first).toHaveAttribute('data-current', 'true');
    const firstCard = first.getByTestId('courses-track-course-card');
    await expect(firstCard.getByTestId('course-card-percent')).toHaveText('50%');
    await expect(
      firstCard.getByRole('progressbar', { name: fill(M.progress.aria, { percent: '50' }) }),
    ).toHaveCount(1);
    await expect(firstCard.getByTestId('course-card-meta')).toHaveText(
      tm('tracks.detail.cardLine', { done: 1, N: 2 }),
    );
    await expect(firstCard).toHaveAttribute(
      'aria-label',
      tm('tracks.path.stepAria', { nn: '01', course: titles.alpha, state: 'em_andamento' }),
    );
  });

  test('2026-10-26 (the motion): on a track’s page the bars fill in, the body swaps in and the course cards rise into place; under "reduzir movimento" nothing animates, every value at rest', async ({
    page,
  }) => {
    // The state the previous case left: lesson 1 of `alpha` done (the path at 20%, alpha at 50%).
    const animationOf = (locator: Locator) =>
      locator.evaluate((node) => getComputedStyle(node).animationName);
    const panelFill = (page: Page) =>
      page.getByTestId('courses-track-progress').getByTestId('progress-bar-fill');
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros/trilhas?trilha=${ids.principal}`);
    await expect(trackCourses(page).nth(0)).toHaveAttribute('data-state', 'em_andamento');
    expect(await animationOf(panelFill(page))).toBe('progress-fill');
    expect(await animationOf(tracksBody(page))).toBe('swap-in');
    // The member skin's rise: each card a beat after the one before (`ms-rise`).
    expect(await animationOf(trackCourses(page).nth(1))).toBe('ms-rise');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await expect(trackCourses(page).nth(0)).toHaveAttribute('data-state', 'em_andamento');
    expect(await animationOf(panelFill(page))).toBe('none');
    expect(await animationOf(tracksBody(page))).toBe('none');
    expect(await animationOf(trackCourses(page).nth(1))).toBe('none');
    // At rest, the bar still says its value: 20% of the path's live lessons.
    await expect(
      page
        .getByTestId('courses-track-progress')
        .getByRole('progressbar', { name: fill(M.progress.aria, { percent: '20' }) }),
    ).toBeVisible();
  });

  test('D-440 / D-442 / D-443 (COURSE-36..38): after two completions the ring, the four numbers and the course row are the server’s', async ({
    page,
  }) => {
    await completeLessonAs(tenant.memberEmail, alpha.lessons[1] ?? '');
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros/progresso`);
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

  test('E01 / E10 / E11 backstops at 320px: the "· Membros" menu lists the five screens whole inside the screen with Progresso current; a long track title wraps whole in its page’s hero and a long course title clamps in its numbered card; every number stays on one line', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstops are phone checks');
    // 2026-10-22: measured at rest ("reduzir movimento": no bar grows in, no list rises in).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);

    // E01 overflow (2026-10-22, the area menu replaced the tab row): at 320px the TopBar keeps the
    // tenant, "· Membros" and the 44px menu button; the open panel sits inside the screen, every
    // screen's label whole, Progresso marked current.
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`${tenant.origin}/area-membros/progresso`);
    await expect(progressBody(page)).toBeVisible();
    await expect(schoolAreaLabel(page)).toBeVisible();
    const menuButton = page.getByRole('button', { name: M.area.menu, exact: true });
    const buttonBox = await boxOf(menuButton);
    expect(buttonBox.width).toBeGreaterThanOrEqual(44);
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(320);
    const list = await schoolScreenList(page);
    const links = list.getByRole('link');
    await expect(links).toHaveText(MENU_LABELS);
    const panelBox = await boxOf(page.locator('[data-area-menu-panel]'));
    expect(panelBox.x).toBeGreaterThanOrEqual(0);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(320);
    for (let index = 0; index < MENU_LABELS.length; index += 1) {
      const link = links.nth(index);
      expect(await link.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      expect((await boxOf(link)).height).toBeGreaterThanOrEqual(44);
    }
    await expect(list.locator('a[aria-current="page"]')).toHaveText(S.progress);
    await closeSchoolMenu(page);

    // E11 overflow: each StatBlock value on one line inside its cell; the labels (2026-10-26: a
    // small uppercase overline) clamp to two lines at most.
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
      const label = block.getByTestId('stat-block-label');
      expect(
        await label.evaluate((node) =>
          getComputedStyle(node).getPropertyValue('-webkit-line-clamp'),
        ),
      ).toBe('2');
      expect(await linesOf(label)).toBeLessThanOrEqual(2);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    // E10 long-text: a 120-character track title and a 120-character course title in its path.
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
    await page.goto(`${tenant.origin}/area-membros/trilhas?trilha=${longTrack}`);
    // Visible first: the streamed body sits in a hidden boundary until React swaps it in.
    const heroTitle = page.getByTestId('courses-track-hero-title');
    await expect(heroTitle).toBeVisible();
    await expect(heroTitle).toHaveText(trackTitle);
    // 2026-10-26: the track's page title is the hero's h1: it wraps whole (never cut) and the hero
    // grows to hold it, inside the screen.
    expect(await linesOf(heroTitle)).toBeGreaterThanOrEqual(2);
    expect(await heroTitle.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(
      true,
    );
    const heroBox = await boxOf(trackHero(page));
    const titleBox = await boxOf(heroTitle);
    expect(titleBox.y).toBeGreaterThanOrEqual(heroBox.y - 0.5);
    expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(heroBox.y + heroBox.height + 0.5);
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(320 + 0.5);

    // The long course's numbered card: the title clamps to two lines; the "01" chip and the meta
    // stay inside the card, the card inside the screen.
    const card = trackCourses(page).nth(0).getByTestId('courses-track-course-card');
    await card.scrollIntoViewIfNeeded();
    const cardTitle = card.getByTestId('course-card-title');
    await expect(cardTitle).toHaveText(courseTitle);
    expect(await linesOf(cardTitle)).toBe(2);
    expect(await cardTitle.evaluate((node) => node.scrollHeight > node.clientHeight + 1)).toBe(
      true,
    );
    const cardBox = await boxOf(card);
    expect(cardBox.x).toBeGreaterThanOrEqual(0);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(320);
    for (const part of [
      card.getByTestId('course-card-tags'),
      card.getByTestId('course-card-meta'),
    ]) {
      const box = await boxOf(part);
      expect(box.x).toBeGreaterThanOrEqual(cardBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);
      expect(box.y + box.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 0.5);
    }
    await expect(card.getByTestId('course-card-tags')).toHaveText('01');
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
 * member's toggle on Início and on the live page, the admin's preview (the banner first in the
 * frame, before the body, the disabled toggle, no write), a product-linked live one day ahead (the
 * nearest: the buy path), a live happening now (the outlined row with the red "Ao vivo" chip), the
 * two 320px backstops, and last the member turned `support_tenant` (no banner, a working toggle) once
 * the locked and live-now lives are gone. `afterAll` drops the reminder jobs the opt-ins armed, then
 * the tenant. 2026-10-22: the member has finished the course's only lesson in `beforeAll` (Início is
 * drawn from the first lesson on; a member who never started one lands on the catalogue).
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
    const seeded = await seedCourse(tenant, {
      title: `${prefix} Olhar do zero`,
      moduleTitle: 'Técnica',
      status: 'published',
      lessons: [{ title: `${prefix} Anatomia`, seconds: 552 }],
    });
    // 2026-10-22 (the user's rule): a member who never started a lesson lands on the catalogue, not
    // on Início, so the member finishes the course's only lesson — the hero reads "Você está em dia"
    // and the live slots these cases read stay exactly the overview's.
    await completeLessonAs(tenant.memberEmail, seeded.lessons[0] ?? '');
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

  test("D-422 / UI-D-459 (COURSE-50, EP-68, EP-69): the admin's preview (2026-10-23: with or without ?ver=aluno) has NO banner, the body first in the frame, the toggle disabled with its hint, and a tap sends no write — on Início and on the live page", async ({
    page,
  }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    // 2026-10-23: the manager browses the member area as a member sees it, in preview, whether the
    // URL says ?ver=aluno or not (the tab "Membros" opens it bare): the same disabled toggle.
    await page.goto(`${tenant.origin}/area-membros`);
    await expectInicio(page);
    await expect(toggle(page)).toBeDisabled();
    await expect(page.getByTestId('reminder-helper')).toHaveText(R.previewHint);

    await page.goto(`${tenant.origin}/area-membros?ver=aluno`);
    await expectInicio(page);

    // EP-69 (2026-10-23: the banner is gone, the way back is the menu's Gerenciar): the frame's
    // FIRST child holds the body.
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    await expect(home(page)).toBeVisible();
    expect(
      await frame(page).evaluate(
        (root) =>
          root.firstElementChild?.querySelector('[data-testid="courses-member-home"]') != null,
      ),
    ).toBe(true);

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

  test('UI-D-452 (COURSE-32): a live happening now is the "Ao vivo agora" row near the top of Início (2026-10-26: right under the greeting) — the red chip with its breathing dot, no join link, no toggle, no "Próxima live"', async ({
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
    // 2026-10-22: the prototype's red "Ao vivo" chip, its white dot breathing (CSS motion).
    await expect(row.getByTestId('live-status-dot')).toHaveClass(/animate-live-dot/);
    await expect(page.getByTestId('courses-home-live-now-title')).toHaveText(titles.now);
    await expect(page.getByTestId('courses-home-live-now-meta')).toHaveText(
      fill(HL.startedAt, { time, duration: '60' }),
    );
    await expect(nextLive(page)).toHaveCount(0);
    await expect(toggle(page)).toHaveCount(0);
    await expect(home(page).locator('a[href^="http"]')).toHaveCount(0);
    await expect(page.getByTestId('live-join')).toHaveCount(0);

    // 2026-10-26 (the rethought Início): the row comes after the greeting.
    // TODO(2026-10-26): Início redesign in progress — pin its exact slot once the blocks settle.
    expect(await precedes(page.getByTestId('courses-home-greeting'), row)).toBe(true);
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

    // 2026-10-22: measured at rest ("reduzir movimento").
    await page.emulateMedia({ reducedMotion: 'reduce' });
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

  test('E14 long-text backstop: with ?ver=aluno at 320px nothing overflows the width and the resume CTA is reachable', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    // 2026-10-22: measured at rest ("reduzir movimento"); the tab row is gone (the area menu is in
    // the TopBar). 2026-10-23: no preview banner either, the greeting sits right under the bar.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 320, height: 640 });
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros?ver=aluno`);
    await expectInicio(page);
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    // 2026-10-26 (the academy reference's Início, the product owner's "mais fiel"): "Continue de onde
    // parou" lives in the dashboard panel, under the tracks and the courses, so the old "within two
    // screen heights" rule no longer holds; the CTA must still be there, whole, once scrolled to.
    const cta = page.getByTestId('courses-home-hero-cta');
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toBeVisible();
    const box = await cta.boundingBox();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
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
 * 2026-10-22 — the platform's suggestion on Início (the user's rule, `lib/courses-home-plan.ts`):
 * with nothing in progress but something finished, the hero is no longer the newest course nobody
 * started (the API's `comecando`) but the next course at the member's level, published FIRST in that
 * level. Its own throwaway tenant per project (`e2e-mv-<project>`): four published open courses with
 * one lesson each, the level written straight to the row, back-dated so the catalogue's newest-first
 * order is known:
 *
 *  - `newest` (iniciante, 1 min) — the newest course nobody started: the API's own pick;
 *  - `inter` (intermediário, 2 min);
 *  - `done` (iniciante, 3 min) — the member completes its lesson, so their level is iniciante;
 *  - `first` (iniciante, 4 min) — the iniciante course published first: the suggestion.
 *
 * 2026-10-26: "Meus cursos" (the overview's shelf, where the displaced `newest` came back) left
 * Início; its "Cursos" row reads the catalogue, and the Início is still being redesigned, so only
 * the hero's start is pinned here (`TODO(2026-10-26)`).
 */
test.describe('member area: the suggestion by level', () => {
  test.skip(isRemote, 'the member-area fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  const prefix = `e2e-mv-${run}`;
  let tenant: CoursesTenant;
  const ids = { newest: '', inter: '', done: '', first: '' };
  const titles = {
    newest: `${prefix} Toxina: primeiros pontos`,
    inter: `${prefix} Preenchimento labial`,
    done: `${prefix} Anatomia essencial`,
    first: `${prefix} Olhar do zero`,
  };

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    tenant = await createCoursesTenant(`e2e-mv-${testInfo.project.name}`, SEED_PASSWORD);
    const course = async (
      key: keyof typeof ids,
      minutesAgo: number,
      level: 'iniciante' | 'intermediario',
    ) => {
      ids[key] = await createCourse({
        tenantSlug: tenant.slug,
        title: titles[key],
        status: 'published',
        modules: 1,
        lessonsPerModule: 1,
        minutesAgo,
      });
      await sql()`update public.courses set level = ${level} where id = ${ids[key]}::uuid`;
    };
    await course('newest', 1, 'iniciante');
    await course('inter', 2, 'intermediario');
    await course('done', 3, 'iniciante');
    await course('first', 4, 'iniciante');
    for (const lesson of await lessonsOf(ids.done)) {
      await completeLessonAs(tenant.memberEmail, lesson.id);
    }
  });

  test.afterAll(async () => {
    if (tenant) await deleteCoursesTenant(tenant.slug);
    await client?.end();
    client = null;
    await closeCoursesMember();
    await closeCoursesAdmin();
  });

  test('2026-10-22 (the platform’s suggestion): after finishing an iniciante course, Início suggests the OTHER iniciante course published first — not the newest one', async ({
    page,
  }) => {
    const [lesson] = await lessonsOf(ids.first);
    if (!lesson) throw new Error('no lesson on the suggested course');
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/area-membros`);
    // One lesson completed: Início is drawn (no redirect to the catalogue).
    await expect(page).toHaveURL(/\/area-membros$/);
    await expectInicio(page);

    // The hero starts `first` at its first lesson — never `newest`.
    const cta = page.getByTestId('courses-home-hero-cta');
    await expect(cta).toHaveText(H.hero.cta.start);
    await expect(cta).toHaveAttribute('href', `/cursos/${ids.first}/aulas/${lesson.id}`);
    // TODO(2026-10-26): Início redesign in progress — the start card's details ("{course} · Módulo
    // 01 · Aula 01", the lesson's title) and where the displaced `newest` shows in "Cursos".
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
