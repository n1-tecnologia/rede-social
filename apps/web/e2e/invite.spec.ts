import { expect, type Page, test } from '@playwright/test';
import {
  closeAdmin,
  consentCountForEmail,
  deleteTenantBySlug,
  deleteUserByEmail,
  envValue,
  inviteStatusForEmail,
  membershipForEmail,
} from './admin';
import { hosts, isRemote } from './fixtures';
import { waitForRecoveryMail } from './mail';
import { throwawayOrigin } from './tenant-fixtures';

/**
 * First-admin onboarding (02-10, ROLE-03, D-29/D-30/D-03/D-10) against the real local stack: the
 * super_admin provisions a tenant through the API, attaches its host through the FAKE provider and
 * verifies it, GoTrue delivers the branded invite through the 02-06 hook to Mailpit, and the link
 * opens the branded accept screen on the tenant's own host. Test 2 drives the panel resend and the
 * superseded link, test 3 the pending-without-host state. Both Playwright projects run it.
 *
 * Node-side calls use `127.0.0.1` (Node's resolver does not special-case `*.localhost`); the
 * browser navigates the tenant origin (`<slug>.localhost:3000`).
 */

test.describe.configure({ timeout: 180_000 });

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'ferramentas@triacompany.com.br';
const SUPER_ADMIN_PASSWORD: string = (() => {
  const value = process.env.SUPER_ADMIN_PASSWORD;
  if (!value) {
    throw new Error(
      'SUPER_ADMIN_PASSWORD is required for the invite e2e (same value used by `pnpm db:seed`)',
    );
  }
  return value;
})();

const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';
const PLATFORM_HOST = new URL(hosts.platform).hostname;
const PASSWORD = 'Convite-Segredo-123';

type Detail = {
  tenant: { id: string };
  invites: Array<{ id: string; status: string; sentAt: string | null }>;
};

/** A real GoTrue session for the seeded super_admin (Node side, no browser). */
async function superAdminToken(): Promise<string> {
  const res = await fetch(`${envValue('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: envValue('SUPABASE_PUBLISHABLE_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ email: SUPER_ADMIN_EMAIL, password: SUPER_ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`super_admin sign-in failed: ${res.status}`);
  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

async function platformApi(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': PLATFORM_HOST,
      'content-type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

/** Creates a tenant with a pending first-admin invite; returns the id and the invite id. */
async function createTenant(
  token: string,
  input: {
    displayName: string;
    slug: string;
    adminEmail: string;
    primary: string;
    secondary: string;
  },
): Promise<{ id: string; inviteId: string }> {
  const res = await platformApi(token, '/v1/platform/tenants', {
    method: 'POST',
    body: JSON.stringify({
      displayName: input.displayName,
      slug: input.slug,
      colors: { primary: input.primary, secondary: input.secondary },
      adminEmail: input.adminEmail,
    }),
  });
  expect(res.status, 'POST /v1/platform/tenants').toBe(201);
  const detail = (await res.json()) as Detail;
  expect(detail.invites[0]?.status).toBe('pending');
  return { id: detail.tenant.id, inviteId: detail.invites[0]?.id ?? '' };
}

/** Attaches `host` through the fake provider and verifies it ("Verificar agora"). */
async function attachAndVerify(token: string, tenantId: string, host: string): Promise<void> {
  const attached = await platformApi(token, `/v1/platform/tenants/${tenantId}/domains`, {
    method: 'POST',
    body: JSON.stringify({ host }),
  });
  expect(attached.status, 'POST …/domains').toBe(201);
  const domain = (await attached.json()) as { id: string; isPrimary: boolean };
  expect(domain.isPrimary).toBe(true);

  const verified = await platformApi(
    token,
    `/v1/platform/tenants/${tenantId}/domains/${domain.id}/verify`,
    { method: 'POST' },
  );
  expect(verified.status, 'POST …/verify').toBe(200);
  expect(((await verified.json()) as { verificationStatus: string }).verificationStatus).toBe(
    'verified',
  );
}

async function waitForInviteStatus(
  token: string,
  tenantId: string,
  status: string,
  timeoutMs = 30_000,
): Promise<Detail['invites'][number]> {
  const deadline = Date.now() + timeoutMs;
  let last: Detail['invites'][number] | undefined;
  while (Date.now() < deadline) {
    const res = await platformApi(token, `/v1/platform/tenants/${tenantId}`);
    if (res.ok) {
      last = ((await res.json()) as Detail).invites[0];
      if (last?.status === status) return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`invite of ${tenantId} never reached '${status}' (last: ${last?.status})`);
}

/** The newest `/auth/confirm` link mailed to `email` that differs from `previous`. */
async function waitForInviteLink(
  email: string,
  previous: string | null,
  timeoutMs = 30_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const link = await waitForRecoveryMail(email, 5_000).catch(() => null);
    if (link && link !== previous) return link;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no new invite link for ${email} within ${timeoutMs}ms`);
}

