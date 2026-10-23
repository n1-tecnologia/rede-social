import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Banco tab's server actions (09.2-19, D-539, DBT-40, PR-4a, P100). Real: the Zod the API validates
 * with, the mapping of the API's answers and the `redirect` rule. Stubbed: the one HTTP seam
 * (`apiFetch`), the revalidation and the redirect. The claims are about what leaves and what comes back:
 *
 *  - a malformed id or an empty body never reaches the API;
 *  - the values go to the API in the body of ONE PUT, only the non-empty ones, and come back nowhere:
 *    the answers are flags, no log line carries a value, and a thrown error's text is not logged;
 *  - the API's `access = invalid` refusal is `access`, anything else `generic`, 401/403 navigate;
 *  - a second resume (409) is `conflict`, not an error; verify and the poll probe never throw.
 */

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), redirect: vi.fn(), revalidate: vi.fn() }));

vi.mock('@/lib/api', () => ({ apiFetch: api.apiFetch }));
vi.mock('@/lib/env', () => ({ env: { API_URL: 'http://api.test' } }));
vi.mock('@/lib/revalidate-tenant', () => ({ revalidateTenantViews: api.revalidate }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    api.redirect(path);
    throw new Error(`NEXT_REDIRECT ${path}`);
  },
}));

const {
  pollDatabaseAction,
  replaceCredentialsAction,
  resumeBootstrapAction,
  verifyDatabaseAction,
} = await import('./actions');

const TENANT = '33333333-3333-4333-8333-333333333312';
const SECRET = 'S3nha-MUITO-secreta-9f8e7d6c5b4a';
const KEY = `sb_secret_${'k'.repeat(40)}`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const envelope = (status: number, code: string, details?: Record<string, unknown>) =>
  json(status, { error: { code, message: 'x', requestId: 'r1', ...(details ? { details } : {}) } });

const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  api.apiFetch.mockReset();
  api.redirect.mockReset();
  api.revalidate.mockReset();
  consoleError.mockClear();
  api.apiFetch.mockResolvedValue(json(200, { ok: true }));
});

