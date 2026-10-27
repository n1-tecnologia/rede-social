import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Dados step's server gate (09.2-18, DBT-50, UI-D-533): the shape rule of the project ref, then the
 * platform's read-only pre-check. Real: the schemas, the shared `normalizeProjectRef` and the mapping
 * of the API's answers. Stubbed: the one HTTP seam (`apiFetch`) and the redirect, so the claims are
 * about what leaves this action:
 *
 *  - P97 the ref is exactly 20 lower-case letters: 19 and 21 fail the format rule without a request;
 *  - P98 an empty or whitespace-only ref is "Informe o código do projeto." and the pre-check is never
 *    called for it;
 *  - P99 whatever the form sent is normalised again; upper case, whitespace, an address with a path,
 *    a query string or a trailing slash become the bare ref, and a look-alike or non-ASCII character
 *    is refused, never forwarded unchanged;
 *  - every answer of the pre-check maps to its documented field error, a check that could not run
 *    (transport, 5xx, an unreadable answer) is `unchecked`, and a refusal never reaches the screen
 *    as provider text;
 *  - the manual access never goes to the Dados check; the creation sends it once and the API's
 *    refusals come back as field errors.
 */

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), redirect: vi.fn() }));

vi.mock('@/lib/api', () => ({ apiFetch: api.apiFetch }));
// The creation answer's full shape is the contracts' own test; here it is the id that matters.
vi.mock('@rede-social/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/contracts')>()),
  platformTenantDetailSchema: { parse: (value: unknown) => value },
}));
vi.mock('@/lib/env', () => ({ env: { API_URL: 'http://api.test' } }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    api.redirect(path);
    throw new Error(`NEXT_REDIRECT ${path}`);
  },
}));

const { createTenantFromDraftAction, readBootstrapProgressAction, validateTenantDraftAction } =
  await import('./actions');

const REF = 'abcdefghijklmnopqrst';

