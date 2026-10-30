import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uuid } from '@/lib/profile-form/test-fixtures';

/**
 * 12-15 — the builder's server actions (D-582; T-12-33, T-12-34). The API boundary is stubbed. Asserted:
 * the request each action sends, the typed result for each refusal of the API's closed vocabulary, the
 * session navigation outside the try/catch, and that no log line carries more than a status or a code.
 */

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), redirect: vi.fn() }));

vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => mocks.apiFetch(...args) }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    mocks.redirect(path);
    throw new Error(`REDIRECT ${path}`);
  },
}));

const { reorderQuestionsAction } = await import('./actions');

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const refusal = (status: number, code: string, details?: Record<string, unknown>) =>
  json(status, { error: { code, details } });

const IDS = [uuid(1), uuid(2), uuid(3)];

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.redirect.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('reorderQuestionsAction', () => {
  it('PUTs the whole ordered id list to /v1/profile_form/order', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, { questions: [] }));
    expect(await reorderQuestionsAction(IDS)).toEqual({ ok: true });
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/v1/profile_form/order');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ ids: IDS });
  });

  it('never leaves the server tier with a malformed list', async () => {
    expect(await reorderQuestionsAction([])).toEqual({ ok: false, code: 'failed' });
    expect(await reorderQuestionsAction([IDS[0] as string, IDS[0] as string])).toEqual({
      ok: false,
      code: 'failed',
    });
    expect(await reorderQuestionsAction(['not-a-uuid'])).toEqual({ ok: false, code: 'failed' });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('maps MODULE_DISABLED (404) to moduleOff', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(404, 'MODULE_DISABLED'));
    expect(await reorderQuestionsAction(IDS)).toEqual({ ok: false, code: 'moduleOff' });
  });

  it('maps FORBIDDEN (403) to forbidden, with no navigation', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(403, 'FORBIDDEN'));
    expect(await reorderQuestionsAction(IDS)).toEqual({ ok: false, code: 'forbidden' });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('maps 409 order_mismatch to mismatch', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(409, 'CONFLICT', { profileForm: 'order_mismatch' }));
    expect(await reorderQuestionsAction(IDS)).toEqual({ ok: false, code: 'mismatch' });
  });

  it('maps anything else, and a thrown request, to failed', async () => {
    mocks.apiFetch.mockResolvedValue(json(500, {}));
    expect(await reorderQuestionsAction(IDS)).toEqual({ ok: false, code: 'failed' });
    mocks.apiFetch.mockResolvedValue(refusal(409, 'CONFLICT', { profileForm: 'limit_reached' }));
    expect(await reorderQuestionsAction(IDS)).toEqual({ ok: false, code: 'failed' });
    mocks.apiFetch.mockRejectedValue(new Error('network'));
    expect(await reorderQuestionsAction(IDS)).toEqual({ ok: false, code: 'failed' });
  });

  it('follows the shipped navigation for a refused session, outside the try/catch', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(401, 'UNAUTHENTICATED'));
    await expect(reorderQuestionsAction(IDS)).rejects.toThrow(/^REDIRECT /);
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
  });

  it('logs a status and a code only, never an id or a title', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.apiFetch.mockResolvedValue(json(500, { error: { code: 'INTERNAL' } }));
    await reorderQuestionsAction(IDS);
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain('500');
    for (const id of IDS) expect(logged).not.toContain(id);
  });
});
