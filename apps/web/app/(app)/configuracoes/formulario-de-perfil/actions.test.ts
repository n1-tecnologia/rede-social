import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminQuestion, uuid } from '@/lib/profile-form/test-fixtures';

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

const {
  archiveQuestionAction,
  createQuestionAction,
  deleteQuestionAction,
  reactivateQuestionAction,
  readImpactAction,
  reorderQuestionsAction,
  replaceQuestionAction,
  updateQuestionAction,
} = await import('./actions');

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

describe('readImpactAction (T-12-34)', () => {
  it('GETs /impact with the change and the question id and returns the server count', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, { members: 12 }));
    expect(await readImpactAction({ change: 'reactivate', questionId: IDS[0] })).toEqual({
      ok: true,
      members: 12,
    });
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit | undefined];
    expect(path).toBe(`/v1/profile_form/impact?change=reactivate&questionId=${IDS[0]}`);
    // a read: no method other than GET and no body
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init?.body).toBeUndefined();
  });

  it('refuses a malformed query without a request', async () => {
    expect(await readImpactAction({ change: 'reactivate', questionId: 'nope' })).toEqual({
      ok: false,
      code: 'failed',
    });
    expect(
      await readImpactAction({ change: 'delete' as unknown as 'reactivate', questionId: IDS[0] }),
    ).toEqual({ ok: false, code: 'failed' });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('is ok:false when the API fails, the body breaks the contract, or the request throws', async () => {
    mocks.apiFetch.mockResolvedValue(json(500, {}));
    expect(await readImpactAction({ change: 'reactivate', questionId: IDS[0] })).toEqual({
      ok: false,
      code: 'failed',
    });
    mocks.apiFetch.mockResolvedValue(json(200, { members: -1 }));
    expect(await readImpactAction({ change: 'reactivate', questionId: IDS[0] })).toEqual({
      ok: false,
      code: 'failed',
    });
    mocks.apiFetch.mockResolvedValue(json(200, { total: 3 }));
    expect(await readImpactAction({ change: 'reactivate', questionId: IDS[0] })).toEqual({
      ok: false,
      code: 'failed',
    });
    mocks.apiFetch.mockRejectedValue(new Error('network'));
    expect(await readImpactAction({ change: 'reactivate', questionId: IDS[0] })).toEqual({
      ok: false,
      code: 'failed',
    });
  });

  it('keeps 403 and 404 apart so the screen can end in not-found', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(403, 'FORBIDDEN'));
    expect(await readImpactAction({ change: 'reactivate', questionId: IDS[0] })).toEqual({
      ok: false,
      code: 'forbidden',
    });
    mocks.apiFetch.mockResolvedValue(refusal(404, 'MODULE_DISABLED'));
    expect(await readImpactAction({ change: 'reactivate', questionId: IDS[0] })).toEqual({
      ok: false,
      code: 'moduleOff',
    });
  });

  it('follows the shipped navigation for a refused session', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(401, 'UNAUTHENTICATED'));
    await expect(readImpactAction({ change: 'reactivate', questionId: IDS[0] })).rejects.toThrow(
      /^REDIRECT /,
    );
  });
});