const input = (projectRef: string | undefined) => ({
  displayName: 'Ana Souza Mentoria',
  slug: 'ana-souza',
  primary: '#2e6fd0',
  secondary: '#5b9cf8',
  adminEmail: 'ana@anasouza.com.br',
  modules: ['feed'],
  ...(projectRef === undefined ? {} : { projectRef }),
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const precheckCalls = () =>
  api.apiFetch.mock.calls.filter(([path]) => path === '/v1/platform/projects/precheck');

beforeEach(() => {
  api.apiFetch.mockReset();
  api.redirect.mockReset();
  api.apiFetch.mockImplementation(async () => json(200, { ok: true, manualAccess: false }));
});

describe('validateTenantDraftAction — the project ref', () => {
  it('P97: exactly 20 lower-case letters pass the shape rule and reach the pre-check', async () => {
    const result = await validateTenantDraftAction(input(REF));
    expect(result).toEqual({ ok: true, manualAccess: false });
    expect(precheckCalls()).toHaveLength(1);
    expect(JSON.parse(precheckCalls()[0]?.[1].body)).toEqual({ projectRef: REF });
  });

  it.each([
    ['19 letters', REF.slice(0, 19)],
    ['21 letters', `${REF}u`],
    ['20 characters with a digit', `${REF.slice(0, 19)}1`],
    ['20 characters with a hyphen', `${REF.slice(0, 19)}-`],
  ])('P97: %s fail the format rule and never reach the pre-check', async (_name, ref) => {
    const result = await validateTenantDraftAction(input(ref));
    expect(result).toEqual({ ok: false, fieldErrors: { projectRef: 'projectRefInvalid' } });
    expect(api.apiFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', ''],
    ['spaces', '   '],
    ['a tab and a newline', '\t\n '],
    ['absent', undefined],
  ])('P98: %s is "required" and the pre-check is never called', async (_name, ref) => {
    const result = await validateTenantDraftAction(input(ref));
    expect(result).toEqual({ ok: false, fieldErrors: { projectRef: 'projectRefRequired' } });
    expect(api.apiFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['upper case', REF.toUpperCase()],
    ['surrounding whitespace', `  ${REF}\n`],
    [
      'a dashboard address with a path',
      `https://supabase.com/dashboard/project/${REF}/settings/api`,
    ],
    [
      'a dashboard address with a query string',
      `https://supabase.com/dashboard/project/${REF}?x=1`,
    ],
    [
      'an upper-case dashboard address with a trailing slash',
      `HTTPS://SUPABASE.COM/dashboard/project/${REF.toUpperCase()}/`,
    ],
    ['an API address', `https://${REF}.supabase.co`],
    ['an API address with a trailing slash', `https://${REF}.supabase.co/`],
  ])('P99: %s reaches the API as the bare ref', async (_name, ref) => {
    const result = await validateTenantDraftAction(input(ref));
    expect(result.ok).toBe(true);
    expect(JSON.parse(precheckCalls()[0]?.[1].body)).toEqual({ projectRef: REF });
  });

  it.each([
    ['a Cyrillic look-alike', `а${REF.slice(1)}`],
    ['a fullwidth letter', `ａ${REF.slice(1)}`],
    ['an accented letter', `á${REF.slice(1)}`],
    ['an address of another host', `https://evil.example/dashboard/project/${REF}`],
    ['an address with the ref inside the path of another site', `https://example.com/${REF}`],
    ['a value of 200 letters', 'a'.repeat(200)],
    ['a value of 5000 letters', 'a'.repeat(5000)],
  ])('P99: %s is refused by the shape rule, never forwarded', async (_name, ref) => {
    const result = await validateTenantDraftAction(input(ref));
    expect(result).toMatchObject({ ok: false, fieldErrors: { projectRef: 'projectRefInvalid' } });
    expect(api.apiFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid', 'projectRefInvalid'],
    ['not_found', 'projectNotFound'],
    ['not_empty', 'projectNotEmpty'],
    ['in_use', 'projectInUse'],
    ['paused', 'projectPaused'],
  ])('the pre-check answer "%s" is the field error %s', async (reason, key) => {
    api.apiFetch.mockResolvedValue(json(200, { ok: false, reason }));
    const result = await validateTenantDraftAction(input(REF));
    expect(result).toEqual({ ok: false, fieldErrors: { projectRef: key } });
  });

  it('a pre-check that could not run (the "unchecked" answer) is the top alert, not a field error', async () => {
    api.apiFetch.mockResolvedValue(json(200, { ok: false, reason: 'unchecked' }));
    expect(await validateTenantDraftAction(input(REF))).toEqual({
      ok: false,
      fieldErrors: {},
      unchecked: true,
    });
  });

  it.each([
    ['a 5xx', () => json(500, { error: { code: 'INTERNAL' } })],
    ['an answer that does not parse', () => json(200, { ok: 'maybe' })],
    ['a body that is not JSON', () => new Response('<html>', { status: 200 })],
  ])('%s is "unchecked"', async (_name, make) => {
    api.apiFetch.mockResolvedValue(make());
    expect(await validateTenantDraftAction(input(REF))).toMatchObject({
      ok: false,
      unchecked: true,
    });
  });

  it('a transport failure is "unchecked"', async () => {
    api.apiFetch.mockRejectedValue(new Error('ECONNRESET'));
    expect(await validateTenantDraftAction(input(REF))).toMatchObject({
      ok: false,
      unchecked: true,
    });
  });

  it('manualAccess rides on a passing check and on a failing one (the form reveals the block)', async () => {
    api.apiFetch.mockImplementation(async () => json(200, { ok: true, manualAccess: true }));
    expect(await validateTenantDraftAction(input(REF))).toEqual({ ok: true, manualAccess: true });
    expect(await validateTenantDraftAction({ ...input(REF), displayName: '' })).toMatchObject({
      ok: false,
      manualAccess: true,
      fieldErrors: { displayName: 'displayNameRequired' },
    });
  });

  it('other fields keep their errors next to the ref check', async () => {
    const result = await validateTenantDraftAction({ ...input(''), slug: 'Inválido!' });
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { slug: 'slugInvalid', projectRef: 'projectRefRequired' },
    });
  });

  it('a 401 navigates like every platform read', async () => {
    api.apiFetch.mockResolvedValue(json(401, { error: { code: 'UNAUTHENTICATED' } }));
    await expect(validateTenantDraftAction(input(REF))).rejects.toThrow('NEXT_REDIRECT /entrar');
    expect(api.redirect).toHaveBeenCalledWith('/entrar');
  });

  it('a 403 with another code is a check that could not run, not a navigation', async () => {
    api.apiFetch.mockResolvedValue(json(403, { error: { code: 'SOMETHING_ELSE' } }));
    expect(await validateTenantDraftAction(input(REF))).toMatchObject({ unchecked: true });
    expect(api.redirect).not.toHaveBeenCalled();
  });

  it('the Dados check never carries a credential, whatever the caller passes', async () => {
    await validateTenantDraftAction({
      ...input(REF),
      access: {
        databasePassword: 'pw-secret',
        serviceKey: 'sk-secret',
        publishableKey: 'pk-secret',
      },
    });
    for (const [, init] of api.apiFetch.mock.calls) {
      expect(String(init.body)).not.toMatch(/secret/);
    }
  });
});

describe('createTenantFromDraftAction — the project and its manual access', () => {
  const created = {
    tenant: { id: '0d9f1f0e-8c1a-4a53-9e8f-5f6d4c3b2a10', slug: 'ana-souza' },
    domains: [],
    invites: [],
    admins: [],
  };

  it('sends the normalised ref and, only when given, the access block', async () => {
    api.apiFetch.mockResolvedValue(
      json(400, { error: { code: 'VALIDATION_FAILED', details: {} } }),
    );
    await createTenantFromDraftAction({
      ...input(`https://${REF}.supabase.co`),
      access: { databasePassword: 'pw', serviceKey: '', publishableKey: 'pk' },
    });
    const [path, init] = api.apiFetch.mock.calls[0] ?? [];
    expect(path).toBe('/v1/platform/tenants');
    const body = JSON.parse(init.body);
    expect(body.projectRef).toBe(REF);
    expect(body.access).toEqual({ databasePassword: 'pw', publishableKey: 'pk' });
  });

  it('refuses a ref that fails the shape rule without a request', async () => {
    const result = await createTenantFromDraftAction(input(REF.slice(1)));
    expect(result).toEqual({ ok: false, fieldErrors: { projectRef: 'projectRefInvalid' } });
    expect(api.apiFetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ projectRef: 'not_found' }, { projectRef: 'projectNotFound' }],
    [{ projectRef: 'in_use' }, { projectRef: 'projectInUse' }],
    [{ projectRef: 'paused' }, { projectRef: 'projectPaused' }],
    [{ projectRef: 'not_empty' }, { projectRef: 'projectNotEmpty' }],
    [{ databasePassword: 'required' }, { databasePassword: 'passwordRequired' }],
    [{ serviceKey: 'required' }, { serviceKey: 'serviceKeyRequired' }],
    [{ publishableKey: 'required' }, { publishableKey: 'publishableKeyRequired' }],
    [{ access: 'invalid' }, { access: 'accessInvalid' }],
  ])('the API refusal %j is the field error %j', async (details, fieldErrors) => {
    api.apiFetch.mockResolvedValue(json(400, { error: { code: 'VALIDATION_FAILED', details } }));
    expect(await createTenantFromDraftAction(input(REF))).toEqual({ ok: false, fieldErrors });
  });

  it('a project check that could not run is a generic failure, not a field error', async () => {
    api.apiFetch.mockResolvedValue(
      json(400, { error: { code: 'VALIDATION_FAILED', details: { projectRef: 'unchecked' } } }),
    );
    expect(await createTenantFromDraftAction(input(REF))).toEqual({ ok: false, error: 'generic' });
  });

  it('a created tenant answers its id and nothing of the access comes back', async () => {
    api.apiFetch.mockResolvedValue(json(201, created));
    const result = await createTenantFromDraftAction({
      ...input(REF),
      access: { databasePassword: 'pw-secret' },
    });
    expect(result).toEqual({ ok: true, id: created.tenant.id });
    expect(JSON.stringify(result)).not.toMatch(/secret/);
  });
});

describe('readBootstrapProgressAction', () => {
  const ID = '0d9f1f0e-8c1a-4a53-9e8f-5f6d4c3b2a10';
  const overview = (steps: object[]) => ({
    ref: REF,
    plan: null,
    state: 'preparing',
    steps,
    schema: { applied: null, required: null },
    lastCheckedAt: null,
    preparationFinishedAt: null,
    credentials: { held: true, updatedAt: null },
    otherTenants: 0,
    moving: false,
    lastErrorCode: null,
  });
  const row = (step: string, status: string, reasonCode: string | null = null) => ({
    step,
    status,
    attempt: 1,
    reasonCode,
    startedAt: null,
    finishedAt: null,
  });

  it('reduces the overview to the state and the steps (no ref, no credential field)', async () => {
    api.apiFetch.mockResolvedValue(
      json(200, overview([row('verify', 'done'), row('roles', 'running')])),
    );
    const result = await readBootstrapProgressAction(ID);
    expect(result).toEqual({
      state: 'preparing',
      steps: [
        { step: 'verify', status: 'done', reasonCode: null },
        { step: 'roles', status: 'running', reasonCode: null },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(REF);
  });

  it.each([
    ['a refusal', () => json(403, { error: { code: 'FORBIDDEN' } })],
    ['a 5xx', () => json(503, {})],
    ['an answer that does not parse', () => json(200, { state: 'ready' })],
  ])('%s answers null and never navigates', async (_name, make) => {
    api.apiFetch.mockResolvedValue(make());
    expect(await readBootstrapProgressAction(ID)).toBeNull();
    expect(api.redirect).not.toHaveBeenCalled();
  });

  it('a transport failure answers null', async () => {
    api.apiFetch.mockRejectedValue(new Error('ECONNRESET'));
    expect(await readBootstrapProgressAction(ID)).toBeNull();
  });

  it('an id that is not a UUID is never put in a path', async () => {
    expect(await readBootstrapProgressAction('../../etc')).toBeNull();
    expect(api.apiFetch).not.toHaveBeenCalled();
  });
});

/**
 * 09.4-15 Task 1 (D-570, UI-D-550, CTK-31, CTK-32, T-09.4-53): the customer project in the Dados check.
 * The token is carried ONCE, to the pre-check, and the reasons land on the field that owns them.
 */
describe('validateTenantDraftAction — the customer project', () => {
  const TOKEN = 'sbp_s3cr3t-token-0001';
  const customer = (extra: Record<string, unknown> = {}) => ({
    ...input(REF),
    owner: 'customer' as const,
    token: TOKEN,
    tokenExpiresAt: '2027-03-01',
    ...extra,
  });

  it('posts { projectRef, owner, token, tokenExpiresAt } once to the pre-check', async () => {
    const result = await validateTenantDraftAction(customer());
    expect(result).toEqual({ ok: true, manualAccess: false });
    expect(precheckCalls()).toHaveLength(1);
    expect(JSON.parse(precheckCalls()[0]?.[1].body)).toEqual({
      projectRef: REF,
      owner: 'customer',
      token: TOKEN,
      tokenExpiresAt: '2027-03-01',
    });
  });

  it('posts the token trimmed: a pasted leading space or newline is not part of it (WR-03)', async () => {
    await validateTenantDraftAction(customer({ token: `\n  ${TOKEN} \t` }));
    expect(JSON.parse(precheckCalls()[0]?.[1].body)).toMatchObject({ token: TOKEN });
  });

  it('leaves the date out when it is empty', async () => {
    await validateTenantDraftAction(customer({ tokenExpiresAt: '' }));
    expect(JSON.parse(precheckCalls()[0]?.[1].body)).toEqual({
      projectRef: REF,
      owner: 'customer',
      token: TOKEN,
    });
  });

  it('a platform input posts exactly { projectRef }, whatever stale token it carries', async () => {
    await validateTenantDraftAction({
      ...input(REF),
      owner: 'platform',
      token: TOKEN,
      tokenExpiresAt: '2027-03-01',
    });
    expect(JSON.parse(precheckCalls()[0]?.[1].body)).toEqual({ projectRef: REF });
  });

  it.each([[undefined], [''], ['   ']])(
    'an empty customer token (%j) is "required" and no request is made',
    async (token) => {
      const result = await validateTenantDraftAction(customer({ token }));
      expect(result).toEqual({ ok: false, fieldErrors: { token: 'tokenRequired' } });
      expect(api.apiFetch).not.toHaveBeenCalled();
    },
  );

  it('an empty token and a malformed ref report both and make no request', async () => {
    const result = await validateTenantDraftAction(customer({ token: '', projectRef: 'abc' }));
    expect(result).toEqual({
      ok: false,
      fieldErrors: { token: 'tokenRequired', projectRef: 'projectRefInvalid' },
    });
    expect(api.apiFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['token_invalid', 'token', 'tokenInvalid'],
    ['token_forbidden', 'token', 'tokenForbidden'],
    ['token_other_project', 'token', 'tokenOtherProject'],
    ['token_account_wide', 'token', 'tokenAccountWide'],
    ['token_expiry_invalid', 'tokenExpiresAt', 'tokenExpiryInvalid'],
    ['not_found', 'projectRef', 'projectNotFoundCustomer'],
    ['not_pro', 'projectRef', 'projectNotPro'],
    ['not_empty', 'projectRef', 'projectNotEmpty'],
    ['in_use', 'projectRef', 'projectInUse'],
    ['paused', 'projectRef', 'projectPaused'],
  ])('the pre-check answer "%s" is %s: %s', async (reason, field, key) => {
    api.apiFetch.mockResolvedValue(json(200, { ok: false, reason }));
    const result = await validateTenantDraftAction(customer());
    expect(result).toEqual({ ok: false, fieldErrors: { [field]: key } });
  });

  it('the platform not-found keeps its own sentence key', async () => {
    api.apiFetch.mockResolvedValue(json(200, { ok: false, reason: 'not_found' }));
    const result = await validateTenantDraftAction(input(REF));
    expect(result).toEqual({ ok: false, fieldErrors: { projectRef: 'projectNotFound' } });
  });

  it('a transport error, a 5xx and an "unchecked" answer are all unchecked', async () => {
    api.apiFetch.mockRejectedValue(new Error('ECONNRESET'));
    expect(await validateTenantDraftAction(customer())).toMatchObject({
      ok: false,
      unchecked: true,
    });
    api.apiFetch.mockResolvedValue(json(503, {}));
    expect(await validateTenantDraftAction(customer())).toMatchObject({ unchecked: true });
    api.apiFetch.mockResolvedValue(json(200, { ok: false, reason: 'unchecked' }));
    expect(await validateTenantDraftAction(customer())).toMatchObject({ unchecked: true });
  });

  it('never logs the token', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    api.apiFetch.mockResolvedValue(json(503, {}));
    await validateTenantDraftAction(customer());
    api.apiFetch.mockRejectedValue(new Error('ECONNRESET'));
    await validateTenantDraftAction(customer());
    expect(JSON.stringify(spy.mock.calls)).not.toContain('s3cr3t');
    spy.mockRestore();
  });
});

/**
 * 09.4-15 Task 2 (UI-D-556, CTK-32, T-09.4-53): the customer project in the creation. The token goes
 * once, in the creation body of a customer draft only; the answer and the logs never hold it; the
 * API's closed codes land on their own field.
 */
describe('createTenantFromDraftAction — the customer project', () => {
  const TOKEN = 'sbp_s3cr3t-token-0001';
  const customer = (extra: Record<string, unknown> = {}) => ({
    ...input(REF),
    owner: 'customer' as const,
    token: TOKEN,
    tokenExpiresAt: '2027-03-01',
    ...extra,
  });
  const created = {
    tenant: { id: '0d9f1f0e-8c1a-4a53-9e8f-5f6d4c3b2a10', slug: 'ana-souza' },
    domains: [],
    invites: [],
    admins: [],
  };
  const bodyOf = () => JSON.parse(api.apiFetch.mock.calls[0]?.[1].body);

  it('sends owner, token and date once in the creation body, and answers the id without the token', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    api.apiFetch.mockResolvedValue(json(200, created));
    const result = await createTenantFromDraftAction(customer());
    expect(result).toEqual({ ok: true, id: created.tenant.id });
    expect(api.apiFetch).toHaveBeenCalledTimes(1);
    expect(bodyOf()).toMatchObject({
      owner: 'customer',
      token: TOKEN,
      tokenExpiresAt: '2027-03-01',
    });
    expect(JSON.stringify(result)).not.toContain('s3cr3t');
    expect(JSON.stringify(spy.mock.calls)).not.toContain('s3cr3t');
    spy.mockRestore();
  });

  it('a platform body carries none of the three, whatever stale token the input holds', async () => {
    api.apiFetch.mockResolvedValue(json(200, created));
    await createTenantFromDraftAction({ ...input(REF), owner: 'platform', token: TOKEN });
    const body = bodyOf();
    expect(body).not.toHaveProperty('owner');
    expect(body).not.toHaveProperty('token');
    expect(body).not.toHaveProperty('tokenExpiresAt');
  });

  it('an empty customer token is refused as "required" without a request', async () => {
    const result = await createTenantFromDraftAction(customer({ token: '  ' }));
    expect(result).toEqual({ ok: false, fieldErrors: { token: 'tokenRequired' } });
    expect(api.apiFetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ token: 'token_invalid' }, { token: 'tokenInvalid' }],
    [{ token: 'token_forbidden' }, { token: 'tokenForbidden' }],
    [{ token: 'token_account_wide' }, { token: 'tokenAccountWide' }],
    [{ token: 'not_found' }, { projectRef: 'projectNotFoundCustomer' }],
    [{ tokenExpiresAt: 'token_expiry_invalid' }, { tokenExpiresAt: 'tokenExpiryInvalid' }],
    [{ projectRef: 'not_found' }, { projectRef: 'projectNotFoundCustomer' }],
    [{ projectRef: 'in_use' }, { projectRef: 'projectInUse' }],
  ])('the API refusal %j is the field error %j', async (details, fieldErrors) => {
    api.apiFetch.mockResolvedValue(json(400, { error: { code: 'VALIDATION_FAILED', details } }));
    expect(await createTenantFromDraftAction(customer())).toEqual({ ok: false, fieldErrors });
  });

  it.each([['org_mismatch'], ['unchecked']])(
    'the API code token:%s has no field to blame: a generic failure the operator can retry',
    async (code) => {
      api.apiFetch.mockResolvedValue(
        json(400, { error: { code: 'VALIDATION_FAILED', details: { token: code } } }),
      );
      expect(await createTenantFromDraftAction(customer())).toEqual({
        ok: false,
        error: 'generic',
      });
    },
  );

  it('a platform draft keeps the platform wording for a missing project', async () => {
    api.apiFetch.mockResolvedValue(
      json(400, { error: { code: 'VALIDATION_FAILED', details: { projectRef: 'not_found' } } }),
    );
    expect(await createTenantFromDraftAction(input(REF))).toEqual({
      ok: false,
      fieldErrors: { projectRef: 'projectNotFound' },
    });
  });

  it('never logs the token on a failed creation', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    api.apiFetch.mockResolvedValue(json(500, { error: { code: 'INTERNAL' } }));
    await createTenantFromDraftAction(customer());
    api.apiFetch.mockRejectedValue(new Error('ECONNRESET'));
    await createTenantFromDraftAction(customer());
    expect(JSON.stringify(spy.mock.calls)).not.toContain('s3cr3t');
    spy.mockRestore();
  });
});
