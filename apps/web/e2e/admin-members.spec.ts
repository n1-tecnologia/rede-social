import { expect, type Page, test } from '@playwright/test';
import adminMessages from '../messages/pt-BR/admin.json' with { type: 'json' };
import appMessages from '../messages/pt-BR/app.json' with { type: 'json' };
import moderationMessages from '../messages/pt-BR/moderation.json' with { type: 'json' };
import {
  closeAdmin,
  createMember,
  deleteUserByEmail,
  membershipForEmail,
  membershipIdFor,
} from './admin';
import { login, SEED_PASSWORD, users } from './fixtures';

/** The catalog is the source of copy — never a literal in a spec. */
const A = adminMessages.admin;
const M = moderationMessages.moderation.member;

/**
 * 08-04 — the Membros screen in a real browser (ADMIN-02, MODER-02, UI-D-271..274).
 *
 * `block tracer`: the demo admin opens Configurações → Membros, taps a member's row, taps "Bloquear
 * acesso", types an optional reason, confirms "Bloquear", sees the toast and the "Bloqueado" pill;
 * then "Desbloquear acesso" restores the membership.
 *
 * The subject is a THROWAWAY member, never `member@rede-demo.local`: the seeded users are shared by the
 * whole suite and must never be left blocked by a failed run (`e2e/admin.ts`'s rule). The API suite
 * proves the same action on the seeded member. Its e-mail starts with `aaa-` and it has no profile
 * name, so it sorts FIRST (a membership without a name sorts by its e-mail) and its name line is the
 * e-mail.
 */
test.use({ serviceWorkers: 'block' });
test.describe.configure({ timeout: 120_000 });

const PASSWORD = 'Segredo123';
const created: string[] = [];

test.afterAll(async () => {
  for (const email of created) await deleteUserByEmail(email);
  await closeAdmin();
});

async function throwawayMember(tag: string): Promise<{ email: string; membershipId: string }> {
  const email = `aaa-e2e-${tag}-${Date.now()}@rede-demo.local`;
  await createMember(email, PASSWORD, 'rede-demo');
  created.push(email);
  return { email, membershipId: await membershipIdFor(email, 'rede-demo') };
}

function memberRow(page: Page, membershipId: string) {
  return page.locator(`[data-member-row="${membershipId}"]`);
}

test('block tracer', async ({ page }, testInfo) => {
  const { email, membershipId } = await throwawayMember(
    testInfo.project.name === 'mobile-chromium' ? 'm' : 'd',
  );

  await login(page, users.demoAdmin, SEED_PASSWORD);
  await page.goto('/configuracoes');
  await page.getByRole('link', { name: appMessages.app.settings.rows.members }).click();
  await expect(page).toHaveURL(/\/configuracoes\/membros$/);
  await expect(page.getByRole('heading', { level: 1, name: A.members.title })).toBeVisible();

  // The viewer's own row is static: no button, the "Você" pill.
  const own = page.locator('[data-member-own]');
  await expect(own).toContainText(A.members.pills.you);
  await expect(own.locator('button')).toHaveCount(0);

  const row = memberRow(page, membershipId);
  await expect(row).toBeVisible();
  await expect(row).toContainText(email);
  await row.click();

  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: email })).toBeVisible();
  await sheet.getByRole('button', { name: M.block }).click();

  // The confirm step swaps the content in place.
  await expect(
    sheet.getByRole('heading', { name: M.blockStep.title.replace('{name}', email) }),
  ).toBeVisible();
  const reason = sheet.getByLabel(M.reason.label);
  await expect(reason).toBeFocused();
  await reason.fill(`Teste e2e ${testInfo.project.name}`);
  await sheet.getByRole('button', { name: M.confirmBlock, exact: true }).click();

  await expect(page.getByText(M.toasts.blocked.replace('{name}', email))).toBeVisible();
  await expect(sheet).toBeHidden();
  await expect(row).toContainText(A.members.pills.blocked);
  expect((await membershipForEmail(email))?.status).toBe('blocked');

  // Unblock from the same row.
  await row.click();
  await sheet.getByRole('button', { name: M.unblock }).click();
  await expect(
    sheet.getByRole('heading', { name: M.unblockStep.title.replace('{name}', email) }),
  ).toBeVisible();
  await sheet.getByRole('button', { name: M.confirmUnblock, exact: true }).click();

  await expect(page.getByText(M.toasts.unblocked.replace('{name}', email))).toBeVisible();
  await expect(row).not.toContainText(A.members.pills.blocked);
  expect((await membershipForEmail(email))?.status).toBe('active');
});
