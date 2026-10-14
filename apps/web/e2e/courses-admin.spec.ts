import { expect, type Page, test } from '@playwright/test';
import appCoursesMessages from '../messages/pt-BR/app.courses.json' with { type: 'json' };
import coursesMessages from '../messages/pt-BR/courses.json' with { type: 'json' };
import {
  type CoursesTenant,
  categoryByName,
  closeCoursesAdmin,
  courseByTitle,
  courseProductIds,
  createCourse,
  createCoursesTenant,
  deleteCoursesTenant,
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
