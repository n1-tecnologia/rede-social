import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The database case, against the seeded LOCAL stack. It reads the same `apps/api/.env.local` that
 * `scripts/local-env.sh` writes for the API integration suite (CI passes the same variables through
 * the process environment, which wins), so the fixture needs no env file of its own.
 *
 * Not merged with `vitestBase` on purpose: `mergeConfig` CONCATENATES `include` arrays, which would
 * pull the no-database file into this run too.
 */
function readApiEnvFile(): Record<string, string> {
  const file = fileURLToPath(new URL('../../apps/api/.env.local', import.meta.url));
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
  'TENANT_DEMO_HOST',
] as const;

const fromProcess: Record<string, string> = {};
for (const key of KEYS) {
  const value = process.env[key];
  if (value) fromProcess[key] = value;
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.integration.test.ts'],
    env: {
      ...readApiEnvFile(),
      ...fromProcess,
      // The API suite's rule: no automated run may reach a real video vendor or push service.
      VIDEO_PROVIDER: 'fake',
      PUSH_TRANSPORT: 'fake',
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
