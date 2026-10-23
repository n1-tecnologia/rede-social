import type { AnyJobDefinition } from '@rede-social/core/server/modules/manifest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BossTarget,
  backoffDelayMs,
  createSupervisor,
  SUPERVISOR_MAX_PROJECTS,
  SUPERVISOR_TICK_MS,
  type SupervisedBoss,
  type SupervisedProject,
} from '../../src/worker-supervisor';

/**
 * The worker supervisor (09.2-09, D-546, DBT-30, P61, T-09.2-41/42) with fake pg-boss instances and an
 * injected clock: start order, the ready-set diff, bounded start parallelism, per-project backoff, the cap,
 * graceful stop and the handler context. No socket is opened.
 */

type Fake = SupervisedBoss & {
  target: BossTarget;
  started: boolean;
  stops: { graceful: boolean; timeout: number }[];
  works: Map<string, (batch: { data: unknown }[]) => Promise<void>>;
  concurrencies: Map<string, number>;
};

const project = (ref: string, version = 1, isCentral = false): SupervisedProject => ({
  id: `id-${ref}`,
  ref,
  isCentral,
  credentialVersion: version,
});

type World = {
  projects: SupervisedProject[];
  registryDown: boolean;
  /** Refs whose `start()` rejects. */
  unreachable: Set<string>;
  made: Fake[];
  clock: number;
  startOrder: string[];
  inFlight: number;
  maxInFlight: number;
  startDelayMs: number;
  tick?: () => void;
  events: { fields: Record<string, unknown>; message: string; level: string }[];
  queues: { target: string; names: readonly string[] }[];
  hooks: string[];
  hookThrows: boolean;
};

let w: World;

const handlerCalls: { name: string; data: unknown; ctx: unknown }[] = [];
const job = (name: string, concurrency?: number, scope?: 'platform'): AnyJobDefinition => ({
  name,
  scope,
  concurrency,
  handler: async (data: unknown, ctx?: unknown) => {
    handlerCalls.push({ name, data, ctx });
  },
});

const labelOf = (target: BossTarget) =>
  target.scope === 'platform' ? 'platform' : target.project.ref;

function build(overrides: Partial<Parameters<typeof createSupervisor>[0]> = {}) {
  return createSupervisor({
    listProjects: async () => {
      if (w.registryDown) throw new Error('registry down');
      return [...w.projects];
    },
    makeBoss: (target) => {
      const fake: Fake = {
        target,
        started: false,
        stops: [],
        works: new Map(),
        concurrencies: new Map(),
        on: () => fake,
        async start() {
          w.startOrder.push(labelOf(target));
          w.inFlight += 1;
          w.maxInFlight = Math.max(w.maxInFlight, w.inFlight);
          try {
            if (w.startDelayMs > 0) await new Promise((r) => setTimeout(r, w.startDelayMs));
            if (target.scope === 'tenant' && w.unreachable.has(target.project.ref)) {
              throw new Error(`connect ECONNREFUSED ${target.project.ref}`);
            }
            fake.started = true;
          } finally {
            w.inFlight -= 1;
          }
        },
        async stop(options) {
          fake.stops.push(options);
        },
        async work(name, options, handler) {
          fake.works.set(name, handler);
          fake.concurrencies.set(name, options.localConcurrency);
        },
      };
      w.made.push(fake);
      return fake;
    },
    createQueues: async (boss, names) => {
      w.queues.push({ target: labelOf((boss as Fake).target), names });
    },
    centralProjectId: async () => 'id-central',
    platformJobs: [job('platform.a', undefined, 'platform')],
    tenantJobs: [job('tenant.a'), job('tenant.b', 4)],
    onPlatformStarted: async () => {
      w.hooks.push('platform');
    },
    onProjectStarted: async (p) => {
      w.hooks.push(p.ref);
      if (w.hookThrows) throw new Error('hook failed');
    },
    now: () => w.clock,
    schedule: (fn) => {
      w.tick = fn;
      return () => {
        w.tick = undefined;
      };
    },
    random: () => 0.5,
    log: {
      info: (fields, message) => w.events.push({ fields, message, level: 'info' }),
      warn: (fields, message) => w.events.push({ fields, message, level: 'warn' }),
      error: (fields, message) => w.events.push({ fields, message, level: 'error' }),
    },
    ...overrides,
  });
}

