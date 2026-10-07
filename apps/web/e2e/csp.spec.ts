import { fileURLToPath } from 'node:url';
import { type BrowserContext, expect, type Page, type Response, test } from '@playwright/test';
import {
  closeAdmin,
  createLinkPreviewPostAs,
  cspWalkFixtureIds,
  deleteLinkPreviewPosts,
  feedPostIdFor,
  memberProfileForEmail,
  resetMemberProfile,
} from './admin';
import { collectCspViolations } from './csp-collector';
import {
  hosts,
  login,
  SEED_PASSWORD,
  seededCommunityFeed,
  seededFeedMedia,
  users,
} from './fixtures';
import { pickPhoto } from './media-fixtures';

/**
 * D-346: every page runs under an ENFORCED nonce Content Security Policy (the harness sets
 * `CSP_MODE=enforce`, `playwright.config.ts`) and the app works with zero violations.
 *
 * - `csp tracer`: signed out on `/entrar`, then signed in on `/inicio` and a post. Each document's
 *   response carries `content-security-policy` with a fresh nonce, the HTML stamps that same nonce
 *   on Next's framework scripts, and the violation collector stays empty.
 * - `csp on a refreshed session` (Pitfall 10): the session cookie is made to look expired, so
 *   `proxy.ts` refreshes it and rebuilds both the forwarded headers and the response inside
 *   `setAll`; that response must still carry the policy (and Next must still find the nonce).
 * - `csp walk` (08-08 Task 2): every surface of the app under the enforced policy, collecting
 *   violations on every page: the member's surfaces (communities, events, a story, support chat
 *   over Realtime, notifications, the profile editor with a real avatar upload to Storage, a video
 *   post), the admin's four Administração screens with their sheet and previews, the platform panel
 *   as the super admin, and the inline YouTube and Vimeo players (UI-D-282). The players' frame
 *   navigations are intercepted with `page.route` and answered by a local stub, so no request leaves
 *   the machine while the frame still mounts under `frame-src`; and before the tap the feed must
 *   make ZERO requests to any YouTube or Vimeo host (the D-346 / UI-D-282 privacy prohibition).
 */

const CSP = 'content-security-policy';

function nonceOf(policy: string | undefined): string | undefined {
  return policy?.match(/'nonce-([^']+)'/)?.[1];
}

/** Asserts the enforced policy on a document response and that its HTML uses the same nonce. */
async function expectNoncedDocument(response: Response | null): Promise<string> {
  expect(response, 'a document response').not.toBeNull();
  const headers = (response as Response).headers();
  const policy = headers[CSP];
  expect(policy, `${CSP} on ${(response as Response).url()}`).toBeTruthy();
  expect(headers[`${CSP}-report-only`]).toBeUndefined();
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).toContain("frame-ancestors 'none'");
  const nonce = nonceOf(policy);
  expect(nonce, 'a nonce in script-src').toBeTruthy();
  const html = await (response as Response).text();
  expect(html, 'Next stamps the request nonce on its framework scripts').toMatch(
    new RegExp(`<script[^>]*\\snonce="${(nonce as string).replace(/[+/=]/g, '\\$&')}"`),
  );
  return nonce as string;
}

/**
 * Makes the stored `@supabase/ssr` session look expired (its `expires_at` in the past) without
 * touching the tokens, so the next proxied request refreshes it through `setAll`. The cookie is
 * `base64-` + base64url(JSON), possibly split into `.0`, `.1` chunks of 3180 characters.
 */
