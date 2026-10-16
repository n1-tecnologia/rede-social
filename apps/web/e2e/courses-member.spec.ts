import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page, test } from '@playwright/test';
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
import { closeStoreAdmin } from './store-admin';

/** The catalog is the source of copy (UI-SPEC Copywriting Contract), never a literal in a spec. */
const C = coursesMessages.courses;
const M = memberMessages.courses.member;
/** The store's locked-course words (`store.courses.json`) and the shipped sheet title (`store.json`). */
const S = storeCoursesMessages.store.locked;
const SHEET_TITLE = storeMessages.store.locked.choice.title;

/** ICU `{name}` placeholders filled the way next-intl does for the plain arguments these use. */
function fill(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
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

  test('D-419 / D-420 / UI-D-424 / D-421: the member opens /cursos — the frame, the tabs, no admin control; the locked course with "Exclusivo" and the open one, never the draft', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos`);

    const catalogue = page.getByTestId('courses-member-catalogue');
    await expect(catalogue).toBeVisible();
    await expect(page.getByTestId('courses-hub')).toHaveCount(0);
    await expect(
      catalogue.getByRole('heading', { level: 1, name: M.catalogue.title }),
    ).toBeVisible();
    await expect(
      catalogue.getByText(fill(M.catalogue.subtitle, { tenant: 'Rede Demo' })),
    ).toBeVisible();

    // UI-D-424: the member registry — Cursos (selected) · Lives, and never Trilhas.
    const tabs = catalogue.getByRole('tablist', { name: C.hub.tabs.label });
    const coursesTab = tabs.getByRole('tab', { name: C.hub.tabs.courses });
    await expect(coursesTab).toHaveAttribute('aria-selected', 'true');
    await expect(coursesTab).toHaveAttribute('href', '/cursos?aba=cursos');
    await expect(tabs.getByRole('tab', { name: C.hub.tabs.lives })).toHaveAttribute(
      'href',
      '/cursos?aba=lives',
    );
    await expect(tabs.getByRole('tab')).toHaveCount(2);

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
    await expect(open.getByTestId('course-card-meta')).toHaveText('2 aulas');
    // The cover is always in colour: nothing on a locked card is desaturated or dimmed (PR-3).
    expect(await locked.evaluate((node) => node.innerHTML)).not.toMatch(/grayscale|opacity-50/);

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

  test('UI-D-425: the category chips — "Todas" first and active; a chip narrows the grid; an unknown ?categoria= reads as "Todas"', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos`);

    const chips = page.getByRole('navigation', { name: M.catalogue.categories.label });
    await expect(chips).toBeVisible();
    const all = chips.getByRole('link', { name: M.catalogue.categories.all, exact: true });
    await expect(all).toHaveAttribute('href', '/cursos');
    await expect(chips.getByRole('link').first()).toHaveText(M.catalogue.categories.all);

    await chips.getByRole('link', { name: fx.category.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/cursos\\?categoria=${fx.category.id}$`));
    await expect(courseCard(page, fx.open.title)).toBeVisible();
    await expect(courseCard(page, fx.locked.title)).toHaveCount(0);

    await page.goto(`${hosts.demo}/cursos?categoria=00000000-0000-4000-8000-000000000000`);
    await expect(courseCard(page, fx.locked.title)).toBeVisible();
    await expect(courseCard(page, fx.open.title)).toBeVisible();
  });

  test('D-430 / A-UI-5: after the member completes the locked course’s free lesson, its card shows the h-1 bar and says so in its name', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos`);
    const locked = courseCard(page, fx.locked.title);
    await expect(locked).toBeVisible();
    await expect(locked.getByRole('progressbar')).toHaveCount(0);

    await completeLessonAs(users.demoMember, fx.locked.freeLessonId);
    await page.reload();

    const bar = locked.getByRole('progressbar', { name: fill(M.progress.aria, { percent: '50' }) });
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('aria-valuenow', '50');
    await expect(locked).toHaveAttribute(
      'aria-label',
      `${fx.locked.title}, 2 aulas${M.card.ariaExclusive}${fill(M.card.ariaProgress, { percent: '50' })}`,
    );
    await expect(locked.getByTestId('exclusive-badge')).toBeVisible();
    // No completion elsewhere → no bar on the open course.
    await expect(courseCard(page, fx.open.title).getByRole('progressbar')).toHaveCount(0);
  });

  test('D-431 / UI-D-434 / COURSE-23: ?aba=lives shows "Próximas" (on air, scheduled, cancelled, the locked one with "Exclusiva") then "Gravadas"; an ended live without a replay is absent', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos?aba=lives`);

    const tabs = page.getByRole('tablist', { name: C.hub.tabs.label });
    await expect(tabs.getByRole('tab', { name: C.hub.tabs.lives })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    const upcomingTitle = page.getByRole('heading', { name: M.lives.upcoming, exact: true });
    const recordedTitle = page.getByRole('heading', { name: M.lives.recorded, exact: true });
    await expect(upcomingTitle).toBeVisible();
    await expect(recordedTitle).toBeVisible();
    expect((await boxOf(upcomingTitle)).y).toBeLessThan((await boxOf(recordedTitle)).y);

    const upcoming = page.getByTestId('lives-member-upcoming');
    const onAir = liveCard(upcoming, fx.lives.onAir.title);
    await expect(onAir.getByTestId('live-card-status')).toHaveText(M.lives.liveNow);
    await expect(
      liveCard(upcoming, fx.lives.scheduled.title).getByTestId('live-card-status'),
    ).toHaveText(C.status.scheduled);
    const cancelled = liveCard(upcoming, fx.lives.cancelled.title);
    await expect(cancelled.getByTestId('live-card-status')).toHaveText(C.status.cancelled);
    await expect(cancelled.getByTestId('live-card-title')).toHaveClass(/text-text-secondary/);
    const lockedLive = liveCard(upcoming, fx.lives.locked.title);
    await expect(lockedLive.getByTestId('exclusive-badge')).toHaveText(M.tags.exclusiveLive);
    await expect(lockedLive).toHaveAttribute('aria-label', new RegExp(`${M.lives.ariaExclusive}$`));
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
    await expect(
      liveCard(recorded, fx.lives.recorded.title).getByTestId('live-card-status'),
    ).toHaveText(C.status.recorded);
    await expect(liveCard(recorded, fx.lives.onAir.title)).toHaveCount(0);

    // D-431: an ended live without a replay is in neither group.
    await expect(liveCard(page.locator('main'), fx.lives.ended.title)).toHaveCount(0);
  });

  test('UI-D-424 / UI-D-437: the admin gets the hub at /cursos and the member catalogue at /cursos?ver=aluno, its links keeping the flag', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos`);
    await expect(page.getByTestId('courses-hub')).toBeVisible();
    await expect(page.getByTestId('courses-member-catalogue')).toHaveCount(0);

    await page.goto(`${hosts.demo}/cursos?ver=aluno`);
    await expect(page.getByTestId('courses-member-catalogue')).toBeVisible();
    await expect(page.getByTestId('courses-hub')).toHaveCount(0);
    await expect(page.locator('a[href="/cursos/novo"]')).toHaveCount(0);
    // Staff are never locked (UI-D-442): no "Exclusivo" on the manager's preview.
    const locked = courseCard(page, fx.locked.title);
    await expect(locked).toHaveAttribute('href', `/cursos/${fx.locked.id}?ver=aluno`);
    await expect(locked.getByTestId('exclusive-badge')).toHaveCount(0);
    await expect(
      page.getByRole('tablist', { name: C.hub.tabs.label }).getByRole('tab', {
        name: C.hub.tabs.lives,
      }),
    ).toHaveAttribute('href', '/cursos?aba=lives&ver=aluno');

    // A member's ?ver= is ignored: it can only ever choose the member view.
    await page.context().clearCookies();
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos?ver=admin`);
    await expect(page.getByTestId('courses-member-catalogue')).toBeVisible();
    await expect(courseCard(page, fx.locked.title)).toHaveAttribute(
      'href',
      `/cursos/${fx.locked.id}`,
    );
  });

  test('E03/long-text backstop: at 320px a 120-character locked title with "Exclusivo" and "Produto arquivado" keeps both tags readable, the title at two lines and the meta above the bar', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await completeLessonAs(users.demoMember, fx.long.freeLessonId);
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos`);

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
      // Readable: the pill shows all of its own words, never an ellipsis.
      expect(await tag.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    }

    const title = card.getByTestId('course-card-title');
    expect(await linesOf(title)).toBe(2);
    expect(await title.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await expect(title).toHaveText(fx.long.title);

    // The tags sit above the title, and the meta sits above the pinned bar.
    const archivedBox = await boxOf(archived);
    const titleBox = await boxOf(title);
    expect(archivedBox.y + archivedBox.height).toBeLessThanOrEqual(titleBox.y);
    const meta = card.getByTestId('course-card-meta');
    await expect(meta).toBeVisible();
    const bar = card.getByRole('progressbar');
    await expect(bar).toBeVisible();
    const metaBox = await boxOf(meta);
    const barBox = await boxOf(bar);
    expect(metaBox.y + metaBox.height).toBeLessThanOrEqual(barBox.y);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test('UI-D-441: with the school off (rede-lab) /cursos is the kernel not-found for the member and the admin', async ({
    page,
  }) => {
    await login(page, users.labMember, SEED_PASSWORD, hosts.lab);
    await page.goto(`${hosts.lab}/cursos`);
    await expectKernelNotFound(page);
    await page.goto(`${hosts.lab}/cursos?aba=lives`);
    await expectKernelNotFound(page);

    await page.context().clearCookies();
    await login(page, users.labAdmin, SEED_PASSWORD, hosts.lab);
    await page.goto(`${hosts.lab}/cursos`);
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
 */
test.describe('course page', () => {
  test.skip(isRemote, 'the course-page fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  let prefix = '';
  let fx: CoursePageFixture;

  const band = (page: Page, moduleId: string): Locator =>
    page.locator(`[data-testid="module-cover"][data-module-id="${moduleId}"]`);
  const row = (page: Page, lessonId: string): Locator =>
    page.locator(`[data-testid="member-lesson-row"][data-lesson-id="${lessonId}"]`);
  const lessonHref = (courseId: string, lessonId: string, preview = false) =>
    `/cursos/${courseId}/aulas/${lessonId}${preview ? '?ver=aluno' : ''}`;

  /** "Libera ao concluir o Módulo 01", from the catalog, pinned to its words once. */
  const lockModule01 = fill(M.module.lockedBy, { nn: '01' });

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

  test('D-430 / UI-D-427 / UI-D-429 / UI-D-430: 0% "Começar", then the h-2 bar and "Continuar", the module rule in words until module 1 is complete, then "Curso concluído" and the outline "Rever"', async ({
    page,
  }) => {
    expect(lockModule01).toBe('Libera ao concluir o Módulo 01');
    const { open } = fx;
    const [m1, m2] = open.moduleIds;
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos/${open.id}`);

    // D-423: the member page, never the admin one; the header names the course.
    await expect(page.getByTestId('member-course-page')).toBeVisible();
    await expect(page.getByTestId('course-page')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: open.title })).toBeVisible();
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);

    // 0% (EP-11): the "{N} aulas · {duration}" line and the brand link to the first open lesson.
    const zone = page.getByTestId('member-course-actions');
    await expect(zone.getByTestId('course-action')).toHaveAttribute('data-variant', 'start');
    await expect(zone.getByTestId('course-action-line')).toContainText('21 min');
    await expect(zone.getByRole('progressbar')).toHaveCount(0);
    const start = zone.getByRole('link', { name: M.course.start, exact: true });
    await expect(start).toHaveAttribute('href', lessonHref(open.id, open.videoLessonId));

    // UI-D-429: module 1 opens at 0%; module 2's band says its rule in words and opens on tap.
    await expect(band(page, m1)).toHaveAttribute('aria-expanded', 'true');
    await expect(band(page, m1)).toBeEnabled();
    await expect(band(page, m2)).toHaveAttribute('aria-expanded', 'false');
    await expect(band(page, m2)).toBeEnabled();
    await expect(band(page, m2).getByTestId('module-cover-meta')).toHaveText(lockModule01);
    await expect(band(page, m2)).toHaveAttribute('data-state', 'locked');

    // UI-D-430: rows say their state in words — "12:34", "Prática".
    await expect(row(page, open.videoLessonId).getByTestId('member-lesson-meta')).toHaveText(
      '12:34',
    );
    await expect(row(page, open.practiceLessonId).getByTestId('member-lesson-meta')).toHaveText(
      M.lesson.practice,
    );
    await expect(row(page, open.videoLessonId)).toHaveAttribute(
      'href',
      lessonHref(open.id, open.videoLessonId),
    );

    await band(page, m2).click();
    await expect(band(page, m2)).toHaveAttribute('aria-expanded', 'true');
    await expect(band(page, m2)).toBeFocused();
    const held = row(page, open.secondModuleLessonId);
    await expect(held.getByTestId('member-lesson-meta')).toHaveText(
      fill(M.lesson.lockedByModule, { nn: '01' }),
    );
    await expect(held).toHaveAttribute('data-trailing', 'locked');
    // A-UI-3: a locked row is still a link to its lesson.
    await expect(held).toHaveAttribute('href', lessonHref(open.id, open.secondModuleLessonId));

    // 1 of 3 (EP-11 continue): the h-2 bar, the line and "Continuar o curso" to the next open lesson.
    await completeLessonAs(users.demoMember, open.videoLessonId);
    await page.reload();
    await expect(zone.getByTestId('course-action')).toHaveAttribute('data-variant', 'continue');
    const bar = zone.getByRole('progressbar', { name: fill(M.progress.aria, { percent: '33' }) });
    await expect(bar).toHaveAttribute('aria-valuenow', '33');
    await expect(bar).toHaveClass(/\bh-2\b/);
    await expect(zone.getByTestId('course-action-line')).toHaveText(
      fill(M.course.progressLine, { percent: '33', done: '1', total: '3' }),
    );
    await expect(zone.getByRole('link', { name: M.course.continue, exact: true })).toHaveAttribute(
      'href',
      lessonHref(open.id, open.practiceLessonId),
    );
    await expect(row(page, open.videoLessonId)).toHaveAttribute('data-trailing', 'done');
    await expect(band(page, m2).getByTestId('module-cover-meta')).toHaveText(lockModule01);

    // Module 1 complete (EP-12): its band reads "Concluído", module 2 opens alone and loses its lock.
    await completeLessonAs(users.demoMember, open.practiceLessonId);
    await page.reload();
    await expect(band(page, m1).getByTestId('module-cover-pill')).toHaveText(M.module.done);
    await expect(band(page, m1)).toHaveAttribute('data-state', 'done');
    await expect(band(page, m1)).toHaveAttribute('aria-expanded', 'false');
    await expect(band(page, m2)).toHaveAttribute('aria-expanded', 'true');
    await expect(band(page, m2).getByTestId('module-cover-meta')).not.toHaveText(lockModule01);
    await expect(row(page, open.secondModuleLessonId)).toHaveAttribute('data-trailing', 'chevron');

    // 100%: the done line with its check, the OUTLINE "Rever o curso" to the first lesson, no bar.
    await completeLessonAs(users.demoMember, open.secondModuleLessonId);
    await page.reload();
    await expect(zone.getByTestId('course-action')).toHaveAttribute('data-variant', 'done');
    await expect(zone.getByTestId('course-action-line')).toHaveText(
      fill(M.course.doneLine, { total: '3' }),
    );
    const review = zone.getByRole('link', { name: M.course.review, exact: true });
    await expect(review).toHaveAttribute('href', lessonHref(open.id, open.videoLessonId));
    await expect(review).toHaveClass(/border-border-secondary/);
    await expect(review).not.toHaveClass(/bg-button/);
    await expect(zone.getByRole('progressbar')).toHaveCount(0);
    for (const id of open.moduleIds) {
      await expect(band(page, id)).toHaveAttribute('aria-expanded', 'false');
    }
  });

  test('D-424 / UI-D-428 (b) / STORE-23: two products → "Curso exclusivo", the button opens "Opções de acesso" with both rows; "Aula aberta" and "Aula exclusiva" rows; the page HTML never carries a locked lesson’s description', async ({
    page,
  }) => {
    const { lockedMany: course } = fx;
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    const url = `${hosts.demo}/cursos/${course.id}`;
    await page.goto(url);

    await expect(page.getByTestId('member-course-hero').getByTestId('exclusive-badge')).toHaveText(
      M.tags.exclusiveCourse,
    );
    const section = page.getByTestId('locked-section');
    await expect(section).toContainText(S.course.title);
    await expect(section).toContainText(fill(S.course.bodyMany, { course: course.title }));
    await expect(page.getByTestId('member-course-actions').getByRole('progressbar')).toHaveCount(0);

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

    // UI-D-430 partial: the free lesson is "Aula aberta"; the paid one "Aula exclusiva", a lock, a link.
    await expect(row(page, course.freeLessonId).getByTestId('member-lesson-meta')).toHaveText(
      `4:10${M.lesson.free}`,
    );
    const paid = row(page, course.paidLessonId);
    await expect(paid.getByTestId('member-lesson-meta')).toHaveText(
      fill(M.lesson.exclusive, { duration: '12:34' }),
    );
    await expect(paid).toHaveAttribute('data-trailing', 'locked');
    await expect(paid).toHaveAttribute(
      'aria-label',
      fill(M.lesson.aria, { lesson: course.paidLessonTitle, state: M.lesson.stateExclusive }),
    );
    await expect(paid).toHaveAttribute('href', lessonHref(course.id, course.paidLessonId));
    expect(await paid.evaluate((node) => node.innerHTML)).not.toMatch(/grayscale/);

    // T-08.5-13 / PR-1: the titles ship, the descriptions never — neither in the DOM nor in the
    // server's HTML with its inline RSC payload.
    const html = await page.content();
    expect(html).toContain(course.paidLessonTitle);
    expect(html).not.toContain(course.paidMarker);
    expect(html).not.toContain(course.freeMarker);
    const raw = await (await page.request.get(url)).text();
    expect(raw).toContain(course.title);
    expect(raw).not.toContain(course.paidMarker);
    expect(raw).not.toContain(course.freeMarker);

    // The free-lesson door leads to the first free lesson.
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

  test('D-422 / UI-D-437 / COURSE-25: the admin at ?ver=aluno sees the banner and every lesson open, links keep the flag; without it the admin page; a member’s ?ver=aluno draws no banner', async ({
    page,
  }) => {
    const { lockedMany: course } = fx;
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);

    await page.goto(`${hosts.demo}/cursos/${course.id}`);
    await expect(page.getByTestId('course-page')).toBeVisible();
    await expect(page.getByTestId('member-course-page')).toHaveCount(0);

    await page.goto(`${hosts.demo}/cursos/${course.id}?ver=aluno`);
    const banner = page.getByTestId('preview-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(M.preview.title);
    await expect(banner).toContainText(M.preview.body);
    await expect(banner.getByRole('link', { name: M.preview.back })).toHaveAttribute(
      'href',
      `/cursos/${course.id}`,
    );
    // Staff are never locked: no tag, no buy section, the paid lesson open and linked in preview.
    await expect(page.getByTestId('exclusive-badge')).toHaveCount(0);
    await expect(page.getByTestId('course-locked-zone')).toHaveCount(0);
    const paid = row(page, course.paidLessonId);
    await expect(paid).toHaveAttribute('data-trailing', 'chevron');
    await expect(paid.getByTestId('member-lesson-meta')).toHaveText('12:34');
    await expect(paid).toHaveAttribute('href', lessonHref(course.id, course.paidLessonId, true));
    await expect(page.getByRole('link', { name: M.course.start, exact: true })).toHaveAttribute(
      'href',
      lessonHref(course.id, course.freeLessonId, true),
    );

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

  test('E05/long-text backstop: at 320px a 120-character title and a 160-character tagline wrap under the hero and the header title truncates', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos/${fx.long.id}`);

    const hero = page.getByTestId('member-course-hero');
    const title = page.getByTestId('member-course-title');
    const tagline = page.getByTestId('member-course-tagline');
    await expect(title).toHaveText(fx.long.title);
    await expect(tagline).toHaveText(fx.long.tagline);
    const heroBox = await boxOf(hero);
    for (const text of [title, tagline]) {
      const box = await boxOf(text);
      expect(box.y).toBeGreaterThanOrEqual(heroBox.y + heroBox.height);
      expect(box.x + box.width).toBeLessThanOrEqual(320 + 0.5);
      expect(await linesOf(text)).toBeGreaterThanOrEqual(2);
    }
    const header = page.getByRole('heading', { level: 1, name: fx.long.title });
    expect(await header.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    expect(await header.evaluate((node) => getComputedStyle(node).textOverflow)).toBe('ellipsis');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test('E07/overflow backstop: at 320px a two-line lesson title with "Libera ao concluir o Módulo 02" keeps the 80px thumb and the trailing lock inside the row', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/cursos/${fx.long.id}`);

    const module3 = band(page, fx.long.module3Id);
    await module3.scrollIntoViewIfNeeded();
    await module3.click();
    await expect(module3).toHaveAttribute('aria-expanded', 'true');
    const lessonRow = row(page, fx.long.longLessonId);
    await lessonRow.scrollIntoViewIfNeeded();
    await expect(lessonRow.getByTestId('member-lesson-meta')).toHaveText(
      fill(M.lesson.lockedByModule, { nn: '02' }),
    );
    const rowBox = await boxOf(lessonRow);
    const thumb = await boxOf(lessonRow.getByTestId('member-lesson-thumb'));
    const trailing = await boxOf(lessonRow.getByTestId('member-lesson-trailing'));
    expect(thumb.width).toBeCloseTo(80, 0);
    for (const box of [thumb, trailing]) {
      expect(box.x).toBeGreaterThanOrEqual(rowBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
      expect(box.y).toBeGreaterThanOrEqual(rowBox.y);
      expect(box.y + box.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 0.5);
    }
    expect(await linesOf(lessonRow.getByTestId('member-lesson-title'))).toBe(2);
    await expect(lessonRow).toHaveAttribute('data-trailing', 'locked');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
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
    await expect(lock.getByTestId('lesson-lock-media')).toContainText(M.lock.pillLocked);
    await expect(lock.getByTestId('lesson-lock-pills')).toContainText(fill(P.module, { nn: '01' }));
    await expect(lock.getByTestId('lesson-lock-pills')).toContainText(fill(P.lesson, { nn: '02' }));
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
    await expect(page.getByTestId('lesson-player')).toHaveAttribute('data-writes', 'on');
    await expect(page.getByTestId('video-ready')).toBeVisible();
    const pills = page.getByTestId('member-lesson-pills');
    await expect(pills).toContainText(fill(P.module, { nn: '01' }));
    await expect(pills).toContainText(fill(P.lesson, { nn: '01' }));
    await expect(pills).toContainText('12:34');
    await expect(page.getByTestId('preview-banner')).toHaveCount(0);

    // The module list marks the current row; the next lesson is held by the lesson rule.
    await expect(
      page.locator(`[data-testid="member-lesson-row"][data-lesson-id="${open.lesson1.id}"]`),
    ).toHaveAttribute('aria-current', 'page');
    const next = page.getByTestId('lesson-next');
    await expect(next).toHaveAttribute('data-variant', 'locked');
    await expect(next).toHaveText(P.nextLockedPrevious);
    await expect(page.getByTestId('lesson-previous')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('lesson-module-progress')).toHaveText(
      fill(P.moduleProgress, { nn: '01', done: '0', total: '2' }),
    );

    await page.getByRole('button', { name: P.complete, exact: true }).click();
    await expect(page.getByTestId('lesson-done')).toHaveText(P.done);
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

    await next.click();
    await expect(lessonPage).toHaveAttribute('data-lesson-id', open.lesson2.id);
    await expect(page.getByTestId('video-ready')).toBeVisible();
    await expect(page.getByTestId('lesson-previous')).toHaveAttribute(
      'href',
      lessonHref(open.id, open.lesson1.id),
    );
    // The last lesson of the course: the right slot is "Voltar para o curso".
    await expect(page.getByTestId('lesson-next')).toHaveAttribute('data-variant', 'end');
    await expect(page.getByTestId('lesson-next')).toHaveText(P.back);
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

  test('D-429 / E09 partial: the free lesson of the locked course plays for the non-buyer, "Aula aberta", completes, and its "Próxima aula" reads "Aula exclusiva"', async ({
    page,
  }) => {
    const { locked } = fx;
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}${lessonHref(locked.id, locked.freeLessonId)}`);

    await expect(page.getByTestId('member-lesson-page')).toHaveAttribute(
      'data-lesson-id',
      locked.freeLessonId,
    );
    await expect(page.getByTestId('member-lesson-pills')).toContainText(P.free);
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

  test('D-422 / UI-D-437 / T-08.5-17: the admin at ?ver=aluno sees the banner and the player, no completion zone, and leaves no progress row behind', async ({
    page,
  }) => {
    const { open } = fx;
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}${lessonHref(open.id, open.lesson1.id, true)}`);

    await expect(page.getByTestId('member-lesson-page')).toBeVisible();
    await expect(page.getByTestId('preview-banner')).toBeVisible();
    await expect(page.getByTestId('lesson-player')).toHaveAttribute('data-writes', 'off');
    await expect(page.getByTestId('video-ready')).toBeVisible();
    await expect(page.getByTestId('lesson-completion')).toHaveCount(0);
    await expect(page.getByRole('button', { name: P.complete })).toHaveCount(0);
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

  test('E09/long-text backstop: at 320px a 2,000-character description clamps to four lines with "Ler mais" and, expanded, wraps without horizontal overflow', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}${lessonHref(fx.open.id, fx.open.lesson1.id)}`);

    const description = page.getByTestId('member-lesson-description');
    await description.scrollIntoViewIfNeeded();
    expect(await linesOf(description)).toBe(4);
    const toggle = page.getByTestId('read-more-toggle');
    await expect(toggle).toHaveText(M.readMore);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveText(M.readLess);
    expect(await linesOf(description)).toBeGreaterThan(4);
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
    await expect(page.getByRole('link', { name: L.back })).toHaveAttribute(
      'href',
      '/cursos?aba=lives',
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
        '/cursos?aba=lives',
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
    const banner = page.getByTestId('preview-banner');
    await expect(banner).toContainText(M.preview.title);
    await expect(banner).toContainText(M.preview.body);

    // Every lesson is open to staff, and the row keeps the flag.
    const lesson1Row = page.locator(
      `[data-testid="member-lesson-row"][data-lesson-id="${open.lesson1.id}"]`,
    );
    await expect(lesson1Row).toHaveAttribute('href', lessonHref(open.id, open.lesson1.id, true));
    await lesson1Row.click();
    await expect(page).toHaveURL(
      new RegExp(`/cursos/${open.id}/aulas/${open.lesson1.id}\\?ver=aluno$`),
    );
    await expect(page.getByTestId('member-lesson-page')).toBeVisible();
    await expect(page.getByTestId('preview-banner')).toBeVisible();
    await expect(page.getByTestId('video-ready')).toBeVisible();
    await expect(page.getByTestId('lesson-player')).toHaveAttribute('data-writes', 'off');
    await expect(page.getByTestId('lesson-completion')).toHaveCount(0);
    await expect(page.getByRole('button', { name: P.complete })).toHaveCount(0);

    // The material opens through a fresh token= URL, in preview too.
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
    await expect(page.getByTestId('preview-banner')).toBeVisible();
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
