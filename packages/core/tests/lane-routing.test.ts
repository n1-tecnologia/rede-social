import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createLanes, createPlatformLane } from '../db/lanes';
import { projectOfTx } from '../db/project-handle';
import type { ProjectHandle } from '../db/project-pools';
import type { Tx } from '../db/tenant-tx';
import { type ProjectRecord, ProjectUnboundError } from '../server/tenancy/project-registry';

/**
 * D-538 (09.2-04): the explicit lane signatures. Fake handles record the statements their transaction ran, so
 * no test opens a socket. Flagged assumption P15 (DBT-07): the typecheck of the overloads, this file, `pnpm
 * lint` and `pnpm boundaries:negative` are the proof; the legacy overload is the deliberate exception until
 * plan 10.
 */

type FakeHandle = ProjectHandle & { statements: string[] };

function fakeHandle(projectId: string, kind: 'central' | 'tenant' = 'tenant'): FakeHandle {
  const statements: string[] = [];
  const tx = {
    execute: async (query: { queryChunks?: unknown[] }) => {
      statements.push(
        (query.queryChunks ?? [])
          .map((chunk) =>
            typeof chunk === 'object' && chunk !== null && 'value' in chunk
              ? ((chunk as { value: string[] }).value ?? []).join('')
              : '',
          )
          .join(''),
      );
      return [];
    },
  } as unknown as Tx;
  return {
    projectId,
    ref: projectId,
    kind,
    credentialVersion: 1,
    sql: undefined as never,
    db: { transaction: async (fn: (t: Tx) => Promise<unknown>) => fn(tx) } as never,
    statements,
  };
}

const record = (id: string): ProjectRecord =>
  ({
    id,
    ref: id,
    isCentral: id === 'p0',
    isDefault: false,
    credentialSource: id === 'p0' ? 'env' : 'sealed',
    credentialVersion: 1,
    apiUrl: 'https://example.test',
  }) as unknown as ProjectRecord;

function harness() {
  const central = fakeHandle('p0', 'central');
  const handles: Record<string, FakeHandle> = {
    p0: central,
    pa: fakeHandle('pa'),
    pb: fakeHandle('pb'),
  };
  const tenants: Record<string, string> = { 'tenant-a': 'pa', 'tenant-b': 'pb', 'tenant-0': 'p0' };
  const resolveProject = vi.fn(async (tenantId: string) => {
    const id = tenants[tenantId];
    if (!id) throw new ProjectUnboundError();
    return record(id);
  });
  const resolveProjectById = vi.fn(async (id: string) => (handles[id] ? record(id) : null));
  const withHandle = vi.fn(
    async <T>(project: ProjectRecord, fn: (h: ProjectHandle) => Promise<T>) =>
      fn(handles[project.id] as ProjectHandle),
  );
  const lanes = createLanes({
    centralHandle: () => central,
    resolveProject,
    resolveProjectById,
    withHandle,
    unbound: () => new ProjectUnboundError(),
  });
  return { lanes, central, handles, resolveProject, resolveProjectById, withHandle };
}

const ROLE = 'set local role service_role';

