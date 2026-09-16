import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';

/**
 * In-process API listener for the integration suite (plan 02-06).
 *
 * `supabase/config.toml` enables `[auth.hook.send_email]` pointing at
 * `http://host.docker.internal:8787/v1/hooks/auth/send-email`, and GoTrue FAILS the auth request
 * when its hook is unreachable. Every integration case that makes GoTrue send mail —
 * `inviteUserByEmail` in platform-tenants.test.ts, `resetPasswordForEmail` in
 * send-email-hook.test.ts — therefore needs an API listening on 8787 while `pnpm test:integration`
 * runs. This global setup serves the same `app` the tests exercise in-process, bound on all
 * interfaces (the auth container reaches the host through `host.docker.internal`, which on Linux
 * runners arrives from the docker bridge, not loopback).
 *
 * When something already listens on 8787 (`pnpm --filter @tria/api dev`, the Playwright web server)
 * that instance is reused: it reads the same `.env.local`, so it answers the hook identically.
 *
 * Vitest runs this file in the main process, where `test.env` is not applied — the env file is
 * loaded here explicitly (exported variables win, like everywhere else in the tooling).
 */

const PORT = Number(process.env.PORT ?? 8787);

let server: Server | null = null;

export async function setup(): Promise<void> {
  const envFile = fileURLToPath(new URL('../../.env.local', import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const { serve } = await import('@hono/node-server');
  const { app } = await import('../../src/app');

  await new Promise<void>((resolve, reject) => {
    const started = serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, () => {
      server = started as Server;
      console.info(`[integration] API listening on 0.0.0.0:${PORT} for GoTrue hook calls`);
      resolve();
    }) as Server;
    started.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.info(
          `[integration] reusing the API already listening on ${PORT} (pnpm --filter @tria/api dev)`,
        );
        resolve();
        return;
      }
      reject(err);
    });
  });
}

export async function teardown(): Promise<void> {
  if (server) {
    const listener = server;
    server = null;
    listener.closeAllConnections?.();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
  // The in-process app opened the kernel's postgres pool; release it so the runner can exit.
  const { sqlClient } = await import('@tria/core/db');
  await sqlClient.end({ timeout: 5 }).catch(() => undefined);
}
