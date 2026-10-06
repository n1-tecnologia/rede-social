import { expect, type Locator, type Page, test } from '@playwright/test';
import appMessages from '../messages/pt-BR/app.json' with { type: 'json' };
import feedMessages from '../messages/pt-BR/feed.json' with { type: 'json' };
import { closeAdmin, feedPostIdFor } from './admin';
import { type ApiFetch, apiSession, closeDomainsAdmin } from './domains-admin';
import {
  closeFeedAdmin,
  createEmptyFeedTenant,
  deleteEmptyFeedTenant,
  type EmptyFeedTenant,
} from './feed-admin';
import { hosts, isRemote, login, SEED_PASSWORD, seededFeed, users } from './fixtures';
import { closeTenantFixtures, setTenantModuleFlag } from './tenant-fixtures';

/**
 * Phase 4 smoke (plan 04-10) — the phase's per-phase witness, in the shape 02-16 established and
 * 03-08 repeated: one spec, real fixtures, TWO witnesses of the module flag, and an explicit note
 * wherever the walk deliberately proves nothing.
 *
 * 02-16 recorded that the module-flag witness would move to a real feature in Phase 4, and this is
 * where that happens. The reference module it used to ride on is gone (D-19, this same plan), so
 * every assertion below is about `feed` — a module a tenant would actually buy.
 *
 * The two witnesses:
 *
 *   ENABLED  — on the seeded `rede-demo`, a member signing in lands on `/inicio`, sees the feed
 *              widget carrying the tenant's own seeded posts, finds NO feed tab in the navigation
 *              (D-55: the feed is a home slot, so Phases 5-6 keep their tab budget), and a seeded
 *              post's `/post/{id}` page renders.
 *   DISABLED — on a throwaway tenant whose `feed` flag is off, the same member-shaped session lands
 *              on `/inicio`, sees the kernel's remaining widgets render normally with NO feed widget
 *              and NO error card, and every feed API route answers 404 rather than 403 — "not here"
 *              must never degrade into "not allowed", or a member could enumerate what a community
 *              did not buy.
 *
 * Then the flag is FLIPPED on for the throwaway tenant and the widget appears without a redeploy,
 * bounded by the flags cache window; and the deleted reference module is shown to leave no trace a
 * browser or an API client can see.
 *
 * A PER-RUN host for the throwaway half (03-05's finding): both the web tier and the API cache the
 * host → tenant mapping for about a minute, so reusing a host points a fresh session at a tenant
 * that was just deleted. A fresh host per run cannot collide with its own predecessor.
 *
 * `serviceWorkers: 'block'` (the 03-05 lesson): a registered Serwist worker can answer a navigation
 * from its own cache, and a spec asserting what the SERVER rendered for a given flag state would
 * then be asserting what a previous run left behind — which is precisely the failure mode a
 * flag-flip spec must not have.
 *
 * **What this spec deliberately does not prove**, carried to the phase UAT rather than silently
 * counted as passing: the native OS share sheet (04-08 — outside the browser automation boundary),
 * a REAL video transcode and real-device HLS playback (both known-blocked on the deferred cloud
 * phase 01.1), and the double-tap/gallery-swipe gestures on real iOS and Android hardware.
 */

test.describe.configure({ mode: 'serial', timeout: 300_000 });
test.skip(isRemote, 'local stack only (seeded rede-demo, a throwaway tenant, direct DB fixtures)');
test.use({ serviceWorkers: 'block' });

/** The catalog is the source of copy (UI-SPEC Copywriting Contract) — never a literal in a spec. */
const F = feedMessages.feed;
const APP = appMessages.app;

/** Per-run slug AND host: `tenant-fixtures` bounds the slug at 40 characters. */
const RUN = Date.now().toString(36);
const OFF_PASSWORD = 'Segredo123';

let off: EmptyFeedTenant | null = null;
let offApi: ApiFetch | null = null;
let demoPostId = '';

/** The feed widget's region, named by its catalog `aria-label` — a copy drift fails here. */
function feedRegion(page: Page): Locator {
  return page.getByRole('region', { name: F.region });
}

/** The visible navigation (bottom on the phone, rail on the desktop). */
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

/** `{ status, code }` of one API call, so a 403 can never be read as a 404 by accident. */
async function answer(api: ApiFetch, path: string, host: string) {
  const res = await api(path, {}, host);
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
  return { status: res.status, code: body.error?.code ?? null };
}

test.beforeAll(async ({ browser: _browser }, testInfo) => {
  demoPostId = await feedPostIdFor(seededFeed.newest, 'rede-demo');

  // The project name rides the slug so the two Playwright projects never provision the same host
  // concurrently; the run stamp is what keeps a fresh session off a deleted tenant's cached host.
  const project = testInfo.project.name.replace(/[^a-z0-9]+/gi, '').toLowerCase();
  const slug = `p4off-${project}-${RUN}`.slice(0, 40);

  // Provisioned with the feed ON (the helper's contract), then turned OFF here — so the disabled
  // witness below is a tenant that demonstrably COULD have had a feed, not one that was never wired.
  off = await createEmptyFeedTenant(slug, OFF_PASSWORD);
  await setTenantModuleFlag(slug, 'feed', false);
  offApi = await apiSession(off.memberEmail, OFF_PASSWORD);
});

test.afterAll(async () => {
  if (off) await deleteEmptyFeedTenant(off.slug);
  await closeFeedAdmin();
  await closeTenantFixtures();
  await closeDomainsAdmin();
  await closeAdmin();
});