/** Fills the accept form (password + both consents) and submits; resolves on `/inicio`. */
async function acceptInvite(page: Page): Promise<void> {
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#acceptRules').check();
  await page.locator('#acceptTerms').check();
  await page.getByRole('button', { name: 'Aceitar convite' }).click();
  await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
}

async function expectExpiredScreen(page: Page, origin: string): Promise<void> {
  await expect(page).toHaveURL(`${origin}/convite-expirado`);
  await expect(page.getByRole('heading', { name: 'Convite expirado' })).toBeVisible();
  await expect(
    page.getByText('Este convite expirou. Peça um novo convite ao administrador da plataforma.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Voltar para login' })).toHaveAttribute(
    'href',
    '/entrar',
  );
}

/** Submits `/entrar` on `origin` without asserting the landing (owned by 02-07). */
async function signIn(page: Page, origin: string, email: string, password: string): Promise<void> {
  await page.goto(`${origin}/entrar`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/entrar'), { timeout: 30_000 });
}

/** Every fixture a test created, for `afterAll` (Playwright restarts the worker after a failure). */
const created: { slugs: string[]; emails: string[] } = { slugs: [], emails: [] };

test.afterAll(async () => {
  for (const email of created.emails) await deleteUserByEmail(email);
  for (const slug of created.slugs) await deleteTenantBySlug(slug);
  await closeAdmin();
});

test.describe('02-10 — first-admin invite: accept, resend, expired', () => {
  test('1. attach (fake) -> verified -> invite mail -> accept -> /inicio (tracer)', async ({
    page,
  }) => {
    test.skip(isRemote, 'local stack only');
    const sfx = Date.now().toString(36);
    const slug = `e2e-inv-${sfx}`;
    const host = `${slug}.localhost`;
    const origin = throwawayOrigin(host);
    const adminEmail = `admin+${sfx}@e2e-invite.local`;
    const displayName = `E2E Convite ${sfx}`;
    created.slugs.push(slug);
    created.emails.push(adminEmail);

    const token = await superAdminToken();
    const { id } = await createTenant(token, {
      displayName,
      slug,
      adminEmail,
      primary: '#0e7490',
      secondary: '#67e8f9',
    });
    await attachAndVerify(token, id, host);
    await waitForInviteStatus(token, id, 'sent');

    // The branded invite reached Mailpit; its CTA opens /auth/confirm on the tenant's own origin.
    const link1 = await waitForInviteLink(adminEmail, null);
    expect(link1.startsWith(`${origin}/auth/confirm`)).toBe(true);
    expect(link1).toMatch(/next=(\/|%2F)aceitar-convite/);
    expect(link1).toContain('type=invite');

    await page.goto(link1);
    await expect(page).toHaveURL(`${origin}/aceitar-convite`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      `Você foi convidado(a) a administrar ${displayName}`,
    );
    await expect(page.getByText(adminEmail)).toBeVisible();
    const brandPrimary = await page
      .locator('main')
      .evaluate((main) => getComputedStyle(main).getPropertyValue('--brand-primary').trim());
    expect(brandPrimary).toBe('#0e7490');

    // E08 partial: the CTA is never disabled; native `required` keeps an empty submit on the page.
    const cta = page.getByRole('button', { name: 'Aceitar convite' });
    await expect(cta).toBeEnabled();
    await cta.click();
    await expect(page).toHaveURL(`${origin}/aceitar-convite`);

    await acceptInvite(page);
    expect(await membershipForEmail(adminEmail)).toEqual({
      role: 'admin_tenant',
      status: 'active',
    });
    expect(await consentCountForEmail(adminEmail)).toBe(2);
    expect(await inviteStatusForEmail(adminEmail)).toBe('accepted');

    // The consumed link lands on the expired screen; the accepted admin is not bounced from /inicio.
    await page.goto(link1);
    await expectExpiredScreen(page, origin);
    await page.goto(`${origin}/inicio`);
    await expect(page).toHaveURL(`${origin}/inicio`);
  });

  test('2. panel resend supersedes the old link; the new link accepts; the Admins tab shows Aceito em', async ({
    browser,
  }) => {
    test.skip(isRemote, 'local stack only');
    const sfx = Date.now().toString(36);
    const slug = `e2e-inv2-${sfx}`;
    const host = `${slug}.localhost`;
    const origin = throwawayOrigin(host);
    const adminEmail = `admin+${sfx}@e2e-invite.local`;
    // ROLE-03/encoding cross-ref: an accented name in the heading and in the resent mail's subject.
    const displayName = `Associação São José ${sfx}`;
    created.slugs.push(slug);
    created.emails.push(adminEmail);

    const token = await superAdminToken();
    const { id, inviteId } = await createTenant(token, {
      displayName,
      slug,
      adminEmail,
      primary: '#b45309',
      secondary: '#f59e0b',
    });
    await attachAndVerify(token, id, host);
    await waitForInviteStatus(token, id, 'sent');
    const link1 = await waitForInviteLink(adminEmail, null);

    // The super_admin on the platform host: "Convite enviado em …" + an enabled resend button.
    const panel = await browser.newContext();
    const page = await panel.newPage();
    await signIn(page, hosts.platform, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    await page.goto(`${hosts.platform}/plataforma/tenants/${id}/admins`);
    await expect(page.getByText(/^Convite enviado em /)).toBeVisible();
    const resend = page.getByRole('button', { name: 'Reenviar convite' });
    await expect(resend).toBeEnabled();
    await resend.click();
    await expect(page.getByText('Convite reenviado.')).toBeVisible({ timeout: 30_000 });

    const link2 = await waitForInviteLink(adminEmail, link1);
    expect(link2).not.toBe(link1);

    // A fresh context on the tenant origin (no platform cookies): old link expired, new link works.
    const tenant = await browser.newContext();
    const page2 = await tenant.newPage();
    await page2.goto(link1);
    await expectExpiredScreen(page2, origin);

    await page2.goto(link2);
    await expect(page2).toHaveURL(`${origin}/aceitar-convite`);
    const heading = page2.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText(`Você foi convidado(a) a administrar ${displayName}`);
    // E08 overflow / encoding: no horizontal overflow, no truncated code point.
    expect(await heading.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await heading.evaluate((el) => el.textContent)).toBe(
      `Você foi convidado(a) a administrar ${displayName}`,
    );
    await acceptInvite(page2);
    expect(await membershipForEmail(adminEmail)).toEqual({
      role: 'admin_tenant',
      status: 'active',
    });

    // Back on the panel: "Aceito em …", no resend control, the admin listed.
    await page.reload();
    await expect(page.getByText(/^Aceito em /)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reenviar convite' })).toHaveCount(0);
    await expect(page.getByTestId('admins-card').getByText(adminEmail).first()).toBeVisible();

    const refused = await platformApi(
      token,
      `/v1/platform/tenants/${id}/invites/${inviteId}/resend`,
      { method: 'POST' },
    );
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: { details?: { reason?: string } } };
    expect(body.error.details?.reason).toBe('already_accepted');

    // The accepted link is consumed too.
    await page2.goto(link2);
    await expectExpiredScreen(page2, origin);

    await panel.close();
    await tenant.close();
  });

  test('3. pending invite without a verified host: disabled resend + helper; the API answers 409 no_verified_primary', async ({
    page,
  }) => {
    test.skip(isRemote, 'local stack only');
    const sfx = Date.now().toString(36);
    const slug = `e2e-inv3-${sfx}`;
    const adminEmail = `admin+${sfx}@e2e-invite.local`;
    created.slugs.push(slug);
    created.emails.push(adminEmail);

    const token = await superAdminToken();
    const { id, inviteId } = await createTenant(token, {
      displayName: `E2E Pendente ${sfx}`,
      slug,
      adminEmail,
      primary: '#0e7490',
      secondary: '#67e8f9',
    });

    await signIn(page, hosts.platform, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    await page.goto(`${hosts.platform}/plataforma/tenants/${id}/admins`);
    await expect(page.getByText('Convite pendente — aguardando domínio')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reenviar convite' })).toBeDisabled();
    await expect(
      page.getByText('Adicione e verifique um domínio para enviar o convite.'),
    ).toBeVisible();

    const refused = await platformApi(
      token,
      `/v1/platform/tenants/${id}/invites/${inviteId}/resend`,
      { method: 'POST' },
    );
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: { details?: { reason?: string } } };
    expect(body.error.details?.reason).toBe('no_verified_primary');
    expect(await inviteStatusForEmail(adminEmail)).toBe('pending');
  });
});
