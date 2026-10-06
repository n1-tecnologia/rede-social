import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import {
  addMembership,
  closeAdmin,
  consentCountForEmailIn,
  createBareTenant,
  createMember,
  deleteTenantBySlug,
  deleteUsersByEmailPrefix,
  liveMembershipCountForEmail,
  membershipForEmailIn,
  profileNameForEmailIn,
  setMemberDisplayName,
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

/** The D-301 heading of the "já tem conta" state for a community (UI-D-321, verbatim). */
function existingTitle(tenantName: string): string {
  return `Você já tem uma conta. Digite sua senha para participar de ${tenantName}`;
}

/** A password the identity does NOT have: typed into the sign-up form as a NEW password. */
const NEW_PASSWORD = 'OutraSenha123';

/**
 * Fills `/cadastro` on `origin` with an e-mail that already has an identity and submits it: the 409
 * turns the page into the "já tem conta" state (D-301).
 */
async function signUpWithExisting(
  page: Page,
  origin: string,
  email: string,
  name: string,
): Promise<void> {
  await page.goto(`${origin}/cadastro`);
  await page.locator('#name').fill(name);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(NEW_PASSWORD);
  await page.locator('#acceptRules').check();
  await page.locator('#acceptTerms').check();
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page).toHaveURL(`${origin}/cadastro?estado=ja-tem-conta`, { timeout: 30_000 });
}

