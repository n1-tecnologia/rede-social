import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page, test } from '@playwright/test';
import appCoursesMessages from '../messages/pt-BR/app.courses.json' with { type: 'json' };
import coursesMessages from '../messages/pt-BR/courses.json' with { type: 'json' };
import mediaMessages from '../messages/pt-BR/media.json' with { type: 'json' };
import {
  type CoursesTenant,
  categoryByName,
  closeCoursesAdmin,
  courseByTitle,
  courseCoverAssetId,
  courseModules,
  courseProductIds,
  courseStatus,
  createCourse,
  createCoursesTenant,
  createLesson,
  createLessonWithProcessingVideo,
  createLive,
  createMaterials,
  deleteCoursesTenant,
  deleteFakeProviderEvents,
  deleteLivesByPrefix,
  deleteTracksByPrefix,
  deliverFakeReadyEvent,
  dropFakeReadyJob,
  lessonAssetState,
  lessonByTitle,
  lessonMaterials,
  linkCourseProduct,
  linkLiveProduct,
  liveByTitle,
  markAssetReady,
  newestLessonAssetIn,
  setCourseStatus,
  setModuleEnabled,
  tenantTimezone,
  trackByTitle,
  trackCourseIds,
} from './courses-admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import { landscapePng } from './media-fixtures';
import {
  closeStoreAdmin,
  createProduct,
  setProductStatus,
  waitForReadyCoverIn,
} from './store-admin';
import { ensureWorker } from './worker';

/** The catalog is the source of copy (UI-SPEC Copywriting Contract), never a literal in a spec. */
const C = coursesMessages.courses;
const SETTINGS_ROW = appCoursesMessages.app.settings.rows.courses;

/** ICU `{name}` placeholders filled the way next-intl does for the plain arguments these use. */
function fill(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}

/**
 * 08.3-06 — the school's browse surfaces (COURSE-14, D-402, UI-D-389..392, UI-D-401, UI-D-412), on
 * the phone (`mobile-chromium`, `pixel-chromium`) and on the desktop: the Configurações "Cursos" row
 * after Loja and before Mídia, the `/cursos` hub with its area tabs, the Cursos tab's chips and the
 * "Categorias" row, the per-filter empty states, the rows with their pills (the draft's second
 * "Processando"), the member's not-found, and the module being off.
 *
 * The seed turns `courses` ON for rede-demo with no course (Pitfall 9), and the three projects run
 * in parallel against the same database, so every emptiness and every fixture lives on a THROWAWAY
 * tenant per project (`courses-admin.ts`); the seed cases assert only what the seed guarantees (the
 * admin's door, the hub frame, the member's catalogue).
 *
 * `serviceWorkers: 'block'`: a worker answering navigations from its cache would have these
 * assertions read what a previous run left behind (the 03-05 lesson).
 */
test.use({ serviceWorkers: 'block' });
test.describe.configure({ timeout: 120_000 });

/** The hrefs of the Administração rows the plan orders: Loja, Cursos, Mídia (UI-D-389, P54). */
async function adminRowOrder(page: Page): Promise<string[]> {
  return page
    .locator('main a[href]')
    .evaluateAll((links) =>
      links
        .map((link) => link.getAttribute('href'))
        .filter(
          (href) => href === '/loja' || href === '/cursos' || href === '/configuracoes/midia',
        ),
    );
}

/** The kernel's generic not-found: no hub, no "Cursos" h1, Next's 404 heading. */
async function expectKernelNotFound(page: Page): Promise<void> {
  await expect(page.getByTestId('courses-hub')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: C.hub.title })).toHaveCount(0);
  await expect(page.getByTestId('courses-not-found')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
}

