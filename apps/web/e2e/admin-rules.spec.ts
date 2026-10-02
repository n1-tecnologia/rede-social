import { type Browser, expect, type Page, test } from '@playwright/test';
import postgres from 'postgres';
import { closeAdmin } from './admin';
import { isRemote, login } from './fixtures';
import {
  closeMembersAdmin,
  createMembersTenant,
  deleteMembersTenant,
  type MembersTenant,
  membersTenantSlug,
  sweepMembersTenants,
} from './members-admin';
import { closeTenantFixtures } from './tenant-fixtures';

/**
 * 08-07 — the community rules on the tenant lane (ADMIN-03, D-341, UI-D-280/281): the admin edits
 * the rules from Configurações → Regras da comunidade, previews them exactly as `/cadastro` shows
 * them, and the next sign-up accepts the new text at the new version.
 *
 * The subject is a THROWAWAY community with its own admin (`createMembersTenant(…, 0)`, the 08-06
 * precedent), never a seed tenant: other specs and suites read rede-demo's rules and present its
 * version 1 as the current one, so a version bump there would leak into them. The API integration
 * suite (`admin-rules.test.ts`) proves the same flow on `admin@rede-demo.local` itself and restores
 * the seed afterwards. Each project gets its own tenant and host, unique per run (`membersTenantSlug`:
 * the host caches never point a new run at a deleted tenant). `/cadastro` on that host is the tenant's
 * own public sign-up (the proxy rewrites it to `/cadastro/{slug}`).
 */

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.skip(isRemote, 'local stack only');

const PREFIX = 'regr';
let tenant: MembersTenant;

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 1 },
  );
  return client;
}

async function storedRules(slug: string): Promise<{ text: string; version: number }> {
  const [row] = await sql()<{ rules_text: string; rules_version: number }[]>`
    select rules_text, rules_version from public.tenants where slug = ${slug}`;
  if (!row) throw new Error(`no tenant ${slug}`);
  return { text: row.rules_text, version: row.rules_version };
}

async function tenantRulesConsentVersion(email: string): Promise<number | null> {
  const [row] = await sql()<{ text_version: number }[]>`
    select c.text_version from public.consent_records c
      join public.users u on u.id = c.user_id
     where u.email = ${email} and c.kind = 'tenant_rules'`;
  return row?.text_version ?? null;
}

/**
 * After a full navigation the textarea exists before React hydrated it; a fill dispatched in that
 * window is lost. React tags hydrated DOM nodes with its internal props key (the 02-14 probe).
 */
async function waitForHydration(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return el !== null && Object.keys(el).some((key) => key.startsWith('__reactProps'));
    },
    selector,
    { timeout: 30_000 },
  );
}

function saveButton(page: Page) {
  return page.getByRole('button', { name: 'Salvar regras', exact: true });
}

async function openRegras(page: Page): Promise<void> {
  await page.goto(`${tenant.origin}/configuracoes/regras`);
  await expect(
    page.getByRole('heading', { name: 'Regras da comunidade', exact: true }),
  ).toBeVisible();
  await waitForHydration(page, '#rulesText');
}

/** Types `text` into the editor and saves it; resolves once the success toast is up. */
async function saveRules(page: Page, text: string): Promise<void> {
  await page.locator('#rulesText').fill(text);
  await expect(saveButton(page)).toBeEnabled();
  await saveButton(page).click();
  await expect(
    page.getByText('Regras salvas. Valem para quem entrar a partir de agora.').first(),
  ).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();
}

/** The paragraph texts of the open rules sheet (preview or `/cadastro`), in order. */
function sheetParagraphs(page: Page): Promise<string[]> {
  return page.getByRole('dialog').locator('p').allInnerTexts();
}

/** Whether the open sheet's body scrolls inside its 80% height (the BottomSheet scroll container). */
function sheetScrolls(page: Page): Promise<boolean> {
  return page
    .getByRole('dialog')
    .locator('div.overflow-y-auto')
    .first()
    .evaluate((el) => el.scrollHeight > el.clientHeight);
}

/**
 * Fails the NEXT server action whose body carries `marker` — the save action's argument is the rules
 * text, nothing else on the page sends it (the feed-comments `failNextActions` rule, T-07-79).
 * Answered with a 500, never aborted.
 */
