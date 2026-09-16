import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { hosts, isRemote, SEED_PASSWORD, signOut, users } from './fixtures';

/**
 * AUTH-01 / AUTH-04 sign-up on a phone viewport (`mobile-chromium`, iPhone 14).
 * `baseURL` is the tria-demo TENANT host, where the public link is `/cadastro` with no slug (D-22).
 */

/**
 * Each case walks a full sign-up (three server round trips plus a Supabase sign-in) against the Next
 * dev server, which compiles routes on demand — the default 30 s budget is not enough on a laptop.
 */
test.describe.configure({ timeout: 120_000 });

const PASSWORD = 'Segredo123';
const createdEmails: string[] = [];
let counter = 0;

function uniqueEmail(): string {
  counter += 1;
  const email = `e2e+${Date.now()}-${counter}@tria-demo.local`;
  createdEmails.push(email);
  return email;
}

/**
 * Local Supabase admin credentials for cleanup. `scripts/local-env.sh --write` generates
 * `apps/api/.env.local`; CI passes the same names through the process environment.
 */
function adminEnv(): { url: string; key: string } | null {
  const fromProcess = {
    url: process.env.SUPABASE_URL ?? '',
    key: process.env.SUPABASE_SERVICE_KEY ?? '',
  };
  if (fromProcess.url && fromProcess.key) return fromProcess;

  const file = fileURLToPath(new URL('../../api/.env.local', import.meta.url));
  if (!existsSync(file)) return null;
  const values: Record<string, string> = {};
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    values[line.slice(0, eq).trim()] = line
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  const url = values.SUPABASE_URL ?? '';
  const key = values.SUPABASE_SERVICE_KEY ?? '';
  return url && key ? { url, key } : null;
}

/** Fills the sign-up form. `consent: false` leaves both checkboxes untouched (AUTH-04). */
async function fillSignup(
  page: Page,
  email: string,
  { password = PASSWORD, consent = true } = {},
): Promise<void> {
  await page.locator('#name').fill('Pessoa de Teste');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  if (consent) {
    await page.locator('#acceptRules').check();
    await page.locator('#acceptTerms').check();
  }
}