test.describe('browse', () => {
  test.skip(isRemote, 'the courses fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  let prefix = '';
  let tenant: CoursesTenant;
  const titles = { draft: '', published: '' };
  const ids = { draft: '', published: '' };

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    prefix = `e2e-cr-${testInfo.project.name}-${run}`;
    // One slug per project (idempotent): the parallel projects never read each other's school.
    tenant = await createCoursesTenant(`e2e-cr-${testInfo.project.name}`, SEED_PASSWORD, ['store']);
    titles.draft = `${prefix} Rascunho com vídeo`;
    titles.published = `${prefix} Publicado`;
  });

  test.afterAll(async () => {
    if (tenant) await deleteCoursesTenant(tenant.slug);
    await closeCoursesAdmin();
  });

  test('on the seed: the admin has the Cursos row after Loja and before Mídia and reaches the hub through it and the Cursos tab; the member has no row (UI-D-389, UI-D-412, D-419)', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/configuracoes`);
    expect(await adminRowOrder(page)).toEqual(['/loja', '/cursos', '/configuracoes/midia']);
    await page.locator('main').getByRole('link', { name: SETTINGS_ROW, exact: true }).click();
    await expect(page).toHaveURL(/\/cursos$/);
    await expect(page.getByRole('heading', { level: 1, name: C.hub.title })).toBeVisible();
    await expect(page.getByText(fill(C.hub.subtitle, { tenant: 'Rede Demo' }))).toBeVisible();
    // 08.5-11 (D-419, UI-D-423; was D-401's "no chrome for the school" in 08.3): the school is ONE
    // tab, in the BottomNav and the rail (both trees are in the DOM), never a TopBar slot; it is the
    // current tab on the hub too. The shell's chrome only: the hub's own links are not counted.
    await expect(page.locator('[data-shell-nav] a[href="/cursos"]')).toHaveCount(2);
    await expect(page.locator('header a[href="/cursos"]')).toHaveCount(0);
    await expect(page.locator('[data-shell-nav="bottom"] a[href="/cursos"]')).toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.context().clearCookies();
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/configuracoes`);
    await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
    // Scoped to the page: since 08.5-11 the shell's Cursos TAB carries the same name (D-419).
    await expect(
      page.locator('main').getByRole('link', { name: SETTINGS_ROW, exact: true }),
    ).toHaveCount(0);
    // 08.5 (D-419): the member's /cursos is the member frame, never the hub; 08.6 (D-435): bare
    // /cursos opens Início inside it, and the catalogue body is at ?aba=cursos.
    await page.goto(`${hosts.demo}/cursos`);
    await expect(page.getByTestId('courses-member-catalogue')).toBeVisible();
    await expect(page.getByTestId('courses-member-home')).toBeVisible();
    await expect(page.getByTestId('courses-hub')).toHaveCount(0);
    await page.goto(`${hosts.demo}/cursos?aba=cursos`);
    await expect(
      page.getByTestId('courses-member-catalogue').getByTestId('courses-member-courses'),
    ).toBeVisible();
  });

  test('UI-D-390 / UI-D-391 / P55: the hub frame, the tabs, the four chips, the Categorias row at 0 and the Todos empty state with Criar curso', async ({
    page,
  }, testInfo) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/configuracoes`);
    // P54: with both store and courses on, both rows render, Cursos between Loja and Mídia.
    expect(await adminRowOrder(page)).toEqual(['/loja', '/cursos', '/configuracoes/midia']);
    await page.locator('main').getByRole('link', { name: SETTINGS_ROW, exact: true }).click();
    await expect(page).toHaveURL(/\/cursos$/);

    const hub = page.getByTestId('courses-hub');
    await expect(hub.getByRole('heading', { level: 1, name: C.hub.title })).toBeVisible();
    await expect(hub.getByText(fill(C.hub.subtitle, { tenant: tenant.displayName }))).toBeVisible();

    // UI-D-390: the area tabs are a named tablist of LINKS; Cursos is selected, Trilhas (08.3-10)
    // beside it in the P57 order.
    const tabs = hub.getByRole('tablist', { name: C.hub.tabs.label });
    await expect(tabs).toBeVisible();
    const coursesTab = tabs.getByRole('tab', { name: C.hub.tabs.courses });
    await expect(coursesTab).toHaveAttribute('aria-selected', 'true');
    await expect(coursesTab).toHaveAttribute('href', '/cursos?aba=cursos');
    const tracksTab = tabs.getByRole('tab', { name: C.hub.tabs.tracks });
    await expect(tracksTab).toHaveAttribute('aria-selected', 'false');
    await expect(tracksTab).toHaveAttribute('href', '/cursos?aba=trilhas');

    // UI-D-391: the title row with the brand create control, then the chips in the P57 order.
    await expect(hub.getByRole('heading', { level: 2, name: C.hub.tabs.courses })).toBeVisible();
    await expect(hub.getByRole('link', { name: C.hub.create.course })).toHaveAttribute(
      'href',
      '/cursos/novo',
    );
    const chips = hub.getByRole('navigation', { name: C.list.filter.label });
    await expect(chips.getByRole('link')).toHaveText([
      C.list.filter.all,
      C.list.filter.drafts,
      C.list.filter.published,
      C.list.filter.archived,
    ]);
    await expect(chips.getByRole('link', { name: C.list.filter.all })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // P55: the Categorias row reads 0 on a tenant with no category; it opens the manager.
    const categories = hub.getByTestId('courses-categories-row');
    await expect(categories).toHaveAccessibleName(fill(C.list.categories.aria, { N: '0' }));
    await expect(categories).toHaveAttribute('href', '/cursos/categorias');
    await expect(hub.getByTestId('courses-categories-count')).toHaveText('0');

    // E03 empty: the manager copy with the brand "Criar curso".
    const empty = hub.getByTestId('courses-empty');
    await expect(empty.getByRole('heading', { name: C.list.empty.title })).toBeVisible();
    await expect(empty).toContainText(C.list.empty.body);
    await expect(empty.getByRole('link', { name: C.list.empty.cta })).toHaveAttribute(
      'href',
      '/cursos/novo',
    );

    // E03 overflow (the mobile project): at 320px the four chips do not fit and the row scrolls
    // with the scrollbar hidden; the chips never wrap.
    if (testInfo.project.name === 'mobile-chromium') {
      await page.setViewportSize({ width: 320, height: 800 });
      const metrics = await chips.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        overflowX: getComputedStyle(el).overflowX,
        flexWrap: getComputedStyle(el).flexWrap,
      }));
      expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
      expect(metrics.overflowX).toBe('auto');
      expect(metrics.flexWrap).toBe('nowrap');
      await expect(chips.getByRole('link', { name: C.list.filter.all })).toBeVisible();
    }
  });

  test('P55 / E03 partial: Rascunhos, Publicados and Arquivados show their own copy without action; unknown ?filtro= and ?aba= read as the defaults', async ({
    page,
  }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);

    await page.goto(`${tenant.origin}/cursos?filtro=rascunhos`);
    const drafts = page.getByTestId('courses-empty-drafts');
    await expect(drafts.getByRole('heading', { name: C.list.draftsEmpty.title })).toBeVisible();
    await expect(drafts).toContainText(C.list.draftsEmpty.body);
    await expect(drafts.getByRole('link')).toHaveCount(0);
    await expect(page.getByRole('link', { name: C.list.filter.drafts })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.goto(`${tenant.origin}/cursos?filtro=publicados`);
    const published = page.getByTestId('courses-empty-published');
    await expect(
      published.getByRole('heading', { name: C.list.publishedEmpty.title }),
    ).toBeVisible();
    await expect(published).toContainText(C.list.publishedEmpty.body);
    await expect(published.getByRole('link')).toHaveCount(0);

    await page.goto(`${tenant.origin}/cursos?filtro=arquivados`);
    const archived = page.getByTestId('courses-empty-archived');
    await expect(archived.getByRole('heading', { name: C.list.archivedEmpty.title })).toBeVisible();
    await expect(archived).toContainText(C.list.archivedEmpty.body);
    await expect(archived.getByRole('link')).toHaveCount(0);

    // An unknown filter reads as Todos (the manager copy with its action); an unknown tab as Cursos.
    await page.goto(`${tenant.origin}/cursos?filtro=qualquer&aba=desconhecida`);
    await expect(page.getByRole('link', { name: C.list.filter.all })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('tab', { name: C.hub.tabs.courses })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(
      page.getByTestId('courses-empty').getByRole('link', { name: C.list.empty.cta }),
    ).toBeVisible();
  });

  test('UI-D-392 / E03 populated: two courses, newest first, with the right pills; the draft with an unready video carries Processando; ?filtro=publicados lists one', async ({
    page,
  }) => {
    ids.draft = await createCourse({
      tenantSlug: tenant.slug,
      title: titles.draft,
      status: 'draft',
      modules: 1,
      lessonsPerModule: 2,
      withUnreadyVideo: true,
      minutesAgo: 2,
    });
    ids.published = await createCourse({
      tenantSlug: tenant.slug,
      title: titles.published,
      status: 'published',
      modules: 2,
      lessonsPerModule: 2,
      minutesAgo: 1,
    });

    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos`);

    const list = page.getByRole('list', {
      name: fill(C.list.region, { tenant: tenant.displayName }),
    });
    await expect(list).toBeVisible();

    const draft = list.getByRole('link', {
      name: `${titles.draft}, ${C.status.draft}`,
      exact: true,
    });
    const published = list.getByRole('link', {
      name: `${titles.published}, ${C.status.published}`,
      exact: true,
    });
    await expect(draft).toBeVisible();
    await expect(published).toBeVisible();
    await expect(draft).toHaveAttribute('href', `/cursos/${ids.draft}`);
    await expect(published).toHaveAttribute('href', `/cursos/${ids.published}`);

    // P09: the server's order, newest first, never re-sorted by the web.
    const order = await list
      .getByRole('link')
      .evaluateAll(
        (links, p) =>
          links.map((l) => l.getAttribute('aria-label') ?? '').filter((n) => n.startsWith(p)),
        prefix,
      );
    expect(order.map((label) => label.split(',')[0])).toEqual([titles.published, titles.draft]);

    // The pills say the state in words; the draft's processing video adds the second one.
    const draftPills = draft.getByTestId('course-row-pill');
    await expect(draftPills).toHaveText([C.status.draft, C.status.processing]);
    await expect(draftPills.nth(1)).toHaveAttribute('data-tone', 'warning');
    await expect(published.getByTestId('course-row-pill')).toHaveText([C.status.published]);
    // The meta counts the live rows; no ready video, so no duration (UI-D-392).
    await expect(draft.getByTestId('course-row-meta')).toHaveText('1 módulo · 2 aulas');
    await expect(published.getByTestId('course-row-meta')).toHaveText('2 módulos · 4 aulas');
    // No cover: the gradient thumb (D-69).
    await expect(draft.getByTestId('course-row-fallback')).toBeVisible();

    // The chips filter: Publicados lists one, Rascunhos the other, Arquivados none.
    await page.getByRole('link', { name: C.list.filter.published }).click();
    await expect(page).toHaveURL(/\/cursos\?filtro=publicados$/);
    await expect(
      page.getByRole('link', { name: `${titles.published}, ${C.status.published}`, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(titles.draft) })).toHaveCount(0);

    await page.goto(`${tenant.origin}/cursos?filtro=rascunhos`);
    await expect(
      page.getByRole('link', { name: `${titles.draft}, ${C.status.draft}`, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(titles.published) })).toHaveCount(0);

    await page.goto(`${tenant.origin}/cursos?filtro=arquivados`);
    await expect(page.getByTestId('courses-empty-archived')).toBeVisible();
  });

  test('08.5-10 D-422 / UI-D-437 / EP-36 / COURSE-25: a published row has the eye "Ver como aluno: {course}" after its link and a draft row none; the course page puts "Ver como aluno" above "Despublicar"; the eye lands on the preview', async ({
    page,
  }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos`);
    const list = page.getByRole('list', {
      name: fill(C.list.region, { tenant: tenant.displayName }),
    });
    await expect(list).toBeVisible();

    const rowLink = list.getByRole('link', {
      name: `${titles.published}, ${C.status.published}`,
      exact: true,
    });
    const eye = list.getByRole('link', {
      name: fill(C.list.viewAsMember, { course: titles.published }),
      exact: true,
    });
    await expect(eye).toBeVisible();
    await expect(eye).toHaveAttribute('href', `/cursos/${ids.published}?ver=aluno`);
    // Drafts (and archived rows) have no eye.
    await expect(
      list.getByRole('link', { name: fill(C.list.viewAsMember, { course: titles.draft }) }),
    ).toHaveCount(0);
    // EP-36: the eye is a SIBLING after the row link, never inside it (anchors never nest).
    await expect(rowLink.getByRole('link')).toHaveCount(0);
    const order = await list
      .getByRole('link')
      .evaluateAll(
        (links, names) =>
          links
            .map((link) => link.getAttribute('aria-label') ?? '')
            .filter((label) => names.includes(label)),
        [
          `${titles.published}, ${C.status.published}`,
          fill(C.list.viewAsMember, { course: titles.published }),
        ],
      );
    expect(order).toEqual([
      `${titles.published}, ${C.status.published}`,
      fill(C.list.viewAsMember, { course: titles.published }),
    ]);
    // The 44px target (UI E11/overflow): the row name truncates first, the eye keeps its box.
    const box = await eye.boundingBox();
    expect(Math.round(box?.width ?? 0)).toBeGreaterThanOrEqual(44);
    expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(44);

    // The admin course page of the published course: "Ver como aluno" ABOVE "Despublicar" (EP-36).
    await page.goto(`${tenant.origin}/cursos/${ids.published}`);
    const actions = page.getByTestId('course-actions');
    const view = actions.getByRole('link', { name: C.course.viewAsMember, exact: true });
    const unpublish = actions.getByTestId('course-unpublish');
    await expect(view).toHaveAttribute('href', `/cursos/${ids.published}?ver=aluno`);
    await expect(unpublish).toBeVisible();
    const precedes = await view.evaluate(
      (node, other) =>
        Boolean(node.compareDocumentPosition(other as Node) & Node.DOCUMENT_POSITION_FOLLOWING),
      await unpublish.elementHandle(),
    );
    expect(precedes).toBe(true);
    const viewBox = await view.boundingBox();
    const unpublishBox = await unpublish.boundingBox();
    expect((viewBox?.y ?? 0) + (viewBox?.height ?? 0)).toBeLessThanOrEqual(unpublishBox?.y ?? 0);

    // UI E11/error: a course that is not published has no "Ver como aluno".
    await page.goto(`${tenant.origin}/cursos/${ids.draft}`);
    await expect(page.getByTestId('course-publish')).toBeVisible();
    await expect(page.getByRole('link', { name: C.course.viewAsMember, exact: true })).toHaveCount(
      0,
    );

    // The eye lands on the member page with the preview banner (D-422).
    await page.goto(`${tenant.origin}/cursos`);
    await list
      .getByRole('link', {
        name: fill(C.list.viewAsMember, { course: titles.published }),
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`/cursos/${ids.published}\\?ver=aluno$`));
    await expect(page.getByTestId('member-course-page')).toBeVisible();
    await expect(page.getByTestId('preview-banner')).toBeVisible();
  });

  test('08.5 / D-419 / UI-D-424 (was UI-D-412): a member gets the member catalogue and no Configurações row; with the module off both roles get the kernel not-found', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/configuracoes`);
    await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
    // Scoped to the page: since 08.5-11 the shell's Cursos TAB carries the same name (D-419).
    await expect(
      page.locator('main').getByRole('link', { name: SETTINGS_ROW, exact: true }),
    ).toHaveCount(0);
    // D-419: /cursos opens for the member — the frame's h1 "Cursos", never the hub's controls.
    // 08.6 (D-435): bare /cursos, the admin-only ?filtro= and ?aba=trilhas all open Início —
    // `trilhas` reads as Início until plan 08.6-10 registers the member Trilhas body.
    for (const path of ['/cursos', '/cursos?filtro=publicados', '/cursos?aba=trilhas']) {
      await page.goto(`${tenant.origin}${path}`);
      const catalogue = page.getByTestId('courses-member-catalogue');
      await expect(catalogue).toBeVisible();
      await expect(catalogue.getByRole('heading', { level: 1, name: C.hub.title })).toBeVisible();
      await expect(catalogue.getByTestId('courses-member-home')).toBeVisible();
      await expect(page.getByTestId('courses-hub')).toHaveCount(0);
      await expect(page.getByRole('link', { name: C.hub.create.course })).toHaveCount(0);
    }
    await page.goto(`${tenant.origin}/cursos?aba=cursos`);
    await expect(page.getByTestId('courses-member-courses')).toBeVisible();

    await page.context().clearCookies();
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos`);
    await expect(page.getByTestId('courses-hub')).toBeVisible();

    // The flag flips in the database; the API re-reads it once its 30 s cache entry expires.
    await setModuleEnabled(tenant.slug, 'courses', false);
    try {
      await expect(async () => {
        await page.goto(`${tenant.origin}/cursos`);
        await expectKernelNotFound(page);
      }).toPass({ timeout: 60_000, intervals: [2_000] });
      await page.goto(`${tenant.origin}/configuracoes`);
      await expect(
        page.locator('main').getByRole('link', { name: SETTINGS_ROW, exact: true }),
      ).toHaveCount(0);
      // 08.5-11 (UI E01/error, D-401): with the school off the shell has no Cursos tab either.
      await expect(page.locator('[data-shell-nav] a[href="/cursos"]')).toHaveCount(0);
      // The store row stays: only the school left the group (P54).
      await expect(page.locator('main a[href="/loja"]')).toHaveCount(1);

      // With the school off the member gets the kernel's not-found as well, not the catalogue.
      await page.context().clearCookies();
      await login(page, tenant.memberEmail, tenant.password, tenant.origin);
      await page.goto(`${tenant.origin}/cursos`);
      await expectKernelNotFound(page);
      await expect(page.getByTestId('courses-member-catalogue')).toHaveCount(0);
    } finally {
      await setModuleEnabled(tenant.slug, 'courses', true);
    }
    await expect(async () => {
      await page.goto(`${tenant.origin}/cursos`);
      await expect(page.getByTestId('courses-member-catalogue')).toBeVisible();
    }).toPass({ timeout: 60_000, intervals: [2_000] });
  });
});

/* ── 08.3-07: the course form (UI-D-393, D-405, D-412, COURSE-02, COURSE-08; 08.4 D-418, UI-D-417) ── */

const form = (page: Page) => page.locator('[data-course-form]');
const submit = (page: Page) => form(page).locator('button[type="submit"]');
const toast = (page: Page, message: string) =>
  page.getByRole('status').filter({ hasText: message });

/**
 * The course form end to end, on its own throwaway school with the store ON (`e2e-cf-<project>`):
 * the create flow (title, instructor, two outcomes, a level chip, hours → "Curso criado." → the
 * draft row), the edit flow (the tagline → "Alterações salvas." and nothing else changes), the
 * read-only Acesso line once the store links the course (08.4, D-418: "Liberado pelos produtos: X",
 * each product a link to its page in the Loja, no picker anywhere), and the archive flow from the edit form ("Arquivar curso" → confirm → "Curso arquivado." →
 * `?filtro=arquivados` lists it, Todos does not, the form shows the note). The mobile project also
 * checks the level chips wrap to a second line at 320px (E08 overflow).
 */
test.describe('course form', () => {
  test.skip(isRemote, 'the courses fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  let prefix = '';
  let tenant: CoursesTenant;
  const names = { course: '', product: '' };
  let courseId = '';
  let productId = '';

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    prefix = `e2e-cf-${testInfo.project.name}-${run}`;
    tenant = await createCoursesTenant(`e2e-cf-${testInfo.project.name}`, SEED_PASSWORD, ['store']);
    names.course = `${prefix} Harmonização facial`;
    names.product = `${prefix} Mentoria em grupo`;
    productId = await createProduct({
      tenantSlug: tenant.slug,
      name: names.product,
      priceCents: 19_900,
    });
  });

  test.afterAll(async () => {
    if (tenant) await deleteCoursesTenant(tenant.slug);
    await closeStoreAdmin();
    await closeCoursesAdmin();
  });

  test('UI-D-393 / D-412: the admin creates a course through the form and sees it as a draft row', async ({
    page,
  }, testInfo) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos`);
    await page.getByRole('link', { name: C.hub.create.course }).click();
    await expect(page).toHaveURL(/\/cursos\/novo$/);

    await expect(page.getByRole('heading', { name: C.form.createTitle })).toBeVisible();
    await expect(submit(page)).toBeDisabled();
    await expect(page.locator('[data-course-cover-fallback]')).toBeVisible();
    await expect(page.locator('[data-course-category-value]')).toHaveText(C.form.category.none);
    // D-418 / UI-D-417: the create form has no Acesso block and no product picker.
    await expect(form(page).locator('[data-course-access]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Escolher produtos' })).toHaveCount(0);
    await expect(form(page).locator('[data-course-outcome] input')).toHaveCount(1);
    for (const key of ['iniciante', 'intermediario', 'avancado']) {
      await expect(page.locator(`[data-course-level-chip="${key}"]`)).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }

    // E08 overflow (the mobile project): at 320px the three level chips sit in a `flex-wrap` row,
    // so they take a second line rather than overflow when their words are wider than the column
    // (with the shipped font the three fit the 288px column on one line; what the contract fixes
    // is that nothing clips and nothing scrolls sideways — every chip stays inside the viewport).
    if (testInfo.project.name === 'mobile-chromium') {
      await page.setViewportSize({ width: 320, height: 800 });
      const chips = page.locator('[data-course-level-chips]');
      const metrics = await chips.evaluate((el) => ({
        flexWrap: getComputedStyle(el).flexWrap,
        overflow: el.scrollWidth > el.clientWidth,
        rights: Array.from(el.children).map(
          (child) => (child as HTMLElement).getBoundingClientRect().right,
        ),
      }));
      expect(metrics.flexWrap).toBe('wrap');
      expect(metrics.overflow).toBe(false);
      expect(metrics.rights).toHaveLength(3);
      for (const right of metrics.rights) expect(right).toBeLessThanOrEqual(320);
      await page.setViewportSize({ width: 390, height: 844 });
    }

    await page.locator('#course-title').fill(names.course);
    // The instructor is required: leaving it empty shows the error and keeps the submit disabled.
    await page.locator('#course-instructor').focus();
    await page.locator('#course-instructor').blur();
    await expect(page.locator('#course-instructor-error')).toHaveText(
      C.form.errors.instructorRequired,
    );
    await expect(submit(page)).toBeDisabled();
    await page.locator('#course-instructor').fill('Dra. Ana Souza');
    await expect(page.locator('#course-instructor-error')).toHaveCount(0);
    await expect(submit(page)).toBeEnabled();

    await page.locator('#course-outcome-1').fill('Marcar os pontos de aplicação');
    await form(page).getByRole('button', { name: C.form.outcomes.add }).click();
    await page.locator('#course-outcome-2').fill('Planejar um resultado natural');
    await expect(form(page).locator('[data-course-outcome] input')).toHaveCount(2);

    const level = page.locator('[data-course-level-chip="intermediario"]');
    await level.click();
    await expect(level).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#course-hours').fill('12');

    await submit(page).click();
    await expect(toast(page, C.toasts.courseCreated)).toBeVisible();
    await expect(page).toHaveURL(/\/cursos$/);

    const saved = await courseByTitle(names.course);
    if (!saved) throw new Error('the course was not saved');
    courseId = saved.id;
    expect(saved.status).toBe('draft');
    expect(saved.level).toBe('intermediario');
    expect(saved.certificateHours).toBe(12);
    expect(saved.outcomes).toEqual([
      'Marcar os pontos de aplicação',
      'Planejar um resultado natural',
    ]);
    expect(saved.instructorName).toBe('Dra. Ana Souza');
    expect(await courseProductIds(courseId)).toEqual([]);

    const row = page.getByRole('link', {
      name: `${names.course}, ${C.status.draft}`,
      exact: true,
    });
    await expect(row).toBeVisible();
    await expect(row.getByTestId('course-row-pill')).toHaveText([C.status.draft]);
  });

  test('COURSE-08: editing the tagline saves only the tagline and toasts Alterações salvas.', async ({
    page,
  }) => {
    test.skip(!courseId, 'needs the course the first case created');
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${courseId}/editar`);

    await expect(page.getByRole('heading', { name: C.form.editTitle })).toBeVisible();
    await expect(page.locator('#course-title')).toHaveValue(names.course);
    await expect(page.locator('#course-hours')).toHaveValue('12');
    await expect(page.locator('[data-course-level-chip="intermediario"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(form(page).locator('[data-course-outcome] input')).toHaveCount(2);
    // Clean: nothing to save yet.
    await expect(submit(page)).toBeDisabled();
    await expect(form(page).locator('[data-course-archive]')).toBeVisible();

    await page.locator('#course-tagline').fill('Do primeiro ponto ao resultado natural.');
    await expect(submit(page)).toBeEnabled();
    await submit(page).click();
    await expect(toast(page, C.toasts.saved)).toBeVisible();
    // An edit save returns to the COURSE PAGE (08.3-08 passes `returnHref=/cursos/{id}` from the
    // edit route); only a create lands on the hub.
    await expect(page).toHaveURL(new RegExp(`/cursos/${courseId}$`));

    const saved = await courseByTitle(names.course);
    expect(saved?.tagline).toBe('Do primeiro ponto ao resultado natural.');
    // Nothing else moved.
    expect(saved?.level).toBe('intermediario');
    expect(saved?.certificateHours).toBe(12);
    expect(saved?.outcomes).toHaveLength(2);
  });

  test('D-418 / UI-D-417: the course form has no product picker; a store link shows "Liberado pelos produtos" read-only, linking to the product', async ({
    page,
  }) => {
    test.skip(!courseId, 'needs the course the first case created');
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);

    // No link yet: the store is on, and still no Acesso block and no picker (UI-D-417).
    await page.goto(`${tenant.origin}/cursos/${courseId}/editar`);
    await expect(page.getByRole('heading', { name: C.form.editTitle })).toBeVisible();
    await expect(form(page).locator('[data-course-access]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Escolher produtos' })).toHaveCount(0);

    // The store writes the link (the row the product form writes, 08.4); the course form reads it.
    await linkCourseProduct(courseId, productId);
    expect(await courseProductIds(courseId)).toEqual([productId]);
    await page.goto(`${tenant.origin}/cursos/${courseId}/editar`);

    const access = form(page).locator('[data-course-access]');
    await expect(access).toBeVisible();
    await expect(access).toContainText(C.form.access.label);
    await expect(access.locator('[data-course-access-value]')).toHaveText(
      fill(C.form.access.value, { products: names.product }),
    );
    await expect(access).toContainText(C.form.access.helper);
    const link = access.getByRole('link', { name: names.product, exact: true });
    await expect(link).toHaveAttribute('href', `/loja/${productId}`);
    // Read-only: nothing in the block writes.
    await expect(access.locator('input, textarea, button, select')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Escolher produtos' })).toHaveCount(0);
    // A clean form: the line is not a field, so nothing is dirty.
    await expect(submit(page)).toBeDisabled();

    // The link opens the product's page in the Loja.
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/loja/${productId}$`));
    await expect(page.getByText(names.product).first()).toBeVisible();
    expect(await courseProductIds(courseId)).toEqual([productId]);
  });

  test('UI-D-404 / D-413: Arquivar curso from the edit form, confirmed, lands on Arquivados; Todos no longer lists it; the form shows the note', async ({
    page,
  }) => {
    test.skip(!courseId, 'needs the course the first case created');
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${courseId}/editar`);

    await form(page).getByRole('button', { name: C.form.archive }).click();
    const dialog = page.getByRole('dialog', { name: C.course.archiveDialog.title });
    await expect(dialog).toContainText(C.course.archiveDialog.body);
    await dialog.getByRole('button', { name: C.course.archiveDialog.confirm, exact: true }).click();
    await expect(toast(page, C.toasts.archived)).toBeVisible();
    await expect(page).toHaveURL(/\/cursos\?filtro=arquivados$/);

    const archived = page.getByRole('link', {
      name: `${names.course}, ${C.status.archived}`,
      exact: true,
    });
    await expect(archived).toBeVisible();
    await expect(archived.getByTestId('course-row-pill')).toHaveText([C.status.archived]);
    await expect.poll(async () => (await courseByTitle(names.course))?.status).toBe('archived');
    // The links survived the archive untouched.
    expect(await courseProductIds(courseId)).toEqual([productId]);

    await page.goto(`${tenant.origin}/cursos`);
    await expect(page.getByRole('link', { name: new RegExp(names.course) })).toHaveCount(0);

    // E08 partial: an archived course edits without the archive row; the note replaces it.
    await page.goto(`${tenant.origin}/cursos/${courseId}/editar`);
    await expect(form(page).locator('[data-course-archive]')).toHaveCount(0);
    await expect(form(page).locator('[data-course-archived-note]')).toHaveText(
      C.course.archivedNote,
    );
  });
});

/* ── 08.3-07: the category manager (UI-D-400, D-411, COURSE-04) ──────────────────────────────── */

/**
 * The categories flow on a throwaway school WITHOUT the store (`e2e-cc-<project>`), which also
 * proves the course form's Acesso block is absent with the store off (D-405, 08.4 SC 5) even though
 * a product row links the course (written straight in `store_product_courses`): create "Lábios" →
 * "Nenhum curso" → a duplicate name → the error under the field → assign it in the course form's
 * picker → "1 curso" → remove disabled with the in-use helper → detach → remove → the empty state
 * with the focus on "Nova categoria".
 */
test.describe('categories', () => {
  test.skip(isRemote, 'the courses fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  let prefix = '';
  let tenant: CoursesTenant;
  const names = { category: '', course: '' };
  let courseId = '';
  let categoryId = '';

  const sheet = (page: Page, title: string) => page.getByRole('dialog', { name: title });

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    prefix = `e2e-cc-${testInfo.project.name}-${run}`;
    tenant = await createCoursesTenant(`e2e-cc-${testInfo.project.name}`, SEED_PASSWORD);
    names.category = `${prefix} Lábios`;
    names.course = `${prefix} Curso`;
    courseId = await createCourse({ tenantSlug: tenant.slug, title: names.course, modules: 0 });
    // A link the store would honour if it were on: with it off the course form must still show no
    // Acesso line (08.4 SC 5, UI-D-417).
    const productId = await createProduct({
      tenantSlug: tenant.slug,
      name: `${prefix} Produto`,
      priceCents: 9_900,
    });
    await linkCourseProduct(courseId, productId);
  });

  test.afterAll(async () => {
    if (tenant) await deleteCoursesTenant(tenant.slug);
    await closeStoreAdmin();
    await closeCoursesAdmin();
  });

  test('UI-D-400: from the empty state, a category is created with the focus on the name; a duplicate name is refused under the field', async ({
    page,
  }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos`);
    await expect(page.getByTestId('courses-categories-count')).toHaveText('0');
    await page.getByTestId('courses-categories-row').click();
    await expect(page).toHaveURL(/\/cursos\/categorias$/);

    await expect(page.getByRole('heading', { name: C.categories.title })).toBeVisible();
    await expect(page.getByRole('link', { name: C.categories.back, exact: true })).toHaveAttribute(
      'href',
      '/cursos',
    );
    const empty = page.getByTestId('categories-empty');
    await expect(empty.getByRole('heading', { name: C.categories.empty.title })).toBeVisible();
    await expect(empty).toContainText(C.categories.empty.body);

    await empty.getByRole('button', { name: C.categories.empty.cta }).click();
    const create = sheet(page, C.category.form.createTitle);
    await expect(create).toBeVisible();
    await expect(page.locator('#category-name')).toBeFocused();
    await expect(create.locator('button[type="submit"]')).toBeDisabled();
    await page.locator('#category-name').fill(names.category);
    await create.locator('button[type="submit"]').click();
    await expect(toast(page, C.toasts.categoryCreated)).toBeVisible();
    await expect(create).toHaveCount(0);

    const row = page.getByRole('button', { name: new RegExp(`^${names.category}`) });
    await expect(row).toBeVisible();
    await expect(row.getByTestId('category-row-count')).toHaveText('Nenhum curso');
    const saved = await categoryByName(names.category);
    if (!saved) throw new Error('the category was not saved');
    categoryId = saved.id;

    // 409 category_exists, ignoring case: the name error, the sheet kept.
    await page.getByRole('button', { name: C.categories.create }).click();
    const again = sheet(page, C.category.form.createTitle);
    await page.locator('#category-name').fill(names.category.toUpperCase());
    await again.locator('button[type="submit"]').click();
    await expect(page.locator('#category-name-error')).toHaveText(
      C.category.form.errors.nameExists,
    );
    await expect(again).toBeVisible();
    // A dirty close asks first; "Descartar" leaves.
    await page.keyboard.press('Escape');
    const discard = sheet(page, C.discard.category);
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: C.discard.confirm, exact: true }).click();
    await expect(again).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Lábios/ })).toHaveCount(1);

    await page.goto(`${tenant.origin}/cursos`);
    await expect(page.getByTestId('courses-categories-count')).toHaveText('1');
  });

  test('D-405 / D-411: with the store off the form has no Acesso block; the category picked in the sheet saves, counts 1 curso and disables the remove with the helper', async ({
    page,
  }) => {
    test.skip(!categoryId, 'needs the category the first case created');
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${courseId}/editar`);

    await expect(page.getByRole('heading', { name: C.form.editTitle })).toBeVisible();
    expect(await courseProductIds(courseId)).toHaveLength(1);
    await expect(form(page).locator('[data-course-access]')).toHaveCount(0);
    await expect(page.getByText(C.form.access.label, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Escolher produtos' })).toHaveCount(0);
    await expect(form(page).getByRole('link', { name: C.form.category.manage })).toHaveAttribute(
      'href',
      '/cursos/categorias',
    );

    await page.locator('[data-course-category-open]').click();
    const picker = sheet(page, C.form.category.pickerTitle);
    await expect(picker).toBeVisible();
    const radios = picker.getByRole('radio');
    await expect(radios.first()).toHaveText(C.form.category.none);
    await expect(radios.first()).toHaveAttribute('aria-checked', 'true');
    await picker.getByRole('radio', { name: names.category }).click();
    await expect(picker).toHaveCount(0);
    await expect(page.locator('[data-course-category-value]')).toHaveText(names.category);

    await submit(page).click();
    await expect(toast(page, C.toasts.saved)).toBeVisible();
    await expect.poll(async () => (await courseByTitle(names.course))?.categoryId).toBe(categoryId);

    await page.goto(`${tenant.origin}/cursos/categorias`);
    const row = page.getByRole('button', { name: new RegExp(`^${names.category}`) });
    await expect(row.getByTestId('category-row-count')).toHaveText('1 curso');
    await row.click();
    const edit = sheet(page, C.category.form.editTitle);
    await expect(edit).toBeVisible();
    await expect(page.locator('#category-name')).toHaveValue(names.category);
    const remove = edit.getByRole('button', { name: C.category.form.remove });
    await expect(remove).toBeDisabled();
    await expect(edit.locator('[data-category-remove-helper]')).toHaveText(
      'Esta categoria tem 1 curso. Mude a categoria deles antes de remover.',
    );
  });

  test('E11 zero-one-many: detached, the category removes through the danger dialog; the empty state returns with the focus on Nova categoria', async ({
    page,
  }) => {
    test.skip(!categoryId, 'needs the category the first case created');
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${courseId}/editar`);
    await page.locator('[data-course-category-open]').click();
    await sheet(page, C.form.category.pickerTitle)
      .getByRole('radio', { name: C.form.category.none })
      .click();
    await expect(page.locator('[data-course-category-value]')).toHaveText(C.form.category.none);
    await submit(page).click();
    await expect(toast(page, C.toasts.saved)).toBeVisible();
    await expect.poll(async () => (await courseByTitle(names.course))?.categoryId).toBeNull();

    await page.goto(`${tenant.origin}/cursos/categorias`);
    const row = page.getByRole('button', { name: new RegExp(`^${names.category}`) });
    await expect(row.getByTestId('category-row-count')).toHaveText('Nenhum curso');
    await row.click();
    const edit = sheet(page, C.category.form.editTitle);
    const remove = edit.getByRole('button', { name: C.category.form.remove });
    await expect(remove).toBeEnabled();
    await expect(edit.locator('[data-category-remove-helper]')).toHaveCount(0);
    // Dispatched AT the element: under `next dev` the dev-tools badge (a dev-only `<nextjs-portal>`
    // at the bottom-left corner) sits over this bottom-left row of the sheet and intercepts a
    // coordinate click; production has no such layer (the comunidades/reels precedent).
    await remove.dispatchEvent('click');
    const dialog = sheet(page, C.category.removeDialog.title);
    await expect(dialog).toContainText(C.category.removeDialog.body);
    await dialog
      .getByRole('button', { name: C.category.removeDialog.confirm, exact: true })
      .click();
    await expect(toast(page, C.toasts.categoryRemoved)).toBeVisible();
    await expect(edit).toHaveCount(0);

    const empty = page.getByTestId('categories-empty');
    await expect(empty.getByRole('heading', { name: C.categories.empty.title })).toBeVisible();
    await expect(page.getByRole('button', { name: C.categories.create })).toBeFocused();
    expect(await categoryByName(names.category)).toBeNull();
  });
});