/** Confirms the "já tem conta" form with `password` and both consents. */
async function confirmExisting(page: Page, password: string): Promise<void> {
  await page.locator('#password').fill(password);
  await page.locator('#acceptRules').check();
  await page.locator('#acceptTerms').check();
  await page.getByRole('button', { name: 'Participar', exact: true }).click();
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

test.describe('já tem conta', () => {
  test('já tem conta tracer: a rede-demo e-mail signs up on rede-lab, confirms the existing password and joins rede-lab', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');

    const email = `${PREFIX}${RUN}-signup@rede-demo.local`;
    await createMember(email, SEED_PASSWORD, 'rede-demo');
    await setMemberDisplayName(email, 'rede-demo', 'Nome em Demo');

    const context = await browser.newContext();
    const page = await context.newPage();
    await withoutProfileNudge(page);

    await signUpWithExisting(page, hosts.lab, email, 'Nome no Lab');
    // T-08.1-12: the e-mail travels in the HttpOnly draft cookie only, never in the URL.
    expect(page.url()).not.toContain('@');
    expect(page.url()).not.toContain(encodeURIComponent('@'));
    const draft = (await context.cookies(hosts.lab)).find((c) => c.name === 'join_draft');
    expect(draft?.httpOnly).toBe(true);
    expect(draft?.sameSite).toBe('Lax');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(existingTitle(LAB_NAME));
    // The e-mail is shown as text, never as an editable input.
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await expect(page.locator('#email')).toHaveCount(0);
    await expect(page.locator('#password')).toHaveAttribute('autocomplete', 'current-password');
    // D-306: both consent boxes start unchecked.
    await expect(page.locator('#acceptRules')).not.toBeChecked();
    await expect(page.locator('#acceptTerms')).not.toBeChecked();

    // D-302: rede-demo appears nowhere on rede-lab's screen (the fixture's own e-mail is cut first).
    const body = (await page.locator('body').innerText()).replace(email, '').toLowerCase();
    for (const secret of [DEMO_NAME.toLowerCase(), 'rede-demo', 'nome em demo']) {
      expect(body).not.toContain(secret);
    }

    await confirmExisting(page, SEED_PASSWORD);
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
    expect(await consentCountForEmailIn(email, 'rede-lab')).toBe(2);
    // D-311: rede-lab's profile carries the name typed at sign-up; rede-demo's is untouched.
    expect(await profileNameForEmailIn(email, 'rede-lab')).toBe('Nome no Lab');
    expect(await profileNameForEmailIn(email, 'rede-demo')).toBe('Nome em Demo');
    // The draft is cleared after a successful join.
    expect((await context.cookies(hosts.lab)).find((c) => c.name === 'join_draft')).toBeUndefined();

    await context.close();
  });

  test.describe('error states', () => {
    test('wrong password writes nothing: back on the state with the wrong-password alert', async ({
      browser,
    }) => {
      test.skip(isRemote, 'local stack only');

      const email = `${PREFIX}${RUN}-wrongpw@rede-demo.local`;
      await createMember(email, SEED_PASSWORD, 'rede-demo');
      const context = await browser.newContext();
      const page = await context.newPage();
      await withoutProfileNudge(page);

      await signUpWithExisting(page, hosts.lab, email, 'Nome no Lab');
      await confirmExisting(page, 'SenhaErrada999');

      await expect(page).toHaveURL(`${hosts.lab}/cadastro?estado=ja-tem-conta&erro=senha`, {
        timeout: 30_000,
      });
      await expect(page.locator('p[role="alert"]')).toHaveText(
        'Senha incorreta. Tente de novo ou use Esqueci a senha.',
      );
      // Still the state: the draft survives a wrong password so the person can try again.
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(existingTitle(LAB_NAME));

      // D-301 step 4: nothing was written, and no session was minted on rede-lab's origin.
      expect(await membershipForEmailIn(email, 'rede-lab')).toBeNull();
      expect(await consentCountForEmailIn(email, 'rede-lab')).toBe(0);
      expect(await liveMembershipCountForEmail(email)).toBe(1);
      expect(
        (await context.cookies(hosts.lab)).filter((c) => c.name.startsWith('sb-')),
      ).toHaveLength(0);

      await context.close();
    });

    test('expired draft: the state without its cookie renders the plain form and the notice', async ({
      browser,
    }) => {
      test.skip(isRemote, 'local stack only');

      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${hosts.lab}/cadastro?estado=ja-tem-conta`);

      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Criar conta');
      await expect(page.getByText('Por segurança, preencha o cadastro novamente.')).toBeVisible();
      await expect(page.locator('#email')).toBeVisible();
      await expect(page.locator('#name')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cadastrar' })).toBeVisible();

      await context.close();
    });

    test('already a member of this community: "signing up" again on rede-demo simply enters, writing nothing', async ({
      browser,
    }) => {
      test.skip(isRemote, 'local stack only');

      const email = `${PREFIX}${RUN}-already@rede-demo.local`;
      await createMember(email, SEED_PASSWORD, 'rede-demo');
      const consentsBefore = await consentCountForEmailIn(email, 'rede-demo');
      const context = await browser.newContext();
      const page = await context.newPage();
      await withoutProfileNudge(page);

      // D-302: the unauthenticated answer is the same state as for any other existing e-mail.
      await signUpWithExisting(page, hosts.demo, email, 'Outro Nome');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(existingTitle(DEMO_NAME));
      await confirmExisting(page, SEED_PASSWORD);

      await expect(page).toHaveURL(`${hosts.demo}/inicio`, { timeout: 30_000 });
      await expect(page.locator('[data-shell-brand]:visible')).toHaveAccessibleName(DEMO_NAME);
      expect(await consentCountForEmailIn(email, 'rede-demo')).toBe(consentsBefore);
      expect(await liveMembershipCountForEmail(email)).toBe(1);

      await context.close();
    });

    test('blocked in B: the state on rede-lab ends on the rede-lab blocked screen', async ({
      browser,
    }) => {
      test.skip(isRemote, 'local stack only');

      const email = `${PREFIX}${RUN}-blockedsu@rede-demo.local`;
      await createMember(email, SEED_PASSWORD, 'rede-demo');
      await addMembership(email, 'rede-lab', 'member', 'blocked');
      const context = await browser.newContext();
      const page = await context.newPage();
      await withoutProfileNudge(page);

      // D-302: before the password, a block in B is indistinguishable from any existing account.
      await signUpWithExisting(page, hosts.lab, email, 'Nome no Lab');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(existingTitle(LAB_NAME));
      await confirmExisting(page, SEED_PASSWORD);

      // D-304: the blocked screen names rede-lab only, and its route signed the session out. A
      // server-action redirect into the `/auth/blocked` route handler renders `/acesso-suspenso`
      // while the address bar keeps the handler's URL, so the screen itself is the witness.
      await expect(page).toHaveURL(/\/(auth\/blocked|acesso-suspenso)\?t=Rede(\+|%20)Lab$/, {
        timeout: 30_000,
      });
      await expect(page.getByRole('heading', { name: 'Acesso suspenso' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText('Seu acesso a Rede Lab foi suspenso.')).toBeVisible();
      expect(new URL(page.url()).origin).toBe(new URL(hosts.lab).origin);
      const body = (await page.locator('body').innerText()).toLowerCase();
      for (const secret of [DEMO_NAME.toLowerCase(), 'rede-demo'])
        expect(body).not.toContain(secret);
      expect(
        (await context.cookies(hosts.lab)).filter((c) => c.name.startsWith('sb-')),
      ).toHaveLength(0);
      expect(await membershipForEmailIn(email, 'rede-lab')).toEqual({
        role: 'member',
        status: 'blocked',
      });
      expect(await consentCountForEmailIn(email, 'rede-lab')).toBe(0);

      await context.close();
    });

    test('forgot link: "Esqueci a senha" points at /esqueci-senha on the rede-lab origin', async ({
      browser,
    }) => {
      test.skip(isRemote, 'local stack only');

      const email = `${PREFIX}${RUN}-forgot@rede-demo.local`;
      await createMember(email, SEED_PASSWORD, 'rede-demo');
      const context = await browser.newContext();
      const page = await context.newPage();

      await signUpWithExisting(page, hosts.lab, email, 'Nome no Lab');
      const forgot = page.getByRole('link', { name: 'Esqueci a senha' });
      await expect(forgot).toHaveAttribute('href', '/esqueci-senha');
      await forgot.click();
      await expect(page).toHaveURL(`${hosts.lab}/esqueci-senha`, { timeout: 30_000 });

      await context.close();
    });
  });
});

/**
 * 08.1-03 (D-308, D-06, D-309): the GENERIC-host picker. On localhost (and Vercel Preview) no host
 * selects a community, so an identity in two of them chooses on `/escolher-comunidade`; the choice is
 * the `tenant_slug` cookie, forwarded as `x-tenant-choice` and validated by the API on every request.
 */
test.describe('Escolha a comunidade', () => {
  /** The picker's community buttons (one form per community; "Sair" is outside the list). */
  const communityButtons = (page: Page) => page.getByRole('listitem').getByRole('button');

  test('picker tracer: two memberships on localhost, pick rede-lab, land in rede-lab, then switch to rede-demo', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');

    const email = `${PREFIX}${RUN}-pick@rede-demo.local`;
    await createMember(email, SEED_PASSWORD, 'rede-demo');
    await addMembership(email, 'rede-lab', 'member', 'active');

    const context = await browser.newContext();
    const page = await context.newPage();
    await withoutProfileNudge(page);

    // TENANT_CHOICE_REQUIRED: the generic host cannot decide, so the bootstrap sends the picker.
    await signIn(page, hosts.generic, email);
    await expect(page).toHaveURL(`${hosts.generic}/escolher-comunidade`, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Escolha a comunidade');
    await expect(communityButtons(page)).toHaveText([DEMO_NAME, LAB_NAME]);

    await page.getByRole('button', { name: LAB_NAME, exact: true }).click();
    await expect(page).toHaveURL(`${hosts.generic}/inicio`, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Início', { timeout: 20_000 });
    await expect(page.locator('[data-shell-brand]:visible')).toHaveAccessibleName(LAB_NAME);

    // The choice is the HttpOnly `tenant_slug` cookie, with the proxy's attributes.
    const choice = (await context.cookies(hosts.generic)).find((c) => c.name === 'tenant_slug');
    expect(choice?.value).toBe('rede-lab');
    expect(choice?.httpOnly).toBe(true);
    expect(choice?.sameSite).toBe('Lax');
    expect(choice?.path).toBe('/');
    // One year, give or take the seconds this test took.
    expect((choice?.expires ?? 0) - Date.now() / 1000).toBeGreaterThan(31536000 - 600);

    // Opened again, the picker switches the SAME session to rede-demo.
    await page.goto(`${hosts.generic}/escolher-comunidade`);
    await page.getByRole('button', { name: DEMO_NAME, exact: true }).click();
    await expect(page).toHaveURL(`${hosts.generic}/inicio`, { timeout: 30_000 });
    await expect(page.locator('[data-shell-brand]:visible')).toHaveAccessibleName(DEMO_NAME);
    expect(
      (await context.cookies(hosts.generic)).find((c) => c.name === 'tenant_slug')?.value,
    ).toBe('rede-demo');

    await context.close();
  });

  /** A rede-demo + rede-lab throwaway, signed in on the generic host and parked on the picker. */
  async function twoCommunities(browser: Browser, label: string) {
    const email = `${PREFIX}${RUN}-${label}@rede-demo.local`;
    await createMember(email, SEED_PASSWORD, 'rede-demo');
    await addMembership(email, 'rede-lab', 'member', 'active');
    const context = await browser.newContext();
    const page = await context.newPage();
    await withoutProfileNudge(page);
    return { email, context, page };
  }

  const choiceCookie = async (context: BrowserContext) =>
    (await context.cookies(hosts.generic)).find((c) => c.name === 'tenant_slug')?.value;

  test('single membership enters directly: one community on localhost never shows the picker', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');

    const email = `${PREFIX}${RUN}-single@rede-demo.local`;
    await createMember(email, SEED_PASSWORD, 'rede-lab');
    const context = await browser.newContext();
    const page = await context.newPage();
    await withoutProfileNudge(page);
    const visited: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) visited.push(frame.url());
    });

    await signIn(page, hosts.generic, email);
    await expect(page).toHaveURL(`${hosts.generic}/inicio`, { timeout: 30_000 });
    await expect(page.locator('[data-shell-brand]:visible')).toHaveAccessibleName(LAB_NAME);
    expect(visited.some((url) => url.includes('/escolher-comunidade'))).toBe(false);
    // No choice was needed, so none was stored.
    expect(await choiceCookie(context)).toBeUndefined();

    await context.close();
  });

  test('foreign cookie is ignored: a tenant_slug naming a community the identity is not in lands on the picker again', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');

    const foreign = `mti-${RUN}-alheia`.slice(0, 40);
    await createBareTenant(foreign, 'Comunidade Alheia MTI');
    try {
      const { email, context, page } = await twoCommunities(browser, 'foreign');
      // D-06 / T-08.1-19: the cookie is a hint; a community the identity does not belong to is
      // ignored by the API (never an error, never an entry), so the choice is still required.
      await context.addCookies([{ name: 'tenant_slug', value: foreign, url: hosts.generic }]);

      await signIn(page, hosts.generic, email);
      await expect(page).toHaveURL(`${hosts.generic}/escolher-comunidade`, { timeout: 30_000 });
      await page.goto(`${hosts.generic}/inicio`);
      await expect(page).toHaveURL(`${hosts.generic}/escolher-comunidade`, { timeout: 30_000 });
      // The picker offers the identity's own two communities only, never the cookie's.
      await expect(communityButtons(page)).toHaveText([DEMO_NAME, LAB_NAME]);
      await expect(page.getByText('Comunidade Alheia MTI')).toHaveCount(0);

      await context.close();
    } finally {
      await deleteTenantBySlug(foreign);
    }
  });

  test('forged choice: a picker form whose slug was edited to a foreign one is refused and the cookie is unchanged', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');

    const { email, context, page } = await twoCommunities(browser, 'forged');
    await signIn(page, hosts.generic, email);
    await expect(page).toHaveURL(`${hosts.generic}/escolher-comunidade`, { timeout: 30_000 });
    // A real choice first, so "unchanged" means "still rede-lab", not merely "still absent".
    await page.getByRole('button', { name: LAB_NAME, exact: true }).click();
    await expect(page).toHaveURL(`${hosts.generic}/inicio`, { timeout: 30_000 });
    expect(await choiceCookie(context)).toBe('rede-lab');

    await page.goto(`${hosts.generic}/escolher-comunidade`);
    // T-08.1-22: the browser controls the form value; edit the rede-demo form's hidden slug.
    const demoForm = page.locator('form').filter({
      has: page.getByRole('button', { name: DEMO_NAME, exact: true }),
    });
    await demoForm.locator('input[name="slug"]').evaluate((input: HTMLInputElement) => {
      input.value = 'rede-forjada';
    });
    await page.getByRole('button', { name: DEMO_NAME, exact: true }).click();

    await expect(page).toHaveURL(`${hosts.generic}/escolher-comunidade?erro=invalida`, {
      timeout: 30_000,
    });
    await expect(page.locator('p[role="alert"]')).toHaveText(
      'Escolha uma das comunidades da lista.',
    );
    expect(await choiceCookie(context)).toBe('rede-lab');

    await context.close();
  });

  test('tenant host has no picker: rede-lab/escolher-comunidade is the not-found screen and names no other community', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');

    const { email, context, page } = await twoCommunities(browser, 'tenanthost');
    await signIn(page, hosts.lab, email);
    await expect(page).toHaveURL(`${hosts.lab}/inicio`, { timeout: 30_000 });

    const response = await page.goto(`${hosts.lab}/escolher-comunidade`);
    // D-309: the route does not exist on a tenant host (no loading.tsx: the 404 is not streamed).
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Escolha a comunidade' })).toHaveCount(0);
    await expect(page.locator('input[name="slug"]')).toHaveCount(0);
    const body = (await page.locator('body').innerText()).replace(email, '').toLowerCase();
    for (const secret of [DEMO_NAME.toLowerCase(), 'rede-demo']) expect(body).not.toContain(secret);

    await context.close();
  });

  test('generic-host já tem conta: a rede-demo identity signs up on localhost/cadastro/rede-lab and lands in rede-lab', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');

    const email = `${PREFIX}${RUN}-genericsu@rede-demo.local`;
    await createMember(email, SEED_PASSWORD, 'rede-demo');
    const context = await browser.newContext();
    const page = await context.newPage();
    await withoutProfileNudge(page);

    // proxy.ts stores tenant_slug=rede-lab on this visit (D-06 as amended by D-22).
    await page.goto(`${hosts.generic}/cadastro/rede-lab`);
    expect(await choiceCookie(context)).toBe('rede-lab');
    await page.locator('#name').fill('Nome no Lab');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(NEW_PASSWORD);
    await page.locator('#acceptRules').check();
    await page.locator('#acceptTerms').check();
    await page.getByRole('button', { name: 'Cadastrar' }).click();
    await expect(page).toHaveURL(`${hosts.generic}/cadastro/rede-lab?estado=ja-tem-conta`, {
      timeout: 30_000,
    });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(existingTitle(LAB_NAME));

    await confirmExisting(page, SEED_PASSWORD);
    // Two memberships now, but the stored choice decides: no picker, straight into rede-lab.
    await expect(page).toHaveURL(`${hosts.generic}/inicio`, { timeout: 30_000 });
    await expect(page.locator('[data-shell-brand]:visible')).toHaveAccessibleName(LAB_NAME);
    expect(await membershipForEmailIn(email, 'rede-lab')).toEqual({
      role: 'member',
      status: 'active',
    });
    expect(await liveMembershipCountForEmail(email)).toBe(2);

    await context.close();
  });
});
