import { expect, type Page } from '@playwright/test';

/** Seed password (scripts/seed.ts). Passed on the command line, never stored. */
export const SEED_PASSWORD: string = (() => {
  const value = process.env.SEED_PASSWORD;
  if (!value) {
    throw new Error(
      'SEED_PASSWORD is required for the e2e suite (same value used by `pnpm db:seed`)',
    );
  }
  return value;
})();

/** Seeded users (01-01). */
export const users = {
  demoMember: 'member@tria-demo.local',
  demoAdmin: 'admin@tria-demo.local',
  labMember: 'member@tria-lab.local',
  labAdmin: 'admin@tria-lab.local',
} as const;

/**
 * The feed posts `scripts/seed.ts` writes for BOTH seed tenants (04-01). The captions are identical
 * on the two sides on purpose — that is what makes "a lab member never sees the demo post" an honest
 * assertion about tenancy rather than about copy — so an e2e that asserts a caption must ALSO assert
 * which tenant it is on. `newest` is the second entry, one minute after `oldest`, so it heads the
 * feed.
 *
 * Mirrored here rather than imported: `scripts/seed.ts` is a top-level-await script that requires
 * `SEED_PASSWORD` and opens a database connection at import time. This is the same convention
 * `members.spec.ts`'s `SEEDED` block uses for the seeded member names.
 */
export const seededFeed = {
  oldest: 'Bem-vindos! Esta é a primeira publicação da comunidade.',
  newest: 'Encontro de sábado confirmado. Levem água e um caderno.',
  demoAuthor: 'Admin TRIA Demo',
  labAuthor: 'Admin TRIA Lab',
} as const;

/**
 * 04-04's media fixtures, identical in both tenants (SCHEMA-CONVENTIONS §(j)). The captions are what
 * `scripts/seed.ts` writes; the filename is the 94-character one UI-SPEC E07's long-text row needs.
 */
export const seededFeedMedia = {
  textOnlyCaption: 'Bem-vindos! Esta é a primeira publicação da comunidade.',
  galleryCaption: 'Fotos do ultimo encontro da comunidade.',
  videoCaption: 'Um recado rapido em video para todo mundo.',
  attachmentCaption: 'Segue o calendario do semestre em PDF.',
  attachmentFilename:
    'calendario-completo-do-semestre-com-todas-as-atividades-e-os-encontros-da-nossa-comunidade.pdf',
} as const;

/** Distinct origins (D-20/D-21). Chromium resolves `*.localhost` to loopback without /etc/hosts. */
export const hosts = {
  demo: process.env.PLAYWRIGHT_DEMO_URL ?? 'http://tria-demo.localhost:3000',
  lab: process.env.PLAYWRIGHT_LAB_URL ?? 'http://tria-lab.localhost:3000',
  platform: process.env.PLAYWRIGHT_PLATFORM_URL ?? 'http://tria.localhost:3000',
  generic: process.env.PLAYWRIGHT_GENERIC_URL ?? 'http://localhost:3000',
} as const;

/** Specs that need the local generic/lab/platform hosts call `test.skip(isRemote, 'local stack only')`. */
export const isRemote = Boolean(process.env.PLAYWRIGHT_BASE_URL);

/** Absolute origin of the tenant under test (for contexts created with `browser.newContext()`). */
export const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? hosts.demo;

/** Fills the `/entrar` form and waits for the landing path (`/inicio` by default). */
export async function login(
  page: Page,
  email: string,
  password: string,
  origin?: string,
  expectedPath = '/inicio',
): Promise<void> {
  await page.goto(`${origin ?? ''}/entrar`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(new RegExp(`${expectedPath.replace(/\//g, '\\/')}$`));
}

/**
 * "Sair" lives on `/configuracoes` (D-42): opens the settings page on `origin`, clicks the main-column
 * button (the desktop rail carries a second "Sair", so the locator is scoped to `main`) and waits for
 * `/entrar`. Device-local sign-out (D-08).
 */
export async function signOut(page: Page, origin = ''): Promise<void> {
  await page.goto(`${origin}/configuracoes`);
  await page.locator('main').getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/entrar$/);
}