test.describe('Phase 4 smoke — the feed, in both directions of its module flag', () => {
  test('1. ENABLED: a member lands on the feed, the navigation gains no tab (D-55), and a post page renders', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    // The widget is the home route's main content, carrying the tenant's OWN seeded posts.
    const region = feedRegion(page);
    await expect(region).toBeVisible();
    await expect(region.getByText(seededFeed.newest, { exact: false })).toBeVisible();
    await expect(region.getByRole('article').first()).toBeVisible();

    // D-55, asserted rather than assumed: the FEED contributes a HOME SLOT and no navigation entry.
    // The `Comunidades` and `Reels` entries beside the two kernel tabs are 05-01's `communities` and
    // 05.3-01's `reels` manifests, not the feed's — which is exactly the distinction this assertion
    // exists to keep visible, and the explicit `name: 'Feed'` count below is what pins it.
    expect(await navLabels(page)).toEqual(['Início', 'Comunidades', 'Reels', 'Eventos', 'Perfil']);
    await expect(visibleNav(page).getByRole('link', { name: 'Feed', exact: true })).toHaveCount(0);

    // FEED-07: the deep link a member would receive resolves to the post's own page.
    await page.goto(`${hosts.demo}/post/${demoPostId}`);
    await expect(page).toHaveURL(new RegExp(`/post/${demoPostId}$`));
    await expect(page.getByText(seededFeed.newest, { exact: false }).first()).toBeVisible();
  });

  test('2. DISABLED: the home route renders without the widget and without an error card; every feed route answers 404, never 403', async ({
    page,
  }) => {
    const tenant = off;
    const api = offApi;
    if (!tenant || !api) throw new Error('the throwaway tenant fixture did not initialise');
    const host = new URL(tenant.origin).hostname;

    await login(page, tenant.memberEmail, OFF_PASSWORD, tenant.origin);

    // The page renders — Início's own h1 is there — and the feed simply is not.
    await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible();
    await expect(feedRegion(page)).toHaveCount(0);
    // NOT an error card: a module a tenant did not buy is an absence, never a failure (UI E04).
    await expect(page.getByText(APP.error.title, { exact: true })).toHaveCount(0);
    // With no module slot registered, the kernel's own "Em breve" card is what fills the page.
    await expect(page.getByText(APP.home.soonTitle, { exact: true })).toBeVisible();
    // This throwaway tenant has no `reels` row at all, so D-121's `requires` is not what keeps the
    // Reels tab away here (05.3-09 proves that on its own tenant).
    expect(await navLabels(page)).toEqual(['Início', 'Perfil']);

    // The module-disabled rule, across the routes a member could reach: 404 MODULE_DISABLED on all
    // of them. A 403 anywhere here would tell a member the feature exists and is being withheld.
    for (const path of [
      '/v1/feed',
      `/v1/feed/posts/${demoPostId}`,
      `/v1/feed/posts/${demoPostId}/comments`,
    ]) {
      expect(await answer(api, path, host), path).toEqual({
        status: 404,
        code: 'MODULE_DISABLED',
      });
    }
  });

  test('3. the flag flips ON and the widget appears within the flags cache window — no redeploy', async ({
    page,
  }) => {
    const tenant = off;
    const api = offApi;
    if (!tenant || !api) throw new Error('the throwaway tenant fixture did not initialise');
    const host = new URL(tenant.origin).hostname;

    const flippedAt = Date.now();
    await setTenantModuleFlag(tenant.slug, 'feed', true);

    // MODULE_FLAGS_TTL_MS is 30 s; the ceiling is bounded and the OBSERVED delay is annotated, while
    // the assertion itself stays exact (200, not "not 404").
    await expect
      .poll(async () => (await answer(api, '/v1/feed', host)).status, { timeout: 35_000 })
      .toBe(200);
    test.info().annotations.push({
      type: 'flags-cache',
      description: `feed flag visible to the API after ${Date.now() - flippedAt} ms (ceiling 35 s, MODULE_FLAGS_TTL_MS 30 s)`,
    });

    await login(page, tenant.memberEmail, OFF_PASSWORD, tenant.origin);
    const region = feedRegion(page);
    await expect(region).toBeVisible();
    // A tenant with the module on and nothing published: the feed's OWN empty card, not the
    // kernel's "Em breve" — which is how the two absences stay distinguishable (UI-D-20).
    await expect(region.getByText(F.empty.title, { exact: true })).toBeVisible();
    await expect(page.getByText(APP.home.soonTitle, { exact: true })).toHaveCount(0);
    // Still no tab: turning the module on adds a slot, never a navigation entry (D-55). The
    // throwaway tenant has no `reels` row, so no Reels tab either (not D-121's doing).
    expect(await navLabels(page)).toEqual(['Início', 'Perfil']);
  });

  test('4. the deleted reference module leaves no trace a browser or an API client can see (D-19)', async ({
    page,
  }) => {
    const tenant = off;
    if (!tenant) throw new Error('the throwaway tenant fixture did not initialise');

    // Its former route is simply not mounted any more: the API answers not-found.
    const demoApi = await apiSession(users.demoMember, SEED_PASSWORD);
    const demoHost = new URL(hosts.demo).hostname;
    expect((await answer(demoApi, '/v1/example/items', demoHost)).status).toBe(404);

    // …and the shell offers neither a tab nor a widget for it, on a tenant that used to have both.
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    // `Comunidades` (05-01) and `Reels` (05.3-01) are module manifests and are exactly what the
    // absent reference module's own entry would have looked like — their presence is what makes
    // this an assertion about the DELETED module rather than about a nav that happens to be
    // kernel-only.
    expect(await navLabels(page)).toEqual(['Início', 'Comunidades', 'Reels', 'Eventos', 'Perfil']);
    await expect(page.locator('#exemplo')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Exemplo', exact: true })).toHaveCount(0);
  });
});
