import { expect, type Page, test } from '@playwright/test';
import { hosts, isRemote } from './fixtures';
import {
  closeTenantFixtures,
  createThrowawayTenant,
  deleteTenantBySlug,
  throwawayOrigin,
} from './tenant-fixtures';

/**
 * Phase 2 public pages (plan 02-08) on throwaway tenants, so no seed host cache is ever poisoned and
 * nothing waits for a TTL:
 *   A. a VERIFIED alias host 308s to the primary origin, path + query preserved (D-35)
 *   B. an UNVERIFIED host is generic: neutral shell, no tenant named (D-36)
 *   C. suspended tenant — bootstrap path and cold /entrar (D-32; Task 3)
 *   D. an accented, long display name renders verbatim without overflow (UI-03/encoding)
 *   E. dark theme through <html data-theme> alone (D-41 consumer)
 * Runs on mobile-chromium (iPhone 14) and desktop-chromium.
 */
test.describe.configure({ timeout: 120_000 });

const NEUTRAL = '#2e6fd0';
const sfx = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

/** The computed `--brand-primary` on `selector` (custom properties come back as the raw token). */
async function brandPrimary(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`no element matches ${sel}`);
    return getComputedStyle(el).getPropertyValue('--brand-primary').trim();
  }, selector);
}

test.describe('A. alias host → primary origin (D-35)', () => {
  const slug = `e2e-alias-${sfx}`;
  const primary = `e2e-prim-${sfx}.localhost`;
  const alias = `e2e-alias-${sfx}.localhost`;
  const displayName = `Alias ${sfx}`;

  test.beforeAll(async () => {
    test.skip(isRemote, 'local stack only');
    await createThrowawayTenant({
      slug,
      displayName,
      hosts: [
        { host: primary, primary: true, verified: true },
        { host: alias, primary: false, verified: true },
      ],
      colors: { primary: '#b91c1c', secondary: '#f87171' },
    });
  });

  test.afterAll(async () => {
    await deleteTenantBySlug(slug);
    await closeTenantFixtures();
  });

  test('a verified non-primary host answers 308 to the primary with path + query, no-store', async ({
    page,
  }) => {
    test.skip(isRemote, 'local stack only');
    const aliasUrl = `${throwawayOrigin(alias)}/entrar?x=1`;
    const primaryUrl = `${throwawayOrigin(primary)}/entrar?x=1`;

    const redirect = page.waitForResponse((r) => r.url() === aliasUrl);
    await page.goto(aliasUrl);
    const response = await redirect;
    expect(response.status()).toBe(308);
    expect(response.headers().location).toBe(primaryUrl);
    expect(response.headers()['cache-control']).toContain('no-store');

    await expect(page).toHaveURL(primaryUrl);
    await expect(page.getByText(`Comunidade: ${displayName}`, { exact: true })).toBeVisible();
    expect(await brandPrimary(page, 'main')).toBe('#b91c1c');
  });

  test('the primary host itself keeps its URL', async ({ page }) => {
    test.skip(isRemote, 'local stack only');
    const primaryUrl = `${throwawayOrigin(primary)}/entrar`;
    await page.goto(primaryUrl);
    await expect(page).toHaveURL(primaryUrl);
    await expect(page.getByText(`Comunidade: ${displayName}`, { exact: true })).toBeVisible();
  });
});

test.describe('B. unverified host is generic (D-36)', () => {
  const slug = `e2e-unver-${sfx}`;
  const host = `e2e-unver-${sfx}.localhost`;

  test.beforeAll(async () => {
    test.skip(isRemote, 'local stack only');
    await createThrowawayTenant({
      slug,
      displayName: `Unverified ${sfx}`,
      hosts: [{ host, primary: true, verified: false }],
      colors: { primary: '#b91c1c', secondary: '#f87171' },
    });
  });

  test.afterAll(async () => {
    await deleteTenantBySlug(slug);
    await closeTenantFixtures();
  });

  test('renders the neutral TRIA shell: no redirect, no tenant, no sign-up link', async ({
    page,
  }) => {
    test.skip(isRemote, 'local stack only');
    const url = `${throwawayOrigin(host)}/entrar`;
    await page.goto(url);
    await expect(page).toHaveURL(url);
    await expect(page.getByText('Comunidade:')).toHaveCount(0);
    await expect(page.getByText('TRIA', { exact: true })).toBeVisible();
    expect(await brandPrimary(page, 'main')).toBe(NEUTRAL);
    await expect(page.getByRole('link', { name: 'Criar nova conta' })).toHaveCount(0);
  });
});

test.describe('D. accented, long display name (UI-03/encoding)', () => {
  const slug = `e2e-acentos-${sfx}`;
  const host = `e2e-acentos-${sfx}.localhost`;
  const displayName = 'Associação São José da Comunidade Beneficente';

  test.beforeAll(async () => {
    test.skip(isRemote, 'local stack only');
    await createThrowawayTenant({
      slug,
      displayName,
      hosts: [{ host, primary: true, verified: true }],
      colors: { primary: '#1d4ed8', secondary: '#60a5fa' },
      logoUrl: null,
    });
  });

  test.afterAll(async () => {
    await deleteTenantBySlug(slug);
    await closeTenantFixtures();
  });

  test('renders verbatim in the brand block and the tenant line, wrapping without overflow', async ({
    page,
  }) => {
    test.skip(isRemote, 'local stack only');
    await page.goto(`${throwawayOrigin(host)}/entrar`);

    const brand = page.getByTestId('auth-brand-name');
    await expect(brand).toHaveText(displayName);
    const line = page.getByText(`Comunidade: ${displayName}`, { exact: true });
    await expect(line).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Entrar');

    // No truncated code point (textContent is the stored string) and no horizontal overflow.
    for (const [locator, expected] of [
      [brand, displayName],
      [line, `Comunidade: ${displayName}`],
    ] as const) {
      const box = await locator.evaluate((el) => ({
        text: el.textContent,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      expect(box.text).toBe(expected);
      expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
    }
  });
});

test.describe('E. dark theme without the root layout (D-41 consumer)', () => {
  test('toggling <html data-theme="dark"> repaints the ground and the brand CTA', async ({
    page,
  }) => {
    test.skip(isRemote, 'local stack only');
    await page.goto(`${hosts.demo}/entrar`);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe('rgb(15, 17, 24)');

    // The dark-surface derivation `--brand-primary-dark` of THIS host, read through a probe.
    const expected = await page.evaluate(() => {
      const main = document.querySelector('main');
      if (!main) throw new Error('no main');
      const probe = document.createElement('div');
      probe.style.background = 'var(--brand-primary-dark)';
      main.appendChild(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    expect(expected).not.toBe('rgb(124, 58, 237)');

    // `Button` transitions its colours (150 ms), so the computed value is polled, not read once.
    const cta = page.locator('main').getByRole('button', { name: 'Entrar' });
    await expect
      .poll(() => cta.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe(expected);
  });
});
