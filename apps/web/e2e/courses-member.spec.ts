import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { createTranslator } from 'next-intl';
import coursesMessages from '../messages/pt-BR/courses.json' with { type: 'json' };
import memberMessages from '../messages/pt-BR/courses.member.json' with { type: 'json' };
import storeCoursesMessages from '../messages/pt-BR/store.courses.json' with { type: 'json' };
import storeMessages from '../messages/pt-BR/store.json' with { type: 'json' };
import { SUPPORT_EMAIL } from './chat-admin';
import { closeCoursesAdmin, createCourse } from './courses-admin';
import {
  type CoursePageFixture,
  closeCoursesMember,
  completeLessonAs,
  coursePageFixture,
  deleteMemberCatalogueFixture,
  deletePlayerStorage,
  type LivePageFixture,
  lessonProgressOf,
  livePageFixture,
  type MemberCatalogueFixture,
  memberCatalogueFixture,
  type PlayerFixture,
  playerFixture,
} from './courses-member';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import { untilHydrated } from './hydration';
import {
  closeSchoolMenu,
  currentSchoolScreen,
  hasDesktopRail,
  schoolScreenLabels,
  schoolScreenLink,
} from './school-area';
import { closeStoreAdmin } from './store-admin';

/** The catalog is the source of copy (UI-SPEC Copywriting Contract), never a literal in a spec. */
const C = coursesMessages.courses;
const M = memberMessages.courses.member;
/** The ICU `select` sentences (card and live names, the free-lesson meta) go through next-intl. */
const tm = createTranslator({
  locale: 'pt-BR',
  messages: memberMessages,
  namespace: 'courses.member',
});
/** The store's locked-course words (`store.courses.json`) and the shipped sheet title (`store.json`). */
const S = storeCoursesMessages.store.locked;
const SHEET_TITLE = storeMessages.store.locked.choice.title;

/** ICU `{name}` placeholders filled the way next-intl does for the plain arguments these use. */
function fill(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}

