import { serve } from '@hono/node-server';
import { deriveIconsJob } from '@rede-social/core/server/branding/derive-icons-job';
import { domainVerifyJob } from '@rede-social/core/server/domains/verify-job';
import {
  createBoss,
  createQueues,
  sessionConnectionString,
} from '@rede-social/core/server/jobs/boss';
import { deriveVariantsJob } from '@rede-social/core/server/media/derive-job';
import { armSweeper } from '@rede-social/core/server/media/service';
import { sweepOrphansJob } from '@rede-social/core/server/media/sweep-job';
import { mediaProviderEventJob } from '@rede-social/core/server/media/video/event-job';
import type { AnyJobDefinition } from '@rede-social/core/server/modules/manifest';
import { paymentEventJob } from '@rede-social/core/server/payments/event-job';
import { inviteSendJob } from '@rede-social/core/server/platform/invite-send-job';
import { reconcileAuthAllowList } from '@rede-social/core/server/platform/reconcile-allow-list';
import { projectBootstrapJob } from '@rede-social/core/server/projects/bootstrap-job';
import { armProjectHealth, projectHealthJob } from '@rede-social/core/server/projects/health-job';
import {
  armMigrationRetry,
  migrationRetryJob,
} from '@rede-social/core/server/projects/migration-retry-job';
import {
  armDailyTenantDispatch,
  dailyTenantDispatchJob,
} from '@rede-social/core/server/tenancy/daily-dispatch';
import {
  armMirrorReconcile,
  mirrorReconcileJob,
} from '@rede-social/core/server/tenancy/mirror-job';
import {
  centralProjectId,
  listReadyProjects,
} from '@rede-social/core/server/tenancy/project-registry';
import { ensureProjectZero } from '@rede-social/core/server/tenancy/project-zero';
import { snapshotBuildJob } from '@rede-social/module-dashboard/server';
import { Hono } from 'hono';
import { env } from './env';
import { rootLogger } from './http/logger';
import { MODULE_REGISTRY } from './modules/registry';
import { createSupervisor, type SupervisedBoss } from './worker-supervisor';

/**
 * `ROLE=worker` entry point (D-18: the SAME image as the API, a different `ROLE`; there is no
 * `apps/worker`). It owns everything long-running about pg-boss — polling, supervision, archiving —
 * so the request-serving role stays stateless and scale-to-zero friendly.
 *
 * **One consumer per ready project plus one for the platform (09.2-09, D-546).** A pg-boss instance polls
 * ONE database, so the worker no longer starts one instance: `createSupervisor` (`worker-supervisor.ts`)
 * keeps a PLATFORM instance (`pgboss_platform` of the central project: `kernel.domain-verify`,
 * `kernel.invite-send`, `platform.mirror-reconcile`, `platform.project-bootstrap`,
 * `platform.project-health`, `platform.migration-retry`) and one TENANT-scope instance per `ready` project
 * (the `pgboss` schema of that project's database: the other jobs), reconciled against the registry every
 * 60 s. A tenant job's handler receives `{ projectId }` as its second argument; the daily dispatcher and the
 * orphan sweeper use it, they run once per project. A job's `scope` (default tenant) decides which list it
 * is in. The platform instance failing to start fails the boot; a tenant project failing to start is backed
 * off alone.
 *
 * Queue creation happens at each instance's start, for every `JobDefinition` of its scope: kernel jobs are
 * listed here explicitly and register their queue names inside the kernel
 * (`packages/core/server/domains/index.ts`, `…/branding/index.ts`, `…/platform/invite-send.ts`,
 * `…/tenancy/mirror-job.ts`); module jobs come from the registry. `inviteSendJob` (`kernel.invite-send`,
 * quick 260929-g0s) sends the first-admin invite a verified domain scheduled — deferred past the Supabase
 * Auth allow-list propagation window and retried by pg-boss. Icon derivation (`deriveIconsJob`) is CPU
 * work — sharp resize/composite, ICO packing, five Storage uploads — and runs HERE, never in the
 * request-serving role (D-28). `createQueues` is idempotent, which is what makes the concurrent cases
 * safe: two worker instances booting together, or a worker booting while the API performs its first lazy
 * enqueue, all converge on the same queue row.
 *
 * The worker is deployed as a Cloud Run SERVICE (`deploy-api.yml`, `--min-instances=1
 * --no-cpu-throttling`), and a service must accept TCP connections on `PORT` during the startup
 * probe window or the revision is marked failed. So once the platform instance is up the worker binds a
 * minimal probe listener: `GET /v1/health` answers `{ ok, service: 'worker', role }` and nothing else. It is
 * bound AFTER `supervisor.start()` on purpose — a 200 means "the worker really started", not "the process
 * exists". `tests/integration/worker.test.ts` boots this branch in a fresh process and asserts it.
 *
 * The orphan sweeper (`kernel.media-sweep-orphans`, 03-08), the daily per-tenant dispatcher
 * (`kernel.daily-tenant-dispatch`, 08.7-01), the mirror reconcile (`platform.mirror-reconcile`, 09.2-09)
 * and the project health sweep (`platform.project-health`, 09.2-14, every 300 s) have NO scheduler:
 * each re-arms itself with a deferred job after every run, the `kernel.domain-verify` pattern, so the worker only has to open the cadence once. The first two are opened
 * once per project each time its instance starts (`onProjectStarted`), the other two once at boot. Every arm is
 * best-effort — a worker must boot even if the first enqueue fails, and the next successful run re-opens it.
 * At boot the worker also aligns project 0's registry row with the environment (`ensureProjectZero`), and
 * each time a project's instance starts it reconciles THAT project's auth redirect allow-list for the verified
 * hosts of its tenants (`reconcileAuthAllowList({ projectId })`, quick 261012-s0v, 09.2-11) because a
 * `supabase config push` wipes the runtime entries and a deploy always rolls a new worker revision.
 *
 * Concurrency and the pool fit (quick 261006-fs9, 09.2-09): each queue runs `job.concurrency ?? 1`
 * handlers per instance (pg-boss `localConcurrency`); only `notifications.push-send` declares one (4). A
 * push-send job holds at most ONE app-pool connection at any moment, and no other handler holds an app-pool
 * connection while acquiring a second one, so nothing holds-and-waits and the pool can only make a handler
 * wait briefly, never starve it. With a database per tenant the pools multiply: the app pool of project 0
 * is `DATABASE_POOL_MAX` (10) and every other project is a pooled connection of its own
 * (`PROJECT_POOL_MAX`, 3 per project, bounded by `PROJECT_POOL_CACHE_MAX`). On the pg-boss side each
 * project holds `max: 2` session sockets for its instance, project 0 holds two instances (platform and
 * tenant, 4 sockets), and the API-side senders add one socket per project and scope (`max: 1`). Per tenant
 * project that is about 2 session + 1 sender + up to 3 pooled = 6 sockets, which is what
 * `SUPERVISOR_MAX_PROJECTS` (default 40) bounds for one worker instance. LISTEN/NOTIFY is off and the
 * pollers' fetches (every 2 s) and completes are single short queries. Recompute docs/DEPLOY.md
 * "Connection budget (Pro)" whenever a concurrency, the pool size or the cap changes.
 */
