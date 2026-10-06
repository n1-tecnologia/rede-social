import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import {
  addMembership,
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

test.describe('participar decline and refusals', () => {
  test('"Não participar" signs out of rede-lab only: the rede-demo session in the same browser keeps working', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');

    const email = `${PREFIX}${RUN}-decline@rede-demo.local`;
    await createMember(email, SEED_PASSWORD, 'rede-demo');
    const context = await browser.newContext();
    const page = await context.newPage();
    await withoutProfileNudge(page);

    // A session on rede-demo's origin first, then one on rede-lab's.
    await signIn(page, hosts.demo, email);
    await expect(page).toHaveURL(`${hosts.demo}/inicio`, { timeout: 30_000 });
    await signIn(page, hosts.lab, email);
    await expect(page).toHaveURL(`${hosts.lab}/participar`, { timeout: 30_000 });

    await page.getByRole('button', { name: 'Não participar' }).click();
    await expect(page).toHaveURL(`${hosts.lab}/entrar`, { timeout: 30_000 });

    // D-305 / T-08.1-10: the rede-lab origin holds no session cookie any more…
    const labCookies = await context.cookies(hosts.lab);
    expect(labCookies.filter((c) => c.name.startsWith('sb-'))).toHaveLength(0);
    await page.goto(`${hosts.lab}/inicio`);
    await expect(page).toHaveURL(/\/entrar$/, { timeout: 30_000 });

    // …while the rede-demo session (a local sign-out, never global) still reaches Início.
    await page.goto(`${hosts.demo}/inicio`);
    await expect(page).toHaveURL(`${hosts.demo}/inicio`, { timeout: 30_000 });
    await expect(page.locator('[data-shell-brand]:visible')).toHaveAccessibleName(DEMO_NAME);

    // Declining wrote nothing.
    expect(await membershipForEmailIn(email, 'rede-lab')).toBeNull();
    expect(await consentCountForEmailIn(email, 'rede-lab')).toBe(0);

    await context.close();
  });

  test('D-304: blocked in rede-lab ends on the rede-lab blocked screen, which never names rede-demo', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');

    const email = `${PREFIX}${RUN}-blocked@rede-demo.local`;
    await createMember(email, SEED_PASSWORD, 'rede-demo');
    await addMembership(email, 'rede-lab', 'member', 'blocked');
    const context = await browser.newContext();
    const page = await context.newPage();
    await withoutProfileNudge(page);

    await signIn(page, hosts.lab, email);
    // The blocked screen names rede-lab only (the query encodes the space as `+` or `%20`).
    await expect(page).toHaveURL(/\/acesso-suspenso\?t=Rede(\+|%20)Lab$/, { timeout: 30_000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    for (const secret of [DEMO_NAME.toLowerCase(), 'rede-demo']) expect(body).not.toContain(secret);
    expect((await context.cookies(hosts.lab)).filter((c) => c.name.startsWith('sb-'))).toHaveLength(
      0,
    );

    await context.close();
  });

  test('?erro=recusado renders the refused card, and its "Sair" signs out of rede-lab', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');

    const email = `${PREFIX}${RUN}-refused@rede-demo.local`;
    await createMember(email, SEED_PASSWORD, 'rede-demo');
    const context = await browser.newContext();
    const page = await context.newPage();
    await withoutProfileNudge(page);

    await signIn(page, hosts.lab, email);
    await expect(page).toHaveURL(`${hosts.lab}/participar`, { timeout: 30_000 });
    await page.goto(`${hosts.lab}/participar?erro=recusado`);
    await expect(page.getByRole('heading', { name: 'Não foi possível participar' })).toBeVisible();
    await expect(page.getByText('Esta conta não pode participar desta comunidade.')).toBeVisible();
    await expect(page.locator('#name')).toHaveCount(0);

    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page).toHaveURL(`${hosts.lab}/entrar`, { timeout: 30_000 });
    expect((await context.cookies(hosts.lab)).filter((c) => c.name.startsWith('sb-'))).toHaveLength(
      0,
    );

    await context.close();
  });
});
