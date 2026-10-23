/**
 * The fan-out of the migrations to every tenant project (Phase 09.2-15, D-544): the same function the
 * `ROLE=migrate` process runs in the API image.
 *
 *   pnpm db:migrate-all                      # central set, then the tenant set on every ready project
 *   pnpm db:migrate-all -- --dry-run         # list the pending versions, write nothing
 *   pnpm db:migrate-all -- --tenant demo     # one tenant's project
 *
 * Flags: `--dry-run`, `--tenant <slug>`, `--project <ref>`, `--concurrency <n>`, `--strict`, `--central-only`.
 * Exit: 0 ok, 1 central failure or `--strict` with a tenant failure, 2 usage. The central project is reached
 * with `MIGRATION_DATABASE_URL` (default the local stack's `postgres` URL). Nothing here prints a connection
 * string.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Same skeleton as scripts/seed.ts: load the local stack values before any kernel module reads env.
const envFile = resolve(process.cwd(), 'apps/api/.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { runMigrateAll } = await import('../apps/api/src/migrate');

const code = await runMigrateAll(process.argv.slice(2).filter((arg) => arg !== '--'));
process.exit(code);
