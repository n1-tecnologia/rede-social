import { expect, test } from '@playwright/test';
import {
  closeAdmin,
  createMember,
  deleteUserByEmail,
  removeMembership,
  setMembershipStatus,
} from './admin';

/**
 * AUTH-06 / D-09 on a phone viewport (`mobile-chromium`): blocking a membership cuts the member off on
 * the VERY NEXT request — no redeploy, no re-login, no waiting for the access token to expire. That is
 * only true because `requireAuth` reads the membership per request and caches nothing; this spec is
 * what keeps a future "let's cache the membership for 30 s" from shipping unnoticed.
 */

test.describe.configure({ timeout: 120_000 });

const PASSWORD = 'Segredo123';
const SUSPENDED = 'Seu acesso a TRIA Demo foi suspenso. Fale com a equipe.';

const email = `e2e-blocked-${Date.now()}@tria-demo.local`;

test.beforeAll(async () => {
  await createMember(email, PASSWORD, 'tria-demo');
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

  // 3. The very next request is refused and the device is signed out.
  await page.goto('/inicio');
  await expect(page).toHaveURL(/\/acesso-suspenso\?t=TRIA%20Demo$/, { timeout: 30_000 });
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
  await expect(page.getByRole('heading', { level: 1 })).toContainText('TRIA Demo', {
    timeout: 20_000,
  });
});

test('orphan identity — a session with no membership lands on /sem-comunidade', async ({
  page,
}) => {
  const orphan = `e2e-orphan-${Date.now()}@tria-demo.local`;
  await createMember(orphan, PASSWORD, 'tria-demo');

  await page.goto('/entrar');
  await page.locator('#email').fill(orphan);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });

  // The membership disappears (moderation, a failed fixture, a manual fix) but the session lives on.
  await removeMembership(orphan);

  await page.goto('/inicio');
  await expect(page).toHaveURL(/\/sem-comunidade$/, { timeout: 30_000 });
  await expect(page.getByText('Sua conta ainda não pertence a uma comunidade.')).toBeVisible();
  // Tenant host (D-22): the sign-up link carries no slug.
  await expect(page.getByRole('link', { name: 'Cadastrar em TRIA Demo' })).toHaveAttribute(
    'href',
    '/cadastro',
  );

  await deleteUserByEmail(orphan);
});
