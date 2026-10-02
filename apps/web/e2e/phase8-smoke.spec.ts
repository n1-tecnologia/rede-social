import { fileURLToPath } from 'node:url';
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import postgres from 'postgres';
import adminMessages from '../messages/pt-BR/admin.json' with { type: 'json' };
import appMessages from '../messages/pt-BR/app.json' with { type: 'json' };
import communityMessages from '../messages/pt-BR/communities.json' with { type: 'json' };
import eventMessages from '../messages/pt-BR/events.json' with { type: 'json' };
import feedMessages from '../messages/pt-BR/feed.json' with { type: 'json' };
import moderationMessages from '../messages/pt-BR/moderation.json' with { type: 'json' };
import platformBrandingMessages from '../messages/pt-BR/platformBranding.json' with {
  type: 'json',
};
import signupMessages from '../messages/pt-BR/signup.json' with { type: 'json' };
import storyMessages from '../messages/pt-BR/stories.json' with { type: 'json' };
import suspendedMessages from '../messages/pt-BR/suspended.json' with { type: 'json' };
import {
  closeAdmin,
  createCommunityAs,
  createFeedCommentAs,
  createFeedPostAs,
  createMember,
  deleteReelsFixtures,
  deleteUserByEmail,
  memberProfileForEmail,
  membershipForEmail,
  membershipIdFor,
} from './admin';
import { closeBrandingAdmin, getTenantBranding, getTenantDisplayName } from './branding-admin';
import { type CspViolation, collectCspViolations } from './csp-collector';
import { type ApiFetch, apiSession, closeDomainsAdmin } from './domains-admin';
import {
  closeEventsAdmin,
  createEventsTenant,
  deleteEventsTenant,
  type EventsTenant,
  insertEvent,
} from './events-admin';
import { hosts, isRemote, login, SEED_PASSWORD, users } from './fixtures';
import {
  closeMembersAdmin,
  createMembersTenant,
  deleteMembersTenant,
  type MembersTenant,
  membersTenantSlug,
  sweepMembersTenants,
} from './members-admin';
import { closeTenantFixtures } from './tenant-fixtures';
import { ensureWorker } from './worker';

/**
 * Phase 8 smoke (plan 08-12): the phase's witness, in the shape 02-16 established and every phase
 * since repeated. One serial spec on the local stack, real fixtures, each ROADMAP Phase 8 success
 * criterion walked once, under the ENFORCED Content Security Policy the harness runs (08-08), with
 * the violation collector on every page this file opens.
 *
 *   1. SC 1 (MODER-01..03): the demo admin removes a member's comment that has replies; blocks a
 *      second member whose open app lands on "Acesso suspenso" on its own; unblocks them; and finds
 *      all three acts at the top of Moderação, newest first.
 *   2. SC 2 (ADMIN-01..03): Marca changes the primary with the live preview and saves a new name;
 *      Membros finds a member by e-mail and changes the role, then reverts it; Regras saves new text
 *      that a signed-out visitor then reads on `/cadastro`.
 *   3. SC 3 (ADMIN-04), on the phone viewport only: the admin publishes a post, a story, a community
 *      and an event. Each form submitted empty keeps its control disabled (or shows its shipped
 *      error) and creates nothing; each created item heads its own list.
 *   4. Zero CSP violations across the whole file.
 *
 * Where each case runs, and why:
 * - SC 1 and the Membros half of SC 2 run on rede-demo with THROWAWAY members (the `e2e/admin.ts`
 *   rule: seeded users are never left blocked or promoted). The moderation log is append-only and
 *   keeps the rows these cases write, exactly as `moderation.spec.ts` and `admin-members.spec.ts`
 *   already do; a log row also makes its tenant undeletable, which is why no logged act runs on a
 *   throwaway tenant here.
 * - Marca and Regras run on a THROWAWAY community (`createMembersTenant(…, 0)`, the 08-06 and 08-07
 *   precedent): a brand change sits in the 60 s host caches and other suites read rede-demo's rules
 *   at version 1.
 * - SC 3 runs on a THROWAWAY tenant with feed, stories, communities and events on, pre-seeded with
 *   one OLDER item per list, so "heads its list" is a real ordering claim and not the only row.
 *
 * What this spec deliberately does not prove, carried to `docs/phase-08-device-checklist.md` and
 * the phase UAT instead: the four flows with a real on-screen keyboard at 320px and 768px (ADMIN-04
 * adjacency), on a real iPhone and Android phone against production. Every one of those rows is
 * `blocked — not run` until the developer runs it.
 */