/** A literal text as the end of an accessible name. */
function endsWith(text: string): RegExp {
  return new RegExp(`${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

/** The exclusive suffix of a live card's name, read from the catalog's `select` branch. */
function liveExclusiveSuffix(): string {
  const base = { live: 'x', status: 'x', date: 'x' };
  const plain = tm('lives.aria', { ...base, exclusive: 'false' });
  return tm('lives.aria', { ...base, exclusive: 'true' }).slice(plain.length);
}

/** A literal title as the start of an accessible name. */
function startsWith(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

/** A course card by its title (the card's name starts with it, UI-D-426). */
const courseCard = (page: Page, title: string): Locator =>
  page.getByTestId('courses-member-grid').getByRole('link', { name: startsWith(title) });

/** A live card by its title (the card's name starts with it, UI-D-434). */
const liveCard = (scope: Locator, title: string): Locator =>
  scope.getByRole('link', { name: startsWith(title) });

/**
 * 2026-10-26 — the catalogue's categories are the header's "Filtros" menu (`FilterMenu`), no longer
 * a row of chips: opens it (once hydrated) and returns its panel, named "Filtrar por categoria".
 */
async function openCategories(page: Page): Promise<Locator> {
  const button = page.getByTestId('courses-member-categories-button');
  await untilHydrated(button);
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  const panel = page.getByRole('navigation', { name: M.catalogue.categories.label, exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

/** The kernel's generic not-found: no school surface at all, Next's 404 heading. */
async function expectKernelNotFound(page: Page): Promise<void> {
  await expect(page.getByTestId('courses-member-catalogue')).toHaveCount(0);
  await expect(page.getByTestId('courses-hub')).toHaveCount(0);
  await expect(page.getByTestId('courses-not-found')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
}

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('the element has no box');
  return box;
}

/** How many lines a text node paints (its box height over its computed line height). */
async function linesOf(locator: Locator): Promise<number> {
  return locator.evaluate((node) => {
    const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
    return Math.round(node.getBoundingClientRect().height / lineHeight);
  });
}

/**
 * Whether the element and every element inside it show all of their content (nothing clipped behind
 * an ellipsis): 2026-10-22, the compact glass chips truncate in an INNER span, so the outer box alone
 * would read "fits" while the words inside it were cut.
 */
async function showsAll(locator: Locator): Promise<boolean> {
  return locator.evaluate((node) =>
    [node, ...Array.from(node.querySelectorAll('*'))].every(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  );
}

/** The member's five screens, in the area menu's order (2026-10-22). */
const MEMBER_SCREEN_LABELS = [
  M.area.screens.home,
  M.area.screens.courses,
  M.area.screens.tracks,
  M.area.screens.lives,
  M.area.screens.progress,
];

/**
 * 08.5-06 — the member's door into the school (D-419, D-420, D-421, D-430, D-431, UI-D-424..426,
 * UI-D-434, COURSE-16, COURSE-17, COURSE-23), on the phone and on the desktop.
 *
 * The catalogue fixture lives on rede-demo (the seed's school is on and empty) under a per-project
 * run prefix: every assertion is scoped to the fixture's own titles, so a sibling project's rows on
 * the same tenant never change what a case reads. The school-off control is rede-lab, whose seed
 * keeps `courses` off.
 *
 * `serviceWorkers: 'block'`: a worker answering navigations from its cache would have these
 * assertions read what a previous run left behind (the 03-05 lesson).
 *
 * 2026-10-22 (the courses area redesign on the social-igoralves prototype): each screen of the member
 * area is a page of its own — `/area-membros` (Início), `/area-membros/cursos`, `/area-membros/
 * trilhas`, `/area-membros/lives`, `/area-membros/progresso` — reached from the shell's area menu
 * ("· Membros", `school-area.ts`) instead of the tabs under the title; the old `?aba=` addresses
 * redirect to them. The poster is the prototype's (the padlock disc in the centre on a locked
 * course, the colour kept), the Lives screen puts its first upcoming live in the spotlight and the
 * rest in the agenda, and a cancelled card says so with `data-cancelled`.
 *
 * 2026-10-26 (the academy reference): the course card is a panel — the 16:9 cover on top with the
 * tags, the share and the padlock, the title and "{done}/{N} aulas" UNDER it, the 2px band (the
 * member skin's) at the cover's foot; the Cursos screen draws its own header with the search
 * (`?busca=`, front only) and the "Filtros" menu of categories; "Gravadas" are cards of the same
 * language (`LiveCard` `card`).
 */
test.use({ serviceWorkers: 'block' });
test.describe.configure({ timeout: 120_000 });

test.describe('catalogue', () => {
  test.skip(isRemote, 'the member fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  let prefix = '';
  let fx: MemberCatalogueFixture;

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    prefix = `e2e-cm-${testInfo.project.name}-${run}`;
    fx = await memberCatalogueFixture(prefix);
  });

  test.afterAll(async () => {
    if (prefix) await deleteMemberCatalogueFixture(prefix);
    await closeCoursesMember();
    await closeCoursesAdmin();
    await closeStoreAdmin();
  });

  test('D-419 / D-420 / UI-D-424 / D-421: the member opens the Cursos screen (/area-membros/cursos, 2026-10-22) — the frame, the area menu, no admin control; the locked course with "Exclusivo" and the padlock, the open one, never the draft', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    // 2026-10-22: the Cursos screen is a page of its own (the bare area is Início; ?aba=cursos redirects here).
    await page.goto(`${hosts.demo}/area-membros/cursos`);

    const catalogue = page.getByTestId('courses-member-catalogue');
    await expect(catalogue).toBeVisible();
    await expect(catalogue).toHaveAttribute('data-screen', 'cursos');
    await expect(catalogue.getByTestId('courses-member-courses')).toBeVisible();
    await expect(catalogue.getByTestId('courses-member-home')).toHaveCount(0);
    await expect(page.getByTestId('courses-hub')).toHaveCount(0);
    await expect(
      catalogue.getByRole('heading', { level: 1, name: M.catalogue.title }),
    ).toBeVisible();
    await expect(
      catalogue.getByText(fill(M.screens.courses.meta, { tenant: 'Rede Demo' })),
    ).toBeVisible();
    // 2026-10-26: the screen's own header — the eyebrow over the h1, the search (a plain GET to this
    // screen, `?busca=`) and the "Filtros" menu of categories.
    await expect(page.getByTestId('courses-member-header-eyebrow')).toHaveText(
      M.screens.courses.eyebrow,
    );
    const search = page.getByTestId('courses-member-search');
    await expect(search).toHaveAttribute('action', '/area-membros/cursos');
    await expect(search.getByRole('searchbox', { name: M.search.label })).toBeVisible();
    await expect(page.getByTestId('courses-member-categories-button')).toHaveAccessibleName(
      fill(M.filters.buttonAria, { current: M.catalogue.categories.all }),
    );

    // 2026-10-22: no tabs under the title any more — the shell's area menu ("· Membros") lists the
    // member's five screens, Início · Cursos (current) · Trilhas · Lives · Progresso, each its own page.
    await expect(catalogue.getByRole('tablist')).toHaveCount(0);
    expect(await schoolScreenLabels(page)).toEqual(MEMBER_SCREEN_LABELS);
    expect(await currentSchoolScreen(page)).toBe(M.area.screens.courses);
    await expect(await schoolScreenLink(page, M.area.screens.courses)).toHaveAttribute(
      'href',
      '/area-membros/cursos',
    );
    await expect(await schoolScreenLink(page, M.area.screens.home)).toHaveAttribute(
      'href',
      '/area-membros',
    );
    await expect(await schoolScreenLink(page, M.area.screens.lives)).toHaveAttribute(
      'href',
      '/area-membros/lives',
    );
    await closeSchoolMenu(page);

    // No create control, no status chips and no "Categorias" row for a member.
    await expect(page.locator('a[href="/cursos/novo"]')).toHaveCount(0);
    await expect(page.getByTestId('courses-filters')).toHaveCount(0);
    await expect(page.getByTestId('courses-categories-row')).toHaveCount(0);

    // D-421: one mixed grid — the locked course carries "Exclusivo", the open one no tag.
    const locked = courseCard(page, fx.locked.title);
    await expect(locked).toBeVisible();
    await expect(locked.getByTestId('exclusive-badge')).toHaveText(M.tags.exclusiveCourse);
    await expect(locked).toHaveAttribute('href', `/cursos/${fx.locked.id}`);
    const open = courseCard(page, fx.open.title);
    await expect(open).toBeVisible();
    await expect(open.getByTestId('exclusive-badge')).toHaveCount(0);
    await expect(open.getByTestId('course-card-category')).toHaveText(
      fill(M.card.categoryLevel, { category: fx.category.name, level: C.level.beginner }),
    );
    // 2026-10-26: the lessons line under the cover is "{done}/{N} aulas".
    await expect(open.getByTestId('course-card-meta')).toHaveText(
      tm('card.lessonsDone', { done: 0, N: 2 }),
    );
    // The words sit UNDER the 16:9 cover, never over the art.
    const poster = await boxOf(open.getByTestId('course-card-poster'));
    expect(Math.abs(poster.width / poster.height - 16 / 9)).toBeLessThan(0.05);
    expect((await boxOf(open.getByTestId('course-card-body'))).y).toBeGreaterThanOrEqual(
      poster.y + poster.height - 0.5,
    );
    // 2026-10-22: the locked poster says so with the padlock disc in the centre; the open one has none.
    await expect(locked).toHaveAttribute('data-locked', 'true');
    await expect(locked.getByTestId('course-card-lock')).toBeVisible();
    await expect(open).not.toHaveAttribute('data-locked', 'true');
    await expect(open.getByTestId('course-card-lock')).toHaveCount(0);
    // The cover is always in colour: nothing on a locked card is desaturated or dimmed (PR-3).
    expect(await locked.evaluate((node) => node.innerHTML)).not.toMatch(/grayscale|opacity-50/);
    expect(
      await locked
        .getByTestId('course-card-poster')
        .evaluate((node) => getComputedStyle(node).filter),
    ).toBe('none');

    // D-426: a draft is absent for every member.
    await expect(courseCard(page, fx.draft.title)).toHaveCount(0);

    // Newest published first (the server's order): long (2 min) → locked (3 min) → open (4 min).
    const order = await page
      .getByTestId('courses-member-grid')
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    const mine = order.filter((href) =>
      [fx.long.id, fx.locked.id, fx.open.id].some((id) => href === `/cursos/${id}`),
    );
    expect(mine).toEqual([
      `/cursos/${fx.long.id}`,
      `/cursos/${fx.locked.id}`,
      `/cursos/${fx.open.id}`,
    ]);
  });

  test('UI-D-425 (2026-10-26: the header’s "Filtros" menu in place of the chips): "Todas" first and current; a category narrows the grid and the button names it; an unknown ?categoria= reads as "Todas"', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/area-membros/cursos`);

    const button = page.getByTestId('courses-member-categories-button');
    await expect(button).toContainText(M.filters.button);
    await expect(button).toHaveAccessibleName(
      fill(M.filters.buttonAria, { current: M.catalogue.categories.all }),
    );
    const menu = await openCategories(page);
    const all = menu.getByRole('link', { name: M.catalogue.categories.all, exact: true });
    // 2026-10-22: every catalogue link is the Cursos screen's own path (no ?aba= any more).
    await expect(all).toHaveAttribute('href', '/area-membros/cursos');
    await expect(all).toHaveAttribute('aria-current', 'page');
    await expect(menu.getByRole('link').first()).toHaveText(M.catalogue.categories.all);

    await menu.getByRole('link', { name: fx.category.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/area-membros/cursos\\?categoria=${fx.category.id}$`));
    await expect(page.getByTestId('courses-member-courses')).toBeVisible();
    await expect(courseCard(page, fx.open.title)).toBeVisible();
    await expect(courseCard(page, fx.locked.title)).toHaveCount(0);
    // The closed button still says which category is on screen.
    await expect(page.getByTestId('courses-member-categories-button')).toHaveAccessibleName(
      fill(M.filters.buttonAria, { current: fx.category.name }),
    );
    await expect(
      (await openCategories(page)).getByRole('link', { name: fx.category.name, exact: true }),
    ).toHaveAttribute('aria-current', 'page');

    await page.goto(
      `${hosts.demo}/area-membros/cursos?categoria=00000000-0000-4000-8000-000000000000`,
    );
    await expect(courseCard(page, fx.locked.title)).toBeVisible();
    await expect(courseCard(page, fx.open.title)).toBeVisible();
    await expect(page.getByTestId('courses-member-categories-button')).toHaveAccessibleName(
      fill(M.filters.buttonAria, { current: M.catalogue.categories.all }),
    );
  });

  test('2026-10-26 (the catalogue search, front only): the header’s search finds the fixture’s courses by a word of their title or category, accents and case aside, counts them, says when nothing matches and clears back to the grid', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/area-membros/cursos`);
    const field = page
      .getByTestId('courses-member-search')
      .getByRole('searchbox', { name: M.search.label });

    // The run's prefix in capitals: its three published courses (never the draft).
    const everything = prefix.toUpperCase();
    await field.fill(everything);
    await field.press('Enter');
    await expect(page).toHaveURL(/\/area-membros\/cursos\?busca=/);
    const results = page.getByTestId('courses-member-search-results');
    await expect(results.getByTestId('courses-member-search-count')).toHaveText(
      tm('search.results', { n: 3, q: everything }),
    );
    const found = results.getByTestId('courses-member-grid').getByRole('link');
    await expect(found).toHaveCount(3);
    for (const course of [fx.long, fx.locked, fx.open]) {
      await expect(courseCard(page, course.title)).toHaveCount(1);
    }
    await expect(courseCard(page, fx.draft.title)).toHaveCount(0);

    // "LABIOS": the category "Lábios" — accents and case aside — holds the open course only.
    const category = `${prefix} LABIOS`;
    await page
      .getByTestId('courses-member-search')
      .getByRole('searchbox', { name: M.search.label })
      .fill(category);
    await page
      .getByTestId('courses-member-search')
      .getByRole('searchbox', { name: M.search.label })
      .press('Enter');
    await expect(results.getByTestId('courses-member-search-count')).toHaveText(
      tm('search.results', { n: 1, q: category }),
    );
    await expect(results.getByTestId('courses-member-grid').getByRole('link')).toHaveCount(1);
    await expect(courseCard(page, fx.open.title)).toHaveCount(1);

    // Nothing found: the empty card and its way back to every course.
    await page.goto(
      `${hosts.demo}/area-membros/cursos?busca=${encodeURIComponent(`${prefix} inexistente`)}`,
    );
    const empty = page.getByTestId('courses-member-search-empty');
    await expect(empty.getByRole('heading', { name: M.search.empty.title })).toBeVisible();
    await expect(
      empty.getByRole('link', { name: M.catalogue.categoryEmpty.cta, exact: true }),
    ).toHaveAttribute('href', '/area-membros/cursos');

    // "Limpar busca" leads back to the grid.
    await page.goto(`${hosts.demo}/area-membros/cursos?busca=${encodeURIComponent(everything)}`);
    await page
      .getByTestId('courses-member-search-results')
      .getByRole('link', { name: M.search.clear, exact: true })
      .click();
    await expect(page).toHaveURL(/\/area-membros\/cursos$/);
    await expect(page.getByTestId('courses-member-search-results')).toHaveCount(0);
    await expect(courseCard(page, fx.open.title)).toBeVisible();
  });

  test('D-430 / A-UI-5: after the member completes the locked course’s free lesson, its card shows the band at the cover’s foot, the share chip and "1/2 aulas", and says so in its name', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/area-membros/cursos`);
    const locked = courseCard(page, fx.locked.title);
    await expect(locked).toBeVisible();
    await expect(locked.getByRole('progressbar')).toHaveCount(0);

    await completeLessonAs(users.demoMember, fx.locked.freeLessonId);
    await page.reload();

    const bar = locked.getByRole('progressbar', { name: fill(M.progress.aria, { percent: '50' }) });
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('aria-valuenow', '50');
    // 2026-10-26: the band pinned to the cover's foot is the member skin's plain 2px line.
    expect(Math.round((await boxOf(bar)).height)).toBe(2);
    const poster = await boxOf(locked.getByTestId('course-card-poster'));
    const barBox = await boxOf(bar);
    expect(Math.abs(barBox.y + barBox.height - (poster.y + poster.height))).toBeLessThanOrEqual(1);
    await expect(locked.getByTestId('course-card-percent')).toHaveText('50%');
    await expect(locked.getByTestId('course-card-meta')).toHaveText(
      tm('card.lessonsDone', { done: 1, N: 2 }),
    );
    await expect(locked).toHaveAttribute(
      'aria-label',
      tm('card.aria', {
        course: fx.locked.title,
        N: 2,
        exclusive: 'true',
        progress: 'true',
        percent: 50,
      }),
    );
    await expect(locked.getByTestId('exclusive-badge')).toBeVisible();
    // No completion elsewhere → no bar on the open course.
    await expect(courseCard(page, fx.open.title).getByRole('progressbar')).toHaveCount(0);
  });

  test('D-431 / UI-D-434 / COURSE-23: the Lives screen (/area-membros/lives) shows "Próximas" (on air, scheduled, cancelled, the locked one with "Exclusiva": the first in the spotlight, the rest in the agenda) then "Gravadas" (2026-10-26: cards, the words under the 16:9 cover); an ended live without a replay is absent', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/area-membros/lives`);

    // 2026-10-22: the area menu marks Lives as the current screen (no tab row any more).
    expect(await currentSchoolScreen(page)).toBe(M.area.screens.lives);
    await expect(
      page.getByRole('heading', { level: 1, name: M.screens.lives.title, exact: true }),
    ).toBeVisible();

    const upcomingTitle = page.getByRole('heading', { name: M.lives.upcoming, exact: true });
    const recordedTitle = page.getByRole('heading', { name: M.lives.recorded, exact: true });
    await expect(upcomingTitle).toBeVisible();
    await expect(recordedTitle).toBeVisible();
    expect((await boxOf(upcomingTitle)).y).toBeLessThan((await boxOf(recordedTitle)).y);

    const upcoming = page.getByTestId('lives-member-upcoming');
    // 2026-10-22: the nearest upcoming live is the spotlight, every other one an agenda row.
    const variants = await upcoming
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('data-variant')));
    expect(variants[0]).toBe('spotlight');
    expect(variants.slice(1).every((variant) => variant === 'agenda')).toBe(true);
    const onAir = liveCard(upcoming, fx.lives.onAir.title);
    await expect(onAir.getByTestId('live-card-status')).toHaveText(M.lives.liveNow);
    // On air: the red chip with the white dot that breathes.
    await expect(onAir.getByTestId('live-card-status')).toHaveClass(/\bbg-danger\b/);
    await expect(onAir.getByTestId('live-status-dot')).toBeVisible();
    await expect(
      liveCard(upcoming, fx.lives.scheduled.title).getByTestId('live-card-status'),
    ).toHaveText(C.status.scheduled);
    const cancelled = liveCard(upcoming, fx.lives.cancelled.title);
    await expect(cancelled.getByTestId('live-card-status')).toHaveText(C.status.cancelled);
    // 2026-10-22: a cancelled card says so with data-cancelled, its title stepping back (the
    // secondary ink in the agenda, the dimmed white over a cover).
    await expect(cancelled).toHaveAttribute('data-cancelled', 'true');
    await expect(onAir).not.toHaveAttribute('data-cancelled', 'true');
    await expect(cancelled.getByTestId('live-card-title')).toHaveClass(
      /text-text-secondary|text-white\/70/,
    );
    const lockedLive = liveCard(upcoming, fx.lives.locked.title);
    await expect(lockedLive.getByTestId('exclusive-badge')).toHaveText(M.tags.exclusiveLive);
    await expect(lockedLive).toHaveAttribute('aria-label', endsWith(liveExclusiveSuffix()));
    await expect(onAir.getByTestId('exclusive-badge')).toHaveCount(0);
    await expect(onAir).toHaveAttribute('href', `/cursos/lives/${fx.lives.onAir.id}`);
    // Nearest first inside "Próximas": on air (−10 min) → cancelled (+2 h) → scheduled (+24 h).
    const upcomingOrder = await upcoming
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    const mine = upcomingOrder.filter((href) =>
      [fx.lives.onAir.id, fx.lives.cancelled.id, fx.lives.scheduled.id].some(
        (id) => href === `/cursos/lives/${id}`,
      ),
    );
    expect(mine).toEqual([
      `/cursos/lives/${fx.lives.onAir.id}`,
      `/cursos/lives/${fx.lives.cancelled.id}`,
      `/cursos/lives/${fx.lives.scheduled.id}`,
    ]);

    const recorded = page.getByTestId('lives-member-recorded');
    const replay = liveCard(recorded, fx.lives.recorded.title);
    await expect(replay.getByTestId('live-card-status')).toHaveText(C.status.recorded);
    await expect(liveCard(recorded, fx.lives.onAir.title)).toHaveCount(0);
    // 2026-10-26 (the academy reference's card language): every "Gravadas" card is the catalogue's
    // card for a live — the 16:9 cover on top with the status chip, the title and the date UNDER it.
    await expect(replay).toHaveAttribute('data-variant', 'card');
    const recordedVariants = await recorded
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('data-variant')));
    expect(recordedVariants.every((variant) => variant === 'card')).toBe(true);
    const cover = await boxOf(replay.getByTestId('live-card-cover'));
    expect(Math.abs(cover.width / cover.height - 16 / 9)).toBeLessThan(0.05);
    for (const part of ['live-card-title', 'live-card-meta']) {
      expect((await boxOf(replay.getByTestId(part))).y).toBeGreaterThanOrEqual(
        cover.y + cover.height - 0.5,
      );
    }

    // D-431: an ended live without a replay is in neither group.
    await expect(liveCard(page.locator('main'), fx.lives.ended.title)).toHaveCount(0);
  });

  test('UI-D-424 / UI-D-437: the admin gets the hub at /cursos and the member Cursos screen at /area-membros/cursos?ver=aluno, its links — the area menu too — keeping the flag', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos`);
    await expect(page.getByTestId('courses-hub')).toBeVisible();
    await expect(page.getByTestId('courses-member-catalogue')).toHaveCount(0);

    // 2026-10-22: the preview of the Cursos screen is its own path with the flag.
    await page.goto(`${hosts.demo}/area-membros/cursos?ver=aluno`);
    await expect(page.getByTestId('courses-member-catalogue')).toBeVisible();
    await expect(page.getByTestId('courses-member-courses')).toBeVisible();
    await expect(page.getByTestId('courses-hub')).toHaveCount(0);
    // 2026-10-23: no preview banner; the manager sees the screen as a member does.
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    await expect(page.locator('a[href="/cursos/novo"]')).toHaveCount(0);
    // 2026-10-26: the "Filtros" menu's links and the search keep the flag too.
    await expect(
      (await openCategories(page)).getByRole('link', {
        name: M.catalogue.categories.all,
        exact: true,
      }),
    ).toHaveAttribute('href', '/area-membros/cursos?ver=aluno');
    await page.keyboard.press('Escape');
    await expect(
      page.getByTestId('courses-member-search').locator('input[name="ver"]'),
    ).toHaveValue('aluno');
    // Staff are never locked (UI-D-442): no "Exclusivo" on the manager's preview.
    const locked = courseCard(page, fx.locked.title);
    await expect(locked).toHaveAttribute('href', `/cursos/${fx.locked.id}?ver=aluno`);
    await expect(locked.getByTestId('exclusive-badge')).toHaveCount(0);
    await expect(locked.getByTestId('course-card-lock')).toHaveCount(0);
    // 2026-10-22: under /area-membros the manager's area menu is the member's ("· Membros"), every
    // screen link keeping ?ver=aluno, so the preview never drops out of the member view.
    // 2026-10-23: the same menu everywhere, with "Gerenciar" last.
    expect(await schoolScreenLabels(page)).toEqual([...MEMBER_SCREEN_LABELS, C.manage.title]);
    await expect(await schoolScreenLink(page, M.area.screens.lives)).toHaveAttribute(
      'href',
      '/area-membros/lives?ver=aluno',
    );
    await closeSchoolMenu(page);

    // A member's ?ver= is ignored: it can only ever choose the member view.
    await page.context().clearCookies();
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/area-membros/cursos?ver=admin`);
    await expect(page.getByTestId('courses-member-catalogue')).toBeVisible();
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    await expect(courseCard(page, fx.locked.title)).toHaveAttribute(
      'href',
      `/cursos/${fx.locked.id}`,
    );
  });

  test('quick 261019-k7x (QD-02, T-k7x-01, T-k7x-04) + 2026-10-22: every old address lands on its screen — /cursos and ?aba= send a member to the screen page keeping only its own filter; the admin keeps the hub, its preview lands on the screen with the flag, and (2026-10-23) a screen stays the member view for a manager without the flag', async ({
    page,
  }) => {
    // 2026-10-22 (the user's rule): a member who never started a lesson is sent from Início to the
    // Cursos screen; Início exists from the first lesson on. This member has one (the locked course's
    // free lesson, completed by an earlier case and again here, idempotent: the progress read counts
    // locked courses too), so the bare area below stays Início.
    await completeLessonAs(users.demoMember, fx.locked.freeLessonId);
    // redirect() inside a streaming page is a meta tag, not a status: URL assertions only, they retry.
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos?aba=lives`);
    await expect(page).toHaveURL(/\/area-membros\/lives$/);
    await expect(page.getByTestId('courses-member-catalogue')).toHaveAttribute(
      'data-screen',
      'lives',
    );

    await page.goto(`${hosts.demo}/cursos`);
    await expect(page).toHaveURL(/\/area-membros$/);
    await expect(page.getByTestId('courses-member-catalogue')).toHaveAttribute(
      'data-screen',
      'inicio',
    );
    await expect(page.getByTestId('courses-member-home')).toBeVisible();
    await expect(page).toHaveURL(/\/area-membros$/);

    // The member area's own ?aba= links (08.6) land on the screen's page: categoria only on Cursos.
    await page.goto(
      `${hosts.demo}/area-membros?aba=cursos&categoria=${fx.category.id}&trilha=qualquer`,
    );
    await expect(page).toHaveURL(new RegExp(`/area-membros/cursos\\?categoria=${fx.category.id}$`));
    await expect(page.getByTestId('courses-member-courses')).toBeVisible();
    // An unknown or repeated ?aba= stays on Início (this member has started, see above).
    await page.goto(`${hosts.demo}/area-membros?aba=desconhecida`);
    await expect(page.getByTestId('courses-member-catalogue')).toHaveAttribute(
      'data-screen',
      'inicio',
    );
    await expect(page.getByTestId('courses-member-home')).toBeVisible();
    await expect(page).toHaveURL(/\/area-membros\?aba=desconhecida$/);

    // A member's ?ver= is dropped by the redirect: the preview flag is the manager's alone.
    await page.goto(`${hosts.demo}/cursos?aba=trilhas&ver=aluno`);
    await expect(page).toHaveURL(/\/area-membros\/trilhas$/);
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    // The admin's own list pages send a member to the twin screen.
    await page.goto(`${hosts.demo}/cursos/lives`);
    await expect(page).toHaveURL(/\/area-membros\/lives$/);

    await page.context().clearCookies();
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos`);
    await expect(page.getByTestId('courses-hub')).toBeVisible();
    await expect(page).toHaveURL(/\/cursos$/);

    await page.goto(`${hosts.demo}/cursos?aba=lives&ver=aluno`);
    await expect(page).toHaveURL(/\/area-membros\/lives\?ver=aluno$/);
    await expect(page.getByTestId('courses-member-catalogue')).toHaveAttribute(
      'data-screen',
      'lives',
    );
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    await expect(page.getByTestId('courses-hub')).toHaveCount(0);

    // 2026-10-23: without the flag a member screen no longer sends the manager to the admin twin;
    // it stays the member's view, in preview. The old ?aba= lands on the screen with the flag added.
    await page.goto(`${hosts.demo}/area-membros?aba=lives`);
    await expect(page).toHaveURL(/\/area-membros\/lives\?ver=aluno$/);
    await expect(page.getByTestId('courses-member-catalogue')).toHaveAttribute(
      'data-screen',
      'lives',
    );
    await page.goto(`${hosts.demo}/area-membros/trilhas`);
    await expect(page).toHaveURL(/\/area-membros\/trilhas$/);
    await expect(page.getByTestId('courses-member-catalogue')).toHaveAttribute(
      'data-screen',
      'trilhas',
    );
    await page.goto(`${hosts.demo}/area-membros/progresso`);
    await expect(page).toHaveURL(/\/area-membros\/progresso$/);
    await expect(page.getByTestId('courses-hub')).toHaveCount(0);
  });

  test('E03/long-text backstop: at 320px a 120-character locked title with "Exclusivo" and "Produto arquivado" keeps both tags readable, the title at two lines and (2026-10-26) the band at the cover’s foot above the words', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await completeLessonAs(users.demoMember, fx.long.freeLessonId);
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/area-membros/cursos`);

    const card = courseCard(page, fx.long.title);
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    const cardBox = await boxOf(card);

    const exclusive = card.getByTestId('exclusive-badge');
    const archived = card.getByTestId('course-card-archived');
    await expect(exclusive).toHaveText(M.tags.exclusiveCourse);
    await expect(archived).toHaveText(M.tags.productArchived);
    for (const tag of [exclusive, archived]) {
      const box = await boxOf(tag);
      expect(box.x).toBeGreaterThanOrEqual(cardBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);
      // Readable: the pill shows all of its own words, never an ellipsis (2026-10-22: the compact
      // glass chip truncates in an inner span, so every box inside it is checked).
      expect(await showsAll(tag)).toBe(true);
    }

    const title = card.getByTestId('course-card-title');
    expect(await linesOf(title)).toBe(2);
    expect(await title.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await expect(title).toHaveText(fx.long.title);

    // 2026-10-26 (the card's cover on top): the tags sit on the cover, above the band pinned to its
    // foot; the title and the meta sit under the cover, never over the art.
    const archivedBox = await boxOf(archived);
    const titleBox = await boxOf(title);
    const meta = card.getByTestId('course-card-meta');
    await expect(meta).toBeVisible();
    await expect(meta).toHaveText(tm('card.lessonsDone', { done: 1, N: 2 }));
    const bar = card.getByRole('progressbar');
    await expect(bar).toBeVisible();
    const metaBox = await boxOf(meta);
    const barBox = await boxOf(bar);
    expect(archivedBox.y + archivedBox.height).toBeLessThanOrEqual(barBox.y);
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(titleBox.y + 0.5);
    expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(metaBox.y + 0.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test('UI-D-441: with the school off (rede-lab) /cursos, /area-membros and every screen page are the kernel not-found for the member and the admin', async ({
    page,
  }) => {
    await login(page, users.labMember, SEED_PASSWORD, hosts.lab);
    await page.goto(`${hosts.lab}/cursos`);
    await expectKernelNotFound(page);
    await page.goto(`${hosts.lab}/cursos?aba=lives`);
    await expectKernelNotFound(page);
    // The member area answers the same way: the module check runs before any redirect.
    await page.goto(`${hosts.lab}/area-membros`);
    await expectKernelNotFound(page);
    // 2026-10-22: so do the screens' own pages.
    await page.goto(`${hosts.lab}/area-membros/cursos`);
    await expectKernelNotFound(page);
    await page.goto(`${hosts.lab}/area-membros/lives`);
    await expectKernelNotFound(page);

    await page.context().clearCookies();
    await login(page, users.labAdmin, SEED_PASSWORD, hosts.lab);
    await page.goto(`${hosts.lab}/cursos`);
    await expectKernelNotFound(page);
    await page.goto(`${hosts.lab}/area-membros`);
    await expectKernelNotFound(page);
    await page.goto(`${hosts.lab}/cursos/trilhas`);
    await expectKernelNotFound(page);
  });
});

/**
 * 08.5-07 — the member's course page (D-422..D-424, D-426, D-430, UI-D-427..UI-D-430, UI-D-437,
 * UI-D-441, COURSE-18, COURSE-25, STORE-23), on the phone and on the desktop: the progress variants
 * and the curriculum's states in words, the locked course's buy section in its variants with the
 * free-lesson door, the RSC payload never carrying a locked lesson's content, the admin preview, the
 * unavailable course, and the E05 / E07 backstops at 320px.
 *
 * The fixture lives on rede-demo under a per-project run prefix (`e2e-cp-…`), every assertion is
 * scoped to its own ids, and progress is written per lesson, so the two projects never share a row.
 * Sketch 010 is approved (D-417), so the gated surfaces (buy section, preview banner) run here.
 *
 * 2026-10-26 (the academy reference's course and module pages, the user's "swap completo"): the hero
 * is a panel whose ground is the cover — the overline ("Curso · N módulos"), the title (the page's
 * one h1), the tagline, the instructor and the chips ("N aulas", "N concluídas", the length, "{n}%
 * completo", or "Exclusivo" on a locked course) — with the main action (`course-action-cta`:
 * "Começar o curso" / "Continuar o curso" / "Rever o curso", never on a locked course). Under it the
 * buy section (a locked course) or "Seu progresso no curso" (the bar, the share, the line), then
 * "Módulos": one card per module (`member-module-card`, its state as a chip, the padlock while
 * held), each opening the module's own page (`/cursos/{id}/modulos/{moduleId}`), where the lessons
 * are cards (`member-lesson-card`) that say their state in words. The way back to Cursos is the
 * phone header's "Voltar" and, from `md`, the hero's "‹ Cursos". The accordion curriculum (module
 * bands and lesson rows) left the course page.
 */
test.describe('course page', () => {
  test.skip(isRemote, 'the course-page fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  let prefix = '';
  let fx: CoursePageFixture;

  const moduleCard = (page: Page, moduleId: string): Locator =>
    page.locator(`[data-testid="member-module-card"][data-module-id="${moduleId}"]`);
  const lessonCard = (page: Page, lessonId: string): Locator =>
    page.locator(`[data-testid="member-lesson-card"][data-lesson-id="${lessonId}"]`);
  const lessonHref = (courseId: string, lessonId: string, preview = false) =>
    `/cursos/${courseId}/aulas/${lessonId}${preview ? '?ver=aluno' : ''}`;
  const moduleHref = (courseId: string, moduleId: string) =>
    `/cursos/${courseId}/modulos/${moduleId}`;
  /** The way back to Cursos on screen: the phone header's "Voltar", the hero's "‹ Cursos" from md. */
  const backToCatalogue = (page: Page, href: string): Locator =>
    page.getByTestId('member-course-page').locator(`a[href="${href}"]:visible`);

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    prefix = `e2e-cp-${testInfo.project.name}-${run}`;
    fx = await coursePageFixture(prefix);
  });

  test.afterAll(async () => {
    if (prefix) await deleteMemberCatalogueFixture(prefix);
    await closeCoursesMember();
    await closeCoursesAdmin();
    await closeStoreAdmin();
  });

  test('D-430 / UI-D-427 / UI-D-429 / UI-D-430 (2026-10-26, the reference’s course page): the hero’s chips and "Começar o curso", the progress panel at 0%, the module cards with module 2 held, the lessons in words on each module’s page; then "Continuar o curso" at 33%, module 1 complete, and at 100% the outline "Rever o curso"', async ({
    page,
  }) => {
    const { open } = fx;
    const [m1, m2] = open.moduleIds;
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos/${open.id}`);

    // D-423: the member page, never the admin one; its one h1 is the course's title.
    await expect(page.getByTestId('member-course-page')).toBeVisible();
    await expect(page.getByTestId('course-page')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText([open.title]);
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    // The way back leads to the Cursos screen, the course's place in the area.
    const back = backToCatalogue(page, '/area-membros/cursos');
    await expect(back).toHaveCount(1);
    await expect(back).toHaveAccessibleName(
      hasDesktopRail(page) ? M.catalogue.title : C.course.back,
    );

    // The hero: the overline (no level on this course), the instructor and the chips.
    const hero = page.getByTestId('member-course-hero');
    await expect(hero.getByTestId('member-course-title')).toHaveText(open.title);
    await expect(hero).toContainText(tm('course.overline', { M: 2, hasLevel: 'false', level: '' }));
    await expect(hero.getByTestId('member-course-instructor')).toBeVisible();
    const chips = page.getByTestId('member-course-chips');
    await expect(chips.getByTestId('member-course-chip-lessons')).toHaveText(
      tm('chips.lessons', { N: 3 }),
    );
    await expect(chips.getByTestId('member-course-chip-duration')).toHaveText('21 min');
    await expect(chips.getByTestId('member-course-chip-done')).toHaveCount(0);
    await expect(chips.getByTestId('member-course-chip-progress')).toHaveCount(0);
    await expect(page.getByTestId('member-course-pills')).toHaveCount(0);

    // 0% (EP-11): the brand "Começar o curso" to the first open lesson; the panel's bar at 0%.
    const cta = page.getByTestId('member-course-actions').getByTestId('course-action-cta');
    await expect(cta).toHaveAttribute('data-variant', 'start');
    await expect(cta).toHaveText(M.course.start);
    await expect(cta).toHaveAttribute('href', lessonHref(open.id, open.videoLessonId));
    const panel = page.getByTestId('member-course-progress');
    await expect(panel).toContainText(M.course.progressTitle);
    await expect(
      panel.getByRole('progressbar', { name: fill(M.progress.aria, { percent: '0' }) }),
    ).toHaveAttribute('aria-valuenow', '0');

    // "Módulos" (UI-D-429): one card per module, its page a tap away; module 2 is held by the
    // module rule — the padlock, "bloqueado" in its name — and still a link (A-UI-3).
    const modules = page.getByTestId('member-course-modules');
    await expect(
      modules.getByRole('heading', { level: 2, name: M.course.modulesTitle, exact: true }),
    ).toBeVisible();
    await expect(modules).toContainText(tm('course.contentCount', { M: 2, N: 3 }));
    await expect(modules.getByTestId('member-module-card')).toHaveCount(2);
    await expect(moduleCard(page, m1)).toHaveAttribute('href', moduleHref(open.id, m1));
    await expect(moduleCard(page, m1)).toHaveAttribute('data-state', 'idle');
    await expect(moduleCard(page, m1).getByTestId('member-module-card-pill')).toHaveText(
      fill(M.module.pill, { nn: '01' }),
    );
    await expect(moduleCard(page, m1).getByTestId('member-module-card-meta')).toHaveText(
      tm('moduleCard.lessons', { done: 0, N: 2 }),
    );
    await expect(moduleCard(page, m1)).toHaveAttribute(
      'aria-label',
      fill(M.module.aria, {
        nn: '01',
        title: `${prefix} Fundamentos`,
        state: fill(M.module.stateProgress, { percent: '0' }),
      }),
    );
    const held = moduleCard(page, m2);
    await expect(held).toHaveAttribute('data-state', 'locked');
    await expect(held).toHaveAttribute('data-locked', 'true');
    await expect(held.getByTestId('member-module-card-lock')).toBeVisible();
    await expect(held).toHaveAttribute(
      'aria-label',
      fill(M.module.aria, { nn: '02', title: `${prefix} Técnica`, state: M.module.stateLocked }),
    );
    await expect(held).toHaveAttribute('href', moduleHref(open.id, m2));

    // UI-D-430 (2026-10-26: the lessons are cards on the module's own page): each says its state in
    // words — "12:34", "Prática" — and links to its lesson.
    await moduleCard(page, m1).click();
    await expect(page).toHaveURL(new RegExp(`/cursos/${open.id}/modulos/${m1}$`));
    await expect(page.getByTestId('member-module-page')).toHaveAttribute('data-module-id', m1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText([`${prefix} Fundamentos`]);
    await expect(page.getByTestId('member-module-hero')).toContainText(
      fill(M.module.pill, { nn: '01' }),
    );
    await expect(page.getByTestId('member-module-chip-lessons')).toHaveText(
      tm('chips.lessons', { N: 2 }),
    );
    const video = lessonCard(page, open.videoLessonId);
    await expect(video).toHaveAttribute('data-state', 'open');
    await expect(video.getByTestId('member-lesson-card-pill')).toHaveText(
      fill(M.player.lesson, { nn: '01' }),
    );
    await expect(video.getByTestId('member-lesson-card-meta')).toHaveText('12:34');
    await expect(video.getByTestId('member-lesson-card-duration')).toHaveText('12:34');
    await expect(video).toHaveAttribute('href', lessonHref(open.id, open.videoLessonId));
    await expect(
      lessonCard(page, open.practiceLessonId).getByTestId('member-lesson-card-meta'),
    ).toHaveText(M.lesson.practice);
    // Module 2's page: its lesson is held by the module rule, in words, and still a link (A-UI-3).
    await page.goto(`${hosts.demo}${moduleHref(open.id, m2)}`);
    const heldLesson = lessonCard(page, open.secondModuleLessonId);
    await expect(heldLesson).toHaveAttribute('data-state', 'locked');
    await expect(heldLesson.getByTestId('member-lesson-card-meta')).toHaveText(
      fill(M.lesson.lockedByModule, { nn: '01' }),
    );
    await expect(heldLesson.getByTestId('member-lesson-card-lock')).toBeVisible();
    await expect(heldLesson).toHaveAttribute(
      'href',
      lessonHref(open.id, open.secondModuleLessonId),
    );

    // 1 of 3 (EP-11 continue): "Continuar o curso" to the next open lesson, the h-2 bar at 33% and
    // its line, the chips' "1 concluída" and "33% completo"; module 1 under way.
    await completeLessonAs(users.demoMember, open.videoLessonId);
    await page.goto(`${hosts.demo}/cursos/${open.id}`);
    await expect(cta).toHaveAttribute('data-variant', 'continue');
    await expect(cta).toHaveText(M.course.continue);
    await expect(cta).toHaveAttribute('href', lessonHref(open.id, open.practiceLessonId));
    const bar = panel.getByRole('progressbar', { name: fill(M.progress.aria, { percent: '33' }) });
    await expect(bar).toHaveAttribute('aria-valuenow', '33');
    await expect(bar).toHaveClass(/\bh-2\b/);
    await expect(panel).toContainText(
      fill(M.course.progressLine, { percent: '33', done: '1', total: '3' }),
    );
    await expect(chips.getByTestId('member-course-chip-done')).toHaveText(
      tm('chips.done', { n: 1 }),
    );
    await expect(chips.getByTestId('member-course-chip-progress')).toHaveText(
      fill(M.chips.percent, { percent: '33' }),
    );
    await expect(moduleCard(page, m1)).toHaveAttribute('data-state', 'progress');
    await expect(moduleCard(page, m1).getByTestId('member-module-card-percent')).toHaveText('50%');
    await expect(moduleCard(page, m1).getByTestId('member-module-card-meta')).toHaveText(
      tm('moduleCard.lessons', { done: 1, N: 2 }),
    );
    await expect(moduleCard(page, m2)).toHaveAttribute('data-state', 'locked');

    // Module 1 complete (EP-12): its card reads "Concluído"; module 2 loses its padlock and its
    // lesson opens.
    await completeLessonAs(users.demoMember, open.practiceLessonId);
    await page.reload();
    await expect(moduleCard(page, m1)).toHaveAttribute('data-state', 'done');
    await expect(moduleCard(page, m1).getByTestId('member-module-card-done')).toHaveText(
      M.module.done,
    );
    await expect(moduleCard(page, m2)).toHaveAttribute('data-state', 'idle');
    await expect(moduleCard(page, m2).getByTestId('member-module-card-lock')).toHaveCount(0);
    await page.goto(`${hosts.demo}${moduleHref(open.id, m2)}`);
    await expect(lessonCard(page, open.secondModuleLessonId)).toHaveAttribute('data-state', 'open');
    await expect(
      lessonCard(page, open.secondModuleLessonId).getByTestId('member-lesson-card-meta'),
    ).toHaveText('8:10');

    // 100%: the OUTLINE "Rever o curso" to the first lesson, the done line, the bar full, every
    // module done.
    await completeLessonAs(users.demoMember, open.secondModuleLessonId);
    await page.goto(`${hosts.demo}/cursos/${open.id}`);
    await expect(cta).toHaveAttribute('data-variant', 'done');
    await expect(cta).toHaveText(M.course.review);
    await expect(cta).toHaveAttribute('href', lessonHref(open.id, open.videoLessonId));
    await expect(cta).toHaveClass(/border-border-secondary/);
    await expect(cta).not.toHaveClass(/bg-button/);
    await expect(panel).toContainText(fill(M.course.doneLine, { total: '3' }));
    await expect(
      panel.getByRole('progressbar', { name: fill(M.progress.aria, { percent: '100' }) }),
    ).toHaveAttribute('aria-valuenow', '100');
    for (const id of open.moduleIds) {
      await expect(moduleCard(page, id)).toHaveAttribute('data-state', 'done');
    }
  });

  test('D-424 / UI-D-428 (b) / STORE-23: two products → "Curso exclusivo", the button opens "Opções de acesso" with both rows; on the module’s page (2026-10-26) the "Aula aberta" and "Aula exclusiva" cards; neither page’s HTML ever carries a lesson’s description', async ({
    page,
  }) => {
    const { lockedMany: course } = fx;
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    const url = `${hosts.demo}/cursos/${course.id}`;
    await page.goto(url);

    // The compact glass "Exclusivo" among the hero's chips, the cover keeping its colour (D-421).
    const hero = page.getByTestId('member-course-hero');
    await expect(hero.getByTestId('exclusive-badge')).toHaveText(M.tags.exclusiveCourse);
    await expect(hero.getByTestId('exclusive-badge')).toHaveAttribute('data-size', 'compact');
    expect(await hero.evaluate((node) => node.innerHTML)).not.toMatch(/grayscale/);
    const section = page.getByTestId('locked-section');
    // 2026-10-22: the buy section is the prototype's centred card.
    await expect(section).toHaveAttribute('data-variant', 'centered');
    await expect(section).toContainText(S.course.title);
    await expect(section).toContainText(fill(S.course.bodyMany, { course: course.title }));
    // A locked course has no main action and no progress panel: the buy section speaks instead.
    await expect(page.getByTestId('member-course-actions')).toHaveCount(0);
    await expect(page.getByTestId('member-course-progress')).toHaveCount(0);

    const buy = page.getByRole('button', { name: M.locked.buy, exact: true });
    await expect(buy).toHaveAttribute('aria-haspopup', 'dialog');
    await buy.click();
    const sheet = page.getByRole('dialog', { name: SHEET_TITLE });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(fill(S.choice.helperCourse, { course: course.title }));
    const rows = sheet.getByRole('link');
    await expect(rows).toHaveCount(2);
    expect(
      await rows.evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    ).toEqual(
      expect.arrayContaining(
        course.products.map((product) => `/loja/${product.id}?curso=${course.id}`),
      ),
    );
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    // PR-4: nothing was bought by the tap.
    await expect(page).toHaveURL(new RegExp(`/cursos/${course.id}$`));

    // T-08.5-13 / PR-1: the course page's HTML and its inline RSC payload never hold a lesson's
    // description.
    expect(await page.content()).not.toContain(course.paidMarker);
    const raw = await (await page.request.get(url)).text();
    expect(raw).toContain(course.title);
    expect(raw).not.toContain(course.paidMarker);
    expect(raw).not.toContain(course.freeMarker);

    // UI-D-430 partial (2026-10-26: on the module's page): the free lesson is "Aula aberta"; the
    // paid one "Aula exclusiva", the padlock, still a link; nothing desaturated.
    const moduleLink = page.getByTestId('member-module-card');
    await expect(moduleLink).toHaveCount(1);
    const moduleUrl = (await moduleLink.getAttribute('href')) ?? '';
    await moduleLink.click();
    await expect(page.getByTestId('member-module-page')).toBeVisible();
    await expect(
      lessonCard(page, course.freeLessonId).getByTestId('member-lesson-card-meta'),
    ).toHaveText(tm('lesson.free', { hasLength: 'true', length: '4:10' }));
    const paid = lessonCard(page, course.paidLessonId);
    await expect(paid).toHaveAttribute('data-state', 'locked');
    await expect(paid.getByTestId('member-lesson-card-meta')).toHaveText(
      fill(M.lesson.exclusive, { duration: '12:34' }),
    );
    await expect(paid).toHaveAttribute(
      'aria-label',
      fill(M.lesson.aria, { lesson: course.paidLessonTitle, state: M.lesson.stateExclusive }),
    );
    await expect(paid).toHaveAttribute('href', lessonHref(course.id, course.paidLessonId));
    expect(await paid.evaluate((node) => node.innerHTML)).not.toMatch(/grayscale/);
    // The titles ship, the descriptions never — neither in the DOM nor in the server's HTML.
    const html = await page.content();
    expect(html).toContain(course.paidLessonTitle);
    expect(html).not.toContain(course.paidMarker);
    expect(html).not.toContain(course.freeMarker);
    const moduleRaw = await (await page.request.get(`${hosts.demo}${moduleUrl}`)).text();
    expect(moduleRaw).toContain(course.paidLessonTitle);
    expect(moduleRaw).not.toContain(course.paidMarker);
    expect(moduleRaw).not.toContain(course.freeMarker);

    // The free-lesson door leads to the first free lesson.
    await page.goto(url);
    const door = page.getByRole('link', { name: M.locked.freeLesson, exact: true });
    await expect(door).toHaveAttribute('href', lessonHref(course.id, course.freeLessonId));
    await door.click();
    await expect(page).toHaveURL(new RegExp(`/cursos/${course.id}/aulas/${course.freeLessonId}$`));
  });

  test('UI-D-428 (a) / (c): one product → the "Comprar para liberar" link to /loja/{id}?curso=; none buyable → "Este curso não está à venda no momento.", "Produto arquivado", no free-lesson door', async ({
    page,
  }) => {
    const { lockedOne, lockedNone } = fx;
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    await page.goto(`${hosts.demo}/cursos/${lockedOne.id}`);
    const section = page.getByTestId('locked-section');
    await expect(section).toContainText(
      fill(S.course.bodyOne, { product: lockedOne.product.name, course: lockedOne.title }),
    );
    await expect(page.getByRole('link', { name: M.locked.buy, exact: true })).toHaveAttribute(
      'href',
      `/loja/${lockedOne.product.id}?curso=${lockedOne.id}`,
    );
    await expect(page.getByRole('button', { name: M.locked.buy })).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: M.locked.freeLesson, exact: true }),
    ).toHaveAttribute('href', lessonHref(lockedOne.id, lockedOne.freeLessonId));

    await page.goto(`${hosts.demo}/cursos/${lockedNone.id}`);
    await expect(page.getByTestId('course-locked-unavailable')).toHaveText(S.course.unavailable);
    await expect(page.getByTestId('locked-section')).toHaveCount(0);
    await expect(page.getByRole('link', { name: M.locked.buy })).toHaveCount(0);
    await expect(page.getByRole('button', { name: M.locked.buy })).toHaveCount(0);
    // E06 partial: no free lesson → no door.
    await expect(page.getByRole('link', { name: M.locked.freeLesson })).toHaveCount(0);
    await expect(page.getByTestId('member-course-pills')).toContainText(M.tags.productArchived);
    await expect(
      page.getByTestId('member-course-hero').getByTestId('exclusive-badge'),
    ).toBeVisible();
  });

  test('D-422 / UI-D-437 / COURSE-25: the admin at ?ver=aluno sees the member page with every lesson open (2026-10-23: no banner), links keep the flag — the module card too; without it the admin page; a member’s ?ver=aluno draws no banner', async ({
    page,
  }) => {
    const { lockedMany: course } = fx;
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);

    await page.goto(`${hosts.demo}/cursos/${course.id}`);
    await expect(page.getByTestId('course-page')).toBeVisible();
    await expect(page.getByTestId('member-course-page')).toHaveCount(0);

    await page.goto(`${hosts.demo}/cursos/${course.id}?ver=aluno`);
    await expect(page.getByTestId('member-course-page')).toBeVisible();
    // 2026-10-23: the page as a member sees it, no preview banner (the way back to authoring is
    // the menu's Gerenciar, or the browser's back).
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    // 2026-10-22: in preview the way back stays in the member view, on the Cursos screen.
    await expect(backToCatalogue(page, '/area-membros/cursos?ver=aluno')).toHaveCount(1);
    // Staff are never locked: no tag, no buy section, the start at the first lesson in preview.
    await expect(page.getByTestId('exclusive-badge')).toHaveCount(0);
    await expect(page.getByTestId('course-locked-zone')).toHaveCount(0);
    await expect(page.getByRole('link', { name: M.course.start, exact: true })).toHaveAttribute(
      'href',
      lessonHref(course.id, course.freeLessonId, true),
    );
    // The module card keeps the flag; on its page the paid lesson is open and linked in preview.
    const moduleLink = page.getByTestId('member-module-card');
    await expect(moduleLink).toHaveAttribute(
      'href',
      new RegExp(`^/cursos/${course.id}/modulos/[^?]+\\?ver=aluno$`),
    );
    await moduleLink.click();
    await expect(page.getByTestId('member-module-page')).toBeVisible();
    const paid = lessonCard(page, course.paidLessonId);
    await expect(paid).toHaveAttribute('data-state', 'open');
    await expect(paid.getByTestId('member-lesson-card-meta')).toHaveText('12:34');
    await expect(paid).toHaveAttribute('href', lessonHref(course.id, course.paidLessonId, true));

    await page.context().clearCookies();
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos/${fx.open.id}?ver=aluno`);
    await expect(page.getByTestId('member-course-page')).toBeVisible();
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
  });

  test('D-426 / UI-D-441: a draft or unknown course is "Curso indisponível" for the member and for the admin at ?ver=aluno', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos/${fx.draft.id}`);
    await expect(page.getByTestId('courses-not-found')).toContainText(C.notFound.title);
    await expect(page.getByTestId('member-course-page')).toHaveCount(0);
    await page.goto(`${hosts.demo}/cursos/00000000-0000-4000-8000-000000000000`);
    await expect(page.getByTestId('courses-not-found')).toContainText(C.notFound.title);

    await page.context().clearCookies();
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos/${fx.draft.id}?ver=aluno`);
    await expect(page.getByTestId('courses-not-found')).toContainText(C.notFound.title);
    await expect(page.getByTestId('member-course-page')).toHaveCount(0);
  });

  test('E05/long-text backstop (2026-10-26, the reference’s hero): at 320px a 120-character title wraps whole inside the hero, which grows to hold it; the 160-character tagline clamps to three lines under it, inside the hero; the header’s title truncates', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos/${fx.long.id}`);

    const hero = page.getByTestId('member-course-hero');
    const title = hero.getByTestId('member-course-title');
    const tagline = hero.getByTestId('member-course-tagline');
    await expect(title).toHaveText(fx.long.title);
    await expect(tagline).toHaveText(fx.long.tagline);
    await expect(hero).toContainText(tm('course.overline', { M: 3, hasLevel: 'false', level: '' }));
    const heroBox = await boxOf(hero);
    const titleBox = await boxOf(title);
    // The hero's height is a minimum, not a crop: the long title wraps whole inside it.
    expect(titleBox.y).toBeGreaterThanOrEqual(heroBox.y - 0.5);
    expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(heroBox.y + heroBox.height + 0.5);
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(320 + 0.5);
    expect(await linesOf(title)).toBeGreaterThanOrEqual(2);
    expect(await title.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
    // The tagline sits under the title, inside the hero, clamped to three lines.
    const taglineBox = await boxOf(tagline);
    expect(taglineBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 0.5);
    expect(taglineBox.y + taglineBox.height).toBeLessThanOrEqual(heroBox.y + heroBox.height + 0.5);
    expect(taglineBox.x + taglineBox.width).toBeLessThanOrEqual(320 + 0.5);
    expect(await linesOf(tagline)).toBe(3);
    // The phone header's title is a paragraph (the page's one h1 is the hero's): one truncated line.
    const header = page.getByTestId('member-course-page').locator('header p');
    await expect(header).toHaveText(fx.long.title);
    expect(await header.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    expect(await header.evaluate((node) => getComputedStyle(node).textOverflow)).toBe('ellipsis');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test('E07/overflow backstop (2026-10-26: the lessons are cards on the module’s page): at 320px a two-line lesson title held by "Libera ao concluir o Módulo 02" keeps its padlock, its chip and its line inside the card, and the card inside the screen', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}${moduleHref(fx.long.id, fx.long.module3Id)}`);

    const card = lessonCard(page, fx.long.longLessonId);
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveAttribute('data-state', 'locked');
    await expect(card.getByTestId('member-lesson-card-meta')).toHaveText(
      fill(M.lesson.lockedByModule, { nn: '02' }),
    );
    const cardBox = await boxOf(card);
    expect(cardBox.x).toBeGreaterThanOrEqual(0);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(320);
    for (const part of [
      'member-lesson-card-lock',
      'member-lesson-card-pill',
      'member-lesson-card-title',
      'member-lesson-card-meta',
    ]) {
      const box = await boxOf(card.getByTestId(part));
      expect(box.x).toBeGreaterThanOrEqual(cardBox.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);
      expect(box.y).toBeGreaterThanOrEqual(cardBox.y - 0.5);
      expect(box.y + box.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 0.5);
    }
    expect(await linesOf(card.getByTestId('member-lesson-card-title'))).toBe(2);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test('2026-10-26 (the hero’s chips, in place of the facts strip): at 390px and at 320px the instructor line and every chip wrap inside the hero, each one whole', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320/390px checks are phone checks');
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${hosts.demo}/cursos/${fx.open.id}`);

      // The first case completed the whole course: the lessons, the done ones, the length, 100%.
      const chips = page.getByTestId('member-course-chips');
      await chips.scrollIntoViewIfNeeded();
      await expect(chips.getByTestId('member-course-chip-lessons')).toHaveText(
        tm('chips.lessons', { N: 3 }),
      );
      await expect(chips.getByTestId('member-course-chip-done')).toHaveText(
        tm('chips.done', { n: 3 }),
      );
      await expect(chips.getByTestId('member-course-chip-duration')).toHaveText('21 min');
      await expect(chips.getByTestId('member-course-chip-progress')).toHaveText(
        fill(M.chips.percent, { percent: '100' }),
      );
      const heroBox = await boxOf(page.getByTestId('member-course-hero'));
      const right = Math.min(width, heroBox.x + heroBox.width);
      for (const item of await chips.locator(':scope > *').all()) {
        const box = await boxOf(item);
        expect(box.x).toBeGreaterThanOrEqual(heroBox.x - 0.5);
        expect(box.x + box.width).toBeLessThanOrEqual(right + 0.5);
        // Each one shows its whole words: nothing clipped.
        expect(await showsAll(item)).toBe(true);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
  });
});