/* ── 08.3-08: the course page and the curriculum editor (UI-D-394..397, D-406, D-413, D-414) ─── */

/**
 * The curriculum end to end, on its own throwaway school (`e2e-cu-<project>`, store off so the
 * publish dialog carries the plain body): two modules created through the sheet (the first with the
 * switch disabled), the second edited with the switch on → "Exige o anterior", the arrow move that
 * swaps the numerals and persists after a reload, the publish-blocked notice naming the fixture's
 * processing lesson over the disabled button, the publish once the fixture marks the asset ready,
 * the unpublish, the removal through the danger dialog, and an archived course's note. The mobile
 * project also checks the 320px row keeps both arrows inside the viewport (E06 overflow base check,
 * named for plan 12's battery).
 */
test.describe('curriculum', () => {
  test.skip(isRemote, 'the courses fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  let prefix = '';
  let tenant: CoursesTenant;
  const names = { course: '', archived: '', first: '', second: '', lesson: '' };
  let courseId = '';
  let archivedId = '';
  let lessonId = '';
  let assetId: string | null = null;

  const R = C.reorder;
  const moveUp = (page: Page, name: string) =>
    page.getByRole('button', { name: fill(R.moveUp, { name }), exact: true });
  const moveDown = (page: Page, name: string) =>
    page.getByRole('button', { name: fill(R.moveDown, { name }), exact: true });
  const cardTitles = (page: Page) =>
    page.getByTestId('module-card-title').evaluateAll((nodes) => nodes.map((n) => n.textContent));
  const numerals = (page: Page) =>
    page
      .getByTestId('module-card-numeral')
      .evaluateAll((nodes) => nodes.map((n) => n.querySelector('[aria-hidden]')?.textContent));
  const publish = (page: Page) => page.getByTestId('course-publish');
  const sheet = (page: Page, title: string) => page.getByRole('dialog', { name: title });

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    prefix = `e2e-cu-${testInfo.project.name}-${run}`;
    tenant = await createCoursesTenant(`e2e-cu-${testInfo.project.name}`, SEED_PASSWORD);
    names.course = `${prefix} Lábios`;
    names.archived = `${prefix} Arquivado`;
    names.first = `${prefix} Fundamentos`;
    names.second = `${prefix} Técnica`;
    names.lesson = `${prefix} Pontos de aplicação`;
    courseId = await createCourse({ tenantSlug: tenant.slug, title: names.course, modules: 0 });
    archivedId = await createCourse({
      tenantSlug: tenant.slug,
      title: names.archived,
      status: 'archived',
      modules: 0,
    });
  });

  test.afterAll(async () => {
    if (tenant) await deleteCoursesTenant(tenant.slug);
    await closeCoursesAdmin();
  });

  test('UI-D-394 / UI-D-396 / D-406: the empty course page, then two modules through the sheet — the first with the switch disabled, the second edited with the switch on', async ({
    page,
  }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${courseId}`);

    // The header, the hero fallback, the status pill, the instructor line and the enabled button
    // (no module, so no video blocks publishing).
    await expect(page.getByRole('heading', { name: names.course })).toBeVisible();
    await expect(page.getByRole('link', { name: C.course.back, exact: true })).toHaveAttribute(
      'href',
      '/cursos',
    );
    await expect(page.getByRole('link', { name: C.course.edit })).toHaveAttribute(
      'href',
      `/cursos/${courseId}/editar`,
    );
    await expect(page.getByTestId('course-hero-fallback')).toBeVisible();
    await expect(page.getByTestId('course-status-pill')).toHaveText(C.status.draft);
    await expect(page.getByTestId('course-instructor')).toHaveText(
      fill(C.course.instructor, { instructor: 'Instrutora Fixture' }),
    );
    await expect(publish(page)).toBeEnabled();
    await expect(page.getByTestId('publish-blocked')).toHaveCount(0);

    // E06 empty: the Módulos EmptyState with the outline "Criar módulo" opens the sheet.
    const empty = page.getByTestId('curriculum-empty');
    await expect(empty.getByRole('heading', { name: C.curriculum.empty.title })).toBeVisible();
    await empty.getByRole('button', { name: C.curriculum.empty.cta }).click();
    let dialog = sheet(page, C.module.form.createTitle);
    await expect(dialog).toBeVisible();
    await expect(page.locator('#module-title')).toBeFocused();
    await expect(dialog.locator('button[type="submit"]')).toBeDisabled();
    // The first module: the switch present but disabled, with its helper (D-406).
    const firstSwitch = dialog.getByRole('switch', { name: C.module.form.requiresPrevious });
    await expect(firstSwitch).toBeDisabled();
    await expect(dialog.locator('[data-module-requires-helper]')).toHaveText(
      C.module.form.firstModule,
    );
    await expect(dialog.getByRole('button', { name: C.module.form.remove })).toHaveCount(0);
    await page.locator('#module-title').fill(names.first);
    await dialog.locator('button[type="submit"]').click();
    await expect(toast(page, C.toasts.moduleCreated)).toBeVisible();
    await expect(dialog).toHaveCount(0);

    // One module: numeral 1, both arrows disabled, the ghost row above "Nova aula".
    await expect.poll(() => cardTitles(page)).toEqual([names.first]);
    await expect.poll(() => numerals(page)).toEqual(['1']);
    await expect(moveUp(page, names.first)).toBeDisabled();
    await expect(moveDown(page, names.first)).toBeDisabled();
    await expect(page.getByTestId('curriculum-no-lessons')).toHaveText(C.curriculum.noLessons);
    const modules = await courseModules(courseId);
    expect(modules.map((m) => m.title)).toEqual([names.first]);
    await expect(page.getByRole('link', { name: C.curriculum.newLesson })).toHaveAttribute(
      'href',
      `/cursos/${courseId}/aulas/nova?modulo=${modules[0]?.id}`,
    );
    await expect(page.getByTestId('module-card-meta')).toHaveText('0 aulas');

    // The second module through "Novo módulo": the switch is enabled; it is created OFF.
    await page.getByRole('button', { name: C.curriculum.newModule }).click();
    dialog = sheet(page, C.module.form.createTitle);
    await expect(
      dialog.getByRole('switch', { name: C.module.form.requiresPrevious }),
    ).toBeEnabled();
    await expect(dialog.locator('[data-module-requires-helper]')).toHaveText(
      C.module.form.requiresPreviousHelper,
    );
    await page.locator('#module-title').fill(names.second);
    await dialog.locator('button[type="submit"]').click();
    await expect(toast(page, C.toasts.moduleCreated)).toBeVisible();
    await expect.poll(() => cardTitles(page)).toEqual([names.first, names.second]);
    await expect.poll(() => numerals(page)).toEqual(['1', '2']);
    await expect(page.getByTestId('module-card-lock')).toHaveCount(0);

    // Edit the second with the switch on → "Alterações salvas." → the lock caption.
    await page
      .getByRole('button', { name: fill(C.curriculum.module.edit, { module: names.second }) })
      .click();
    dialog = sheet(page, C.module.form.editTitle);
    await expect(page.locator('#module-title')).toHaveValue(names.second);
    await expect(dialog.locator('button[type="submit"]')).toBeDisabled();
    const toggle = dialog.getByRole('switch', { name: C.module.form.requiresPrevious });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await dialog.locator('button[type="submit"]').click();
    await expect(toast(page, C.toasts.saved)).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('module-card-lock')).toHaveText(
      C.curriculum.module.requiresPrevious,
    );
    // The ends: the first cannot go up, the last cannot go down.
    await expect(moveUp(page, names.first)).toBeDisabled();
    await expect(moveDown(page, names.first)).toBeEnabled();
    await expect(moveUp(page, names.second)).toBeEnabled();
    await expect(moveDown(page, names.second)).toBeDisabled();
  });

  test('UI-D-397 / D-414: one arrow tap swaps the numerals, writes the whole order and persists after a reload', async ({
    page,
  }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${courseId}`);
    await expect.poll(() => cardTitles(page)).toEqual([names.first, names.second]);

    await moveUp(page, names.second).click();
    // Optimistic: the order and the numerals swap at once; the live region announces it.
    await expect.poll(() => cardTitles(page)).toEqual([names.second, names.first]);
    await expect.poll(() => numerals(page)).toEqual(['1', '2']);
    await expect(
      page.getByText(fill(R.moved, { name: names.second, position: '1', total: '2' })),
    ).toBeAttached();
    // The write answered: the arrows re-enable, the moved row's up arrow is now the disabled end
    // and focus followed the row to its other button.
    await expect(moveDown(page, names.second)).toBeEnabled();
    await expect(moveUp(page, names.second)).toBeDisabled();
    await expect(moveDown(page, names.second)).toBeFocused();
    // D-406 by index: the second module is first now, so its lock caption is not shown.
    await expect(page.getByTestId('module-card-lock')).toHaveCount(0);
    // No toast on a successful reorder (UI-D-397).
    await expect(page.getByRole('status').filter({ hasText: C.reorder.errors.save })).toHaveCount(
      0,
    );

    // Persisted: the server renders the same order on a fresh load, and the rows say so.
    await expect
      .poll(async () => (await courseModules(courseId)).map((m) => [m.title, m.position]))
      .toEqual([
        [names.second, 1],
        [names.first, 2],
      ]);
    await page.reload();
    await expect.poll(() => cardTitles(page)).toEqual([names.second, names.first]);
    await expect.poll(() => numerals(page)).toEqual(['1', '2']);
  });

  test('UI-D-394 / D-413 / COURSE-03: the publish-blocked notice names the processing lesson over the disabled button; once the asset is ready the course publishes and unpublishes', async ({
    page,
  }, testInfo) => {
    const modules = await courseModules(courseId);
    const firstModule = modules.find((m) => m.title === names.first);
    if (!firstModule) throw new Error('the Fundamentos module is missing');
    const created = await createLesson({
      tenantSlug: tenant.slug,
      courseId,
      moduleId: firstModule.id,
      title: names.lesson,
      withUnreadyVideo: true,
    });
    lessonId = created.id;
    assetId = created.videoAssetId;

    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${courseId}`);

    // The notice above the disabled button: the sentence, the lesson as a link to its form.
    const notice = page.getByTestId('publish-blocked');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(notice.getByTestId('publish-blocked-sentence')).toHaveText(
      'Não é possível publicar: 1 aula ainda processa o vídeo.',
    );
    await expect(notice.getByRole('link', { name: names.lesson })).toHaveAttribute(
      'href',
      `/cursos/${courseId}/aulas/${lessonId}`,
    );
    await expect(publish(page)).toBeDisabled();

    // The lesson row: the spinner thumb, the Processando pill, the module meta "1 aula".
    const lessons = page.getByRole('list', {
      name: fill(R.lists.lessons, { module: names.first }),
    });
    const row = lessons.getByTestId('lesson-row');
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('lesson-row-thumb')).toHaveAttribute('data-thumb', 'processing');
    await expect(row.getByTestId('lesson-row-pill')).toHaveText(C.status.processing);
    await expect(row.getByTestId('lesson-row-pill')).toHaveAttribute('data-tone', 'warning');
    await expect(
      row.getByRole('link', { name: `${names.lesson}, ${C.status.processing}`, exact: true }),
    ).toHaveAttribute('href', `/cursos/${courseId}/aulas/${lessonId}`);
    // One lesson: both its arrows disabled.
    await expect(moveUp(page, names.lesson)).toBeDisabled();
    await expect(moveDown(page, names.lesson)).toBeDisabled();

    // E06 overflow (the mobile project, the plan 12 battery's base check): at 320px the row with
    // the 2-line title, the Processando pill and the two 44px arrows keeps the arrows fully inside
    // the viewport and the pill readable.
    if (testInfo.project.name === 'mobile-chromium') {
      await page.setViewportSize({ width: 320, height: 800 });
      const metrics = await row.evaluate((el) => {
        const buttons = Array.from(el.querySelectorAll('button')).map((b) =>
          b.getBoundingClientRect(),
        );
        const pill = el.querySelector('[data-testid="lesson-row-pill"]')?.getBoundingClientRect();
        return {
          buttons: buttons.map((r) => ({ left: r.left, right: r.right, width: r.width })),
          pillWidth: pill?.width ?? 0,
          overflow: el.scrollWidth > el.clientWidth,
        };
      });
      expect(metrics.buttons).toHaveLength(2);
      for (const rect of metrics.buttons) {
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(320);
        expect(rect.width).toBeGreaterThanOrEqual(44);
      }
      expect(metrics.pillWidth).toBeGreaterThan(0);
      expect(metrics.overflow).toBe(false);
      await page.setViewportSize({ width: 390, height: 844 });
    }

    // The provider "finishes": the fixture marks the asset ready; the page refreshed shows the
    // duration, no notice and the enabled button.
    if (!assetId) throw new Error('the fixture lesson has no video asset');
    await markAssetReady(assetId, { durationSeconds: 754 });
    await page.reload();
    await expect(page.getByTestId('publish-blocked')).toHaveCount(0);
    await expect(publish(page)).toBeEnabled();
    await expect(row.getByTestId('lesson-row-meta')).toHaveText('12:34');
    await expect(row.getByTestId('lesson-row-pill')).toHaveCount(0);
    await expect(row.getByTestId('lesson-row-thumb')).toHaveAttribute(
      'data-thumb',
      /^poster(-missing)?$/,
    );
    await expect(
      page.getByTestId('module-card-meta').filter({ hasText: '1 aula · 13 min' }),
    ).toHaveCount(1);

    // Publish through the brand dialog (plain body: the store is off, no product).
    await publish(page).click();
    const confirm = page.getByRole('dialog', { name: C.course.publishDialog.title });
    await expect(confirm).toContainText(C.course.publishDialog.body);
    await confirm
      .getByRole('button', { name: C.course.publishDialog.confirm, exact: true })
      .click();
    await expect(toast(page, C.toasts.published)).toBeVisible();
    await expect(page.getByTestId('course-status-pill')).toHaveText(C.status.published);
    await expect(page.getByTestId('course-unpublish')).toBeVisible();
    await expect(page.getByTestId('course-published-at')).toContainText('Publicado em ');
    await expect(publish(page)).toHaveCount(0);
    await expect.poll(() => courseStatus(courseId)).toBe('published');

    // Unpublish through the danger dialog → Rascunho, the button is back.
    await page.getByTestId('course-unpublish').click();
    const danger = page.getByRole('dialog', { name: C.course.unpublishDialog.title });
    await expect(danger).toContainText(C.course.unpublishDialog.body);
    await danger
      .getByRole('button', { name: C.course.unpublishDialog.confirm, exact: true })
      .click();
    await expect(toast(page, C.toasts.unpublished)).toBeVisible();
    await expect(page.getByTestId('course-status-pill')).toHaveText(C.status.draft);
    await expect(publish(page)).toBeEnabled();
    await expect(page.getByTestId('course-unpublish')).toHaveCount(0);
    await expect.poll(() => courseStatus(courseId)).toBe('draft');
  });

  test('UI-D-396 / UI-D-404 / PR-5: Remover módulo through the danger dialog removes the card and toasts; an archived course shows the note and no button', async ({
    page,
  }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${courseId}`);
    await expect.poll(() => cardTitles(page)).toEqual([names.second, names.first]);

    await page
      .getByRole('button', { name: fill(C.curriculum.module.edit, { module: names.second }) })
      .click();
    const edit = sheet(page, C.module.form.editTitle);
    await expect(edit).toBeVisible();
    // Dispatched AT the element: under `next dev` the dev-tools badge sits over this bottom-left
    // row of the sheet and intercepts a coordinate click (the plan 07 precedent).
    await edit.getByRole('button', { name: C.module.form.remove }).dispatchEvent('click');
    const dialog = sheet(page, C.module.removeDialog.title);
    await expect(dialog).toContainText(C.module.removeDialog.body);
    await dialog.getByRole('button', { name: C.module.removeDialog.confirm, exact: true }).click();
    await expect(toast(page, C.toasts.moduleRemoved)).toBeVisible();
    await expect(edit).toHaveCount(0);
    await expect.poll(() => cardTitles(page)).toEqual([names.first]);
    await expect.poll(() => numerals(page)).toEqual(['1']);
    // Focus moved to the next module's edit control (the opener is gone).
    await expect(
      page.getByRole('button', { name: fill(C.curriculum.module.edit, { module: names.first }) }),
    ).toBeFocused();
    // A soft delete: the live list has one module; the row itself stays (PR-5).
    await expect
      .poll(async () => (await courseModules(courseId)).map((m) => m.title))
      .toEqual([names.first]);

    // The archived course: the note, no publish or unpublish control, the edit link still there.
    await page.goto(`${tenant.origin}/cursos/${archivedId}`);
    await expect(page.getByTestId('course-archived-note')).toHaveText(C.course.archivedNote);
    await expect(page.getByTestId('course-publish')).toHaveCount(0);
    await expect(page.getByTestId('course-unpublish')).toHaveCount(0);
    await expect(page.getByTestId('course-status-pill')).toHaveText(C.status.archived);
    await expect(page.getByRole('link', { name: C.course.edit })).toHaveAttribute(
      'href',
      `/cursos/${archivedId}/editar`,
    );

    // An unknown id is the school's "Curso indisponível" card (UI E05 error).
    await page.goto(`${tenant.origin}/cursos/00000000-0000-4000-8000-000000000000`);
    await expect(page.getByTestId('courses-not-found')).toBeVisible();
  });
});

