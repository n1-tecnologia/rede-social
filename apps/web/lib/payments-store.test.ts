import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { deleteStoreMapping, getStoreMapping, putStoreMapping } from '@/lib/payments';

/**
 * 09.1-17 (PAY-20, D-502, A-P12, T-09.1-80, T-09.1-84) — the three store-mapping functions of the
 * payments web client. They return a closed outcome and NEVER throw: the product form turns each
 * reason into a field error or the shipped save toast, and a refusal the bootstrap knows becomes a
 * navigation the server action performs outside its try/catch. What is stubbed: `apiFetch` (the
 * transport). What is real: the schema parse and the issue mapping.
 */

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const PRODUCT = '11111111-1111-4111-8111-111111111111';
const SECRET_ID = 'segredo-do-gateway-123';
const SECRET_LINK = 'https://pay.example/segredo-do-link';
const MAPPING = { externalProductId: 'a1b2', checkoutUrl: 'https://pay.example/a1b2' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function refusal(status: number, code: string, details?: Record<string, unknown>): Response {
  return json(status, { error: { code, ...(details ? { details } : {}) } });
}

const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  logged.mockClear();
});

describe('getStoreMapping', () => {
  it('reads GET /v1/payments/store-products/{id} and returns the mapping and the connection', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { connected: true, mapping: MAPPING }));
    const outcome = await getStoreMapping(PRODUCT);
    expect(outcome).toEqual({ ok: true, connected: true, mapping: MAPPING });
    expect(apiFetch).toHaveBeenCalledWith(`/v1/payments/store-products/${PRODUCT}`, {
      method: 'GET',
    });
  });

  it('an unmapped product is mapping null', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { connected: false, mapping: null }));
    expect(await getStoreMapping(PRODUCT)).toEqual({ ok: true, connected: false, mapping: null });
  });

  it('encodes the id into the path', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { connected: true, mapping: null }));
    await getStoreMapping('a/b');
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe('/v1/payments/store-products/a%2Fb');
  });

  it('a body that is not the contract is a generic failure, not a throw', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { connected: 'yes' }));
    expect(await getStoreMapping(PRODUCT)).toEqual({ ok: false, reason: 'generic' });
  });
});

describe('putStoreMapping', () => {
  it('sends PUT with the JSON body and returns the stored mapping', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { connected: true, mapping: MAPPING }));
    const outcome = await putStoreMapping(PRODUCT, MAPPING);
    expect(outcome).toEqual({ ok: true, connected: true, mapping: MAPPING });
    const [path, init] = vi.mocked(apiFetch).mock.calls[0] ?? [];
    expect(path).toBe(`/v1/payments/store-products/${PRODUCT}`);
    expect(init).toMatchObject({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(MAPPING),
    });
  });

  it.each([
    [400, 'VALIDATION_FAILED', 'gateway_product_id_required', 'id_required'],
    [400, 'VALIDATION_FAILED', 'product_id_required', 'id_required'],
    [409, 'CONFLICT', 'gateway_product_taken', 'id_taken'],
    [400, 'VALIDATION_FAILED', 'link_invalid', 'link_invalid'],
  ])('%i %s with details.payments %s reads as %s', async (status, code, issue, reason) => {
    vi.mocked(apiFetch).mockResolvedValue(refusal(status, code, { payments: issue }));
    expect(await putStoreMapping(PRODUCT, MAPPING)).toEqual({ ok: false, reason });
  });

  it('an unknown issue is generic', async () => {
    vi.mocked(apiFetch).mockResolvedValue(refusal(400, 'VALIDATION_FAILED', { payments: 'novo' }));
    expect(await putStoreMapping(PRODUCT, MAPPING)).toEqual({ ok: false, reason: 'generic' });
  });
});

describe('deleteStoreMapping', () => {
  it('sends DELETE with no body and returns the empty mapping', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { connected: true, mapping: null }));
    expect(await deleteStoreMapping(PRODUCT)).toEqual({ ok: true, connected: true, mapping: null });
    expect(apiFetch).toHaveBeenCalledWith(`/v1/payments/store-products/${PRODUCT}`, {
      method: 'DELETE',
    });
  });

  it('an empty 204 answer is a success with nothing known about the connection', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(null, { status: 204 }));
    expect(await deleteStoreMapping(PRODUCT)).toEqual({
      ok: true,
      connected: null,
      mapping: null,
    });
  });
});

describe('refusals shared by the three (never a throw)', () => {
  const calls = [
    ['get', () => getStoreMapping(PRODUCT)],
    ['put', () => putStoreMapping(PRODUCT, MAPPING)],
    ['delete', () => deleteStoreMapping(PRODUCT)],
  ] as const;

  it.each(calls)('%s: the bare 404 is not_found', async (_name, call) => {
    vi.mocked(apiFetch).mockResolvedValue(refusal(404, 'NOT_FOUND'));
    expect(await call()).toEqual({ ok: false, reason: 'not_found' });
  });

  it.each(calls)('%s: a module switched off is not_found too', async (_name, call) => {
    vi.mocked(apiFetch).mockResolvedValue(refusal(404, 'MODULE_DISABLED'));
    expect(await call()).toEqual({ ok: false, reason: 'not_found' });
  });

  it.each(calls)('%s: 403 FORBIDDEN is forbidden', async (_name, call) => {
    vi.mocked(apiFetch).mockResolvedValue(refusal(403, 'FORBIDDEN'));
    expect(await call()).toEqual({ ok: false, reason: 'forbidden' });
  });

  it.each(calls)('%s: 401 is a redirect to the login', async (_name, call) => {
    vi.mocked(apiFetch).mockResolvedValue(refusal(401, 'UNAUTHORIZED'));
    expect(await call()).toEqual({ ok: false, reason: 'redirect', path: '/entrar' });
  });

  it.each(calls)(
    '%s: a blocked membership is a redirect the bootstrap knows',
    async (_name, call) => {
      vi.mocked(apiFetch).mockResolvedValue(
        refusal(403, 'MEMBERSHIP_BLOCKED', { tenantName: 'Rede Demo' }),
      );
      expect(await call()).toEqual({
        ok: false,
        reason: 'redirect',
        path: '/auth/blocked?t=Rede%20Demo',
      });
    },
  );

  it.each(calls)(
    '%s: a non-JSON 500 is generic and logs the status and code only',
    async (_name, call) => {
      vi.mocked(apiFetch).mockResolvedValue(new Response('<html>boom</html>', { status: 500 }));
      expect(await call()).toEqual({ ok: false, reason: 'generic' });
      expect(logged).toHaveBeenCalledWith('payments.store_mapping_failed', {
        status: 500,
        code: 'HTTP_ERROR',
      });
    },
  );

  it.each(calls)('%s: a thrown fetch is generic', async (_name, call) => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('network down'));
    expect(await call()).toEqual({ ok: false, reason: 'generic' });
  });

  it('no id, link or body ever reaches a log line (T-09.1-84)', async () => {
    vi.mocked(apiFetch).mockResolvedValue(refusal(500, 'INTERNAL'));
    await putStoreMapping(PRODUCT, { externalProductId: SECRET_ID, checkoutUrl: SECRET_LINK });
    await getStoreMapping(PRODUCT);
    const text = JSON.stringify(logged.mock.calls);
    expect(text).not.toContain(SECRET_ID);
    expect(text).not.toContain(SECRET_LINK);
  });
});
