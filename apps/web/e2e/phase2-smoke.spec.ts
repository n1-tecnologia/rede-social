import { fileURLToPath } from 'node:url';
import {
  type Browser,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  type TestInfo,
  test,
} from '@playwright/test';
import postgres from 'postgres';
import feedMessages from '../messages/pt-BR/feed.json' with { type: 'json' };
import {
  closeAdmin,
  createMember,
  deleteTenantBySlug,
  deleteUserByEmail,
  envValue,
  getTenantModuleFlag,
} from './admin';
import { type ApiFetch, apiSession, closeDomainsAdmin } from './domains-admin';
import { hosts, isRemote, login, SEED_PASSWORD } from './fixtures';
import { closeTenantFixtures, setTenantModuleFlag, throwawayOrigin } from './tenant-fixtures';
import { continueFromData, finishWizard } from './wizard';
import { ensureWorker } from './worker';

/**
 * Phase 2 smoke (plan 02-16) — the phase-level proof of ROADMAP criteria 1, 2 and 4 on a tenant that
 * exists ONLY because the platform panel created it: create → attach + verify a fake-provider host →
 * invite mail in Mailpit → branded login / manifest / icons on the new host → Marca rebrand (logo +
 * colour) through the worker → served HTML and manifest follow → member shell on phone and desktop →
 * platform-rail theme row → alias 308 → suspend/reactivate from the Status tab → module toggle →
 * branded recovery mail. The seed tenants (rede-demo, rede-lab) are never mutated; `branding.spec.ts`
 * covers them.
 *
 * Decision recorded — honest ROLE-04 witness. When this file was written no toggleable module shipped
 * routes or a home slot, so the API-404 and home-slot halves rode on the throwaway reference module
 * flipped by a spec-only SQL helper. 04-10 deleted that module (D-19) and REPLACED the witness with
 * the feed, which is what 02-16 recorded Phase 4 would do: the whole chain — panel switch → flag →
 * member bootstrap within the flags TTL → `/v1/feed` 200/404 → the home slot appearing and
 * disappearing — now runs through the PANEL on a real module, with no SQL shortcut. A provisioned
 * tenant gets every default module, so the nav reads
 * ['Início', 'Comunidades', 'Reels', 'Eventos', 'Perfil']: the FEED ships a home slot and no tab
 * (D-55), `communities` ships a tab (D-40, 05-01), `reels` a tab that REQUIRES the feed
 * (D-121/D-123, 05.3-01) and `events` the Eventos tab (D-55, 06-01). With the feed off the Reels
 * tab therefore leaves too while its own flag stays on, and it returns with the feed — an
 * assertion, not an absence.
 *
 * Hosts are `<slug>.localhost`: the BROWSER resolves them to loopback (RFC 6761) and GoTrue honours
 * their `redirectTo` locally; NODE does not resolve them, so every Node-side call (API, Mailpit,
 * Postgres, Storage) goes to `127.0.0.1` and only Chromium navigates the tenant origins.
 *
 * Cleanup: `afterAll` always deletes the throwaway tenant by slug (domains, modules, invites and
 * memberships cascade), both auth users, closes every client and stops the worker it spawned. The
 * uploaded logo/icon objects stay in the local `branding` bucket by design (public fixtures,
 * harmless, unique per run).
 */

test.describe.configure({ mode: 'serial', timeout: 300_000 });
test.skip(isRemote, 'local stack only (throwaway hosts, Mailpit, superuser SQL)');

const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';
const MAIL_URL = (process.env.PLAYWRIGHT_MAIL_URL ?? 'http://127.0.0.1:54324').replace(/\/$/, '');
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD: string = (() => {
  const value = process.env.SUPER_ADMIN_PASSWORD;
  if (!value) {
    throw new Error(
      'SUPER_ADMIN_PASSWORD is required for the platform e2e (same value used by `pnpm db:seed`)',
    );
  }
  return value;
})();

/** Neutral Rede Social brand and the two seed primaries — none may ever appear on the throwaway tenant. */
const NEUTRAL = '#2e6fd0';
const SEED_PRIMARIES = ['#7c3aed', '#0f766e'] as const;
/** Far from the seed and neutral values; PRIMARY_2 is the rebrand of test 1 (f). */
const PRIMARY_1 = '#b91c1c';
const SECONDARY_1 = '#f87171';
const PRIMARY_2 = '#0e7490';

/**
 * Per-run suffix, stable across Playwright worker restarts (a failed test restarts the worker; a
 * random suffix would orphan the tenant the earlier tests created), distinct per project.
 */
const rand = process.ppid.toString(36);
let slug = '';
let displayName = '';
let host = '';
let aliasHost = '';
let origin = '';
let aliasOrigin = '';
let adminEmail = '';
let memberEmail = '';
let tenantId = '';
let stopWorker: () => Promise<void> = async () => {};
/** The by-host branding after the rebrand of test 1 (f) — tests 2-5 assert against it. */
let brand: HostBranding | null = null;

