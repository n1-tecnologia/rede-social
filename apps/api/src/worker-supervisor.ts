import type { AnyJobDefinition } from '@rede-social/core/server/modules/manifest';

/**
 * The worker supervisor (09.2-09, D-546, DBT-30): one pg-boss instance for the control plane plus one per
 * READY project, kept alive as the registry changes.
 *
 * Why it exists. A pg-boss instance polls ONE database. With a database per tenant the worker must poll many,
 * and the set changes at runtime (a project is created, paused, moved, its credentials rotated). So the worker
 * no longer calls `boss.start()` once: it asks this supervisor, which
 *
 *  - starts the PLATFORM instance first (`pgboss_platform` of the central project) and fails the boot when it
 *    cannot, because without it no domain check, invite or mirror reconcile runs;
 *  - then every 60 s reconciles the running set against the registry: starts new ready projects (parallel, at
 *    most 4 at once), stops removed, paused or preparing ones (`stop({ graceful: true, timeout: 20 000 })`) and
 *    restarts one whose `credentialVersion` changed;
 *  - backs off a failing project alone (5 s doubling to 5 min, +-20% jitter) so an unreachable or paused
 *    project costs only itself and never delays the others (T-09.2-41);
 *  - refuses to exceed `maxProjects` (default `SUPERVISOR_MAX_PROJECTS` = 40) with a loud log: each project
 *    holds about two session sockets for pg-boss, so the cap bounds the sockets of one worker (T-09.2-42);
 *  - never stops anything when the registry itself cannot be read: it keeps what runs and tries again.
 *
 * Everything environmental is injected (the registry read, the pg-boss factory, the clock, the timer, the
 * random source), so the unit test runs the whole lifecycle with fake instances and an injected clock and
 * opens no socket. `worker.ts` binds the defaults. This file imports no database code and no env on purpose.
 *
 * Events: `worker.supervisor.started|stopped|restarted|backoff|cap_reached`. Logs carry project ids and refs
 * only, never a URL.
 */

/** The default of the cap: how many tenant projects one worker instance supervises. */
export const SUPERVISOR_MAX_PROJECTS = 40;

/** Seconds between two reconciles of the running set against the registry. */
export const SUPERVISOR_TICK_MS = 60_000;

/** Projects started at the same time. */
export const SUPERVISOR_START_CONCURRENCY = 4;

/** The first retry delay of a failing project; it doubles up to the ceiling. */
export const SUPERVISOR_BACKOFF_BASE_MS = 5_000;
export const SUPERVISOR_BACKOFF_MAX_MS = 300_000;

/** Graceful stop: finish the jobs in flight, but not for longer than this. */
export const SUPERVISOR_STOP_TIMEOUT_MS = 20_000;

/** What the supervisor needs of a registry row. */
export type SupervisedProject = {
  id: string;
  ref: string;
  isCentral: boolean;
  credentialVersion: number;
};

/** What the supervisor needs of a pg-boss instance. The real `PgBoss` satisfies it. */
export interface SupervisedBoss {
  on(event: 'error', listener: (error: Error) => void): unknown;
  start(): Promise<unknown>;
  stop(options: { graceful: boolean; timeout: number }): Promise<unknown>;
  work(
    name: string,
    options: { localConcurrency: number },
    handler: (batch: { data: unknown }[]) => Promise<void>,
  ): Promise<unknown>;
}

/** Which instance to build: the platform one, or the tenant-scope one of a project. */
export type BossTarget<P extends SupervisedProject = SupervisedProject> =
  | { scope: 'platform' }
  | { scope: 'tenant'; project: P };

export type SupervisorLog = {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
};

export type SupervisorDeps<P extends SupervisedProject = SupervisedProject> = {
  /** Every ready project of the registry. Rejects when the registry cannot be read. */
  listProjects: () => Promise<readonly P[]>;
  /** Builds (does not start) the instance for a target, with its session connection. May throw. */
  makeBoss: (target: BossTarget<P>) => SupervisedBoss;
  /** Creates the queues of a scope on an instance, idempotently. */
  createQueues: (boss: SupervisedBoss, names: readonly string[]) => Promise<void>;
  /** The id of the central project, the `projectId` the platform jobs run with. */
  centralProjectId: () => Promise<string>;
  /** The jobs of the platform instance and of every tenant instance. */
  platformJobs: readonly AnyJobDefinition[];
  tenantJobs: readonly AnyJobDefinition[];
  /** Runs once after the platform instance started (best effort, each step in its own try/catch). */
  onPlatformStarted?: () => Promise<void>;
  /** Runs once after each project's instance started (best effort). */
  onProjectStarted?: (project: P) => Promise<void>;
  /** Monotonic clock in whole milliseconds. */
  now: () => number;
  /** Runs `fn` every `ms`; returns the cancel function. */
  schedule: (fn: () => void, ms: number) => () => void;
  /** A number in [0, 1). */
  random: () => number;
  log: SupervisorLog;
  maxProjects?: number;
};

