import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectBootstrapSteps } from '../db/central';
import { ProjectProviderError } from '../server/projects/types';

/**
 * The content of the `project.bootstrap.step_failed` line (quick 261023-qev, D-539), at unit level: no
 * database, no network. The real `runBootstrap` loop runs with its collaborators replaced (recording logger,
 * in-memory platform transaction, mocked registry, steps, job and host cache). The engine's integration suite
 * lives in apps/api/tests/integration/project-bootstrap.test.ts and is not run here.
 *
 * What is proved: the line names the error's class and, for a provider error, its kind, status and code, and
 * never carries a message, a value, a host, a token or a secret.
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';

const h = vi.hoisted(() => {
  const logged: { level: string; fields: Record<string, unknown>; message: string }[] = [];
  const record = (level: string) => (fields: Record<string, unknown>, message: string) => {
    logged.push({ level, fields, message });
  };
  return {
    logged,
    logger: { info: record('info'), warn: record('warn'), error: record('error') },
    tx: { current: undefined as unknown },
    stepRows: { current: [] as unknown[] },
    sets: [] as Record<string, unknown>[],
    runners: {
      verify: vi.fn(),
      roles: vi.fn(),
      schema: vi.fn(),
      auth: vi.fn(),
      buckets: vi.fn(),
      realtime: vi.fn(),
      tenant: vi.fn(),
      invite: vi.fn(),
    },
  };
});

vi.mock('../server/logging', () => ({ moduleLogger: () => h.logger }));
vi.mock('../db/platform-tx', () => ({
  withPlatformTx: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(h.tx.current)),
}));
vi.mock('../server/tenancy/project-registry', () => ({
  resolveProjectById: vi.fn(async () => ({
    id: '11111111-1111-4111-8111-111111111111',
    ref: 'abcdefghijklmnopqrst',
    isCentral: false,
    credentialSource: 'sealed',
    state: 'preparing',
  })),
  invalidateProject: vi.fn(),
}));
vi.mock('../server/tenancy/tenant-host', () => ({ invalidateTenantHost: vi.fn() }));
vi.mock('../server/projects/bootstrap-job', () => ({ enqueueBootstrap: vi.fn() }));
// Deliberate stand-in: the real steps module drags in the mail, Supabase admin and migrations import chain,
// which no unit test loads. The class mirrors the real BootstrapStepError's name and shape.
vi.mock('../server/projects/steps', () => {
  class BootstrapStepError extends Error {
    readonly reason: string;
    constructor(reason: string) {
      super(`bootstrap step failed: ${reason}`);
      this.name = 'BootstrapStepError';
      this.reason = reason;
    }
  }
  return { BootstrapStepError, STEP_RUNNERS: h.runners, defaultStepDeps: () => ({}) };
});

const { runBootstrap } = await import('../server/projects/bootstrap');
const { BootstrapStepError } = await import('../server/projects/steps');

/** A chainable, thenable query link: every builder method returns itself and awaiting it yields `result`. */
function link(result: () => unknown) {
  const self: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy', 'limit', 'values', 'onConflictDoNothing']) {
    self[method] = () => self;
  }
  // biome-ignore lint/suspicious/noThenProperty: the fake query link is deliberately awaitable, like a drizzle query
  self.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject);
  return self;
}

function fakeTx() {
  return {
    select: () => {
      let table: unknown;
      const self = link(() => (table === projectBootstrapSteps ? h.stepRows.current : []));
      self.from = (given: unknown) => {
        table = given;
        return self;
      };
      return self;
    },
    insert: () => link(() => undefined),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        h.sets.push(values);
        return link(() => undefined);
      },
    }),
    execute: async () => [{ attempt: 1 }],
  };
}

const row = (step: string, status: string, attempt: number) => ({
  projectId: PROJECT_ID,
  step,
  status,
  attempt,
  reasonCode: null,
  startedAt: null,
  finishedAt: null,
});

beforeEach(() => {
  h.logged.length = 0;
  h.sets.length = 0;
  h.tx.current = fakeTx();
  for (const runner of Object.values(h.runners)) {
    runner.mockReset();
    runner.mockResolvedValue(undefined);
  }
  h.stepRows.current = [
    row('verify', 'done', 1),
    row('roles', 'done', 1),
    row('schema', 'done', 1),
    row('auth', 'pending', 0),
    row('buckets', 'pending', 0),
    row('realtime', 'pending', 0),
    row('tenant', 'pending', 0),
    row('invite', 'pending', 0),
  ];
});

async function failAtAuth(thrown: unknown) {
  h.runners.auth.mockRejectedValueOnce(thrown);
  return runBootstrap(PROJECT_ID, {
    provider: {} as never,
    tenantsToSeed: async () => [TENANT_ID],
  });
}

function failureLine() {
  const [line, ...rest] = h.logged.filter(
    (entry) => entry.fields.event === 'project.bootstrap.step_failed',
  );
  if (!line || rest.length > 0) {
    throw new Error(`expected exactly one step_failed line, got ${rest.length + (line ? 1 : 0)}`);
  }
  return line;
}

const SECRETS = [
  're_live_AbCdEf0123456789xyz',
  'p4ssw0rd-Sup3rS3cret',
  'sb_secret_0123456789abcdef',
  'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2lnbmF0dXJl',
  'db.abcdefghijklmnopqrst.supabase.co',
];
const SECRET_MESSAGE = `smtp failed with ${SECRETS.join(' ')} at postgres://api_user:p4ssw0rd-Sup3rS3cret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres`;