describe('replaceCredentialsAction', () => {
  it('sends ONE PUT with only the non-empty values and answers a bare flag', async () => {
    const result = await replaceCredentialsAction(TENANT, {
      databasePassword: SECRET,
      serviceKey: '',
      publishableKey: undefined,
    });
    expect(result).toEqual({ ok: true });
    expect(api.apiFetch).toHaveBeenCalledTimes(1);
    const [path, init] = api.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/v1/platform/tenants/${TENANT}/database/credentials`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ databasePassword: SECRET });
    expect(path).not.toContain(SECRET);
    expect(api.revalidate).toHaveBeenCalledWith(TENANT);
  });

  it('never reaches the API with an empty body or a malformed tenant id', async () => {
    expect(await replaceCredentialsAction(TENANT, {})).toEqual({ ok: false, error: 'generic' });
    expect(await replaceCredentialsAction(TENANT, { serviceKey: '' })).toEqual({
      ok: false,
      error: 'generic',
    });
    expect(await replaceCredentialsAction('not-a-uuid', { serviceKey: KEY })).toEqual({
      ok: false,
      error: 'generic',
    });
    expect(api.apiFetch).not.toHaveBeenCalled();
  });

  it('maps the project\'s refusal ("access: invalid") to `access`, with nothing revalidated', async () => {
    api.apiFetch.mockResolvedValue(envelope(400, 'VALIDATION_FAILED', { access: 'invalid' }));
    expect(await replaceCredentialsAction(TENANT, { serviceKey: KEY })).toEqual({
      ok: false,
      error: 'access',
    });
    expect(api.revalidate).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'VALIDATION_FAILED'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [500, 'INTERNAL'],
  ])('maps a %s %s answer to `generic`', async (status, code) => {
    api.apiFetch.mockResolvedValue(envelope(status, code));
    expect(await replaceCredentialsAction(TENANT, { serviceKey: KEY })).toEqual({
      ok: false,
      error: 'generic',
    });
  });

  it('navigates on a 401 and on a 403, after the try/catch', async () => {
    api.apiFetch.mockResolvedValueOnce(envelope(401, 'UNAUTHENTICATED'));
    await expect(replaceCredentialsAction(TENANT, { serviceKey: KEY })).rejects.toThrow(
      'NEXT_REDIRECT /entrar',
    );
    api.apiFetch.mockResolvedValueOnce(envelope(403, 'FORBIDDEN'));
    await expect(replaceCredentialsAction(TENANT, { serviceKey: KEY })).rejects.toThrow(
      'NEXT_REDIRECT /auth/host-mismatch',
    );
  });

  it('logs only a status and a code, never a value or a thrown error text (PR-4a)', async () => {
    api.apiFetch.mockResolvedValueOnce(envelope(500, 'INTERNAL'));
    await replaceCredentialsAction(TENANT, { databasePassword: SECRET, serviceKey: KEY });
    api.apiFetch.mockRejectedValueOnce(new Error(`connect failed for ${SECRET} ${KEY}`));
    expect(
      await replaceCredentialsAction(TENANT, { databasePassword: SECRET, serviceKey: KEY }),
    ).toEqual({ ok: false, error: 'generic' });
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain('sb_secret_');
    expect(consoleError).toHaveBeenCalledTimes(2);
  });
});

describe('resumeBootstrapAction', () => {
  it('answers ok for the first click and `conflict` for the second (P100)', async () => {
    api.apiFetch.mockResolvedValueOnce(json(200, {}));
    expect(await resumeBootstrapAction(TENANT)).toEqual({ ok: true });
    api.apiFetch.mockResolvedValueOnce(envelope(409, 'CONFLICT'));
    expect(await resumeBootstrapAction(TENANT)).toEqual({ ok: false, error: 'conflict' });
    expect(api.apiFetch.mock.calls[0]?.[0]).toBe(
      `/v1/platform/tenants/${TENANT}/database/bootstrap/resume`,
    );
    expect(api.apiFetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(api.revalidate).toHaveBeenCalledTimes(2);
  });

  it('answers `generic` for any other failure, a bad id and a thrown request', async () => {
    api.apiFetch.mockResolvedValueOnce(envelope(500, 'INTERNAL'));
    expect(await resumeBootstrapAction(TENANT)).toEqual({ ok: false, error: 'generic' });
    api.apiFetch.mockRejectedValueOnce(new Error('network'));
    expect(await resumeBootstrapAction(TENANT)).toEqual({ ok: false, error: 'generic' });
    expect(await resumeBootstrapAction('nope')).toEqual({ ok: false, error: 'generic' });
  });

  it('navigates when the session is refused', async () => {
    api.apiFetch.mockResolvedValueOnce(envelope(403, 'TENANT_HOST_MISMATCH'));
    await expect(resumeBootstrapAction(TENANT)).rejects.toThrow(
      'NEXT_REDIRECT /auth/host-mismatch',
    );
  });
});

describe('verifyDatabaseAction', () => {
  it('posts to verify and answers ok, revalidating the tenant views', async () => {
    expect(await verifyDatabaseAction(TENANT)).toEqual({ ok: true });
    expect(api.apiFetch.mock.calls[0]?.[0]).toBe(`/v1/platform/tenants/${TENANT}/database/verify`);
    expect(api.revalidate).toHaveBeenCalledWith(TENANT);
  });

  it('answers not-ok for a 409 (still being prepared), a failure, a throw and a bad id', async () => {
    api.apiFetch.mockResolvedValueOnce(envelope(409, 'CONFLICT'));
    expect(await verifyDatabaseAction(TENANT)).toEqual({ ok: false });
    api.apiFetch.mockResolvedValueOnce(envelope(500, 'INTERNAL'));
    expect(await verifyDatabaseAction(TENANT)).toEqual({ ok: false });
    api.apiFetch.mockRejectedValueOnce(new Error('network'));
    expect(await verifyDatabaseAction(TENANT)).toEqual({ ok: false });
    expect(await verifyDatabaseAction('nope')).toEqual({ ok: false });
  });
});

describe('pollDatabaseAction', () => {
  it('is true while the overview answers and false otherwise, and never throws or redirects', async () => {
    api.apiFetch.mockResolvedValueOnce(json(200, {}));
    expect(await pollDatabaseAction(TENANT)).toBe(true);
    api.apiFetch.mockResolvedValueOnce(envelope(500, 'INTERNAL'));
    expect(await pollDatabaseAction(TENANT)).toBe(false);
    api.apiFetch.mockResolvedValueOnce(envelope(401, 'UNAUTHENTICATED'));
    expect(await pollDatabaseAction(TENANT)).toBe(false);
    api.apiFetch.mockRejectedValueOnce(new Error('network'));
    expect(await pollDatabaseAction(TENANT)).toBe(false);
    expect(await pollDatabaseAction('nope')).toBe(false);
    expect(api.redirect).not.toHaveBeenCalled();
  });
});