/**
 * Sketch 010's gate (D-365, D-417): the lock pages are prototype-less surfaces, so their cases run
 * only once the sketch README reads `approved: true`; the player is ported and always runs.
 */
const SKETCH_010_APPROVED = (() => {
  try {
    const readme = fileURLToPath(
      new URL(
        '../../../.planning/sketches/010-phase-08.5-designed-screens/README.md',
        import.meta.url,
      ),
    );
    return /^approved: true$/m.test(readFileSync(readme, 'utf8'));
  } catch {
    return false;
  }
})();
const GATED_REASON = 'sketch 010 is not approved yet (D-417): the lock pages are gated';

/**
 * 08.5-08 — the member's player and the lesson lock pages (D-422, D-424, D-427..D-430, UI-D-431..433,
 * COURSE-19, COURSE-21, COURSE-22), on the phone and on the desktop.
 *
 * The player fixture lives on rede-demo under a per-project run prefix: an open course whose lesson 2
 * requires lesson 1 (lesson 1 carries a ready video, two materials with real bytes in Storage and a
 * 2,000-character description) and a course locked by one product with a free lesson and a paid
 * one. The cases run in order: the first one completes lesson 1 for the member.
 *
 * What a browser cannot do here is PLAY a video (the fake provider mints a playback id no CDN
 * serves), so the 15-second ticks are pinned by `progress-reporter.test.ts` and the page-hide write
 * is exercised by posting the beacon's own body from the page (same origin, the session cookie).
 *
 * 2026-10-22 (the social-igoralves lesson page): the header has two lines — the course as the
 * overline over the lesson's title, both `p` — so the page's ONE h1 is the lesson title under the
 * player (the lock pages too); the pills are uppercase by CSS (their words are the catalog's); the
 * completion button swaps to "Aula concluída" with a short fade (the done block arrives once the
 * button has left, and takes the focus); "Sobre esta aula" clamps to three lines.
 *
 * 2026-10-23: the "Módulo NN / Aula NN / Aula aberta / Prática" pills left the lesson page and the
 * lock page. The length stands alone over the title (`member-lesson-duration` /
 * `lesson-lock-duration`), only when the lesson has a ready video; the cases read it there and pin
 * the pills' absence.
 *
 * 2026-10-26 (the academy reference's player): the side list (`lesson-module-list`) is the WHOLE
 * course — every module a disclosure (the open lesson's module open), the rows keeping their hooks
 * (`member-lesson-row`, `aria-current`, `data-trailing`); the previous and next sit in one row with
 * the lesson's place in the course between them (`lesson-position`, "1 de 2 aulas"); the
 * description and the materials are the tabs "Descrição | Materiais" (`lesson-tabs`: one tab alone
 * draws no list), so a case opens "Materiais" before it reads the files.
 */
