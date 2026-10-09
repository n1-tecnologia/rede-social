import { expect, test } from '@playwright/test';
import {
  closeAdmin,
  createMember,
  deleteUserByEmail,
  memberAccessAs,
  membershipIdFor,
  removeMembership,
  setMembershipStatus,
} from './admin';
import { hosts, SEED_PASSWORD, users } from './fixtures';

/**
 * AUTH-06 / D-09 on a phone viewport (`mobile-chromium`): blocking a membership cuts the member off on
 * the VERY NEXT request — no redeploy, no re-login, no waiting for the access token to expire. That is
 * only true because `requireAuth` reads the membership per request and caches nothing; this spec is
 * what keeps a future "let's cache the membership for 30 s" from shipping unnoticed.
 */

test.describe.configure({ timeout: 120_000 });

const PASSWORD = 'Segredo123';
const SUSPENDED = 'Seu acesso a Rede Demo foi suspenso. Fale com a equipe.';

const email = `e2e-blocked-${Date.now()}@rede-demo.local`;

test.beforeAll(async () => {
  await createMember(email, PASSWORD, 'rede-demo');
});

test.afterAll(async () => {
  await deleteUserByEmail(email);
  await closeAdmin();
});

test('AUTH-06/D-09 — blocked on the next request, session cleared, same screen on re-login', async ({
  page,
  context,
}) => {
  // 1. Normal member.
  await page.goto('/entrar');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });

  // 2. The tenant's admin blocks the membership while the member's token is still perfectly valid.
  await setMembershipStatus(email, 'blocked');

  // 3. The very next request is refused and the device is signed out. The Início left open in
  // step 1 may get there first: one of its background server actions (the media playback-token
  // mint) receives the 403 and redirects the page to the blocked flow at the same moment, which
  // aborts this goto (08.1 deferred item, seen on both projects in the 08.2-12 gate). Either way the
  // device must end on the suspended screen, which the next line asserts.
  await page.goto('/inicio').catch((error: Error) => {
    if (!error.message.includes('net::ERR_ABORTED')) throw error;
  });
  await expect(page).toHaveURL(/\/acesso-suspenso\?t=Rede%20Demo$/, { timeout: 30_000 });
  await expect(page.getByText(SUSPENDED)).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/motivo/i);
  expect((await context.cookies()).filter((c) => c.name.startsWith('sb-'))).toHaveLength(0);

  // 4. The session really is gone.
  await page.goto('/inicio');
  await expect(page).toHaveURL(/\/entrar$/, { timeout: 30_000 });

  // 5. Logging in again succeeds at Supabase level and lands on the same screen (D-09).
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/acesso-suspenso/, { timeout: 30_000 });
  await expect(page.getByText(SUSPENDED)).toBeVisible();

  // 6. Unblocking is equally immediate.
  await setMembershipStatus(email, 'active');
  await page.goto('/entrar');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
  // Início has no visible welcome block (2026-10-01): its one h1 is the screen-reader "Início", and
  // the tenant shows in the shell's home link (TopBar on the phone, rail on desktop), named by the
  // logo's alt (or by the name itself without a logo).
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Início', { timeout: 20_000 });
  await expect(page.locator('[data-shell-brand]:visible')).toHaveAccessibleName('Rede Demo');
});

test('orphan identity — offered to join on its tenant host (08.1 D-305), /sem-comunidade on a generic host', async ({
  page,
  browser,
}) => {
  const orphan = `e2e-orphan-${Date.now()}@rede-demo.local`;
  await createMember(orphan, PASSWORD, 'rede-demo');

  await page.goto('/entrar');
  await page.locator('#email').fill(orphan);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });

  // The membership disappears (moderation, a failed fixture, a manual fix) but the session lives on.
  await removeMembership(orphan);

  // 08.1 (D-305, D-307): on a TENANT host a session with no membership there is offered to join it —
  // the host's community only, never an error boundary.
  await page.goto('/inicio');
  await expect(page).toHaveURL(/\/participar$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Participar de Rede Demo');

  // On a GENERIC host there is no community to offer: NO_MEMBERSHIP -> /sem-comunidade.
  const generic = await browser.newContext();
  const genericPage = await generic.newPage();
  await genericPage.goto(`${hosts.generic}/entrar`);
  await genericPage.locator('#email').fill(orphan);
  await genericPage.locator('#password').fill(PASSWORD);
  await genericPage.getByRole('button', { name: 'Entrar' }).click();
  await expect(genericPage).toHaveURL(/\/sem-comunidade$/, { timeout: 30_000 });
  await expect(
    genericPage.getByText('Sua conta ainda não pertence a uma comunidade.'),
  ).toBeVisible();
  await generic.close();

  await deleteUserByEmail(orphan);
});

/**
 * 08-04 (MODER-02 "revoked immediately", T-08-24): the member has `/inicio` OPEN when the admin blocks
 * them through the real API. The kernel emits `membership.blocked`, the notifications subscriber
 * publishes `notifications.changed` on the member's user topic, the open shell refetches its
 * counters, the BFF answers 403 `MEMBERSHIP_BLOCKED` with the blocked flow's path, and the page lands
 * on "Acesso suspenso" within 15 s — with no manual reload. Unblocking and signing in again restores.
 */
test('blocked by an admin with the app open', async ({ page }) => {
  const live = `e2e-blocked-live-${Date.now()}@rede-demo.local`;
  await createMember(live, PASSWORD, 'rede-demo');
  const membershipId = await membershipIdFor(live, 'rede-demo');
  try {
    await page.goto('/entrar');
    await page.locator('#email').fill(live);
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
    // Let the shell's Realtime join settle (its first SUBSCRIBED refetches the counters).
    await page.waitForLoadState('networkidle');

    await memberAccessAs(users.demoAdmin, SEED_PASSWORD, membershipId, 'block');

    // No reload, no navigation by the test: the open app gets there on its own.
    await expect(page).toHaveURL(/\/acesso-suspenso\?t=Rede%20Demo$/, { timeout: 15_000 });
    await expect(page.getByText(SUSPENDED)).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/motivo/i);

    await memberAccessAs(users.demoAdmin, SEED_PASSWORD, membershipId, 'unblock');
    await page.goto('/entrar');
    await page.locator('#email').fill(live);
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
    await page.reload();
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
  } finally {
    await deleteUserByEmail(live);
  }
});
