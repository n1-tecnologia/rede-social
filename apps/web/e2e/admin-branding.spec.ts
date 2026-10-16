import { fileURLToPath } from 'node:url';
import { type Browser, expect, type Page, test } from '@playwright/test';
import brandingMessages from '../messages/pt-BR/platformBranding.json' with { type: 'json' };
import { closeAdmin, setMembershipRole } from './admin';
import {
  closeBrandingAdmin,
  getTenantBranding,
  getTenantDisplayName,
  setTenantLook,
} from './branding-admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import {
  closeMembersAdmin,
  createMembersTenant,
  deleteMembersTenant,
  type MembersTenant,
  membersTenantSlug,
  sweepMembersTenants,
} from './members-admin';
import { closeTenantFixtures } from './tenant-fixtures';
import { ensureWorker } from './worker';

/**
 * 08-06 — the tenant lane's Marca screen (ADMIN-01, D-339, D-342, UI-D-279): the admin edits their
 * own community's brand with the super_admin's editor, unchanged, from Configurações → Marca.
 * Since 2026-10-09 it follows the tenant's Marca tab: the app icon is composed by the same editor,
 * the dark mode's logo is picked for the previews, and the look the platform team saved (no route
 * here saves one) is painted on the frames, read only.
 *
 * The subject is a THROWAWAY community with its own admin (`createMembersTenant(…, 0)`), never a seed
 * tenant: a brand change sits in the web and API host caches for up to 60 s, so flipping rede-demo
 * would leak into every spec that runs after this one (`tenant-fixtures.ts`). The API integration
 * suite proves the same flow on `admin@rede-demo.local` itself and restores the seed afterwards.
 * Each project gets its own tenant and host, unique per run (the host-cache rule of
 * `membersTenantSlug`). The spec brings its own `ROLE=worker` (`ensureWorker`): icon derivation runs
 * off the request path and the Playwright config starts the API and the web app only.
 */

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.skip(isRemote, 'local stack only');

const PREFIX = 'brnd';
/** The no-logo caption, read from the catalog so a copy edit there cannot strand this spec again. */
const NO_LOGO = brandingMessages.platformBranding.logo.empty;
/** The Marca copy the app icon and the look read, from the same catalog. */
const BRANDING = brandingMessages.platformBranding;
let tenant: MembersTenant;
let stopWorker: () => Promise<void> = async () => {};

const SEED_LOGO = fileURLToPath(new URL('../public/seed-logos/rede-lab.svg', import.meta.url));
/** A light mark for the dark mode's logo (picked for the previews only). */
const DARK_LOGO = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 64"><rect width="240" height="64" rx="16" fill="#f8fafc"/></svg>',
);

/**
 * After a full navigation the inputs exist before React hydrated them; a fill dispatched in that
 * window is lost. React tags hydrated DOM nodes with its internal props key (the 02-14 probe).
 */
async function waitForHydration(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return el !== null && Object.keys(el).some((key) => key.startsWith('__reactProps'));
    },
    selector,
    { timeout: 30_000 },
  );
}

/** The RENDERED background of the mini login CTA inside one `BrandPreview` frame. */
function previewButtonBg(page: Page, theme: 'light' | 'dark'): Promise<string> {
  return page
    .locator(`[data-brand-scope][data-theme="${theme}"] button`)
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
}

/** The `--brand-primary` the shell's `main` inherits (custom properties come back raw). */
function shellPrimary(page: Page): Promise<string> {
  return page
    .locator('main')
    .first()
    .evaluate((el) => getComputedStyle(el).getPropertyValue('--brand-primary').trim());
}

async function openMarca(page: Page): Promise<void> {
  await page.goto(`${tenant.origin}/configuracoes/marca`);
  await expect(page.getByRole('heading', { name: 'Marca', exact: true })).toBeVisible();
  await waitForHydration(page, '#primary');
}

/** Whether the first server HTML declares `--brand-primary` = `hex` (the phase2-smoke probe). */
function declaresPrimary(html: string, hex: string): boolean {
  return new RegExp(`--brand-primary:\\s*${hex}`).test(html);
}

/** The tenant's `/entrar` first HTML in a signed-out context (the login screen, no session). */
async function loginScreenHtml(browser: Browser): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const res = await page.goto(`${tenant.origin}/entrar`);
    if (!res) throw new Error('no /entrar response');
    return await res.text();
  } finally {
    await context.close();
  }
}

/** The toast line (the form and the card both speak through the shell's toast). */
function toast(page: Page, text: string) {
  return page.getByText(text, { exact: true }).first();
}

