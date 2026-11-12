import { expect, type Page, test } from '@playwright/test';
import postgres from 'postgres';
import communitiesMessages from '../messages/pt-BR/communities.json' with { type: 'json' };
import platformModulesSocial from '../messages/pt-BR/platformModules.social.json' with {
  type: 'json',
};
import socialMessages from '../messages/pt-BR/social.json' with { type: 'json' };
import storiesMessages from '../messages/pt-BR/stories.json' with { type: 'json' };
import { closeAdmin, createFeedPostAs, envValue, getTenantModuleFlag } from './admin';
import { closeFeedAdmin } from './feed-admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import { untilHydrated } from './hydration';
import {
  closeJourneyAdmin,
  createCommunityHighlightWith,
  createMemberCommunityAs,
  createMemberStoryAs,
  dropJourneyTenant,
  JOURNEY_PREFIX,
  type JourneyTenant,
  journeySlug,
  provisionJourneyTenant,
} from './member-journey';
import { closeSocialAdmin } from './social-admin';
import {
  closeTenantFixtures,
  createThrowawayTenant,
  deleteTenantBySlug,
  setTenantModuleFlag,
} from './tenant-fixtures';

/**
 * Phase 09 - Rede social, the platform panel's side (plan 09-12, UI-D-505, D-474, D-478, D-482).
 *
 * **Tracer (Task 1).** The `super_admin` opens a tenant's Módulos tab and finds the "Rede social"
 * row; switching it on opens the shipped `ConfirmDialog` with the exact copy instead of writing;
 * Cancel leaves it off and writes nothing; Confirm turns it on with the "Alterações salvas." toast
 * and the tenant's `social` flag (the row the bootstrap lists) reads on; switching it off needs no
 * dialog; while Feed is off the switch is disabled and the row explains why.
 *
 * **Limits (Task 2).** The "Configurar limites" button is absent while `social` is off and present
 * while it is on; the sheet opens with the saved values (the defaults for an empty blob), shows the
 * video fields only while "Permitir vídeo" is on, refuses an out-of-range value inline and stays
 * open, keeps itself open with the error toast when the save fails, and on success closes with
 * "Limites salvos." having written the byte values into `tenant_modules.settings`. It has no
 * horizontal scroll at 320px. A last case saves a 1 MB photo cap on the seeded lab through the sheet
 * and proves the upload broker honors it (SOCIAL-05, D-474): a lab member's 2 MB photo is refused and
 * a 500 KB one is accepted, and saving the defaults again lifts the refusal.
 *
 * **Held back to plan 09-09.** The member composer ("Até 4 fotos de 1 MB cada." and the pick-time
 * refusal of a 2 MB photo) does not exist until that plan; this spec proves the layer under it, the
 * broker, with the same member token the composer will use. The composer assertion belongs in
 * `social.spec.ts` with 09-09.
 *
 * The first cases run on a THROWAWAY tenant (`tenant-fixtures.ts`): the seed tenants are shared by
 * the whole suite and their flags sit in the API's 30 s cache. The broker case edits the seeded
 * rede-lab's `social` SETTINGS only (never its flags) and writes the original blob back in
 * `afterAll`. `afterAll` deletes what was created. Local stack only (the fixtures write through the
 * admin connection).
 */

test.skip(isRemote, 'local stack only (the tenant fixtures write through the admin connection)');
test.describe.configure({ timeout: 120_000 });
test.use({ serviceWorkers: 'block' });

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

/** Per-run suffix, stable across worker restarts; the projects never share a slug. */
const rand = process.ppid.toString(36);
const slugFor = (project: string, name: string) =>
  `e2e-soc-${name}-${rand}${project.startsWith('mobile') ? 'm' : 'd'}`;

const MIB = 1024 * 1024;
const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';
/** The marker the pending assets this spec starts carry (the sweep's key). */
const ASSET_FILENAME = 'social-platform-09-12.jpg';

