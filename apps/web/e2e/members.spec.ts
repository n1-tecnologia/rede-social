import { expect, type Page, test } from '@playwright/test';
import { closeAdmin, membershipIdFor } from './admin';
import { hosts, login, SEED_PASSWORD, users } from './fixtures';

/**
 * PROF-02 / PROF-03 (plan 03-05): the member directory `/membros` and another member's profile
 * `/membros/[membershipId]`, on the phone (`mobile-chromium`, an iPhone 14 preset) and on the
 * desktop.
 *
 * Everything here runs against the SEEDED `tria-demo` community, which `scripts/seed.ts` fills with
 * names that actually need folding (`João Gonçalves`, `Íris Muñoz`) — a search suite over ASCII-only
 * data would prove nothing about `app.imm_unaccent`. Nothing in this file writes: it only reads the
 * directory, so the shared seed stays exactly as it was.
 */

/** What `scripts/seed.ts` writes for the demo tenant. */
const SEEDED = {
  goncalves: 'João Gonçalves',
  goncalvesBio: 'Organizo os encontros de sábado.',
  goncalvesEmail: 'joao.goncalves@tria-demo.local',
  munoz: 'Íris Muñoz',
  admin: 'Admin TRIA Demo',
  noBio: 'Ana Paula Ferreira',
} as const;

/** The search pill — named by its catalog `aria-label`, so a copy drift fails here. */
function searchField(page: Page) {
  return page.getByLabel('Buscar por nome');
}

/** Every directory row is ONE link to `/membros/{id}` (the whole row is the target). */
function rows(page: Page) {
  return page.locator('main a[href^="/membros/"]');
}

test.describe('PROF-03 — the member directory /membros', () => {
  test.afterAll(async () => {
    await closeAdmin();
  });

  test('is reached from the "Membros" row on /perfil and hides the community staff (D-47)', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/perfil');
    await page.locator('main').getByRole('link', { name: 'Membros' }).click();

    await expect(page).toHaveURL(/\/membros$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Membros' })).toBeVisible();

    // The seeded community members are all there…
    await expect(page.locator('main').getByText(SEEDED.goncalves)).toBeVisible();
    await expect(page.locator('main').getByText(SEEDED.munoz)).toBeVisible();
    await expect(rows(page).first()).toBeVisible();

    // …and the tenant's ADMIN is not: staff are excluded by predicate, so their absence carries no
    // signal and no row is conditioned on a role (D-45/D-47, T-03-35).
    await expect(page.locator('main').getByText(SEEDED.admin)).toHaveCount(0);
    await expect(page.locator('main').getByText(/^(Administrador|Suporte)$/)).toHaveCount(0);

    // A member without a bio renders a single-line row — no invented placeholder (E4/partial).
    await expect(page.locator('main').getByText(SEEDED.noBio)).toBeVisible();
  });

  test('an unaccented fragment finds an accented name, and the query lives in the URL (R-10)', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/membros');
    await expect(rows(page).first()).toBeVisible();
    const before = await rows(page).count();
    expect(before).toBeGreaterThan(1);

    await searchField(page).fill('goncal');

    // The debounce writes the term into the URL; the URL is the source of truth, not the field.
    await expect(page).toHaveURL(/\?q=goncal$/);
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator('main').getByText(SEEDED.goncalves)).toBeVisible();

    // The directory makes no promise of highlighting, and keeps none: the name is plain text.
    await expect(page.locator('main mark')).toHaveCount(0);

    // "Limpar busca" restores the full list and drops `q` from the URL entirely.
    await page.getByRole('button', { name: 'Limpar busca' }).click();
    await expect(page).toHaveURL(/\/membros$/);
    await expect(rows(page)).toHaveCount(before);
  });
});

test.describe('PROF-02 — another member at /membros/[membershipId]', () => {
  test.afterAll(async () => {
    await closeAdmin();
  });

  test('opens from the directory row and shows a photo, a name and a bio — nothing else (D-45)', async ({
    page,
  }) => {
    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto('/membros?q=goncal');
    await expect(rows(page).first()).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
    await rows(page).first().click();

    await expect(page).toHaveURL(/\/membros\/[0-9a-f-]{36}$/);

    // The display name is the screen's ONE 24px element and its ONE h1.
    const name = page.locator('main .text-2xl');
    await expect(name).toHaveCount(1);
    await expect(name).toHaveText(SEEDED.goncalves);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(SEEDED.goncalves);

    await expect(page.locator('main').getByText(SEEDED.goncalvesBio)).toBeVisible();

    // No e-mail (D-46: the e-mail is the owner's identity anchor, never a member-visible fact),
    // no role word, no follow or message affordance.
    const main = page.locator('main');
    await expect(main.getByText(SEEDED.goncalvesEmail)).toHaveCount(0);
    await expect(main.getByText(/@tria-demo\.local/)).toHaveCount(0);
    await expect(main.getByText(/^(Administrador|Membro|Suporte)$/)).toHaveCount(0);
    await expect(main.getByRole('button', { name: /Seguir|Mensagem/ })).toHaveCount(0);
  });

  test("the caller's own membershipId redirects to /perfil (UI-D-03)", async ({ page }) => {
    const own = await membershipIdFor(users.demoMember, 'tria-demo');

    await login(page, users.demoMember, SEED_PASSWORD, hosts.demo);
    await page.goto(`/membros/${own}`);

    await expect(page).toHaveURL(/\/perfil$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Perfil' })).toBeVisible();
  });
});
