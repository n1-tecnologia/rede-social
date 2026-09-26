import { expect, type Locator, type Page, test } from '@playwright/test';
import appMessages from '../messages/pt-BR/app.json' with { type: 'json' };
import communityMessages from '../messages/pt-BR/communities.json' with { type: 'json' };
import storyMessages from '../messages/pt-BR/stories.json' with { type: 'json' };
import { closeAdmin } from './admin';
import { type ApiFetch, apiSession, closeDomainsAdmin } from './domains-admin';
import {
  closeFeedAdmin,
  createEmptyFeedTenant,
  deleteEmptyFeedTenant,
  type EmptyFeedTenant,
} from './feed-admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import { closeTenantFixtures, setTenantModuleFlag } from './tenant-fixtures';

/**
 * Phase 5 smoke (plan 05-08) — the phase's per-phase witness, in the shape 02-16 established and
 * 03-08 and 04-10 repeated: one spec, real fixtures, TWO witnesses per module flag, and an explicit
 * note wherever the walk deliberately proves nothing.
 *
 * **Phase 5 ships TWO modules, so the witness runs twice.** `communities` and `stories` are
 * independent products a tenant buys separately, and each has to be shown to appear and disappear
 * on its own — a single combined flip would pass on an implementation where one module's routes
 * were gated by the other's flag.
 *
 *   ENABLED  — on the seeded `tria-demo`, a member signing in lands on `/inicio` with the STORIES
 *              STRIP above the feed and a `Comunidades` tab in the navigation, and a community page
 *              carries its `Destaques` row — the pinned circles STORY-04 put there.
 *   DISABLED — on a throwaway tenant with each flag off in turn, the same member-shaped session
 *              lands on `/inicio` with the corresponding surface simply ABSENT and no error card,
 *              and every route of that module answers 404 rather than 403: "not here" must never
 *              degrade into "not allowed", or a member could enumerate what a community did not buy.
 *
 * Then each flag is FLIPPED back on for the throwaway tenant and the surface reappears without a
 * redeploy, bounded by the flags cache window, with the ROWS UNTOUCHED — a module flag hides a
 * product, it does not delete anything.
 *
 * A PER-RUN host for the throwaway half (03-05's finding): both the web tier and the API cache the
 * host → tenant mapping for about a minute, so reusing a host points a fresh session at a tenant
 * that was just deleted.
 *
 * `serviceWorkers: 'block'` (the 03-05 lesson): a registered Serwist worker can answer a navigation
 * from its own cache, and a spec asserting what the SERVER rendered for a given flag state would
 * then be asserting what a previous run left behind.
 *
 * **What this spec deliberately does not prove**, carried to the phase UAT rather than silently
 * counted as passing: the story viewer's real media decode timing on a physical device, the
 * installed-PWA behaviour of any Phase 5 surface (both blocked on the deferred cloud phase 01.1),
 * and the swipe gestures on real iOS and Android hardware.
 */

test.describe.configure({ mode: 'serial', timeout: 300_000 });
test.skip(isRemote, 'local stack only (seeded tria-demo, a throwaway tenant, direct DB fixtures)');
test.use({ serviceWorkers: 'block' });

/** The catalog is the source of copy (UI-SPEC Copywriting Contract) — never a literal in a spec. */
const S = storyMessages.stories;
const C = communityMessages.communities;
const APP = appMessages.app;

/** Per-run slug AND host: `tenant-fixtures` bounds the slug at 40 characters. */
const RUN = Date.now().toString(36);

/**
 * `SEED_COMMUNITY_IDS['tria-demo'][0]` — the community `scripts/seed.ts` pins BOTH the expired and
 * an active story to. Mirrored here rather than imported for the reason every other e2e mirrors a
 * seed constant: the seed is a top-level-await script that opens a database connection at import.
 */
const PINNED_COMMUNITY_ID = '0d000000-0000-4000-8000-0000000000c1';
const OFF_PASSWORD = 'Segredo123';

let off: EmptyFeedTenant | null = null;
let offApi: ApiFetch | null = null;

/** The stories strip's region, named by its catalog `aria-label` — a copy drift fails here. */
function strip(page: Page): Locator {
  return page.getByRole('list', { name: S.region });
}

/** The visible navigation (bottom on the phone, rail on the desktop). */
function visibleNav(page: Page): Locator {
  return page.locator('[data-shell-nav="bottom"]:visible, [data-shell-nav="rail"]:visible');
}

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

/** Every route of each module a member could reach, so the 404 claim covers the whole surface. */
const ROUTES = {
  communities: ['/v1/communities'],
  stories: [
    '/v1/stories',
    '/v1/stories/highlights?communityId=00000000-0000-4000-8000-000000000000',
  ],
} as const;

test.beforeAll(async ({ browser: _browser }, testInfo) => {
  const project = testInfo.project.name.replace(/[^a-z0-9]+/gi, '').toLowerCase();
  const slug = `p5off-${project}-${RUN}`.slice(0, 40);

  // Provisioned with the feed on (the helper's contract); this spec adds Phase 5's two modules so
  // the disabled witnesses below are a tenant that demonstrably COULD have had them.
  off = await createEmptyFeedTenant(slug, OFF_PASSWORD);
  await setTenantModuleFlag(slug, 'communities', true);
  await setTenantModuleFlag(slug, 'stories', true);
  offApi = await apiSession(off.adminEmail, OFF_PASSWORD);
});