test.describe.configure({ mode: 'serial', timeout: 300_000 });
test.skip(isRemote, 'local stack only (seeded rede-demo, throwaway tenants, direct DB fixtures)');
test.use({ serviceWorkers: 'block' });

/** The catalog is the source of copy (UI-SPEC Copywriting Contract), never a literal in a spec. */
const A = adminMessages.admin;
const APP = appMessages.app;
const C = communityMessages.communities;
const E = eventMessages.events;
const F = feedMessages.feed;
const M = moderationMessages.moderation;
const PB = platformBrandingMessages.platformBranding;
const S = storyMessages.stories;
const SIGNUP = signupMessages.signup;
const SUSPENDED = suspendedMessages.suspended;

/** The demo tenant's display name, as the seed writes it (the `chat.spec.ts` constant). */
const DEMO_TENANT = 'Rede Demo';
const PASSWORD = 'Segredo123';
const REPLIER = 'ana.carolina.vasconcellos@rede-demo.local';
const PREFIX = 'Smoke fase 8';
const PHOTO = `${fileURLToPath(new URL('./fixtures/', import.meta.url))}post-a.jpg`;
const ZONE = 'America/Sao_Paulo';

/** Per-run stamp: throwaway hosts sit in 60 s caches, so no run reuses another's slug. */
const RUN = Date.now().toString(36);
const tag = (project: string) => (project.startsWith('mobile') ? 'm' : 'd');

// ── the CSP collector, on every page this file opens ────────────────────────────────────────────

const collectors: (() => CspViolation[])[] = [];
let pagesWatched = 0;

async function watch(page: Page): Promise<void> {
  collectors.push(await collectCspViolations(page));
  pagesWatched += 1;
}

const violations = (): CspViolation[] => collectors.flatMap((read) => read());

type DeviceUse = Parameters<Browser['newContext']>[0];

/** A second, independent browser context (own cookies) on the same device, with the collector. */
async function secondContext(
  browser: Browser,
  use: DeviceUse,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ ...use, serviceWorkers: 'block' });
  const page = await context.newPage();
  await watch(page);
  return { context, page };
}

/**
 * After a full navigation the inputs exist before React hydrated them; a fill dispatched in that
 * window is lost. React tags hydrated DOM nodes with its internal props key (the 02-14 probe).
 */
async function hydrated(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return el !== null && Object.keys(el).some((key) => key.startsWith('__reactProps'));
    },
    selector,
    { timeout: 30_000 },
  );
}

// ── direct database reads (the superuser fixture connection) ────────────────────────────────────

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 2 },
  );
  return client;
}

/** Live rows of one table in one tenant (the "creates nothing" witness of ADMIN-04 empty). */
async function liveRows(
  table: 'feed_posts' | 'stories' | 'communities' | 'events',
  tenantId: string,
): Promise<number> {
  const rows = await sql()<{ n: number }[]>`
    select count(*)::int as n from ${sql()(`public.${table}`)}
     where tenant_id = ${tenantId}::uuid and deleted_at is null`;
  return rows[0]?.n ?? 0;
}

/**
 * An OLDER story for the SC 3 tenant, back-dated one hour and reusing the asset of the story the
 * admin just published (same tenant, already `ready`), so the strip's newest-first order has two
 * rows to order. Written after the publish on purpose: the tenant owns no other image asset.
 */
async function insertOlderStory(tenantId: string, assetId: string, caption: string) {
  await sql()`
    insert into public.stories
      (tenant_id, author_user_id, media_asset_id, media_kind, caption, published_at, expires_at)
    select s.tenant_id, s.author_user_id, s.media_asset_id, s.media_kind, ${caption},
           now() - interval '1 hour', now() + interval '23 hours'
      from public.stories s
     where s.tenant_id = ${tenantId}::uuid and s.media_asset_id = ${assetId}::uuid
     limit 1`;
}

/**
 * Removes what SC 3 wrote in its throwaway tenant before the tenant itself goes: `stories` and
 * `feed_post_media` hold `media_assets` with no `ON DELETE`, and `notifications` hold the tenant
 * with none, so `deleteEventsTenant` (events, then assets, then the tenant) needs them gone first.
 */