async function expireSessionCookie(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies();
  const parts = cookies
    .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  expect(parts.length, 'a Supabase session cookie').toBeGreaterThan(0);
  const first = parts[0] as (typeof parts)[number];
  const baseName = first.name.replace(/\.\d+$/, '');
  const raw = parts.map((c) => c.value).join('');
  expect(raw.startsWith('base64-')).toBe(true);
  const session = JSON.parse(
    Buffer.from(raw.slice('base64-'.length), 'base64url').toString('utf8'),
  );
  session.expires_at = Math.floor(Date.now() / 1000) - 3600;
  const value = `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`;

  await context.clearCookies({
    name: new RegExp(`^${baseName.replace(/[.-]/g, '\\$&')}(\\.\\d+)?$`),
  });
  const chunks = value.length <= 3180 ? [value] : (value.match(/.{1,3180}/g) as string[]);
  await context.addCookies(
    chunks.map((chunk, i) => ({
      ...first,
      name: chunks.length === 1 ? baseName : `${baseName}.${i}`,
      value: chunk,
    })),
  );
  return value;
}

test.describe('D-346 — enforced nonce CSP', () => {
  test('csp tracer', async ({ page }) => {
    const violations = await collectCspViolations(page);

    const signedOut = await page.goto('/entrar');
    const firstNonce = await expectNoncedDocument(signedOut);
    await expect(page.locator('#email')).toBeVisible();

    await login(page, users.demoMember, SEED_PASSWORD);
    const home = await page.goto('/inicio');
    const homeNonce = await expectNoncedDocument(home);
    expect(homeNonce, 'a fresh nonce per request').not.toBe(firstNonce);
    // Início has no visible welcome block (2026-10-01): its one h1 is the screen-reader "Início",
    // and the tenant shows in the shell's home link (the login/logout/session specs' check).
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Início');
    await expect(page.locator('[data-shell-brand]:visible')).toHaveAccessibleName('Rede Demo');

    const post = await page.goto(`/post/${seededCommunityFeed.inCommunityPostId}`);
    await expectNoncedDocument(post);
    await expect(page.getByText(seededCommunityFeed.inCommunity).first()).toBeVisible();

    // The nonced inline scripts really ran: Next's flight data queue exists only if they executed.
    expect(
      await page.evaluate(() =>
        Array.isArray((self as unknown as { __next_f?: unknown }).__next_f),
      ),
    ).toBe(true);

    expect(violations()).toEqual([]);
  });

  test('the collector is live: a script injected into the served HTML without the nonce is blocked', async ({
    page,
  }) => {
    // Simulates a stored/reflected XSS: the REAL `/entrar` response (with the app's own policy
    // header) gets an inline script spliced into its HTML. The policy must stop it, and the
    // collector must see it, so the zero-violation assertions elsewhere cannot be vacuous.
    await page.route('**/entrar', async (route) => {
      const response = await route.fetch();
      const html = (await response.text()).replace(
        '</body>',
        '<script>window.__injected = true</script></body>',
      );
      await route.fulfill({ response, body: html });
    });
    const violations = await collectCspViolations(page);
    const res = await page.goto('/entrar');
    expect(res?.headers()[CSP]).toContain("'strict-dynamic'");
    await expect(page.locator('#email')).toBeVisible();
    const ran = await page.evaluate(() => Boolean((window as { __injected?: boolean }).__injected));
    expect(ran, 'the enforced policy blocks an inline script without the nonce').toBe(false);
    await expect.poll(() => violations().length).toBeGreaterThan(0);
    expect(violations()).toContainEqual({
      directive: 'script-src-elem',
      blocked: 'inline',
      path: '/entrar',
    });
  });

  test('csp on a refreshed session', async ({ page }) => {
    const violations = await collectCspViolations(page);
    await login(page, users.demoMember, SEED_PASSWORD);

    const tampered = await expireSessionCookie(page.context());
    const refreshed = await page.goto('/inicio');
    expect(refreshed?.status()).toBe(200);
    await expectNoncedDocument(refreshed);
    // The proxy really took the refresh branch: the document response rotated the session cookie,
    // and the new session is no longer expired.
    const after = (await page.context().cookies())
      .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
      .map((c) => c.value)
      .join('');
    expect(after, 'the refresh rotated the session cookie').not.toBe(tampered);
    const rotated = JSON.parse(
      Buffer.from(after.slice('base64-'.length), 'base64url').toString('utf8'),
    ) as { expires_at: number };
    expect(rotated.expires_at * 1000).toBeGreaterThan(Date.now());
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Início');
    await expect(page.locator('[data-shell-brand]:visible')).toHaveAccessibleName('Rede Demo');

    expect(violations()).toEqual([]);
  });
});