/* ── 08.3-09: the lesson form, the video states and the materials (UI-D-398, UI-D-399, D-407, D-409, D-410) ── */

/** A PDF that weighs 2 516 582 bytes ("2,4 MB"): the five magic bytes the API's `inspectFile` reads, then filler. */
const PDF_BYTES = Buffer.concat([
  Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n'),
  Buffer.alloc(2_516_582 - 30, 0x20),
  Buffer.from('%%EOF\n'),
]).subarray(0, 2_516_582);
/** A ZIP local-file header (what every OOXML file is) padded to 184 320 bytes ("180 KB"). */
const XLSX_BYTES = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.alloc(184_320 - 4, 7),
]);
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * The lesson form end to end, on its own throwaway school with the store ON (`e2e-cl-<project>`) so a
 * product can gate the course: a practical lesson created from "Nova aula" and read as "Prática" in
 * the curriculum; the fixture lesson whose video processes shows the card and, once the fixture
 * marks the asset ready, the player and the asset's "12:34"; "Aula aberta" on the gated course; a PDF
 * and an XLSX uploaded through the dropzone into the local bucket (the `media-upload.spec.ts`
 * technique — no byte through our servers), their kinds and sizes, one moved up, the order kept after
 * a reload, a saved row opened through a fresh `token=` URL; the cap at ten (the mobile project
 * checks the 320px row keeps its arrows and its remove control inside the viewport); and "Remover
 * aula" through the danger dialog.
 *
 * Copy asserted below, through the catalog (never a literal in a locator): "Prática",
 * "Processando o vídeo…", "Planilha · 180 KB", "Limite de 10 arquivos por aula.", "Aula criada.",
 * "Alterações salvas.", "Aula removida." — and a `token=` URL for the signed open. 08.5-10 (D-428,
 * UI-D-438): "Exige concluir a aula anterior" with "Esta é a primeira aula do curso." on the first
 * lesson, "Aulas abertas nunca ficam bloqueadas." while "Aula aberta" is on, "Quem não concluiu a
 * aula anterior vê esta aula bloqueada." otherwise, and the row's " · Exige a anterior".
 */