describe('reactivateQuestionAction', () => {
  it('POSTs to /questions/{id}/reactivate', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, {}));
    expect(await reactivateQuestionAction(IDS[1] as string)).toEqual({ ok: true });
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/v1/profile_form/questions/${IDS[1]}/reactivate`);
    expect(init.method).toBe('POST');
  });

  it('refuses a malformed id without a request', async () => {
    expect(await reactivateQuestionAction('../../x')).toEqual({ ok: false, code: 'failed' });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('maps limit_reached (409), FORBIDDEN (403), MODULE_DISABLED (404) and the rest', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(409, 'CONFLICT', { profileForm: 'limit_reached' }));
    expect(await reactivateQuestionAction(IDS[1] as string)).toEqual({ ok: false, code: 'limit' });
    mocks.apiFetch.mockResolvedValue(refusal(403, 'FORBIDDEN'));
    expect(await reactivateQuestionAction(IDS[1] as string)).toEqual({
      ok: false,
      code: 'forbidden',
    });
    mocks.apiFetch.mockResolvedValue(refusal(404, 'MODULE_DISABLED'));
    expect(await reactivateQuestionAction(IDS[1] as string)).toEqual({
      ok: false,
      code: 'moduleOff',
    });
    mocks.apiFetch.mockResolvedValue(refusal(404, 'NOT_FOUND'));
    expect(await reactivateQuestionAction(IDS[1] as string)).toEqual({
      ok: false,
      code: 'failed',
    });
    mocks.apiFetch.mockResolvedValue(json(500, {}));
    expect(await reactivateQuestionAction(IDS[1] as string)).toEqual({
      ok: false,
      code: 'failed',
    });
    mocks.apiFetch.mockRejectedValue(new Error('network'));
    expect(await reactivateQuestionAction(IDS[1] as string)).toEqual({
      ok: false,
      code: 'failed',
    });
  });

  it('follows the shipped navigation for a refused session', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(401, 'UNAUTHENTICATED'));
    await expect(reactivateQuestionAction(IDS[1] as string)).rejects.toThrow(/^REDIRECT /);
  });
});

describe('createQuestionAction (12-16, PFORM-02)', () => {
  const body = {
    type: 'short_text',
    title: '  Cargo  ',
    helpText: '',
    required: true,
    showOnProfile: false,
    allowOther: false,
    options: [],
    limits: {},
  };
  const stored = adminQuestion('short_text', { title: 'Cargo', required: true });

  it('POSTs the contract body, trimmed, to /v1/profile_form/questions and returns the stored question', async () => {
    mocks.apiFetch.mockResolvedValue(json(201, stored));
    const result = await createQuestionAction(body);
    expect(result).toEqual({ ok: true, question: stored, pending: null });
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/v1/profile_form/questions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({
      type: 'short_text',
      title: 'Cargo',
      helpText: null,
      required: true,
    });
  });

  it('reads the SERVER summary after a reopening write and reports total minus complete', async () => {
    mocks.apiFetch.mockImplementation(async (path: string) =>
      path === '/v1/profile_form/summary'
        ? json(200, { total: 10, complete: 7, hasRequired: true })
        : json(201, stored),
    );
    expect(await createQuestionAction(body, { reopens: true })).toEqual({
      ok: true,
      question: stored,
      pending: 3,
    });
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the write when the summary read fails: the count is just unknown', async () => {
    mocks.apiFetch.mockImplementation(async (path: string) =>
      path === '/v1/profile_form/summary' ? json(500, {}) : json(201, stored),
    );
    expect(await createQuestionAction(body, { reopens: true })).toEqual({
      ok: true,
      question: stored,
      pending: null,
    });
  });

  it('does not read the summary for a write that cannot hold members back', async () => {
    mocks.apiFetch.mockResolvedValue(json(201, stored));
    await createQuestionAction(body, { reopens: false });
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
  });

  it('never leaves the server tier with a body the contract refuses, and names the field', async () => {
    expect(await createQuestionAction({ ...body, title: '  ' })).toEqual({
      ok: false,
      code: 'invalid',
      fields: { title: 'required' },
    });
    expect(
      await createQuestionAction({ ...body, type: 'dropdown', options: [{ label: 'só uma' }] }),
    ).toEqual({ ok: false, code: 'invalid', fields: { options: 'invalid' } });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('maps a 400 with issue paths to its fields', async () => {
    mocks.apiFetch.mockResolvedValue(
      refusal(400, 'VALIDATION_FAILED', {
        issues: [
          { path: 'title', message: 'too_long' },
          { path: 'options.1.label', message: 'invalid' },
        ],
      }),
    );
    expect(await createQuestionAction(body)).toEqual({
      ok: false,
      code: 'invalid',
      fields: { title: 'too_long', options: 'invalid' },
    });
  });

  it('places a lifted 400 code under the title for required and too_long, else on the form', async () => {
    mocks.apiFetch.mockResolvedValue(
      refusal(400, 'VALIDATION_FAILED', { profileForm: 'too_long' }),
    );
    expect(await createQuestionAction(body)).toEqual({
      ok: false,
      code: 'invalid',
      fields: { title: 'too_long' },
    });
    mocks.apiFetch.mockResolvedValue(refusal(400, 'VALIDATION_FAILED', { profileForm: 'invalid' }));
    expect(await createQuestionAction(body)).toEqual({
      ok: false,
      code: 'invalid',
      fields: { form: 'invalid' },
    });
  });

  it('maps 409 limit_reached, 403, MODULE_DISABLED and a plain 409 to their own codes', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(409, 'CONFLICT', { profileForm: 'limit_reached' }));
    expect(await createQuestionAction(body)).toEqual({ ok: false, code: 'limit' });
    mocks.apiFetch.mockResolvedValue(refusal(403, 'FORBIDDEN'));
    expect(await createQuestionAction(body)).toEqual({ ok: false, code: 'forbidden' });
    mocks.apiFetch.mockResolvedValue(refusal(404, 'MODULE_DISABLED'));
    expect(await createQuestionAction(body)).toEqual({ ok: false, code: 'moduleOff' });
    mocks.apiFetch.mockResolvedValue(refusal(409, 'CONFLICT', { profileForm: 'stale_revision' }));
    expect(await createQuestionAction(body)).toEqual({
      ok: false,
      code: 'conflict',
      issue: 'stale_revision',
    });
  });

  it('maps anything else, a broken body and a thrown request to failed', async () => {
    mocks.apiFetch.mockResolvedValue(json(500, {}));
    expect(await createQuestionAction(body)).toEqual({ ok: false, code: 'failed' });
    mocks.apiFetch.mockResolvedValue(json(201, { nope: true }));
    expect(await createQuestionAction(body)).toEqual({ ok: false, code: 'failed' });
    mocks.apiFetch.mockRejectedValue(new Error('network'));
    expect(await createQuestionAction(body)).toEqual({ ok: false, code: 'failed' });
  });

  it('follows the shipped navigation for a refused session, outside the catch', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(401, 'UNAUTHENTICATED'));
    await expect(createQuestionAction(body)).rejects.toThrow(/^REDIRECT /);
  });

  it('logs no more than a status and a code', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.apiFetch.mockResolvedValue(refusal(500, 'INTERNAL'));
    await createQuestionAction({ ...body, title: 'Segredo do Joao' });
    expect(JSON.stringify(spy.mock.calls)).not.toContain('Segredo');
  });
});

describe('updateQuestionAction (12-16, PFORM-17)', () => {
  const id = uuid(7);
  const stored = adminQuestion('short_text', { title: 'Cargo', revision: 5 });

  it('PATCHes /questions/{id} with the revision and the keys that changed, and returns the question', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, stored));
    const result = await updateQuestionAction(id, { revision: 4, title: ' Cargo ' });
    expect(result).toEqual({ ok: true, question: stored, pending: null });
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/v1/profile_form/questions/${id}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ revision: 4, title: 'Cargo' });
  });

  it('reads the server summary after a reopening edit', async () => {
    mocks.apiFetch.mockImplementation(async (path: string) =>
      path === '/v1/profile_form/summary'
        ? json(200, { total: 4, complete: 4, hasRequired: true })
        : json(200, stored),
    );
    expect(
      await updateQuestionAction(id, { revision: 4, required: true }, { reopens: true }),
    ).toEqual({
      ok: true,
      question: stored,
      pending: 0,
    });
  });

  it('refuses a body without a revision before any request', async () => {
    expect(await updateQuestionAction(id, { title: 'x' })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(await updateQuestionAction('not-a-uuid', { revision: 1 })).toEqual({
      ok: false,
      code: 'failed',
    });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it.each([
    'stale_revision',
    'type_locked',
    'option_locked',
    'other_locked',
    'visibility_locked',
    'limits_locked',
    'already_archived',
  ])('maps the 409 %s to a conflict carrying the code', async (issue) => {
    mocks.apiFetch.mockResolvedValue(refusal(409, 'CONFLICT', { profileForm: issue }));
    expect(await updateQuestionAction(id, { revision: 4, title: 'x' })).toEqual({
      ok: false,
      code: 'conflict',
      issue,
    });
  });

  it('maps a question that is gone (404 NOT_FOUND) to a conflict, not to module-off', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(404, 'NOT_FOUND'));
    expect(await updateQuestionAction(id, { revision: 4, title: 'x' })).toEqual({
      ok: false,
      code: 'conflict',
      issue: 'not_found',
    });
    mocks.apiFetch.mockResolvedValue(refusal(404, 'MODULE_DISABLED'));
    expect(await updateQuestionAction(id, { revision: 4, title: 'x' })).toEqual({
      ok: false,
      code: 'moduleOff',
    });
  });

  it('maps 403 and 500 and a thrown request, and follows the session navigation', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(403, 'FORBIDDEN'));
    expect(await updateQuestionAction(id, { revision: 4, title: 'x' })).toEqual({
      ok: false,
      code: 'forbidden',
    });
    mocks.apiFetch.mockResolvedValue(json(500, {}));
    expect(await updateQuestionAction(id, { revision: 4, title: 'x' })).toEqual({
      ok: false,
      code: 'failed',
    });
    mocks.apiFetch.mockRejectedValue(new Error('network'));
    expect(await updateQuestionAction(id, { revision: 4, title: 'x' })).toEqual({
      ok: false,
      code: 'failed',
    });
    mocks.apiFetch.mockResolvedValue(refusal(401, 'UNAUTHENTICATED'));
    await expect(updateQuestionAction(id, { revision: 4, title: 'x' })).rejects.toThrow(
      /^REDIRECT /,
    );
  });
});

describe('replaceQuestionAction (12-16, PFORM-17)', () => {
  const stored = adminQuestion('email', { title: 'E-mail' });
  const body = {
    type: 'email',
    title: 'E-mail',
    helpText: null,
    required: false,
    showOnProfile: false,
    allowOther: false,
    options: [],
    limits: {},
    replaces: uuid(8),
  };

  it('POSTs ONE request to /questions/replace carrying `replaces`', async () => {
    mocks.apiFetch.mockResolvedValue(json(201, stored));
    expect(await replaceQuestionAction(body)).toEqual({
      ok: true,
      question: stored,
      pending: null,
    });
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/v1/profile_form/questions/replace');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({ replaces: uuid(8), type: 'email' });
  });

  it('refuses a body without `replaces` before any request and maps the shared refusals', async () => {
    expect(await replaceQuestionAction({ ...body, replaces: 'nope' })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    mocks.apiFetch.mockResolvedValue(refusal(409, 'CONFLICT', { profileForm: 'already_archived' }));
    expect(await replaceQuestionAction(body)).toEqual({
      ok: false,
      code: 'conflict',
      issue: 'already_archived',
    });
    mocks.apiFetch.mockResolvedValue(json(500, {}));
    expect(await replaceQuestionAction(body)).toEqual({ ok: false, code: 'failed' });
  });
});

describe('archiveQuestionAction and deleteQuestionAction (12-16, D-588)', () => {
  const id = uuid(9);

  it('archive POSTs to /questions/{id}/archive', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, {}));
    expect(await archiveQuestionAction(id)).toEqual({ ok: true });
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/v1/profile_form/questions/${id}/archive`);
    expect(init.method).toBe('POST');
  });

  it('delete sends DELETE to /questions/{id}', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, { deleted: true }));
    expect(await deleteQuestionAction(id)).toEqual({ ok: true });
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/v1/profile_form/questions/${id}`);
    expect(init.method).toBe('DELETE');
  });

  it('maps 409 has_answers to hasAnswers (an answer arrived since the page was read)', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(409, 'CONFLICT', { profileForm: 'has_answers' }));
    expect(await deleteQuestionAction(id)).toEqual({ ok: false, code: 'hasAnswers' });
  });

  it('maps 404 NOT_FOUND to gone, 403, MODULE_DISABLED and anything else', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(404, 'NOT_FOUND'));
    expect(await archiveQuestionAction(id)).toEqual({ ok: false, code: 'gone' });
    mocks.apiFetch.mockResolvedValue(refusal(403, 'FORBIDDEN'));
    expect(await archiveQuestionAction(id)).toEqual({ ok: false, code: 'forbidden' });
    mocks.apiFetch.mockResolvedValue(refusal(404, 'MODULE_DISABLED'));
    expect(await deleteQuestionAction(id)).toEqual({ ok: false, code: 'moduleOff' });
    mocks.apiFetch.mockResolvedValue(json(500, {}));
    expect(await deleteQuestionAction(id)).toEqual({ ok: false, code: 'failed' });
    mocks.apiFetch.mockRejectedValue(new Error('network'));
    expect(await archiveQuestionAction(id)).toEqual({ ok: false, code: 'failed' });
  });

  it('never leaves the server tier with a malformed id and follows the session navigation', async () => {
    expect(await archiveQuestionAction('nope')).toEqual({ ok: false, code: 'failed' });
    expect(await deleteQuestionAction('nope')).toEqual({ ok: false, code: 'failed' });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    mocks.apiFetch.mockResolvedValue(refusal(401, 'UNAUTHENTICATED'));
    await expect(archiveQuestionAction(id)).rejects.toThrow(/^REDIRECT /);
  });
});
