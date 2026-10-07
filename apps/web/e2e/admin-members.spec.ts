import { type Browser, expect, type Page, test } from '@playwright/test';
import adminMessages from '../messages/pt-BR/admin.json' with { type: 'json' };
import appMessages from '../messages/pt-BR/app.json' with { type: 'json' };
import membersMessages from '../messages/pt-BR/members.json' with { type: 'json' };
import moderationMessages from '../messages/pt-BR/moderation.json' with { type: 'json' };
import {
  blockedMembershipCount,
  closeAdmin,
  createMember,
  deleteUserByEmail,
  membershipForEmail,
  membershipIdFor,
  removeMembership,
  setEmailConfirmed,
  setMemberDisplayName,
  setMembershipRole,
  setMembershipStatus,
} from './admin';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';

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

  // Polled, not read once: in a full run the first read can land before the row's final layout.
  for (const selector of ['[data-member-name]', '[data-member-email]']) {
    await expect
      .poll(() => row.locator(selector).evaluate((node) => node.scrollWidth > node.clientWidth), {
        message: `${selector} ellipsizes`,
      })
      .toBe(true);
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

type DeviceUse = Parameters<Browser['newContext']>[0];

/** A second, independent browser context (its own cookies) signed in as `email` on the demo host. */
async function contextAs(browser: Browser, email: string, password: string, use: DeviceUse) {
  const context = await browser.newContext({ ...use, serviceWorkers: 'block' });
  const page = await context.newPage();
  await login(page, email, password, hosts.demo);
  return { context, page };
}

/** The role-change copy with its interpolations, from the catalog. */
const roleToast = (name: string, role: string) =>
  A.members.toasts.roleChanged.replace('{name}', name).replace('{role}', role);

/**
 * 08-05 tracer (ADMIN-02, D-332, UI-D-273): the demo admin opens a member's sheet, picks
 * "Administrador", reads the role-specific confirm and taps "Mudar papel". The sheet stays open on the
 * new role and pill, the row updates in place, the toast fires, and the member — signed in BEFORE the
 * change, in their own browser — sees the Administração rows on their very next Configurações load,
 * with no token refresh (membership is resolved per request). Then the admin demotes them back.
 *
 * The subject is a THROWAWAY member for the `e2e/admin.ts` reason (the seeded users are shared by the
 * whole suite); the API suite's `role tracer` runs the same change on `member@rede-demo.local`.
 */
test('role tracer', async ({
  page,
  browser,
  contextOptions,
  viewport,
  isMobile,
  hasTouch,
  userAgent,
  deviceScaleFactor,
}, testInfo) => {
  const { email, membershipId } = await throwawayMember(
    `papel-${testInfo.project.name === 'mobile-chromium' ? 'm' : 'd'}`,
  );
  const subject = await contextAs(browser, email, PASSWORD, {
    ...contextOptions,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  });
  try {
    // Before: a plain member has no Administração group.
    await subject.page.goto('/configuracoes');
    await expect(
      subject.page.getByRole('link', { name: appMessages.app.settings.rows.members }),
    ).toHaveCount(0);

    await login(page, users.demoAdmin, SEED_PASSWORD);
    await page.goto(`/configuracoes/membros?q=${encodeURIComponent(email)}`);
    const row = memberRow(page, membershipId);
    await expect(row).toBeVisible();
    await expect(row).not.toContainText(A.roles.admin);
    await row.click();

    const sheet = page.getByRole('dialog').filter({ has: page.getByRole('radiogroup') });
    const group = sheet.getByRole('radiogroup', { name: A.members.roleLabel });
    await expect(group).toBeVisible();
    const option = (label: string) => group.getByRole('radio', { name: new RegExp(`^${label}`) });
    await expect(option(A.roles.member)).toHaveAttribute('aria-checked', 'true');

    await option(A.roles.admin).click();
    const confirm = page.getByRole('dialog', {
      name: A.members.roleConfirm.title.replace('{name}', email),
    });
    await expect(confirm).toContainText(A.members.roleConfirm.toAdmin.replace('{name}', email));
    // The confirm is rendered from inside the sheet: its scrim must still cover the whole screen,
    // never only the sheet's panel.
    const scrim = await confirm.locator('xpath=..').boundingBox();
    const screenSize = page.viewportSize();
    expect(scrim && screenSize && Math.round(scrim.width)).toBe(screenSize?.width);
    expect(scrim && screenSize && Math.round(scrim.height)).toBe(screenSize?.height);
    await confirm.getByRole('button', { name: A.members.roleConfirm.confirm }).click();

    await expect(page.getByText(roleToast(email, A.roles.admin))).toBeVisible();
    // UI-D-273: the sheet stays open on the new selection and pill; the row updates in place.
    await expect(option(A.roles.admin)).toHaveAttribute('aria-checked', 'true');
    await expect(option(A.roles.member)).toHaveAttribute('aria-checked', 'false');
    await expect(sheet.locator('[data-member-pills]')).toContainText(A.roles.admin);
    await expect(row).toContainText(A.roles.admin);
    expect((await membershipForEmail(email))?.role).toBe('admin_tenant');

    // D-332: the member's very next request carries the admin permissions (same session cookies).
    await subject.page.goto('/configuracoes');
    await expect(
      subject.page.getByRole('link', { name: appMessages.app.settings.rows.members }),
    ).toBeVisible();

    // Demote back from the same sheet.
    await option(A.roles.member).click();
    const back = page.getByRole('dialog', {
      name: A.members.roleConfirm.title.replace('{name}', email),
    });
    await expect(back).toContainText(A.members.roleConfirm.toMember.replace('{name}', email));
    await back.getByRole('button', { name: A.members.roleConfirm.confirm }).click();
    await expect(page.getByText(roleToast(email, A.roles.member))).toBeVisible();
    await expect(option(A.roles.member)).toHaveAttribute('aria-checked', 'true');
    await expect(row).not.toContainText(A.roles.admin);
    expect((await membershipForEmail(email))?.role).toBe('member');

    await subject.page.goto('/configuracoes');
    await expect(
      subject.page.getByRole('link', { name: appMessages.app.settings.rows.members }),
    ).toHaveCount(0);
  } finally {
    await subject.context.close();
  }
});

/** The demo tenant's display name, as the seed writes it (the `chat.spec.ts` constant). */
const TENANT = 'Rede Demo';

const projectTag = (name: string) => (name === 'mobile-chromium' ? 'm' : 'd');

/** The profile header's admin trigger (UI-D-275), by its accessible name. */
const profileTrigger = (page: Page) => page.getByRole('button', { name: A.members.actions });

/**
 * UI E07/populated + empty (D-340, UI-D-275, T-08-30): the profile header carries the 44px "⋯" for a
 * permission holder and NOTHING for a member — not hidden, absent from the DOM. The sheet it opens is
 * the member sheet without "Ver perfil".
 */
test('the profile admin trigger: present for the admin, absent from the DOM for a member', async ({
  page,
}, testInfo) => {
  const { email, membershipId } = await throwawayMember(
    `perfil-${projectTag(testInfo.project.name)}`,
  );
  const name = `Perfil Admin ${Date.now()}`;
  await setMemberDisplayName(email, 'rede-demo', name);

  await login(page, users.demoMember, SEED_PASSWORD);
  await page.goto(`/membros/${membershipId}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(profileTrigger(page)).toHaveCount(0);
  await expect(page.locator('[data-profile-admin-trigger]')).toHaveCount(0);

  await page.context().clearCookies();
  await login(page, users.demoAdmin, SEED_PASSWORD);
  await page.goto(`/membros/${membershipId}`);
  const trigger = profileTrigger(page);
  await expect(trigger).toBeVisible();
  const box = await trigger.boundingBox();
  expect(box && box.width >= 44 && box.height >= 44).toBe(true);
  await trigger.click();

  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name })).toBeVisible();
  await expect(sheet.getByRole('radiogroup', { name: A.members.roleLabel })).toBeVisible();
  await expect(sheet.getByRole('button', { name: M.block, exact: true })).toBeVisible();
  await expect(sheet.getByRole('link', { name: A.members.viewProfile })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
});

/**
 * UI-D-275 / UI E06/partial: a block from the profile lands on the Membros list filtered to
 * "Bloqueados", with the toast, because the profile no longer exists for that person.
 */
test('a block from the profile lands on Bloqueados with the toast', async ({ page }, testInfo) => {
  const { email, membershipId } = await throwawayMember(
    `perfil-bloq-${projectTag(testInfo.project.name)}`,
  );
  await login(page, users.demoAdmin, SEED_PASSWORD);
  await page.goto(`/membros/${membershipId}`);
  await profileTrigger(page).click();

  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: M.block, exact: true }).click();
  await sheet.getByRole('button', { name: M.confirmBlock, exact: true }).click();

  await expect(page).toHaveURL(/\/configuracoes\/membros\?status=blocked$/);
  await expect(page.getByText(M.toasts.blocked.replace('{name}', email))).toBeVisible();
  await expect(page.getByRole('button', { name: A.members.filters.blocked })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(memberRow(page, membershipId)).toContainText(A.members.pills.blocked);
  expect((await membershipForEmail(email))?.status).toBe('blocked');

  // The profile is gone for a blocked member (D-23): the one not-found answer.
  await page.goto(`/membros/${membershipId}`);
  await expect(page.getByText(membersMessages.members.notFound.title)).toBeVisible();
  await expect(profileTrigger(page)).toHaveCount(0);
});

/** UI E05/partial: a blocked membership's role list is disabled, with the helper, and does nothing. */
test('the role list is disabled for a blocked member, with the helper', async ({
  page,
}, testInfo) => {
  const blocked = await throwawayMember(
    `papel-bloq-${projectTag(testInfo.project.name)}`,
    'support_tenant',
  );
  await setMembershipStatus(blocked.email, 'blocked');

  await login(page, users.demoAdmin, SEED_PASSWORD);
  await page.goto(`/configuracoes/membros?status=blocked&q=${encodeURIComponent(blocked.email)}`);
  await memberRow(page, blocked.membershipId).click();

  const sheet = page.getByRole('dialog');
  const group = sheet.getByRole('radiogroup', { name: A.members.roleLabel });
  await expect(group).toHaveAttribute('aria-disabled', 'true');
  await expect(sheet.getByText(A.members.roleBlockedHelper)).toBeVisible();
  const support = group.getByRole('radio', { name: new RegExp(`^${A.roles.support}`) });
  await expect(support).toHaveAttribute('aria-checked', 'true');
  // `dispatchEvent`: a real tap on an `aria-disabled` option, without Playwright's actionability wait.
  await group.getByRole('radio', { name: new RegExp(`^${A.roles.admin}`) }).dispatchEvent('click');
  await expect(
    page.getByRole('dialog', {
      name: A.members.roleConfirm.title.replace('{name}', blocked.email),
    }),
  ).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: M.unblock, exact: true })).toBeVisible();
  expect((await membershipForEmail(blocked.email))?.role).toBe('support_tenant');
});

/**
 * UI-D-284 (T-08-29): an admin demoted in the background (here: through SQL) who then taps an action
 * is told — the forbidden toast — and the refreshed screen answers `notFound()`. The actor is a
 * THROWAWAY admin, never the seeded one.
 */
test('a demoted admin taps an action: the forbidden toast, then the screen is gone', async ({
  page,
}, testInfo) => {
  const tag = projectTag(testInfo.project.name);
  const actor = await throwawayMember(`ex-admin-${tag}`, 'admin_tenant');
  const target = await throwawayMember(`alvo-ex-admin-${tag}`);

  await login(page, actor.email, PASSWORD);
  await page.goto(`/configuracoes/membros?q=${encodeURIComponent(target.email)}`);
  await memberRow(page, target.membershipId).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('radiogroup', { name: A.members.roleLabel })).toBeVisible();

  // Another admin demotes the actor while the sheet is open.
  await setMembershipRole(actor.email, 'rede-demo', 'member');

  await sheet
    .getByRole('radiogroup', { name: A.members.roleLabel })
    .getByRole('radio', { name: new RegExp(`^${A.roles.support}`) })
    .click();
  await page
    .getByRole('dialog', { name: A.members.roleConfirm.title.replace('{name}', target.email) })
    .getByRole('button', { name: A.members.roleConfirm.confirm })
    .click();

  await expect(page.getByText(A.errors.forbidden)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: A.members.title })).toHaveCount(0);
  await expect(page.locator('[data-admin-members]')).toHaveCount(0);
  expect((await membershipForEmail(target.email))?.role).toBe('member');
  // A reload is the same notFound(): the screen does not exist for a member.
  await page.reload();
  await expect(page.getByRole('searchbox', { name: A.members.search.label })).toHaveCount(0);
  await expect(page.locator('[data-admin-members]')).toHaveCount(0);
});

/**
 * UI E04/error (UI-D-284): the membership vanished while its sheet was open — the gone toast, the
 * sheet closes and the list no longer shows the row.
 */
test('a vanished member: the gone toast, the sheet closes, the row leaves', async ({
  page,
}, testInfo) => {
  const target = await throwawayMember(`some-${projectTag(testInfo.project.name)}`);
  await login(page, users.demoAdmin, SEED_PASSWORD);
  await page.goto(`/configuracoes/membros?q=${encodeURIComponent(target.email)}`);
  const row = memberRow(page, target.membershipId);
  await row.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: target.email })).toBeVisible();

  await removeMembership(target.email);

  await sheet
    .getByRole('radiogroup', { name: A.members.roleLabel })
    .getByRole('radio', { name: new RegExp(`^${A.roles.admin}`) })
    .click();
  await page
    .getByRole('dialog', { name: A.members.roleConfirm.title.replace('{name}', target.email) })
    .getByRole('button', { name: A.members.roleConfirm.confirm })
    .click();

  await expect(page.getByText(A.members.errors.gone.replace('{tenant}', TENANT))).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row).toHaveCount(0);
});

/**
 * quick 261007-gzu: a member whose e-mail is unconfirmed carries the warning pill on its row and in
 * its sheet; a confirmed one does not; an invited row keeps only "Convite pendente"; and the pill
 * leaves once the address is confirmed and the page reloaded.
 */
test('an unconfirmed e-mail shows the pill on the row and in the sheet, and only there', async ({
  page,
}, testInfo) => {
  const tag = projectTag(testInfo.project.name);
  const pending = await throwawayMember(`unconfirmed-${tag}`);
  const confirmed = await throwawayMember(`confirmed-${tag}`);
  const invited = await throwawayMember(`unconfirmed-invite-${tag}`, 'admin_tenant');
  await setEmailConfirmed(pending.email, false);
  await setEmailConfirmed(invited.email, false);
  await setMembershipStatus(invited.email, 'invited');

  await login(page, users.demoAdmin, SEED_PASSWORD);
  const find = (email: string) =>
    page.goto(`/configuracoes/membros?q=${encodeURIComponent(email)}`);

  await find(pending.email);
  const pendingRow = memberRow(page, pending.membershipId);
  await expect(pendingRow).toContainText(A.members.pills.emailUnconfirmed);

  await find(confirmed.email);
  const confirmedRow = memberRow(page, confirmed.membershipId);
  await expect(confirmedRow).toBeVisible();
  await expect(confirmedRow).not.toContainText(A.members.pills.emailUnconfirmed);

  await find(invited.email);
  const invitedRow = memberRow(page, invited.membershipId);
  await expect(invitedRow).toContainText(A.members.pills.invited);
  await expect(invitedRow).not.toContainText(A.members.pills.emailUnconfirmed);

  await find(pending.email);
  await pendingRow.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.locator('[data-member-pills]')).toContainText(
    A.members.pills.emailUnconfirmed,
  );
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  await setEmailConfirmed(pending.email, true);
  await page.reload();
  await expect(memberRow(page, pending.membershipId)).toBeVisible();
  await expect(memberRow(page, pending.membershipId)).not.toContainText(
    A.members.pills.emailUnconfirmed,
  );
});
