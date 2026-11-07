import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminQuestion, adminStep, uuid } from '@/lib/profile-form/test-fixtures';

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
  createBranchAction,
  createQuestionAction,
  createStepAction,
  deleteQuestionAction,
  deleteStepAction,
  reactivateQuestionAction,
  readImpactAction,
  reorderLayoutAction,
  reorderQuestionsAction,
  renameStepAction,
  replaceQuestionAction,
  undoBranchAction,
  updateBranchAction,
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

// ── 12.1-16: the steps and the layout reorder ──────────────────────────────────────────────────────

const STEP = adminStep({ title: 'Sobre a sua clínica', revision: 3 });

describe('reorderLayoutAction (D-623, D-627)', () => {
  const layout = {
    steps: [
      { id: uuid(801), questionIds: [uuid(1), uuid(2)] },
      { id: uuid(802), questionIds: [uuid(3)] },
    ],
  };

  it('PUTs the whole layout body to /v1/profile_form/order', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, { questions: [] }));
    expect(await reorderLayoutAction(layout)).toEqual({ ok: true });
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/v1/profile_form/order');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual(layout);
  });

  it('accepts a step with no question and never leaves the server tier with a malformed layout', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, { questions: [] }));
    expect(await reorderLayoutAction({ steps: [{ id: uuid(801), questionIds: [] }] })).toEqual({
      ok: true,
    });
    mocks.apiFetch.mockClear();
    expect(await reorderLayoutAction({ steps: [] })).toEqual({ ok: false, code: 'failed' });
    expect(
      await reorderLayoutAction({
        steps: [
          { id: uuid(801), questionIds: [uuid(1)] },
          { id: uuid(802), questionIds: [uuid(1)] },
        ],
      }),
    ).toEqual({ ok: false, code: 'failed' });
    expect(await reorderLayoutAction({ steps: [{ id: 'x', questionIds: [] }] })).toEqual({
      ok: false,
      code: 'failed',
    });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('maps the closed vocabulary: module off, forbidden, order_mismatch', async () => {
    mocks.apiFetch.mockResolvedValueOnce(refusal(404, 'MODULE_DISABLED'));
    expect(await reorderLayoutAction(layout)).toEqual({ ok: false, code: 'moduleOff' });
    mocks.apiFetch.mockResolvedValueOnce(refusal(403, 'FORBIDDEN'));
    expect(await reorderLayoutAction(layout)).toEqual({ ok: false, code: 'forbidden' });
    mocks.apiFetch.mockResolvedValueOnce(
      refusal(409, 'CONFLICT', { profileForm: 'order_mismatch' }),
    );
    expect(await reorderLayoutAction(layout)).toEqual({ ok: false, code: 'mismatch' });
  });

  it('carries the question and the opener of a coded condition_order 409', async () => {
    mocks.apiFetch.mockResolvedValue(
      refusal(409, 'CONFLICT', {
        profileForm: 'condition_order',
        questionId: uuid(3),
        openerId: uuid(1),
      }),
    );
    expect(await reorderLayoutAction(layout)).toEqual({
      ok: false,
      code: 'condition_order',
      questionId: uuid(3),
      openerId: uuid(1),
    });
  });

  it('is a failure, not a throw, for anything else, and navigates on a session refusal', async () => {
    mocks.apiFetch.mockResolvedValueOnce(refusal(500, 'INTERNAL'));
    expect(await reorderLayoutAction(layout)).toEqual({ ok: false, code: 'failed' });
    mocks.apiFetch.mockRejectedValueOnce(new Error('network'));
    expect(await reorderLayoutAction(layout)).toEqual({ ok: false, code: 'failed' });
    mocks.apiFetch.mockResolvedValueOnce(refusal(401, 'UNAUTHENTICATED'));
    await expect(reorderLayoutAction(layout)).rejects.toThrow(/REDIRECT/);
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
  });
});

