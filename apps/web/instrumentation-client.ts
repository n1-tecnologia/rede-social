import { z } from 'zod';

/**
 * Runs before the app's client code (Next's `instrumentation-client` convention), so it precedes
 * every Zod schema the browser bundle builds.
 *
 * 08-08 (D-346): Zod 4 compiles object parsers with `new Function` when the runtime allows it, and
 * decides that by PROBING `new Function("")` the first time an object schema is built. Under the
 * enforced Content Security Policy (`script-src` has no `'unsafe-eval'` in production) the probe is
 * blocked and fires a `securitypolicyviolation` on every page; under report-only it succeeds and
 * files a report on every page. `jitless` makes Zod skip both the probe and the compiled parsers
 * (it already falls back to them whenever eval is unavailable), so the browser never asks for eval.
 * The config is shared through `globalThis.__zod_globalConfig`, so it covers every Zod copy in the
 * bundle. The server keeps the JIT: it has no CSP.
 */
z.config({ jitless: true });
