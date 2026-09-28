import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { vitestBase } from '@rede-social/config/vitest.base';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * Minimal `.env.local` reader (no dotenv dependency). `scripts/local-env.sh` generates the file
 * from `supabase status`; CI passes the same variables through the process environment.
 */
function readEnvFile(): Record<string, string> {
  const file = fileURLToPath(new URL('.env.local', import.meta.url));
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const KEYS = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'SEED_PASSWORD',
  'SUPER_ADMIN_EMAIL',
  'SUPER_ADMIN_PASSWORD',
  'TENANT_DEMO_HOST',
  'TENANT_LAB_HOST',
  'PLATFORM_HOST',
  'SEND_EMAIL_HOOK_SECRETS',
  'MAIL_TRANSPORT',
  'MAIL_DOMAIN',
  'MAILPIT_URL',
] as const;

/** Placeholders keep the unit suite hermetic; integration tests need the real local values. */
const defaults: Record<string, string> = {
  // Direct port: the local Supavisor refuses api_user (see scripts/local-env.sh); hosted uses the pooler.
  DATABASE_URL: 'postgres://api_user:postgres@127.0.0.1:54322/postgres',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_KEY: 'local-placeholder',
  SUPABASE_PUBLISHABLE_KEY: 'local-placeholder',
};

const fromProcess: Record<string, string> = {};
for (const key of KEYS) {
  const value = process.env[key];
  if (value) fromProcess[key] = value;
}

/**
 * The integration suite needs an API listening on 8787 for GoTrue's Send Email Hook
 * (tests/integration/global-setup.ts). The unit script (`vitest run tests/unit`) shares this config
 * and must stay hermetic — no listener, no database — so the setup is attached only when the
 * integration directory is on the command line.
 */
const integrationRun = process.argv.some((arg) => arg.includes('tests/integration'));

export default mergeConfig(
  vitestBase,
  defineConfig({
    test: {
      include: ['tests/**/*.test.ts'],
      env: {
        ...defaults,
        ...readEnvFile(),
        ...fromProcess,
        // LAST, on purpose (05.1 Wave 0, RESEARCH Pitfall 2): a developer's `.env.local` may carry
        // `VIDEO_PROVIDER=mux` with real vendor credentials, and `readEnvFile()` above copies every
        // key it finds. Vitest's `test.env` beats an exported variable too (probed in RESEARCH), so
        // this entry is what guarantees no automated test ever reaches a real video vendor. It is
        // deliberately NOT in `KEYS`: no run of this suite wants anything but the fake.
        VIDEO_PROVIDER: 'fake',
      },
      globalSetup: integrationRun ? ['tests/integration/global-setup.ts'] : [],
      fileParallelism: false,
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  }),
);
