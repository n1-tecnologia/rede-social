import { expect, type Page, test } from '@playwright/test';
import { MEMBERS_PAGE_SIZE } from '@rede-social/contracts/profiles';
import { PROFILE_NUDGE_KEY } from '../lib/profile-nudge';
import appMessages from '../messages/pt-BR/app.json' with { type: 'json' };
import profileMessages from '../messages/pt-BR/profile.json' with { type: 'json' };
import { closeAdmin, membershipIdFor, stubUnfetchableAvatar } from './admin';
import { apiSession } from './domains-admin';
import { hosts, login, SEED_PASSWORD, signOut, users } from './fixtures';
import {
  closeMembersAdmin,
  createMembersTenant,
  deleteMembersTenant,
  MEMBERS_TENANT_SIZE,
  type MembersTenant,
  memberName,
  membersTenantSlug,
  sweepMembersTenants,
  type ThrowawayMember,
} from './members-admin';

/**
 * PROF-02 / PROF-03 (plan 03-05): the member directory `/membros` and another member's profile
 * `/membros/[membershipId]`, on the phone (`mobile-chromium`, an iPhone 14 preset) and on the
 * desktop.
 *
 * Everything here runs against the SEEDED `rede-demo` community, which `scripts/seed.ts` fills with
 * names that actually need folding (`João Gonçalves`, `Íris Muñoz`) — a search suite over ASCII-only
 * data would prove nothing about `app.imm_unaccent`. Nothing in this file writes: it only reads the
 * directory, so the shared seed stays exactly as it was.
 */

/** What `scripts/seed.ts` writes for the demo tenant. */
const SEEDED = {
  goncalves: 'João Gonçalves',
  goncalvesBio: 'Organizo os encontros de sábado.',
  goncalvesEmail: 'joao.goncalves@rede-demo.local',
  munoz: 'Íris Muñoz',
  admin: 'Admin Rede Demo',
  noBio: 'Ana Paula Ferreira',
} as const;

/** The search pill — named by its catalog `aria-label`, so a copy drift fails here. */
function searchField(page: Page) {
  return page.getByLabel('Buscar por nome');
}

/** Every directory row is ONE link to `/membros/{id}` (the whole row is the target). */
function rows(page: Page) {
  return page.locator('main a[href^="/membros/"]');
}

/**
 * Holds the RSC fetch a SEARCH triggers for `ms`, so the list's pending state is observable instead
 * of being a race against a round trip that normally takes milliseconds.
 *
 * Only the `?q=` navigation is delayed, and only that one can be: Next prefetches the plain
 * `/membros` link, so by the time a member clicks "Membros" on `/perfil` the payload is already in
 * the router cache and the route-level `loading.tsx` never renders. A query URL is never
 * prefetched. The eight-row SHAPE both loading states share is pinned in
 * `app/(app)/membros/MembersList.test.ts`.
 */
async function delaySearchNavigation(page: Page, ms: number): Promise<void> {
  await page.route(/\/membros\?/, async (route) => {
    if (route.request().url().includes('q=')) await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

/** Holds the `loadMoreMembersAction` POST for `ms` (the server action posts to the current URL). */
async function delayDirectoryAction(page: Page, ms: number): Promise<void> {
  await page.route(/\/membros/, async (route) => {
    if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

/** Answers the `loadMoreMembersAction` POST with a 500 — the forced list failure (E4/error). */
async function failDirectoryAction(page: Page): Promise<void> {
  await page.route(/\/membros/, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'forced failure' });
      return;
    }
    await route.continue();
  });
}

test.describe('PROF-03 — the member directory /membros', () => {
  test.afterAll(async () => {
    await closeAdmin();
  });

  test('is reached from the "Membros" row on /perfil and hides the community staff (D-47)', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil');
    await page.locator('main').getByRole('link', { name: 'Membros' }).click();

    await expect(page).toHaveURL(/\/membros$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Membros' })).toBeVisible();

    // The seeded community members are all there…
    await expect(page.locator('main').getByText(SEEDED.goncalves)).toBeVisible();
    await expect(page.locator('main').getByText(SEEDED.munoz)).toBeVisible();
    await expect(rows(page).first()).toBeVisible();

    // …and the tenant's ADMIN is not: staff are excluded by predicate, so their absence carries no
    // signal and no row is conditioned on a role (D-45/D-47, T-03-35).
    await expect(page.locator('main').getByText(SEEDED.admin)).toHaveCount(0);
    await expect(page.locator('main').getByText(/^(Administrador|Suporte)$/)).toHaveCount(0);

    // A member without a bio renders a single-line row — no invented placeholder (E4/partial).
    await expect(page.locator('main').getByText(SEEDED.noBio)).toBeVisible();
  });

  test('an unaccented fragment finds an accented name, and the query lives in the URL (R-10)', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/membros');
    await expect(rows(page).first()).toBeVisible();
    const before = await rows(page).count();
    expect(before).toBeGreaterThan(1);

    await searchField(page).fill('goncal');

    // The debounce writes the term into the URL; the URL is the source of truth, not the field.
    await expect(page).toHaveURL(/\?q=goncal$/);
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator('main').getByText(SEEDED.goncalves)).toBeVisible();

    // The directory makes no promise of highlighting, and keeps none: the name is plain text.
    await expect(page.locator('main mark')).toHaveCount(0);

    // "Limpar busca" restores the full list and drops `q` from the URL entirely.
    await page.getByRole('button', { name: 'Limpar busca' }).click();
    await expect(page).toHaveURL(/\/membros$/);
    await expect(rows(page)).toHaveCount(before);
  });
});