const SOCIAL_SWITCH = 'Ativar ou desativar Rede social';
const LIMITS_BUTTON = 'Configurar limites';
const LIMITS_TITLE = 'Limites dos membros';
const SAVE_LIMITS = 'Salvar limites';
const F_PHOTOS = 'Fotos por publicação';
const F_PHOTO_MB = 'Tamanho máximo da foto, em MB';
const F_VIDEO = 'Permitir vídeo';
const F_SECONDS = 'Duração máxima do vídeo, em segundos';
const F_VIDEO_MB = 'Tamanho máximo do vídeo, em MB';
const CONFIRM_TITLE = (tenant: string) => `Ativar a Rede social em ${tenant}?`;
const CONFIRM_BODY =
  'Os membros passarão a seguir uns aos outros e a publicar conteúdo próprio. Antes de ativar, revise os termos de uso, as regras da comunidade e a política de privacidade para conteúdo de terceiros (item “Ativar a Rede social” em docs/DEPLOY.md).';

async function signInSuperAdmin(page: Page): Promise<void> {
  await page.goto(`${hosts.platform}/entrar`);
  await page.locator('#email').fill(SUPER_ADMIN_EMAIL);
  await page.locator('#password').fill(SUPER_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/entrar'), { timeout: 30_000 });
}

async function openModulesTab(page: Page, tenantId: string): Promise<void> {
  await page.goto(`${hosts.platform}/plataforma/tenants/${tenantId}/modulos`);
  await expect(page.getByRole('switch', { name: SOCIAL_SWITCH })).toBeVisible();
}

/** A throwaway tenant with Feed ON and no `social` row (the state of a tenant the panel just made). */
async function makeTenant(
  project: string,
  name: string,
  opts: { feed: boolean },
): Promise<{ id: string; slug: string; displayName: string }> {
  const slug = slugFor(project, name);
  const displayName = `Social ${name} ${rand}`;
  const { id } = await createThrowawayTenant({
    slug,
    displayName,
    hosts: [],
    colors: { primary: '#7c3aed', secondary: '#a78bfa' },
  });
  await setTenantModuleFlag(slug, 'feed', opts.feed);
  return { id, slug, displayName };
}

/** Superuser connection for reading the stored settings (fixtures only, the other admin helpers' posture). */
let db: ReturnType<typeof postgres> | null = null;
function sql() {
  db ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 1 },
  );
  return db;
}

type StoredSettings = {
  communities?: { maxPerMember?: number };
  media?: {
    photoMaxBytes?: number;
    photosPerPost?: number;
    video?: { enabled?: boolean; maxDurationSeconds?: number; maxBytes?: number };
  };
};

/** `tenant_modules.settings` of the `social` row of one tenant, or null when there is no row. */
async function socialSettingsOf(slug: string): Promise<StoredSettings | null> {
  const rows = await sql()<{ settings: StoredSettings }[]>`
    select tm.settings from public.tenant_modules tm
      join public.tenants t on t.id = tm.tenant_id
     where t.slug = ${slug} and tm.module_key = 'social'`;
  return rows[0]?.settings ?? null;
}

async function tenantIdOf(slug: string): Promise<string> {
  const rows = await sql()<{ id: string }[]>`select id from public.tenants where slug = ${slug}`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`no tenant ${slug}`);
  return id;
}

/** The lab's stored `social` settings before this spec touched them, written back in `afterAll`. */
let labSettingsBefore: StoredSettings | null | undefined;

async function restoreLabSettings(): Promise<void> {
  if (labSettingsBefore === undefined) return;
  await sql()`
    update public.tenant_modules tm set settings = ${sql().json((labSettingsBefore ?? {}) as never)}
      from public.tenants t
     where t.id = tm.tenant_id and t.slug = 'rede-lab' and tm.module_key = 'social'`;
  labSettingsBefore = undefined;
}

/** Removes the pending assets the broker case started (no object was ever uploaded for them). */
async function sweepAssets(): Promise<void> {
  await sql()`delete from public.media_assets where filename = ${ASSET_FILENAME}`;
}

