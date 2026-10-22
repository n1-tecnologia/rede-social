/**
 * Apply ONE migration set to ONE Postgres (Phase 09.2-02, DBT-22, DBT-32, D-547).
 *
 *   pnpm exec tsx scripts/migrate-set.ts --set tenant  --url <postgres url>
 *   pnpm exec tsx scripts/migrate-set.ts --set central               # pnpm db:central
 *
 * Flags: `--set tenant|central` (required), `--url` (default `MIGRATION_DATABASE_URL`, else the local
 * stack's `postgres` URL), `--dir` (default the set's repo directory; the bootstrap Job passes its own),
 * `--dry-run` (list what would be applied, change nothing), `--include-all` (apply a pending file whose
 * version is below the applied head, like the CLI's own flag).
 *
 * Output: one JSON line per file `{ set, version, status }`, then one summary line. Exit 1 on any
 * `MigrationError` or failed file. The connection must be the `postgres` role on a session-mode endpoint.
 * Nothing here logs SQL text or a connection string.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

// Same skeleton as scripts/seed.ts: load the local stack values before any kernel module reads env.
const envFile = resolve(process.cwd(), 'apps/api/.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const LOCAL_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres';

const { values } = parseArgs({
  options: {
    set: { type: 'string' },
    url: { type: 'string' },
    dir: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'include-all': { type: 'boolean', default: false },
  },
});

if (values.set !== 'tenant' && values.set !== 'central') {
  console.error(
    'usage: migrate-set.ts --set tenant|central [--url <url>] [--dir <path>] [--dry-run] [--include-all]',
  );
  process.exit(2);
}
const set = values.set;

const { default: postgres } = await import('postgres');
const { applyDirectory, MigrationError } = await import(
  '@rede-social/core/server/migrations/runner'
);
const { defaultMigrationDir, readMigrationDir } = await import(
  '@rede-social/core/server/migrations/sets'
);

const url = values.url ?? process.env.MIGRATION_DATABASE_URL ?? LOCAL_URL;
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });

let exitCode = 0;
try {
  const files = await readMigrationDir(values.dir ?? defaultMigrationDir(set), set);
  const result = await applyDirectory(sql, files, {
    set,
    dryRun: values['dry-run'],
    includeAll: values['include-all'],
    onFile: (event) => console.log(JSON.stringify(event)),
  });
  console.log(
    JSON.stringify({
      summary: true,
      set,
      dryRun: values['dry-run'],
      applied: result.applied.length,
      skipped: result.skipped,
      pending: result.pending.length,
      ...(result.failedVersion
        ? {
            failedVersion: result.failedVersion,
            errorCode: result.errorCode,
            sqlstate: result.sqlstate,
          }
        : {}),
    }),
  );
  if (result.errorCode) exitCode = 1;
} catch (error) {
  if (error instanceof MigrationError) {
    console.error(
      JSON.stringify({ summary: true, set, errorCode: error.code, version: error.version }),
    );
  } else {
    // Never print the driver error whole: it may carry a statement or a value.
    console.error(
      JSON.stringify({ summary: true, set, errorCode: 'unexpected', name: (error as Error).name }),
    );
  }
  exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
process.exit(exitCode);