export type SupervisorState = {
  platform: boolean;
  projects: { projectId: string; ref: string; credentialVersion: number }[];
  backoff: { projectId: string; attempts: number; retryInMs: number }[];
  /** How many ready projects the last tick skipped because of the cap. */
  capped: number;
};

type Running<P> = { project: P; boss: SupervisedBoss };
type Failure = { attempts: number; retryAt: number; credentialVersion: number };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The delay before the next attempt: 5 s doubling to 5 min, jittered by +-20%. */
export function backoffDelayMs(attempts: number, random: () => number): number {
  const base = Math.min(
    SUPERVISOR_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1),
    SUPERVISOR_BACKOFF_MAX_MS,
  );
  return Math.round(base * (0.8 + random() * 0.4));
}

export function createSupervisor<P extends SupervisedProject = SupervisedProject>(
  deps: SupervisorDeps<P>,
) {
  const maxProjects = deps.maxProjects ?? SUPERVISOR_MAX_PROJECTS;
  const { log } = deps;
  const tenantNames = deps.tenantJobs.map((job) => job.name);
  const platformNames = deps.platformJobs.map((job) => job.name);

  const running = new Map<string, Running<P>>();
  const failures = new Map<string, Failure>();
  let platform: SupervisedBoss | null = null;
  let cancelTimer: (() => void) | null = null;
  let current: Promise<void> | null = null;
  let stopped = false;
  let capped = 0;

  async function stopBoss(boss: SupervisedBoss): Promise<void> {
    await boss.stop({ graceful: true, timeout: SUPERVISOR_STOP_TIMEOUT_MS });
  }

  /** Builds, starts and wires an instance: queues first, then one `work` per job. */
  async function launch(
    target: BossTarget<P>,
    jobs: readonly AnyJobDefinition[],
    names: readonly string[],
    projectId: string,
  ): Promise<SupervisedBoss> {
    const boss = deps.makeBoss(target);
    // A connection-level error on an idle socket must not crash the worker; pg-boss reconnects on its own.
    boss.on('error', (error) =>
      log.error({ projectId, scope: target.scope, err: messageOf(error) }, 'pg-boss error'),
    );
    try {
      await boss.start();
      await deps.createQueues(boss, names);
      for (const job of jobs) {
        await boss.work(job.name, { localConcurrency: job.concurrency ?? 1 }, async (batch) => {
          for (const item of batch) await job.handler(item.data, { projectId });
        });
      }
    } catch (error) {
      await stopBoss(boss).catch(() => undefined);
      throw error;
    }
    return boss;
  }

  async function startProject(project: P, restarted: boolean): Promise<void> {
    try {
      const boss = await launch(
        { scope: 'tenant', project },
        deps.tenantJobs,
        tenantNames,
        project.id,
      );
      running.set(project.id, { project, boss });
      failures.delete(project.id);
      log.info(
        {
          event: restarted ? 'worker.supervisor.restarted' : 'worker.supervisor.started',
          projectId: project.id,
          ref: project.ref,
          credentialVersion: project.credentialVersion,
        },
        restarted ? 'project queue restarted' : 'project queue started',
      );
    } catch (error) {
      const attempts = (failures.get(project.id)?.attempts ?? 0) + 1;
      const delay = backoffDelayMs(attempts, deps.random);
      failures.set(project.id, {
        attempts,
        retryAt: deps.now() + delay,
        credentialVersion: project.credentialVersion,
      });
      log.warn(
        {
          event: 'worker.supervisor.backoff',
          projectId: project.id,
          ref: project.ref,
          attempts,
          retryInMs: delay,
          err: messageOf(error),
        },
        'project queue could not start; backing off',
      );
      return;
    }
    if (deps.onProjectStarted) {
      try {
        await deps.onProjectStarted(project);
      } catch (error) {
        log.error(
          { projectId: project.id, ref: project.ref, err: messageOf(error) },
          'project start hook failed; the queue keeps running',
        );
      }
    }
  }

  async function stopProject(projectId: string, reason: string): Promise<void> {
    const entry = running.get(projectId);
    if (!entry) return;
    running.delete(projectId);
    try {
      await stopBoss(entry.boss);
    } catch (error) {
      log.error(
        { projectId, ref: entry.project.ref, err: messageOf(error) },
        'project queue did not stop cleanly',
      );
    }
    log.info(
      { event: 'worker.supervisor.stopped', projectId, ref: entry.project.ref, reason },
      'project queue stopped',
    );
  }

  /** Runs `items` through `fn`, at most `limit` at a time. */
  async function inParallel<T>(
    items: readonly T[],
    limit: number,
    fn: (item: T) => Promise<void>,
  ): Promise<void> {
    let next = 0;
    const lane = async (): Promise<void> => {
      while (next < items.length) {
        const item = items[next] as T;
        next += 1;
        await fn(item);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  }

  async function reconcile(): Promise<void> {
    let listed: readonly P[];
    try {
      listed = await deps.listProjects();
    } catch (error) {
      // Never stop what runs because the registry is unreadable: the data plane does not depend on it.
      log.error({ err: messageOf(error) }, 'supervisor could not read the project registry');
      return;
    }
    if (stopped) return;
    const ready = new Map(listed.map((project) => [project.id, project]));

    // 1. stop what is no longer ready, restart what changed credentials.
    const toStop: { id: string; reason: string }[] = [];
    const toRestart: P[] = [];
    for (const [id, entry] of running) {
      const now = ready.get(id);
      if (!now) toStop.push({ id, reason: 'not_ready' });
      else if (now.credentialVersion !== entry.project.credentialVersion) {
        toStop.push({ id, reason: 'credentials_changed' });
        toRestart.push(now);
      }
    }
    for (const id of failures.keys()) if (!ready.has(id)) failures.delete(id);
    await Promise.all(toStop.map((item) => stopProject(item.id, item.reason)));
    if (stopped) return;

    // 2. who to start: the restarts, then the missing ones whose backoff has passed; project 0 first, then by ref.
    const now = deps.now();
    const wanted: { project: P; restarted: boolean }[] = [
      ...toRestart.map((project) => ({ project, restarted: true })),
    ];
    const candidates = [...ready.values()]
      .filter((project) => !running.has(project.id) && !toRestart.some((r) => r.id === project.id))
      .filter((project) => {
        const failure = failures.get(project.id);
        if (!failure) return true;
        // New credentials deserve an immediate attempt; otherwise honour the backoff.
        return failure.credentialVersion !== project.credentialVersion || now >= failure.retryAt;
      })
      .sort((a, b) => Number(b.isCentral) - Number(a.isCentral) || a.ref.localeCompare(b.ref));
    for (const project of candidates) wanted.push({ project, restarted: false });

    // 3. the cap.
    const slots = Math.max(0, maxProjects - running.size);
    const allowed = wanted.slice(0, slots);
    capped = wanted.length - allowed.length;
    if (capped > 0) {
      log.error(
        {
          event: 'worker.supervisor.cap_reached',
          maxProjects,
          running: running.size,
          skipped: capped,
          skippedRefs: wanted.slice(slots).map((item) => item.project.ref),
        },
        'supervisor project cap reached; the remaining projects are not polled by this worker',
      );
    }

    // 4. start them, a few at a time; a failure is recorded per project and delays nobody.
    await inParallel(allowed, SUPERVISOR_START_CONCURRENCY, (item) =>
      stopped ? Promise.resolve() : startProject(item.project, item.restarted),
    );
  }

  /** One reconcile; a tick that arrives while another runs shares it instead of overlapping. */
  function tick(): Promise<void> {
    if (!current) {
      current = reconcile().finally(() => {
        current = null;
      });
    }
    return current;
  }

  async function start(): Promise<void> {
    stopped = false;
    const projectId = await deps.centralProjectId();
    platform = await launch({ scope: 'platform' }, deps.platformJobs, platformNames, projectId);
    log.info(
      { event: 'worker.supervisor.started', projectId, scope: 'platform' },
      'platform queue started',
    );
    if (deps.onPlatformStarted) {
      try {
        await deps.onPlatformStarted();
      } catch (error) {
        log.error({ err: messageOf(error) }, 'platform start hook failed; the queue keeps running');
      }
    }
    await tick();
    cancelTimer = deps.schedule(() => {
      void tick();
    }, SUPERVISOR_TICK_MS);
  }

  async function stop(): Promise<void> {
    stopped = true;
    cancelTimer?.();
    cancelTimer = null;
    await current?.catch(() => undefined);
    const ids = [...running.keys()];
    const instance = platform;
    platform = null;
    await Promise.all([
      ...ids.map((id) => stopProject(id, 'shutdown')),
      instance
        ? stopBoss(instance).then(
            () =>
              log.info(
                { event: 'worker.supervisor.stopped', scope: 'platform' },
                'platform queue stopped',
              ),
            (error: unknown) =>
              log.error({ err: messageOf(error) }, 'platform queue did not stop cleanly'),
          )
        : Promise.resolve(),
    ]);
  }

  function state(): SupervisorState {
    const now = deps.now();
    return {
      platform: platform !== null,
      projects: [...running.values()].map(({ project }) => ({
        projectId: project.id,
        ref: project.ref,
        credentialVersion: project.credentialVersion,
      })),
      backoff: [...failures].map(([projectId, failure]) => ({
        projectId,
        attempts: failure.attempts,
        retryInMs: Math.max(0, failure.retryAt - now),
      })),
      capped,
    };
  }

  return { start, stop, tick, state };
}

export type Supervisor = ReturnType<typeof createSupervisor>;