test.beforeAll(async ({ browserName: _browserName }, testInfo) => {
  await sweepMembersTenants(
    `${PREFIX}-${testInfo.project.name.replace(/[^a-z0-9]/g, '').slice(0, 10)}`,
  );
  tenant = await createMembersTenant(
    membersTenantSlug(PREFIX, testInfo.project.name),
    SEED_PASSWORD,
    0,
  );
  stopWorker = await ensureWorker();
});

test.afterAll(async () => {
  await stopWorker();
  if (tenant) await deleteMembersTenant(tenant.slug);
  await closeAdmin();
  await closeMembersAdmin();
  await closeTenantFixtures();
  await closeBrandingAdmin();
});

test.describe('08-06 — Marca on the tenant lane', () => {
  test('branding tracer: the admin changes the primary from Marca and the app shell shows it', async ({
    page,
  }) => {
    await login(page, tenant.admin.email, tenant.password, tenant.origin);

    // D-339: "Marca" is the first row of the Administração group.
    await page.goto(`${tenant.origin}/configuracoes`);
    const row = page.getByRole('link', { name: 'Marca', exact: true });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(`${tenant.origin}/configuracoes/marca`);
    await expect(page.getByText(/As mudanças aparecem no app na hora/)).toBeVisible();
    await waitForHydration(page, '#primary');

    // The unchanged form: the colours card, both preview frames, save disabled until a change.
    const save = page.getByRole('button', { name: 'Salvar alterações' });
    await expect(page.locator('[data-brand-scope]')).toHaveCount(2);
    await expect(save).toBeDisabled();

    // The preview follows the typed value live.
    await page.locator('#primary').fill('#1d4ed8');
    await page.locator('#secondary').fill('#60a5fa');
    await expect.poll(() => previewButtonBg(page, 'light')).toBe('rgb(29, 78, 216)');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText('Alterações salvas.')).toBeVisible();
    expect((await getTenantBranding(tenant.slug)).colors.primary).toBe('#1d4ed8');

    // The next navigation renders the new brand from the per-request bootstrap.
    await page.goto(`${tenant.origin}/inicio`);
    await expect.poll(() => shellPrimary(page)).toBe('#1d4ed8');
  });

  test('the form reopens on the saved colours', async ({ page }) => {
    await login(page, tenant.admin.email, tenant.password, tenant.origin);
    await openMarca(page);
    await expect(page.locator('#primary')).toHaveValue('#1d4ed8');
    await expect(page.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled();
  });
  test('the name card: disabled, errors, the 60-character cap, save, toast and the preview (E11)', async ({
    page,
  }) => {
    await login(page, tenant.admin.email, tenant.password, tenant.origin);
    await openMarca(page);
    await waitForHydration(page, '#displayName');
    const name = page.locator('#displayName');
    const save = page.getByRole('button', { name: 'Salvar nome' });
    await expect(page.getByText('Nome da comunidade', { exact: true })).toBeVisible();
    await expect(name).toHaveValue(`Comunidade ${tenant.slug}`);
    await expect(save).toBeDisabled();

    // E11/empty: empty and spaces-only never save.
    for (const value of ['', '    ']) {
      await name.fill(value);
      await expect(page.getByText('Informe o nome da comunidade.')).toBeVisible();
      await expect(save).toBeDisabled();
    }

    // E11/long-text: typing stops at 60 characters.
    await name.fill('');
    await name.pressSequentially('n'.repeat(64));
    await expect(name).toHaveValue('n'.repeat(60));
    await expect(save).toBeEnabled();

    // E11/populated: a new name with accents and an emoji saves; the preview follows it.
    const next = `Marca Ação 🎉 ${tenant.slug.slice(-6)}`;
    await name.fill(`  ${next}  `);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(toast(page, 'Nome salvo.')).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(name).toHaveValue(next);
    await expect(page.locator('[data-brand-scope][data-theme="light"]')).toContainText(next);
    await expect.poll(async () => (await getTenantDisplayName(tenant.slug)) ?? '').toBe(next);
  });

  test('a logo upload derives the icons; a colour typed while the icon poll runs survives its refresh (E12)', async ({
    page,
  }) => {
    await login(page, tenant.admin.email, tenant.password, tenant.origin);
    await openMarca(page);
    // E12/empty: the shipped no-logo state, no app-icons card yet.
    await expect(page.getByText(NO_LOGO)).toBeVisible();
    await expect(page.locator('[data-icons-status]')).toHaveCount(0);
    await waitForHydration(page, '[data-upload-zone="logo"] input[type="file"]');

    // The poll's `router.refresh()` once the icons are ready: an RSC GET of this very route.
    const refreshed = page.waitForResponse(
      (res) =>
        res.request().method() === 'GET' &&
        res.request().headers().rsc === '1' &&
        !res.request().headers()['next-router-prefetch'] &&
        new URL(res.url()).pathname === '/configuracoes/marca',
      { timeout: 120_000 },
    );

    await page.locator('[data-upload-zone="logo"] input[type="file"]').setInputFiles(SEED_LOGO);
    await expect(toast(page, 'Alterações salvas.')).toBeVisible({ timeout: 30_000 });
    const logo = await getTenantBranding(tenant.slug);
    expect(logo.logoUrl).toContain(
      `/storage/v1/object/public/branding/${tenant.tenantId}/branding/`,
    );

    // E12/loading backstop (RESEARCH Pitfall 7, WINDOWS #71): type while the poll runs.
    await page.locator('#primary').fill('#0e7490');
    await page.locator('#secondary').fill('#22d3ee');
    await expect(page.locator('[data-icons-status="ready"]')).toBeVisible({ timeout: 90_000 });
    await refreshed;
    const save = page.getByRole('button', { name: 'Salvar alterações' });
    await expect(page.locator('#primary')).toHaveValue('#0e7490');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(toast(page, 'Alterações salvas.')).toBeVisible();
    await expect
      .poll(async () => (await getTenantBranding(tenant.slug)).colors.primary)
      .toBe('#0e7490');

    // The derived set belongs to the current version; the preview carries the uploaded logo.
    await expect(page.locator('[data-icons-status="ready"]')).toBeVisible({ timeout: 90_000 });
    const derived = await getTenantBranding(tenant.slug);
    expect(derived.iconUrls?.i512).toContain(`/${tenant.tenantId}/branding/icons/`);
    await expect(page.locator('[data-icon-thumb]')).toHaveCount(4);
    await expect(
      page.locator(`[data-brand-scope][data-theme="light"] img[src="${derived.logoUrl}"]`).first(),
    ).toBeAttached();
  });

  test('the app icon is composed from the logo, uploaded and removed on the tenant lane', async ({
    page,
  }) => {
    await login(page, tenant.admin.email, tenant.password, tenant.origin);
    await openMarca(page);
    await expect(page.locator('[data-icons-status="ready"]')).toBeVisible({ timeout: 90_000 });
    await waitForHydration(page, '[data-upload-zone="icon"] [data-app-icon-open]');
    const editor = page.locator('[data-upload-zone="icon"]');
    const before = await getTenantBranding(tenant.slug);

    // "Logo e fundo" (2026-10-09): the community's own logo, read from the bucket, over the saved
    // primary, composed and sent through the tenant lane's signed upload.
    await editor.getByRole('button', { name: BRANDING.appIcon.customize }).click();
    await expect(editor.locator('[data-app-icon-logo-state="ready"]')).toBeAttached({
      timeout: 30_000,
    });
    await editor.getByRole('button', { name: BRANDING.appIcon.apply }).click();
    await expect
      .poll(async () => (await getTenantBranding(tenant.slug)).iconUrl, {
        timeout: 30_000,
      })
      .not.toBeNull();
    expect((await getTenantBranding(tenant.slug)).iconVersion).toBeGreaterThan(before.iconVersion);
    await expect(editor).toHaveAttribute('data-app-icon-editor', 'closed');
    await expect(page.locator('[data-icons-status="ready"]')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(BRANDING.icons.fromOverride)).toBeVisible();

    // Remove on a settled form (a fresh navigation: icons ready, no poll, no refresh).
    await openMarca(page);
    await expect(page.locator('[data-icons-status="ready"]')).toBeVisible();
    await waitForHydration(page, '[data-upload-zone="icon"] [data-app-icon-open]');
    await page.getByRole('button', { name: BRANDING.icon.remove }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(BRANDING.icon.confirmTitle)).toBeVisible();
    await dialog.getByRole('button', { name: BRANDING.icon.confirm }).click();
    await expect
      .poll(async () => (await getTenantBranding(tenant.slug)).iconUrl, {
        timeout: 30_000,
      })
      .toBeNull();
    await expect(editor.getByRole('button', { name: BRANDING.appIcon.customize })).toBeVisible();
  });

  test('the saved look reaches the preview, read only, and the dark logo is picked for it', async ({
    page,
  }) => {
    // 2026-10-09 ("atualizada conforme o tenant"): a look the platform team saved. The tenant lane
    // has no route to save one, so the spec writes it the way that save stores it.
    await setTenantLook(tenant.slug, {
      lightTone: 'amarelado',
      darkTone: 'cafe',
      darkColors: { primary: '#ffb4a8', secondary: null },
      buttonColors: {
        style: 'solid',
        fill: { light: '#e3af3f', dark: null },
        fillEnd: { light: null, dark: null },
        ink: { light: '#382317', dark: null },
      },
    });
    try {
      await login(page, tenant.admin.email, tenant.password, tenant.origin);
      await openMarca(page);
      const light = page.locator('[data-brand-scope][data-theme="light"]');
      const dark = page.locator('[data-brand-scope][data-theme="dark"]');
      await expect(light).toHaveAttribute('data-bg-tone', 'amarelado');
      await expect(dark).toHaveAttribute('data-dark-tone', 'cafe');
      await expect.poll(() => previewButtonBg(page, 'light')).toBe('rgb(227, 175, 63)');
      await expect(page.locator('[data-look-read-only]')).toHaveText(BRANDING.look.readOnly);
      // Shown, never edited here: the look's cards and their save stay on the platform's tab.
      await expect(page.getByRole('button', { name: BRANDING.look.save })).toHaveCount(0);

      // The dark mode's logo, picked for the previews as on the platform: the dark frame shows it.
      const darkZone = page.locator('[data-upload-zone="logoDark"]');
      await expect(darkZone).toContainText(BRANDING.logoDark.title);
      await waitForHydration(page, '[data-upload-zone="logoDark"] input[type="file"]');
      await darkZone
        .locator('input[type="file"]')
        .setInputFiles({ name: 'escuro.svg', mimeType: 'image/svg+xml', buffer: DARK_LOGO });
      await expect(dark.locator('img[src^="blob:"]').first()).toBeAttached();
      await expect(light.locator('img[src^="blob:"]')).toHaveCount(0);
    } finally {
      await setTenantLook(tenant.slug, null);
    }
  });

  test("after a save, the tenant's login screen shows the new colour within 70 s (E12 partial backstop)", async ({
    page,
    browser,
  }) => {
    // Warm the login screen's host cache first, so the poll below measures the cache (an entry made
    // before the save expires at most 60 s after it) instead of a cold miss.
    await loginScreenHtml(browser);

    await login(page, tenant.admin.email, tenant.password, tenant.origin);
    await openMarca(page);
    await page.locator('#primary').fill('#be123c');
    await page.locator('#secondary').fill('#fb7185');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(toast(page, 'Alterações salvas.')).toBeVisible();
    const savedAt = Date.now();

    // The shell: the very next navigation.
    await page.goto(`${tenant.origin}/inicio`);
    await expect.poll(() => shellPrimary(page)).toBe('#be123c');

    // The login screen: through the host caches (60 s web TTL), polled by reloading.
    await expect
      .poll(async () => declaresPrimary(await loginScreenHtml(browser), '#be123c'), {
        timeout: 70_000,
        intervals: [2_000, 5_000],
      })
      .toBe(true);
    expect(Date.now() - savedAt).toBeLessThan(70_000);
  });

  test('a lost permission: the save lands on Configurações with the forbidden toast (UI-D-284)', async ({
    page,
  }) => {
    await login(page, tenant.admin.email, tenant.password, tenant.origin);
    await openMarca(page);
    await page.locator('#primary').fill('#15803d');
    await page.locator('#secondary').fill('#4ade80');

    await setMembershipRole(tenant.admin.email, tenant.slug, 'member');
    try {
      await page.getByRole('button', { name: 'Salvar alterações' }).click();
      await expect(page).toHaveURL(
        new RegExp(`${tenant.origin}/configuracoes\\?erro=sem-permissao$`),
      );
      await expect(toast(page, 'Você não tem mais permissão para esta ação.')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Marca', exact: true })).toHaveCount(0);
      expect((await getTenantBranding(tenant.slug)).colors.primary).not.toBe('#15803d');
      await page.goto(`${tenant.origin}/configuracoes/marca`);
      await expect(page.getByRole('heading', { name: 'Marca', exact: true })).toHaveCount(0);
    } finally {
      await setMembershipRole(tenant.admin.email, tenant.slug, 'admin_tenant');
    }
  });
});

/** D-339 / UI-D-270: a member never meets Marca — no row, and the URL is the not-found answer. */
test('a member sees no Marca row and /configuracoes/marca does not exist for them', async ({
  page,
}) => {
  await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
  await page.goto(`${hosts.demo}/configuracoes`);
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Marca', exact: true })).toHaveCount(0);
  await page.goto(`${hosts.demo}/configuracoes/marca`);
  await expect(page.getByRole('heading', { name: 'Marca', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-brand-scope]')).toHaveCount(0);
});