test.afterAll(async () => {
  const admin = adminEnv();
  if (!admin || createdEmails.length === 0) return;
  const headers = { apikey: admin.key, Authorization: `Bearer ${admin.key}` };
  const res = await fetch(`${admin.url}/auth/v1/admin/users?page=1&per_page=1000`, { headers });
  if (!res.ok) return;
  const { users: all } = (await res.json()) as { users: Array<{ id: string; email: string }> };
  for (const user of all) {
    if (createdEmails.includes(user.email)) {
      await fetch(`${admin.url}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers });
    }
  }
});

test.describe('AUTH-01/AUTH-04 — sign-up on the tenant host', () => {
  test('1. /cadastro (no slug, D-22) shows the D-02/D-03 form and creates a member', async ({
    page,
  }) => {
    await page.goto('/cadastro');
    await expect(page).toHaveURL(/\/cadastro$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Criar conta');
    await expect(page.getByText('TRIA Demo').first()).toBeVisible();

    // AUTH-04: both consents start unchecked, and the form does not submit without them.
    await expect(page.locator('#acceptRules')).not.toBeChecked();
    await expect(page.locator('#acceptTerms')).not.toBeChecked();
    await fillSignup(page, uniqueEmail(), { consent: false });
    await page.getByRole('button', { name: 'Cadastrar' }).click();
    await expect(page).toHaveURL(/\/cadastro$/);

    // D-03: the rules bottom sheet shows the tenant's own rules text.
    await page.getByRole('button', { name: 'ver regras' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Regras da comunidade TRIA Demo');
    await page.getByRole('button', { name: 'Fechar' }).click();

    await page.locator('#acceptRules').check();
    await page.locator('#acceptTerms').check();
    await page.getByRole('button', { name: 'Cadastrar' }).click();

    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('TRIA Demo', {
      timeout: 20_000,
    });
    // D-42: the role lives on the profile page now, not on the home.
    await page.goto('/perfil');
    await expect(page.getByText('Membro', { exact: true })).toBeVisible();
  });

  test('2. register -> Sair -> login: the tenant survives the round trip through the HOST', async ({
    page,
    context,
  }) => {
    const email = uniqueEmail();
    await page.goto('/cadastro');
    await fillSignup(page, email);
    await page.getByRole('button', { name: 'Cadastrar' }).click();
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });

    await signOut(page);
    await expect(page.getByText('Comunidade: TRIA Demo')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: 'Criar nova conta' })).toHaveAttribute(
      'href',
      '/cadastro',
    );
    // D-22: on a tenant domain the host carries the tenant — no cookie is involved.
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === 'tenant_slug')).toBeUndefined();

    await page.locator('#email').fill(email);
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('TRIA Demo', {
      timeout: 20_000,
    });
  });

  test('3. D-04 duplicate: generic message with a link to /entrar, never naming the other tenant', async ({
    page,
  }) => {
    await page.goto('/cadastro');
    await fillSignup(page, users.demoMember);
    await page.getByRole('button', { name: 'Cadastrar' }).click();

    await expect(page).toHaveURL(/\/cadastro\?erro=email-existente$/, { timeout: 30_000 });
    await expect(page.locator('p[role="alert"]')).toContainText(
      'Este e-mail já está cadastrado. Entre com sua senha.',
    );
    await expect(
      page.locator('p[role="alert"]').getByRole('link', { name: 'Entrar' }),
    ).toBeVisible();

    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toContain('tria-lab');
    expect(body).not.toContain('tria lab');
  });

  test('4. D-22: the host wins — /cadastro/tria-lab on the tria-demo host lands on /cadastro', async ({
    page,
  }) => {
    await page.goto('/cadastro/tria-lab');
    await expect(page).toHaveURL(/\/cadastro$/);
    await expect(page.getByText('TRIA Demo').first()).toBeVisible();
  });

  test('5. D-10: the show-password toggle flips the input type and 7 characters are refused', async ({
    page,
  }) => {
    await page.goto('/cadastro');
    const password = page.locator('#password');
    await expect(password).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Mostrar senha' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Ocultar senha' }).click();
    await expect(password).toHaveAttribute('type', 'password');

    await fillSignup(page, uniqueEmail(), { password: '1234567' });
    await expect(page.getByText('A senha deve ter pelo menos 8 caracteres.')).toBeVisible();
    await page.getByRole('button', { name: 'Cadastrar' }).click();
    await expect(page).toHaveURL(/\/cadastro$/);
  });
});

test.describe('D-01/D-06/D-21 — generic and platform hosts', () => {
  test('6. generic host keeps /cadastro/{slug} and remembers the slug in a cookie', async ({
    page,
    context,
  }) => {
    test.skip(isRemote, 'local stack only');

    await page.goto(`${hosts.generic}/cadastro/tria-demo`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Criar conta');
    await expect(page.getByText('TRIA Demo').first()).toBeVisible();
    const cookie = (await context.cookies()).find((c) => c.name === 'tenant_slug');
    expect(cookie?.value).toBe('tria-demo');

    const email = uniqueEmail();
    await fillSignup(page, email);
    await page.getByRole('button', { name: 'Cadastrar' }).click();
    await expect(page).toHaveURL(/\/inicio$/, { timeout: 30_000 });

    // D-06: on a generic host the COOKIE carries the tenant across the round trip.
    await signOut(page, hosts.generic);
    await expect(page.getByText('Comunidade: TRIA Demo')).toBeVisible({ timeout: 20_000 });
    const href = await page.getByRole('link', { name: 'Criar nova conta' }).getAttribute('href');
    expect(href?.endsWith('/cadastro/tria-demo')).toBe(true);
  });

  test('7. generic host: an unknown slug and a mixed-case slug are both "não encontrada"', async ({
    page,
  }) => {
    test.skip(isRemote, 'local stack only');

    await page.goto(`${hosts.generic}/cadastro/nao-existe`);
    await expect(page.getByText('Comunidade não encontrada.')).toBeVisible();

    // Adjacency (T-04-07): slugs are lowercase-only, `Tria-Demo` is a miss, not an alias.
    await page.goto(`${hosts.generic}/cadastro/Tria-Demo`);
    await expect(page.getByText('Comunidade não encontrada.')).toBeVisible();
  });

  test('8. D-21: the platform host offers no member sign-up', async ({ page }) => {
    test.skip(isRemote, 'local stack only');

    await page.goto(`${hosts.platform}/cadastro`);
    await expect(page).toHaveURL(/\/entrar$/);

    await page.goto(`${hosts.platform}/cadastro/tria-demo`);
    await expect(page).toHaveURL(/\/entrar$/);
  });
});

// Referenced so the seeded password stays a required input of this suite (fixtures throws without it).
void SEED_PASSWORD;