test.describe('PROF-02 — another member at /membros/[membershipId]', () => {
  test.afterAll(async () => {
    await closeAdmin();
  });

  test('opens from the directory row and shows a photo, a name and a bio — nothing else (D-45)', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/membros?q=goncal');
    await expect(rows(page).first()).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
    await rows(page).first().click();

    await expect(page).toHaveURL(/\/membros\/[0-9a-f-]{36}$/);

    // The display name is the screen's ONE 24px element and its ONE h1.
    const name = page.locator('main .text-2xl');
    await expect(name).toHaveCount(1);
    await expect(name).toHaveText(SEEDED.goncalves);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(SEEDED.goncalves);

    await expect(page.locator('main').getByText(SEEDED.goncalvesBio)).toBeVisible();

    // No e-mail (D-46: the e-mail is the owner's identity anchor, never a member-visible fact),
    // no role word, no follow or message affordance.
    const main = page.locator('main');
    await expect(main.getByText(SEEDED.goncalvesEmail)).toHaveCount(0);
    await expect(main.getByText(/@rede-demo\.local/)).toHaveCount(0);
    await expect(main.getByText(/^(Administrador|Membro|Suporte)$/)).toHaveCount(0);
    await expect(main.getByRole('button', { name: /Seguir|Mensagem/ })).toHaveCount(0);
  });

  test("the caller's own membershipId redirects to /perfil (UI-D-03)", async ({ page }) => {
    const own = await membershipIdFor(users.demoMember, 'rede-demo');

    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`/membros/${own}`);

    await expect(page).toHaveURL(/\/perfil$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Perfil' })).toBeVisible();
  });
});

/**
 * The directory's STATES (03-05 Task 2), against a THROWAWAY community big enough to have a real
 * second page. The seeded `rede-demo` has nine members, so the keyset button never appears there —
 * a paging bug would ship invisibly. Here the tenant has 27 active members, one blocked, one
 * soft-deleted and an admin, all created and torn down by `members-admin.ts`.
 *
 * The tenant is per-PROJECT: both Playwright projects run this whole file, and the web and API each
 * cache a host→tenant mapping for 60 s, so re-creating one slug under a new tenant id mid-run would
 * flake. Two slugs, two hosts, no shared cache entry.
 */