const running = (sup: ReturnType<typeof build>) =>
  sup
    .state()
    .projects.map((p) => p.ref)
    .sort();
const eventsNamed = (name: string) => w.events.filter((e) => e.fields.event === name);

beforeEach(() => {
  w = {
    projects: [project('local', 1, true), project('bravo'), project('alpha')],
    registryDown: false,
    unreachable: new Set(),
    made: [],
    clock: 1_000_000,
    startOrder: [],
    inFlight: 0,
    maxInFlight: 0,
    startDelayMs: 0,
    events: [],
    queues: [],
    hooks: [],
    hookThrows: false,
  };
  handlerCalls.length = 0;
});

describe('start', () => {
  it('starts the platform instance first, then every ready project (project 0 first, then by ref)', async () => {
    const sup = build();
    await sup.start();
    expect(w.startOrder[0]).toBe('platform');
    expect(w.startOrder.slice(1)).toEqual(['local', 'alpha', 'bravo']);
    expect(running(sup)).toEqual(['alpha', 'bravo', 'local']);
    expect(sup.state().platform).toBe(true);
    expect(w.hooks).toEqual(['platform', 'local', 'alpha', 'bravo']);
  });

  it('creates the queues of each scope and works every job with its concurrency', async () => {
    const sup = build();
    await sup.start();
    expect(w.queues.find((q) => q.target === 'platform')?.names).toEqual(['platform.a']);
    expect(w.queues.find((q) => q.target === 'alpha')?.names).toEqual(['tenant.a', 'tenant.b']);
    const alpha = w.made.find((f) => labelOf(f.target) === 'alpha');
    expect([...(alpha?.concurrencies ?? [])]).toEqual([
      ['tenant.a', 1],
      ['tenant.b', 4],
    ]);
    const platform = w.made.find((f) => f.target.scope === 'platform');
    expect([...(platform?.works.keys() ?? [])]).toEqual(['platform.a']);
  });

  it('calls each handler with { projectId } of the queue that delivered it (the central id for platform jobs)', async () => {
    const sup = build();
    await sup.start();
    const alpha = w.made.find((f) => labelOf(f.target) === 'alpha');
    await alpha?.works.get('tenant.a')?.([{ data: { n: 1 } }, { data: { n: 2 } }]);
    const platform = w.made.find((f) => f.target.scope === 'platform');
    await platform?.works.get('platform.a')?.([{ data: { p: 1 } }]);
    expect(handlerCalls).toEqual([
      { name: 'tenant.a', data: { n: 1 }, ctx: { projectId: 'id-alpha' } },
      { name: 'tenant.a', data: { n: 2 }, ctx: { projectId: 'id-alpha' } },
      { name: 'platform.a', data: { p: 1 }, ctx: { projectId: 'id-central' } },
    ]);
  });

  it('a platform instance that cannot start fails the boot', async () => {
    const sup = build({
      makeBoss: () => {
        throw new Error('no platform schema');
      },
    });
    await expect(sup.start()).rejects.toThrow('no platform schema');
    expect(sup.state().platform).toBe(false);
  });

  it('schedules the 60 s reconcile', async () => {
    const sup = build();
    await sup.start();
    expect(SUPERVISOR_TICK_MS).toBe(60_000);
    expect(w.tick).toBeTypeOf('function');
  });
});

