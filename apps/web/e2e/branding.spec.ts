import { type Browser, expect, type Page, test } from '@playwright/test';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';

/**
 * TENANT-02 tracer (plan 02-01): two seed tenants with distinct brands (scripts/seed.ts) render ONLY
 * their own brand on their own host — before login with JavaScript disabled (so the assertion is on the
 * server-rendered HTML, Pitfall 2: no default-brand flash) and after login in the authenticated shell.
 * A generic host renders TRIA's neutral brand. Both tenants share every neutral token, so the primary
 * hex is the observable that tells them apart.
 */
const BRAND = {
  demo: { primary: '#7c3aed', name: 'TRIA Demo', logo: '/seed-logos/tria-demo.svg' },
  lab: { primary: '#0f766e', name: 'TRIA Lab', logo: '/seed-logos/tria-lab.svg' },
  neutral: '#2e6fd0',
} as const;

/** The computed `--brand-primary` on `selector` (custom properties come back as the raw token). */
async function brandPrimary(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`no element matches ${sel}`);
    return getComputedStyle(el).getPropertyValue('--brand-primary').trim();
  }, selector);
}

async function withoutJavaScript<T>(browser: Browser, fn: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    return await fn(await context.newPage());
  } finally {
    await context.close();
  }
}

test.describe('TENANT-02 — brand per host, server-rendered', () => {
  test('tria-demo /entrar carries the demo brand in the first HTML (JS disabled)', async ({
    browser,
  }) => {
    await withoutJavaScript(browser, async (page) => {
      await page.goto(`${hosts.demo}/entrar`, { waitUntil: 'domcontentloaded' });
      expect(await brandPrimary(page, 'main')).toBe(BRAND.demo.primary);
      await expect(page.getByText(BRAND.demo.name).first()).toBeVisible();
      await expect(page.getByRole('img', { name: BRAND.demo.name })).toHaveAttribute(
        'src',
        BRAND.demo.logo,
      );
      // Adjacency: the other tenant's brand must not be anywhere in the page.
      const html = await page.content();
      expect(html).not.toContain(BRAND.lab.primary);
      expect(html).not.toContain(BRAND.lab.name);
    });
  });

  test('tria-lab /entrar carries the lab brand and never the demo one (JS disabled)', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');
    await withoutJavaScript(browser, async (page) => {
      await page.goto(`${hosts.lab}/entrar`, { waitUntil: 'domcontentloaded' });
      expect(await brandPrimary(page, 'main')).toBe(BRAND.lab.primary);
      await expect(page.getByText(BRAND.lab.name).first()).toBeVisible();
      await expect(page.getByRole('img', { name: BRAND.lab.name })).toHaveAttribute(
        'src',
        BRAND.lab.logo,
      );
      const html = await page.content();
      expect(html).not.toContain(BRAND.demo.primary);
      expect(html).not.toContain(BRAND.demo.name);
    });
  });

  test('a generic host renders the neutral TRIA brand, not a seeded tenant', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');
    await withoutJavaScript(browser, async (page) => {
      await page.goto(`${hosts.generic}/entrar`, { waitUntil: 'domcontentloaded' });
      expect(await brandPrimary(page, 'main')).toBe(BRAND.neutral);
      await expect(page.getByText('TRIA', { exact: true })).toBeVisible();
      await expect(page.getByRole('img')).toHaveCount(0);
      const html = await page.content();
      expect(html).not.toContain(BRAND.demo.primary);
      expect(html).not.toContain(BRAND.lab.primary);
    });
  });

  test('after login the authenticated shell carries each member’s own brand', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');
    const demo = await browser.newContext();
    const lab = await browser.newContext();
    try {
      const demoPage = await demo.newPage();
      const labPage = await lab.newPage();
      await login(demoPage, users.demoMember, SEED_PASSWORD, hosts.demo);
      await login(labPage, users.labMember, SEED_PASSWORD, hosts.lab);

      expect(await brandPrimary(demoPage, '[data-brand-root]')).toBe(BRAND.demo.primary);
      expect(await brandPrimary(labPage, '[data-brand-root]')).toBe(BRAND.lab.primary);

      const demoHtml = await demoPage.content();
      const labHtml = await labPage.content();
      expect(demoHtml).not.toContain(BRAND.lab.primary);
      expect(labHtml).not.toContain(BRAND.demo.primary);
      expect(demoHtml).not.toContain(BRAND.neutral);
      expect(labHtml).not.toContain(BRAND.neutral);
    } finally {
      await demo.close();
      await lab.close();
    }
  });
});