test.describe('PROF-03 — the directory states over a 27-member community', () => {
  // The PWA's service worker handles navigations itself, and a request a service worker makes is
  // outside `page.route`'s reach — so without this every GET interception below silently no-ops and
  // the timing-dependent assertions pass or fail by luck. POSTs (the server actions) are unaffected.
  test.use({ serviceWorkers: 'block' });

  let big: MembersTenant;
  let empty: MembersTenant;

  test.beforeAll(async ({ browserName }, testInfo) => {
    test.setTimeout(240_000);
    void browserName;
    await sweepMembersTenants('mbr');
    big = await createMembersTenant(membersTenantSlug('mbr', testInfo.project.name), SEED_PASSWORD);
    empty = await createMembersTenant(
      membersTenantSlug('mbrv', testInfo.project.name),
      SEED_PASSWORD,
      0,
    );
  });

  test.afterAll(async () => {
    if (big) await deleteMembersTenant(big.slug);
    if (empty) await deleteMembersTenant(empty.slug);
    await closeMembersAdmin();
    await closeAdmin();
  });

  test('"Carregar mais" appends a real second page without duplicating, skipping or re-ordering', async ({
    page,
  }) => {
    await login(page, big.caller.email, big.password, big.origin);
    await page.goto(`${big.origin}/membros`);
    await expect(rows(page).first()).toBeVisible();

    // Page one is exactly the contract's page size.
    await expect(rows(page)).toHaveCount(MEMBERS_PAGE_SIZE);
    const firstPage = await rows(page).evaluateAll((els) =>
      els.map((el) => (el as HTMLAnchorElement).getAttribute('href') ?? ''),
    );

    const more = page.getByRole('button', { name: 'Carregar mais' });
    await expect(more).toBeVisible();
    await more.click();

    await expect(rows(page)).toHaveCount(MEMBERS_TENANT_SIZE);
    // The cursor is exhausted, so the button is gone — it is never rendered to return nothing.
    await expect(more).toHaveCount(0);

    const bothPages = await rows(page).evaluateAll((els) =>
      els.map((el) => (el as HTMLAnchorElement).getAttribute('href') ?? ''),
    );

    // APPEND, not replace: the first 25 rows kept their order AND their DOM position.
    expect(bothPages.slice(0, MEMBERS_PAGE_SIZE)).toEqual(firstPage);
    // No id appears twice across the two pages…
    expect(new Set(bothPages).size).toBe(MEMBERS_TENANT_SIZE);
    // …and none of the tenant's active members is missing from the union.
    expect(new Set(bothPages)).toEqual(
      new Set(big.members.map((m) => `/membros/${m.membershipId}`)),
    );
  });

  test('a debounced query change renders exactly 8 skeleton rows over the previous list', async ({
    page,
  }) => {
    await login(page, big.caller.email, big.password, big.origin);
    await page.goto(`${big.origin}/membros`);
    await expect(rows(page)).toHaveCount(MEMBERS_PAGE_SIZE);

    await delaySearchNavigation(page, 2_000);
    await searchField(page).fill('membro 1');

    // Exactly eight, and the previous query's rows are gone rather than lingering under them.
    await expect(page.getByTestId('members-skeleton').locator('> div')).toHaveCount(8);
    await expect(rows(page)).toHaveCount(0);

    await expect(page).toHaveURL(/\?q=membro\+1$/);
    await expect(rows(page)).toHaveCount(10);
    await expect(page.getByTestId('members-skeleton')).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('while "Carregar mais" is pending it says "Carregando…" and keeps the rows visible', async ({
    page,
  }) => {
    await login(page, big.caller.email, big.password, big.origin);
    await page.goto(`${big.origin}/membros`);
    await expect(rows(page)).toHaveCount(MEMBERS_PAGE_SIZE);

    await delayDirectoryAction(page, 1_500);
    await page.getByRole('button', { name: 'Carregar mais' }).click();

    await expect(page.getByRole('button', { name: 'Carregando…' })).toBeVisible();
    // The existing rows are NOT replaced by skeletons while the next page loads.
    await expect(rows(page)).toHaveCount(MEMBERS_PAGE_SIZE);
    await expect(page.getByTestId('members-skeleton')).toHaveCount(0);

    await expect(rows(page)).toHaveCount(MEMBERS_TENANT_SIZE);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('the two empty states are distinct screens, not one string with a condition', async ({
    page,
  }) => {
    await login(page, big.caller.email, big.password, big.origin);

    // A query that matches nothing, in a community that HAS members.
    await page.goto(`${big.origin}/membros?q=zzzznaoexiste`);
    await expect(page.getByText('Nenhum membro encontrado')).toBeVisible();
    await expect(page.getByText('Tente outro nome.')).toBeVisible();
    await expect(page.getByText('Nenhum membro ainda')).toHaveCount(0);

    // A community whose only membership is the caller's own admin seat (excluded by D-47).
    await login(page, empty.caller.email, empty.password, empty.origin);
    await page.goto(`${empty.origin}/membros`);
    await expect(page.getByText('Nenhum membro ainda')).toBeVisible();
    await expect(
      // UI-D-46: the empty state names the tenant instead of saying "a comunidade".
      page.getByText(
        `Quando outras pessoas entrarem em Comunidade ${empty.slug}, elas aparecem aqui.`,
      ),
    ).toBeVisible();
    await expect(page.getByText('Nenhum membro encontrado')).toHaveCount(0);
  });

  test('a failed list request renders the generic error, and "Tentar novamente" re-issues it', async ({
    page,
  }) => {
    await login(page, big.caller.email, big.password, big.origin);
    await page.goto(`${big.origin}/membros`);
    await expect(rows(page)).toHaveCount(MEMBERS_PAGE_SIZE);

    await failDirectoryAction(page);
    await page.getByRole('button', { name: 'Carregar mais' }).click();

    await expect(page.getByText('Algo deu errado. Tente novamente.')).toBeVisible();
    const retry = page.getByRole('button', { name: 'Tentar novamente' });
    await expect(retry).toBeVisible();
    // The rows already on screen survive the failure.
    await expect(rows(page)).toHaveCount(MEMBERS_PAGE_SIZE);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await retry.click();
    await expect(rows(page)).toHaveCount(MEMBERS_TENANT_SIZE);
    await expect(page.getByText('Algo deu errado. Tente novamente.')).toHaveCount(0);
  });

  test('a member without a bio keeps a one-line row, and long values truncate inside it', async ({
    page,
  }) => {
    await login(page, big.caller.email, big.password, big.origin);
    await page.goto(`${big.origin}/membros`);
    await expect(rows(page).first()).toBeVisible();

    // Member 02 has no bio: the second span is not rendered and the row still measures 56px.
    const withoutBio = rows(page).filter({ hasText: memberName(2) });
    await expect(withoutBio.locator('span.truncate')).toHaveCount(1);
    const box = await withoutBio.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(56);

    // Member 01 carries the longest name and bio the edit form can produce (60 / 150 characters).
    const longest = rows(page).first();
    const spans = await longest.locator('span.truncate').evaluateAll((els) =>
      els.map((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
        height: el.clientHeight,
        lineHeight: Number.parseFloat(getComputedStyle(el).lineHeight),
      })),
    );
    expect(spans).toHaveLength(2);

    // Neither line WRAPS — whatever the column's width, the row stays the height of one line each,
    // which is what keeps the list scannable and `min-h-14` honest.
    for (const span of spans) expect(span.height).toBeLessThan(span.lineHeight * 2);

    // The 150-character bio is longer than the column at EVERY breakpoint, so it really is clipped
    // rather than merely marked `truncate`. The 60-character name is only longer than the column on
    // the phone: on the 680px desktop column it fits, and asserting otherwise would be asserting
    // that the desktop layout is too narrow for a value the form explicitly allows.
    const [, bio] = spans;
    expect(bio?.scroll ?? 0).toBeGreaterThan(bio?.client ?? 0);

    // Nothing highlights the matched substring — the directory never promised to.
    await searchField(page).fill('membro 01');
    await expect(page).toHaveURL(/\?q=membro\+01$/);
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator('main mark')).toHaveCount(0);
  });

  test('the result count is announced politely, in the singular and in the plural', async ({
    page,
  }) => {
    await login(page, big.caller.email, big.password, big.origin);
    await page.goto(`${big.origin}/membros`);
    await expect(rows(page).first()).toBeVisible();

    const live = page.getByTestId('members-count');
    await expect(live).toHaveAttribute('aria-live', 'polite');

    await searchField(page).fill(memberName(5));
    await expect(rows(page)).toHaveCount(1);
    await expect(live).toHaveText('1 membro encontrado');

    await searchField(page).fill('membro 1');
    await expect(rows(page)).toHaveCount(10);
    await expect(live).toHaveText('10 membros encontrados');
  });

  test('every miss is ONE screen that never names the other community (D-23, TENANT-04)', async ({
    page,
  }) => {
    const foreign = await membershipIdFor(users.labMember, 'rede-lab');
    const misses = [
      ['an unknown uuid', '11111111-1111-4111-8111-111111111111'],
      ['an id that is not a uuid at all', 'nao-e-um-id'],
      ["another tenant's membership", foreign],
      ['a blocked membership', big.blocked.membershipId],
      ['a soft-deleted membership', big.softDeleted.membershipId],
    ] as const;

    await login(page, big.caller.email, big.password, big.origin);

    for (const [reason, id] of misses) {
      await page.goto(`${big.origin}/membros/${id}`);

      await expect(page.getByText('Membro não encontrado'), reason).toBeVisible();
      // UI-D-46: the one 404 body names the tenant. It is host-derived and therefore identical
      // across all five causes in `misses`, so it stays a single indistinguishable answer (D-23).
      await expect(
        page.getByText(`Esta pessoa não faz parte de Comunidade ${big.slug}.`),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'Voltar para membros' })).toHaveAttribute(
        'href',
        '/membros',
      );

      // The screen never tells the member WHY, and never names the community they reached into.
      const text = (await page.locator('body').innerText()).toLowerCase();
      expect(text).not.toContain('rede-lab');
      expect(text).not.toContain('membro rede-social lab');
      expect(text).not.toContain('bloquead');
      expect(text).not.toContain(big.blocked.displayName.toLowerCase());
      expect(text).not.toContain(big.softDeleted.displayName.toLowerCase());
    }
  });
});

