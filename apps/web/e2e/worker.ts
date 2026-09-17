import { type ChildProcess, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Brings a `ROLE=worker` process to the e2e (02-14). The Playwright config (02-16) starts the API
 * and the web app only; icon derivation (`kernel.branding-derive-icons`, 02-13) runs off the
 * request path in the worker role, so branding specs bring their own — spawned on port 8790 with
 * the API package's dev entry (`tsx --env-file-if-exists=.env.local src/main.ts`; Node's env-file
 * never overrides `ROLE`/`PORT` passed here) or reused when a developer already runs one, like
 * `reuseExistingServer`. `GET /v1/health` answers only after `boss.start()`, so a 200 means the
 * worker really polls.
 */

const HEALTH = 'http://127.0.0.1:8790/v1/health';
/** Spawn shape of `apps/api/tests/integration/worker.test.ts`: the root tsx binary, cwd = apps/api. */
const apiRoot = fileURLToPath(new URL('../../api/', import.meta.url));
const tsx = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url));

async function workerHealthy(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH);
    if (!res.ok) return false;
    const body = (await res.json()) as { service?: string };
    return body.service === 'worker';
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForExit(child: ChildProcess, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(true);
    const timer = setTimeout(() => resolve(false), ms);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** Ensures a worker answers on 8790 and returns a `stop()` (a no-op when one was reused). */
export async function ensureWorker(): Promise<() => Promise<void>> {
  if (await workerHealthy()) return async () => {};

  const child = spawn(tsx, ['--env-file-if-exists=.env.local', 'src/main.ts'], {
    cwd: apiRoot,
    env: { ...process.env, ROLE: 'worker', PORT: '8790' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stderr: string[] = [];
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr.push(chunk.toString());
    if (stderr.length > 200) stderr.shift();
  });
  child.stdout?.on('data', () => {});

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    if (await workerHealthy()) {
      return async () => {
        child.kill('SIGTERM');
        if (!(await waitForExit(child, 10_000))) child.kill('SIGKILL');
      };
    }
    await sleep(500);
  }
  child.kill('SIGKILL');
  throw new Error(
    `worker did not answer ${HEALTH} within 90 s (exit ${child.exitCode})\n${stderr.slice(-40).join('')}`,
  );
}