test.describe('lesson form', () => {
  test.skip(isRemote, 'the courses fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  let prefix = '';
  let tenant: CoursesTenant;
  const names = { course: '', module: '', practice: '', video: '', capped: '', product: '' };
  let courseId = '';
  let moduleId = '';
  let practiceId = '';
  let videoLesson: { id: string; videoAssetId: string };
  let cappedId = '';

  const L = C.lesson;
  const submit = (page: Page) => page.locator('[data-lesson-form] button[type="submit"]');
  const metas = (page: Page) =>
    page.locator('[data-material-meta]').evaluateAll((nodes) => nodes.map((n) => n.textContent));
  const lessonRowMeta = (page: Page, title: string) =>
    page
      .getByTestId('lesson-row')
      .filter({ has: page.getByTestId('lesson-row-title').filter({ hasText: title }) })
      .getByTestId('lesson-row-meta');
  /** Picks a material the way the admin does: tap "Adicionar arquivo", answer the OS picker (the hydration gate). */
  const pickMaterial = async (
    page: Page,
    file: { name: string; mimeType: string; buffer: Buffer },
  ) => {
    const opening = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: L.materials.add }).click();
    await (await opening).setFiles(file);
  };

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    prefix = `e2e-cl-${testInfo.project.name}-${run}`;
    tenant = await createCoursesTenant(`e2e-cl-${testInfo.project.name}`, SEED_PASSWORD, ['store']);
    names.course = `${prefix} Lábios`;
    names.module = `${names.course} módulo 1`;
    names.practice = `${prefix} Protocolo impresso`;
    names.video = `${prefix} Pontos de aplicação`;
    names.capped = `${prefix} Dez materiais`;
    names.product = `${prefix} Mentoria`;
    courseId = await createCourse({
      tenantSlug: tenant.slug,
      title: names.course,
      modules: 1,
      lessonsPerModule: 0,
    });
    moduleId = (await courseModules(courseId))[0]?.id ?? '';
    const productId = await createProduct({
      tenantSlug: tenant.slug,
      name: names.product,
      priceCents: 19_900,
    });
    await linkCourseProduct(courseId, productId);
    videoLesson = await createLessonWithProcessingVideo({
      tenantSlug: tenant.slug,
      courseId,
      moduleId,
      title: names.video,
    });
    cappedId = (
      await createLesson({ tenantSlug: tenant.slug, courseId, moduleId, title: names.capped })
    ).id;
    await createMaterials(tenant.slug, cappedId, 10, prefix);
  });

  test.afterAll(async () => {
    if (tenant) await deleteCoursesTenant(tenant.slug);
    await closeStoreAdmin();
    await closeCoursesAdmin();
  });

  test('UI-D-398 / D-409 / E09 empty: "Nova aula" opens the empty form; a practical lesson saves and reads Prática in the curriculum', async ({
    page,
  }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${courseId}`);
    await page.getByRole('link', { name: C.curriculum.newLesson }).click();
    await expect(page).toHaveURL(
      new RegExp(`/cursos/${courseId}/aulas/nova\\?modulo=${moduleId}$`),
    );

    await expect(page.getByRole('heading', { name: L.form.createTitle })).toBeVisible();
    await expect(page.locator('[data-lesson-module]')).toHaveText(
      fill(L.form.subtitle, { position: '1', module: names.module }),
    );
    await expect(submit(page)).toBeDisabled();
    // E09 empty: the dropzone with the outline CTA and the helper; no player, no card, no URL field.
    await expect(page.locator('[data-lesson-video]')).toHaveAttribute('data-video-state', 'empty');
    await expect(page.getByTestId('video-upload')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enviar vídeo' })).toBeVisible();
    await expect(page.getByText(L.video.helper)).toBeVisible();
    await expect(page.locator('input[type="url"]')).toHaveCount(0);
    // D-407: the gated helper on a course a product opens; the switch off and editable.
    await expect(page.locator('[data-lesson-free-helper]')).toHaveText(L.free.helperGated);
    const toggle = page.getByRole('switch', { name: L.free.label });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(toggle).toBeEnabled();
    // E10 empty: 0/10, no list, the dropzone, the button and the helper from the contract.
    await expect(page.locator('[data-materials-count]')).toHaveText('0/10');
    await expect(page.getByTestId('lesson-materials')).toHaveCount(0);
    await expect(page.locator('#material-dropzone')).toHaveCount(1);
    await expect(page.getByRole('button', { name: L.materials.add })).toBeVisible();
    await expect(
      page.getByText(
        fill(L.materials.helper, { limit: '10', size: '50 MB', kinds: L.materials.kinds.full }),
      ),
    ).toBeVisible();
    await expect(page.locator('[data-lesson-remove]')).toHaveCount(0);

    await page.locator('#lesson-title').fill(names.practice);
    await expect(submit(page)).toBeEnabled();
    await submit(page).click();
    await expect(toast(page, C.toasts.lessonCreated)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/cursos/${courseId}$`));
    await expect(lessonRowMeta(page, names.practice)).toHaveText(C.curriculum.lesson.practice);
    const saved = await lessonByTitle(names.practice);
    expect(saved).not.toBeNull();
    expect(saved?.videoAssetId).toBeNull();
    expect(saved?.isFree).toBe(false);
    practiceId = saved?.id ?? '';
  });

  test("UI-D-398 / D-409 / E09 loading: the processing card, then — once the asset is ready — the player and the asset's 12:34, never typed", async ({
    page,
  }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${courseId}/aulas/${videoLesson.id}`);
    await expect(page.getByRole('heading', { name: L.form.editTitle })).toBeVisible();
    await expect(page.locator('[data-lesson-video]')).toHaveAttribute(
      'data-video-state',
      'processing',
    );
    const card = page.locator('[data-lesson-video-processing]');
    await expect(card).toBeVisible();
    await expect(card).toContainText(L.video.processing);
    await expect(card).toContainText(L.video.processingBody);
    await expect(page.getByTestId('video-upload')).toHaveCount(0);

    // The provider's webhook stand-in: the readiness poll (2 s, then the backoff) picks it up and the
    // block re-reads the asset for its seconds.
    await markAssetReady(videoLesson.videoAssetId, { durationSeconds: 754 });
    await expect(page.locator('[data-lesson-video]')).toHaveAttribute('data-video-state', 'ready', {
      timeout: 30_000,
    });
    await expect(page.locator('[data-lesson-video-duration] [aria-hidden]')).toHaveText('12:34');
    await expect(page.getByTestId('video-ready')).toBeVisible();
    await expect(page.getByRole('button', { name: L.video.remove })).toBeVisible();
    await expect(page.locator('input[type="url"]')).toHaveCount(0);
    // The form saved nothing on its own: the lesson still links the same asset.
    expect((await lessonByTitle(names.video))?.videoAssetId).toBe(videoLesson.videoAssetId);
  });

  test('D-407 / E09 partial: "Aula aberta" toggled on the gated course saves only the flag and the row reads · Aula aberta', async ({
    page,
  }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${courseId}/aulas/${practiceId}`);
    await expect(page.locator('[data-lesson-free-helper]')).toHaveText(L.free.helperGated);
    await expect(submit(page)).toBeDisabled();
    await page.getByRole('switch', { name: L.free.label }).click();
    await expect(page.getByRole('switch', { name: L.free.label })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(submit(page)).toBeEnabled();
    await submit(page).click();
    await expect(toast(page, C.toasts.saved)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/cursos/${courseId}$`));
    await expect(lessonRowMeta(page, names.practice)).toHaveText(
      `${C.curriculum.lesson.practice}${C.curriculum.lesson.free}`,
    );
    await expect.poll(async () => (await lessonByTitle(names.practice))?.isFree).toBe(true);
  });

  test('08.5-10 D-428 / UI-D-438 / A-UI-6 / E12: the first lesson\'s switch is disabled with its reason; on the second, "Aula aberta" disables it; off again, the switch saves, persists after a reload and the row reads " · Exige a anterior"', async ({
    page,
  }) => {
    const R = L.requiresPrevious;
    const requires = () => page.getByRole('switch', { name: R.label });
    const helper = () => page.locator('[data-lesson-requires-helper]');
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);

    // E12 partial: the course's first lesson (the processing-video fixture, position 1).
    await page.goto(`${tenant.origin}/cursos/${courseId}/aulas/${videoLesson.id}`);
    await expect(page.getByRole('heading', { name: L.form.editTitle })).toBeVisible();
    await expect(requires()).toBeDisabled();
    await expect(requires()).toHaveAttribute('aria-checked', 'false');
    await expect(helper()).toHaveText(R.first);

    // The second lesson: editable, the rule's sentence; "Aula aberta" on → disabled, off, its reason.
    await page.goto(`${tenant.origin}/cursos/${courseId}/aulas/${cappedId}`);
    await expect(requires()).toBeEnabled();
    await expect(requires()).toHaveAttribute('aria-checked', 'false');
    await expect(helper()).toHaveText(R.helper);
    const free = page.getByRole('switch', { name: L.free.label });
    await free.click();
    await expect(free).toHaveAttribute('aria-checked', 'true');
    await expect(requires()).toBeDisabled();
    await expect(requires()).toHaveAttribute('aria-checked', 'false');
    await expect(helper()).toHaveText(R.free);
    await free.click();
    await expect(free).toHaveAttribute('aria-checked', 'false');
    await expect(requires()).toBeEnabled();
    await expect(helper()).toHaveText(R.helper);
    await expect(submit(page)).toBeDisabled();

    await requires().click();
    await expect(requires()).toHaveAttribute('aria-checked', 'true');
    await expect(submit(page)).toBeEnabled();
    await submit(page).click();
    await expect(toast(page, C.toasts.saved)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/cursos/${courseId}$`));
    await expect.poll(async () => (await lessonByTitle(names.capped))?.requiresPrevious).toBe(true);
    expect((await lessonByTitle(names.capped))?.isFree).toBe(false);

    // UI-D-438: the admin row's caption after the meta.
    const cappedRow = page
      .getByTestId('lesson-row')
      .filter({ has: page.getByTestId('lesson-row-title').filter({ hasText: names.capped }) });
    await expect(cappedRow.getByTestId('lesson-row-requires')).toContainText(
      `· ${C.curriculum.lesson.requiresPrevious}`,
    );
    // The first lesson carries no caption.
    await expect(
      page
        .getByTestId('lesson-row')
        .filter({ has: page.getByTestId('lesson-row-title').filter({ hasText: names.video }) })
        .getByTestId('lesson-row-requires'),
    ).toHaveCount(0);

    // Persisted: the reload reads the switch on.
    await page.goto(`${tenant.origin}/cursos/${courseId}/aulas/${cappedId}`);
    await expect(requires()).toHaveAttribute('aria-checked', 'true');
    await expect(requires()).toBeEnabled();
    await expect(submit(page)).toBeDisabled();

    // UI-D-438: the module sheet's helper is the reworded sentence now that the rule is live — read
    // on a would-be second module ("Novo módulo"), closed without saving.
    await page.goto(`${tenant.origin}/cursos/${courseId}`);
    await page.getByRole('button', { name: C.curriculum.newModule }).click();
    const sheet = page.getByRole('dialog', { name: C.module.form.createTitle });
    await expect(sheet.getByRole('switch', { name: C.module.form.requiresPrevious })).toBeEnabled();
    await expect(sheet.locator('[data-module-requires-helper]')).toHaveText(
      C.module.form.requiresPreviousHelper,
    );
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await courseModules(courseId)).toHaveLength(1);
  });

  test('UI-D-399 / D-410 / PR-7: a PDF and an XLSX go through the dropzone straight to Storage, read their kind · size, one moves up, the order is kept after a reload and a saved row opens a token= URL', async ({
    page,
  }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    // `window.open` recorded instead of opened: the signed URL must not be chased into a download.
    // WR-07: the form opens a BLANK tab inside the tap and navigates it once the URL arrives, so the
    // stub hands back a fake tab whose `location.href` records the navigation.
    await page.addInitScript(() => {
      const opened: string[] = [];
      (window as unknown as { __opened: string[] }).__opened = opened;
      window.open = ((url?: string | URL) => {
        if (url) opened.push(String(url));
        const tab = {
          opener: window as unknown,
          close: () => undefined,
          location: {
            set href(next: string) {
              opened.push(next);
            },
          },
        };
        return tab as unknown as Window;
      }) as typeof window.open;
    });
    const requests: { url: string; body: number }[] = [];
    page.on('request', (request) => {
      let body = 0;
      try {
        body = request.postDataBuffer()?.length ?? 0;
      } catch {
        body = -1;
      }
      requests.push({ url: request.url(), body });
    });
    await page.goto(`${tenant.origin}/cursos/${courseId}/aulas/${practiceId}`);
    await expect(page.locator('[data-materials-count]')).toHaveText('0/10');

    await pickMaterial(page, {
      name: 'Protocolo de marcação.pdf',
      mimeType: 'application/pdf',
      buffer: PDF_BYTES,
    });
    await expect.poll(() => metas(page), { timeout: 30_000 }).toEqual(['PDF · 2,4 MB']);
    await pickMaterial(page, {
      name: 'Tabela de doses.xlsx',
      mimeType: XLSX_MIME,
      buffer: XLSX_BYTES,
    });
    await expect
      .poll(() => metas(page), { timeout: 30_000 })
      .toEqual(['PDF · 2,4 MB', 'Planilha · 180 KB']);
    await expect(page.locator('[data-materials-count]')).toHaveText('2/10');
    // A fresh upload is not openable yet: its name is text, not a button.
    await expect(
      page.getByRole('button', { name: 'Tabela de doses.xlsx', exact: true }),
    ).toHaveCount(0);

    // PR-7: the bytes went to Storage; nothing fat reached the Next origin and the API was never
    // called from the browser (the media-upload.spec.ts assertion).
    expect(requests.filter((r) => r.url.includes('/storage/v1/')).length).toBeGreaterThan(0);
    expect(requests.filter((r) => r.url.includes('localhost:8787'))).toHaveLength(0);
    expect(
      requests.filter((r) => !r.url.includes('/storage/v1/') && r.body > 512 * 1024),
    ).toHaveLength(0);

    await page
      .getByRole('button', {
        name: fill(C.reorder.moveUp, { name: 'Tabela de doses.xlsx' }),
        exact: true,
      })
      .click();
    await expect.poll(() => metas(page)).toEqual(['Planilha · 180 KB', 'PDF · 2,4 MB']);
    await expect(submit(page)).toBeEnabled();
    await submit(page).click();
    await expect(toast(page, C.toasts.saved)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/cursos/${courseId}$`));
    await expect
      .poll(async () =>
        (await lessonMaterials(practiceId)).map((m) => `${m.position}:${m.filename}`),
      )
      .toEqual(['1:Tabela de doses.xlsx', '2:Protocolo de marcação.pdf']);

    // The reload: the order kept, both rows now saved (their names are buttons), and the open.
    await page.goto(`${tenant.origin}/cursos/${courseId}/aulas/${practiceId}`);
    await expect.poll(() => metas(page)).toEqual(['Planilha · 180 KB', 'PDF · 2,4 MB']);
    await expect(page.locator('[data-materials-count]')).toHaveText('2/10');
    await page.getByRole('button', { name: 'Protocolo de marcação.pdf', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened))
      .toHaveLength(1);
    const opened = await page.evaluate(
      () => (window as unknown as { __opened: string[] }).__opened[0] ?? '',
    );
    expect(opened).toContain('token=');
    expect(opened).toContain('/storage/v1/');
    // The URL is minted per tap and never rendered into the page.
    expect(await page.locator('body').innerHTML()).not.toContain(opened);
  });

  test('E10 overflow / zero-one-many: at 10 materials the cap line shows and the dropzone and button are absent; the 320px row keeps its arrows and remove', async ({
    page,
  }, testInfo) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${courseId}/aulas/${cappedId}`);
    await expect(page.locator('[data-materials-count]')).toHaveText('10/10');
    await expect(page.getByTestId('lesson-materials').getByRole('listitem')).toHaveCount(10);
    await expect(page.locator('[data-materials-cap]')).toHaveText(
      fill(L.materials.atCap, { limit: '10' }),
    );
    await expect(page.locator('#material-dropzone')).toHaveCount(0);
    await expect(page.getByRole('button', { name: L.materials.add })).toHaveCount(0);
    // The <ol> is named by the Materiais heading (UI-D-407).
    await expect(page.getByRole('list', { name: L.materials.title })).toBeVisible();

    if (testInfo.project.name === 'mobile-chromium') {
      await page.setViewportSize({ width: 320, height: 800 });
      const first = page.locator('[data-material-row]').first();
      const name = `${prefix} material 1.pdf`;
      for (const control of [
        first.getByRole('button', { name: fill(C.reorder.moveDown, { name }), exact: true }),
        first.getByRole('button', { name: fill(L.materials.remove, { file: name }), exact: true }),
      ]) {
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      }
      // The file name truncates by CSS; the row does not overflow the viewport.
      const overflow = await first.evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(overflow).toBe(false);
    }
  });

  test('UI-D-404 / UI-D-405 / PR-5: "Remover aula" through the danger dialog toasts Aula removida. and the row leaves the curriculum', async ({
    page,
  }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${courseId}/aulas/${practiceId}`);
    // The hydration gate: `dispatchEvent` does not wait for React's handlers the way a navigation
    // from the course page did above, so the switch is clicked until it visibly flips (and restored).
    const toggle = page.getByRole('switch', { name: L.free.label });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect
      .poll(async () => {
        await toggle.click();
        return toggle.getAttribute('aria-checked');
      })
      .toBe('false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    // Dispatched AT the element: under `next dev` the dev-tools badge sits over this bottom-left
    // row and intercepts a coordinate click (the plan 07 precedent).
    await page.locator('[data-lesson-remove]').dispatchEvent('click');
    const dialog = page.getByRole('dialog', { name: L.removeDialog.title });
    await expect(dialog).toContainText(L.removeDialog.body);
    await dialog.getByRole('button', { name: L.removeDialog.confirm, exact: true }).click();
    await expect(toast(page, C.toasts.lessonRemoved)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/cursos/${courseId}$`));
    await expect(
      page.getByTestId('lesson-row-title').filter({ hasText: names.practice }),
    ).toHaveCount(0);
    // A soft delete: the row stays with deleted_at (PR-5).
    await expect.poll(async () => (await lessonByTitle(names.practice))?.removed).toBe(true);

    // An unknown lesson id is the lesson segment's not-found, "Aula indisponível" (08.5-08,
    // UI-D-441: the segment's own `not-found.tsx` since the member player, not the course's).
    await page.goto(
      `${tenant.origin}/cursos/${courseId}/aulas/00000000-0000-4000-8000-000000000000`,
    );
    const missing = page.getByTestId('lesson-not-found');
    await expect(missing).toBeVisible();
    await expect(missing.getByText(C.notFound.lesson, { exact: true })).toBeVisible();
  });
});

/* ── 08.3-10: the Trilhas tab and the track form (UI-D-391, UI-D-392, UI-D-402, D-414, D-415) ── */

/**
 * The tracks flow on its own throwaway school (`e2e-ct-<project>`) with two PUBLISHED and one DRAFT
 * fixture course: from the empty Trilhas tab the admin creates a track through the form, picks the
 * two published courses in the sheet (the draft is absent from it), moves the second up with the
 * arrow, saves and sees the row with "2 cursos"; reopens and sees the order kept. After the fixture
 * unpublishes one course the form shows "Não publicado" on it and the row reads "1 curso"; a subtitle
 * save leaves the link row (drop at read time, D-415) and removing the stale row unlinks it. Then the
 * track is archived through the danger dialog and listed under Arquivadas with "Arquivada".
 */
test.describe('tracks', () => {
  test.skip(isRemote, 'the courses fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  let prefix = '';
  let tenant: CoursesTenant;
  const names = { track: '', first: '', second: '', draft: '' };
  const ids = { first: '', second: '', draft: '' };
  let trackId = '';

  const T = C.track;
  const trackForm = (page: Page) => page.locator('[data-track-form]');
  const trackSubmit = (page: Page) => trackForm(page).locator('button[type="submit"]');
  const rowIds = (page: Page) =>
    page
      .locator('[data-track-course-row]')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-track-course-row')));
  const trackRow = (page: Page, status: string) =>
    page.getByRole('link', { name: `${names.track}, ${status}`, exact: true });
  /** Proves React's handlers are attached after a `page.goto` (the 08.3-09 hydration gate): the
   *  picker opens only through state. */
  const hydrate = async (page: Page) => {
    await page.getByRole('button', { name: T.form.change }).click();
    const sheet = page.getByRole('dialog', { name: T.picker.title });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: T.picker.done }).click();
    await expect(sheet).toHaveCount(0);
  };

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    prefix = `e2e-ct-${testInfo.project.name}-${run}`;
    tenant = await createCoursesTenant(`e2e-ct-${testInfo.project.name}`, SEED_PASSWORD);
    names.track = `${prefix} Do zero ao primeiro atendimento`;
    names.first = `${prefix} Harmonização facial do zero`;
    names.second = `${prefix} Protocolos de biossegurança`;
    names.draft = `${prefix} Rascunho de lábios`;
    ids.first = await createCourse({
      tenantSlug: tenant.slug,
      title: names.first,
      status: 'published',
      minutesAgo: 3,
    });
    ids.second = await createCourse({
      tenantSlug: tenant.slug,
      title: names.second,
      status: 'published',
      minutesAgo: 2,
    });
    ids.draft = await createCourse({ tenantSlug: tenant.slug, title: names.draft, minutesAgo: 1 });
  });

  test.afterAll(async () => {
    if (prefix) await deleteTracksByPrefix(prefix);
    if (tenant) await deleteCoursesTenant(tenant.slug);
    await closeCoursesAdmin();
  });

  test('UI-D-391 / UI-D-402 / D-414 / COURSE-10: from the empty Trilhas tab the admin creates a track, picks the two published courses (the draft is absent), moves the second up, saves and sees "2 cursos"; reopening keeps the order', async ({
    page,
  }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos?aba=trilhas`);

    // E04 empty: the tab's title row, the two chips and the empty copy with "Criar trilha".
    const hub = page.getByTestId('courses-hub');
    await expect(hub.getByRole('tab', { name: C.hub.tabs.tracks })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(hub.getByRole('heading', { level: 2, name: C.hub.tabs.tracks })).toBeVisible();
    const chips = hub.getByRole('navigation', { name: C.tracks.filter.label });
    await expect(chips.getByRole('link')).toHaveText([
      C.tracks.filter.active,
      C.tracks.filter.archived,
    ]);
    const empty = page.getByTestId('tracks-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(C.tracks.empty.title);
    await expect(empty.getByRole('link', { name: C.tracks.empty.cta })).toHaveAttribute(
      'href',
      '/cursos/trilhas/nova',
    );
    await hub.getByRole('link', { name: C.hub.create.track }).click();
    await expect(page).toHaveURL(/\/cursos\/trilhas\/nova$/);

    // E12 empty: the form opens with no course, the picker button reading "Escolher cursos".
    await expect(page.getByRole('heading', { name: T.form.createTitle })).toBeVisible();
    await expect(trackSubmit(page)).toBeDisabled();
    await expect(page.locator('[data-track-cover-fallback]')).toBeVisible();
    await expect(page.locator('[data-track-courses-none]')).toHaveText(T.form.none);
    await expect(page.getByText(T.form.coursesHelper)).toBeVisible();
    await page.getByLabel(T.form.title, { exact: true }).fill(names.track);
    await page.getByLabel(T.form.audience, { exact: true }).fill('Para quem está começando');

    // The picker: published courses only — the draft never reaches the sheet (D-415).
    await page.getByRole('button', { name: T.form.choose }).click();
    const sheet = page.getByRole('dialog', { name: T.picker.title });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(T.picker.helper)).toBeVisible();
    await expect(sheet.getByTestId('course-picker-row')).toHaveCount(2);
    await expect(sheet.getByText(names.draft)).toHaveCount(0);
    await sheet
      .getByRole('button', { name: fill(T.picker.rowOff, { course: names.first }) })
      .click();
    await sheet
      .getByRole('button', { name: fill(T.picker.rowOff, { course: names.second }) })
      .click();
    await expect(
      sheet.getByRole('button', { name: fill(T.picker.rowOn, { course: names.second }) }),
    ).toBeVisible();
    await sheet.getByRole('button', { name: T.picker.done }).click();
    await expect(sheet).toHaveCount(0);

    // Two rows in tap order; the button now reads "Alterar cursos"; one arrow tap swaps them (D-414).
    await expect.poll(() => rowIds(page)).toEqual([ids.first, ids.second]);
    await expect(page.getByRole('button', { name: T.form.change })).toBeVisible();
    await expect(
      page.getByRole('button', { name: fill(T.form.remove, { course: names.first }) }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: fill(C.reorder.moveUp, { name: names.second }) })
      .click();
    await expect.poll(() => rowIds(page)).toEqual([ids.second, ids.first]);

    await trackSubmit(page).click();
    await expect(toast(page, C.toasts.trackCreated)).toBeVisible();
    await expect(page).toHaveURL(/\/cursos\?aba=trilhas$/);

    // UI-D-392: the row with the 16:10 fallback thumb, "2 cursos" and no pill while active.
    const row = trackRow(page, C.tracks.filter.active);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('track-row-meta')).toHaveText('2 cursos');
    await expect(row.getByTestId('track-row-pill')).toHaveCount(0);
    await expect(row.getByTestId('track-row-fallback')).toBeVisible();

    const saved = await trackByTitle(names.track);
    expect(saved?.status).toBe('active');
    expect(saved?.audience).toBe('Para quem está começando');
    trackId = saved?.id ?? '';
    expect(await trackCourseIds(trackId)).toEqual([ids.second, ids.first]);

    // Reopened: the order is kept and the form is clean.
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/cursos/trilhas/${trackId}$`));
    await expect(page.getByRole('heading', { name: T.form.editTitle })).toBeVisible();
    await expect.poll(() => rowIds(page)).toEqual([ids.second, ids.first]);
    await expect(trackSubmit(page)).toBeDisabled();
    await expect(trackForm(page).locator('[data-track-archive]')).toBeVisible();
  });

  test('D-415 / E12 partial: after the fixture unpublishes a course the row reads "1 curso" and the form shows "Não publicado" on it; a subtitle save keeps its link row; removing it unlinks', async ({
    page,
  }) => {
    test.skip(!trackId, 'needs the track the first case created');
    await setCourseStatus(ids.first, 'draft');
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos?aba=trilhas`);
    // E04 partial: the count follows the published courses only; the link row stays.
    await expect(trackRow(page, C.tracks.filter.active).getByTestId('track-row-meta')).toHaveText(
      '1 curso',
    );
    expect(await trackCourseIds(trackId)).toEqual([ids.second, ids.first]);

    await page.goto(`${tenant.origin}/cursos/trilhas/${trackId}`);
    const stale = page.locator(`[data-track-course-row="${ids.first}"]`);
    await expect(stale).toHaveAttribute('data-track-course-status', 'draft');
    await expect(stale).toContainText(C.status.notPublished);
    await expect(page.locator(`[data-track-course-row="${ids.second}"]`)).not.toContainText(
      C.status.notPublished,
    );
    await expect(
      page.getByRole('button', { name: fill(T.form.remove, { course: names.first }) }),
    ).toBeVisible();

    // A field edit alone sends no course list: the stale link row survives (drop at read time).
    await page.getByLabel(T.form.subtitle, { exact: true }).fill('Quatro cursos em sequência');
    await trackSubmit(page).click();
    await expect(toast(page, C.toasts.saved)).toBeVisible();
    await expect(page).toHaveURL(/\/cursos\?aba=trilhas$/);
    await expect
      .poll(async () => (await trackByTitle(names.track))?.subtitle)
      .toBe('Quatro cursos em sequência');
    expect(await trackCourseIds(trackId)).toEqual([ids.second, ids.first]);

    // Removing the stale row and saving sends the published list without it: the link goes.
    await page.goto(`${tenant.origin}/cursos/trilhas/${trackId}`);
    await hydrate(page);
    await page
      .getByRole('button', { name: fill(T.form.remove, { course: names.first }) })
      .dispatchEvent('click');
    await expect.poll(() => rowIds(page)).toEqual([ids.second]);
    await trackSubmit(page).click();
    await expect(toast(page, C.toasts.saved)).toBeVisible();
    await expect(page).toHaveURL(/\/cursos\?aba=trilhas$/);
    await expect.poll(() => trackCourseIds(trackId)).toEqual([ids.second]);
    await expect(trackRow(page, C.tracks.filter.active).getByTestId('track-row-meta')).toHaveText(
      '1 curso',
    );
  });

  test('UI-D-404 / D-415: Arquivar trilha through the danger dialog lands on Arquivadas with "Arquivada"; Ativas no longer lists it; the form shows the note', async ({
    page,
  }) => {
    test.skip(!trackId, 'needs the track the first case created');
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/trilhas/${trackId}`);
    await hydrate(page);

    // The bottom-left control: dispatched, not clicked (the `next dev` badge sits over it).
    await trackForm(page).locator('[data-track-archive]').dispatchEvent('click');
    const dialog = page.getByRole('dialog', { name: T.archiveDialog.title });
    await expect(dialog).toContainText(T.archiveDialog.body);
    await dialog.getByRole('button', { name: T.archiveDialog.confirm, exact: true }).click();
    await expect(toast(page, C.toasts.trackArchived)).toBeVisible();
    await expect(page).toHaveURL(/\/cursos\?aba=trilhas&filtro=arquivadas$/);

    const archived = trackRow(page, C.status.trackArchived);
    await expect(archived).toBeVisible();
    await expect(archived.getByTestId('track-row-pill')).toHaveText([C.status.trackArchived]);
    await expect(archived.getByTestId('track-row-meta')).toHaveText('1 curso');
    await expect.poll(async () => (await trackByTitle(names.track))?.status).toBe('archived');
    // Archive never deletes: the link row survives (D-415).
    expect(await trackCourseIds(trackId)).toEqual([ids.second]);

    // Ativas no longer lists it — the tab is back to its empty state.
    await page.goto(`${tenant.origin}/cursos?aba=trilhas`);
    await expect(page.getByRole('link', { name: new RegExp(names.track) })).toHaveCount(0);
    await expect(page.getByTestId('tracks-empty')).toBeVisible();

    // E12 partial: an archived track edits without the archive row; the note replaces it.
    await page.goto(`${tenant.origin}/cursos/trilhas/${trackId}`);
    await expect(trackForm(page).locator('[data-track-archive]')).toHaveCount(0);
    await expect(trackForm(page).locator('[data-track-archived-note]')).toHaveText(
      T.form.archivedNote,
    );
  });
});