/** PROF-01's copy comes from the catalog, never a literal: a copy edit cannot outrun the spec. */
const APP = appMessages.app;
const PROFILE = profileMessages.profile;

/**
 * PROF-01, the D-02 profile nudge (03-05 Task 3) as the "Complete seu perfil" POPUP: a product
 * decision of 2026-10-02 amends D-02's "a card, never a modal", after the reference app
 * (`socialroberth-completo`, `ConviteCompletarPerfil`). It rises over Início 500 ms after a member
 * ARRIVES, for as long as the server's `needsNudge` holds, and either answer ends it for the visit
 * (sessionStorage, `lib/profile-nudge.ts`) until the next SUBMITTED sign-in. No answer writes to
 * the database any more, so the card's server-dismissal and failed-dismissal cases have nothing
 * left to assert; what stays is that a dismissal the card once wrote still keeps the popup away
 * (the last case, through the API route the card's action wrapped).
 *
 * `login()` keeps the popup out of the specs that sign in through it (`withoutProfileNudge`); these
 * sign in with `{ profileNudge: true }`. A spec that signs in by hand never gets that guard, and a
 * context opened from a saved storage state starts without it (it lives on the page's context):
 * either lands on Início WITH the popup up for a member who owes a photo or a bio, so such a spec
 * calls `withoutProfileNudge(page)` itself before it taps anything there (the ones today only read
 * Início, never tap behind the popup). PROF-01 runs against its own throwaway community: the
 * profiles are fixtures (no bio, a bio, a photo stub, a server dismissal), and the seeded community
 * is shared by the whole suite.
 */
