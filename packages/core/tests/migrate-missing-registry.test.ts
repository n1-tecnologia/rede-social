import { DrizzleQueryError } from 'drizzle-orm';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplyOptions, ApplyResult } from '../server/migrations/runner';
import type { MigrationFile } from '../server/migrations/sets';
import type { MigrateDeps } from '../server/projects/migrate';
import type { ProjectRecord } from '../server/tenancy/project-registry';

/**
 * `migrateAll` against a central database that has never had the central set (quick 261024-lcq).
 *
 * Evidence: the first production run of the 09.2 release on 2026-10-24 (GitHub Actions run 40043498712 attempt 4,
 * step "Run the migrate job", Cloud Run job execution migrate-5gs9z) died on its first read, the registry
 * (`platform.projects`), with PostgreSQL 42P01. The central set is what creates that schema and only the migrate
 * Job applies it, so on the first release the Job must apply the central set BEFORE it can read any registry.
 * Local stacks and CI always already have the schema, which is why nothing covered this.
 *
 * Rule pinned here: a 42P01 on the registry read of the first pass means "no registry yet" (empty, selectors not
 * judged); the central set is applied; the registry is read again strictly; the tenant fan-out follows.
 *
 * No database is opened: every dependency is injected, the platform lane is replaced by one that rejects, and the
 * three schema-state writers are stubbed.
 */

const h = vi.hoisted(() => ({
  readAppliedSchema: vi.fn(),
  recordSchemaState: vi.fn(),
  invalidateProjectHosts: vi.fn(),
}));

vi.mock('../db/platform-tx', () => ({
  withPlatformTx: vi.fn(async () => {
    throw new Error('a hermetic test must not reach a database');
  }),
}));

vi.mock('../server/projects/schema-state', async (importOriginal) => {
  const original = await importOriginal<typeof import('../server/projects/schema-state')>();
  return {
    ...original,
    readAppliedSchema: h.readAppliedSchema,
    recordSchemaState: h.recordSchemaState,
    invalidateProjectHosts: h.invalidateProjectHosts,
  };
});

const { migrateAll } = await import('../server/projects/migrate');

const VERSION_A = '20260101000000';
const VERSION_B = '20260102000000';

beforeEach(() => {
  h.readAppliedSchema.mockReset();
  h.recordSchemaState.mockReset();
  h.invalidateProjectHosts.mockReset();
  h.readAppliedSchema.mockResolvedValue({ appliedCount: 1, appliedHead: VERSION_A });
  h.recordSchemaState.mockResolvedValue({ changed: false });
  h.invalidateProjectHosts.mockResolvedValue(undefined);
});

/** The driver error: undefined_table, as the registry read raises it before the schema exists. */
const driverError = (code: string): Error =>
  Object.assign(new Error('relation "platform.projects" does not exist'), { code });

/** The query builder wraps the driver error and its message holds the statement; the code sits on the cause. */
const drizzleError = (code = '42P01'): Error =>
  new DrizzleQueryError(
    'select "id" from "platform"."projects" where "platform"."projects"."state" = $1',
    ['ready'],
    driverError(code),
  );

const missingRegistry = (): Error => drizzleError('42P01');

const project = (ref: string, id: string): ProjectRecord => ({
  id,
  ref,
  provider: 'fake',
  isCentral: false,
  isDefault: false,
  credentialSource: 'sealed',
  credentialVersion: 1,
  apiUrl: 'https://example.invalid',
  publishableKey: null,
  state: 'ready',
  secretKeyId: 1,
  databaseUrlTxSealed: null,
  databaseUrlSessionSealed: null,
  ddlUrlSealed: null,
  serviceKeySealed: null,
  serviceKeyKind: null,
  hookRef: null,
  hookSecretSealed: null,
});

const ALPHA = project('alpha-proj', '00000000-0000-4000-8000-00000000000a');
const BETA = project('beta-proj', '00000000-0000-4000-8000-00000000000b');

const fakeSql = (label: string): Sql =>
  ({ label, end: vi.fn(async () => undefined) }) as unknown as Sql;

const labelOf = (sql: Sql): string => (sql as unknown as { label: string }).label;