describe('createStepAction (D-627, D-633)', () => {
  it('POSTs the title to /v1/profile_form/steps and parses the step', async () => {
    mocks.apiFetch.mockResolvedValue(json(201, STEP));
    expect(await createStepAction({ title: '  Sobre a sua clínica ' })).toEqual({
      ok: true,
      step: STEP,
    });
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/v1/profile_form/steps');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ title: 'Sobre a sua clínica' });
  });

  it('never leaves the server tier with an empty or a too long title', async () => {
    expect(await createStepAction({ title: '   ' })).toEqual({
      ok: false,
      code: 'invalid',
      issue: 'required',
    });
    expect(await createStepAction({ title: 'x'.repeat(61) })).toEqual({
      ok: false,
      code: 'invalid',
      issue: 'too_long',
    });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('maps 409 limit_reached, 400 issues, 403 and 404 module off', async () => {
    mocks.apiFetch.mockResolvedValueOnce(
      refusal(409, 'CONFLICT', { profileForm: 'limit_reached' }),
    );
    expect(await createStepAction({ title: 'Contato' })).toEqual({
      ok: false,
      code: 'limit_reached',
    });
    mocks.apiFetch.mockResolvedValueOnce(
      refusal(400, 'VALIDATION_FAILED', { profileForm: 'too_long' }),
    );
    expect(await createStepAction({ title: 'Contato' })).toEqual({
      ok: false,
      code: 'invalid',
      issue: 'too_long',
    });
    mocks.apiFetch.mockResolvedValueOnce(refusal(403, 'FORBIDDEN'));
    expect(await createStepAction({ title: 'Contato' })).toEqual({ ok: false, code: 'forbidden' });
    mocks.apiFetch.mockResolvedValueOnce(refusal(404, 'MODULE_DISABLED'));
    expect(await createStepAction({ title: 'Contato' })).toEqual({ ok: false, code: 'moduleOff' });
  });

  it('is a failure for a body that breaks the contract, a 500 and a thrown request', async () => {
    mocks.apiFetch.mockResolvedValueOnce(json(201, { id: 'x' }));
    expect(await createStepAction({ title: 'Contato' })).toEqual({ ok: false, code: 'failed' });
    mocks.apiFetch.mockResolvedValueOnce(refusal(500, 'INTERNAL'));
    expect(await createStepAction({ title: 'Contato' })).toEqual({ ok: false, code: 'failed' });
    mocks.apiFetch.mockRejectedValueOnce(new Error('network'));
    expect(await createStepAction({ title: 'Contato' })).toEqual({ ok: false, code: 'failed' });
  });

  it('navigates on a lost session OUTSIDE the request handling', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(401, 'UNAUTHENTICATED'));
    await expect(createStepAction({ title: 'Contato' })).rejects.toThrow(/REDIRECT/);
  });
});

describe('renameStepAction (D-627)', () => {
  it('PATCHes the title with the revision the admin read', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, { ...STEP, revision: 4, title: 'Rotina' }));
    const result = await renameStepAction({ id: STEP.id, revision: 3, title: 'Rotina' });
    expect(result).toMatchObject({ ok: true, step: { title: 'Rotina', revision: 4 } });
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/v1/profile_form/steps/${STEP.id}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ revision: 3, title: 'Rotina' });
  });

  it('maps a stale revision to its own code, and a missing step to gone', async () => {
    mocks.apiFetch.mockResolvedValueOnce(
      refusal(409, 'CONFLICT', { profileForm: 'stale_revision' }),
    );
    expect(await renameStepAction({ id: STEP.id, revision: 3, title: 'Rotina' })).toEqual({
      ok: false,
      code: 'stale_revision',
    });
    mocks.apiFetch.mockResolvedValueOnce(refusal(404, 'NOT_FOUND'));
    expect(await renameStepAction({ id: STEP.id, revision: 3, title: 'Rotina' })).toEqual({
      ok: false,
      code: 'gone',
    });
  });

  it('refuses a malformed id or title before any request', async () => {
    expect(await renameStepAction({ id: 'nope', revision: 3, title: 'Rotina' })).toEqual({
      ok: false,
      code: 'failed',
    });
    expect(await renameStepAction({ id: STEP.id, revision: 0, title: 'Rotina' })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(await renameStepAction({ id: STEP.id, revision: 3, title: '' })).toEqual({
      ok: false,
      code: 'invalid',
      issue: 'required',
    });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });
});

