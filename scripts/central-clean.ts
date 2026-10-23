/**
 * Proves the CENTRAL project holds platform data only once tenants have moved out (Phase 09.2-23, D-534,
 * DBT-49, T-09.2-108).
 *
 *   pnpm platform:central-clean                  # residue of the tenants that moved: rows, accounts, files
 *   pnpm platform:central-clean -- --strict-empty  # also: no table other than the mirror and platform tables
 *                                                # may hold a row (the state after the LAST move, checked by
 *                                                # the production runbook before clearing `is_default`)
 *
 * Output: JSON lines made of table names and counts, tables in ascending name, so two runs over the same
 * state print the same bytes. Exit: 0 clean, 1 residue, 2 usage. Read only; the central project is reached
 * with `MIGRATION_DATABASE_URL` (default the local stack's `postgres` URL). Nothing here prints a row, an
 * e-mail or a connection string.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Same skeleton as scripts/seed.ts: load the local stack values before any kernel module reads env.
const envFile = resolve(process.cwd(), 'apps/api/.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const known = new Set(['--strict-empty']);
const unknown = args.filter((arg) => !known.has(arg));
if (unknown.length > 0) {
  console.error(JSON.stringify({ kind: 'usage', message: 'the only flag is --strict-empty' }));
  process.exit(2);
}

const { centralResidue } = await import('@rede-social/core/server/projects/move/index');

const result = await centralResidue({ strictEmpty: args.includes('--strict-empty') });
for (const line of result.lines) console.log(JSON.stringify(line));
process.exit(result.exitCode);