const WALK_PREFIX = 'csp-walk 08-08';
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

/** Every host a YouTube or Vimeo player, script, frame or thumbnail could come from. */
const PROVIDER_HOST =
  /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|googlevideo\.com|ggpht\.com|vimeo\.com|vimeocdn\.com)$/;

/** Navigates and waits until the page's main landmark rendered, so lazy work had its chance. */
async function visit(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status(), path).toBeLessThan(400);
  expect(response?.headers()[CSP], `${CSP} on ${path}`).toContain("'strict-dynamic'");
  await expect(page.locator('main').first()).toBeVisible();
  await page.waitForLoadState('load');
}

test.describe('D-346 — the whole app under the enforced policy', () => {
  test.describe.configure({ timeout: 180_000 });

  const run = `${Date.now()}`;

  test.afterAll(async () => {
    await deleteLinkPreviewPosts(WALK_PREFIX);
    await closeAdmin();
  });

  test('csp walk — member surfaces, a real avatar upload, a video post and the inline players', async ({
    page,
  }, testInfo) => {
    const prefix = `${WALK_PREFIX} ${testInfo.project.name} ${run}`;
    const ids = await cspWalkFixtureIds('rede-demo');
    const videoPostId = await feedPostIdFor(seededFeedMedia.videoCaption, 'rede-demo');
    const youtubePostId = await createLinkPreviewPostAs(
      users.demoAdmin,
      'rede-demo',
      `${prefix} youtube`,
      {
        url: `https://www.youtube.com/watch?v=dQw4w9WgXcQ&e2e=${run}${testInfo.project.name}`,
        provider: 'youtube',
        title: 'Encontro anual em video',
      },
    );
    const vimeoPostId = await createLinkPreviewPostAs(
      users.demoAdmin,
      'rede-demo',
      `${prefix} vimeo`,
      {
        url: `https://vimeo.com/76979871?e2e=${run}${testInfo.project.name}`,
        provider: 'vimeo',
        title: 'Palestra de abertura',
      },
    );
    const profileBefore = await memberProfileForEmail(users.demoMember);
    expect(profileBefore).not.toBeNull();

    // Every request to a provider host, from the first navigation on.
    const providerRequests: string[] = [];
    page.on('request', (request) => {
      const host = new URL(request.url()).hostname;
      if (PROVIDER_HOST.test(host)) providerRequests.push(host);
    });
    const violations = await collectCspViolations(page);

    try {
      await login(page, users.demoMember, SEED_PASSWORD);

      // The feed with both provider cards on it: nothing third-party before a tap (prohibition).
      await visit(page, '/inicio');
      await expect(page.getByText(`${prefix} youtube`)).toBeVisible();
      await expect(page.getByText(`${prefix} vimeo`)).toBeVisible();
      await expect(page.getByTestId('post-link-preview-stage')).toHaveCount(2);
      await expect(page.locator('iframe')).toHaveCount(0);

      await visit(page, '/comunidades');
      await visit(page, `/comunidades/${ids.communityId}`);
      await visit(page, '/eventos');
      await visit(page, `/eventos/${ids.eventId}`);
      if (ids.storyId) await visit(page, `/stories/${ids.storyId}`);
      await visit(page, '/suporte');
      await visit(page, '/notificacoes');
      await visit(page, `/post/${videoPostId}`);

      // A real avatar upload: the signed PUT goes straight to Supabase Storage (connect-src).
      await visit(page, '/perfil/editar');
      await pickPhoto(page, fileURLToPath(new URL('./fixtures/large.jpg', import.meta.url)));
      await expect(page.getByRole('status')).toHaveText('Foto atualizada.', { timeout: 30_000 });

      // Still nothing from a provider host: the walk rendered both cards and never tapped.
      expect(providerRequests, 'no provider request before a tap').toEqual([]);

      // The players: frame navigations answered locally, so nothing leaves the machine.
      const stubbed: string[] = [];
      await page.route(
        (url) => PROVIDER_HOST.test(url.hostname),
        async (route) => {
          stubbed.push(route.request().url());
          if (route.request().resourceType() === 'document') {
            await route.fulfill({
              contentType: 'text/html',
              body: '<!doctype html><title>stub</title><p>stub player</p>',
            });
          } else {
            await route.abort();
          }
        },
      );
      for (const [postId, embedOrigin] of [
        [youtubePostId, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
        [vimeoPostId, 'https://player.vimeo.com/video/76979871'],
      ] as const) {
        await visit(page, `/post/${postId}`);
        await expect(page.locator('iframe')).toHaveCount(0);
        await page.getByTestId('post-link-preview-play').click();
        const frame = page.getByTestId('post-link-preview-frame');
        await expect(frame).toBeVisible();
        await expect(frame).toHaveAttribute(
          'src',
          new RegExp(`^${embedOrigin.replace(/[.?/]/g, '\\$&')}`),
        );
        await expect
          .poll(() => page.frames().some((f) => f.url().startsWith(embedOrigin)))
          .toBe(true);
        await expect(
          page.frameLocator('[data-testid="post-link-preview-frame"]').getByText('stub player'),
        ).toBeVisible();
      }
      expect(stubbed.every((url) => !url.startsWith('http://'))).toBe(true);

      expect(violations()).toEqual([]);
    } finally {
      await resetMemberProfile(users.demoMember, {
        displayName: (profileBefore as { displayName: string }).displayName,
        bio: (profileBefore as { bio: string | null }).bio,
        avatarAssetId: (profileBefore as { avatarAssetId: string | null }).avatarAssetId,
      });
    }
  });

  test("csp walk — the admin's Administração screens with their sheet and previews", async ({
    page,
  }) => {
    const violations = await collectCspViolations(page);
    await login(page, users.demoAdmin, SEED_PASSWORD);

    await visit(page, '/configuracoes');

    await visit(page, '/configuracoes/marca');
    await expect(page.locator('#primary')).toBeVisible();

    await visit(page, '/configuracoes/membros');
    await page.locator('button[data-member-row]').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await visit(page, '/configuracoes/regras');
    await page.getByRole('button', { name: 'Ver como os novos membros veem' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await visit(page, '/configuracoes/moderacao');

    expect(violations()).toEqual([]);
  });

  test('csp walk — the platform panel as the super admin', async ({ page }) => {
    test.skip(!SUPER_ADMIN_PASSWORD, 'SUPER_ADMIN_PASSWORD is required (scripts/local-env.sh)');
    const violations = await collectCspViolations(page);
    await page.goto(`${hosts.platform}/entrar`);
    await page.locator('#email').fill(SUPER_ADMIN_EMAIL);
    await page.locator('#password').fill(SUPER_ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(`${hosts.platform}/inicio`, { timeout: 30_000 });
    await expect(page.locator('main').first()).toBeVisible();

    await visit(page, `${hosts.platform}/plataforma`);
    const tenantLink = page
      .locator('a[href^="/plataforma/tenants/"]', { hasText: 'rede-demo' })
      .first();
    const href = await tenantLink.getAttribute('href');
    expect(href).toBeTruthy();
    await visit(page, `${hosts.platform}${href}/marca`);
    await visit(page, `${hosts.platform}/plataforma/novo`);
    // Last: a `goto` issued right after the tenant detail page loaded is aborted (net::ERR_ABORTED,
    // identical under report-only, so not a policy effect); nothing follows it here.
    await visit(page, `${hosts.platform}${href}`);

    expect(violations()).toEqual([]);
  });
});
