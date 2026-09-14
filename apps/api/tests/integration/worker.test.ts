import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `ROLE=worker` smoke (CR-01 of the phase-1 review). The worker is deployed as a Cloud Run SERVICE,
 * so the property Cloud Run's startup probe checks — "the container listens on `PORT`" — must be
 * proven the same way the API's DB-free boot is: in a FRESH process running the real entry point
 * (`src/main.ts`), not by calling a function in-process.
 *
 *   1. boot `ROLE=worker PORT=<free port>` through tsx against the live local stack
 *   2. `GET /v1/health` on that port answers 200 `{ ok: true, service: 'worker' }`
 *   3. SIGTERM closes the probe listener, stops pg-boss and exits 0
 */

const apiRoot = fileURLToPath(new URL('../../', import.meta.url));
const tsx = fileURLToPath(new URL('../../../../node_modules/.bin/tsx', import.meta.url));

type Health = { ok: boolean; service: string; role: string };

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port: number, deadlineMs: number): Promise<Response> {
  const deadline = Date.now() + deadlineMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      return await fetch(`http://127.0.0.1:${port}/v1/health`);
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`worker never answered on port ${port}: ${String(lastError)}`);
}

function exited(child: ChildProcess): Promise<{ code: number | null; signal: string | null }> {
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

describe('ROLE=worker — Cloud Run service contract', () => {
  it('listens on PORT once pg-boss is up, answers the probe, and exits 0 on SIGTERM', async () => {
    const port = await freePort();
    const child = spawn(tsx, ['src/main.ts'], {
      cwd: apiRoot,
      env: { ...process.env, ROLE: 'worker', PORT: String(port), LOG_LEVEL: 'fatal' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const done = exited(child);

    try {
      const res = await waitForHealth(port, 30_000);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Health;
      expect(body).toMatchObject({ ok: true, service: 'worker', role: 'worker' });

      // Anything else on the probe listener is a 404: the worker serves no API.
      const other = await fetch(`http://127.0.0.1:${port}/v1/me/bootstrap`);
      expect(other.status).toBe(404);
    } catch (err) {
      child.kill('SIGKILL');
      throw new Error(`${String(err)}\nworker stderr:\n${stderr}`);
    }

    child.kill('SIGTERM');
    const result = await Promise.race([
      done,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`worker did not exit after SIGTERM\n${stderr}`)), 30_000),
      ),
    ]);
    expect(result.code).toBe(0);
  }, 90_000);
});
