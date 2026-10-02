import { describe, expect, it } from 'vitest';

/**
 * 08-08: the client bootstrap puts Zod in `jitless` mode, so the browser never probes `new Function`
 * (a CSP `eval` violation on every page under the enforced policy). The flag lives on
 * `globalThis.__zod_globalConfig`, shared by every Zod copy.
 */
describe('instrumentation-client', () => {
  it('sets Zod jitless before any schema is built', async () => {
    await import('./instrumentation-client');
    const config = (globalThis as { __zod_globalConfig?: { jitless?: boolean } })
      .__zod_globalConfig;
    expect(config?.jitless).toBe(true);
  });
});