async function failNextActions(page: Page, marker: string) {
  let failed = 0;
  const handler = async (route: import('@playwright/test').Route) => {
    const request = route.request();
    if (
      failed < 1 &&
      request.method() === 'POST' &&
      request.headers()['next-action'] &&
      (request.postData() ?? '').includes(marker)
    ) {
      failed += 1;
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'forced failure' });
      return;
    }
    await route.fallback();
  };
  await page.route('**/*', handler);
  return { restore: () => page.unroute('**/*', handler), failedCount: () => failed };
}

/** The tenant's `/cadastro` in a signed-out context: returns the page with the rules sheet open. */
async function openSignupRules(
  browser: Browser,
  viewport?: { width: number; height: number },
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  await page.goto(`${tenant.origin}/cadastro`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Criar conta');
  await page.getByRole('button', { name: 'ver regras' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  return { page, close: () => context.close() };
}

test.beforeAll(async ({ browserName: _browserName }, testInfo) => {
  await sweepMembersTenants(
    `${PREFIX}-${testInfo.project.name.replace(/[^a-z0-9]/g, '').slice(0, 10)}`,
  );
  tenant = await createMembersTenant(
    membersTenantSlug(PREFIX, testInfo.project.name),
    'Segredo123',
    0,
  );
});

test.afterAll(async () => {
  if (tenant) await deleteMembersTenant(tenant.slug);
  await client?.end();
  client = null;
  await closeAdmin();
  await closeMembersAdmin();
  await closeTenantFixtures();
});

test.describe('08-07 — Regras da comunidade', () => {
  test('rules tracer: the admin saves new rules and the next sign-up reads and accepts them at the new version', async ({
    page,
    browser,
  }) => {
    const run = Date.now().toString(36);
    const marker = `Regra nova ${run}: trate todos com respeito.`;
    const before = await storedRules(tenant.slug);

    await login(page, tenant.admin.email, tenant.password, tenant.origin);

    // D-339: the row sits in the Administração group and opens the full screen.
    await page.goto(`${tenant.origin}/configuracoes`);
    const row = page.getByRole('link', { name: 'Regras da comunidade', exact: true });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(`${tenant.origin}/configuracoes/regras`);
    await waitForHydration(page, '#rulesText');

    await expect(page.getByText(`Versão ${before.version} em vigor`)).toBeVisible();
    // Unchanged text cannot be saved (D-341: no empty version bump from the UI).
    await expect(saveButton(page)).toBeDisabled();

    await page.locator('#rulesText').fill(`${marker}\n\nSegundo parágrafo ${run}.`);
    await expect(saveButton(page)).toBeEnabled();
    await saveButton(page).click();

    await expect(
      page.getByText('Regras salvas. Valem para quem entrar a partir de agora.').first(),
    ).toBeVisible();
    await expect(page.getByText(`Versão ${before.version + 1} em vigor`)).toBeVisible();
    await expect(saveButton(page)).toBeDisabled();
    expect(await storedRules(tenant.slug)).toEqual({
      text: `${marker}\n\nSegundo parágrafo ${run}.`,
      version: before.version + 1,
    });

    // A visitor on the tenant's /cadastro reads the new text in the rules sheet, then signs up.
    const visitor = await openSignupRules(browser);
    try {
      await expect(visitor.page.getByRole('dialog')).toContainText(marker);
      await visitor.page.getByRole('button', { name: 'Fechar' }).click();
      const email = `novo-${run}@${tenant.slug}.local`;
      await visitor.page.locator('#name').fill('Pessoa Nova');
      await visitor.page.locator('#email').fill(email);
      await visitor.page.locator('#password').fill('Segredo123');
      await visitor.page.locator('#acceptRules').check();
      await visitor.page.locator('#acceptTerms').check();
      await visitor.page.getByRole('button', { name: 'Cadastrar' }).click();
      await expect(visitor.page).toHaveURL(/\/inicio$/, { timeout: 30_000 });
      expect(await tenantRulesConsentVersion(email)).toBe(before.version + 1);
    } finally {
      await visitor.close();
    }
  });

  test('the preview shows exactly what /cadastro shows: blank-line paragraphs, single breaks kept', async ({
    page,
    browser,
  }) => {
    const run = Date.now().toString(36);
    const text = `Combinados ${run}:\n1. Respeite as pessoas.\n2. Sem propaganda.\n\nDúvidas? Fale com o suporte ${run}.`;
    await login(page, tenant.admin.email, tenant.password, tenant.origin);
    await openRegras(page);
    await saveRules(page, text);

    await page.getByRole('button', { name: 'Ver como os novos membros veem' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText(
      // `createMembersTenant` names the community `Comunidade {slug}`.
      `Regras da comunidade Comunidade ${tenant.slug}`,
    );
    const preview = await sheetParagraphs(page);
    expect(preview).toEqual([
      `Combinados ${run}:\n1. Respeite as pessoas.\n2. Sem propaganda.`,
      `Dúvidas? Fale com o suporte ${run}.`,
    ]);
    await page.getByRole('dialog').getByRole('button', { name: 'Fechar' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const visitor = await openSignupRules(browser);
    try {
      expect(await sheetParagraphs(visitor.page)).toEqual(preview);
    } finally {
      await visitor.close();
    }
  });

  test('the save stays disabled while the draft equals the saved text', async ({ page }) => {
    await login(page, tenant.admin.email, tenant.password, tenant.origin);
    await openRegras(page);
    const field = page.locator('#rulesText');
    const saved = await field.inputValue();
    await expect(saveButton(page)).toBeDisabled();

    await field.fill(`${saved} mais`);
    await expect(saveButton(page)).toBeEnabled();
    // Back to the saved text, padded: the editor compares the normalised draft, so nothing to save.
    await field.fill(`  ${saved}\n\n`);
    await expect(saveButton(page)).toBeDisabled();
    await field.fill('   ');
    await expect(saveButton(page)).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Ver como os novos membros veem' }),
    ).toBeDisabled();
  });

  test('a failed save toasts and keeps the draft; nothing is stored', async ({ page }) => {
    const marker = `Rascunho que falha ${Date.now().toString(36)}`;
    await login(page, tenant.admin.email, tenant.password, tenant.origin);
    await openRegras(page);
    const before = await storedRules(tenant.slug);

    await page.locator('#rulesText').fill(marker);
    const forced = await failNextActions(page, marker);
    try {
      await saveButton(page).click();
      await expect(
        page.getByText('Não foi possível salvar as regras. Tente novamente.').first(),
      ).toBeVisible();
    } finally {
      await forced.restore();
    }
    expect(forced.failedCount()).toBe(1);
    await expect(page.locator('#rulesText')).toHaveValue(marker);
    await expect(saveButton(page)).toBeEnabled();
    await expect(page.getByText(`Versão ${before.version} em vigor`)).toBeVisible();
    expect(await storedRules(tenant.slug)).toEqual(before);
  });

  test('E14 backstop: 10,000 characters read the same in the preview and on /cadastro, and both sheets scroll at 320×568', async ({
    page,
    browser,
  }) => {
    const viewport = { width: 320, height: 568 };
    // 40 paragraphs of "Regra NN: " + filler, joined by blank lines, padded to exactly 10,000.
    const blocks = Array.from({ length: 40 }, (_, i) =>
      `Regra ${String(i + 1).padStart(2, '0')}: ${'texto '.repeat(39)}`.trim(),
    );
    let text = blocks.join('\n\n');
    text = `${text} ${'x'.repeat(10_000 - text.length - 1)}`;
    expect(text.length).toBe(10_000);

    await page.setViewportSize(viewport);
    await login(page, tenant.admin.email, tenant.password, tenant.origin);
    await openRegras(page);
    await saveRules(page, text);
    expect((await storedRules(tenant.slug)).text).toBe(text);

    await page.getByRole('button', { name: 'Ver como os novos membros veem' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const preview = await sheetParagraphs(page);
    expect(preview).toHaveLength(40);
    expect(await sheetScrolls(page)).toBe(true);

    const visitor = await openSignupRules(browser, viewport);
    try {
      const signup = await sheetParagraphs(visitor.page);
      expect(signup).toHaveLength(preview.length);
      expect(signup).toEqual(preview);
      expect(await sheetScrolls(visitor.page)).toBe(true);
    } finally {
      await visitor.close();
    }
  });
});
