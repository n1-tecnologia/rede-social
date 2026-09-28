import { expect, type Page, test } from '@playwright/test';
import { MEMBERS_PAGE_SIZE } from '@rede-social/contracts/profiles';
import { closeAdmin, membershipIdFor, stubUnfetchableAvatar } from './admin';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';
import {
  closeMembersAdmin,
  createMembersTenant,
  deleteMembersTenant,
  MEMBERS_TENANT_SIZE,
  type MembersTenant,
  memberName,
  membersTenantSlug,
  sweepMembersTenants,
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

/**
 * PROF-01, the D-02 first-access nudge (03-05 Task 3).
 *
 * Runs against its own throwaway community so nothing here mutates the shared seed: the dismissal
 * is a WRITE (`member_profiles.nudge_dismissed_at`), and a member who has said "Agora não" can
 * never be un-said for the next spec that needs the card.
 */
test.describe('PROF-01 — the D-02 nudge on /inicio', () => {
  // Same reason as the directory states: the PWA service worker would otherwise swallow the
  // interception the forced-failure case depends on.
  test.use({ serviceWorkers: 'block' });

  let tenant: MembersTenant;

  test.beforeAll(async ({ browserName }, testInfo) => {
    test.setTimeout(180_000);
    void browserName;
    tenant = await createMembersTenant(
      membersTenantSlug('mbrn', testInfo.project.name),
      SEED_PASSWORD,
      4,
    );
    // Member 04 gets a photo on top of their bio, so they owe the profile nothing.
    await stubUnfetchableAvatar(tenant.members[3]?.email ?? '');
  });

  test.afterAll(async () => {
    if (tenant) await deleteMembersTenant(tenant.slug);
    await closeMembersAdmin();
    await closeAdmin();
  });

  /** Member 02 has neither a photo nor a bio; member 01 has a bio but no photo; member 04 has both. */
  const nudge = (page: Page) => page.locator('[data-nudge]');

  test('is shown to a member who owes a photo or a bio, between the welcome block and the slots', async ({
    page,
  }) => {
    const neither = tenant.members[1];
    if (!neither) throw new Error('fixture: no second member');
    await login(page, neither.email, tenant.password, tenant.origin);

    await expect(nudge(page)).toBeVisible();
    await expect(page.getByText('Complete seu perfil')).toBeVisible();
    await expect(
      // UI-D-46: the word is dropped rather than replaced — the nudge renders directly above the
      // Phase 5 stories strip, where "a comunidade" would read as the container.
      page.getByText('Adicione uma foto e uma bio para as pessoas te reconhecerem.'),
    ).toBeVisible();

    // One visible dismissal only — no second affordance for the same action (no X glyph).
    await expect(page.locator('main').getByRole('button', { name: 'Agora não' })).toHaveCount(1);

    // It is a CARD in the page, not a modal: the page behind it is fully reachable.
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // It sits between the welcome block and the slot area, and does NOT suppress the "Em breve"
    // empty state that stands in for the (still empty) module slots.
    const order = await page
      .locator('main h1, main [data-nudge], main h3')
      .evaluateAll((els) => els.map((el) => el.tagName.toLowerCase()));
    expect(order[0]).toBe('h1');
    expect(order[1]).toBe('div');
    await expect(page.getByText('Em breve')).toBeVisible();
  });

  test('is shown to a member who has only a bio (E5/partial), and never to one who has both', async ({
    page,
  }) => {
    const onlyBio = tenant.members[0];
    const complete = tenant.members[3];
    if (!onlyBio || !complete) throw new Error('fixture: missing members');

    await login(page, onlyBio.email, tenant.password, tenant.origin);
    await expect(nudge(page)).toBeVisible();

    await login(page, complete.email, tenant.password, tenant.origin);
    await expect(nudge(page)).toHaveCount(0);
    await expect(page.getByText('Complete seu perfil')).toHaveCount(0);
  });

  test('"Completar perfil" goes to the edit form', async ({ page }) => {
    const neither = tenant.members[1];
    if (!neither) throw new Error('fixture: no second member');
    await login(page, neither.email, tenant.password, tenant.origin);

    await nudge(page).getByRole('link', { name: 'Completar perfil' }).click();
    await expect(page).toHaveURL(/\/perfil\/editar$/);
  });

  test('"Agora não" writes server state: it is gone on a NEW browser context too (R-13)', async ({
    page,
    browser,
  }) => {
    const member = tenant.members[2];
    if (!member) throw new Error('fixture: no third member');

    await login(page, member.email, tenant.password, tenant.origin);
    await expect(nudge(page)).toBeVisible();

    await page.getByRole('button', { name: 'Agora não' }).click();
    await expect(nudge(page)).toHaveCount(0);

    // A different browser context is a different device with different storage — the card must stay
    // gone, which only server state can deliver.
    const fresh = await browser.newContext();
    try {
      const other = await fresh.newPage();
      await login(other, member.email, tenant.password, tenant.origin);
      await expect(other.locator('[data-nudge]')).toHaveCount(0);
      await expect(other.getByText('Complete seu perfil')).toHaveCount(0);
    } finally {
      await fresh.close();
    }
  });

  test('a FAILED dismissal keeps the card and says so — it never vanishes silently (E5/error)', async ({
    page,
  }) => {
    const member = tenant.members[0];
    if (!member) throw new Error('fixture: no first member');

    await login(page, member.email, tenant.password, tenant.origin);
    await expect(nudge(page)).toBeVisible();

    // The API call (`POST /v1/me/profile/dismiss-nudge`) is made by the Next server, so it cannot be
    // intercepted from the browser; the server ACTION that wraps it posts to the current URL, and
    // failing that is the same failure from the member's side.
    await page.route(/\/inicio/, async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 500, contentType: 'text/plain', body: 'forced failure' });
        return;
      }
      await route.continue();
    });

    await page.getByRole('button', { name: 'Agora não' }).click();

    // (a) it is STILL THERE — no optimistic removal that would reappear on the next load…
    await expect(nudge(page)).toBeVisible();
    // …(b) and the failure is surfaced rather than swallowed.
    await expect(page.getByText('Algo deu errado. Tente novamente.')).toBeVisible();

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    // The dismissal never happened, so a reload still shows the card.
    await page.reload();
    await expect(nudge(page)).toBeVisible();
  });
});