describe('project.bootstrap.step_failed line', () => {
  it('logs kind and status of a ProjectProviderError invalid/400, with no code key', async () => {
    const outcome = await failAtAuth(new ProjectProviderError('invalid', 400));
    expect(outcome).toEqual({ status: 'failed', step: 'auth', reason: 'auth_config_failed' });
    const { fields, message } = failureLine();
    expect(message).toBe('bootstrap step failed');
    expect(fields).toMatchObject({
      event: 'project.bootstrap.step_failed',
      projectId: PROJECT_ID,
      step: 'auth',
      attempt: 1,
      reason: 'auth_config_failed',
      errorName: 'ProjectProviderError',
      kind: 'invalid',
      status: 400,
    });
    expect(fields).not.toHaveProperty('code');
  });

  it('logs the org_mismatch code of a forbidden provider error', async () => {
    const outcome = await failAtAuth(new ProjectProviderError('forbidden', 403, 'org_mismatch'));
    expect(outcome).toEqual({ status: 'failed', step: 'auth', reason: 'access_denied' });
    expect(failureLine().fields).toMatchObject({
      errorName: 'ProjectProviderError',
      kind: 'forbidden',
      status: 403,
      code: 'org_mismatch',
    });
  });

  it('logs the class of a plain TypeError and no kind, status or code', async () => {
    const outcome = await failAtAuth(new TypeError('boom'));
    expect(outcome).toEqual({ status: 'failed', step: 'auth', reason: 'auth_config_failed' });
    const { fields } = failureLine();
    expect(fields).toMatchObject({ errorName: 'TypeError', reason: 'auth_config_failed' });
    expect(fields).not.toHaveProperty('kind');
    expect(fields).not.toHaveProperty('status');
    expect(fields).not.toHaveProperty('code');
  });

  it('tells the missing-smtp-password cause (BootstrapStepError) from the other three', async () => {
    const outcome = await failAtAuth(new BootstrapStepError('auth_config_failed'));
    expect(outcome).toEqual({ status: 'failed', step: 'auth', reason: 'auth_config_failed' });
    const { fields } = failureLine();
    expect(fields).toMatchObject({ errorName: 'BootstrapStepError' });
    expect(fields).not.toHaveProperty('kind');
  });

  it.each([
    ['a string', 'plain text', 'string'],
    ['an object carrying a message', { message: 'x' }, 'object'],
    ['undefined', undefined, 'undefined'],
    ['null', null, 'object'],
    ['a number', 42, 'number'],
  ])('logs typeof for a thrown %s', async (_label, thrown, expected) => {
    const outcome = await failAtAuth(thrown);
    expect(outcome).toEqual({ status: 'failed', step: 'auth', reason: 'auth_config_failed' });
    const { fields } = failureLine();
    expect(fields).toMatchObject({ errorName: expected });
    expect(fields).not.toHaveProperty('kind');
    expect(fields).not.toHaveProperty('status');
    expect(fields).not.toHaveProperty('code');
  });

  it('logs the constructor name, never an overwritten own name property', async () => {
    class Tampered extends Error {}
    const tampered = new Tampered('x');
    tampered.name = SECRETS[0] as string;
    await failAtAuth(tampered);
    expect(failureLine().fields.errorName).toBe('Tampered');

    h.logged.length = 0;
    const anonymous = new (class extends Error {})('x');
    Object.defineProperty(anonymous.constructor, 'name', { value: '' });
    anonymous.name = SECRETS[1] as string;
    await failAtAuth(anonymous);
    expect(failureLine().fields.errorName).toBe('Error');
  });

  it('never carries a message, a secret-shaped value or a key outside the allow-list', async () => {
    const allowed = new Set([
      'attempt',
      'code',
      'errorName',
      'event',
      'kind',
      'projectId',
      'reason',
      'status',
      'step',
    ]);
    const provider = new ProjectProviderError('invalid', 400);
    provider.message = SECRET_MESSAGE;
    const thrownValues: unknown[] = [
      new TypeError(SECRET_MESSAGE),
      provider,
      SECRET_MESSAGE,
      { message: SECRET_MESSAGE, token: SECRETS[2] },
    ];

    for (const thrown of thrownValues) {
      h.logged.length = 0;
      await failAtAuth(thrown);
      const entry = failureLine();
      for (const [key, value] of Object.entries(entry.fields)) {
        expect(allowed.has(key)).toBe(true);
        expect(['string', 'number']).toContain(typeof value);
      }
      const json = JSON.stringify(h.logged);
      expect(json).not.toContain(SECRET_MESSAGE);
      for (const secret of SECRETS) expect(json).not.toContain(secret);
    }
  });

  it('reads the message of the error zero times', async () => {
    let reads = 0;
    const error = new TypeError('x');
    Object.defineProperty(error, 'message', {
      get() {
        reads += 1;
        return SECRET_MESSAGE;
      },
    });
    await failAtAuth(error);
    expect(reads).toBe(0);
  });

  it('still stores the reason code only and still writes the started info line', async () => {
    await failAtAuth(new TypeError(SECRET_MESSAGE));
    expect(h.sets).toHaveLength(1);
    expect(h.sets[0]).toMatchObject({ status: 'failed', reasonCode: 'auth_config_failed' });
    expect(h.logged.filter((entry) => entry.level === 'info')).toEqual([
      {
        level: 'info',
        fields: {
          event: 'project.bootstrap.step_started',
          projectId: PROJECT_ID,
          step: 'auth',
          attempt: 1,
        },
        message: 'bootstrap step started',
      },
    ]);
    expect(h.logged.filter((entry) => entry.level === 'warn')).toHaveLength(1);
  });
});