type HostBranding = {
  logoUrl: string | null;
  faviconUrl: string | null;
  iconUrls: { i192: string; i512: string; maskable512: string; apple180: string } | null;
  colors: { primary: string; secondary: string };
};
type HostAnswer = {
  slug: string;
  displayName: string;
  status: string;
  isPrimary: boolean;
  primaryHost: string;
  branding: HostBranding;
};

const SEED_LOGO = fileURLToPath(new URL('../public/seed-logos/rede-lab.svg', import.meta.url));

/**
 * Spec-only superuser connection (local stack only — `isRemote` skips the file; the URL is never
 * printed). It exists for ONE write: flipping the reference module of the THROWAWAY tenant.
 */
const sql = postgres(
  process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
  { prepare: false, max: 1 },
);

// ---------------------------------------------------------------------------------------------
// Module-private helpers (no new fixture file — the outline's file set is kept)
// ---------------------------------------------------------------------------------------------

/** Submits `/entrar` on `origin` without asserting the landing (02-12 shape). */
async function signIn(page: Page, origin: string, email: string, password: string): Promise<void> {
  await page.goto(`${origin}/entrar`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/entrar'), { timeout: 30_000 });
}

/** `GET /v1/public/tenants/by-host` (no auth) — 200 for VERIFIED hosts only (D-36). */
async function byHost(h: string): Promise<{ status: number; body: HostAnswer }> {
  const res = await fetch(`${API_URL}/v1/public/tenants/by-host?host=${encodeURIComponent(h)}`);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as HostAnswer };
}

/** `#rrggbb` → `rgb(r, g, b)` (what `getComputedStyle` returns). */
function hexToRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function decodeAttr(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
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
  return match ? decodeAttr(match[1] ?? '') : null;
}

/** `content` of the first `<meta name="<name>">` in the first server HTML. */
function metaContent(html: string, name: string): string | null {
  const tag = tagsWith(html, 'meta', 'name', name)[0];
  return tag ? attrOf(tag, 'content') : null;
}

/** `href` of the first `<link rel="<rel>">` in the first server HTML. */
function linkHref(html: string, rel: string): string | null {
  const tag = tagsWith(html, 'link', 'rel', rel)[0];
  return tag ? attrOf(tag, 'href') : null;
}

/** `src` of the first `<img alt="<alt>">` in the first server HTML. */
function imgSrc(html: string, alt: string): string | null {
  const tag = tagsWith(html, 'img', 'alt', alt)[0];
  return tag ? attrOf(tag, 'src') : null;
}

/**
 * The navigation response body IS the first server HTML (before any script runs), so the no-flash
 * proof needs no JS-disabled context.
 */
async function firstHtml(page: Page, url: string): Promise<{ status: number; html: string }> {
  const res = await page.goto(url);
  if (!res) throw new Error(`no response for ${url}`);
  return { status: res.status(), html: await res.text() };
}

/** Whether the first HTML declares `--brand-primary` = `hex` (tolerates `:` and `: `). */
function declaresPrimary(html: string, hex: string): boolean {
  return new RegExp(`--brand-primary:\\s*${hex}`).test(html);
}

type Manifest = {
  name: string;
  short_name: string;
  theme_color: string;
  id: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};

/** Chromium fetches the manifest on the tenant origin (never the Node `request` fixture). */
async function readManifest(
  page: Page,
  origin: string,
  slug: string,
): Promise<{ status: number; headers: Record<string, string>; json: Manifest }> {
  const res = await page.goto(`${origin}/m/${slug}/manifest.webmanifest`);
  if (!res) throw new Error('no manifest response');
  return { status: res.status(), headers: res.headers(), json: (await res.json()) as Manifest };
}

type Mail = {
  Subject: string;
  From: { Name: string; Address: string };
  HTML: string;
  Text: string;
};

/** The newest Mailpit message matching `query` (`to:` / `subject:` syntax), or null. */
async function mailpitNewest(query: string): Promise<Mail | null> {
  const list = await fetch(
    `${MAIL_URL}/api/v1/search?query=${encodeURIComponent(query)}&limit=20`,
  ).catch(() => null);
  if (!list?.ok) return null;
  const { messages } = (await list.json()) as { messages?: { ID: string; Created: string }[] };
  const newest = [...(messages ?? [])].sort((a, b) => b.Created.localeCompare(a.Created))[0];
  if (!newest) return null;
  const full = await fetch(`${MAIL_URL}/api/v1/message/${newest.ID}`);
  if (!full.ok) return null;
  return (await full.json()) as Mail;
}

/** A fresh context that keeps the project's device (viewport, UA, touch, scale). */
async function newContextLike(
  browser: Browser,
  testInfo: TestInfo,
  extra: Parameters<Browser['newContext']>[0] = {},
): Promise<BrowserContext> {
  const use = testInfo.project.use;
  return browser.newContext({
    viewport: use.viewport,
    userAgent: use.userAgent,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    deviceScaleFactor: use.deviceScaleFactor,
    ...extra,
  });
}