/* ── 08.3-11: the Lives tab and the live form (D-416, UI-D-391, UI-D-392, UI-D-403, COURSE-11) ── */

/** The two halves of a live row's date line in `zone` — the `courses-view` formatter, mirrored. */
function liveDateLine(iso: string, zone: string): { date: string; time: string } {
  const at = new Date(iso);
  const date = new Intl.DateTimeFormat('pt-BR', {
    timeZone: zone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
    .format(at)
    .replace(/\./g, '');
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
  return { date, time };
}

/** `YYYY-MM-DD` of the instant in `zone` (what the native date input takes). */
function zoneDate(ms: number, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/**
 * The lives end to end, on their own throwaway school (`e2e-cv-<project>`, store ON so a product can
 * open a live — its OWN slug: the host → tenant lookup is cached for 30 s, so a describe that
 * re-creates a slug another describe just removed reads "Endereço incorreto" for the rest of that
 * window): the empty
 * Lives tab, a live scheduled through the form for tomorrow 19:00 (the tenant's wall clock → the
 * stored UTC instant), its "Agendada" row with the pt-BR date line, an `http://` link refused under
 * the field; two fixture lives — one started 30 min ago reading "Ao vivo" under Próximas, one ended
 * reading "Gravada" under Passadas whose form shows the Replay row and picks a fixture lesson from the
 * grouped sheet ("Replay definido."); and the cancel flow through the danger dialog ("Voltar", then
 * "Cancelar live") → "Live cancelada.", the "Cancelada" pill in its bucket and the read-only note.
 * The mobile project also types a 200-character https URL and reads it back whole (E13 long-text, the
 * backstop's base check for plan 12's battery). The browser never computes a status: every pill is
 * what the API derived. 08.4 (D-418, UI-D-418): the live form never offers a product picker; once
 * the store links a live, its form shows "Liberada pelos produtos: X" read-only, scheduled and
 * cancelled alike, and a live no product opens shows no Acesso block.
 */
test.describe('lives', () => {
  test.skip(isRemote, 'the courses fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  let prefix = '';
  let tenant: CoursesTenant;
  let zone = 'America/Sao_Paulo';
  const names = { scheduled: '', onAir: '', ended: '', course: '', lesson: '', product: '' };
  const ids = { onAir: '', ended: '', lesson: '', product: '' };
  let scheduledId = '';
  /** Tomorrow 19:00 in the tenant's zone, as the two inputs take it. */
  const when = { date: '', time: '19:00' };

  const L = C.live;
  const liveForm = (page: Page) => page.locator('[data-live-form]');
  const liveSubmit = (page: Page) => liveForm(page).locator('button[type="submit"]');
  const liveRow = (page: Page, title: string, status: string) =>
    page.getByRole('link', { name: `${title}, ${status}`, exact: true });
  /** Proves React's handlers are attached after a `page.goto` (the 08.3-09 hydration gate): a typed
   *  character enables the submit, its removal disables it again — state only, nothing saved. */
  const hydrate = async (page: Page, title: string) => {
    const input = page.getByLabel(C.form.title.label, { exact: true });
    await input.fill(`${title} x`);
    await expect(liveSubmit(page)).toBeEnabled();
    await input.fill(title);
    await expect(liveSubmit(page)).toBeDisabled();
  };

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    prefix = `e2e-cv-${testInfo.project.name}-${run}`;
    tenant = await createCoursesTenant(`e2e-cv-${testInfo.project.name}`, SEED_PASSWORD, ['store']);
    zone = await tenantTimezone(tenant.slug);
    when.date = zoneDate(Date.now() + 24 * 3_600_000, zone);
    names.scheduled = `${prefix} Tira-dúvidas de outubro`;
    names.onAir = `${prefix} Live de agora`;
    names.ended = `${prefix} Live de abertura`;
    names.course = `${prefix} Harmonização facial`;
    names.lesson = `${names.course} aula 1.1`;
    // The replay's target: a course with one module and one lesson (the fixture's naming).
    await createCourse({
      tenantSlug: tenant.slug,
      title: names.course,
      status: 'published',
      lessonsPerModule: 1,
      minutesAgo: 5,
    });
    ids.lesson = (await lessonByTitle(names.lesson))?.id ?? '';
    ids.onAir = await createLive({
      tenantSlug: tenant.slug,
      title: names.onAir,
      startsAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      durationMin: 60,
    });
    ids.ended = await createLive({
      tenantSlug: tenant.slug,
      title: names.ended,
      startsAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      durationMin: 45,
    });
    names.product = `${prefix} Ingresso das lives`;
    ids.product = await createProduct({
      tenantSlug: tenant.slug,
      name: names.product,
      priceCents: 4_990,
    });
  });

  test.afterAll(async () => {
    if (prefix) await deleteLivesByPrefix(prefix);
    if (tenant) await deleteCoursesTenant(tenant.slug);
    await closeStoreAdmin();
    await closeCoursesAdmin();
  });

  test('UI-D-391 / UI-D-403 / D-416 / COURSE-11: the Lives tab lists the fixtures by derived state; from "Nova live" the admin schedules a live for tomorrow 19:00 — an http:// link is refused under the field — and sees it under Próximas as "Agendada" with the pt-BR date line', async ({
    page,
  }, testInfo) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos?aba=lives`);

    // E04: the tab's title row, the two chips; the on-air fixture reads "Ao vivo" here, the ended one
    // is NOT in this bucket (it sits under Passadas).
    const hub = page.getByTestId('courses-hub');
    await expect(hub.getByRole('tab', { name: C.hub.tabs.lives })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(hub.getByRole('heading', { level: 2, name: C.hub.tabs.lives })).toBeVisible();
    const chips = hub.getByRole('navigation', { name: C.lives.filter.label });
    await expect(chips.getByRole('link')).toHaveText([
      C.lives.filter.upcoming,
      C.lives.filter.past,
    ]);
    const onAir = liveRow(page, names.onAir, C.status.live);
    await expect(onAir).toBeVisible();
    await expect(onAir.getByTestId('live-row-pill')).toHaveText([C.status.live]);
    await expect(onAir.getByTestId('live-row-fallback')).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(names.ended) })).toHaveCount(0);

    await hub.getByRole('link', { name: C.hub.create.live }).click();
    await expect(page).toHaveURL(/\/cursos\/lives\/nova$/);

    // E13: the empty create form — no pill, no replay row, no cancel row; 60 min by default.
    await expect(page.getByRole('heading', { name: L.form.createTitle })).toBeVisible();
    await expect(liveSubmit(page)).toBeDisabled();
    await expect(page.locator('[data-live-cover-fallback]')).toBeVisible();
    await expect(page.locator('[data-live-status-pill]')).toHaveCount(0);
    await expect(page.locator('[data-live-replay]')).toHaveCount(0);
    await expect(page.locator('[data-live-cancel]')).toHaveCount(0);
    await expect(page.locator('#live-duration')).toHaveValue('60');
    await expect(page.getByText(L.form.durationHelper)).toBeVisible();
    await expect(page.getByText(L.form.urlHelper)).toBeVisible();
    // D-418 / UI-D-418: the create form has no Acesso block and no product picker (store on).
    await expect(page.locator('[data-live-access]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Escolher produtos' })).toHaveCount(0);

    await page.getByLabel(C.form.title.label, { exact: true }).fill(names.scheduled);
    await page.locator('#live-start-date').fill(when.date);
    await page.locator('#live-start-time').fill(when.time);
    await page.locator('#live-url').fill('http://youtu.be/sem-tls');
    await liveSubmit(page).click();
    // T-08.3-11: refused under the field, nothing written.
    await expect(page.getByText(L.form.errors.urlInvalid)).toBeVisible();
    await expect(page).toHaveURL(/\/cursos\/lives\/nova$/);
    expect(await liveByTitle(names.scheduled)).toBeNull();

    if (testInfo.project.name === 'mobile-chromium') {
      // E13 long-text (the backstop's base check): a 200-character https URL is accepted whole by
      // the field and the page keeps its width; the field scrolls inside itself.
      const long = `https://www.youtube.com/watch?v=${'a'.repeat(200 - 32)}`;
      expect(long.length).toBe(200);
      await page.locator('#live-url').fill(long);
      await expect(page.locator('#live-url')).toHaveValue(long);
      const geometry = await page.locator('#live-url').evaluate((node) => {
        const input = node as HTMLInputElement;
        // A text input scrolls its value inside itself: a scrollLeft that sticks proves the field
        // is wider than its box and grew nowhere else.
        input.scrollLeft = 10_000;
        return {
          scrolls: input.scrollLeft > 0,
          fieldFits: input.getBoundingClientRect().right <= window.innerWidth,
          pageFits: document.documentElement.scrollWidth <= window.innerWidth,
        };
      });
      expect(geometry.scrolls).toBe(true);
      expect(geometry.fieldFits).toBe(true);
      expect(geometry.pageFits).toBe(true);
    }

    await page.locator('#live-url').fill('https://youtu.be/tira-duvidas');
    await expect(page.getByText(L.form.errors.urlInvalid)).toHaveCount(0);
    await liveSubmit(page).click();
    await expect(toast(page, C.toasts.liveScheduled)).toBeVisible();
    await expect(page).toHaveURL(/\/cursos\?aba=lives$/);

    // UI-D-392: the row under Próximas with "Agendada" and the tenant-zone date line.
    const saved = await liveByTitle(names.scheduled);
    expect(saved).not.toBeNull();
    scheduledId = saved?.id ?? '';
    expect(saved?.durationMin).toBe(60);
    expect(saved?.externalUrl).toBe('https://youtu.be/tira-duvidas');
    expect(saved?.cancelledAt).toBeNull();
    // The stored instant is tomorrow 19:00 in the TENANT's zone (not the browser's).
    const line = liveDateLine(saved?.startsAt ?? '', zone);
    expect(line.time).toBe('19:00');
    expect(zoneDate(Date.parse(saved?.startsAt ?? ''), zone)).toBe(when.date);
    const row = liveRow(page, names.scheduled, C.status.scheduled);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('live-row-pill')).toHaveText([C.status.scheduled]);
    await expect(row.getByTestId('live-row-meta')).toHaveText(
      fill(C.lives.row.meta, { date: line.date, time: line.time, duration: '60' }),
    );

    // Reopened: the edit form with the pill, the stored wall clock, the cancel row, NO replay row.
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/cursos/lives/${scheduledId}$`));
    await expect(page.getByRole('heading', { name: L.form.editTitle })).toBeVisible();
    await expect(page.locator('[data-live-status-pill]')).toHaveText(C.status.scheduled);
    await expect(page.locator('#live-start-date')).toHaveValue(when.date);
    await expect(page.locator('#live-start-time')).toHaveValue(when.time);
    await expect(liveSubmit(page)).toBeDisabled();
    await expect(liveForm(page).locator('[data-live-cancel]')).toBeVisible();
    await expect(page.locator('[data-live-replay]')).toHaveCount(0);
  });

  test('E04 partial / UI-D-403 / A5: the ended fixture reads "Gravada" under Passadas; its form shows the Replay row; the grouped sheet lists the course and its lesson under "Sem replay"; picking it reads "{course} · {lesson}" and saves with "Replay definido."', async ({
    page,
  }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos?aba=lives&filtro=passadas`);
    const hub = page.getByTestId('courses-hub');
    await expect(
      hub.getByRole('navigation', { name: C.lives.filter.label }).getByRole('link', {
        name: C.lives.filter.past,
      }),
    ).toHaveAttribute('aria-current', 'page');
    const ended = liveRow(page, names.ended, C.status.recorded);
    await expect(ended).toBeVisible();
    await expect(ended.getByTestId('live-row-pill')).toHaveText([C.status.recorded]);
    await expect(page.getByRole('link', { name: new RegExp(names.onAir) })).toHaveCount(0);

    await ended.click();
    await expect(page).toHaveURL(new RegExp(`/cursos/lives/${ids.ended}$`));
    await expect(page.locator('[data-live-status-pill]')).toHaveText(C.status.recorded);
    const replayRow = page.locator('[data-live-replay-row]');
    await expect(replayRow).toBeVisible();
    await expect(page.locator('[data-live-replay-value]')).toHaveText(L.form.replayNone);
    await expect(page.getByText(L.form.replayHelper)).toBeVisible();

    await replayRow.click();
    const sheet = page.getByRole('dialog', { name: L.replay.title });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(L.replay.helper)).toBeVisible();
    const radios = sheet.getByRole('radio');
    await expect(radios.first()).toHaveAttribute('data-testid', 'lesson-picker-none');
    await expect(radios.first()).toHaveAttribute('aria-checked', 'true');
    await expect(
      sheet.getByTestId('lesson-picker-group').getByRole('heading', { name: names.course }),
    ).toBeVisible();
    await sheet
      .getByRole('radio', {
        name: fill(L.replay.row, { lesson: names.lesson, course: names.course }),
      })
      .click();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator('[data-live-replay-value]')).toHaveText(
      fill(L.form.replayValue, { course: names.course, lesson: names.lesson }),
    );
    await expect(liveSubmit(page)).toBeEnabled();
    await liveSubmit(page).click();
    await expect(toast(page, C.toasts.replaySet)).toBeVisible();
    await expect(page).toHaveURL(/\/cursos\?aba=lives$/);
    await expect
      .poll(async () => (await liveByTitle(names.ended))?.replayLessonId)
      .toBe(ids.lesson);

    // Reopened: the replay reads back from the saved pointer.
    await page.goto(`${tenant.origin}/cursos/lives/${ids.ended}`);
    await expect(page.locator('[data-live-replay-value]')).toHaveText(
      fill(L.form.replayValue, { course: names.course, lesson: names.lesson }),
    );
  });

  test('D-418 / UI-D-418: the live form has no product picker; a store link shows "Liberada pelos produtos" read-only on the scheduled live, linking to the product; a live with no link shows no Acesso block', async ({
    page,
  }) => {
    test.skip(!scheduledId, 'needs the live the first case scheduled');
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);

    // The ended fixture: no product opens it, so no Acesso block (and never a picker).
    await page.goto(`${tenant.origin}/cursos/lives/${ids.ended}`);
    await expect(page.locator('[data-live-status-pill]')).toHaveText(C.status.recorded);
    await expect(liveForm(page).locator('[data-live-access]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Escolher produtos' })).toHaveCount(0);

    // The store links the scheduled live (the row the product form writes, 08.4).
    await linkLiveProduct(scheduledId, ids.product);
    await page.goto(`${tenant.origin}/cursos/lives/${scheduledId}`);
    await expect(page.locator('[data-live-status-pill]')).toHaveText(C.status.scheduled);
    const access = liveForm(page).locator('[data-live-access]');
    await expect(access).toContainText(C.form.access.label);
    await expect(access.locator('[data-live-access-value]')).toHaveText(
      fill(L.form.access.value, { products: names.product }),
    );
    await expect(access).toContainText(C.form.access.helper);
    await expect(access.getByRole('link', { name: names.product, exact: true })).toHaveAttribute(
      'href',
      `/loja/${ids.product}`,
    );
    await expect(access.locator('input, textarea, button, select')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Escolher produtos' })).toHaveCount(0);
    await expect(liveSubmit(page)).toBeDisabled();
  });

  test('UI-D-404 / D-416 / P44: "Cancelar live" through the danger dialog — "Voltar" closes it, "Cancelar live" cancels — toasts "Live cancelada.", the form turns read-only with the note, and the row keeps its bucket with "Cancelada"', async ({
    page,
  }) => {
    test.skip(!scheduledId, 'needs the live the first case scheduled');
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/lives/${scheduledId}`);
    await hydrate(page, names.scheduled);

    // The bottom-left control: dispatched, not clicked (the `next dev` badge sits over it).
    await liveForm(page).locator('[data-live-cancel]').dispatchEvent('click');
    const dialog = page.getByRole('dialog', { name: L.cancelDialog.title });
    await expect(dialog).toContainText(L.cancelDialog.body);
    await dialog.getByRole('button', { name: L.cancelDialog.cancel, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await liveByTitle(names.scheduled))?.cancelledAt).toBeNull();

    await liveForm(page).locator('[data-live-cancel]').dispatchEvent('click');
    const again = page.getByRole('dialog', { name: L.cancelDialog.title });
    await again.getByRole('button', { name: L.cancelDialog.confirm, exact: true }).click();
    await expect(toast(page, C.toasts.liveCancelled)).toBeVisible();
    await expect.poll(async () => (await liveByTitle(names.scheduled))?.cancelledAt).not.toBeNull();

    // The refreshed form: the server now says cancelled — the pill, the note, no cancel row, no
    // replay row, the fields disabled (the API refuses 409 live_cancelled anyway).
    await expect(page).toHaveURL(new RegExp(`/cursos/lives/${scheduledId}$`));
    await expect(page.locator('[data-live-status-pill]')).toHaveText(C.status.cancelled);
    await expect(liveForm(page).locator('[data-live-cancelled-note]')).toHaveText(
      L.form.cancelledNote,
    );
    await expect(liveForm(page).locator('[data-live-cancel]')).toHaveCount(0);
    await expect(page.locator('[data-live-replay]')).toHaveCount(0);
    await expect(page.getByLabel(C.form.title.label, { exact: true })).toBeDisabled();
    await expect(page.locator('#live-url')).toBeDisabled();

    // E04 partial: the cancelled live keeps its time bucket (Próximas) with "Cancelada".
    await page.goto(`${tenant.origin}/cursos?aba=lives`);
    const row = liveRow(page, names.scheduled, C.status.cancelled);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('live-row-pill')).toHaveText([C.status.cancelled]);
    await expect(liveRow(page, names.onAir, C.status.live)).toBeVisible();
  });

  test('UI-D-418 / WR-04: the cancelled live keeps its product link and shows "Liberada pelos produtos" read-only beside the cancelled note', async ({
    page,
  }) => {
    test.skip(!scheduledId, 'needs the live the first case scheduled');
    expect((await liveByTitle(names.scheduled))?.cancelledAt).not.toBeNull();
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/lives/${scheduledId}`);

    await expect(page.locator('[data-live-status-pill]')).toHaveText(C.status.cancelled);
    await expect(liveForm(page).locator('[data-live-cancelled-note]')).toHaveText(
      L.form.cancelledNote,
    );
    const access = liveForm(page).locator('[data-live-access]');
    await expect(access.locator('[data-live-access-value]')).toHaveText(
      fill(L.form.access.value, { products: names.product }),
    );
    await expect(access.getByRole('link', { name: names.product, exact: true })).toHaveAttribute(
      'href',
      `/loja/${ids.product}`,
    );
    await expect(page.getByRole('button', { name: 'Escolher produtos' })).toHaveCount(0);
  });
});