describe('the ready-set diff', () => {
  it('adds a new project, removes one that is no longer ready (graceful, 20 s) and keeps the rest running', async () => {
    const sup = build();
    await sup.start();
    const bravo = w.made.find((f) => labelOf(f.target) === 'bravo');
    w.projects = [project('local', 1, true), project('alpha'), project('charlie')];
    await sup.tick();
    expect(running(sup)).toEqual(['alpha', 'charlie', 'local']);
    expect(bravo?.stops).toEqual([{ graceful: true, timeout: 20_000 }]);
    const alpha = w.made.find((f) => labelOf(f.target) === 'alpha');
    expect(alpha?.stops).toEqual([]);
    expect(eventsNamed('worker.supervisor.stopped').some((e) => e.fields.ref === 'bravo')).toBe(
      true,
    );
  });

  it('restarts a project whose credential version changed: the old instance stops, a new one starts', async () => {
    const sup = build();
    await sup.start();
    const before = w.made.filter((f) => labelOf(f.target) === 'alpha');
    w.projects = [project('local', 1, true), project('alpha', 2), project('bravo')];
    await sup.tick();
    const after = w.made.filter((f) => labelOf(f.target) === 'alpha');
    expect(after).toHaveLength(before.length + 1);
    expect(before[0]?.stops).toHaveLength(1);
    expect(sup.state().projects.find((p) => p.ref === 'alpha')?.credentialVersion).toBe(2);
    expect(eventsNamed('worker.supervisor.restarted')).toHaveLength(1);
  });

  it('a paused project (gone from the ready list) stops and comes back when ready again', async () => {
    const sup = build();
    await sup.start();
    w.projects = [project('local', 1, true)];
    await sup.tick();
    expect(running(sup)).toEqual(['local']);
    w.projects = [project('local', 1, true), project('alpha')];
    await sup.tick();
    expect(running(sup)).toEqual(['alpha', 'local']);
  });

  it('an unreadable registry stops nothing and the next tick recovers', async () => {
    const sup = build();
    await sup.start();
    w.registryDown = true;
    await sup.tick();
    expect(running(sup)).toEqual(['alpha', 'bravo', 'local']);
    expect(w.made.every((f) => f.stops.length === 0)).toBe(true);
    w.registryDown = false;
    w.projects = [project('local', 1, true), project('delta')];
    await sup.tick();
    expect(running(sup)).toEqual(['delta', 'local']);
  });
});

describe('start parallelism', () => {
  it('starts at most four projects at once, and all of them', async () => {
    w.projects = Array.from({ length: 10 }, (_, i) => project(`p${String(i).padStart(2, '0')}`));
    w.startDelayMs = 15;
    const sup = build();
    await sup.start();
    expect(sup.state().projects).toHaveLength(10);
    // The platform instance is started alone before the first tick, so the maximum belongs to the projects.
    expect(w.maxInFlight).toBe(4);
  });
});

describe('backoff (T-09.2-41)', () => {
  it('a failing project backs off 5, 10, 20 s and delays nobody else', async () => {
    w.unreachable.add('bravo');
    const sup = build();
    await sup.start();
    expect(running(sup)).toEqual(['alpha', 'local']);
    expect(sup.state().backoff).toEqual([{ projectId: 'id-bravo', attempts: 1, retryInMs: 5_000 }]);

    // Before the delay passes the project is not retried.
    const attemptsBefore = w.startOrder.filter((l) => l === 'bravo').length;
    w.clock += 4_000;
    await sup.tick();
    expect(w.startOrder.filter((l) => l === 'bravo').length).toBe(attemptsBefore);

    w.clock += 1_000;
    await sup.tick();
    expect(sup.state().backoff[0]).toMatchObject({ attempts: 2, retryInMs: 10_000 });
    w.clock += 10_000;
    await sup.tick();
    expect(sup.state().backoff[0]).toMatchObject({ attempts: 3, retryInMs: 20_000 });
    expect(eventsNamed('worker.supervisor.backoff')).toHaveLength(3);
    // The healthy projects were never touched by the failing one.
    expect(running(sup)).toEqual(['alpha', 'local']);
  });

  it('a project that recovers is started and its backoff cleared', async () => {
    w.unreachable.add('bravo');
    const sup = build();
    await sup.start();
    w.unreachable.delete('bravo');
    w.clock += 5_000;
    await sup.tick();
    expect(running(sup)).toEqual(['alpha', 'bravo', 'local']);
    expect(sup.state().backoff).toEqual([]);
  });

  it('the failed instance is stopped, not left half-open', async () => {
    w.unreachable.add('bravo');
    const sup = build();
    await sup.start();
    const failed = w.made.filter((f) => labelOf(f.target) === 'bravo');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.stops).toHaveLength(1);
  });

  it('new credentials retry at once, ignoring the backoff', async () => {
    w.unreachable.add('bravo');
    const sup = build();
    await sup.start();
    w.unreachable.delete('bravo');
    w.projects = [project('local', 1, true), project('alpha'), project('bravo', 2)];
    await sup.tick(); // no clock advance
    expect(running(sup)).toContain('bravo');
  });

  it('the delay doubles to a five minute ceiling and the jitter stays within +-20%', () => {
    expect(backoffDelayMs(1, () => 0.5)).toBe(5_000);
    expect(backoffDelayMs(2, () => 0.5)).toBe(10_000);
    expect(backoffDelayMs(3, () => 0.5)).toBe(20_000);
    expect(backoffDelayMs(20, () => 0.5)).toBe(300_000);
    expect(backoffDelayMs(1, () => 0)).toBe(4_000);
    expect(backoffDelayMs(1, () => 0.999999)).toBeLessThanOrEqual(6_000);
    for (let attempts = 1; attempts <= 12; attempts += 1) {
      const base = Math.min(5_000 * 2 ** (attempts - 1), 300_000);
      for (const r of [0, 0.25, 0.5, 0.75, 0.999999]) {
        const delay = backoffDelayMs(attempts, () => r);
        expect(delay).toBeGreaterThanOrEqual(Math.floor(base * 0.8));
        expect(delay).toBeLessThanOrEqual(Math.ceil(base * 1.2));
      }
    }
  });

  it('a throwing onProjectStarted does not stop the loop or the project', async () => {
    w.hookThrows = true;
    const sup = build();
    await sup.start();
    expect(running(sup)).toEqual(['alpha', 'bravo', 'local']);
    expect(w.hooks).toEqual(['platform', 'local', 'alpha', 'bravo']);
    expect(w.events.some((e) => e.level === 'error' && e.message.includes('start hook'))).toBe(
      true,
    );
  });
});

