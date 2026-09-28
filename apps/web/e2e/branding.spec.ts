import { type Browser, expect, type Page, test } from '@playwright/test';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';

/**
 * TENANT-02 tracer (plan 02-01): two seed tenants with distinct brands (scripts/seed.ts) render ONLY
 * their own brand on their own host — before login with JavaScript disabled (so the assertion is on the
 * server-rendered HTML, Pitfall 2: no default-brand flash) and after login in the authenticated shell.
 * A generic host renders the platform's neutral brand. Both tenants share every neutral token, so the primary
 * hex is the observable that tells them apart.
 */
const BRAND = {
  demo: { primary: '#7c3aed', name: 'Rede Demo', logo: '/seed-logos/rede-demo.svg' },
  lab: { primary: '#0f766e', name: 'Rede Lab', logo: '/seed-logos/rede-lab.svg' },
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
  test('rede-demo /entrar carries the demo brand in the first HTML (JS disabled)', async ({
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

  test('rede-lab /entrar carries the lab brand and never the demo one (JS disabled)', async ({
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

  test('a generic host renders the neutral platform brand, not a seeded tenant', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');
    await withoutJavaScript(browser, async (page) => {
      await page.goto(`${hosts.generic}/entrar`, { waitUntil: 'domcontentloaded' });
      expect(await brandPrimary(page, 'main')).toBe(BRAND.neutral);
      await expect(page.getByText('Rede Social', { exact: true })).toBeVisible();
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

// ---------------------------------------------------------------------------------------------
// Phase 2 — served brand per host (plan 02-16, ROADMAP criterion 1 on iPhone 14, Pixel 7, desktop)
// ---------------------------------------------------------------------------------------------

/**
 * The phase-level proof of criterion 1 on the SEED tenants: the FIRST server HTML of `/entrar`
 * (the navigation response body, before any script runs) already carries the tenant's brand
 * variables, `theme-color`, manifest link, favicon, apple-touch-icon and logo; the RENDERED "Entrar"
 * CTA and the active nav item paint the tenant's rgb; the manifest names the tenant and lists its
 * derived icons (02-13 seed derivation); the other tenant's primary and the neutral hex never appear
 * (TENANT-02, D-24/D-25/D-26/D-28/D-36, PWA-01). The ~40 helper lines are duplicated from
 * `phase2-smoke.spec.ts` on purpose (no shared fixture file — the outline's file set is kept).
 *
 * Remote runs (`PLAYWRIGHT_BASE_URL` on the platform-owned seed hosts, D-24) keep the demo cases and
 * need `PLAYWRIGHT_API_URL` for the by-host reads; the lab and generic-host cases are local only.
 */
const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';
const NEUTRAL = '#2e6fd0';
const SEED = {
  demo: { host: 'rede-demo.localhost', slug: 'rede-demo', name: 'Rede Demo', primary: '#7c3aed' },
  lab: { host: 'rede-lab.localhost', slug: 'rede-lab', name: 'Rede Lab', primary: '#0f766e' },
} as const;
type SeedKey = keyof typeof SEED;

type HostBranding = {
  logoUrl: string | null;
  faviconUrl: string | null;
  iconUrls: { i192: string; i512: string; maskable512: string; apple180: string } | null;
  colors: { primary: string; secondary: string };
};

async function byHost(origin: string): Promise<HostBranding> {
  const host = new URL(origin).hostname;
  const res = await fetch(`${API_URL}/v1/public/tenants/by-host?host=${encodeURIComponent(host)}`);
  if (!res.ok) throw new Error(`by-host ${host}: ${res.status}`);
  return ((await res.json()) as { branding: HostBranding }).branding;
}

function hexToRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** Every `<tag …>` whose attribute list carries `attr="value"`, attribute order independent. */
function tagsWith(html: string, tag: string, attr: string, value: string): string[] {
  const out: string[] = [];
  const needle = new RegExp(`\\s${attr}="${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
  for (const match of html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))) {
    if (needle.test(match[0])) out.push(match[0]);
  }
  return out;
}

function attrOf(tag: string, attr: string): string | null {
  const match = tag.match(new RegExp(`\\s${attr}="([^"]*)"`));
  return match ? (match[1] ?? '').replace(/&amp;/g, '&') : null;
}

function metaContent(html: string, name: string): string | null {
  const tag = tagsWith(html, 'meta', 'name', name)[0];
  return tag ? attrOf(tag, 'content') : null;
}

function linkHref(html: string, rel: string): string | null {
  const tag = tagsWith(html, 'link', 'rel', rel)[0];
  return tag ? attrOf(tag, 'href') : null;
}

function imgSrc(html: string, alt: string): string | null {
  const tag = tagsWith(html, 'img', 'alt', alt)[0];
  return tag ? attrOf(tag, 'src') : null;
}

/** The navigation response body IS the first server HTML (no JS-disabled context needed). */
async function firstHtml(page: Page, url: string): Promise<string> {
  const res = await page.goto(url);
  if (!res) throw new Error(`no response for ${url}`);
  expect(res.status()).toBe(200);
  return res.text();
}

function declaresPrimary(html: string, hex: string): boolean {
  return new RegExp(`--brand-primary:\\s*${hex}`).test(html);
}

type Manifest = { name: string; theme_color: string; icons: { src: string; purpose?: string }[] };

/** Chromium fetches the manifest on the tenant origin (never the Node `request` fixture). */
async function readManifest(page: Page, origin: string, slug: string): Promise<Manifest> {
  const res = await page.goto(`${origin}/m/${slug}/manifest.webmanifest`);
  if (!res) throw new Error('no manifest response');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/manifest+json');
  return (await res.json()) as Manifest;
}

/** RENDERED background of the "Entrar" CTA (`Button` transitions colours: poll it). */
function entrarBg(page: Page): Promise<string> {
  return page
    .getByRole('button', { name: 'Entrar' })
    .evaluate((el) => getComputedStyle(el).backgroundColor);
}

/** The ONE navigation tree visible on this project (BottomNav on phones, the rail on desktop). */
function visibleNav(page: Page) {
  return page.locator('[data-shell-nav="bottom"]:visible, [data-shell-nav="rail"]:visible');
}

/** RENDERED text colour of the `aria-current="page"` item (the class sits on the link or its chip). */
async function activeNavColor(page: Page): Promise<string> {
  return visibleNav(page)
    .locator('[aria-current="page"]')
    .first()
    .evaluate((el) => {
      const painted = el.matches('.text-brand') ? el : (el.querySelector('.text-brand') ?? el);
      return getComputedStyle(painted).color;
    });
}

const otherPrimary = (key: SeedKey): string => (key === 'demo' ? SEED.lab : SEED.demo).primary;

test.describe('Phase 2 — served brand per host (phone + desktop)', () => {
  const branding: Partial<Record<SeedKey, HostBranding>> = {};

  test.beforeAll(async () => {
    // 02-13 seed derivation: both seed hosts carry a distinct derived icon set at /icons/1/.
    const keys: SeedKey[] = isRemote ? ['demo'] : ['demo', 'lab'];
    for (const key of keys) branding[key] = await byHost(hosts[key]);
    for (const key of keys) {
      const b = branding[key];
      if (!b?.iconUrls?.i512.includes('/icons/1/') || !b.faviconUrl) {
        throw new Error(
          `${SEED[key].host} has no derived icon set at /icons/1/ — run \`pnpm db:seed\` against the current stack (02-13 seed derivation)`,
        );
      }
    }
    if (!isRemote && branding.demo?.iconUrls?.i512 === branding.lab?.iconUrls?.i512) {
      throw new Error('the two seed tenants share an icon URL — seed derivation is broken');
    }
  });

  for (const key of ['demo', 'lab'] as const) {
    const seed = SEED[key];

    test(`B1. ${seed.slug}: the first HTML of /entrar, the rendered CTA and the manifest carry only its brand`, async ({
      page,
    }) => {
      test.skip(key === 'lab' && isRemote, 'local stack only');
      const b = branding[key];
      if (!b?.iconUrls) throw new Error('beforeAll did not run');

      const html = await firstHtml(page, `${hosts[key]}/entrar`);
      expect(declaresPrimary(html, seed.primary)).toBe(true);
      expect(metaContent(html, 'theme-color')).toBe(seed.primary);
      expect(linkHref(html, 'manifest')).toBe(`/m/${seed.slug}/manifest.webmanifest`);
      expect(linkHref(html, 'icon')).toBe(b.faviconUrl);
      expect(linkHref(html, 'apple-touch-icon')).toBe(b.iconUrls.apple180);
      expect(imgSrc(html, seed.name)?.endsWith(`/seed-logos/${seed.slug}.svg`)).toBe(true);
      expect(html).toContain('data-theme="light"');
      expect(html).not.toContain(NEUTRAL);
      expect(html).not.toContain(otherPrimary(key));
      await expect.poll(() => entrarBg(page)).toBe(hexToRgb(seed.primary));

      const manifest = await readManifest(page, hosts[key], seed.slug);
      expect(manifest.name).toBe(seed.name);
      expect(manifest.theme_color).toBe(seed.primary);
      expect(new Set(manifest.icons.map((i) => i.src))).toEqual(
        new Set([b.iconUrls.i192, b.iconUrls.i512, b.iconUrls.maskable512]),
      );
      for (const icon of manifest.icons) expect(icon.src).not.toContain('/icons/rede-social-');
    });

    test(`B2. ${seed.slug}: the logged-in shell renders its brand in the visible navigation`, async ({
      page,
    }, testInfo) => {
      test.skip(key === 'lab' && isRemote, 'local stack only');
      const mobile = testInfo.project.name !== 'desktop-chromium';
      await login(
        page,
        key === 'demo' ? users.demoMember : users.labMember,
        SEED_PASSWORD,
        hosts[key],
      );

      expect(await brandPrimary(page, '[data-brand-root]')).toBe(seed.primary);
      await expect(visibleNav(page)).toHaveCount(1);
      await expect(
        page.locator(mobile ? '[data-shell-nav="bottom"]' : '[data-shell-nav="rail"]'),
      ).toBeVisible();
      await expect.poll(() => activeNavColor(page)).toBe(hexToRgb(seed.primary));
      await expect(page.locator(`img[alt="${seed.name}"]:visible`).first()).toBeVisible();
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
        'content',
        seed.primary,
      );
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
        'href',
        new RegExp(`/m/${seed.slug}/manifest\\.webmanifest$`),
      );
      const html = await page.content();
      expect(html).not.toContain(NEUTRAL);
      expect(html).not.toContain(otherPrimary(key));
    });
  }

  test('B3. the generic host serves the neutral platform brand and icons, never a tenant primary', async ({
    page,
  }) => {
    test.skip(isRemote, 'local stack only');
    const html = await firstHtml(page, `${hosts.generic}/entrar`);
    expect(metaContent(html, 'theme-color')).toBe(NEUTRAL);
    expect(linkHref(html, 'icon')).toContain('/icons/rede-social-48.png');
    expect(html).not.toContain(SEED.demo.primary);
    expect(html).not.toContain(SEED.lab.primary);
  });
});
