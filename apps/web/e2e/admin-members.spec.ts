import { expect, type Page, test } from '@playwright/test';
import adminMessages from '../messages/pt-BR/admin.json' with { type: 'json' };
import appMessages from '../messages/pt-BR/app.json' with { type: 'json' };
import moderationMessages from '../messages/pt-BR/moderation.json' with { type: 'json' };
import {
  blockedMembershipCount,
  closeAdmin,
  createMember,
  deleteUserByEmail,
  membershipForEmail,
  membershipIdFor,
  setMemberDisplayName,
  setMembershipStatus,
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

async function throwawayMember(
  tag: string,
  role: 'member' | 'admin_tenant' | 'support_tenant' = 'member',
  emailOverride?: string,
): Promise<{ email: string; membershipId: string }> {
  const email = emailOverride ?? `aaa-e2e-${tag}-${Date.now()}@rede-demo.local`;
  await createMember(email, PASSWORD, 'rede-demo', role);
  created.push(email);
  return { email, membershipId: await membershipIdFor(email, 'rede-demo') };
}

function memberRow(page: Page, membershipId: string) {
  return page.locator(`[data-member-row="${membershipId}"]`);
}

/**
 * UI E02/empty (fresh seed): "Bloqueados" with no blocked membership shows its own empty copy. Runs
 * FIRST in this file, before any case below creates a blocked throwaway; a reset + seed is the
 * precondition, asserted rather than assumed.
 */
test('the Bloqueados empty state on a fresh seed', async ({ page }) => {
  expect(await blockedMembershipCount('rede-demo')).toBe(0);
  await login(page, users.demoAdmin, SEED_PASSWORD);
  await page.goto('/configuracoes/membros?status=blocked');
  await expect(page.getByRole('button', { name: A.members.filters.blocked })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText(A.members.blockedEmpty.title)).toBeVisible();
  await expect(page.getByText(A.members.blockedEmpty.body)).toBeVisible();

  await page.getByRole('button', { name: A.members.filters.invited }).click();
  await expect(page).toHaveURL(/\?status=invited$/);
  await expect(page.getByText(A.members.invitedEmpty.title)).toBeVisible();
});

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
  await sheet.getByRole('button', { name: M.block, exact: true }).click();

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
  await sheet.getByRole('button', { name: M.unblock, exact: true }).click();
  await expect(
    sheet.getByRole('heading', { name: M.unblockStep.title.replace('{name}', email) }),
  ).toBeVisible();
  await sheet.getByRole('button', { name: M.confirmUnblock, exact: true }).click();

  await expect(page.getByText(M.toasts.unblocked.replace('{name}', email))).toBeVisible();
  await expect(row).not.toContainText(A.members.pills.blocked);
  expect((await membershipForEmail(email))?.status).toBe('active');
});

/**
 * UI-D-271 (UI E02): the search field and the chips write the URL through `router.replace` (the
 * `/membros` rule: a keystroke or a chip is not a history entry), so the URL is the query: leaving the
 * screen and coming back with back/forward restores the search AND the chip, the field included. An
 * unknown `?status=` reads as "Todos"; a search with no match shows its copy; clearing the field
 * clears the URL and the field never pushes a stale value back.
 */
test('search, chips and back/forward keep the URL as the query', async ({ page }, testInfo) => {
  const tag = `busca-${testInfo.project.name === 'mobile-chromium' ? 'm' : 'd'}`;
  const { email, membershipId } = await throwawayMember(tag);
  const needle = email.split('@')[0] ?? email;

  await login(page, users.demoAdmin, SEED_PASSWORD);
  await page.goto('/configuracoes/membros?status=nao-existe');
  const all = page.getByRole('button', { name: A.members.filters.all });
  const blockedChip = page.getByRole('button', { name: A.members.filters.blocked });
  await expect(all).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/configuracoes/membros');
  const search = page.getByRole('searchbox', { name: A.members.search.label });
  await search.fill(needle);
  await expect(page).toHaveURL(new RegExp(`\\?q=${needle}$`));
  await expect(page.locator('[data-member-row]')).toHaveCount(1);
  await expect(memberRow(page, membershipId)).toBeVisible();

  await blockedChip.click();
  await expect(page).toHaveURL(new RegExp(`\\?q=${needle}&status=blocked$`));
  await expect(blockedChip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(A.members.searchEmpty.title)).toBeVisible();

  // Leave, then come back through history: the URL — and with it the field and the chip — return.
  await page.getByRole('link', { name: A.back }).click();
  await expect(page).toHaveURL(/\/configuracoes$/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`\\?q=${needle}&status=blocked$`));
  await expect(search).toHaveValue(needle);
  await expect(blockedChip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(A.members.searchEmpty.title)).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/configuracoes$/);
  await page.goBack();
  await expect(search).toHaveValue(needle);

  await all.click();
  await expect(page).toHaveURL(new RegExp(`\\?q=${needle}$`));
  await expect(memberRow(page, membershipId)).toBeVisible();

  await page.getByRole('button', { name: A.members.search.clear }).click();
  await expect(page).toHaveURL(/\/configuracoes\/membros$/);
  // The settled field matches the URL and must not push a stale value back.
  await page.waitForTimeout(600);
  await expect(page).toHaveURL(/\/configuracoes\/membros$/);
  await expect(search).toHaveValue('');

  await search.fill(`${needle}-nada`);
  await expect(page.getByText(A.members.searchEmpty.title)).toBeVisible();
  await expect(page.getByText(A.members.searchEmpty.body)).toBeVisible();
});