const file = (set: 'central' | 'tenant'): MigrationFile => ({
  set,
  version: VERSION_A,
  name: 'init',
  text: 'select 1;',
  sha256: 'a'.repeat(64),
});

type HarnessOptions = {
  /** The registry exists from the start. */
  registryPresent?: boolean;
  centralResult?: (options: ApplyOptions) => ApplyResult;
  overrides?: Partial<MigrateDeps>;
};

function harness(options: HarnessOptions = {}) {
  const calls: string[] = [];
  const state = { centralApplied: options.registryPresent === true };

  const apply = vi.fn(async (sql: Sql, _files: MigrationFile[], applyOptions: ApplyOptions) => {
    const label = labelOf(sql);
    if (applyOptions.set === 'central') {
      calls.push('apply:central');
      if (applyOptions.dryRun !== true) state.centralApplied = true;
      if (options.centralResult) return options.centralResult(applyOptions);
      return applyOptions.dryRun === true
        ? { applied: [], skipped: 0, pending: [VERSION_A, VERSION_B] }
        : { applied: [VERSION_A], skipped: 0, pending: [] };
    }
    calls.push(`apply:tenant:${label}`);
    return { applied: [], skipped: 1, pending: [] } satisfies ApplyResult;
  });

  const listProjects = vi.fn(async () => {
    if (!state.centralApplied) {
      calls.push('list:missing');
      throw missingRegistry();
    }
    calls.push('list:ok');
    return [BETA, ALPHA];
  });
  const projectIdOfTenant = vi.fn(async (): Promise<string | null> => {
    if (!state.centralApplied) {
      calls.push('tenantOf:missing');
      throw missingRegistry();
    }
    calls.push('tenantOf:ok');
    return BETA.id;
  });
  const ensureProjectZero = vi.fn(async () => {
    calls.push('ensureProjectZero');
  });
  const connectCentral = vi.fn(() => fakeSql('central'));
  const connect = vi.fn((target: ProjectRecord) => fakeSql(target.ref));
  const loadFiles = vi.fn(async (set: 'central' | 'tenant') => [file(set)]);

  const deps = {
    connectCentral,
    connect,
    loadFiles,
    apply,
    listProjects,
    projectIdOfTenant,
    ensureProjectZero,
    ...options.overrides,
  } as MigrateDeps;

  return {
    calls,
    deps,
    apply,
    listProjects,
    projectIdOfTenant,
    ensureProjectZero,
    connectCentral,
    connect,
  };
}

const kinds = (lines: { kind?: unknown }[]) => lines.map((line) => line.kind);

