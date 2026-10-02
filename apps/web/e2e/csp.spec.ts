import { type BrowserContext, expect, type Response, test } from '@playwright/test';
import { collectCspViolations } from './csp-collector';
import { login, SEED_PASSWORD, seededCommunityFeed, users } from './fixtures';

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
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Rede Demo');

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
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Rede Demo');

    expect(violations()).toEqual([]);
  });
});