describe('the cap (T-09.2-42)', () => {
  it('the default is 40', () => {
    expect(SUPERVISOR_MAX_PROJECTS).toBe(40);
  });

  it('starts no more than the cap, project 0 first, and logs cap_reached once per tick', async () => {
    w.projects = [
      project('zulu'),
      project('local', 1, true),
      project('alpha'),
      project('bravo'),
      project('charlie'),
    ];
    const sup = build({ maxProjects: 3 });
    await sup.start();
    expect(running(sup)).toEqual(['alpha', 'bravo', 'local']);
    expect(sup.state().capped).toBe(2);
    expect(eventsNamed('worker.supervisor.cap_reached')).toHaveLength(1);
    await sup.tick();
    expect(eventsNamed('worker.supervisor.cap_reached')).toHaveLength(2);
    expect(running(sup)).toEqual(['alpha', 'bravo', 'local']);
  });

  it('a freed slot is given to a skipped project on the next tick', async () => {
    w.projects = [project('local', 1, true), project('alpha'), project('bravo')];
    const sup = build({ maxProjects: 2 });
    await sup.start();
    expect(running(sup)).toEqual(['alpha', 'local']);
    w.projects = [project('local', 1, true), project('bravo')];
    await sup.tick();
    expect(running(sup)).toEqual(['bravo', 'local']);
  });
});

describe('stop', () => {
  it('stops every instance gracefully, cancels the timer and starts nothing afterwards', async () => {
    const sup = build();
    await sup.start();
    await sup.stop();
    expect(w.made.every((f) => f.stops.length === 1)).toBe(true);
    expect(w.made.every((f) => f.stops[0]?.graceful && f.stops[0]?.timeout === 20_000)).toBe(true);
    expect(w.tick).toBeUndefined();
    expect(sup.state().projects).toEqual([]);
    expect(sup.state().platform).toBe(false);
    const made = w.made.length;
    w.projects = [...w.projects, project('late')];
    await sup.tick();
    expect(w.made).toHaveLength(made);
  });

  it('keeps stopping the others when one instance fails to stop', async () => {
    const sup = build();
    await sup.start();
    const bad = w.made.find((f) => labelOf(f.target) === 'alpha') as Fake;
    bad.stop = vi.fn(async () => {
      throw new Error('stuck');
    });
    await sup.stop();
    const others = w.made.filter((f) => f !== bad);
    expect(others.every((f) => f.stops.length >= 1)).toBe(true);
  });
});

describe('overlapping ticks', () => {
  it('a tick that arrives while another runs shares it instead of starting twice', async () => {
    w.startDelayMs = 10;
    const sup = build();
    await sup.start();
    w.projects = [...w.projects, project('delta')];
    const a = sup.tick();
    const b = sup.tick();
    await Promise.all([a, b]);
    expect(w.made.filter((f) => labelOf(f.target) === 'delta')).toHaveLength(1);
  });
});
