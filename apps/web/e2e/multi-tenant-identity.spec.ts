import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import {
  closeAdmin,
  consentCountForEmailIn,
  createMember,
  deleteUsersByEmailPrefix,
  liveMembershipCountForEmail,
  membershipForEmailIn,
} from './admin';
import { hosts, isRemote, SEED_PASSWORD, withoutProfileNudge } from './fixtures';

/**
 * 08.1 (V2-PLAT-07, D-305, D-306, D-311) on a phone viewport: one login, many communities. A person
 * who belongs to rede-demo signs in on rede-lab's address with the same e-mail and password, is
 * offered "Participar de Rede Lab" in rede-lab's brand, types a name, accepts both consents and enters
 * rede-lab — while staying a member of rede-demo on rede-demo's address. Nothing about rede-demo may
 * appear on rede-lab's screen (D-302, D-309).
 *
 * Throwaway identities only (`mti-<run>@rede-demo.local`): a seed user is never joined to a second
 * community. Local stack only: it needs two distinct origins on one dev server.
 */

test.describe.configure({ timeout: 120_000 });

const PREFIX = 'mti-';
const RUN = Date.now().toString(36);
const LAB_NAME = 'Rede Lab';
const DEMO_NAME = 'Rede Demo';

/** Submits `/entrar` on `origin` and waits for whatever the server decides to show. */
async function signIn(page: Page, origin: string, email: string): Promise<void> {
  await page.goto(`${origin}/entrar`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test.beforeAll(async () => {
  if (isRemote) return;
  await deleteUsersByEmailPrefix(PREFIX);
});

test.afterAll(async () => {
  if (!isRemote) await deleteUsersByEmailPrefix(PREFIX);
  await closeAdmin();
});

test.describe('participar tracer', () => {
  test('a rede-demo member signs in on rede-lab, joins it, and keeps rede-demo', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');

    const email = `${PREFIX}${RUN}-tracer@rede-demo.local`;
    await createMember(email, SEED_PASSWORD, 'rede-demo');

    const context: BrowserContext = await browser.newContext();
    const page = await context.newPage();
    await withoutProfileNudge(page);

    await signIn(page, hosts.lab, email);
    await expect(page).toHaveURL(`${hosts.lab}/participar`, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Participar de ${LAB_NAME}`);
    // No query string: the URL itself must not carry a community.
    expect(new URL(page.url()).search).toBe('');

    // D-302 / D-309: rede-demo appears nowhere on rede-lab's screen. The session's own e-mail is the
    // one thing the page shows about the person, and its domain is the fixture's, so it is cut first.
    const body = (await page.locator('body').innerText()).replace(email, '').toLowerCase();
    for (const secret of [DEMO_NAME.toLowerCase(), 'rede-demo']) expect(body).not.toContain(secret);

    // D-311: the name field starts EMPTY — nothing is copied from the other community.
    await expect(page.locator('#name')).toHaveValue('');
    await page.locator('#name').fill('Participante do Lab');
    await page.locator('#acceptRules').check();
    await page.locator('#acceptTerms').check();
    await page.getByRole('button', { name: 'Participar', exact: true }).click();

    await expect(page).toHaveURL(`${hosts.lab}/inicio`, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Início', { timeout: 20_000 });
    await expect(page.locator('[data-shell-brand]:visible')).toHaveAccessibleName(LAB_NAME);

    expect(await membershipForEmailIn(email, 'rede-lab')).toEqual({
      role: 'member',
      status: 'active',
    });
    expect(await membershipForEmailIn(email, 'rede-demo')).toEqual({
      role: 'member',
      status: 'active',
    });
    expect(await liveMembershipCountForEmail(email)).toBe(2);
    expect(await consentCountForEmailIn(email, 'rede-lab')).toBe(2);

    // The same identity still enters rede-demo on rede-demo's address (its own session there).
    const demo = await context.newPage();
    await withoutProfileNudge(demo);
    await signIn(demo, hosts.demo, email);
    await expect(demo).toHaveURL(`${hosts.demo}/inicio`, { timeout: 30_000 });
    await expect(demo.locator('[data-shell-brand]:visible')).toHaveAccessibleName(DEMO_NAME);

    await context.close();
  });
});