async function clearSc3Tenant(tenantId: string): Promise<void> {
  await sql()`delete from public.notifications where tenant_id = ${tenantId}::uuid`;
  await sql()`delete from public.story_highlights where tenant_id = ${tenantId}::uuid`;
  await sql()`delete from public.stories where tenant_id = ${tenantId}::uuid`;
  await sql()`delete from public.feed_posts where tenant_id = ${tenantId}::uuid`;
  await sql()`delete from public.communities where tenant_id = ${tenantId}::uuid`;
}

/** `YYYY-MM-DD` of the tenant-local day `days` from now (the `en-CA` trick of `events.spec.ts`). */
const tenantDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────

const throwawayEmails: string[] = [];
let brandTenant: MembersTenant | null = null;
let sc3: EventsTenant | null = null;
let sc3Api: ApiFetch | null = null;
let stopWorker: () => Promise<void> = async () => {};

async function throwawayMember(label: string, project: string): Promise<string> {
  const email = `aaa-e2e-p8-${label}-${tag(project)}-${Date.now()}@rede-demo.local`;
  await createMember(email, PASSWORD, 'rede-demo');
  throwawayEmails.push(email);
  return email;
}

test.beforeAll(async ({ browserName: _browserName }, testInfo) => {
  test.setTimeout(240_000);
  // Story variants (`kernel.media-derive-variants`) and the brand icons run in the worker role.
  stopWorker = await ensureWorker();
  await sweepMembersTenants(`p8br-${testInfo.project.name.replace(/[^a-z0-9]/g, '').slice(0, 10)}`);
  brandTenant = await createMembersTenant(
    membersTenantSlug('p8br', testInfo.project.name),
    SEED_PASSWORD,
    0,
  );
  if (testInfo.project.name === 'mobile-chromium') {
    sc3 = await createEventsTenant(`p8-sc3-${RUN}-m`, SEED_PASSWORD, [
      'feed',
      'stories',
      'communities',
    ]);
    sc3Api = await apiSession(sc3.adminEmail, SEED_PASSWORD);
  }
});

test.afterAll(async () => {
  await stopWorker();
  await deleteReelsFixtures(PREFIX);
  for (const email of throwawayEmails) await deleteUserByEmail(email);
  if (brandTenant) await deleteMembersTenant(brandTenant.slug);
  if (sc3) {
    await clearSc3Tenant(sc3.tenantId);
    await deleteEventsTenant(sc3.slug);
  }
  await client?.end();
  client = null;
  await closeEventsAdmin();
  await closeMembersAdmin();
  await closeBrandingAdmin();
  await closeDomainsAdmin();
  await closeTenantFixtures();
  await closeAdmin();
});

