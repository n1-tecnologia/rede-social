import { expect, type Page, test } from '@playwright/test';
import appCoursesMessages from '../messages/pt-BR/app.courses.json' with { type: 'json' };
import coursesMessages from '../messages/pt-BR/courses.json' with { type: 'json' };
import {
  type CoursesTenant,
  closeCoursesAdmin,
  createCourse,
  createCoursesTenant,
  deleteCoursesTenant,
  setModuleEnabled,
} from './courses-admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';

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