describe('a central database without the platform registry', () => {
  it('a: applies the central set first, re-reads the registry and fans out in ascending ref', async () => {
    const t = harness();
    const result = await migrateAll({ concurrency: 1, deps: t.deps });

    expect(t.calls).toEqual([
      'list:missing',
      'ensureProjectZero',
      'apply:central',
      'list:ok',
      'apply:tenant:alpha-proj',
      'apply:tenant:beta-proj',
    ]);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(kinds(result.lines)).toEqual(['central', 'project', 'project', 'summary']);
    expect(result.lines[0]).toMatchObject({ kind: 'central', status: 'ok' });
    expect(result.lines[1]).toMatchObject({ ref: 'alpha-proj' });
    expect(result.lines[2]).toMatchObject({ ref: 'beta-proj' });
    expect(result.lines[3]).toMatchObject({ kind: 'summary', central: 'ok', projects: 2 });

    const text = JSON.stringify(result.lines);
    for (const forbidden of [
      'Failed query',
      'does not exist',
      'platform.projects',
      'postgres://',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it.each([
    ['the Drizzle wrapper with the code on its cause', () => drizzleError('42P01')],
    [
      'a wrapper one level above the Drizzle error',
      () => new Error('outer', { cause: drizzleError('42P01') }),
    ],
    [
      'a plain error whose cause carries the code',
      () => new Error('outer', { cause: driverError('42P01') }),
    ],
  ])('a: the cause chain is walked (%s)', async (_name, make) => {
    const t = harness({
      overrides: {
        listProjects: vi.fn(async () => {
          if (!t.calls.includes('apply:central')) {
            t.calls.push('list:missing');
            throw make();
          }
          t.calls.push('list:ok');
          return [BETA, ALPHA];
        }),
      },
    });
    const result = await migrateAll({ concurrency: 1, deps: t.deps });

    expect(t.calls).toEqual([
      'list:missing',
      'ensureProjectZero',
      'apply:central',
      'list:ok',
      'apply:tenant:alpha-proj',
      'apply:tenant:beta-proj',
    ]);
    expect(result.exitCode).toBe(0);
  });

  it('a2: with a tenant slug the lookup is repeated after the central set and one project is migrated', async () => {
    const t = harness();
    const result = await migrateAll({ concurrency: 1, tenantSlug: 'acme', deps: t.deps });

    expect(t.calls).toEqual([
      'tenantOf:missing',
      'ensureProjectZero',
      'apply:central',
      'tenantOf:ok',
      'list:ok',
      'apply:tenant:beta-proj',
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.lines.filter((line) => line.kind === 'project')).toHaveLength(1);
  });
});

describe('an error that is not undefined_table', () => {
  const failures: [string, () => Error][] = [
    ['a plain error', () => new Error('boom')],
    ['undefined_column', () => drizzleError('42703')],
    ['cannot_connect_now', () => drizzleError('57P03')],
  ];

  it.each(failures)('b: the registry list rejects with the same error (%s)', async (_n, make) => {
    const error = make();
    const t = harness({
      overrides: {
        listProjects: vi.fn(async () => {
          throw error;
        }),
      },
    });
    await expect(migrateAll({ deps: t.deps })).rejects.toBe(error);
    expect(t.apply).not.toHaveBeenCalled();
    expect(t.ensureProjectZero).not.toHaveBeenCalled();
    expect(t.connectCentral).not.toHaveBeenCalled();
  });

  it.each(failures)('b: the tenant lookup rejects with the same error (%s)', async (_n, make) => {
    const error = make();
    const t = harness({
      overrides: {
        projectIdOfTenant: vi.fn(async () => {
          throw error;
        }),
      },
    });
    await expect(migrateAll({ tenantSlug: 'acme', deps: t.deps })).rejects.toBe(error);
    expect(t.apply).not.toHaveBeenCalled();
    expect(t.ensureProjectZero).not.toHaveBeenCalled();
    expect(t.connectCentral).not.toHaveBeenCalled();
  });
});

describe('a dry run on a missing registry', () => {
  it('c: reports the central set as pending, writes nothing and exits 0', async () => {
    const t = harness();
    const result = await migrateAll({ dryRun: true, deps: t.deps });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(kinds(result.lines)).toEqual(['central', 'summary']);
    expect(result.lines[0]).toMatchObject({
      dryRun: true,
      status: 'ok',
      applied: 0,
      pending: [VERSION_A, VERSION_B],
    });
    expect(result.lines[1]).toMatchObject({
      dryRun: true,
      central: 'ok',
      projects: 0,
      current: 0,
      failed: 0,
      applied: 0,
    });
    expect(t.apply).toHaveBeenCalledTimes(1);
    expect(t.apply).toHaveBeenCalledWith(expect.anything(), expect.any(Array), {
      set: 'central',
      dryRun: true,
    });
    expect(t.listProjects).toHaveBeenCalledTimes(1);
    expect(t.ensureProjectZero).not.toHaveBeenCalled();
    expect(t.connect).not.toHaveBeenCalled();
    expect(h.recordSchemaState).not.toHaveBeenCalled();
    expect(h.invalidateProjectHosts).not.toHaveBeenCalled();
  });

  it.each([
    ['a tenant slug', { tenantSlug: 'acme' }],
    ['a project ref', { projectRef: 'alpha-proj' }],
  ])('c2: a selector (%s) is deferred, not rejected', async (_name, selector) => {
    const t = harness();
    const result = await migrateAll({ dryRun: true, ...selector, deps: t.deps });

    expect(result.exitCode).toBe(0);
    expect(kinds(result.lines)).toEqual(['central', 'summary']);
    expect(t.connect).not.toHaveBeenCalled();
    expect(t.ensureProjectZero).not.toHaveBeenCalled();
  });
});

describe('the retry path (projectIds)', () => {
  it('d: still rejects on a missing registry and applies nothing', async () => {
    const t = harness();
    await expect(migrateAll({ projectIds: [ALPHA.id], deps: t.deps })).rejects.toMatchObject({
      cause: { code: '42P01' },
    });
    expect(t.apply).not.toHaveBeenCalled();
    expect(t.ensureProjectZero).not.toHaveBeenCalled();
    expect(t.connectCentral).not.toHaveBeenCalled();
  });

  it('d: still rejects when the tenant lookup is the missing read', async () => {
    const t = harness();
    await expect(
      migrateAll({ projectIds: [ALPHA.id], tenantSlug: 'acme', deps: t.deps }),
    ).rejects.toMatchObject({ cause: { code: '42P01' } });
    expect(t.apply).not.toHaveBeenCalled();
    expect(t.ensureProjectZero).not.toHaveBeenCalled();
    expect(t.connectCentral).not.toHaveBeenCalled();
  });
});

describe('a selector that matches nothing once the registry exists', () => {
  it('e: an unknown tenant slug returns the usage result after the central line', async () => {
    const t = harness({
      overrides: {
        projectIdOfTenant: vi.fn(async () => {
          if (!t.calls.includes('apply:central')) throw missingRegistry();
          return null;
        }),
      },
    });
    const result = await migrateAll({ tenantSlug: 'ghost', deps: t.deps });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({ kind: 'central', status: 'ok' });
    expect(result.lines[1]).toEqual({ kind: 'usage', message: 'no tenant has that slug' });
    expect(t.apply).toHaveBeenCalledTimes(1);
    expect(t.connect).not.toHaveBeenCalled();
  });

  it('e2: an unknown project ref returns the usage result after the central line', async () => {
    const t = harness({
      overrides: {
        listProjects: vi.fn(async () => {
          if (!t.calls.includes('apply:central')) throw missingRegistry();
          return [ALPHA];
        }),
      },
    });
    const result = await migrateAll({ projectRef: 'no-such-ref', deps: t.deps });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({ kind: 'central', status: 'ok' });
    expect(result.lines[1]).toEqual({ kind: 'usage', message: 'no ready project matches' });
    expect(t.connect).not.toHaveBeenCalled();
  });
});

describe('a registry that is still missing after the central set', () => {
  it('f: rejects with the original error after the central set was applied', async () => {
    const error = missingRegistry();
    const t = harness({
      overrides: {
        listProjects: vi.fn(async () => {
          throw error;
        }),
      },
    });
    const list = t.deps.listProjects as ReturnType<typeof vi.fn>;

    await expect(migrateAll({ deps: t.deps })).rejects.toBe(error);
    expect(t.apply).toHaveBeenCalledTimes(1);
    expect(t.apply).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Array),
      expect.objectContaining({ set: 'central', dryRun: false }),
    );
    expect(list).toHaveBeenCalledTimes(2);
    expect(t.connect).not.toHaveBeenCalled();
  });
});

describe('a central set that fails while the registry is missing', () => {
  it('g: exits 1 with the central line and the failure summary, and does no tenant work', async () => {
    const t = harness({
      centralResult: () => ({
        applied: [],
        skipped: 0,
        pending: [VERSION_A],
        errorCode: 'file_failed',
        failedVersion: VERSION_A,
      }),
    });
    const result = await migrateAll({ deps: t.deps });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(kinds(result.lines)).toEqual(['central', 'summary']);
    expect(result.lines[0]).toMatchObject({ status: 'failed', errorCode: 'file_failed' });
    expect(result.lines[1]).toMatchObject({ central: 'failed', projects: 0 });
    expect(t.listProjects).toHaveBeenCalledTimes(1);
    expect(t.connect).not.toHaveBeenCalled();
  });
});

describe('the normal path with the registry present', () => {
  it('h: reads the registry exactly once', async () => {
    const t = harness({ registryPresent: true });
    const result = await migrateAll({ concurrency: 1, deps: t.deps });

    expect(t.listProjects).toHaveBeenCalledTimes(1);
    expect(t.calls).toEqual([
      'list:ok',
      'ensureProjectZero',
      'apply:central',
      'apply:tenant:alpha-proj',
      'apply:tenant:beta-proj',
    ]);
    expect(result.exitCode).toBe(0);
  });
});
