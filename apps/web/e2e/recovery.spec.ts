import { expect, test } from '@playwright/test';
import { closeAdmin, createMember, deleteUserByEmail } from './admin';
import { hosts, isRemote } from './fixtures';
import { clearMailbox, expectNoRecoveryMail, waitForRecoveryMail } from './mail';

/**
 * AUTH-03 / D-10 password recovery on a phone viewport (`mobile-chromium`), end to end through the
 * local mail catcher: form -> e-mail -> `/auth/confirm` -> `/redefinir-senha` -> signed in.
 *
 * `baseURL` is the tria-demo TENANT host, which is the point of case 3: the link in the e-mail must
 * come back to the host the member actually used, never to `site_url` (D-22).
 *
 * Every case that triggers a send uses its OWN throwaway member: GoTrue throttles recovery e-mails
 * PER USER (`[auth.email] max_frequency`), so two sends for one address inside the same second are
 * answered 429 `over_email_send_rate_limit` — silently, because the action's answer is constant by
 * design (D-10). Sharing one fixture user here would make the suite flaky, not the product.
 */

test.describe.configure({ timeout: 120_000 });

const OLD_PASSWORD = 'Segredo123';
const NEW_PASSWORD = 'NovaSenha123';
const SENT = 'Se existir uma conta com este e-mail, enviamos um link.';

const created: string[] = [];

async function newMember(tag: string): Promise<string> {
  const email = `e2e-recovery-${tag}-${Date.now()}@tria-demo.local`;
  await createMember(email, OLD_PASSWORD, 'tria-demo');
  created.push(email);
  return email;
}

/** Asks for a recovery link from `/esqueci-senha` and asserts the constant D-10 answer. */
async function requestLink(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.goto('/esqueci-senha');
  await page.locator('#email').fill(email);
  await page.getByRole('button', { name: 'Enviar link' }).click();
  await expect(page).toHaveURL(/\/esqueci-senha\?enviado=1$/, { timeout: 30_000 });
  await expect(page.locator('p[role="status"]')).toHaveText(SENT);
}

test.afterAll(async () => {
  for (const email of created) await deleteUserByEmail(email);
  await closeAdmin();
});

test.describe('AUTH-03 — recuperação de senha', () => {
  test('1. a known address gets the constant D-10 answer', async ({ page }) => {
    const email = await newMember('known');
    await page.goto('/esqueci-senha');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Recuperar senha');
    await requestLink(page, email);
  });

  test('2. an unknown address gets exactly the same answer (no enumeration, T-05-02)', async ({
    page,
  }) => {
    await requestLink(page, `nao-existe-${Date.now()}@tria-demo.local`);
  });

  test('3. D-22: the e-mail link returns to the host used, sets a new password and signs in', async ({
    page,
  }) => {
    const email = await newMember('roundtrip');
    // Never read a previous case's (already consumed) link.
    await clearMailbox();
    await requestLink(page, email);

    const link = await waitForRecoveryMail(email);
    // The origin is the tenant host the member used, not `site_url` (http://localhost:3000).
    expect(link.startsWith(`${hosts.demo}/auth/confirm`)).toBe(true);

    await page.goto(link);
    await expect(page).toHaveURL(/\/redefinir-senha$/, { timeout: 30_000 });

    await page.locator('#password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Salvar nova senha' }).click();
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('TRIA Demo', {
      timeout: 20_000,
    });

    // The new password is the one that works from now on.
    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page).toHaveURL(/\/entrar$/);
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
  });

  test('4. T-05-01: an external `next` never leaves the app, even with a bad token', async ({
    page,
  }) => {
    await page.goto('/auth/confirm?token_hash=bogus&type=recovery&next=https://evil.example');
    await expect(page).toHaveURL(/\/esqueci-senha\?erro=link-invalido$/);
    expect(page.url().startsWith(hosts.demo)).toBe(true);
    await expect(page.locator('p[role="alert"]')).toBeVisible();
  });

  test('6. WR-09: a host this deployment does not serve as a tenant/platform gets NO e-mail', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');
    // The action derives the recovery origin from X-Forwarded-Host/Host (D-22). A forged forwarded
    // host from a browser never reaches the action (Next's Server Actions Origin check), but an
    // attacker-sent request whose Host and Origin agree does — classic reset-link host poisoning.
    // Same shape here: `127.0.0.1` reaches the dev server, is neither a registered tenant host nor
    // PLATFORM_HOST nor `*.localhost`, so the action refuses to build a link for it.
    const email = await newMember('unserved-host');
    await clearMailbox();
    const unserved = new URL(hosts.demo);
    unserved.hostname = '127.0.0.1';
    const context = await browser.newContext({ baseURL: unserved.origin });
    const page = await context.newPage();
    try {
      // Constant D-10 answer regardless of the refusal (the refusal is not enumerable either).
      await requestLink(page, email);
      await expectNoRecoveryMail(email);
    } finally {
      await context.close();
    }
  });

  test('5. T-05-01: a protocol-relative `next` on a VALID link falls back to /inicio', async ({
    page,
  }) => {
    const email = await newMember('protorel');
    await clearMailbox();
    await requestLink(page, email);

    const link = await waitForRecoveryMail(email);
    const hijacked = new URL(link);
    hijacked.searchParams.set('next', '//evil.example');

    await page.goto(hijacked.toString());
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
    expect(page.url().startsWith(hosts.demo)).toBe(true);
  });

  test('7. WR-10: the backslash form `/\\evil.example` on a VALID link also falls back to /inicio', async ({
    page,
  }) => {
    // WHATWG: for special schemes a backslash is a slash, so a `Location: /\evil.example` header is
    // followed as `//evil.example`. The old `^\/(?!\/)` regex accepted it; the URL parser does not.
    const email = await newMember('backslash');
    await clearMailbox();
    await requestLink(page, email);

    const link = await waitForRecoveryMail(email);
    const hijacked = new URL(link);
    hijacked.searchParams.set('next', '/\\evil.example');

    await page.goto(hijacked.toString());
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
    expect(page.url().startsWith(hosts.demo)).toBe(true);
  });
});