test.describe('PROF-01 — the D-02 "Complete seu perfil" popup over /inicio', () => {
  let tenant: MembersTenant;

  test.beforeAll(async ({ browserName }, testInfo) => {
    test.setTimeout(180_000);
    void browserName;
    tenant = await createMembersTenant(
      membersTenantSlug('mbrn', testInfo.project.name),
      SEED_PASSWORD,
      5,
    );
    // Member 04 gets a photo on top of their bio, so they owe the profile nothing.
    await stubUnfetchableAvatar(tenant.members[3]?.email ?? '');
  });

  test.afterAll(async () => {
    if (tenant) await deleteMembersTenant(tenant.slug);
    await closeMembersAdmin();
    await closeAdmin();
  });

  /**
   * Member 02 has neither a photo nor a bio; members 01, 03 and 05 have a bio but no photo; member
   * 04 has both. Member 05 belongs to the last case alone, which dismisses the old card for good.
   */
  const member = (index: number): ThrowawayMember => {
    const found = tenant.members[index];
    if (!found) throw new Error(`fixture: no member at index ${index}`);
    return found;
  };
  /** Signs in WITH the popup: `login()` keeps it out of the other specs that sign in through it. */
  const enter = (page: Page, who: ThrowawayMember) =>
    login(page, who.email, tenant.password, tenant.origin, '/inicio', { profileNudge: true });
  const popup = (page: Page) => page.getByRole('dialog', { name: PROFILE.nudge.title });
  const answer = (page: Page, name: string) =>
    popup(page).getByRole('button', { name, exact: true });
  /** The visit's answer, as the app reads it: the membership id of whoever answered, or null. */
  const visitMark = (page: Page) =>
    page.evaluate((key) => window.sessionStorage.getItem(key), PROFILE_NUDGE_KEY);
  /** Well past the popup's 500 ms, so that its absence means something. */
  const settle = (page: Page) => page.waitForTimeout(1_500);

  test('rises over Início on arrival, as a modal, for a member who owes a photo and a bio', async ({
    page,
  }, testInfo) => {
    await enter(page, member(1));

    const dialog = popup(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(PROFILE.nudge.body);
    await expect(answer(page, PROFILE.nudge.action)).toBeVisible();
    await expect(answer(page, PROFILE.nudge.dismiss)).toBeVisible();
    // The focus starts on "Completar agora".
    await expect(answer(page, PROFILE.nudge.action)).toBeFocused();
    // The 03-05 card in the page is gone: the popup is the only nudge, and it sits OVER the page
    // rather than replacing it (this community has no module slots, so Início reads "Em breve").
    await expect(page.locator('[data-nudge]')).toHaveCount(0);
    await expect(page.getByText(APP.home.soonTitle, { exact: true })).toBeVisible();

    // A modal: tokens.css takes the BottomNav away under any `aria-modal` (on the desktop the bar
    // is `md:hidden` anyway, so the phone is where this proves something)...
    const bottomNav = page.locator('[data-shell-nav="bottom"]');
    await expect(bottomNav).toBeHidden();
    // ...and Escape is "Mais tarde": the popup goes and the BottomNav comes back.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    if (testInfo.project.name === 'mobile-chromium') await expect(bottomNav).toBeVisible();
  });

  test('rises for a member with only a bio (E5/partial), and never for one who has both', async ({
    page,
  }) => {
    await enter(page, member(0));
    await expect(popup(page)).toBeVisible();

    await enter(page, member(3));
    await settle(page);
    await expect(popup(page)).toHaveCount(0);
    await expect(page.getByText(PROFILE.nudge.title)).toHaveCount(0);
  });

  test('"Completar agora" opens the edit form and ends the popup for the visit', async ({
    page,
  }) => {
    const who = member(1);
    await enter(page, who);

    await answer(page, PROFILE.nudge.action).click();
    await expect(page).toHaveURL(/\/perfil\/editar$/);
    await expect.poll(() => visitMark(page)).toBe(who.membershipId);

    await page.goto(`${tenant.origin}/inicio`);
    await settle(page);
    await expect(popup(page)).toHaveCount(0);
  });

  test('"Mais tarde" closes it for the visit, and only the next sign-in brings it back', async ({
    page,
  }) => {
    const who = member(2);
    await enter(page, who);

    await answer(page, PROFILE.nudge.dismiss).click();
    await expect(popup(page)).toHaveCount(0);
    // The visit remembers who answered.
    await expect.poll(() => visitMark(page)).toBe(who.membershipId);

    // Back lands on /entrar (the sign-in's redirect is a history push) and only SHOWS the login:
    // the answer stays, so Forward to Início keeps the popup closed.
    await page.goBack();
    await expect(page).toHaveURL(/\/entrar$/);
    await expect(page.locator('#email')).toBeVisible();
    await settle(page);
    expect(await visitMark(page)).toBe(who.membershipId);
    await page.goForward();
    await expect(page).toHaveURL(/\/inicio$/);
    await settle(page);
    await expect(popup(page)).toHaveCount(0);

    // A reload keeps it closed...
    await page.reload();
    await settle(page);
    await expect(popup(page)).toHaveCount(0);

    // ...and so does a round trip through another screen, back to Início by the tab bar.
    await page.goto(`${tenant.origin}/perfil`);
    await page
      .locator('[data-shell-nav="bottom"]:visible, [data-shell-nav="rail"]:visible')
      .getByRole('link', { name: APP.nav.home, exact: true })
      .click();
    await expect(page).toHaveURL(/\/inicio$/);
    await settle(page);
    await expect(popup(page)).toHaveCount(0);

    // Signing out lands on /entrar, which still keeps the answer: only a SUBMITTED sign-in starts a
    // new visit. The next one forgets it, and the popup rises again (which also proves "Mais tarde"
    // wrote no server dismissal).
    await signOut(page, tenant.origin);
    await settle(page);
    expect(await visitMark(page)).toBe(who.membershipId);
    await enter(page, who);
    await expect(popup(page)).toBeVisible();
    expect(await visitMark(page)).toBeNull();
  });

  // LAST: the dismissal is for good, for member 05 (the tenant goes in `afterAll`).
  test('never rises for a member who dismissed the old card: the server flag rules', async ({
    page,
  }) => {
    const who = member(4);
    // What the 03-05 card's "Agora não" posted (`dismissNudgeAction`), through the same API route
    // and as the member, so `needsNudge` turns false the way it did for everyone who answered it.
    const api = await apiSession(who.email, tenant.password);
    const res = await api('/v1/me/profile/dismiss-nudge', { method: 'POST' }, tenant.host);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { needsNudge: boolean }).needsNudge).toBe(false);

    // Início never mounts the popup's host for them, so a sign-in raises nothing.
    await enter(page, who);
    await settle(page);
    await expect(popup(page)).toHaveCount(0);
  });
});