describe('withAdminTx(target, fn)', () => {
  it('{ tenantId } opens on the project registered for that tenant and issues set local role service_role', async () => {
    const h = harness();
    const used = await h.lanes.withAdminTx(
      { tenantId: 'tenant-a' },
      async (tx) => projectOfTx.get(tx)?.handle,
    );
    expect(used).toBe(h.handles.pa);
    expect(h.resolveProject).toHaveBeenCalledWith('tenant-a');
    expect(h.handles.pa?.statements).toEqual([ROLE]);
    expect(h.handles.pb?.statements).toEqual([]);
    expect(h.central.statements).toEqual([]);
  });

  it('two tenants on two projects never cross: each runs on its own handle', async () => {
    const h = harness();
    const a = await h.lanes.withAdminTx(
      { tenantId: 'tenant-a' },
      async (tx) => projectOfTx.get(tx)?.handle.projectId,
    );
    const b = await h.lanes.withAdminTx(
      { tenantId: 'tenant-b' },
      async (tx) => projectOfTx.get(tx)?.handle.projectId,
    );
    expect([a, b]).toEqual(['pa', 'pb']);
  });

  it('{ projectId } opens on that project without resolving any tenant', async () => {
    const h = harness();
    const used = await h.lanes.withAdminTx(
      { projectId: 'pb' },
      async (tx) => projectOfTx.get(tx)?.handle,
    );
    expect(used).toBe(h.handles.pb);
    expect(h.resolveProjectById).toHaveBeenCalledWith('pb');
    expect(h.resolveProject).not.toHaveBeenCalled();
    expect(h.handles.pb?.statements).toEqual([ROLE]);
  });

  it('a tenant bound to project 0 runs on the central handle', async () => {
    const h = harness();
    const used = await h.lanes.withAdminTx(
      { tenantId: 'tenant-0' },
      async (tx) => projectOfTx.get(tx)?.handle,
    );
    expect(used).toBe(h.central);
  });

  it('an unknown tenant surfaces ProjectUnboundError and opens no transaction', async () => {
    const h = harness();
    await expect(h.lanes.withAdminTx({ tenantId: 'nobody' }, async () => 1)).rejects.toBeInstanceOf(
      ProjectUnboundError,
    );
    expect(h.withHandle).not.toHaveBeenCalled();
  });

  it('an unknown project id surfaces ProjectUnboundError', async () => {
    const h = harness();
    await expect(h.lanes.withAdminTx({ projectId: 'ghost' }, async () => 1)).rejects.toBeInstanceOf(
      ProjectUnboundError,
    );
  });

  it.each([
    ['an empty target', {}],
    ['an empty tenant id', { tenantId: '' }],
    ['a non-string tenant id', { tenantId: 7 }],
    ['both a tenant and a project', { tenantId: 'tenant-a', projectId: 'pa' }],
    ['null', null],
  ])('%s is refused before any project is resolved', async (_label, target) => {
    const h = harness();
    await expect(
      h.lanes.withAdminTx(target as never, (async () => 1) as never),
    ).rejects.toBeInstanceOf(TypeError);
    expect(h.resolveProject).not.toHaveBeenCalled();
    expect(h.resolveProjectById).not.toHaveBeenCalled();
  });

  it('a target with no function is refused', async () => {
    const h = harness();
    await expect(h.lanes.withAdminTx({ tenantId: 'tenant-a' } as never)).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});

describe('the legacy withAdminTx(fn) and withPlatformTx(fn)', () => {
  it('the function form means project 0, under service_role, registered in projectOfTx', async () => {
    const h = harness();
    const used = await h.lanes.withAdminTx(async (tx) => projectOfTx.get(tx)?.handle);
    expect(used).toBe(h.central);
    expect(h.central.statements).toEqual([ROLE]);
    expect(h.resolveProject).not.toHaveBeenCalled();
    expect(h.withHandle).not.toHaveBeenCalled();
  });

  it('withPlatformTx opens the central project under service_role and registers it', async () => {
    const h = harness();
    const used = await h.lanes.withPlatformTx(async (tx) => projectOfTx.get(tx)?.handle);
    expect(used).toBe(h.central);
    expect(h.central.statements).toEqual([ROLE]);
  });

  it('each lane records the lane that opened the transaction (09.2-09: the enqueue scope guard reads it)', async () => {
    const h = harness();
    expect(await h.lanes.withAdminTx(async (tx) => projectOfTx.get(tx)?.lane)).toBe('admin');
    expect(
      await h.lanes.withAdminTx({ tenantId: 'tenant-a' }, async (tx) => projectOfTx.get(tx)?.lane),
    ).toBe('admin');
    expect(await h.lanes.withPlatformTx(async (tx) => projectOfTx.get(tx)?.lane)).toBe('platform');
  });

  it('the platform lane alone needs only the central handle', async () => {
    const central = fakeHandle('p0', 'central');
    const lane = createPlatformLane({ centralHandle: () => central });
    expect(await lane.withPlatformTx(async (tx) => projectOfTx.get(tx)?.handle)).toBe(central);
  });

  it('a throwing callback rejects with its own error and the lanes keep working', async () => {
    const h = harness();
    await expect(
      h.lanes.withAdminTx({ tenantId: 'tenant-a' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await h.lanes.withAdminTx({ tenantId: 'tenant-a' }, async () => 'ok')).toBe('ok');
  });
});

describe('the lanes are defined once and never in tenant-tx (CR-03)', () => {
  const read = (relative: string) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
  const code = (source: string) =>
    source
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');

  it('tenant-tx.ts has no withAdminTx or withPlatformTx outside comments', () => {
    expect(code(read('../db/tenant-tx.ts'))).not.toMatch(/withAdminTx|withPlatformTx/);
  });

  it('admin-tx.ts marks the function form @deprecated and takes a LaneTarget', () => {
    const source = read('../db/admin-tx.ts');
    expect(source).toContain('@deprecated');
    expect(source).toContain('LaneTarget');
  });
});