export async function startWorker(): Promise<void> {
  const allJobs: AnyJobDefinition[] = [
    domainVerifyJob,
    inviteSendJob,
    // 09.2-09 (D-537, D-546): heals the central mirror of tenants that live in another project.
    mirrorReconcileJob,
    // 09.2-13 (D-542): drives a new tenant project through the eight bootstrap steps. A platform queue.
    projectBootstrapJob,
    // 09.2-14 (D-543): checks every ready project every 300 s and re-arms itself. A platform queue.
    projectHealthJob,
    // 09.2-15 (D-545): re-runs the migration fan-out for projects that are behind or failed, every 300 s. A platform queue.
    migrationRetryJob,
    deriveIconsJob,
    deriveVariantsJob,
    mediaProviderEventJob,
    // 09.1-07 (D-509): applies one recorded payment-gateway delivery; the queue registers in payments/index.ts.
    paymentEventJob,
    sweepOrphansJob,
    // 08.7-01 (INSIGHT-16): the kernel's daily per-tenant dispatcher (re-arms itself hourly).
    dailyTenantDispatchJob,
    // 08.7-01: the dashboard has no manifest (no ModuleKey), so its build job is listed here.
    snapshotBuildJob,
    ...Object.values(MODULE_REGISTRY).flatMap((manifest) => manifest?.jobs ?? []),
  ];
  // A platform job lives in `pgboss_platform` of the central project and is worked by ONE instance; a tenant
  // job (the default) lives in the `pgboss` schema of every project and is worked by that project's instance.
  const platformJobs = allJobs.filter((job) => job.scope === 'platform');
  const tenantJobs = allJobs.filter((job) => job.scope !== 'platform');

  /** Each step in its own try/catch: the probe below must bind whatever happens here. */
  const bestEffort = async (label: string, event: string, step: () => Promise<unknown>) => {
    try {
      rootLogger.info({ result: await step() }, event);
    } catch (err) {
      rootLogger.error({ err }, label);
    }
  };

  const supervisor = createSupervisor({
    listProjects: () => listReadyProjects(),
    // Session-mode connection in production (A6): the worker polls continuously, the API does not. Project 0
    // reads it from the environment, any other project from its sealed `database_url_session`.
    makeBoss: (target) =>
      createBoss(
        target.scope === 'platform'
          ? {
              connectionString: env.BOSS_DATABASE_URL ?? env.DATABASE_URL,
              max: 2,
              scope: 'platform',
            }
          : {
              connectionString: sessionConnectionString(
                target.project,
                env.BOSS_DATABASE_URL ?? env.DATABASE_URL,
              ),
              max: 2,
              scope: 'tenant',
            },
      ) as unknown as SupervisedBoss,
    createQueues: (boss, names) => createQueues(boss as never, names),
    centralProjectId: () => centralProjectId(),
    platformJobs,
    tenantJobs,
    maxProjects: env.SUPERVISOR_MAX_PROJECTS,
    now: () => Date.now(),
    schedule: (fn, ms) => {
      const timer = setInterval(fn, ms);
      return () => clearInterval(timer);
    },
    random: Math.random,
    log: rootLogger,
    // The central boot extras, after the platform instance is up.
    onPlatformStarted: async () => {
      // Production's central row keeps the placeholder coordinates until this (or the migrate command) runs.
      await bestEffort(
        'could not align project 0 with the environment',
        'projects.zero.ensured',
        () => ensureProjectZero(),
      );
      // 09.2-09 (D-537): open the mirror reconcile cadence under the BOOT singleton.
      await bestEffort(
        'could not arm the mirror reconcile; the next boot re-opens it',
        'platform.mirror_reconcile.armed',
        () => armMirrorReconcile(),
      );
      // 09.2-14 (D-543): open the project health cadence under the BOOT singleton.
      await bestEffort(
        'could not arm the project health; the next boot re-opens it',
        'platform.project_health.armed',
        () => armProjectHealth(),
      );
      // 09.2-15 (D-545): open the migration retry cadence under the BOOT singleton.
      await bestEffort(
        'could not arm the migration retry; the next boot re-opens it',
        'platform.migration_retry.armed',
        () => armMigrationRetry(),
      );
    },
    // The per-project cadences, once per project each time its instance (re)starts.
    onProjectStarted: async (project) => {
      // quick 261012-s0v, 09.2-11 (DBT-42): self-heal the project's own redirect allow-list (a `supabase config
      // push` wipes project 0's runtime entries and every deploy rolls a worker revision). One project at a
      // time, best-effort: a project whose Management API is down counts failed and never blocks the rest.
      await bestEffort(
        'allow-list reconcile failed; "Verificar agora" re-adds a host by hand',
        'domains.allow_list.reconciled',
        async () => {
          const { projects, ...totals } = await reconcileAuthAllowList({ projectId: project.id });
          return { projectId: project.id, ...totals };
        },
      );
      await bestEffort(
        'could not arm the media orphan sweeper; the next run re-opens it',
        'media.sweep.armed',
        async () => ({ projectId: project.id, armed: await armSweeper({ projectId: project.id }) }),
      );
      // 08.7-01 (D-464, INSIGHT-16): open the daily per-tenant cadence (the dashboard's nightly build)
      // with one immediate dispatch under the BOOT singleton, so a pending hourly re-arm never swallows
      // it and a new revision rebuilds every tenant within minutes.
      await bestEffort(
        'could not arm the daily tenant dispatch; the next boot re-opens it',
        'dashboard.dispatch.armed',
        async () => ({
          projectId: project.id,
          armed: await armDailyTenantDispatch({ projectId: project.id }),
        }),
      );
    },
  });

  // The platform instance failing to start fails the boot (the revision is marked failed and retried); a
  // tenant project failing to start only backs that project off.
  await supervisor.start();

  const probe = new Hono().get('/v1/health', (c) =>
    c.json({ ok: true, service: 'worker', role: env.ROLE }, 200),
  );
  const server = serve({ fetch: probe.fetch, port: env.PORT }, (info) => {
    rootLogger.info(
      {
        port: info.port,
        platformQueues: platformJobs.map((job) => job.name),
        queues: tenantJobs.map((job) => job.name),
        concurrency: Object.fromEntries(allJobs.map((job) => [job.name, job.concurrency ?? 1])),
        projects: supervisor.state().projects.map((project) => project.ref),
        role: env.ROLE,
      },
      'worker.started',
    );
  });

  // Cloud Run sends SIGTERM before shutdown: stop answering probes, finish in-flight jobs, then exit.
  process.on('SIGTERM', () => {
    rootLogger.info('SIGTERM received, stopping worker');
    server.close();
    supervisor
      .stop()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        rootLogger.error({ err }, 'error while stopping worker');
        process.exit(1);
      });
  });
}
