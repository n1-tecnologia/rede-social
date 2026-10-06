import { expect, test } from '@playwright/test';
import {
  closeAdmin,
  createMember,
  deleteUserByEmail,
  deleteUsersByEmailPrefix,
  membershipForEmailIn,
} from './admin';
import { hosts, isRemote, signOut, withoutProfileNudge } from './fixtures';
import { clearMailbox, expectNoRecoveryMail, latestMailMessage, waitForRecoveryMail } from './mail';

/**
 * AUTH-03 / D-10 password recovery on a phone viewport (`mobile-chromium`), end to end through the
 * local mail catcher: form -> e-mail -> `/auth/confirm` -> `/redefinir-senha` -> signed in.
 *
 * `baseURL` is the rede-demo TENANT host, which is the point of case 3: the link in the e-mail must
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
  const email = `e2e-recovery-${tag}-${Date.now()}@rede-demo.local`;
  await createMember(email, OLD_PASSWORD, 'rede-demo');
  created.push(email);
  return email;
}

/** 08.1 throwaway identities (cases 8-9), removed by prefix before and after the run. */
const MTI_PREFIX = 'mti-rec-';
const LAB_NAME = 'Rede Lab';
/** rede-lab's seeded `colors.primary` (scripts/seed.ts). */
const LAB_PRIMARY = '#0f766e';
const SHARED_PASSWORD_NOTICE = 'Sua senha é a mesma em todas as comunidades desta plataforma.';

/**
 * Asks for a recovery link from `/esqueci-senha` (on `origin`, the spec's `baseURL` by default) and
 * asserts the constant D-10 answer.
 */
async function requestLink(
  page: import('@playwright/test').Page,
  email: string,
  origin = '',
): Promise<void> {
  await page.goto(`${origin}/esqueci-senha`);
  await page.locator('#email').fill(email);
  await page.getByRole('button', { name: 'Enviar link' }).click();
  await expect(page).toHaveURL(/\/esqueci-senha\?enviado=1$/, { timeout: 30_000 });
  await expect(page.locator('p[role="status"]')).toHaveText(SENT);
}

test.beforeAll(async () => {
  if (!isRemote) await deleteUsersByEmailPrefix(MTI_PREFIX);
});

test.afterAll(async () => {
  for (const email of created) await deleteUserByEmail(email);
  if (!isRemote) await deleteUsersByEmailPrefix(MTI_PREFIX);
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
    await requestLink(page, `nao-existe-${Date.now()}@rede-demo.local`);
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
    // Início has no visible welcome block (2026-10-01): its one h1 is the screen-reader "Início",
    // and the tenant shows in the shell's home link (TopBar on the phone, rail on desktop), named
    // by the logo's alt (or by the name itself without a logo).
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Início', { timeout: 20_000 });
    await expect(page.locator('[data-shell-brand]:visible')).toHaveAccessibleName('Rede Demo');

    // The new password is the one that works from now on.
    await signOut(page, hosts.demo);
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
  test('8. D-317/D-303: recovery started on rede-lab by a rede-demo-only member is rede-lab-branded and returns to the join', async ({
    page,
  }) => {
    test.skip(isRemote, 'local stack only');
    // The person belongs to rede-demo only and forgot the password while joining rede-lab: the mail
    // wears rede-lab's brand (the verified host the flow started on, D-317), its link returns to
    // rede-lab, and resetting creates no rede-lab membership — the join is still the person's step.
    const email = `${MTI_PREFIX}${Date.now().toString(36)}@rede-demo.local`;
    await createMember(email, OLD_PASSWORD, 'rede-demo');

    await withoutProfileNudge(page);
    await clearMailbox();
    // The constant D-10 answer: nothing on the page tells whether, or how, a mail went out.
    await requestLink(page, email, hosts.lab);

    const mail = await latestMailMessage(email);
    expect(mail.fromName).toBe(LAB_NAME);
    expect(mail.subject).toBe(`Redefina sua senha — ${LAB_NAME}`);
    expect(mail.html).toContain(LAB_PRIMARY);
    expect(mail.html).not.toContain('Rede Demo');
    expect(mail.link).not.toBeNull();
    const link = mail.link ?? '';
    expect(new URL(link).origin).toBe(hosts.lab);
    expect(link.startsWith(`${hosts.lab}/auth/confirm`)).toBe(true);

    await page.goto(link);
    await expect(page).toHaveURL(`${hosts.lab}/redefinir-senha`, { timeout: 30_000 });
    await expect(page.getByText(SHARED_PASSWORD_NOTICE)).toBeVisible();

    await page.locator('#password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Salvar nova senha' }).click();
    // D-303: the reset session is no rede-lab member, so the bootstrap refusal sends it to the join.
    await expect(page).toHaveURL(`${hosts.lab}/participar`, { timeout: 30_000 });
    expect(await membershipForEmailIn(email, 'rede-lab')).toBeNull();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Participar de ${LAB_NAME}`);
    await page.locator('#name').fill('Recuperou e Participou');
    await page.locator('#acceptRules').check();
    await page.locator('#acceptTerms').check();
    await page.getByRole('button', { name: 'Participar', exact: true }).click();
    await expect(page).toHaveURL(`${hosts.lab}/inicio`, { timeout: 30_000 });
    await expect(page.locator('[data-shell-brand]:visible')).toHaveAccessibleName(LAB_NAME);
    expect(await membershipForEmailIn(email, 'rede-lab')).toEqual({
      role: 'member',
      status: 'active',
    });
  });
});
