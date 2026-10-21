import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-15 (UI-D-521, UI-D-532, T-09.1-70) — the ONE reader of the checkout link the member screens show.
 * `safeCheckoutUrl` is the whole phishing defence of the pending screen and the notice: only an `https:`
 * URL with a host and no credentials survives. `getSubscriptionStatus` never throws.
 */

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const { apiFetch } = await import('@/lib/api');
const { getSubscriptionStatus, safeCheckoutUrl } = await import('./subscription');

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('safeCheckoutUrl', () => {
  it('keeps an https URL with a host', () => {
    expect(safeCheckoutUrl('https://pay.example/x')).toBe('https://pay.example/x');
    expect(safeCheckoutUrl('https://pay.example/x?a=1&b=2#f')).toBe(
      'https://pay.example/x?a=1&b=2#f',
    );
  });

  it('refuses every other scheme, a protocol-relative URL and an empty value', () => {
    for (const value of [
      'http://pay.example/x',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '//evil.example/x',
      '/relative/path',
      'ftp://pay.example/x',
      '',
      '   ',
      null,
      undefined,
      42,
      {},
    ]) {
      expect(safeCheckoutUrl(value), String(value)).toBeNull();
    }
  });

  it('refuses a URL that carries credentials, and an over-long value', () => {
    expect(safeCheckoutUrl('https://user:pass@pay.example/x')).toBeNull();
    expect(safeCheckoutUrl('https://user@pay.example/x')).toBeNull();
    expect(safeCheckoutUrl(`https://pay.example/${'a'.repeat(3000)}`)).toBeNull();
  });
});

describe('getSubscriptionStatus', () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset());

  it('returns the strict { tenantName, checkoutUrl } answer', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(
      json(200, { tenantName: 'Rede Demo', checkoutUrl: 'https://pay.example/x' }),
    );
    await expect(getSubscriptionStatus()).resolves.toEqual({
      tenantName: 'Rede Demo',
      checkoutUrl: 'https://pay.example/x',
    });
    expect(apiFetch).toHaveBeenCalledWith('/v1/me/subscription');
  });

  it('returns null for a non-OK answer, a malformed body, extra keys and a transport failure', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(json(403, { error: { code: 'FORBIDDEN' } }));
    await expect(getSubscriptionStatus()).resolves.toBeNull();
    vi.mocked(apiFetch).mockResolvedValueOnce(json(200, { nope: true }));
    await expect(getSubscriptionStatus()).resolves.toBeNull();
    vi.mocked(apiFetch).mockResolvedValueOnce(
      json(200, { tenantName: 'A', checkoutUrl: null, other: 'Outra Comunidade' }),
    );
    await expect(getSubscriptionStatus()).resolves.toBeNull();
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response('not json', { status: 200 }));
    await expect(getSubscriptionStatus()).resolves.toBeNull();
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('network'));
    await expect(getSubscriptionStatus()).resolves.toBeNull();
  });
});