describe('deleteStepAction (D-627)', () => {
  it('DELETEs the step', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, { deleted: true }));
    expect(await deleteStepAction(STEP.id)).toEqual({ ok: true });
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/v1/profile_form/steps/${STEP.id}`);
    expect(init.method).toBe('DELETE');
  });

  it('maps step_not_empty and last_step to their own codes: a step with questions is never deleted', async () => {
    mocks.apiFetch.mockResolvedValueOnce(
      refusal(409, 'CONFLICT', { profileForm: 'step_not_empty' }),
    );
    expect(await deleteStepAction(STEP.id)).toEqual({ ok: false, code: 'step_not_empty' });
    mocks.apiFetch.mockResolvedValueOnce(refusal(409, 'CONFLICT', { profileForm: 'last_step' }));
    expect(await deleteStepAction(STEP.id)).toEqual({ ok: false, code: 'last_step' });
  });

  it('maps a step that is gone, a lost permission and a module turned off', async () => {
    mocks.apiFetch.mockResolvedValueOnce(refusal(404, 'NOT_FOUND'));
    expect(await deleteStepAction(STEP.id)).toEqual({ ok: false, code: 'gone' });
    mocks.apiFetch.mockResolvedValueOnce(refusal(403, 'FORBIDDEN'));
    expect(await deleteStepAction(STEP.id)).toEqual({ ok: false, code: 'forbidden' });
    mocks.apiFetch.mockResolvedValueOnce(refusal(404, 'MODULE_DISABLED'));
    expect(await deleteStepAction(STEP.id)).toEqual({ ok: false, code: 'moduleOff' });
  });

  it('refuses a malformed id, a body that breaks the contract and a thrown request', async () => {
    expect(await deleteStepAction('nope')).toEqual({ ok: false, code: 'failed' });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    mocks.apiFetch.mockResolvedValueOnce(json(200, { deleted: false }));
    expect(await deleteStepAction(STEP.id)).toEqual({ ok: false, code: 'failed' });
    mocks.apiFetch.mockRejectedValueOnce(new Error('network'));
    expect(await deleteStepAction(STEP.id)).toEqual({ ok: false, code: 'failed' });
  });
});

describe('logging (T-12.1-12)', () => {
  it('logs only a status and a code for a refused step write, never the title', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.apiFetch.mockResolvedValue(refusal(500, 'INTERNAL'));
    await createStepAction({ title: 'Titulo secreto da etapa' });
    for (const call of spy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('Titulo secreto');
    }
  });
});

// ── 12.1-17: the condition on the impact read, the dependents list and the reactivation race ──────

describe('12.1-17: readImpactAction carries the condition of a new question (D-634)', () => {
  it('sends remove_condition for a stored question', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, { members: 4 }));
    expect(await readImpactAction({ change: 'remove_condition', questionId: IDS[0] })).toEqual({
      ok: true,
      members: 4,
    });
    const [path] = mocks.apiFetch.mock.calls[0] as [string];
    const params = new URL(path, 'http://x').searchParams;
    expect(params.get('change')).toBe('remove_condition');
    expect(params.get('questionId')).toBe(IDS[0]);
    expect(params.has('conditionQuestionId')).toBe(false);
  });

  it('sends the opener and the tokens, comma-joined, for a create or a replace', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, { members: 2 }));
    await readImpactAction({
      change: 'create_required',
      conditionQuestionId: IDS[1],
      conditionValues: [uuid(9001), uuid(9002)],
    });
    const [path] = mocks.apiFetch.mock.calls[0] as [string];
    const params = new URL(path, 'http://x').searchParams;
    expect(params.get('conditionQuestionId')).toBe(IDS[1]);
    expect(params.get('conditionValues')).toBe(`${uuid(9001)},${uuid(9002)}`);
  });

  it('carries the literal true or false of a yes/no opener', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, { members: 0 }));
    await readImpactAction({
      change: 'replace',
      questionId: IDS[0],
      conditionQuestionId: IDS[1],
      conditionValues: ['false'],
    });
    const [path] = mocks.apiFetch.mock.calls[0] as [string];
    expect(new URL(path, 'http://x').searchParams.get('conditionValues')).toBe('false');
  });

  it('refuses a malformed opener id before any request', async () => {
    expect(
      await readImpactAction({
        change: 'create_required',
        conditionQuestionId: 'nope',
        conditionValues: ['true'],
      }),
    ).toEqual({ ok: false, code: 'failed' });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });
});

describe('12.1-17: has_dependents and condition_invalid (D-632)', () => {
  const dependents = [
    { id: uuid(91), title: 'Quantas salas?' },
    { id: uuid(92), title: 'Nome da clínica' },
  ];

  it('an update answered with has_dependents keeps the server list on the conflict', async () => {
    mocks.apiFetch.mockResolvedValue(
      refusal(409, 'CONFLICT', { profileForm: 'has_dependents', dependents }),
    );
    expect(await updateQuestionAction(IDS[0] as string, { revision: 1, title: 'X' })).toEqual({
      ok: false,
      code: 'conflict',
      issue: 'has_dependents',
      dependents,
    });
  });

  it('drops a dependents list that breaks the contract instead of trusting it', async () => {
    mocks.apiFetch.mockResolvedValue(
      refusal(409, 'CONFLICT', {
        profileForm: 'has_dependents',
        dependents: [{ title: 'sem id' }],
      }),
    );
    expect(await updateQuestionAction(IDS[0] as string, { revision: 1, title: 'X' })).toEqual({
      ok: false,
      code: 'conflict',
      issue: 'has_dependents',
    });
  });

  it('archive and delete answer hasDependents with the list', async () => {
    mocks.apiFetch.mockImplementation(() =>
      Promise.resolve(refusal(409, 'CONFLICT', { profileForm: 'has_dependents', dependents })),
    );
    expect(await archiveQuestionAction(IDS[0] as string)).toEqual({
      ok: false,
      code: 'hasDependents',
      dependents,
    });
    expect(await deleteQuestionAction(IDS[0] as string)).toEqual({
      ok: false,
      code: 'hasDependents',
      dependents,
    });
  });

  it('a condition_invalid conflict on a write is carried as its issue', async () => {
    mocks.apiFetch.mockResolvedValue(
      refusal(409, 'CONFLICT', { profileForm: 'condition_invalid' }),
    );
    expect(await updateQuestionAction(IDS[0] as string, { revision: 1, title: 'X' })).toEqual({
      ok: false,
      code: 'conflict',
      issue: 'condition_invalid',
    });
  });

  it('a reactivation refused with condition_invalid names the opener', async () => {
    mocks.apiFetch.mockResolvedValue(
      refusal(409, 'CONFLICT', { profileForm: 'condition_invalid', openerId: IDS[1] }),
    );
    expect(await reactivateQuestionAction(IDS[0] as string)).toEqual({
      ok: false,
      code: 'conditionInvalid',
      openerId: IDS[1],
    });
  });

  it('a reactivation refused with condition_invalid and no opener id still says so', async () => {
    mocks.apiFetch.mockResolvedValue(
      refusal(409, 'CONFLICT', { profileForm: 'condition_invalid' }),
    );
    expect(await reactivateQuestionAction(IDS[0] as string)).toEqual({
      ok: false,
      code: 'conditionInvalid',
      openerId: null,
    });
  });

  it('a create carries the condition and the step to the API untouched', async () => {
    mocks.apiFetch.mockResolvedValue(json(201, adminQuestion('short_text')));
    await createQuestionAction({
      type: 'short_text',
      title: 'Nome da clínica',
      stepId: IDS[2],
      condition: { questionId: IDS[1], values: [uuid(9001)] },
    });
    const [, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(String(init.body));
    expect(sent.stepId).toBe(IDS[2]);
    expect(sent.condition).toEqual({ questionId: IDS[1], values: [uuid(9001)] });
  });

  it('an update removes the condition with an explicit null', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, adminQuestion('short_text')));
    await updateQuestionAction(IDS[0] as string, { revision: 2, condition: null });
    const [, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ revision: 2, condition: null });
  });
});

// ── 12.2-16: createBranchAction (D-640, D-644, D-651; PFORM-57; T-12.2-01) ──────────────────────────

describe('createBranchAction (12.2-16)', () => {
  const OPENER = uuid(4600);
  const TOKEN = uuid(9601);
  const BRANCH = {
    id: uuid(4601),
    openerQuestionId: OPENER,
    values: [TOKEN],
    name: 'Quem tem clínica',
    revision: 1,
    archivedAt: null,
    questionCount: 0,
    answerCount: 0,
  };
  const body = { openerQuestionId: OPENER, values: [TOKEN], name: 'Quem tem clínica' };

  it('POSTs the contract body to /v1/profile_form/branches and returns the parsed branch', async () => {
    mocks.apiFetch.mockResolvedValue(json(201, BRANCH));
    expect(await createBranchAction({ ...body, name: '  Quem tem clínica  ' })).toEqual({
      ok: true,
      branch: BRANCH,
    });
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/v1/profile_form/branches');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(body);
  });

  it('sends a blank or absent name as null', async () => {
    mocks.apiFetch.mockResolvedValue(json(201, { ...BRANCH, name: null }));
    await createBranchAction({ openerQuestionId: OPENER, values: [TOKEN], name: '   ' });
    await createBranchAction({ openerQuestionId: OPENER, values: [TOKEN] });
    for (const call of mocks.apiFetch.mock.calls as [string, RequestInit][]) {
      expect(JSON.parse(String(call[1].body))).toEqual({
        openerQuestionId: OPENER,
        values: [TOKEN],
        name: null,
      });
    }
  });

  it('never leaves the server tier with a body the contract refuses, and names the field', async () => {
    const none = await createBranchAction({ openerQuestionId: OPENER, values: [] });
    expect(none).toEqual({ ok: false, code: 'invalid', fields: { values: 'condition_invalid' } });
    const long = await createBranchAction({ ...body, name: 'x'.repeat(61) });
    expect(long).toEqual({ ok: false, code: 'invalid', fields: { name: 'too_long' } });
    // The contracts' one definition of an unsafe name: NUL and a lone surrogate (a BEL is stored like in every other text).
    for (const unsafe of ['a\u0000b', 'a\ud800b']) {
      expect(await createBranchAction({ ...body, name: unsafe })).toEqual({
        ok: false,
        code: 'invalid',
        fields: { name: 'invalid' },
      });
    }
    const noOpener = await createBranchAction({ openerQuestionId: 'nope', values: [TOKEN] });
    expect(noOpener).toEqual({
      ok: false,
      code: 'invalid',
      fields: { opener: 'condition_invalid' },
    });
    const many = await createBranchAction({
      openerQuestionId: OPENER,
      values: Array.from({ length: 21 }, (_, at) => `t${at}`),
    });
    expect(many).toEqual({ ok: false, code: 'invalid', fields: { values: 'condition_invalid' } });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('counts the name in code points: 60 emoji go through, 61 do not', async () => {
    mocks.apiFetch.mockResolvedValue(json(201, BRANCH));
    expect((await createBranchAction({ ...body, name: '😀'.repeat(60) })).ok).toBe(true);
    expect(await createBranchAction({ ...body, name: '😀'.repeat(61) })).toEqual({
      ok: false,
      code: 'invalid',
      fields: { name: 'too_long' },
    });
  });

  it('maps a 400 with issue paths to its fields', async () => {
    mocks.apiFetch.mockResolvedValueOnce(
      refusal(400, 'VALIDATION_FAILED', {
        issues: [
          { path: 'name', message: 'too_long' },
          { path: 'values.0', message: 'condition_invalid' },
        ],
      }),
    );
    expect(await createBranchAction(body)).toEqual({
      ok: false,
      code: 'invalid',
      fields: { name: 'too_long', values: 'condition_invalid' },
    });
    mocks.apiFetch.mockResolvedValueOnce(
      refusal(400, 'VALIDATION_FAILED', { profileForm: 'condition_invalid' }),
    );
    expect(await createBranchAction(body)).toEqual({
      ok: false,
      code: 'invalid',
      fields: { form: 'condition_invalid' },
    });
  });

  it('maps 409 branch_limit to limit, and branch_depth and the others to conflict with the issue', async () => {
    mocks.apiFetch.mockResolvedValueOnce(refusal(409, 'CONFLICT', { profileForm: 'branch_limit' }));
    expect(await createBranchAction(body)).toEqual({ ok: false, code: 'limit' });
    mocks.apiFetch.mockResolvedValueOnce(refusal(409, 'CONFLICT', { profileForm: 'branch_depth' }));
    expect(await createBranchAction(body)).toEqual({
      ok: false,
      code: 'conflict',
      issue: 'branch_depth',
    });
    mocks.apiFetch.mockResolvedValueOnce(
      refusal(409, 'CONFLICT', { profileForm: 'condition_invalid' }),
    );
    expect(await createBranchAction(body)).toEqual({
      ok: false,
      code: 'conflict',
      issue: 'condition_invalid',
    });
  });

  it('maps 403, MODULE_DISABLED, a bare 404, a 500, a broken body and a thrown request', async () => {
    mocks.apiFetch.mockResolvedValueOnce(refusal(403, 'FORBIDDEN'));
    expect(await createBranchAction(body)).toEqual({ ok: false, code: 'forbidden' });
    mocks.apiFetch.mockResolvedValueOnce(refusal(404, 'MODULE_DISABLED'));
    expect(await createBranchAction(body)).toEqual({ ok: false, code: 'moduleOff' });
    mocks.apiFetch.mockResolvedValueOnce(refusal(404, 'NOT_FOUND'));
    expect(await createBranchAction(body)).toEqual({
      ok: false,
      code: 'conflict',
      issue: 'not_found',
    });
    mocks.apiFetch.mockResolvedValueOnce(refusal(500, 'INTERNAL'));
    expect(await createBranchAction(body)).toEqual({ ok: false, code: 'failed' });
    mocks.apiFetch.mockResolvedValueOnce(json(201, { id: 'x' }));
    expect(await createBranchAction(body)).toEqual({ ok: false, code: 'failed' });
    mocks.apiFetch.mockRejectedValueOnce(new Error('network'));
    expect(await createBranchAction(body)).toEqual({ ok: false, code: 'failed' });
  });

  it('navigates on a lost session OUTSIDE the request handling, and logs no more than a status and a code', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(401, 'UNAUTHENTICATED'));
    await expect(createBranchAction(body)).rejects.toThrow(/REDIRECT/);
    mocks.apiFetch.mockResolvedValueOnce(refusal(500, 'INTERNAL'));
    await createBranchAction({ ...body, name: 'Nome secreto' });
    const logged = JSON.stringify(
      (console.error as unknown as { mock: { calls: unknown[] } }).mock.calls,
    );
    expect(logged).not.toContain('Nome secreto');
  });

  it('sends the impact read the branch of a new question (D-634)', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, { members: 3 }));
    expect(await readImpactAction({ change: 'create_required', branchId: BRANCH.id })).toEqual({
      ok: true,
      members: 3,
    });
    const [path] = mocks.apiFetch.mock.calls[0] as [string];
    const params = new URL(path, 'http://x').searchParams;
    expect(params.get('change')).toBe('create_required');
    expect(params.get('branchId')).toBe(BRANCH.id);
    expect(params.has('conditionQuestionId')).toBe(false);
  });

  it('places a refused branchId of a question write under the branch field', async () => {
    mocks.apiFetch.mockResolvedValue(
      refusal(400, 'VALIDATION_FAILED', {
        issues: [{ path: 'branchId', message: 'unknown_branch' }],
      }),
    );
    expect(await updateQuestionAction(IDS[0] as string, { revision: 1, title: 'Cargo' })).toEqual({
      ok: false,
      code: 'invalid',
      fields: { branch: 'unknown_branch' },
    });
  });
});

// ── 12.2-17: updateBranchAction (D-640, D-642, D-646; PFORM-49; T-12.2-01) ──────────────────────────

describe('updateBranchAction (12.2-17)', () => {
  const OPENER = uuid(4700);
  const TOKEN = uuid(9701);
  const BRANCH = {
    id: uuid(4701),
    openerQuestionId: OPENER,
    values: [TOKEN],
    name: 'Quem tem clínica',
    revision: 4,
    archivedAt: null,
    questionCount: 2,
    answerCount: 0,
  };

  it('PATCHes /v1/profile_form/branches/{id} with only the keys sent and returns the parsed branch', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, BRANCH));
    expect(await updateBranchAction(BRANCH.id, { revision: 3, name: ' Novo nome ' })).toEqual({
      ok: true,
      branch: BRANCH,
    });
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/v1/profile_form/branches/${BRANCH.id}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ revision: 3, name: 'Novo nome' });
  });

  it('sends a null name to clear it and the new opener and answers when given', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, BRANCH));
    await updateBranchAction(BRANCH.id, {
      revision: 3,
      openerQuestionId: OPENER,
      values: [TOKEN],
      name: null,
    });
    const [, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      revision: 3,
      openerQuestionId: OPENER,
      values: [TOKEN],
      name: null,
    });
  });

  it('never leaves the server tier with a forged id or a body the contract refuses', async () => {
    expect(await updateBranchAction('not-a-uuid', { revision: 1 })).toEqual({
      ok: false,
      code: 'failed',
    });
    expect(await updateBranchAction(BRANCH.id, { revision: 0 })).toEqual({
      ok: false,
      code: 'invalid',
      fields: { form: 'invalid' },
    });
    expect(await updateBranchAction(BRANCH.id, { revision: 1, values: [] })).toEqual({
      ok: false,
      code: 'invalid',
      fields: { values: 'condition_invalid' },
    });
    expect(await updateBranchAction(BRANCH.id, { revision: 1, name: 'x'.repeat(61) })).toEqual({
      ok: false,
      code: 'invalid',
      fields: { name: 'too_long' },
    });
    expect(await updateBranchAction(BRANCH.id, { revision: 1, extra: true })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('answers a 409 stale_revision as its own code', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(409, 'CONFLICT', { profileForm: 'stale_revision' }));
    expect(await updateBranchAction(BRANCH.id, { revision: 1, name: 'x' })).toEqual({
      ok: false,
      code: 'stale_revision',
    });
  });

  it('answers the other 409s as a conflict that names the issue', async () => {
    for (const issue of [
      'condition_locked',
      'branch_depth',
      'already_archived',
      'condition_order',
    ]) {
      mocks.apiFetch.mockResolvedValue(refusal(409, 'CONFLICT', { profileForm: issue }));
      expect(await updateBranchAction(BRANCH.id, { revision: 1, name: 'x' })).toEqual({
        ok: false,
        code: 'conflict',
        issue,
      });
    }
  });

  it('answers a bare 404 as a conflict (not_found), a 400 per field, and the shared codes', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(404, 'NOT_FOUND'));
    expect(await updateBranchAction(BRANCH.id, { revision: 1, name: 'x' })).toEqual({
      ok: false,
      code: 'conflict',
      issue: 'not_found',
    });
    mocks.apiFetch.mockResolvedValue(
      refusal(400, 'VALIDATION_FAILED', {
        issues: [{ path: 'values', message: 'condition_invalid' }],
      }),
    );
    expect(await updateBranchAction(BRANCH.id, { revision: 1, name: 'x' })).toEqual({
      ok: false,
      code: 'invalid',
      fields: { values: 'condition_invalid' },
    });
    mocks.apiFetch.mockResolvedValue(refusal(403, 'FORBIDDEN'));
    expect(await updateBranchAction(BRANCH.id, { revision: 1, name: 'x' })).toEqual({
      ok: false,
      code: 'forbidden',
    });
    mocks.apiFetch.mockResolvedValue(refusal(404, 'MODULE_DISABLED'));
    expect(await updateBranchAction(BRANCH.id, { revision: 1, name: 'x' })).toEqual({
      ok: false,
      code: 'moduleOff',
    });
  });

  it('answers a thrown request and a body that breaks the contract as failed, redirecting only outside the try', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('network'));
    expect(await updateBranchAction(BRANCH.id, { revision: 1, name: 'x' })).toEqual({
      ok: false,
      code: 'failed',
    });
    mocks.apiFetch.mockResolvedValue(json(200, { nope: true }));
    expect(await updateBranchAction(BRANCH.id, { revision: 1, name: 'x' })).toEqual({
      ok: false,
      code: 'failed',
    });
  });
});

// ── 12.2-17 Task 2: the impact of undoing a branch, and undoBranchAction (D-653; T-12.2-01) ──────────

describe('readImpactAction with undo_branch (12.2-17)', () => {
  const BRANCH = uuid(4710);

  it('GETs the impact with change=undo_branch and the branch id, and returns the count', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, { members: 6 }));
    expect(await readImpactAction({ change: 'undo_branch', branchId: BRANCH })).toEqual({
      ok: true,
      members: 6,
    });
    const [path] = mocks.apiFetch.mock.calls[0] as [string];
    const url = new URL(path, 'http://x');
    expect(url.pathname).toBe('/v1/profile_form/impact');
    expect(url.searchParams.get('change')).toBe('undo_branch');
    expect(url.searchParams.get('branchId')).toBe(BRANCH);
  });

  it('never leaves the server tier with a branch id that is not a uuid', async () => {
    expect(await readImpactAction({ change: 'undo_branch', branchId: 'nope' })).toEqual({
      ok: false,
      code: 'failed',
    });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('answers a refusal as a failed read, so the caller writes nothing', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(404, 'NOT_FOUND'));
    expect(await readImpactAction({ change: 'undo_branch', branchId: BRANCH })).toEqual({
      ok: false,
      code: 'failed',
    });
    mocks.apiFetch.mockResolvedValue(json(200, { members: 'many' }));
    expect(await readImpactAction({ change: 'undo_branch', branchId: BRANCH })).toEqual({
      ok: false,
      code: 'failed',
    });
  });
});

describe('undoBranchAction (12.2-17)', () => {
  const BRANCH = uuid(4711);

  it('POSTs /v1/profile_form/branches/{id}/undo and reads { undone: true } as ok', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, { undone: true }));
    expect(await undoBranchAction(BRANCH)).toEqual({ ok: true });
    const [path, init] = mocks.apiFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/v1/profile_form/branches/${BRANCH}/undo`);
    expect(init.method).toBe('POST');
  });

  it('never leaves the server tier with a forged id', async () => {
    expect(await undoBranchAction('not-a-uuid')).toEqual({ ok: false, code: 'failed' });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('answers a body that breaks the contract and a thrown request as failed', async () => {
    mocks.apiFetch.mockResolvedValue(json(200, { undone: false }));
    expect(await undoBranchAction(BRANCH)).toEqual({ ok: false, code: 'failed' });
    mocks.apiFetch.mockRejectedValue(new Error('network'));
    expect(await undoBranchAction(BRANCH)).toEqual({ ok: false, code: 'failed' });
  });

  it('answers the bare 404 as gone, and the shared codes as themselves', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(404, 'NOT_FOUND'));
    expect(await undoBranchAction(BRANCH)).toEqual({ ok: false, code: 'gone' });
    mocks.apiFetch.mockResolvedValue(refusal(403, 'FORBIDDEN'));
    expect(await undoBranchAction(BRANCH)).toEqual({ ok: false, code: 'forbidden' });
    mocks.apiFetch.mockResolvedValue(refusal(404, 'MODULE_DISABLED'));
    expect(await undoBranchAction(BRANCH)).toEqual({ ok: false, code: 'moduleOff' });
    mocks.apiFetch.mockResolvedValue(refusal(500, 'INTERNAL'));
    expect(await undoBranchAction(BRANCH)).toEqual({ ok: false, code: 'failed' });
  });

  it('sends a lost session to the (app) navigation, outside the try', async () => {
    mocks.apiFetch.mockResolvedValue(refusal(401, 'UNAUTHENTICATED'));
    await expect(undoBranchAction(BRANCH)).rejects.toThrow();
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
  });
});