/** A real GoTrue session for one seeded user (Node side, no browser). */
async function tokenFor(email: string): Promise<string> {
  const res = await fetch(`${envValue('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: envValue('SUPABASE_PUBLISHABLE_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: SEED_PASSWORD }),
  });
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** `POST /v1/media/uploads` for a post photo of `size` bytes, as `token` on the rede-lab host. */
async function startPostPhoto(token: string, size: number): Promise<Response> {
  return fetch(`${API_URL}/v1/media/uploads`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': new URL(hosts.lab).hostname,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      kind: 'image',
      purpose: 'post',
      mime: 'image/jpeg',
      size,
      filename: ASSET_FILENAME,
    }),
  });
}

const limitsDialog = (page: Page) => page.getByRole('dialog', { name: LIMITS_TITLE });
const numberField = (page: Page, name: string) => page.getByRole('textbox', { name });
const saveLimits = (page: Page) => page.getByRole('button', { name: SAVE_LIMITS });

test.beforeAll(() => {
  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required (same value used by `pnpm db:seed`)');
  }
});

test.afterAll(async ({ browser: _browser }, testInfo) => {
  for (const name of ['enable', 'nofeed', 'limits']) {
    await deleteTenantBySlug(slugFor(testInfo.project.name, name));
  }
  await restoreLabSettings();
  await sweepAssets();
  await db?.end();
  db = null;
  await closeTenantFixtures();
  await closeAdmin();
});

test.describe('09-12 - platform panel: the Rede social row (tracer)', () => {
  test('1. enabling confirms first, cancel writes nothing, confirm turns it on, off is immediate', async ({
    browser,
  }, testInfo) => {
    const tenant = await makeTenant(testInfo.project.name, 'enable', { feed: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInSuperAdmin(page);
    await openModulesTab(page, tenant.id);

    // The row: the catalog name and description, off, enabled switch, no note.
    await expect(
      page.getByText('Membros seguem uns aos outros e publicam em Explorar.'),
    ).toBeVisible();
    const sw = page.getByRole('switch', { name: SOCIAL_SWITCH });
    await expect(sw).not.toBeChecked();
    await expect(sw).toBeEnabled();
    await expect(page.getByText('Ative Feed para usar a Rede social.')).toHaveCount(0);

    // Switching on opens the dialog with the exact copy and writes nothing yet.
    await sw.click();
    const dialog = page.getByRole('dialog', { name: CONFIRM_TITLE(tenant.displayName) });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(CONFIRM_BODY)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Ativar Rede social' })).toBeVisible();
    expect(await getTenantModuleFlag(tenant.slug, 'social')).toBeNull();

    // Cancel: the switch stays off and nothing is written.
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(sw).not.toBeChecked();
    expect(await getTenantModuleFlag(tenant.slug, 'social')).toBeNull();

    // Confirm: the usual optimistic switch and toast, and the flag the bootstrap reads is on.
    await sw.click();
    await page
      .getByRole('dialog', { name: CONFIRM_TITLE(tenant.displayName) })
      .getByRole('button', { name: 'Ativar Rede social' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'Alterações salvas.' })).toBeVisible();
    await expect(sw).toBeChecked();
    await expect.poll(() => getTenantModuleFlag(tenant.slug, 'social')).toBe(true);

    // Off needs no dialog: the action runs at once and toasts.
    await sw.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => getTenantModuleFlag(tenant.slug, 'social')).toBe(false);
    await expect(sw).not.toBeChecked();

    await context.close();
  });

  test('2. with Feed off the switch is disabled and the row says why', async ({
    browser,
  }, testInfo) => {
    const tenant = await makeTenant(testInfo.project.name, 'nofeed', { feed: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInSuperAdmin(page);
    await openModulesTab(page, tenant.id);

    const sw = page.getByRole('switch', { name: SOCIAL_SWITCH });
    await expect(sw).toBeDisabled();
    await expect(sw).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Ative Feed para usar a Rede social.')).toBeVisible();

    // Nothing opens and nothing is written.
    await sw.click({ force: true });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await getTenantModuleFlag(tenant.slug, 'social')).toBeNull();

    await context.close();
  });
});

test.describe('09-12 - platform panel: the media limits sheet', () => {
  test('3. the button follows the module, the sheet shows saved values, refuses bad ones and saves bytes', async ({
    browser,
  }, testInfo) => {
    const tenant = await makeTenant(testInfo.project.name, 'limits', { feed: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInSuperAdmin(page);

    // Off: the row has no limits button.
    await openModulesTab(page, tenant.id);
    await expect(page.getByRole('button', { name: LIMITS_BUTTON })).toHaveCount(0);

    // On (the flag a confirmed switch writes): the button is there, with an empty stored blob.
    await setTenantModuleFlag(tenant.slug, 'social', true);
    await openModulesTab(page, tenant.id);
    await expect(page.getByRole('button', { name: LIMITS_BUTTON })).toBeVisible();

    // The sheet opens on the defaults: 4 photos, 5 MB, video off with no video fields in the DOM.
    await page.getByRole('button', { name: LIMITS_BUTTON }).click();
    await expect(limitsDialog(page)).toBeVisible();
    await expect(numberField(page, F_PHOTOS)).toHaveValue('4');
    await expect(numberField(page, F_PHOTO_MB)).toHaveValue('5');
    await expect(page.getByRole('switch', { name: F_VIDEO })).not.toBeChecked();
    await expect(numberField(page, F_SECONDS)).toHaveCount(0);
    await expect(numberField(page, F_VIDEO_MB)).toHaveCount(0);
    await expect(page.getByText('De 1 a 10. Padrão: 4.')).toBeVisible();
    await expect(
      page.getByText('Vale só para novos envios e novas comunidades. O que já existe não muda.'),
    ).toBeVisible();

    // Out of range: 0 photos and 16 MB show their own inline errors; the sheet stays open and
    // nothing was written.
    await numberField(page, F_PHOTOS).fill('0');
    await numberField(page, F_PHOTO_MB).fill('16');
    await saveLimits(page).click();
    await expect(page.getByText('Informe um valor entre 1 e 10.')).toBeVisible();
    await expect(page.getByText('Informe um valor entre 1 e 15.')).toBeVisible();
    await expect(limitsDialog(page)).toBeVisible();
    expect((await socialSettingsOf(tenant.slug))?.media).toBeUndefined();

    // Valid photo values; turning video on reveals the two video fields with their defaults.
    await numberField(page, F_PHOTOS).fill('3');
    await numberField(page, F_PHOTO_MB).fill('2');
    await page.getByRole('switch', { name: F_VIDEO }).click();
    await expect(numberField(page, F_SECONDS)).toHaveValue('60');
    await expect(numberField(page, F_VIDEO_MB)).toHaveValue('100');
    await numberField(page, F_SECONDS).fill('999');
    await saveLimits(page).click();
    await expect(page.getByText('Informe um valor entre 1 e 300.')).toBeVisible();
    await expect(limitsDialog(page)).toBeVisible();
    await numberField(page, F_SECONDS).fill('90');
    await numberField(page, F_VIDEO_MB).fill('200');

    // E09 overflow (assumption kept true by the single column): no horizontal scroll at 320px.
    await page.setViewportSize({ width: 320, height: 640 });
    const overflow = await limitsDialog(page).evaluate((el) => ({
      dialog: el.scrollWidth - el.clientWidth,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow.dialog).toBeLessThanOrEqual(0);
    expect(overflow.page).toBeLessThanOrEqual(0);

    // A failed save (the server action answers 500): the sheet stays, the error toast shows, nothing
    // is written. The request is answered, not aborted: Next 16.3 holds an action whose request
    // fails at the network level until the browser is back online, so an abort would never settle.
    await page.route('**/*', (route) =>
      route.request().headers()['next-action']
        ? route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' })
        : route.continue(),
    );
    await saveLimits(page).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Algo deu errado. Tente novamente.' }),
    ).toBeVisible();
    await expect(limitsDialog(page)).toBeVisible();
    expect((await socialSettingsOf(tenant.slug))?.media).toBeUndefined();
    await page.unroute('**/*');

    // The real save: the toast, the sheet closes, and the bytes are stored.
    await saveLimits(page).click();
    await expect(page.getByRole('status').filter({ hasText: 'Limites salvos.' })).toBeVisible();
    await expect(limitsDialog(page)).toHaveCount(0);
    expect((await socialSettingsOf(tenant.slug))?.media).toEqual({
      photosPerPost: 3,
      photoMaxBytes: 2 * MIB,
      video: { enabled: true, maxDurationSeconds: 90, maxBytes: 200 * MIB },
    });

    // Reopening shows what was saved, not the defaults.
    await page.getByRole('button', { name: LIMITS_BUTTON }).click();
    await expect(numberField(page, F_PHOTOS)).toHaveValue('3');
    await expect(numberField(page, F_PHOTO_MB)).toHaveValue('2');
    await expect(page.getByRole('switch', { name: F_VIDEO })).toBeChecked();
    await expect(numberField(page, F_SECONDS)).toHaveValue('90');
    await expect(numberField(page, F_VIDEO_MB)).toHaveValue('200');

    await context.close();
  });

  test('4. a cap saved in the sheet reaches the upload broker: 1 MB refuses a 2 MB photo, the defaults lift it (SOCIAL-05)', async ({
    browser,
  }) => {
    const labId = await tenantIdOf('rede-lab');
    if (labSettingsBefore === undefined) labSettingsBefore = await socialSettingsOf('rede-lab');
    const member = await tokenFor(users.labMember);

    const context = await browser.newContext();
    const page = await context.newPage();
    await signInSuperAdmin(page);
    await openModulesTab(page, labId);

    // Save a 1 MB photo cap through the sheet.
    await page.getByRole('button', { name: LIMITS_BUTTON }).click();
    await numberField(page, F_PHOTO_MB).fill('1');
    await saveLimits(page).click();
    await expect(page.getByRole('status').filter({ hasText: 'Limites salvos.' })).toBeVisible();
    await expect(limitsDialog(page)).toHaveCount(0);
    await expect
      .poll(async () => (await socialSettingsOf('rede-lab'))?.media?.photoMaxBytes)
      .toBe(MIB);

    // The broker honors it for a lab member: 2 MB refused with the tenant cap, 500 KB accepted.
    const refused = await startPostPhoto(member, 2 * MIB);
    expect(refused.status).toBe(413);
    const envelope = (await refused.json()) as {
      error: { details?: { media?: string; maxBytes?: number } };
    };
    expect(envelope.error.details?.media).toBe('too_large');
    expect(envelope.error.details?.maxBytes).toBe(MIB);
    expect((await startPostPhoto(member, 500 * 1024)).status).toBe(201);

    // Back to the 5 MB default through the sheet: the 2 MB photo is accepted again.
    await page.getByRole('button', { name: LIMITS_BUTTON }).click();
    await expect(numberField(page, F_PHOTO_MB)).toHaveValue('1');
    await numberField(page, F_PHOTO_MB).fill('5');
    await saveLimits(page).click();
    await expect(limitsDialog(page)).toHaveCount(0);
    await expect
      .poll(async () => (await socialSettingsOf('rede-lab'))?.media?.photoMaxBytes)
      .toBe(5 * MIB);
    expect((await startPostPhoto(member, 2 * MIB)).status).toBe(201);

    await context.close();
  });
});

/**
 * 10-15 (MPUB-05, D-715, D-718, UI-D-714, UI-D-716): the platform side of the member communities,
 * on a throwaway tenant (`member-journey.ts`).
 *
 * **The limit.** The platform sheet carries "Comunidades por membro" (0 to 20): 2 saves and reads
 * back, 21 is refused inline with the sheet still open.
 *
 * **The switch.** With `social` switched off from the platform panel the member's Explorar tab, the
 * "Criar comunidade" control and every owner control of their own community are gone, while the
 * community, its post and a highlight story stay readable; switching it on again restores them. The
 * API and the web tier cache a tenant's flags for 30 s, so each side polls until it lands (the 09-11
 * pattern). The tenant is dropped whole, which is also the restore of the limit and the flag.
 */
test.describe('10 moderation and switch', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });
  const L = platformModulesSocial.platformModules.social.limits;
  const C = communitiesMessages.communities;
  const S = socialMessages.social;
  const ST = storiesMessages.stories;
  const STAMP = Date.now().toString(36);
  const NAME = `${JOURNEY_PREFIX}comunidade do switch ${STAMP}`;
  const POST = `${JOURNEY_PREFIX}post do switch ${STAMP}`;
  const HIGHLIGHT = `${JOURNEY_PREFIX}destaque`;
  let tenant: JourneyTenant | null = null;
  let tenantId = '';
  let communityId = '';

  test.beforeAll(async ({ browser: _browser }, testInfo) => {
    test.skip(
      isRemote,
      'local stack only (the tenant is provisioned through the admin connection)',
    );
    test.skip(testInfo.project.name !== 'mobile-chromium', 'the member journey is the phone one');
    test.setTimeout(120_000);
    if (!SUPER_ADMIN_PASSWORD) {
      throw new Error('SUPER_ADMIN_PASSWORD is required (same value used by `pnpm db:seed`)');
    }
    tenant = await provisionJourneyTenant(
      journeySlug('sw', testInfo.project.name, Date.now().toString(36)),
      SEED_PASSWORD,
    );
    tenantId = tenant.tenantId;
    communityId = await createMemberCommunityAs(tenant.author.email, tenant.slug, NAME);
    await createFeedPostAs(tenant.author.email, tenant.slug, POST, { communityId });
    const storyId = await createMemberStoryAs(
      tenant.author.email,
      tenant.slug,
      `${JOURNEY_PREFIX}story do destaque ${STAMP}`,
    );
    await createCommunityHighlightWith(
      tenant.author.email,
      tenant.slug,
      communityId,
      HIGHLIGHT,
      storyId,
    );
  });

  test.afterAll(async () => {
    await dropJourneyTenant(tenant);
    await closeJourneyAdmin();
    await closeSocialAdmin();
    await closeFeedAdmin();
    // The file's own afterAll closes the shared fixture connections.
  });

  const saveLimitsButton = (page: Page) => page.getByRole('button', { name: L.save });
  const sheet = (page: Page) => page.getByRole('dialog', { name: L.title });
  const perMember = (page: Page) => page.getByRole('textbox', { name: L.fields.communities });

  test('the platform sheet saves "Comunidades por membro" and refuses 21 with the sheet open', async ({
    browser,
  }) => {
    if (!tenant) throw new Error('the tenant was not provisioned');
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInSuperAdmin(page);
    await openModulesTab(page, tenantId);

    await page.getByRole('button', { name: L.open }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(perMember(page)).toBeVisible();

    // 21 is out of range: the inline error, the sheet stays open, nothing is written.
    await perMember(page).fill('21');
    await saveLimitsButton(page).click();
    await expect(
      page.getByText(L.range.replace('{min}', '0').replace('{max}', '20')),
    ).toBeVisible();
    await expect(sheet(page)).toBeVisible();
    expect((await socialSettingsOf(tenant.slug))?.communities).toBeUndefined();

    // 2 saves: the toast, the sheet closes, the number is stored, and the sheet reads it back.
    await perMember(page).fill('2');
    await saveLimitsButton(page).click();
    await expect(page.getByRole('status').filter({ hasText: L.saved })).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);
    await expect
      .poll(async () => (await socialSettingsOf(tenant?.slug ?? ''))?.communities?.maxPerMember)
      .toBe(2);
    await page.getByRole('button', { name: L.open }).click();
    await expect(perMember(page)).toHaveValue('2');

    await context.close();
  });

  test('social off from the panel removes the member’s writes and keeps the reads; on restores them', async ({
    page,
    browser,
  }) => {
    if (!tenant) throw new Error('the tenant was not provisioned');
    const t = tenant;
    const communityUrl = `${t.origin}/comunidades/${communityId}`;
    const composeEntry = page.locator('a[href^="/criar?comunidade="]:visible');
    const createControl = page.locator('main a[data-communities-create]');
    const editControl = page.locator('[data-community-edit]');
    const highlight = page.getByRole('button', {
      name: ST.circle.highlight.replace('{title}', HIGHLIGHT),
    });

    // On: the creator has every control, the tab is there.
    await login(page, t.author.email, SEED_PASSWORD, t.origin);
    await page.goto(communityUrl);
    await expect(composeEntry).toBeVisible();
    await expect(editControl).toBeVisible();
    await page.goto(`${t.origin}/comunidades`);
    await expect(createControl).toBeVisible();
    await page.goto(`${t.origin}/inicio?aba=explorar`);
    await expect(page.getByRole('tablist', { name: S.tabs.label })).toBeVisible();

    // Off, from the platform panel (no dialog going off).
    const context = await browser.newContext();
    const panel = await context.newPage();
    await signInSuperAdmin(panel);
    await openModulesTab(panel, tenantId);
    const sw = panel.getByRole('switch', { name: SOCIAL_SWITCH });
    await expect(sw).toBeChecked();
    await sw.click();
    await expect.poll(() => getTenantModuleFlag(t.slug, 'social')).toBe(false);

    // The flag is cached for 30 s by the API and the web tier: poll until the creator's controls go.
    await expect(async () => {
      await page.goto(communityUrl);
      await expect(page.getByRole('heading', { name: NAME, level: 1 })).toBeVisible({
        timeout: 3_000,
      });
      await expect(composeEntry).toHaveCount(0, { timeout: 3_000 });
    }).toPass({ timeout: 90_000, intervals: [2_000] });
    await expect(editControl).toHaveCount(0);
    await expect(page.getByText(C.byline.you)).toBeVisible();

    // Still readable: the community, its post and the highlight story.
    await expect(page.getByText(POST)).toBeVisible();
    await expect(highlight).toBeVisible();
    await untilHydrated(highlight);
    await highlight.click();
    await expect(page.getByRole('dialog', { name: ST.viewer.dialog })).toBeVisible();
    await page
      .getByRole('dialog', { name: ST.viewer.dialog })
      .getByRole('button', { name: ST.viewer.close })
      .dispatchEvent('click');
    await expect(page.getByRole('dialog', { name: ST.viewer.dialog })).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: ST.own.actionCommunity.replace('{community}', NAME) }),
    ).toHaveCount(0);

    // The list: no create control; Explorar reads as Início and the chip row is gone.
    await page.goto(`${t.origin}/comunidades`);
    await expect(
      page.locator('main a[data-testid="community-card"]').filter({ hasText: NAME }),
    ).toHaveCount(1);
    await expect(createControl).toHaveCount(0);
    await page.goto(`${t.origin}/inicio?aba=explorar`);
    await expect(page.locator('main').first()).toBeVisible();
    await expect(page.getByRole('tablist', { name: S.tabs.label })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: S.tabs.explore })).toHaveCount(0);

    // On again: the confirmation first, then every control is back.
    await sw.click();
    await panel.getByRole('dialog').getByRole('button', { name: 'Ativar Rede social' }).click();
    await expect.poll(() => getTenantModuleFlag(t.slug, 'social')).toBe(true);
    await expect(async () => {
      await page.goto(communityUrl);
      await expect(composeEntry).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 90_000, intervals: [2_000] });
    await expect(editControl).toBeVisible();
    await page.goto(`${t.origin}/comunidades`);
    await expect(createControl).toBeVisible();
    await page.goto(`${t.origin}/inicio?aba=explorar`);
    await expect(page.getByRole('tablist', { name: S.tabs.label })).toBeVisible();

    await context.close();
  });
});
