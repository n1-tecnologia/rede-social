import { expect, type Page } from '@playwright/test';
import { hosts } from './fixtures';

/**
 * The new-tenant wizard, driven the way a person drives it: Dados → Personalização → Domínio →
 * Resumo, and the tenant exists only after the summary's confirmation, on
 * `/plataforma/novo/{id}/convite`. Nothing before that confirmation reaches the API.
 */

/** The invite step after creation; group 1 is the new tenant's id. */
export const WIZARD_INVITE_PATH =
  /\/plataforma\/novo\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/convite/;

export type WizardFile = { name: string; mimeType: string; buffer: Buffer };

/** What Personalização and Domínio take; every field optional (the defaults pass). */
export type WizardOptions = {
  primary?: string;
  secondary?: string;
  logo?: WizardFile;
  host?: string;
};

/** Fills Dados (`/plataforma/novo` must be open): name, slug and first-admin e-mail. */
export async function fillTenantData(
  page: Page,
  input: { name: string; slug: string; email: string },
): Promise<void> {
  // The draft is read back from the tab's session right after hydration: type only after it.
  await expect(page.locator('form[data-draft-ready]')).toBeVisible();
  await page.locator('#displayName').fill(input.name);
  await page.locator('#slug').fill(input.slug);
  await page.locator('#adminEmail').fill(input.email);
}

/** Dados' "Continuar": the draft is validated (nothing is created) and Personalização opens. */
export async function continueFromData(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page).toHaveURL(/\/plataforma\/novo\/marca$/, { timeout: 30_000 });
  await expect(page.locator('form[data-draft-ready]')).toBeVisible();
}

/** Personalização (open): colours and logo when given; nothing else is touched. */
export async function personalize(page: Page, opts: WizardOptions = {}): Promise<void> {
  if (opts.primary) await page.locator('#primary').fill(opts.primary);
  if (opts.secondary) await page.locator('#secondary').fill(opts.secondary);
  if (opts.logo) {
    await page.locator('[data-wizard-image="logo"] input[type="file"]').setInputFiles(opts.logo);
    await expect(page.locator('[data-wizard-image="logo"] img')).toBeVisible();
  }
}

/** Personalização's "Continuar": the colours are checked (nothing is created) and Domínio opens. */
export async function continueFromPersonalization(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page).toHaveURL(/\/plataforma\/novo\/dominio$/, { timeout: 30_000 });
  await expect(page.locator('form[data-draft-ready]')).toBeVisible();
}

/**
 * From Personalização to the invite step: optionally sets the colours, picks a logo and records a
 * host, reaches Resumo, opens the confirmation and confirms. Resolves with the created tenant's id.
 */
export async function finishWizard(page: Page, opts: WizardOptions = {}): Promise<string> {
  await expect(page).toHaveURL(/\/plataforma\/novo\/marca$/);
  await personalize(page, opts);
  await continueFromPersonalization(page);
  if (opts.host) await page.locator('#host').fill(opts.host);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page).toHaveURL(/\/plataforma\/novo\/resumo$/);
  await page.getByRole('button', { name: 'Criar tenant', exact: true }).click();
  await page.locator('[data-create-confirm]').click();
  await expect(page).toHaveURL(WIZARD_INVITE_PATH, { timeout: 60_000 });
  const id = page.url().match(WIZARD_INVITE_PATH)?.[1];
  if (!id) throw new Error(`no tenant id in ${page.url()}`);
  return id;
}

/** The whole wizard from an empty `/plataforma/novo`; resolves with the new tenant's id. */
export async function createTenantThroughWizard(
  page: Page,
  input: { name: string; slug: string; email: string },
  opts: WizardOptions = {},
): Promise<string> {
  await page.goto(`${hosts.platform}/plataforma/novo`);
  await fillTenantData(page, input);
  await continueFromData(page);
  return finishWizard(page, opts);
}
