import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminQuestion, archivedQuestion } from './test-fixtures';

/**
 * 12-15 — the builder's server loaders (D-596, PFORM-23): `ok`, `forbidden` (403), `moduleOff` (404) and
 * `error` for anything else, a body that does not match the strict contract, or a thrown fetch. Nothing
 * here throws for an expected refusal, and no log line carries more than a status or an error class.
 */

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => mocks.apiFetch(...args) }));

const { loadAdminForm, loadArchived } = await import('./admin-reads');

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Routes each request to the body the test gave it, by path. */
function serve(routes: Record<string, Response | (() => Response)>) {
  mocks.apiFetch.mockImplementation(async (path: string) => {
    const hit = routes[path];
    if (!hit) throw new Error(`unexpected request ${path}`);
    return typeof hit === 'function' ? hit() : hit.clone();
  });
}

const summary = { total: 8, complete: 3, hasRequired: true };
const listOf = (count: number) => ({
  questions: Array.from({ length: count }, () => adminQuestion('short_text')),
  activeCount: count,
  limit: 30,
  // 12.1-08: the list now carries the tenant's steps; these tests build none.
  steps: [],
  stepLimit: 10,
});

beforeEach(() => {
  mocks.apiFetch.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('loadAdminForm', () => {
  it('is ok with the questions, the summary, the count and the limit', async () => {
    serve({
      '/v1/profile_form/questions': json(200, listOf(2)),
      '/v1/profile_form/summary': json(200, summary),
    });
    const result = await loadAdminForm();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.questions).toHaveLength(2);
    expect(result.summary).toEqual(summary);
    expect(result.activeCount).toBe(2);
    expect(result.limit).toBe(30);
    expect(result.archivedCount).toBeNull();
    // with active questions the archived list is not read
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
  });

  it('reads the archived list too, and only, when no question is active', async () => {
    serve({
      '/v1/profile_form/questions': json(200, listOf(0)),
      '/v1/profile_form/summary': json(200, summary),
      '/v1/profile_form/archived': json(200, {
        questions: [archivedQuestion('email'), archivedQuestion('date')],
      }),
    });
    const result = await loadAdminForm();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.questions).toEqual([]);
    expect(result.archivedCount).toBe(2);
  });

  it('is forbidden for a 403 on either read', async () => {
    serve({
      '/v1/profile_form/questions': json(403, { error: { code: 'FORBIDDEN' } }),
      '/v1/profile_form/summary': json(200, summary),
    });
    expect(await loadAdminForm()).toEqual({ status: 'forbidden' });
  });

  it('is moduleOff for a 404 (MODULE_DISABLED) on either read', async () => {
    serve({
      '/v1/profile_form/questions': json(200, listOf(1)),
      '/v1/profile_form/summary': json(404, { error: { code: 'MODULE_DISABLED' } }),
    });
    expect(await loadAdminForm()).toEqual({ status: 'moduleOff' });
  });

  it('is an error for a 500, a body that breaks the contract, and a thrown fetch', async () => {
    serve({
      '/v1/profile_form/questions': json(500, {}),
      '/v1/profile_form/summary': json(200, summary),
    });
    expect(await loadAdminForm()).toEqual({ status: 'error' });

    serve({
      '/v1/profile_form/questions': json(200, { questions: 'nope' }),
      '/v1/profile_form/summary': json(200, summary),
    });
    expect(await loadAdminForm()).toEqual({ status: 'error' });

    mocks.apiFetch.mockRejectedValue(new Error('boom'));
    expect(await loadAdminForm()).toEqual({ status: 'error' });
  });

  it('logs a status or an error class, never a payload', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    serve({
      '/v1/profile_form/questions': json(200, { questions: [{ title: 'segredo' }] }),
      '/v1/profile_form/summary': json(200, summary),
    });
    await loadAdminForm();
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain('segredo');
  });
});

describe('loadArchived', () => {
  it('is ok with the archived questions and the active count and limit', async () => {
    serve({
      '/v1/profile_form/archived': json(200, { questions: [archivedQuestion('phone')] }),
      '/v1/profile_form/questions': json(200, listOf(30)),
    });
    const result = await loadArchived();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.questions).toHaveLength(1);
    expect(result.activeCount).toBe(30);
    expect(result.limit).toBe(30);
  });

  it('maps 403, 404 and the rest like the form loader', async () => {
    serve({
      '/v1/profile_form/archived': json(403, {}),
      '/v1/profile_form/questions': json(200, listOf(0)),
    });
    expect(await loadArchived()).toEqual({ status: 'forbidden' });

    serve({
      '/v1/profile_form/archived': json(404, {}),
      '/v1/profile_form/questions': json(200, listOf(0)),
    });
    expect(await loadArchived()).toEqual({ status: 'moduleOff' });

    serve({
      '/v1/profile_form/archived': json(502, {}),
      '/v1/profile_form/questions': json(200, listOf(0)),
    });
    expect(await loadArchived()).toEqual({ status: 'error' });

    serve({
      '/v1/profile_form/archived': json(200, { questions: [{ id: 'not-a-question' }] }),
      '/v1/profile_form/questions': json(200, listOf(0)),
    });
    expect(await loadArchived()).toEqual({ status: 'error' });
  });
});
