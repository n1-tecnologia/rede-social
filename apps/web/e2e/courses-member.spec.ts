import { expect, type Locator, type Page, test } from '@playwright/test';
import coursesMessages from '../messages/pt-BR/courses.json' with { type: 'json' };
import memberMessages from '../messages/pt-BR/courses.member.json' with { type: 'json' };
import { closeCoursesAdmin } from './courses-admin';
import {
  closeCoursesMember,
  completeLessonAs,
  deleteMemberCatalogueFixture,
  type MemberCatalogueFixture,
  memberCatalogueFixture,
} from './courses-member';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import { closeStoreAdmin } from './store-admin';

/** The catalog is the source of copy (UI-SPEC Copywriting Contract), never a literal in a spec. */
const C = coursesMessages.courses;
const M = memberMessages.courses.member;

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