/** The ONE navigation tree visible on this project (BottomNav on phones, the rail on desktop). */
function visibleNav(page: Page): Locator {
  return page.locator('[data-shell-nav="bottom"]:visible, [data-shell-nav="rail"]:visible');
}

/** Accessible names of the visible nav's links in DOM order (BottomNav links are icon-only). */
async function navLabels(page: Page): Promise<string[]> {
  return visibleNav(page)
    .locator('a')
    .evaluateAll((links) =>
      links.map((a) => a.getAttribute('aria-label') ?? a.textContent?.trim() ?? ''),
    );
}

/** The RENDERED text colour of the `aria-current="page"` item of the visible nav. */
async function activeNavColor(page: Page): Promise<string> {
  return visibleNav(page)
    .locator('[aria-current="page"]')
    .first()
    .evaluate((el) => {
      const painted = el.matches('.text-brand') ? el : (el.querySelector('.text-brand') ?? el);
      return getComputedStyle(painted).color;
    });
}

/** Computed `--brand-primary` on `selector` (custom properties come back as the raw token). */
async function brandPrimary(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`no element matches ${sel}`);
    return getComputedStyle(el).getPropertyValue('--brand-primary').trim();
  }, selector);
}

/** RENDERED background of the "Entrar" CTA (`Button variant="brand"` transitions colours: poll it). */
function entrarBg(page: Page): Promise<string> {
  return page
    .getByRole('button', { name: 'Entrar' })
    .evaluate((el) => getComputedStyle(el).backgroundColor);
}

/**
 * After a full navigation the file input exists before React hydrated it; a pick dispatched in that
 * window is lost (02-14 lesson). React tags hydrated nodes with its internal props key.
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

/** The single visible toast (`@rede-social/ui` `Toast`, `role=status`). */
function toast(page: Page, text: string | RegExp): Locator {
  return page.getByRole('status').filter({ hasText: text }).first();
}

