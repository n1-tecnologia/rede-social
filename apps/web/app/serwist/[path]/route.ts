import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createSerwistRoute } from '@serwist/turbopack';

/**
 * Builds and serves the service worker (`/serwist/sw.js` + source map) from `app/sw.ts` with the
 * native esbuild (PWA-01, CLAUDE.md PWA §1 — `@serwist/turbopack`, never `next-pwa`). The route is
 * `force-static`: the worker is bundled once at `next build` with the precache manifest injected.
 *
 * `/~offline` is precached with a PER-BUILD revision so the offline page refreshes on every deploy:
 * the Vercel commit SHA when present, the local git HEAD otherwise, a random id as the last resort
 * (a stable-but-wrong revision would pin a stale offline page forever). In development the library
 * forces `additionalPrecacheEntries` to `[]`, so the offline fallback is only testable on a
 * production build (`pnpm --filter @tria/web e2e:pwa`).
 *
 * `Cache-Control: no-store` + `nosniff` for `/serwist/*` come from `next.config.ts` `headers()`;
 * the library adds `Service-Worker-Allowed: /` and the JavaScript content type (T-02-75).
 */
function buildRevision(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim();
  return head || randomUUID();
}

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute(
  {
    swSrc: 'app/sw.ts',
    useNativeEsbuild: true,
    additionalPrecacheEntries: [{ url: '/~offline', revision: buildRevision() }],
  },
);