/* ── 08.3-12: the backstop battery (the UI-SPEC's eight `verification: backstop` rows) ──────── */

/** The media catalog (the video CTA, the shipped duration refusal). */
const M = mediaMessages.media;
/** 186 KiB of real H.264 in a QuickTime container — what an iPhone records (`fixtures/README.md`). */
const SAMPLE_MOV = fileURLToPath(new URL('./fixtures/sample.mov', import.meta.url));

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

/** `line-clamp` / `truncate` in effect: the content is taller or wider than the box that shows it. */
const clampedTall = (locator: Locator) =>
  locator.evaluate((node) => node.scrollHeight > node.clientHeight);
const truncatedWide = (locator: Locator) =>
  locator.evaluate((node) => node.scrollWidth > node.clientWidth);
/** Nothing can be cut: the element's overflow is visible (no clamp, no truncation, no scroll box). */
const unclipped = (locator: Locator) =>
  locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return style.overflowY === 'visible' && style.overflowX === 'visible';
  });
/** Not squeezed: the element shows all of its own content. */
const whole = (locator: Locator) =>
  locator.evaluate((node) => node.scrollWidth <= node.clientWidth);
/** The document never grew past the viewport (no horizontal scroll). */
const pageFits = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Asserts a box sits entirely inside a viewport `width` pixels wide. */
function expectInside(box: Box, width: number): void {
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
}

/** Exactly `length` characters of real words after `prefix` (never an unbroken run, never a trailing space). */
function longText(prefix: string, length: number): string {
  const words =
    'harmonização facial avançada do zero ao resultado natural com segurança protocolos clínicos e técnica aplicada'.split(
      ' ',
    );
  let text = prefix;
  for (let index = 0; text.length < length; index += 1) {
    text += ` ${words[index % words.length]}`;
  }
  const cut = text.slice(0, length);
  return cut.endsWith(' ') ? `${cut.slice(0, -1)}a` : cut;
}

/**
 * 08.3-12 — the phase's backstops (the UI-SPEC rows marked `🧪 backstop`, lifted by plans 06–11 as
 * `verification: backstop` truths), one named case per id, each on the project the row names (the
 * 320 px checks on `mobile-chromium`, the media flows on both). Fixtures live on one throwaway
 * school per project (`e2e-cb-<project>`, store on so a course can be gated); the two media cases
 * that need the ready-event job (`E09/long-text`, `E08/populated`) bring the worker and run LAST, so
 * `E09/populated` — which plays the provider itself through `markAssetReady` — never races the fake's
 * synthetic ready (its deferred job is dropped as well, belt and braces).
 */