/** UI-D-272 (UI E04/partial): the invited and blocked sheet variants. */
test('invited and blocked sheet variants', async ({ page }, testInfo) => {
  const suffix = testInfo.project.name === 'mobile-chromium' ? 'm' : 'd';
  const invited = await throwawayMember(`convite-${suffix}`, 'admin_tenant');
  await setMembershipStatus(invited.email, 'invited');
  const blocked = await throwawayMember(`bloq-${suffix}`);
  await setMembershipStatus(blocked.email, 'blocked');

  await login(page, users.demoAdmin, SEED_PASSWORD);

  await page.goto(`/configuracoes/membros?q=${encodeURIComponent(invited.email)}`);
  const invitedRow = memberRow(page, invited.membershipId);
  await expect(invitedRow).toContainText(A.members.pills.invited);
  await expect(invitedRow).toContainText(A.roles.admin);
  await invitedRow.click();
  const sheet = page.getByRole('dialog');
  await expect(
    sheet.getByText(A.members.invitedBody.replace('{email}', invited.email)),
  ).toBeVisible();
  await expect(sheet.getByRole('button', { name: M.block, exact: true })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: M.unblock, exact: true })).toHaveCount(0);
  await expect(sheet.getByRole('link', { name: A.members.viewProfile })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  // Focus returns to the row that opened the sheet (UI-D-288).
  await expect(invitedRow).toBeFocused();

  await page.goto(`/configuracoes/membros?status=blocked&q=${encodeURIComponent(blocked.email)}`);
  const blockedRow = memberRow(page, blocked.membershipId);
  await expect(blockedRow).toContainText(A.members.pills.blocked);
  await blockedRow.click();
  await expect(sheet.getByRole('button', { name: M.unblock, exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: M.block, exact: true })).toHaveCount(0);
  await expect(sheet.getByRole('link', { name: A.members.viewProfile })).toHaveCount(0);
});

/**
 * UI E03/long-text BACKSTOP: at 320px a 60-character name and a 64-character e-mail both ellipsize,
 * and an "Administrador" + "Bloqueado" pill pair wraps without pushing the chevron off the row.
 */
test('a long name and e-mail ellipsize at 320px with two pills', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'the 320px backstop is a phone case');
  await page.setViewportSize({ width: 320, height: 720 });
  const stamp = String(Date.now());
  const domain = '@rede-demo.local';
  const local = `aaa-e2e-longo-${stamp}-`.padEnd(64 - domain.length, 'x');
  const email = `${local}${domain}`;
  expect(email).toHaveLength(64);
  const name = `Maria Eduarda ${stamp} `.padEnd(60, 'n');
  expect(name).toHaveLength(60);

  const member = await throwawayMember('longo', 'admin_tenant', email);
  await setMemberDisplayName(email, 'rede-demo', name);
  await setMembershipStatus(email, 'blocked');

  await login(page, users.demoAdmin, SEED_PASSWORD);
  await page.goto(`/configuracoes/membros?q=${encodeURIComponent(stamp)}`);
  const row = memberRow(page, member.membershipId);
  await expect(row).toContainText(A.roles.admin);
  await expect(row).toContainText(A.members.pills.blocked);

  for (const selector of ['[data-member-name]', '[data-member-email]']) {
    const truncated = await row
      .locator(selector)
      .evaluate((node) => node.scrollWidth > node.clientWidth);
    expect(truncated, `${selector} ellipsizes`).toBe(true);
  }
  const rowBox = await row.boundingBox();
  const chevron = await row.locator('svg').last().boundingBox();
  expect(rowBox && rowBox.x + rowBox.width).toBeLessThanOrEqual(320);
  expect(chevron && chevron.x + chevron.width).toBeLessThanOrEqual(320);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