test.afterAll(async () => {
  if (off) await deleteEmptyFeedTenant(off.slug);
  await closeFeedAdmin();
  await closeTenantFixtures();
  await closeDomainsAdmin();
  await closeAdmin();
});

test.describe('Phase 5 smoke — communities and stories, each in both directions of its flag', () => {
  test('1. ENABLED: the strip sits above the feed, Comunidades is a tab, and a community page carries its Destaques', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);

    // `stories` contributes a HOME SLOT at order 5 and NO nav entry (UI-D-25/D-80); `communities`
    // contributes a TAB and no home slot (D-55's budget). Asserting both in one place is what keeps
    // the distinction visible.
    await expect(strip(page)).toBeVisible();
    expect(await navLabels(page)).toEqual(['Início', 'Comunidades', 'Reels', 'Perfil']);
    await expect(visibleNav(page).getByRole('link', { name: 'Stories', exact: true })).toHaveCount(
      0,
    );

    // D-68 / STORY-04: the community the seed pinned to carries the Destaques row, and its
    // `SectionTitle` is present exactly because the row is (UI-SPEC E12/empty is the other half,
    // asserted in `comunidades.spec.ts`). The id is the seed's own, because a "first card" would
    // depend on whichever list order a concurrent spec happened to leave behind.
    await page.goto(`${hosts.demo}/comunidades/${PINNED_COMMUNITY_ID}`);
    await expect(page.getByRole('list', { name: C.page.highlights })).toBeVisible();
    await expect(page.getByText(C.page.highlights, { exact: true }).first()).toBeVisible();
  });

  for (const moduleKey of ['communities', 'stories'] as const) {
    test(`2.${moduleKey} DISABLED: the surface is absent, no error card, and every route answers 404`, async ({
      page,
    }) => {
      const tenant = off;
      const api = offApi;
      if (!tenant || !api) throw new Error('the throwaway tenant fixture did not initialise');
      const host = new URL(tenant.origin).hostname;

      await setTenantModuleFlag(tenant.slug, moduleKey, false);
      await expect
        .poll(async () => (await answer(api, ROUTES[moduleKey][0], host)).status, {
          timeout: 35_000,
        })
        .toBe(404);

      await login(page, tenant.adminEmail, OFF_PASSWORD, tenant.origin);

      // The page renders and the module simply is not there. NOT an error card: a module a tenant
      // did not buy is an absence, never a failure (UI E04).
      await expect(page.getByText(APP.error.title, { exact: true })).toHaveCount(0);
      if (moduleKey === 'stories') {
        await expect(strip(page)).toHaveCount(0);
        // The admin would otherwise get the own-circle ALONE (UI-D-26/D-80) — its absence is what
        // makes this assertion about the flag rather than about an empty tenant.
        await expect(page.getByRole('link', { name: S.own.action })).toHaveCount(0);
      } else {
        expect(await navLabels(page)).not.toContain('Comunidades');
      }

      // 404 MODULE_DISABLED on every route of the module. A 403 anywhere here would tell a member
      // the feature exists and is being withheld.
      for (const path of ROUTES[moduleKey]) {
        expect(await answer(api, path, host), path).toEqual({
          status: 404,
          code: 'MODULE_DISABLED',
        });
      }
    });

    test(`3.${moduleKey} the flag flips ON and the surface returns within the cache window — no redeploy`, async ({
      page,
    }) => {
      const tenant = off;
      const api = offApi;
      if (!tenant || !api) throw new Error('the throwaway tenant fixture did not initialise');
      const host = new URL(tenant.origin).hostname;

      const flippedAt = Date.now();
      await setTenantModuleFlag(tenant.slug, moduleKey, true);

      // MODULE_FLAGS_TTL_MS is 30 s; the ceiling is bounded and the OBSERVED delay is annotated,
      // while the assertion itself stays exact (200, not "not 404").
      await expect
        .poll(async () => (await answer(api, ROUTES[moduleKey][0], host)).status, {
          timeout: 35_000,
        })
        .toBe(200);
      test.info().annotations.push({
        type: 'flags-cache',
        description: `${moduleKey} flag visible to the API after ${Date.now() - flippedAt} ms (ceiling 35 s, MODULE_FLAGS_TTL_MS 30 s)`,
      });

      await login(page, tenant.adminEmail, OFF_PASSWORD, tenant.origin);
      if (moduleKey === 'stories') {
        // A tenant with the module on and nothing published: the ADMIN still gets the own-circle
        // alone (UI-D-26/D-80), because it is the only publish door.
        await expect(page.getByRole('link', { name: S.own.action })).toBeVisible();
      } else {
        expect(await navLabels(page)).toContain('Comunidades');
      }
      await expect(page.getByText(APP.error.title, { exact: true })).toHaveCount(0);
    });
  }

  test('4. the rows survived every flip: the seeded tenant is exactly as it was', async ({
    page,
  }) => {
    // A module flag hides a PRODUCT, it never deletes a row — and the tenant the flips did not
    // touch is the control that shows the flips were scoped to their own tenant.
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await expect(strip(page)).toBeVisible();
    expect(await navLabels(page)).toEqual(['Início', 'Comunidades', 'Reels', 'Perfil']);
  });
});