test.describe('backstops', () => {
  test.skip(isRemote, 'the courses fixtures write rows through the local database');
  test.describe.configure({ mode: 'serial' });

  const run = Date.now().toString(36);
  let prefix = '';
  let tenant: CoursesTenant;
  let stopWorker: (() => Promise<void>) | null = null;
  const e03 = { title: '', courseId: '' };
  const e05 = { title: '', tagline: '', courseId: '' };
  const e06 = { courseId: '', lesson: '' };
  const e09 = { courseId: '', moduleId: '', longLesson: '', longAssetId: '' };
  const e14 = { courseId: '', products: [] as string[] };
  /** 08.4 E05/E06 long-text: an 80-character product, archived after linking a course and a cancelled live. */
  const links084 = { product: '', productId: '', courseId: '', liveId: '' };

  const R = C.reorder;
  const moveUp = (page: Page, name: string) =>
    page.getByRole('button', { name: fill(R.moveUp, { name }), exact: true });
  const moveDown = (page: Page, name: string) =>
    page.getByRole('button', { name: fill(R.moveDown, { name }), exact: true });
  const lessonRowFor = (page: Page, title: string) =>
    page
      .getByTestId('lesson-row')
      .filter({ has: page.getByTestId('lesson-row-title').filter({ hasText: title }) });
  const lessonSubmit = (page: Page) => page.locator('[data-lesson-form] button[type="submit"]');
  const videoBlock = (page: Page) => page.locator('[data-lesson-video]');
  /** Picks a video the way the admin does: tap the CTA, answer the OS picker (the hydration gate). */
  const pickVideo = async (
    page: Page,
    file: { name: string; mimeType: string; buffer: Buffer },
  ) => {
    const opening = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: M.library.upload, exact: true }).click();
    await (await opening).setFiles(file);
  };

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    const project = testInfo.project.name;
    prefix = `e2e-cb-${project}-${run}`;
    tenant = await createCoursesTenant(`e2e-cb-${project}`, SEED_PASSWORD, ['store']);

    // E09 (both projects): one module to receive the .mov lesson, plus the fixture lesson whose
    // video the ready-event job will refuse.
    e09.courseId = await createCourse({
      tenantSlug: tenant.slug,
      title: `${prefix} E09 Lábios`,
      modules: 1,
      lessonsPerModule: 0,
    });
    e09.moduleId = (await courseModules(e09.courseId))[0]?.id ?? '';
    e09.longLesson = `${prefix} E09 Aula longa demais`;
    e09.longAssetId = (
      await createLessonWithProcessingVideo({
        tenantSlug: tenant.slug,
        courseId: e09.courseId,
        moduleId: e09.moduleId,
        title: e09.longLesson,
      })
    ).videoAssetId;

    if (project !== 'mobile-chromium') return;

    // E03: a 120-character draft title whose first lesson video is still processing (two pills).
    e03.title = longText(`${prefix} E03`, 120);
    e03.courseId = await createCourse({
      tenantSlug: tenant.slug,
      title: e03.title,
      status: 'draft',
      modules: 1,
      lessonsPerModule: 1,
      withUnreadyVideo: true,
      minutesAgo: 1,
    });
    // E05: a 120-character title and a 160-character tagline under the hero.
    e05.title = longText(`${prefix} E05`, 120);
    e05.tagline = longText('Uma frase de venda que se estende', 160);
    e05.courseId = await createCourse({
      tenantSlug: tenant.slug,
      title: e05.title,
      tagline: e05.tagline,
      modules: 0,
      minutesAgo: 2,
    });
    // E06: three lessons, the middle one with a 2-line title and a processing video, so BOTH of its
    // arrows are enabled.
    e06.courseId = await createCourse({
      tenantSlug: tenant.slug,
      title: `${prefix} E06 Setas`,
      modules: 1,
      lessonsPerModule: 0,
      minutesAgo: 3,
    });
    const e06Module = (await courseModules(e06.courseId))[0]?.id ?? '';
    e06.lesson = longText(`${prefix} E06`, 96);
    await createLesson({
      tenantSlug: tenant.slug,
      courseId: e06.courseId,
      moduleId: e06Module,
      title: `${prefix} E06 Primeira`,
    });
    await createLesson({
      tenantSlug: tenant.slug,
      courseId: e06.courseId,
      moduleId: e06Module,
      title: e06.lesson,
      withUnreadyVideo: true,
    });
    await createLesson({
      tenantSlug: tenant.slug,
      courseId: e06.courseId,
      moduleId: e06Module,
      title: `${prefix} E06 Terceira`,
    });
    // E14: a publishable draft (no module, nothing processing) linked to three products.
    e14.courseId = await createCourse({
      tenantSlug: tenant.slug,
      title: `${prefix} E14 Curso com produtos`,
      modules: 0,
      minutesAgo: 4,
    });
    e14.products = [
      `${prefix} Mentoria Premium em Harmonização Facial`,
      `${prefix} Imersão Presencial de Protocolos Clínicos`,
      `${prefix} Clube de Atualização Científica Anual`,
    ];
    for (const name of e14.products) {
      const productId = await createProduct({ tenantSlug: tenant.slug, name, priceCents: 19_900 });
      await linkCourseProduct(e14.courseId, productId);
    }
    // 08.4 E05/E06 long-text: the 80-character product name cap, linked to a course and to a live
    // that is then cancelled, and archived AFTER linking (WR-04: the links stay, with the suffix).
    links084.product = longText(`${prefix} P084`, 80);
    links084.productId = await createProduct({
      tenantSlug: tenant.slug,
      name: links084.product,
      priceCents: 19_900,
    });
    links084.courseId = await createCourse({
      tenantSlug: tenant.slug,
      title: `${prefix} E05-084 Curso liberado`,
      modules: 0,
      minutesAgo: 6,
    });
    await linkCourseProduct(links084.courseId, links084.productId);
    links084.liveId = await createLive({
      tenantSlug: tenant.slug,
      title: `${prefix} E06-084 Live cancelada`,
      startsAt: new Date(Date.now() + 2 * 24 * 3_600_000).toISOString(),
      cancelled: true,
    });
    await linkLiveProduct(links084.liveId, links084.productId);
    await setProductStatus(links084.productId, 'archived');
  });

  test.afterAll(async () => {
    await stopWorker?.();
    if (tenant) await deleteCoursesTenant(tenant.slug);
    // The webhook deliveries of E09/long-text: a tenant-less table pgTAP 020 counts (verify runs
    // pgTAP before its own reset), so the spec leaves none behind.
    await deleteFakeProviderEvents();
    await closeStoreAdmin();
    await closeCoursesAdmin();
  });

  test('E03/long-text: at 320px a 120-character draft title with "Rascunho" and "Processando" clamps to two lines and both pills stay whole beside the chevron', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos`);

    const row = page.getByRole('link', { name: `${e03.title}, ${C.status.draft}`, exact: true });
    await expect(row).toBeVisible();
    await row.scrollIntoViewIfNeeded();

    // The title clamps to exactly two lines (never cut in the string).
    const title = row.getByTestId('course-row-title');
    expect(await linesOf(title)).toBe(2);
    expect(await clampedTall(title)).toBe(true);
    await expect(title).toHaveText(e03.title);

    // Both pills, in order, fully inside the screen and never squeezed; then the chevron.
    const pills = row.getByTestId('course-row-pill');
    await expect(pills).toHaveText([C.status.draft, C.status.processing]);
    for (const index of [0, 1]) {
      await expect(pills.nth(index)).toBeVisible();
      expectInside(await boxOf(pills.nth(index)), 320);
      expect(await whole(pills.nth(index))).toBe(true);
    }
    const chevron = row.locator('svg').last();
    const chevronBox = await boxOf(chevron);
    expect(chevronBox.width).toBeGreaterThan(0);
    expectInside(chevronBox, 320);
    const pillBox = await boxOf(pills.nth(1));
    expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(chevronBox.x + 0.5);
    expect(await whole(row)).toBe(true);
    expect(await pageFits(page)).toBe(true);
  });

  test('E05/long-text: at 320px a 120-character title and a 160-character tagline wrap under the hero without pushing the pills off-screen; the header title truncates', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${e05.courseId}`);

    await expect(page.getByTestId('course-page')).toBeVisible();
    // The header title is one truncated line; the body title and the tagline wrap in full.
    const header = page.locator('h1').first();
    await expect(header).toHaveText(e05.title);
    expect(await truncatedWide(header)).toBe(true);
    expect(await linesOf(header)).toBe(1);
    const title = page.getByTestId('course-title');
    await expect(title).toHaveText(e05.title);
    expect(await linesOf(title)).toBeGreaterThanOrEqual(2);
    expect(await unclipped(title)).toBe(true);
    const tagline = page.getByTestId('course-tagline');
    await expect(tagline).toHaveText(e05.tagline);
    expect(await linesOf(tagline)).toBeGreaterThanOrEqual(2);
    expect(await unclipped(tagline)).toBe(true);

    // The pills row sits under the tagline, every pill inside the screen, no horizontal scroll.
    const pills = page.getByTestId('course-pills');
    await expect(pills).toBeVisible();
    await expect(page.getByTestId('course-status-pill')).toHaveText(C.status.draft);
    const taglineBox = await boxOf(tagline);
    const pillsBox = await boxOf(pills);
    expect(pillsBox.y).toBeGreaterThanOrEqual(taglineBox.y + taglineBox.height - 0.5);
    expectInside(pillsBox, 320);
    for (const pill of await pills.locator(':scope > *').all()) {
      expectInside(await boxOf(pill), 320);
      expect(await whole(pill)).toBe(true);
    }
    expect(await pageFits(page)).toBe(true);
  });

  test('E06/overflow: at 320px a lesson row with a 2-line title and the "Processando" pill keeps both 44px arrows tappable inside the viewport', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${e06.courseId}`);

    const row = lessonRowFor(page, e06.lesson);
    await expect(row).toHaveCount(1);
    await row.scrollIntoViewIfNeeded();
    // The middle lesson: both arrows ENABLED (it is neither first nor last), 44px, inside the screen.
    for (const arrow of [moveUp(page, e06.lesson), moveDown(page, e06.lesson)]) {
      await expect(arrow).toBeEnabled();
      const box = await boxOf(arrow);
      expectInside(box, 320);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // The pill reads whole; the title clamps to two lines; the row never scrolls sideways.
    const pill = row.getByTestId('lesson-row-pill');
    await expect(pill).toHaveText(C.status.processing);
    await expect(pill).toHaveAttribute('data-tone', 'warning');
    expectInside(await boxOf(pill), 320);
    expect(await whole(pill)).toBe(true);
    expect(await pill.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(30);
    const title = row.getByTestId('lesson-row-title');
    expect(await linesOf(title)).toBe(2);
    expect(await clampedTall(title)).toBe(true);
    expect(await whole(row)).toBe(true);
    expect(await pageFits(page)).toBe(true);
  });

  test("E13/long-text: at 320px a 200-character https URL fits the live form's field and scrolls inside it with no layout shift", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/lives/nova`);

    const url = page.locator('#live-url');
    await expect(url).toBeVisible();
    const before = await boxOf(url);
    const widthBefore = await page.evaluate(() => document.documentElement.scrollWidth);
    const helper = page.getByText(C.live.form.urlHelper);
    const helperBefore = await boxOf(helper);

    const long = `https://www.youtube.com/watch?v=${'a'.repeat(200 - 32)}`;
    expect(long.length).toBe(200);
    await url.fill(long);
    await expect(url).toHaveValue(long);

    const after = await boxOf(url);
    const geometry = await url.evaluate((node) => {
      const input = node as HTMLInputElement;
      input.scrollLeft = 10_000;
      return {
        overflows: input.scrollWidth > input.clientWidth,
        scrolls: input.scrollLeft > 0,
        fits: input.getBoundingClientRect().right <= window.innerWidth,
      };
    });
    // The value is wider than the box, so the field scrolls inside itself …
    expect(geometry.overflows).toBe(true);
    expect(geometry.scrolls).toBe(true);
    expect(geometry.fits).toBe(true);
    // … and nothing else moved: the field's box, the helper under it and the page width are the same.
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
    expect(Math.abs(after.width - before.width)).toBeLessThan(1);
    expect(Math.abs(after.height - before.height)).toBeLessThan(1);
    // (`fill` scrolls the field into view, so the helper is measured RELATIVE to the field.)
    const helperAfter = await boxOf(helper);
    expect(Math.abs(helperAfter.y - after.y - (helperBefore.y - before.y))).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(widthBefore);
    expect(await pageFits(page)).toBe(true);
  });

  test('E14/long-text: at 320px the "Publicar curso?" gated body names three products inside the 300px dialog without clipping', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 640 });
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${e14.courseId}`);

    const publish = page.getByTestId('course-publish');
    await expect(publish).toBeEnabled();
    await publish.click();
    const dialog = page.getByRole('dialog', { name: C.course.publishDialog.title });
    await expect(dialog).toBeVisible();

    // The gated body, with the three names, as the catalog shapes it (Intl.ListFormat pt-BR).
    const body = dialog.getByText(/^Os membros com /);
    await expect(body).toBeVisible();
    const text = (await body.textContent()) ?? '';
    for (const name of e14.products) expect(text).toContain(name);
    expect(text.endsWith(C.course.publishDialog.bodyGated.split('{products}')[1] ?? '')).toBe(true);

    // Inside the viewport, at most 300px wide, nothing clipped: the body paints every line it holds.
    const dialogBox = await boxOf(dialog);
    expectInside(dialogBox, 320);
    expect(dialogBox.width).toBeLessThanOrEqual(300.5);
    expect(dialogBox.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(640.5);
    expect(await body.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
    expect(await whole(body)).toBe(true);
    await expect(body).not.toHaveAttribute('data-confirm-body-scroll', 'true');
    expect(await linesOf(body)).toBeGreaterThanOrEqual(3);
    for (const label of [C.course.publishDialog.cancel, C.course.publishDialog.confirm]) {
      const button = dialog.getByRole('button', { name: label, exact: true });
      await expect(button).toBeVisible();
      expectInside(await boxOf(button), 320);
    }
    expect(await pageFits(page)).toBe(true);

    // Nothing published: the dialog is dismissed and the course stays a draft.
    await dialog.getByRole('button', { name: C.course.publishDialog.cancel, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await courseStatus(e14.courseId)).toBe('draft');
  });

  /** 08.4 E05/E06: the read-only line wraps inside the form column; the whole name stays one link. */
  async function expectAccessLineWraps(
    page: Page,
    column: Locator,
    value: Locator,
    sentence: string,
  ): Promise<void> {
    await expect(value).toHaveText(sentence);
    const link = value.getByRole('link');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText(links084.product);
    await expect(link).toHaveAttribute('href', `/loja/${links084.productId}`);
    await value.scrollIntoViewIfNeeded();
    // The sentence takes more than one line rather than widening anything.
    expect(await linesOf(value)).toBeGreaterThanOrEqual(2);
    expectInside(await boxOf(value), 320);
    // The form column never scrolls sideways: its scrollWidth equals its clientWidth.
    const widths = await column.evaluate((node) => ({
      scroll: node.scrollWidth,
      client: node.clientWidth,
    }));
    expect(widths.scroll).toBe(widths.client);
    expect(await whole(value)).toBe(true);
    expect(await pageFits(page)).toBe(true);
  }

  test('08.4 E05/long-text: at 320px the course form\'s "Liberado pelos produtos: …" with an 80-character archived product wraps inside the column without horizontal overflow', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${links084.courseId}/editar`);

    await expect(page.getByRole('heading', { name: C.form.editTitle })).toBeVisible();
    await expectAccessLineWraps(
      page,
      form(page),
      form(page).locator('[data-course-access-value]'),
      fill(C.form.access.value, {
        products: `${links084.product}${C.form.access.archivedSuffix}`,
      }),
    );
  });

  test('08.4 E06/long-text: at 320px a cancelled live\'s "Liberada pelos produtos: …" with the same archived product wraps inside the column without horizontal overflow', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone check');
    await page.setViewportSize({ width: 320, height: 800 });
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/lives/${links084.liveId}`);

    await expect(page.locator('[data-live-status-pill]')).toHaveText(C.status.cancelled);
    const liveForm = page.locator('[data-live-form]');
    await expectAccessLineWraps(
      page,
      liveForm,
      liveForm.locator('[data-live-access-value]'),
      fill(C.live.form.access.value, {
        products: `${links084.product}${C.form.access.archivedSuffix}`,
      }),
    );
  });

  test("E09/populated: a .mov through the lesson form's dropzone under the fake provider shows the processing card, then the player and the asset's 12:34", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const title = `${prefix} E09 Gravada no iPhone`;
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${e09.courseId}/aulas/nova?modulo=${e09.moduleId}`);
    await expect(page.getByRole('heading', { name: C.lesson.form.createTitle })).toBeVisible();
    await expect(videoBlock(page)).toHaveAttribute('data-video-state', 'empty');
    await page.locator('#lesson-title').fill(title);

    // The iPhone recording goes browser → provider (the fake's signed Storage URL) through UpChunk;
    // the row is `pending` server-side and the block draws the processing card.
    await pickVideo(page, {
      name: 'IMG_0421.mov',
      mimeType: 'video/quicktime',
      buffer: readFileSync(SAMPLE_MOV),
    });
    await expect(videoBlock(page)).toHaveAttribute('data-video-state', 'pending', {
      timeout: 60_000,
    });
    const card = page.locator('[data-lesson-video-processing]');
    await expect(card).toBeVisible();
    await expect(card).toContainText(C.lesson.video.processing);
    await expect(card).toContainText(C.lesson.video.processingBody);

    // The asset the dropzone started: a `lesson` video under the fake provider, still pending.
    const asset = await newestLessonAssetIn(tenant.slug);
    if (!asset) throw new Error('the .mov upload wrote no lesson asset');
    expect(asset.provider).toBe('fake');
    expect(['pending', 'processing']).toContain(asset.status);
    // The spec plays the provider: its own two-second synthetic ready is dropped, then the asset is
    // marked ready with 754 s, and the block re-reads the seconds — never typed (D-409).
    await dropFakeReadyJob(asset.id);
    await markAssetReady(asset.id, { durationSeconds: 754 });
    await expect(videoBlock(page)).toHaveAttribute('data-video-state', 'ready', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('video-ready')).toBeVisible();
    await expect(page.locator('[data-lesson-video-duration] [aria-hidden]')).toHaveText('12:34');
    await expect(page.getByRole('button', { name: C.lesson.video.remove })).toBeVisible();

    // Saved: the lesson links THAT asset; the curriculum row reads the asset's 12:34.
    await expect(lessonSubmit(page)).toBeEnabled();
    await lessonSubmit(page).click();
    await expect(toast(page, C.toasts.lessonCreated)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/cursos/${e09.courseId}$`));
    await expect.poll(async () => (await lessonByTitle(title))?.videoAssetId).toBe(asset.id);
    const row = lessonRowFor(page, title);
    await expect(row.getByTestId('lesson-row-meta')).toHaveText('12:34');
    await expect(row.getByTestId('lesson-row-pill')).toHaveCount(0);
    await expect(row.getByTestId('lesson-row-thumb')).toHaveAttribute(
      'data-thumb',
      /^poster(-missing)?$/,
    );
  });

  test('E09/long-text: a lesson video whose ready event carries 14 401 s is refused by the ready-event job — the row\'s "Falhou" pill and the form\'s "Vídeo muito longo" sentence with the 4 h cap', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    stopWorker ??= await ensureWorker();
    const lesson = await lessonByTitle(e09.longLesson);
    if (!lesson) throw new Error('the E09 fixture lesson is missing');
    const before = await lessonAssetState(e09.longAssetId);
    if (!before?.providerAssetId) throw new Error('the E09 fixture asset has no provider id');
    expect(before.status).toBe('processing');

    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${e09.courseId}/aulas/${lesson.id}`);
    await expect(videoBlock(page)).toHaveAttribute('data-video-state', 'processing');

    // The provider reports the asset ready at one second over the lesson cap (14 400 s): the signed
    // webhook lands at the API, the job runs in the worker and refuses it (duration_too_long).
    const status = await deliverFakeReadyEvent({
      assetId: e09.longAssetId,
      providerAssetId: before.providerAssetId,
      durationSeconds: 14_401,
    });
    expect([200, 201, 202]).toContain(status);
    await expect
      .poll(async () => (await lessonAssetState(e09.longAssetId))?.status, { timeout: 60_000 })
      .toBe('rejected');
    const after = await lessonAssetState(e09.longAssetId);
    expect(after?.failureReason).toBe('duration_too_long');

    // The open form's readiness poll settles failed with the closed issue: the shipped sentence with
    // the cap as the catalog formats it ("4 h"), and the retry control.
    await expect(videoBlock(page)).toHaveAttribute('data-video-state', 'failed', {
      timeout: 60_000,
    });
    const failed = page.locator('[data-lesson-video-failed]');
    await expect(failed.getByRole('alert')).toHaveText(
      fill(M.errors.duration, { duration: '4 h' }),
    );
    await expect(failed.getByRole('button', { name: C.lesson.video.retry })).toBeVisible();
    await expect(page.locator('main')).not.toContainText('duration_too_long');

    // The curriculum row: the "Falhou" pill and the failed thumb.
    await page.goto(`${tenant.origin}/cursos/${e09.courseId}`);
    const row = lessonRowFor(page, e09.longLesson);
    await expect(row.getByTestId('lesson-row-pill')).toHaveText(C.status.failed);
    await expect(row.getByTestId('lesson-row-pill')).toHaveAttribute('data-tone', 'danger');
    await expect(row.getByTestId('lesson-row-thumb')).toHaveAttribute('data-thumb', 'failed');
  });

  test('E08/populated: a landscape cover shows the 3:4 centre crop in the form preview and the list thumb, and 16:10 on the course page, all the same asset', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    stopWorker ??= await ensureWorker();
    const title = `${prefix} E08 Capa paisagem`;
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/novo`);
    await expect(page.getByRole('heading', { name: C.form.createTitle })).toBeVisible();

    // The hydration gate: the submit arms only through React state (title AND instructor).
    await page.locator('#course-instructor').fill('Dra. Ana Souza');
    await page.locator('#course-title').fill(title);
    await expect(submit(page)).toBeEnabled();

    const since = new Date(Date.now() - 1_000);
    await form(page)
      .locator(`input[type="file"][aria-label="${C.form.cover.add}"]`)
      .setInputFiles({
        name: 'paisagem.png',
        mimeType: 'image/png',
        buffer: landscapePng(1200, 600),
      });
    const preview = page.locator('[data-course-cover-preview]');
    const local = page.locator('[data-course-cover-local]');
    await expect(local).toBeVisible({ timeout: 60_000 });
    // The form preview: a 3:4 box, the landscape picture centre-cropped inside it.
    const previewBox = await boxOf(preview);
    expect(previewBox.width / previewBox.height).toBeCloseTo(0.75, 2);
    await expect
      .poll(() => local.evaluate((node) => (node as HTMLImageElement).naturalWidth), {
        timeout: 30_000,
      })
      .toBe(1200);
    expect(
      await local.evaluate((node) => {
        const style = getComputedStyle(node);
        return { fit: style.objectFit, position: style.objectPosition };
      }),
    ).toEqual({ fit: 'cover', position: '50% 50%' });
    const coverId = await waitForReadyCoverIn(tenant.slug, since);

    await expect(submit(page)).toBeEnabled();
    await submit(page).click();
    await expect(toast(page, C.toasts.courseCreated)).toBeVisible();
    await expect(page).toHaveURL(/\/cursos$/);
    const saved = await courseByTitle(title);
    if (!saved) throw new Error('the course was not saved');
    expect(await courseCoverAssetId(saved.id)).toBe(coverId);

    // The list thumb: the SAME asset at 3:4.
    const row = page.getByRole('link', { name: `${title}, ${C.status.draft}`, exact: true });
    await expect(row).toBeVisible();
    const thumb = row.getByTestId('course-row-thumb');
    const thumbBox = await boxOf(thumb);
    expect(thumbBox.width / thumbBox.height).toBeCloseTo(0.75, 1);
    const thumbImg = thumb.locator('img').first();
    expect(await thumbImg.getAttribute('src')).toContain(coverId);
    await expect
      .poll(() => thumbImg.evaluate((node) => (node as HTMLImageElement).naturalWidth), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);

    // The course page hero: the SAME asset at 16:10.
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/cursos/${saved.id}$`));
    const hero = page.getByTestId('course-hero');
    await expect(hero).toBeVisible();
    const heroBox = await boxOf(hero);
    expect(heroBox.width / heroBox.height).toBeCloseTo(1.6, 1);
    const heroImg = hero.locator('img').first();
    expect(await heroImg.getAttribute('src')).toContain(coverId);
    await expect
      .poll(() => heroImg.evaluate((node) => (node as HTMLImageElement).naturalWidth), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    expect(
      await heroImg.evaluate((node) => {
        const image = node as HTMLImageElement;
        const style = getComputedStyle(image);
        return {
          fit: style.objectFit,
          position: style.objectPosition,
          landscape: image.naturalWidth > image.naturalHeight,
        };
      }),
    ).toEqual({ fit: 'cover', position: '50% 50%', landscape: true });

    // Reopened in the form: the saved asset in the 3:4 preview.
    await page.goto(`${tenant.origin}/cursos/${saved.id}/editar`);
    await expect(page.getByRole('heading', { name: C.form.editTitle })).toBeVisible();
    const reopened = page.locator('[data-course-cover-preview]');
    await expect(reopened).toBeVisible();
    const reopenedBox = await boxOf(reopened);
    expect(reopenedBox.width / reopenedBox.height).toBeCloseTo(0.75, 2);
    const reopenedImg = reopened.locator('img').first();
    expect(await reopenedImg.getAttribute('src')).toContain(coverId);
    await expect
      .poll(() => reopenedImg.evaluate((node) => (node as HTMLImageElement).naturalWidth), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    await expect(page.locator('[data-course-cover-fallback]')).toHaveCount(0);
  });
});
