import { expect, type Page, test } from '@playwright/test';
import appCoursesMessages from '../messages/pt-BR/app.courses.json' with { type: 'json' };
import coursesMessages from '../messages/pt-BR/courses.json' with { type: 'json' };
import {
  type CoursesTenant,
  categoryByName,
  closeCoursesAdmin,
  courseByTitle,
  courseModules,
  courseProductIds,
  courseStatus,
  createCourse,
  createCoursesTenant,
  createLesson,
  createLessonWithProcessingVideo,
  createMaterials,
  deleteCoursesTenant,
  lessonByTitle,
  lessonMaterials,
  linkCourseProduct,
  markAssetReady,
  setModuleEnabled,
} from './courses-admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import { closeStoreAdmin, createProduct } from './store-admin';

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
 * admin's door, the hub frame, the member's not-found).
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

  test('on the seed: the admin has the Cursos row after Loja and before Mídia and reaches the hub; the member has neither (UI-D-389, UI-D-412)', async ({
    page,
  }) => {
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/configuracoes`);
    expect(await adminRowOrder(page)).toEqual(['/loja', '/cursos', '/configuracoes/midia']);
    await page.locator('main').getByRole('link', { name: SETTINGS_ROW, exact: true }).click();
    await expect(page).toHaveURL(/\/cursos$/);
    await expect(page.getByRole('heading', { level: 1, name: C.hub.title })).toBeVisible();
    await expect(page.getByText(fill(C.hub.subtitle, { tenant: 'Rede Demo' }))).toBeVisible();
    // D-401: no TopBar slot, BottomNav tab or rail row for the school in this phase (the shell's
    // chrome only: the Cursos tab's own "Todos" chip links to /cursos and is not chrome).
    await expect(
      page.locator(
        'header a[href="/cursos"], aside a[href="/cursos"], [data-shell-nav] a[href="/cursos"]',
      ),
    ).toHaveCount(0);

    await page.context().clearCookies();
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/configuracoes`);
    await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
    await expect(page.getByRole('link', { name: SETTINGS_ROW, exact: true })).toHaveCount(0);
    await page.goto(`${hosts.demo}/cursos`);
    await expectKernelNotFound(page);
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

    // UI-D-390: the area tabs are a named tablist of LINKS; Cursos is selected (the only tab now).
    const tabs = hub.getByRole('tablist', { name: C.hub.tabs.label });
    await expect(tabs).toBeVisible();
    const coursesTab = tabs.getByRole('tab', { name: C.hub.tabs.courses });
    await expect(coursesTab).toHaveAttribute('aria-selected', 'true');
    await expect(coursesTab).toHaveAttribute('href', '/cursos?aba=cursos');

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

  test('UI-D-412 / COURSE-01: a member gets the kernel not-found and no row; with the module off the admin gets it too', async ({
    page,
  }) => {
    await login(page, tenant.memberEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/configuracoes`);
    await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
    await expect(page.getByRole('link', { name: SETTINGS_ROW, exact: true })).toHaveCount(0);
    await page.goto(`${tenant.origin}/cursos`);
    await expectKernelNotFound(page);
    await page.goto(`${tenant.origin}/cursos?filtro=publicados`);
    await expectKernelNotFound(page);

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
      await expect(page.getByRole('link', { name: SETTINGS_ROW, exact: true })).toHaveCount(0);
      // The store row stays: only the school left the group (P54).
      await expect(page.locator('main a[href="/loja"]')).toHaveCount(1);
    } finally {
      await setModuleEnabled(tenant.slug, 'courses', true);
    }
    await expect(async () => {
      await page.goto(`${tenant.origin}/cursos`);
      await expect(page.getByTestId('courses-hub')).toBeVisible();
    }).toPass({ timeout: 60_000, intervals: [2_000] });
  });
});

/* ── 08.3-07: the course form (UI-D-393, D-404, D-405, D-412, COURSE-02, COURSE-08) ─────────── */

const form = (page: Page) => page.locator('[data-course-form]');
const submit = (page: Page) => form(page).locator('button[type="submit"]');
const toast = (page: Page, message: string) =>
  page.getByRole('status').filter({ hasText: message });

/**
 * The course form end to end, on its own throwaway school with the store ON (`e2e-cf-<project>`):
 * the create flow (title, instructor, two outcomes, a level chip, hours → "Curso criado." → the
 * draft row), the edit flow (the tagline → "Alterações salvas." and nothing else changes), the
 * product multi-select through the sheet (the row under "Liberado pelos produtos", saved, reopened),
 * and the archive flow from the edit form ("Arquivar curso" → confirm → "Curso arquivado." →
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
    await expect(page.locator('[data-course-products-none]')).toHaveText(C.form.products.none);
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
    await expect(page).toHaveURL(/\/cursos$/);

    const saved = await courseByTitle(names.course);
    expect(saved?.tagline).toBe('Do primeiro ponto ao resultado natural.');
    // Nothing else moved.
    expect(saved?.level).toBe('intermediario');
    expect(saved?.certificateHours).toBe(12);
    expect(saved?.outcomes).toHaveLength(2);
  });

  test('D-404 / D-405: with the store on, a product picked in the sheet lands under Liberado pelos produtos, saves and is listed again on reopen', async ({
    page,
  }) => {
    test.skip(!courseId, 'needs the course the first case created');
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/cursos/${courseId}/editar`);

    const access = form(page).locator('[data-course-products]');
    await expect(access).toBeVisible();
    await expect(access.getByText(C.form.products.label)).toBeVisible();
    await expect(access.locator('[data-course-products-none]')).toHaveText(C.form.products.none);

    await access.getByRole('button', { name: C.form.products.choose, exact: true }).click();
    const sheet = page.getByRole('dialog', { name: C.form.productPicker.title });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(C.form.productPicker.helper)).toBeVisible();
    await sheet
      .getByRole('button', { name: fill(C.form.productPicker.rowOff, { product: names.product }) })
      .click();
    await expect(
      sheet.getByRole('button', {
        name: fill(C.form.productPicker.rowOn, { product: names.product }),
      }),
    ).toBeVisible();
    await sheet.getByRole('button', { name: C.form.productPicker.done }).click();
    await expect(sheet).toHaveCount(0);

    const row = access.locator(`[data-course-product="${productId}"]`);
    await expect(row).toContainText(names.product);
    await expect(access.locator('[data-course-products-none]')).toHaveCount(0);
    await expect(
      access.getByRole('button', { name: C.form.products.change, exact: true }),
    ).toBeVisible();

    await submit(page).click();
    await expect(toast(page, C.toasts.saved)).toBeVisible();
    await expect(page).toHaveURL(/\/cursos$/);
    expect(await courseProductIds(courseId)).toEqual([productId]);

    // Reopened: the saved link is listed; a save that does not touch the set sends no productIds.
    await page.goto(`${tenant.origin}/cursos/${courseId}/editar`);
    await expect(access.locator(`[data-course-product="${productId}"]`)).toContainText(
      names.product,
    );
    await expect(submit(page)).toBeDisabled();
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
 * proves the course form's Acesso block is absent with the store off (D-405): create "Lábios" →
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
  });

  test.afterAll(async () => {
    if (tenant) await deleteCoursesTenant(tenant.slug);
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
    await expect(page.getByRole('link', { name: C.categories.back })).toHaveAttribute(
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
    await expect(form(page).locator('[data-course-products]')).toHaveCount(0);
    await expect(page.getByText(C.form.products.label)).toHaveCount(0);
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
    await expect(page.getByRole('link', { name: C.course.back })).toHaveAttribute(
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
 * "Alterações salvas.", "Aula removida." — and a `token=` URL for the signed open.
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

  test('UI-D-399 / D-410 / PR-7: a PDF and an XLSX go through the dropzone straight to Storage, read their kind · size, one moves up, the order is kept after a reload and a saved row opens a token= URL', async ({
    page,
  }) => {
    await login(page, tenant.adminEmail, tenant.password, tenant.origin);
    // `window.open` recorded instead of opened: the signed URL must not be chased into a download.
    await page.addInitScript(() => {
      (window as unknown as { __opened: string[] }).__opened = [];
      window.open = ((url: string | URL) => {
        (window as unknown as { __opened: string[] }).__opened.push(String(url));
        return null;
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

    // An unknown lesson id, and a lesson under ANOTHER course's URL, are the school's one not-found.
    await page.goto(
      `${tenant.origin}/cursos/${courseId}/aulas/00000000-0000-4000-8000-000000000000`,
    );
    await expect(page.getByTestId('courses-not-found')).toBeVisible();
  });
});
