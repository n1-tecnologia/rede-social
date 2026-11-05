import { beforeEach, describe, expect, it, vi } from 'vitest';
import { form, question, uuid } from '@/lib/profile-form/test-fixtures';

/**
 * 12-12 (D-583, UI-D-587; T-12-29, T-12-30) — the completion screen's save action. `apiFetch` is the
 * boundary and is mocked (the real browser-to-API path is plan 18's Playwright run). The destination has
 * ONE source: `safeNextPath` on the server, so a hostile `next` can never be echoed or followed.
 */

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => mocks.apiFetch(...args) }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));

const { saveProfileFormAction } = await import('./actions');

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const A = uuid(1);
const base = { formEtag: 'etag-1', answers: { [A]: 'x' }, mode: 'first' as const };

beforeEach(() => {
  mocks.apiFetch.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('saveProfileFormAction: the request', () => {
  it('PUTs the contract body to the answers route and nothing else', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, { missingRequired: 0 }));
    await saveProfileFormAction({ ...base, next: '/post/abc' });
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/v1/me/profile-form/answers');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ formEtag: 'etag-1', answers: { [A]: 'x' } });
  });

  it('refuses a malformed body before any request', async () => {
    const result = await saveProfileFormAction({ ...base, answers: { 'not-a-uuid': 'x' } });
    expect(result).toEqual({ ok: false, code: 'failed' });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });
});

describe('saveProfileFormAction: the step save (12.1, D-629, D-631)', () => {
  const STEP = uuid(701);
  const MISSING = uuid(5);

  it('sends the stepId with the contract body, and omits the key when no step is named', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, { missingRequired: 0, missingQuestionIds: [] }));
    await saveProfileFormAction({ ...base, stepId: STEP });
    const [, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      formEtag: 'etag-1',
      stepId: STEP,
      answers: { [A]: 'x' },
    });
    await saveProfileFormAction(base);
    const [, again] = mocks.apiFetch.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(again.body))).not.toHaveProperty('stepId');
  });

  it('refuses a stepId that is not a uuid before any request', async () => {
    expect(await saveProfileFormAction({ ...base, stepId: 'nope' })).toEqual({
      ok: false,
      code: 'failed',
    });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('missingRequired > 0 returns no destination, with the ids the gate reported', async () => {
    mocks.apiFetch.mockResolvedValue(
      json(200, { missingRequired: 1, missingQuestionIds: [MISSING] }),
    );
    expect(await saveProfileFormAction({ ...base, stepId: STEP, next: '/post/abc' })).toEqual({
      ok: true,
      destination: null,
      missingQuestionIds: [MISSING],
    });
  });

  it('missingRequired === 0 keeps the validated destination exactly as before', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, { missingRequired: 0, missingQuestionIds: [] }));
    expect(await saveProfileFormAction({ ...base, stepId: STEP, next: '//evil.com' })).toEqual({
      ok: true,
      destination: '/inicio',
    });
    expect(await saveProfileFormAction({ ...base, stepId: STEP, next: '/post/abc' })).toEqual({
      ok: true,
      destination: '/post/abc',
    });
  });

  it('an empty 200 body (a module turned off) still continues to the destination', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(null, { status: 200 }));
    expect(await saveProfileFormAction({ ...base, stepId: STEP })).toEqual({
      ok: true,
      destination: '/inicio',
    });
  });
});

describe('saveProfileFormAction: the destination (T-12-29)', () => {
  beforeEach(() => {
    mocks.apiFetch.mockResolvedValue(json(200, { missingRequired: 0 }));
  });

  it('keeps a same-origin relative next', async () => {
    expect(await saveProfileFormAction({ ...base, next: '/post/abc' })).toEqual({
      ok: true,
      destination: '/post/abc',
    });
  });

  it('falls back to /inicio for a hostile, encoded, scheme or missing next, and never echoes it', async () => {
    for (const next of [
      '//evil.com',
      '/\\evil.com',
      '%2F%2Fevil.com',
      'https://evil.com',
      'javascript:alert(1)',
      '/completar-perfil',
      `/${'a'.repeat(600)}`,
      '',
      undefined,
      null,
    ]) {
      const result = await saveProfileFormAction({ ...base, next });
      expect(result).toEqual({ ok: true, destination: '/inicio' });
    }
  });

  it('edit mode falls back to /perfil, and still honours a valid next', async () => {
    expect(await saveProfileFormAction({ ...base, mode: 'edit', next: '//evil.com' })).toEqual({
      ok: true,
      destination: '/perfil',
    });
    expect(await saveProfileFormAction({ ...base, mode: 'edit', next: '/membros/1' })).toEqual({
      ok: true,
      destination: '/membros/1',
    });
  });
});

describe('saveProfileFormAction: the refusals map to typed results', () => {
  it('400 answers_invalid carries the errors keyed by question id, only known issue codes', async () => {
    mocks.apiFetch.mockResolvedValue(
      json(400, {
        error: {
          code: 'VALIDATION_FAILED',
          details: {
            profileForm: 'answers_invalid',
            errors: { [A]: 'required', [uuid(2)]: 'too_long', [uuid(3)]: 'DROP TABLE' },
          },
        },
      }),
    );
    expect(await saveProfileFormAction(base)).toEqual({
      ok: false,
      code: 'invalid',
      errors: { [A]: 'required', [uuid(2)]: 'too_long' },
    });
  });

  it('409 form_changed carries the fresh form parsed by the contract', async () => {
    const fresh = form([question('short_text')], { formEtag: 'etag-2' });
    mocks.apiFetch.mockResolvedValue(
      json(409, {
        error: { code: 'CONFLICT', details: { profileForm: 'form_changed', form: fresh } },
      }),
    );
    const result = await saveProfileFormAction(base);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ code: 'changed', form: { formEtag: 'etag-2' } });
  });

  it('a 409 whose form does not match the contract is a plain failure', async () => {
    mocks.apiFetch.mockResolvedValue(
      json(409, {
        error: { code: 'CONFLICT', details: { profileForm: 'form_changed', form: {} } },
      }),
    );
    expect(await saveProfileFormAction(base)).toEqual({ ok: false, code: 'failed' });
  });

  it('500, an unknown 4xx and a transport error are failed', async () => {
    mocks.apiFetch.mockResolvedValueOnce(json(500, { error: { code: 'INTERNAL' } }));
    expect(await saveProfileFormAction(base)).toEqual({ ok: false, code: 'failed' });
    mocks.apiFetch.mockResolvedValueOnce(json(403, { error: { code: 'FORBIDDEN' } }));
    expect(await saveProfileFormAction(base)).toEqual({ ok: false, code: 'failed' });
    mocks.apiFetch.mockRejectedValueOnce(new Error('network'));
    expect(await saveProfileFormAction(base)).toEqual({ ok: false, code: 'failed' });
  });

  it('a session refusal follows the shipped navigation, outside the try/catch', async () => {
    mocks.apiFetch.mockResolvedValue(json(401, { error: { code: 'UNAUTHENTICATED' } }));
    await expect(saveProfileFormAction(base)).rejects.toThrow('REDIRECT /entrar');
  });
});

describe('saveProfileFormAction: no answer reaches a log (T-12-30)', () => {
  it('logs a status and a code only', async () => {
    const spy = vi.spyOn(console, 'error');
    mocks.apiFetch.mockResolvedValue(json(500, { error: { code: 'INTERNAL' } }));
    await saveProfileFormAction({ ...base, answers: { [A]: 'segredo-do-membro' } });
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain('profile_form.save_failed');
    expect(logged).not.toContain('segredo-do-membro');
  });
});