test.describe('player', () => {
  test.skip(isRemote, 'the player fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  let prefix = '';
  let fx: PlayerFixture;

  const P = M.player;
  const lessonHref = (courseId: string, lessonId: string, preview = false) =>
    `/cursos/${courseId}/aulas/${lessonId}${preview ? '?ver=aluno' : ''}`;
  const toast = (page: Page, message: string) =>
    page.getByRole('status').filter({ hasText: message });
  /** A row of the side list (2026-10-26: the whole course's outline). */
  const outlineRow = (page: Page, lessonId: string): Locator =>
    page
      .getByTestId('lesson-module-list')
      .locator(`[data-testid="member-lesson-row"][data-lesson-id="${lessonId}"]`);

  /**
   * 2026-10-22: the lesson page's two-line header — the course as the overline over the lesson's
   * title, both paragraphs — and the page's one h1, the lesson title under the media.
   */
  // 2026-10-23 (the video first): the header names the COURSE only; the lesson's title is the
  // page's one h1, under the stage.
  async function expectLessonHeadings(page: Page, course: string, lesson: string): Promise<void> {
    const header = page.locator('header').filter({ hasText: course });
    await expect(header.locator('p')).toHaveText([course]);
    await expect(header).not.toContainText(lesson);
    await expect(header.locator('h1')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: lesson })).toBeVisible();
  }

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    prefix = `e2e-pl-${testInfo.project.name}-${run}`;
    fx = await playerFixture(prefix);
  });

  test.afterAll(async () => {
    if (prefix) await deleteMemberCatalogueFixture(prefix);
    await deletePlayerStorage();
    await closeCoursesMember();
    await closeCoursesAdmin();
    await closeStoreAdmin();
  });

  test('D-428 / UI-D-431 (sequence): opening lesson 2 first lands on "Aula ainda bloqueada" with "Continuar o curso" to lesson 1, and nothing of lesson 2 is on the page', async ({
    page,
  }) => {
    test.skip(!SKETCH_010_APPROVED, GATED_REASON);
    const { open } = fx;
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}${lessonHref(open.id, open.lesson2.id)}`);

    const lock = page.getByTestId('lesson-lock-page');
    await expect(lock).toHaveAttribute('data-reason', 'sequence');
    await expect(page.getByRole('heading', { level: 1, name: open.lesson2.title })).toBeVisible();
    await expectLessonHeadings(page, open.title, open.lesson2.title);
    await expect(lock.getByTestId('lesson-lock-media')).toContainText(M.lock.pillLocked);
    // 2026-10-23: no "Módulo 01 / Aula 02" pills; lesson 2's ready video (8:10) is the length line.
    await expect(lock.getByTestId('lesson-lock-pills')).toHaveCount(0);
    await expect(lock.getByTestId('lesson-lock-duration')).toHaveText('8:10');
    const notice = lock.getByTestId('lesson-lock-sequence');
    await expect(notice.getByRole('heading', { name: M.lock.title })).toBeVisible();
    await expect(notice.getByText(M.lock.bodyPrevious, { exact: true })).toBeVisible();
    const resume = notice.getByRole('link', { name: M.course.continue, exact: true });
    await expect(resume).toHaveAttribute('href', lessonHref(open.id, open.lesson1.id));
    await expect(resume).toHaveAttribute('data-variant', 'brand');
    // T-08.5-13: the lock page reads the outline only — no player, no material, no buy action.
    await expect(page.getByTestId('lesson-player')).toHaveCount(0);
    await expect(page.getByTestId('lesson-materials')).toHaveCount(0);
    await expect(page.getByRole('link', { name: M.locked.buy })).toHaveCount(0);

    await resume.click();
    await expect(page.getByTestId('member-lesson-page')).toHaveAttribute(
      'data-lesson-id',
      open.lesson1.id,
    );
  });

  test('D-427 / D-430 / UI-D-432 / UI-D-433: lesson 1 plays from the player, "Marcar como concluída" swaps to "Aula concluída" with the toast, and "Próxima aula" turns brand and opens lesson 2, which plays', async ({
    page,
  }) => {
    const { open } = fx;
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}${lessonHref(open.id, open.lesson1.id)}`);

    const lessonPage = page.getByTestId('member-lesson-page');
    await expect(lessonPage).toHaveAttribute('data-lesson-id', open.lesson1.id);
    await expect(page.getByRole('heading', { level: 1, name: open.lesson1.title })).toBeVisible();
    await expectLessonHeadings(page, open.title, open.lesson1.title);
    await expect(page.getByTestId('lesson-player')).toHaveAttribute('data-writes', 'on');
    await expect(page.getByTestId('video-ready')).toBeVisible();
    // 2026-10-23: the "Módulo 01 / Aula 01" pills left; the length stands alone over the title.
    await expect(page.getByTestId('member-lesson-pills')).toHaveCount(0);
    await expect(page.getByTestId('member-lesson-duration')).toHaveText('12:34');
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);

    // 2026-10-26: the side list is the whole course — its one module open (the open lesson's), the
    // current row marked, lesson 2 held by the lesson rule; the course's share on top.
    const outline = page.getByTestId('lesson-module-list');
    await expect(outline).toHaveAttribute('aria-label', M.course.content);
    await expect(outline.getByTestId('lesson-outline-module')).toHaveCount(1);
    await expect(outline.getByRole('button', { expanded: true })).toHaveCount(1);
    await expect(outlineRow(page, open.lesson1.id)).toHaveAttribute('aria-current', 'page');
    await expect(outlineRow(page, open.lesson1.id)).toHaveAttribute('data-current', 'true');
    await expect(outlineRow(page, open.lesson1.id).getByTestId('member-lesson-title')).toHaveText(
      open.lesson1.title,
    );
    await expect(outlineRow(page, open.lesson2.id)).toHaveAttribute('data-trailing', 'locked');
    await expect(
      outline.getByRole('progressbar', {
        name: fill(M.progress.aria, { percent: '0' }),
        exact: true,
      }),
    ).toHaveCount(1);
    // One row between hairlines: the previous (none: the disabled span), the place in the course,
    // the next (held by the lesson rule: the lock and the reason in words).
    const next = page.getByTestId('lesson-next');
    await expect(next).toHaveAttribute('data-variant', 'locked');
    await expect(next).toHaveText(P.nextLockedPrevious);
    const previous = page.getByTestId('lesson-previous');
    await expect(previous).toHaveAttribute('aria-disabled', 'true');
    await expect(previous).toHaveAttribute('data-state', 'disabled');
    await expect(page.getByTestId('lesson-position')).toHaveText(
      fill(P.position, { n: '1', total: '2' }),
    );
    await expect(page.getByTestId('lesson-module-progress')).toHaveText(
      fill(P.moduleProgress, { nn: '01', done: '0', total: '2' }),
    );
    // "Descrição | Materiais": the description first and selected, the materials a tab away.
    const tabs = page.getByTestId('lesson-tabs');
    await expect(tabs.getByRole('tablist', { name: P.tabs.label })).toBeVisible();
    await expect(tabs.getByRole('tab')).toHaveText([P.tabs.description, P.tabs.materials]);
    await expect(tabs.getByRole('tab', { name: P.tabs.description })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('member-lesson-description')).toBeVisible();
    await expect(page.getByTestId('lesson-materials')).toBeHidden();

    await page.getByRole('button', { name: P.complete, exact: true }).click();
    // 2026-10-22: the button fades out, then the done block fades in and takes the focus the
    // button had (the web-first assertions wait out the ~150 ms swap).
    await expect(page.getByTestId('lesson-done')).toHaveText(P.done);
    await expect(page.getByTestId('lesson-done')).toBeFocused();
    await expect(toast(page, P.doneToast)).toBeVisible();
    await expect(page.getByRole('button', { name: P.complete, exact: true })).toHaveCount(0);
    await expect
      .poll(() => lessonProgressOf(users.demoMember, open.lesson1.id))
      .toMatchObject({ completed: true });

    // The refresh re-reads the locks: "Próxima aula" is now the page's one brand fill.
    await expect(next).toHaveAttribute('href', lessonHref(open.id, open.lesson2.id));
    await expect(next).toHaveAttribute('data-variant', 'brand');
    await expect(next).toHaveText(P.next);
    await expect(page.getByTestId('lesson-module-progress')).toHaveText(
      fill(P.moduleProgress, { nn: '01', done: '1', total: '2' }),
    );
    // ...and the side list follows: lesson 1 done, lesson 2 open, the course at 50%.
    await expect(outlineRow(page, open.lesson1.id)).toHaveAttribute('data-trailing', 'done');
    await expect(outlineRow(page, open.lesson2.id)).toHaveAttribute('data-trailing', 'chevron');
    await expect(
      outline.getByRole('progressbar', {
        name: fill(M.progress.aria, { percent: '50' }),
        exact: true,
      }),
    ).toHaveCount(1);

    await next.click();
    await expect(lessonPage).toHaveAttribute('data-lesson-id', open.lesson2.id);
    await expect(page.getByTestId('video-ready')).toBeVisible();
    await expect(page.getByTestId('lesson-previous')).toHaveAttribute(
      'href',
      lessonHref(open.id, open.lesson1.id),
    );
    await expect(page.getByTestId('lesson-position')).toHaveText(
      fill(P.position, { n: '2', total: '2' }),
    );
    await expect(outlineRow(page, open.lesson2.id)).toHaveAttribute('aria-current', 'page');
    // The last lesson of the course: the right slot is "Voltar para o curso".
    await expect(page.getByTestId('lesson-next')).toHaveAttribute('data-variant', 'end');
    await expect(page.getByTestId('lesson-next')).toHaveText(P.toCourse);
  });

  test('COURSE-19 / D-427 / T-08.5-08: "Baixar {file}" opens a fresh token= URL; the page-hide beacon records 42 s; a cross-site Origin is refused', async ({
    page,
  }) => {
    const { open } = fx;
    await page.addInitScript(() => {
      const opened: string[] = [];
      (window as unknown as { __opened: string[] }).__opened = opened;
      window.open = ((url?: string | URL) => {
        if (url) opened.push(String(url));
        return null;
      }) as typeof window.open;
    });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}${lessonHref(open.id, open.lesson1.id)}`);

    // 2026-10-26: the materials are the second tab ("Materiais"), a tap away.
    const materialsTab = page.getByRole('tab', { name: P.tabs.materials, exact: true });
    await untilHydrated(materialsTab);
    await materialsTab.click();
    await expect(materialsTab).toHaveAttribute('aria-selected', 'true');
    const materials = page.getByTestId('lesson-materials');
    await expect(materials.getByRole('heading', { name: P.materials })).toBeVisible();
    await expect(materials.getByTestId('lesson-material-row')).toHaveCount(2);
    await expect(materials.getByTestId('lesson-materials-count')).toContainText('2');
    const file = `${prefix} Protocolo.pdf`;
    await materials.getByRole('button', { name: fill(P.download, { file }), exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened))
      .toHaveLength(1);
    const opened = await page.evaluate(
      () => (window as unknown as { __opened: string[] }).__opened[0] ?? '',
    );
    expect(opened).toContain('token=');
    expect(opened).toContain('/storage/v1/');
    expect(await page.locator('body').innerHTML()).not.toContain(opened);

    // The beacon's own body, posted from the page (same origin, the session cookie).
    const status = await page.evaluate(async (lessonId) => {
      const res = await fetch('/api/courses/progress', {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ lessonId, positionSeconds: 42 }),
      });
      return res.status;
    }, open.lesson1.id);
    expect(status).toBe(204);
    await expect
      .poll(() => lessonProgressOf(users.demoMember, open.lesson1.id))
      .toMatchObject({ lastPositionSeconds: 42 });

    // T-08.5-08: a cross-site post with the member's cookie is refused before any write.
    const refused = await page.request.post(`${hosts.demo}/api/courses/progress`, {
      headers: { origin: 'http://evil.example', 'content-type': 'text/plain;charset=UTF-8' },
      data: JSON.stringify({ lessonId: open.lesson1.id, positionSeconds: 99 }),
    });
    expect(refused.status()).toBe(403);
    expect(await lessonProgressOf(users.demoMember, open.lesson1.id)).toMatchObject({
      lastPositionSeconds: 42,
    });
  });

  test('D-424 / UI-D-431 (purchase): the paid lesson of a locked course is "Aula exclusiva" with "Comprar para liberar" to /loja/{id}?curso= and the free-lesson door', async ({
    page,
  }) => {
    test.skip(!SKETCH_010_APPROVED, GATED_REASON);
    const { locked } = fx;
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}${lessonHref(locked.id, locked.paidLessonId)}`);

    const lock = page.getByTestId('lesson-lock-page');
    await expect(lock).toHaveAttribute('data-reason', 'purchase');
    await expect(
      page.getByRole('heading', { level: 1, name: locked.paidLessonTitle }),
    ).toBeVisible();
    await expectLessonHeadings(page, locked.title, locked.paidLessonTitle);
    await expect(lock.getByTestId('lesson-lock-media')).toContainText(M.lock.pillExclusive);
    const purchase = lock.getByTestId('lesson-lock-purchase');
    await expect(purchase.getByRole('heading', { name: S.course.lessonTitle })).toBeVisible();
    await expect(
      purchase.getByText(fill(S.course.lessonBodyOne, { product: locked.product.name })),
    ).toBeVisible();
    await expect(purchase.getByRole('link', { name: M.locked.buy, exact: true })).toHaveAttribute(
      'href',
      `/loja/${locked.product.id}?curso=${locked.id}`,
    );
    await expect(
      purchase.getByRole('link', { name: M.locked.freeLesson, exact: true }),
    ).toHaveAttribute('href', lessonHref(locked.id, locked.freeLessonId));
    await expect(page.getByTestId('lesson-player')).toHaveCount(0);
    await expect(page.getByTestId('lesson-completion')).toHaveCount(0);
  });

  test('D-429 / E09 partial: the free lesson of the locked course plays for the non-buyer, completes, and its "Próxima aula" reads "Aula exclusiva" (2026-10-23: no "Aula aberta" pill on the lesson page)', async ({
    page,
  }) => {
    const { locked } = fx;
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}${lessonHref(locked.id, locked.freeLessonId)}`);

    await expect(page.getByTestId('member-lesson-page')).toHaveAttribute(
      'data-lesson-id',
      locked.freeLessonId,
    );
    // 2026-10-23: the "Aula aberta" pill left the lesson page (the course page's curriculum still
    // says it, D-424 above).
    await expect(page.getByTestId('member-lesson-pills')).toHaveCount(0);
    await expect(page.getByTestId('video-ready')).toBeVisible();
    const next = page.getByTestId('lesson-next');
    await expect(next).toHaveAttribute('data-variant', 'locked');
    await expect(next).toHaveText(P.nextExclusive);

    await page.getByRole('button', { name: P.complete, exact: true }).click();
    await expect(page.getByTestId('lesson-done')).toHaveText(P.done);
    await expect
      .poll(() => lessonProgressOf(users.demoMember, locked.freeLessonId))
      .toMatchObject({ completed: true });
    // Still exclusive after the refresh: completing a free lesson buys nothing.
    await expect(next).toHaveAttribute('data-variant', 'locked');
    await expect(next).toHaveText(P.nextExclusive);
  });

  test('D-422 / UI-D-437 / T-08.5-17: the admin at ?ver=aluno sees the player (2026-10-23: no banner), no completion zone, and leaves no progress row behind', async ({
    page,
  }) => {
    const { open } = fx;
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}${lessonHref(open.id, open.lesson1.id, true)}`);

    await expect(page.getByTestId('member-lesson-page')).toBeVisible();
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    await expect(page.getByTestId('lesson-player')).toHaveAttribute('data-writes', 'off');
    await expect(page.getByTestId('video-ready')).toBeVisible();
    await expect(page.getByTestId('lesson-completion')).toHaveCount(0);
    await expect(page.getByRole('button', { name: P.complete })).toHaveCount(0);
    // 2026-10-26: the materials are the "Materiais" tab, in preview too.
    const materialsTab = page.getByRole('tab', { name: P.tabs.materials, exact: true });
    await untilHydrated(materialsTab);
    await materialsTab.click();
    await expect(page.getByTestId('lesson-materials')).toBeVisible();
    await expect(page.getByTestId('lesson-see-course')).toHaveAttribute(
      'href',
      `/cursos/${open.id}?ver=aluno`,
    );

    // Leaving the page would fire a page-hide write if the preview had one: it has none.
    await page.goto(`${hosts.demo}/cursos/${open.id}?ver=aluno`);
    await page.waitForTimeout(1000);
    expect(await lessonProgressOf(users.demoAdmin, open.lesson1.id)).toBeNull();

    // Without the flag the admin keeps the lesson form, never the member page.
    await page.goto(`${hosts.demo}${lessonHref(open.id, open.lesson1.id)}`);
    await expect(page.getByTestId('member-lesson-page')).toHaveCount(0);
    await expect(page.getByTestId('lesson-not-found')).toHaveCount(0);
  });

  test('UI-D-441: an unknown lesson, or another course’s lesson under this course, is "Aula indisponível" with the way back to the course', async ({
    page,
  }) => {
    const { open, locked } = fx;
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    for (const lessonId of ['00000000-0000-4000-8000-000000000000', locked.freeLessonId]) {
      await page.goto(`${hosts.demo}${lessonHref(open.id, lessonId)}`);
      const card = page.getByTestId('lesson-not-found');
      await expect(card).toBeVisible();
      await expect(card.getByText(C.notFound.lesson, { exact: true })).toBeVisible();
      await expect(card.getByText(C.notFound.lessonBody, { exact: true })).toBeVisible();
      await expect(
        card.getByRole('link', { name: C.notFound.lessonCta, exact: true }),
      ).toHaveAttribute('href', `/cursos/${open.id}`);
      await expect(page.getByTestId('courses-not-found')).toHaveCount(0);
    }
  });

  test('E09/long-text backstop: at 320px a 2,000-character description clamps to three lines (2026-10-22, the prototype\'s clamp) with "Ler mais" and, expanded, wraps without horizontal overflow', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}${lessonHref(fx.open.id, fx.open.lesson1.id)}`);

    const description = page.getByTestId('member-lesson-description');
    await description.scrollIntoViewIfNeeded();
    expect(await linesOf(description)).toBe(3);
    const toggle = page.getByTestId('read-more-toggle');
    await expect(toggle).toHaveText(M.readMore);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveText(M.readLess);
    expect(await linesOf(description)).toBeGreaterThan(3);
    expect(await description.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});

/**
 * 08.5-09 — the member's live page (D-424, D-431..D-434, UI-D-435, UI-D-436, UI-D-441, COURSE-24,
 * STORE-23), on the phone and on the desktop, gated by sketch 010 (the page has no prototype).
 *
 * The fixture's lives are timed relative to the run's start, so the SERVER decides each page's state
 * on its own clock: in 2 h (before), in 10 min (inside the window, before the start), started 20 min
 * ago (on air), ended with a replay lesson (one ready video, one material), ended without one,
 * cancelled after its planned end, and a live in 10 min locked by a product the member lacks. Every
 * live stores a unique `external_url`, so the PR-1 / T-08.5-07 check reads the whole HTML of a page
 * that must not carry the room link and looks for any part of it.
 *
 * 2026-10-22 (the social-igoralves live page): the status over the cover is the `LiveStatusChip`
 * (the red chip with the breathing dot while on air, ▶ on a replay), the title 22/800 sits under the
 * cover, the replay fades in over it, and "Voltar" / "Ver as lives" lead to the Lives screen
 * (`/area-membros/lives`).
 */
test.describe('live page', () => {
  test.skip(isRemote, 'the live page fixtures write rows through the local database');
  test.skip(!SKETCH_010_APPROVED, 'sketch 010 is not approved yet (D-417): the live page is gated');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  let prefix = '';
  let fx: LivePageFixture;

  const L = M.live;
  const liveHref = (id: string) => `/cursos/lives/${id}`;
  const zone = (page: Page) => page.getByTestId('live-state-zone');
  /** The stored link's distinctive parts: the whole URL and its path token. */
  const urlParts = (url: string) => [url, new URL(url).pathname.slice(1)];

  async function openAsMember(page: Page, id: string) {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}${liveHref(id)}`);
    await expect(page.getByTestId('member-live-page')).toBeVisible();
  }

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    prefix = `e2e-lp-${testInfo.project.name}-${run}`;
    fx = await livePageFixture(prefix);
  });

  test.afterAll(async () => {
    if (prefix) await deleteMemberCatalogueFixture(prefix);
    await deletePlayerStorage();
    await closeCoursesMember();
    await closeCoursesAdmin();
    await closeStoreAdmin();
  });

  test('UI-D-435 before / PR-1: a live in 2 h says when it starts and the hint; no link, and the page HTML holds no part of the stored URL', async ({
    page,
  }) => {
    await openAsMember(page, fx.before.id);
    await expect(page.getByRole('link', { name: L.back, exact: true })).toHaveAttribute(
      'href',
      '/area-membros/lives',
    );
    await expect(page.getByRole('heading', { level: 1, name: fx.before.title })).toBeVisible();
    await expect(page.getByTestId('member-live-status')).toHaveText(C.status.scheduled);
    await expect(page.getByTestId('member-live-meta')).toHaveText(
      /^[a-zçáéíóú]+, \d{1,2} de [a-zç]+, \d{2}:\d{2} · 60 min$/,
    );
    await expect(zone(page)).toHaveAttribute('data-state', 'before');
    await expect(page.getByTestId('live-starts')).toHaveText(
      /^Começa (hoje|em \d{1,2} de [a-zç]+), às \d{2}:\d{2}\.$/,
    );
    await expect(zone(page).getByText(L.joinHint, { exact: true })).toBeVisible();
    await expect(page.getByTestId('live-join')).toHaveCount(0);
    await expect(page.getByRole('link', { name: L.join })).toHaveCount(0);

    const html = await page.content();
    for (const part of urlParts(fx.before.url)) expect(html).not.toContain(part);
  });

  test('UI-D-435 open / T-08.5-16: inside the window before the start, "Entrar na live" is the stored URL in a new tab with noopener, and "Você já pode entrar"', async ({
    page,
  }) => {
    await openAsMember(page, fx.window.id);
    await expect(zone(page)).toHaveAttribute('data-state', 'open');
    const join = page.getByRole('link', { name: L.join, exact: true });
    await expect(join).toHaveAttribute('href', fx.window.url);
    await expect(join).toHaveAttribute('target', '_blank');
    await expect(join).toHaveAttribute('rel', /noopener/);
    await expect(join).toHaveAttribute('rel', /noreferrer/);
    await expect(page.getByTestId('live-join-helper')).toHaveText(
      /^A live começa às \d{2}:\d{2}\. Você já pode entrar\.$/,
    );
    await expect(page.getByTestId('member-live-status')).toHaveText(C.status.scheduled);
  });

  test('UI-D-435 open, on air: "Ao vivo agora" over the cover, "Entrar na live" and "A live acontece fora do app…"', async ({
    page,
  }) => {
    await openAsMember(page, fx.onAir.id);
    await expect(page.getByTestId('member-live-status')).toHaveText(M.lives.liveNow);
    // 2026-10-22: on air is the red chip led by the white dot that breathes.
    await expect(page.getByTestId('member-live-status')).toHaveClass(/\bbg-danger\b/);
    await expect(
      page.getByTestId('member-live-status').getByTestId('live-status-dot'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: L.join, exact: true })).toHaveAttribute(
      'href',
      fx.onAir.url,
    );
    await expect(page.getByTestId('live-join-helper')).toHaveText(L.joinHelper);
  });

  test('D-424 / UI-D-435 locked / PR-1: the locked live inside its window shows "Live exclusiva" and "Comprar para liberar" to /loja/{id}?live=, and its HTML holds no part of the stored URL', async ({
    page,
  }) => {
    await openAsMember(page, fx.locked.id);
    await expect(zone(page)).toHaveAttribute('data-state', 'locked');
    await expect(page.getByTestId('member-live-pills')).toContainText(M.tags.exclusiveLive);
    await expect(
      zone(page).getByRole('heading', { name: S.live.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(fill(S.live.bodyOne, { product: fx.product.name }), { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: M.locked.buy, exact: true })).toHaveAttribute(
      'href',
      `/loja/${fx.product.id}?live=${fx.locked.id}`,
    );
    await expect(page.getByRole('link', { name: L.join })).toHaveCount(0);
    await expect(page.getByTestId('live-join')).toHaveCount(0);

    const html = await page.content();
    for (const part of urlParts(fx.locked.url)) expect(html).not.toContain(part);
  });

  test('D-433 / A-UI-7: "Assistir ao replay" swaps the cover for the player and leaves; "Materiais da gravação" lists the replay lesson\'s one material', async ({
    page,
  }) => {
    await openAsMember(page, fx.replay.id);
    await expect(zone(page)).toHaveAttribute('data-state', 'replay');
    await expect(page.getByTestId('member-live-status')).toHaveText(C.status.recorded);
    const materials = page.getByTestId('live-replay-materials');
    await expect(materials.getByRole('heading', { name: L.replayMaterials })).toBeVisible();
    await expect(materials.getByTestId('lesson-material-row')).toHaveCount(1);
    await expect(materials.getByTestId('lesson-material-name')).toHaveText(fx.replay.materialName);
    await expect(materials.getByTestId('lesson-materials-count')).toHaveText('1 arquivo');
    // A-UI-7: no player (and so no playback mint) before the tap.
    await expect(page.getByTestId('live-replay-player')).toHaveCount(0);
    const cover = await boxOf(page.getByTestId('member-live-cover'));

    const watch = page.getByRole('button', { name: L.watchReplay, exact: true });
    await watch.click();
    const player = page.getByTestId('live-replay-player');
    await expect(player).toBeVisible();
    await expect(player.getByTestId('lesson-player')).toHaveAttribute('data-writes', 'on');
    await expect(player.getByTestId('video-ready')).toBeVisible();
    await expect(page.getByTestId('member-live-cover')).toHaveCount(0);
    await expect(watch).toHaveCount(0);
    // E10 loading: the player box takes the cover's place at the cover's size.
    const box = await boxOf(player);
    expect(Math.abs(box.height - cover.height)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y - cover.y)).toBeLessThanOrEqual(2);
    await expect(materials.getByTestId('lesson-material-row')).toHaveCount(1);
  });

  test('UI-D-435 ended: a live that ended without a replay says so, with no "Gravada" pill over it and no action', async ({
    page,
  }) => {
    await openAsMember(page, fx.ended.id);
    await expect(zone(page)).toHaveAttribute('data-state', 'ended');
    await expect(zone(page)).toHaveText(L.noReplay);
    await expect(page.getByTestId('member-live-status')).toHaveCount(0);
    await expect(page.getByRole('button', { name: L.watchReplay })).toHaveCount(0);
    await expect(page.getByRole('link', { name: L.join })).toHaveCount(0);
  });

  test('D-431 / UI-D-441: a cancelled live keeps its page after its planned end — "Cancelada" and "Esta live foi cancelada."', async ({
    page,
  }) => {
    await openAsMember(page, fx.cancelled.id);
    await expect(page.getByTestId('member-live-status')).toHaveText(C.status.cancelled);
    await expect(page.getByTestId('member-live-page')).toHaveAttribute('data-state', 'cancelled');
    await expect(zone(page)).toHaveAttribute('data-state', 'cancelled');
    await expect(zone(page)).toHaveText(L.cancelled);
    await expect(page.getByRole('link', { name: L.join })).toHaveCount(0);
    await expect(page.getByRole('link', { name: M.locked.buy })).toHaveCount(0);
    const html = await page.content();
    for (const part of urlParts(fx.cancelled.url)) expect(html).not.toContain(part);
  });

  test('UI-D-441: an unknown or crafted live id is "Live indisponível" with "Ver as lives" to the Lives tab', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    for (const id of ['00000000-0000-4000-8000-000000000000', 'nao-e-um-id']) {
      await page.goto(`${hosts.demo}${liveHref(id)}`);
      const card = page.getByTestId('live-not-found');
      await expect(card.getByRole('heading', { name: C.notFound.live })).toBeVisible();
      await expect(card.getByText(C.notFound.liveBody, { exact: true })).toBeVisible();
      await expect(card.getByRole('link', { name: C.notFound.liveCta })).toHaveAttribute(
        'href',
        '/area-membros/lives',
      );
      await expect(page.getByTestId('member-live-page')).toHaveCount(0);
    }
  });

  test('D-434 / planning decision 1: the admin at the same URL keeps the live form', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}${liveHref(fx.window.id)}`);
    await expect(page.locator('[data-live-form]')).toBeVisible();
    await expect(page.getByTestId('member-live-page')).toHaveCount(0);
  });

  test('E10/long-text backstop: at 320px a 120-character title and the long-form date line wrap, and the header title truncates', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 800 });
    await openAsMember(page, fx.long.id);

    const title = page.getByTestId('member-live-title');
    await expect(title).toHaveText(fx.long.title);
    expect(await linesOf(title)).toBeGreaterThan(1);
    expect(await title.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    const meta = page.getByTestId('member-live-meta');
    expect(await meta.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);

    const header = page.getByRole('heading', { level: 1, name: fx.long.title });
    expect(await linesOf(header)).toBe(1);
    expect(await header.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});

/**
 * 08.5-10 — "Ver como aluno" end to end (D-422, UI-D-437, COURSE-25, T-08.5-17, T-08.5-27, EP-35):
 * the admin reaches the member page from the course page's link and sees the banner; a lesson opened
 * from there keeps `?ver=aluno`, plays, opens its material, shows no completion zone, and the visit
 * leaves no progress row for the admin. `?ver=aluno` is ignored for a member and for the
 * `support_tenant` (no banner; the support user keeps the completion zone). A course with no lessons
 * reads "Nenhuma aula ainda" in the admin's preview exactly as for a member.
 *
 * The player fixture lives on rede-demo under its own per-project prefix (the `player` describe's
 * shape); the empty course joins it under the same prefix, so one teardown removes both.
 */
test.describe('preview', () => {
  test.skip(isRemote, 'the preview fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  let prefix = '';
  let fx: PlayerFixture;
  let emptyId = '';

  const P = M.player;
  const lessonHref = (courseId: string, lessonId: string, preview = false) =>
    `/cursos/${courseId}/aulas/${lessonId}${preview ? '?ver=aluno' : ''}`;

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    prefix = `e2e-pv-${testInfo.project.name}-${run}`;
    fx = await playerFixture(prefix);
    emptyId = await createCourse({
      tenantSlug: 'rede-demo',
      title: `${prefix} Sem aulas`,
      status: 'published',
      modules: 1,
      lessonsPerModule: 0,
      minutesAgo: 1,
    });
  });

  test.afterAll(async () => {
    if (prefix) await deleteMemberCatalogueFixture(prefix);
    await deletePlayerStorage();
    await closeCoursesMember();
    await closeCoursesAdmin();
    await closeStoreAdmin();
  });

  test('D-422 / UI-D-437 / T-08.5-17: from "Ver como aluno" the admin lands on the preview; a lesson keeps ?ver=aluno, plays, opens its material, has no completion zone, and no progress row is left', async ({
    page,
  }) => {
    const { open } = fx;
    await page.addInitScript(() => {
      const opened: string[] = [];
      (window as unknown as { __opened: string[] }).__opened = opened;
      window.open = ((url?: string | URL) => {
        if (url) opened.push(String(url));
        return null;
      }) as typeof window.open;
    });
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos/${open.id}`);
    await expect(page.getByTestId('course-page')).toBeVisible();
    await page.getByRole('link', { name: C.course.viewAsMember, exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/cursos/${open.id}\\?ver=aluno$`));
    await expect(page.getByTestId('member-course-page')).toBeVisible();
    // 2026-10-23: as a member sees it, no preview banner.
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);

    // Every lesson is open to staff, and the links keep the flag (2026-10-26: the module's card,
    // then the lesson's card on the module's page).
    const moduleCard = page.getByTestId('member-module-card');
    await expect(moduleCard).toHaveAttribute(
      'href',
      new RegExp(`^/cursos/${open.id}/modulos/[^?]+\\?ver=aluno$`),
    );
    await moduleCard.click();
    await expect(page.getByTestId('member-module-page')).toBeVisible();
    const lesson1Card = page.locator(
      `[data-testid="member-lesson-card"][data-lesson-id="${open.lesson1.id}"]`,
    );
    await expect(lesson1Card).toHaveAttribute('href', lessonHref(open.id, open.lesson1.id, true));
    await lesson1Card.click();
    await expect(page).toHaveURL(
      new RegExp(`/cursos/${open.id}/aulas/${open.lesson1.id}\\?ver=aluno$`),
    );
    await expect(page.getByTestId('member-lesson-page')).toBeVisible();
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    await expect(page.getByTestId('video-ready')).toBeVisible();
    await expect(page.getByTestId('lesson-player')).toHaveAttribute('data-writes', 'off');
    await expect(page.getByTestId('lesson-completion')).toHaveCount(0);
    await expect(page.getByRole('button', { name: P.complete })).toHaveCount(0);

    // The material opens through a fresh token= URL, in preview too (its tab first).
    const materialsTab = page.getByRole('tab', { name: P.tabs.materials, exact: true });
    await untilHydrated(materialsTab);
    await materialsTab.click();
    const materials = page.getByTestId('lesson-materials');
    const file = `${prefix} Protocolo.pdf`;
    await materials.getByRole('button', { name: fill(P.download, { file }), exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened))
      .toHaveLength(1);
    const opened = await page.evaluate(
      () => (window as unknown as { __opened: string[] }).__opened[0] ?? '',
    );
    expect(opened).toContain('token=');

    // Lesson 2 requires lesson 1 for a member, never for the previewing admin: it plays.
    await page.goto(`${hosts.demo}${lessonHref(open.id, open.lesson2.id, true)}`);
    await expect(page.getByTestId('member-lesson-page')).toHaveAttribute(
      'data-lesson-id',
      open.lesson2.id,
    );
    await expect(page.getByTestId('lesson-lock-page')).toHaveCount(0);

    // PR-2: leaving would fire a page-hide write if the preview had one; it has none.
    await page.goto(`${hosts.demo}/cursos/${open.id}?ver=aluno`);
    await page.waitForTimeout(1000);
    expect(await lessonProgressOf(users.demoAdmin, open.lesson1.id)).toBeNull();
    expect(await lessonProgressOf(users.demoAdmin, open.lesson2.id)).toBeNull();
  });

  test("EP-35 / T-08.5-27: a member's ?ver=aluno draws no banner; the support user's neither, and its completion zone stays", async ({
    page,
  }) => {
    const { open } = fx;
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos/${open.id}?ver=aluno`);
    await expect(page.getByTestId('member-course-page')).toBeVisible();
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);

    await page.context().clearCookies();
    await login(page, SUPPORT_EMAIL, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos/${open.id}?ver=aluno`);
    await expect(page.getByTestId('member-course-page')).toBeVisible();
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    await page.goto(`${hosts.demo}${lessonHref(open.id, open.lesson1.id, true)}`);
    await expect(page.getByTestId('member-lesson-page')).toBeVisible();
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    await expect(page.getByTestId('lesson-player')).toHaveAttribute('data-writes', 'on');
    await expect(page.getByRole('button', { name: P.complete, exact: true })).toBeVisible();
  });

  test('EP-35 empty: a course with no lessons reads "Nenhuma aula ainda" in the admin preview, as for a member', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos/${emptyId}?ver=aluno`);
    await expect(page.getByTestId('member-course-page')).toBeVisible();
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    const adminEmpty = page.getByTestId('member-course-no-lessons');
    await expect(adminEmpty).toContainText(M.course.noLessons.title);
    await expect(adminEmpty).toContainText(M.course.noLessons.body);

    await page.context().clearCookies();
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos/${emptyId}`);
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);
    const memberEmpty = page.getByTestId('member-course-no-lessons');
    await expect(memberEmpty).toContainText(M.course.noLessons.title);
    await expect(memberEmpty).toContainText(M.course.noLessons.body);
  });
});