test.describe('Phase 8 smoke — moderation, the admin panel and the phone creation flows', () => {
  test('1. criterion 1: a comment with replies is removed, a member with the app open is blocked and lands on "Acesso suspenso", is unblocked, and Moderação lists all three', async ({
    page,
    browser,
    contextOptions,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  }, testInfo) => {
    test.setTimeout(240_000);
    await watch(page);
    const run = `${testInfo.project.name}-${Date.now()}`;

    // The post, the member's root comment and two replies by another member.
    const postId = await createFeedPostAs(users.demoAdmin, 'rede-demo', `${PREFIX} ${run}`);
    const rootBody = `Comentario do smoke ${run}`;
    const rootId = await createFeedCommentAs(users.demoMember, postId, rootBody);
    const replyIds = [
      await createFeedCommentAs(REPLIER, postId, `Resposta um ${run}`, rootId),
      await createFeedCommentAs(REPLIER, postId, `Resposta dois ${run}`, rootId),
    ];
    const author = await memberProfileForEmail(users.demoMember);
    if (!author) throw new Error('the seeded demo member has no profile');
    const row = (id: string) => page.locator(`article[data-comment-id="${id}"]`);

    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/post/${postId}`);
    await expect(row(rootId)).toBeVisible();
    await row(rootId).locator('[data-replies-toggle]').click();
    for (const id of replyIds) await expect(row(id)).toBeVisible();

    const control = row(rootId).locator(':scope > div > div [data-comment-delete]');
    await expect(control).toHaveAttribute('data-comment-removal', 'moderation');
    await expect(control).toHaveAccessibleName(
      M.comment.label.replace('{author}', author.displayName),
    );
    await control.click();
    await expect(page.getByText(M.comment.title, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: M.comment.confirm, exact: true }).click();
    await expect(row(rootId)).toHaveCount(0);
    for (const id of replyIds) await expect(row(id)).toHaveCount(0);
    await expect(page.getByText(M.comment.toasts.removed, { exact: true })).toBeVisible();

    // A second member, signed in on their own device with Início OPEN.
    const blockedEmail = await throwawayMember('bloq', testInfo.project.name);
    const membershipId = await membershipIdFor(blockedEmail, 'rede-demo');
    const member = await secondContext(browser, {
      ...contextOptions,
      viewport,
      isMobile,
      hasTouch,
      userAgent,
      deviceScaleFactor,
    });
    try {
      await login(member.page, blockedEmail, PASSWORD, hosts.demo);
      // Let the shell's Realtime join settle (its first SUBSCRIBED refetches the counters).
      await member.page.waitForLoadState('networkidle');

      // The admin blocks them from Membros, with a reason.
      await page.goto(`${hosts.demo}/configuracoes/membros?q=${encodeURIComponent(blockedEmail)}`);
      const memberRow = page.locator(`[data-member-row="${membershipId}"]`);
      await expect(memberRow).toBeVisible();
      await memberRow.click();
      const sheet = page.getByRole('dialog');
      await sheet.getByRole('button', { name: M.member.block, exact: true }).click();
      await sheet.getByLabel(M.member.reason.label).fill(`Smoke fase 8 ${run}`);
      await sheet.getByRole('button', { name: M.member.confirmBlock, exact: true }).click();
      await expect(
        page.getByText(M.member.toasts.blocked.replace('{name}', blockedEmail)),
      ).toBeVisible();
      await expect(memberRow).toContainText(A.members.pills.blocked);

      // No reload and no navigation by the test: the open app gets there on its own (MODER-02).
      await expect(member.page).toHaveURL(/\/acesso-suspenso\?t=Rede%20Demo$/, { timeout: 15_000 });
      await expect(
        member.page.getByText(SUSPENDED.body.replace('{tenant}', DEMO_TENANT)),
      ).toBeVisible();

      // Unblock from the same row.
      await memberRow.click();
      await sheet.getByRole('button', { name: M.member.unblock, exact: true }).click();
      await sheet.getByRole('button', { name: M.member.confirmUnblock, exact: true }).click();
      await expect(
        page.getByText(M.member.toasts.unblocked.replace('{name}', blockedEmail)),
      ).toBeVisible();
      await expect(memberRow).not.toContainText(A.members.pills.blocked);
      expect((await membershipForEmail(blockedEmail))?.status).toBe('active');

      // Signing in again works once more.
      await login(member.page, blockedEmail, PASSWORD, hosts.demo);
    } finally {
      await member.context.close();
    }

    // Configurações → Moderação: the three acts head the log, newest first (MODER-03).
    await page.goto(`${hosts.demo}/configuracoes`);
    await page.locator('main').getByRole('link', { name: APP.settings.rows.moderation }).click();
    await expect(page).toHaveURL(/\/configuracoes\/moderacao$/);
    const log = page.getByRole('list', { name: M.log.label });
    await expect(log.getByRole('listitem').first()).toBeVisible();
    const kinds = await log
      .locator('[data-moderation-log-row]')
      .evaluateAll((rows) =>
        rows.slice(0, 3).map((r) => r.getAttribute('data-moderation-log-row')),
      );
    expect(kinds).toEqual(['member_unblocked', 'member_blocked', 'comment_removed']);
    const removal = log.locator('[data-moderation-log-row="comment_removed"]').first();
    await expect(removal).toContainText(
      M.log.rows.commentRemoved
        .replace('{actor}', M.log.you)
        .replace('{target}', author.displayName),
    );
    await expect(removal.locator('[data-moderation-log-excerpt]')).toHaveText(
      M.log.excerpt.replace('{excerpt}', rootBody),
    );

    expect(violations()).toEqual([]);
  });

  test('2. criterion 2: Marca changes the brand with the live preview and renames the community, Membros finds a member by e-mail and changes the role, and new Regras reach /cadastro', async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(240_000);
    await watch(page);
    const tenant = brandTenant;
    if (!tenant) throw new Error('the Marca and Regras community was not provisioned');

    // ── Marca: the primary through the live preview, then a new name ────────────────────────────
    await login(page, tenant.admin.email, tenant.password, tenant.origin);
    await page.goto(`${tenant.origin}/configuracoes`);
    await page
      .locator('main')
      .getByRole('link', { name: APP.settings.rows.brand, exact: true })
      .click();
    await expect(page).toHaveURL(`${tenant.origin}/configuracoes/marca`);
    await hydrated(page, '#primary');
    const saveColours = page.getByRole('button', { name: PB.colors.save });
    await expect(saveColours).toBeDisabled();
    await page.locator('#primary').fill('#1d4ed8');
    await page.locator('#secondary').fill('#60a5fa');
    await expect
      .poll(() =>
        page
          .locator('[data-brand-scope][data-theme="light"] button')
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      )
      .toBe('rgb(29, 78, 216)');
    await saveColours.click();
    await expect(page.getByText(PB.toasts.saved, { exact: true }).first()).toBeVisible();
    expect((await getTenantBranding(tenant.slug)).colors.primary).toBe('#1d4ed8');

    await hydrated(page, '#displayName');
    const newName = `Smoke Fase 8 ${tenant.slug.slice(-6)}`;
    await page.locator('#displayName').fill(newName);
    await page.getByRole('button', { name: A.brand.name.save }).click();
    await expect(page.getByText(A.brand.name.saved, { exact: true }).first()).toBeVisible();
    await expect(page.locator('[data-brand-scope][data-theme="light"]')).toContainText(newName);
    await expect.poll(async () => (await getTenantDisplayName(tenant.slug)) ?? '').toBe(newName);

    // The next navigation renders the new brand from the per-request bootstrap.
    await page.goto(`${tenant.origin}/inicio`);
    await expect
      .poll(() =>
        page
          .locator('main')
          .first()
          .evaluate((el) => getComputedStyle(el).getPropertyValue('--brand-primary').trim()),
      )
      .toBe('#1d4ed8');

    // ── Regras: new text, then a signed-out visitor reads it on /cadastro ───────────────────────
    const marker = `Regra do smoke ${RUN} ${tag(testInfo.project.name)}: trate todos com respeito.`;
    await page.goto(`${tenant.origin}/configuracoes`);
    await page
      .locator('main')
      .getByRole('link', { name: APP.settings.rows.rules, exact: true })
      .click();
    await expect(page).toHaveURL(`${tenant.origin}/configuracoes/regras`);
    await hydrated(page, '#rulesText');
    await page.locator('#rulesText').fill(marker);
    const saveRules = page.getByRole('button', { name: A.rules.save, exact: true });
    await expect(saveRules).toBeEnabled();
    await saveRules.click();
    await expect(page.getByText(A.rules.saved).first()).toBeVisible();

    const visitor = await secondContext(browser, {});
    try {
      await visitor.page.goto(`${tenant.origin}/cadastro`);
      await expect(visitor.page.getByRole('heading', { level: 1 })).toHaveText(SIGNUP.title);
      await visitor.page.getByRole('button', { name: SIGNUP.viewRules }).click();
      await expect(visitor.page.getByRole('dialog')).toContainText(marker);
    } finally {
      await visitor.context.close();
    }

    // ── Membros (rede-demo): search by e-mail, change the role, revert it ───────────────────────
    const email = await throwawayMember('papel', testInfo.project.name);
    const membershipId = await membershipIdFor(email, 'rede-demo');
    await page.context().clearCookies();
    await login(page, users.demoAdmin, SEED_PASSWORD, hosts.demo);
    await page.goto(`${hosts.demo}/configuracoes`);
    await page.locator('main').getByRole('link', { name: APP.settings.rows.members }).click();
    await expect(page).toHaveURL(/\/configuracoes\/membros$/);
    await page.getByRole('searchbox', { name: A.members.search.label }).fill(email);
    await expect(page).toHaveURL(/\?q=/);
    const memberRow = page.locator(`[data-member-row="${membershipId}"]`);
    await expect(page.locator('[data-member-row]')).toHaveCount(1);
    await expect(memberRow).toContainText(email);
    await memberRow.click();

    const group = page.getByRole('radiogroup', { name: A.members.roleLabel });
    const option = (label: string) => group.getByRole('radio', { name: new RegExp(`^${label}`) });
    const confirm = page.getByRole('dialog', {
      name: A.members.roleConfirm.title.replace('{name}', email),
    });
    const roleToast = (role: string) =>
      A.members.toasts.roleChanged.replace('{name}', email).replace('{role}', role);
    await expect(option(A.roles.member)).toHaveAttribute('aria-checked', 'true');

    await option(A.roles.support).click();
    await expect(confirm).toContainText(A.members.roleConfirm.toSupport.replace('{name}', email));
    await confirm.getByRole('button', { name: A.members.roleConfirm.confirm }).click();
    await expect(page.getByText(roleToast(A.roles.support))).toBeVisible();
    await expect(option(A.roles.support)).toHaveAttribute('aria-checked', 'true');
    expect((await membershipForEmail(email))?.role).toBe('support_tenant');

    await option(A.roles.member).click();
    await expect(confirm).toContainText(A.members.roleConfirm.toMember.replace('{name}', email));
    await confirm.getByRole('button', { name: A.members.roleConfirm.confirm }).click();
    await expect(page.getByText(roleToast(A.roles.member))).toBeVisible();
    await expect(option(A.roles.member)).toHaveAttribute('aria-checked', 'true');
    expect((await membershipForEmail(email))?.role).toBe('member');

    expect(violations()).toEqual([]);
  });

  test('3. criterion 3 (ADMIN-04, phone): the admin publishes a post, a story, a community and an event; empty submits create nothing; each new item heads its list', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'ADMIN-04 is the phone viewport');
    test.setTimeout(300_000);
    await watch(page);
    const tenant = sc3;
    const api = sc3Api;
    if (!tenant || !api) throw new Error('the SC 3 tenant was not provisioned');
    const host = new URL(tenant.origin).hostname;
    const P = `${PREFIX} ${RUN}`;

    // One OLDER item per list, so "first" orders two rows rather than reading the only one.
    await createFeedPostAs(tenant.adminEmail, tenant.slug, `${P} publicacao antiga`);
    await createCommunityAs(tenant.adminEmail, tenant.slug, `${P} comunidade antiga`, {
      minutesAgo: 60,
    });
    await insertEvent(tenant.tenantId, {
      title: `${P} evento antigo`,
      startsInMinutes: 3 * 24 * 60,
      endsInMinutes: 3 * 24 * 60 + 120,
    });

    await login(page, tenant.adminEmail, tenant.password, tenant.origin);

    // ── a post, from the phone's floating create control ─────────────────────────────────────────
    await page.locator('[data-compose-fab]').click();
    await expect(page).toHaveURL(/\/criar$/);
    await expect(
      page.getByRole('heading', { name: F.composer.createTitle, exact: true }),
    ).toBeVisible();
    const publish = page.getByRole('button', { name: F.composer.publish, exact: true });
    await expect(publish).toBeDisabled();
    expect(await liveRows('feed_posts', tenant.tenantId)).toBe(1);
    const caption = `${P} publicacao nova`;
    await page.locator('#composer-caption').fill(caption);
    await expect(publish).toBeEnabled();
    await publish.click();
    await expect(page).toHaveURL(/\/post\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByRole('status')).toHaveText(F.toasts.created);
    await page.goto(`${tenant.origin}/inicio`);
    const posts = page
      .locator('main')
      .getByRole('article')
      .filter({ hasText: `${P} publicacao` });
    await expect(posts).toHaveCount(2);
    await expect(posts.first()).toContainText(caption);

    // ── a story, from the strip's own circle ─────────────────────────────────────────────────────
    const strip = page.getByRole('list', { name: S.region });
    await strip.getByRole('link', { name: S.own.action }).click();
    await expect(page).toHaveURL(/\/stories\/publicar$/);
    await expect(page.getByRole('heading', { name: S.publish.title })).toBeVisible();
    await expect(page.getByRole('button', { name: S.publish.submit, exact: true })).toHaveCount(0);
    // Empty: no submit control exists before a pick, so the form is submitted the way a stray
    // Enter would; the shipped refusal shows and nothing is created.
    await page.locator('[data-testid="story-composer"]').evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
    });
    await expect(page.locator('[data-testid="story-composer"]').getByRole('alert')).toHaveText(
      S.publish.errors.noMedia,
    );
    expect(await liveRows('stories', tenant.tenantId)).toBe(0);
    await page.locator('#story-photo-input').setInputFiles(PHOTO);
    const storyCaption = `${P} story novo`;
    await expect(page.getByLabel(S.publish.captionLabel)).toBeVisible({ timeout: 30_000 });
    await page.getByLabel(S.publish.captionLabel).fill(storyCaption);
    await page.getByRole('button', { name: S.publish.submit, exact: true }).click();
    await expect(page).toHaveURL(/\/inicio$/);
    await expect(page.getByText(S.publish.toast, { exact: true })).toBeVisible();

    // The strip only lists a story once its image is `ready` (the worker's derivation, R-P8).
    type StoryItem = { id: string; caption: string };
    const storyList = async (): Promise<StoryItem[]> => {
      const res = await api('/v1/stories?limit=10', {}, host);
      if (!res.ok) return [];
      return ((await res.json()) as { items: StoryItem[] }).items;
    };
    await expect
      .poll(async () => (await storyList()).map((s) => s.caption), { timeout: 90_000 })
      .toEqual([storyCaption]);
    const [assetRow] = await sql()<{ media_asset_id: string }[]>`
      select media_asset_id from public.stories
       where tenant_id = ${tenant.tenantId}::uuid and caption = ${storyCaption}`;
    if (!assetRow) throw new Error('the published story has no row');
    await insertOlderStory(tenant.tenantId, assetRow.media_asset_id, `${P} story antigo`);
    // Newest first, the order the strip reads: the admin's story heads it.
    expect((await storyList()).map((s) => s.caption)).toEqual([storyCaption, `${P} story antigo`]);
    await page.goto(`${tenant.origin}/inicio`);
    await strip
      .getByRole('button', {
        name: S.circle.tenant.replace('{tenant}', `Comunidade ${tenant.slug}`),
      })
      .click();
    await expect(page.getByTestId('story-progress-bars')).toHaveAttribute('data-story-count', '2');

    // ── a community, from the list's create control ──────────────────────────────────────────────
    await page.goto(`${tenant.origin}/comunidades`);
    await page.locator('main a[data-communities-create]').click();
    await page.waitForURL(/\/comunidades\/nova$/);
    await expect(page.getByRole('heading', { name: C.form.createTitle })).toBeVisible();
    const createCommunity = page.getByRole('button', { name: C.actions.create });
    await expect(createCommunity).toBeDisabled();
    expect(await liveRows('communities', tenant.tenantId)).toBe(1);
    const communityName = `${P} comunidade nova`;
    await page.getByLabel(C.form.name.label).fill(communityName);
    await expect(createCommunity).toBeEnabled();
    await createCommunity.click();
    await page.waitForURL(/\/comunidades\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: communityName, level: 1 })).toBeVisible();
    await page.goto(`${tenant.origin}/comunidades`);
    const cards = page
      .locator('main a[data-testid="community-card"]')
      .filter({ hasText: `${P} comunidade` });
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText(communityName);

    // ── an event, from the list's create control ─────────────────────────────────────────────────
    await page.goto(`${tenant.origin}/eventos`);
    await page.locator('[data-events-create]').click();
    await expect(page).toHaveURL(/\/eventos\/novo$/);
    const submit = page.locator('[data-event-submit]');
    await expect(submit).toBeDisabled();
    expect(await liveRows('events', tenant.tenantId)).toBe(1);
    const online = page
      .getByRole('group', { name: E.form.format.label })
      .getByRole('button', { name: E.form.format.online });
    await online.click();
    await expect(online).toHaveAttribute('aria-pressed', 'true');
    const eventTitle = `${P} evento novo`;
    await page.locator('#event-title').fill(eventTitle);
    await page.locator('#event-start-date').fill(tenantDate(1));
    await page.locator('#event-start-time').fill('09:00');
    await page.locator('#event-url').fill('https://meet.example.test/smoke-fase-8');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page).toHaveURL(/\/eventos\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByRole('status').filter({ hasText: E.toasts.created })).toBeVisible();
    await page.goto(`${tenant.origin}/eventos`);
    await expect(page.getByRole('heading', { name: E.list.title, level: 1 })).toBeVisible();
    const posters = page.locator('main').getByTestId('event-poster');
    await expect(posters).toHaveCount(2);
    await expect(posters.first().getByTestId('event-poster-title')).toHaveText(eventTitle);

    expect(violations()).toEqual([]);
  });

  test('4. zero CSP violations across every page this file opened, under the enforced policy', async () => {
    // Not vacuous: the cases above attached the collector to their pages (csp.spec.ts proves the
    // collector itself is live by splicing a nonce-less script into real served HTML).
    expect(process.env.CSP_MODE).toBe('enforce');
    expect(pagesWatched).toBeGreaterThan(0);
    expect(violations()).toEqual([]);
  });
});