/** Same icon version in every derived URL and in the favicon, or throws. */
function iconVersionOf(b: HostBranding): number {
  const urls = [
    b.iconUrls?.i192,
    b.iconUrls?.i512,
    b.iconUrls?.maskable512,
    b.iconUrls?.apple180,
    b.faviconUrl,
  ];
  const versions = new Set(urls.map((u) => u?.match(/\/icons\/(\d+)\//)?.[1] ?? 'none'));
  if (versions.size !== 1) throw new Error(`mixed icon versions: ${[...versions].join(', ')}`);
  return Number([...versions][0]);
}

// ---------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------

test.beforeAll(async ({ browser: _browser }, testInfo) => {
  const sfx = `${rand}${testInfo.project.name.charAt(0)}`;
  slug = `e2e-smoke-${sfx}`;
  displayName = `Smoke ${sfx}`;
  host = `${slug}.localhost`;
  aliasHost = `${slug}-alias.localhost`;
  origin = throwawayOrigin(host);
  aliasOrigin = throwawayOrigin(aliasHost);
  adminEmail = `admin+${sfx}@e2e-smoke.local`;
  memberEmail = `member+${sfx}@e2e-smoke.local`;
  // A leftover from an interrupted run must not collide with "Criar tenant" (slug taken).
  await deleteUserByEmail(memberEmail);
  await deleteUserByEmail(adminEmail);
  await deleteTenantBySlug(slug);
  stopWorker = await ensureWorker();
});

test.afterAll(async () => {
  try {
    await deleteUserByEmail(memberEmail);
    await deleteUserByEmail(adminEmail);
    await deleteTenantBySlug(slug); // cascades domains, modules, invites, memberships
  } finally {
    await closeAdmin();
    await closeDomainsAdmin();
    await closeTenantFixtures();
    await sql.end();
    await stopWorker();
  }
});

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

test.describe('02-16 — Phase 2 smoke on a panel-provisioned throwaway tenant', () => {
  test('1. @tracer panel: create → verified host → invite mail → branded login, manifest and icons on the new host; Marca rebrand follows through worker, by-host, served HTML and manifest', async ({
    page,
    context,
  }, testInfo) => {
    const desktop = testInfo.project.name === 'desktop-chromium';

    // (a) The super_admin lands on /inicio of the platform host (D-07/D-42); 02-07's neutral shell
    // holds exactly one nav link — the way into 02-12's panel (D-21).
    await signIn(page, hosts.platform, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    await expect(page).toHaveURL(/\/inicio$/);
    const panelLink = visibleNav(page).locator('a[href="/plataforma"]');
    await expect(panelLink).toHaveCount(1);
    await panelLink.click();
    await expect(page).toHaveURL(/\/plataforma$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Tenants' })).toBeVisible();

    if (desktop) {
      // D-41 on the platform rail (02-12 PlatformRail, themeSlot mounted by 02-16): the Tema row
      // sits in the pinned bottom group next to "Sair"; the toggle is server-rendered after reload.
      const rail = page.locator('aside');
      const themeSwitch = rail.getByRole('switch', { name: 'Tema' });
      await expect(themeSwitch).toBeVisible();
      await expect(themeSwitch).toHaveAttribute('aria-checked', 'false');
      const bottomGroup = rail
        .locator('.mt-auto')
        .filter({ has: page.getByRole('switch', { name: 'Tema' }) })
        .filter({ has: page.getByRole('button', { name: 'Sair' }) });
      await expect(bottomGroup).toHaveCount(1);
      // E03/overflow: the rail never exceeds the screen height and the label truncates inside it.
      const railBox = await rail.boundingBox();
      const viewport = page.viewportSize();
      if (!railBox || !viewport) throw new Error('rail has no box');
      expect(railBox.height).toBeLessThanOrEqual(viewport.height + 1);
      await expect(rail.locator('.mt-auto span.truncate', { hasText: 'Tema' })).toBeVisible();

      await themeSwitch.click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(themeSwitch).toHaveAttribute('aria-checked', 'true');
      await expect
        .poll(async () => (await context.cookies()).find((c) => c.name === 'rede_theme')?.value)
        .toBe('dark');
      const reloaded = await page.reload();
      expect(await reloaded?.text()).toContain('data-theme="dark"'); // server-rendered, no flash
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await rail.getByRole('switch', { name: 'Tema' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect
        .poll(async () => (await context.cookies()).find((c) => c.name === 'rede_theme')?.value)
        .toBe('light');
    }

    // (b) D-31 form: name, slug (the suggestion is cleared first), first-admin e-mail; the colours
    // are the next step's (Personalização).
    await page.goto(`${hosts.platform}/plataforma/novo`);
    await expect(page.locator('form[data-draft-ready]')).toBeVisible();
    await page.locator('#displayName').fill(displayName);
    await page.locator('#slug').clear();
    await page.locator('#slug').fill(slug);
    await page.locator('#adminEmail').fill(adminEmail);
    // The wizard creates the tenant at the summary's confirmation and lands on its invite step;
    // the tenant page is one navigation away.
    await continueFromData(page);
    tenantId = await finishWizard(page, { primary: PRIMARY_1, secondary: SECONDARY_1 });
    expect(tenantId).toMatch(/^[0-9a-f-]{36}$/);
    await page.goto(`${hosts.platform}/plataforma/tenants/${tenantId}/marca`);
    await expect(page.getByRole('heading', { level: 1, name: displayName })).toBeVisible();

    // (c) D-36 negative BEFORE verification: by-host 404, the host renders the generic neutral shell.
    expect((await byHost(host)).status).toBe(404);
    const cold = await firstHtml(page, `${origin}/entrar`);
    expect(cold.status).toBe(200);
    expect(metaContent(cold.html, 'theme-color')).toBe(NEUTRAL);
    expect(cold.html).not.toContain(PRIMARY_1);
    expect(linkHref(cold.html, 'icon')).toContain('/icons/rede-social-48.png');

    // (d) Domínios tab: attach through the fake provider, "Verificar agora" → Verificado (TENANT-07,
    // D-34/D-35); by-host answers 200 as primary; the pending invite is sent on verification (D-30).
    await page.goto(`${hosts.platform}/plataforma/tenants/${tenantId}/dominios`);
    await page.locator('#host').fill(host);
    await page.getByRole('button', { name: 'Adicionar domínio' }).click();
    const card = page
      .getByTestId('domain-card')
      .filter({ has: page.getByRole('heading', { name: host, exact: true }) });
    await expect(card).toBeVisible();
    await expect(card.getByText('Aguardando DNS', { exact: true })).toBeVisible();
    await expect(card.getByText('Primário', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Verificar agora' }).click();
    await expect(card.getByText('Verificado', { exact: true })).toBeVisible();

    const resolved = await byHost(host);
    expect(resolved.status).toBe(200);
    expect(resolved.body).toMatchObject({ isPrimary: true, primaryHost: host, status: 'active' });
    expect(resolved.body.branding.colors.primary).toBe(PRIMARY_1);
    expect(resolved.body.branding.logoUrl).toBeNull();
    expect(resolved.body.branding.iconUrls).toBeNull();

    await expect.poll(() => mailpitNewest(`to:${adminEmail}`), { timeout: 30_000 }).not.toBeNull();
    const invite = await mailpitNewest(`to:${adminEmail}`);
    if (!invite) throw new Error('invite mail vanished');
    expect(invite.Subject).toBe(`Convite para administrar ${displayName}`);
    expect(invite.From.Name).toBe(displayName);
    expect(invite.HTML).toContain(`${origin}/auth/confirm`); // TENANT-06; acceptance is invite.spec.ts

    // (e) Served brand on the new host BEFORE any logo: name as text (D-26), neutral icons by design
    // (iconUrls null → the whole neutral set, 02-11 provenance rule). The web host cache (60 s) was
    // primed with the 404 of (c), so the first HTML is polled up to 70 s — the assertion itself is
    // exact; the observed delay is recorded in the SUMMARY.
    const t0 = Date.now();
    await expect
      .poll(
        async () => declaresPrimary((await firstHtml(page, `${origin}/entrar`)).html, PRIMARY_1),
        {
          timeout: 70_000,
          intervals: [1_000, 2_000, 3_000],
        },
      )
      .toBe(true);
    testInfo.annotations.push({
      type: 'by-host → served HTML (verify)',
      description: `${Math.round((Date.now() - t0) / 1000)} s`,
    });
    const served1 = await firstHtml(page, `${origin}/entrar`);
    expect(declaresPrimary(served1.html, PRIMARY_1)).toBe(true);
    expect(metaContent(served1.html, 'theme-color')).toBe(PRIMARY_1);
    expect(linkHref(served1.html, 'manifest')).toBe(`/m/${slug}/manifest.webmanifest`);
    expect(linkHref(served1.html, 'icon')).toContain('/icons/rede-social-48.png');
    expect(served1.html).toContain('data-theme="light"');
    expect(served1.html).toContain('data-testid="auth-brand-name"');
    await expect(page.getByTestId('auth-brand-name')).toHaveText(displayName);
    expect(served1.html).not.toContain(NEUTRAL);
    await expect.poll(() => entrarBg(page)).toBe(hexToRgb(PRIMARY_1)); // RENDERED brand CTA

    const manifest1 = await readManifest(page, origin, slug);
    expect(manifest1.status).toBe(200);
    expect(manifest1.headers['content-type']).toContain('application/manifest+json');
    expect(manifest1.headers['cache-control']).toContain('no-store');
    expect(manifest1.json.name).toBe(displayName);
    expect(manifest1.json.theme_color).toBe(PRIMARY_1);
    expect(manifest1.json.id).toBe(`/?tenant=${slug}`);
    for (const icon of manifest1.json.icons) expect(icon.src).toContain('/icons/rede-social-'); // PWA-01

    // (f) Marca rebrand: logo through the signed PUT → the worker derives v1; a primary-colour save
    // bumps iconVersion → v2 (D-27/D-28). by-host then carries the new colour, logo and icon URLs.
    await page.goto(`${hosts.platform}/plataforma/tenants/${tenantId}/marca`);
    await waitForHydration(page, '[data-upload-zone="logo"] input[type="file"]');
    await page.locator('[data-upload-zone="logo"] input[type="file"]').setInputFiles(SEED_LOGO);
    await expect(toast(page, 'Alterações salvas.')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-icons-status="ready"]')).toBeVisible({ timeout: 90_000 });
    const v1 = iconVersionOf((await byHost(host)).body.branding);
    expect(v1).toBeGreaterThanOrEqual(1);

    await page.locator('#primary').fill(PRIMARY_2);
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(toast(page, 'Alterações salvas.')).toBeVisible({ timeout: 30_000 });
    // The version caption is a sibling of the status line; the transient "generating" state is not
    // asserted (the worker may be faster than the poll).
    await expect(page.getByText(`Versão ${v1 + 1}`, { exact: true })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.locator('[data-icons-status="ready"]')).toBeVisible({ timeout: 90_000 });

    await expect
      .poll(async () => (await byHost(host)).body.branding.colors.primary, { timeout: 30_000 })
      .toBe(PRIMARY_2);
    const after = (await byHost(host)).body.branding;
    expect(
      after.logoUrl?.startsWith(
        `${envValue('SUPABASE_URL')}/storage/v1/object/public/branding/${tenantId}/branding/`,
      ),
    ).toBe(true);
    expect(after.iconUrls).not.toBeNull();
    expect(iconVersionOf(after)).toBe(v1 + 1); // same version in every key and the favicon
    expect(after.iconUrls?.i512).toContain(`/icons/${v1 + 1}/`);
    expect(after.faviconUrl?.endsWith('favicon.ico')).toBe(true);
    brand = after;

    // (g) Served documents follow the rebrand (02-14 handoff, TENANT-02): first HTML, rendered CTA,
    // manifest icons = by-host iconUrls. Polled up to 70 s for the same 60 s web host cache.
    const t1 = Date.now();
    await expect
      .poll(
        async () => declaresPrimary((await firstHtml(page, `${origin}/entrar`)).html, PRIMARY_2),
        {
          timeout: 70_000,
          intervals: [1_000, 2_000, 3_000],
        },
      )
      .toBe(true);
    testInfo.annotations.push({
      type: 'by-host → served HTML (rebrand)',
      description: `${Math.round((Date.now() - t1) / 1000)} s`,
    });
    const served2 = await firstHtml(page, `${origin}/entrar`);
    expect(declaresPrimary(served2.html, PRIMARY_2)).toBe(true);
    expect(metaContent(served2.html, 'theme-color')).toBe(PRIMARY_2);
    expect(linkHref(served2.html, 'icon')).toBe(after.faviconUrl);
    expect(linkHref(served2.html, 'apple-touch-icon')).toBe(after.iconUrls?.apple180);
    expect(imgSrc(served2.html, displayName)).toBe(after.logoUrl); // logo as-is (D-26)
    expect(served2.html).not.toContain(PRIMARY_1);
    expect(served2.html).not.toContain(NEUTRAL);
    await expect.poll(() => entrarBg(page)).toBe(hexToRgb(PRIMARY_2));

    // The manifest route caches the tenant branding on its own clock, so it can still serve the
    // pre-rebrand record after the HTML has turned over. Wait for it with the same 70 s budget
    // (the same 60 s web host cache) before asserting it; the assertions below are unchanged.
    await expect
      .poll(async () => (await readManifest(page, origin, slug)).json.theme_color, {
        timeout: 70_000,
        intervals: [1_000, 2_000, 3_000],
      })
      .toBe(PRIMARY_2);
    const manifest2 = await readManifest(page, origin, slug);
    expect(manifest2.status).toBe(200);
    expect(manifest2.json.theme_color).toBe(PRIMARY_2);
    expect(manifest2.json.icons).toHaveLength(3);
    expect(new Set(manifest2.json.icons.map((i) => i.src))).toEqual(
      new Set([after.iconUrls?.i192, after.iconUrls?.i512, after.iconUrls?.maskable512]),
    );
    const maskable = manifest2.json.icons.find((i) => i.src === after.iconUrls?.maskable512);
    expect(maskable?.purpose).toContain('maskable');
    const png = await fetch(after.iconUrls?.i512 ?? '');
    expect(png.status).toBe(200);
    expect(png.headers.get('content-type') ?? '').toContain('image/png'); // Storage serves it
  });

  test('2. member shell on the new host: brand rendered in the navigation on phone and desktop, theme-color, manifest link, no other brand', async ({
    page,
  }, testInfo) => {
    if (!brand) throw new Error('test 1 must run first (serial)');
    const mobile = testInfo.project.name !== 'desktop-chromium';
    await createMember(memberEmail, SEED_PASSWORD, slug);
    await login(page, memberEmail, SEED_PASSWORD, origin);

    expect(await brandPrimary(page, '[data-brand-root]')).toBe(PRIMARY_2);
    await expect(
      page.locator(`[data-brand-root] img[alt="${displayName}"]:visible`).first(),
    ).toBeVisible();

    // Exactly one nav tree visible: BottomNav on iPhone 14 / Pixel 7, the rail on desktop (D-39).
    await expect(visibleNav(page)).toHaveCount(1);
    await expect(
      page.locator(mobile ? '[data-shell-nav="bottom"]' : '[data-shell-nav="rail"]'),
    ).toBeVisible();
    // D-19 (reference module off) + D-40: the two kernel tabs plus the `communities` and `reels`
    // manifests' own entries, which every newly provisioned tenant gets with the default module set
    // (05-01, 05.3-01).
    expect(await navLabels(page)).toEqual(['Início', 'Comunidades', 'Reels', 'Eventos', 'Perfil']);
    // RENDERED brand colour on the active item (02-14 alias scoping inside [data-brand-root]).
    await expect.poll(() => activeNavColor(page)).toBe(hexToRgb(PRIMARY_2));

    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', PRIMARY_2);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      new RegExp(`/m/${slug}/manifest\\.webmanifest$`),
    );
    // The brand name is proven by the logo's alt above; Início's h1 is screen-reader only.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Início');

    const html = await page.content();
    for (const hex of [...SEED_PRIMARIES, NEUTRAL, PRIMARY_1]) expect(html).not.toContain(hex);
    await expect(
      page.locator('[data-brand-root]').getByText('Rede Social', { exact: true }),
    ).toHaveCount(0);
  });

  test('3. alias host → 308 to the primary; Status tab suspend → branded unavailable screen; reactivate', async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'pixel-chromium',
      'layout-independent — runs on mobile-chromium and desktop-chromium',
    );
    if (!brand) throw new Error('test 1 must run first (serial)');

    // A second host attached and verified from the Domínios tab is NON-primary (D-35).
    await signIn(page, hosts.platform, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    await page.goto(`${hosts.platform}/plataforma/tenants/${tenantId}/dominios`);
    await page.locator('#host').fill(aliasHost);
    await page.getByRole('button', { name: 'Adicionar domínio' }).click();
    const aliasCard = page
      .getByTestId('domain-card')
      .filter({ has: page.getByRole('heading', { name: aliasHost, exact: true }) });
    await expect(aliasCard).toBeVisible();
    await expect(aliasCard.getByText('Aguardando DNS', { exact: true })).toBeVisible();
    await expect(aliasCard.getByText('Primário', { exact: true })).toHaveCount(0);
    await aliasCard.getByRole('button', { name: 'Verificar agora' }).click();
    await expect(aliasCard.getByText('Verificado', { exact: true })).toBeVisible();
    const aliasAnswer = await byHost(aliasHost);
    expect(aliasAnswer.status).toBe(200);
    expect(aliasAnswer.body.isPrimary).toBe(false);
    expect(aliasAnswer.body.primaryHost).toBe(host);

    // Browser GET on the alias: 308 to the primary origin, path + query preserved, no-store (D-35).
    const target = `${aliasOrigin}/entrar?x=1`;
    const responsePromise = page.waitForResponse((r) => r.url() === target);
    await page.goto(target);
    const redirect = await responsePromise;
    expect(redirect.status()).toBe(308);
    expect(redirect.headers().location).toBe(`${origin}/entrar?x=1`);
    expect(redirect.headers()['cache-control']).toContain('no-store');
    await expect(page).toHaveURL(`${origin}/entrar?x=1`);
    await expect(page.getByText(`Comunidade: ${displayName}`, { exact: true })).toBeVisible();

    // Suspend from the panel (D-32): a signed-in member's next /inicio lands on the BRANDED
    // /comunidade-indisponivel and the host's /entrar hides its form.
    const memberContext = await newContextLike(browser, testInfo);
    const memberPage = await memberContext.newPage();
    try {
      await login(memberPage, memberEmail, SEED_PASSWORD, origin);
      await expect(memberPage.locator('[data-brand-root]')).toBeVisible();

      await page.goto(`${hosts.platform}/plataforma/tenants/${tenantId}/status`);
      await page.getByRole('button', { name: 'Suspender tenant' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Suspender' }).click();
      await expect(page.getByTestId('tenant-status-pill')).toHaveText('Suspenso');
      expect((await byHost(host)).body.status).toBe('suspended');

      await memberPage.goto(`${origin}/inicio`);
      await expect(memberPage).toHaveURL(`${origin}/comunidade-indisponivel`, { timeout: 30_000 });
      await expect(memberPage.getByText('Comunidade indisponível')).toBeVisible();
      expect(await brandPrimary(memberPage, 'main')).toBe(PRIMARY_2); // branded, host-resolved
      expect((await memberContext.cookies()).filter((c) => c.name.startsWith('sb-'))).toHaveLength(
        0,
      );

      // The cold /entrar hides the form (02-08 C2). The web host cache (60 s) still knows the tenant
      // as active for a while, so the first HTML is polled up to 70 s; the assertion stays exact.
      const t0 = Date.now();
      await expect
        .poll(
          async () => {
            const { html } = await firstHtml(memberPage, `${origin}/entrar`);
            return html.includes('Comunidade indisponível') && !html.includes('id="password"');
          },
          { timeout: 70_000, intervals: [1_000, 2_000, 3_000] },
        )
        .toBe(true);
      testInfo.annotations.push({
        type: 'by-host → served HTML (suspend)',
        description: `${Math.round((Date.now() - t0) / 1000)} s`,
      });

      // Reactivate: the form is back (polled for the same cache).
      await page.getByRole('button', { name: 'Reativar tenant' }).click();
      await expect(page.getByTestId('tenant-status-pill')).toHaveText('Ativo');
      expect((await byHost(host)).body.status).toBe('active');
      const t1 = Date.now();
      await expect
        .poll(
          async () =>
            (await firstHtml(memberPage, `${origin}/entrar`)).html.includes('id="password"'),
          { timeout: 70_000, intervals: [1_000, 2_000, 3_000] },
        )
        .toBe(true);
      testInfo.annotations.push({
        type: 'by-host → served HTML (reactivate)',
        description: `${Math.round((Date.now() - t1) / 1000)} s`,
      });
    } finally {
      await memberContext.close();
    }
  });

  test('4. Módulos tab: Feed off from the panel → flag, bootstrap, /v1/feed 404 MODULE_DISABLED and the home slot all follow within the flags TTL, with no redeploy and no nav change (D-55); back on restores every one of them (honest ROLE-04 witness)', async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'pixel-chromium',
      'layout-independent — runs on mobile-chromium and desktop-chromium',
    );
    if (!brand) throw new Error('test 1 must run first (serial)');

    const memberApi: ApiFetch = await apiSession(memberEmail, SEED_PASSWORD);
    const modulesOf = async (): Promise<string[]> => {
      const res = await memberApi('/v1/me/bootstrap', {}, host);
      expect(res.status, 'GET /v1/me/bootstrap').toBe(200);
      return ((await res.json()) as { modules: { key: string }[] }).modules.map((m) => m.key);
    };
    const feedApi = async (): Promise<{ status: number; code: string | null }> => {
      const res = await memberApi('/v1/feed', {}, host);
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
      return { status: res.status, code: body.error?.code ?? null };
    };
    /** The feed home slot, named by its catalog `aria-label` — a copy drift fails here. */
    const feedRegion = (p: Page) => p.getByRole('region', { name: feedMessages.feed.region });

    const memberContext = await newContextLike(browser, testInfo);
    const memberPage = await memberContext.newPage();
    try {
      await login(memberPage, memberEmail, SEED_PASSWORD, origin);

      // (a) BASELINE, so the disappearance below is a change and not a pre-existing absence: the
      // tenant is created with the feed on, the member's home route renders its slot, and the API
      // answers 200.
      await memberPage.goto(`${origin}/inicio`);
      await expect(feedRegion(memberPage)).toBeVisible();
      expect(await modulesOf()).toContain('feed');
      expect((await feedApi()).status).toBe(200);
      expect(await navLabels(memberPage)).toEqual([
        'Início',
        'Comunidades',
        'Reels',
        'Eventos',
        'Perfil',
      ]);

      // (b) Panel path: Feed off → the stored flag, the member's bootstrap, the API and the home
      // slot all follow, within the flags TTL and with no redeploy. The FEED itself ships a home
      // slot and no tab (D-55), so no "Feed" link ever appears — asserted, not assumed. The
      // `Comunidades` entry belongs to another module whose flag this test never touches, so it is
      // present in all three readings. `Reels` REQUIRES the feed (D-121, 05.3-01): with the feed
      // off it leaves the nav although its own flag stays on, and it returns with the feed.
      await signIn(page, hosts.platform, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      await page.goto(`${hosts.platform}/plataforma/tenants/${tenantId}/modulos`);
      await expect(page.locator('main').getByRole('switch')).toHaveCount(7);
      const feed = page.getByRole('switch', { name: /Feed/ });
      await feed.click();
      await expect(feed).toHaveAttribute('aria-checked', 'false');
      await expect(toast(page, 'Alterações salvas.')).toBeVisible();
      await expect.poll(() => getTenantModuleFlag(slug, 'feed'), { timeout: 10_000 }).toBe(false);
      await expect.poll(modulesOf, { timeout: 35_000 }).not.toContain('feed'); // MODULE_FLAGS_TTL_MS
      // 404 MODULE_DISABLED, never 403: "not here" must not degrade into "not allowed".
      await expect.poll(async () => (await feedApi()).status, { timeout: 35_000 }).toBe(404);
      expect((await feedApi()).code).toBe('MODULE_DISABLED');
      await memberPage.goto(`${origin}/inicio`);
      // D-121: the feed-requiring Reels tab left with the feed; its own flag was never touched.
      expect(await navLabels(memberPage)).toEqual(['Início', 'Comunidades', 'Eventos', 'Perfil']);
      expect(await getTenantModuleFlag(slug, 'reels')).toBe(true);
      await expect(visibleNav(memberPage).getByRole('link', { name: 'Feed' })).toHaveCount(0);
      await expect(feedRegion(memberPage)).toHaveCount(0); // the slot is gone, no redeploy

      // (c) The tenant ends as created: Feed back on from the panel, and every witness restored.
      await page.getByRole('switch', { name: /Feed/ }).click();
      await expect(page.getByRole('switch', { name: /Feed/ })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await expect(toast(page, 'Alterações salvas.')).toBeVisible();
      await expect.poll(modulesOf, { timeout: 35_000 }).toContain('feed');
      await expect.poll(async () => (await feedApi()).status, { timeout: 35_000 }).toBe(200);
      await memberPage.goto(`${origin}/inicio`);
      await expect(feedRegion(memberPage)).toBeVisible();
      expect(await navLabels(memberPage)).toEqual([
        'Início',
        'Comunidades',
        'Reels',
        'Eventos',
        'Perfil',
      ]);
    } finally {
      await setTenantModuleFlag(slug, 'feed', true);
      await memberContext.close();
    }
  });

  test('5. branded recovery e-mail for the throwaway tenant via GoTrue → hook → Mailpit', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'pixel-chromium',
      'layout-independent — runs on mobile-chromium and desktop-chromium',
    );
    if (!brand) throw new Error('test 1 must run first (serial)');

    await page.goto(`${origin}/esqueci-senha`);
    await page.locator('#email').fill(memberEmail);
    await page.getByRole('button', { name: 'Enviar link' }).click();
    await expect(page).toHaveURL(/\/esqueci-senha\?enviado=1$/, { timeout: 30_000 });

    await expect.poll(() => mailpitNewest(`to:${memberEmail}`), { timeout: 30_000 }).not.toBeNull();
    const mail = await mailpitNewest(`to:${memberEmail}`);
    if (!mail) throw new Error('recovery mail vanished');
    expect(mail.Subject).toBe(`Redefina sua senha — ${displayName}`);
    expect(mail.From.Name).toBe(displayName);
    expect(mail.From.Address.startsWith('no-reply@')).toBe(true);
    // The CTA carries the PERSISTED primary (02-06 layout: `background:${primary}`), the logo as-is
    // (D-26) and the platform footer; no seed or neutral hex anywhere (D-37/D-38, TENANT-06).
    expect(mail.HTML).toContain(`background:${PRIMARY_2}`);
    expect(mail.HTML).toContain(`<img src="${brand.logoUrl}"`);
    expect(mail.HTML).toContain(`alt="${displayName}"`);
    expect(mail.HTML).toContain('Enviado pela plataforma Rede Social');
    for (const hex of [...SEED_PRIMARIES, NEUTRAL]) expect(mail.HTML).not.toContain(hex);
    expect(mail.Text).toContain(`${origin}/auth/confirm`); // plain-text alternative
    // No link is followed: Phase 1's recovery.spec.ts owns the reset flow (branded by 02-06).
  });
});
