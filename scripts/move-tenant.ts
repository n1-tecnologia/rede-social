/**
 * The operator's tenant-move tool (Phase 09.2-23, D-535, D-536): the same function the `ROLE=move` process runs
 * in the API image.
 *
 *   pnpm platform:move-tenant -- --tenant <slug> --to <ref> --dry-run     # the plan; writes NOTHING
 *   pnpm platform:move-tenant -- --tenant <slug> --to <ref>               # suspend, copy, verify, repoint
 *   pnpm platform:move-tenant -- --tenant <slug> --resume                 # continue from the recorded state
 *   pnpm platform:move-tenant -- --tenant <slug> --status                 # the move and its trail (read only)
 *   pnpm platform:move-tenant -- --tenant <slug> --rollback [--accept-loss]
 *   pnpm platform:move-tenant -- --tenant <slug> --recopy
 *   pnpm platform:move-tenant -- --tenant <slug> --confirm-delete --confirm-slug <slug>
 *
 * Flags and exit codes (0 ok, 1 a MoveError, 2 usage) are documented in `apps/api/src/move.ts`. The project
 * provider is the env-selected one (`PROJECT_PROVIDER`, `fake` locally); a hosted move is Igor's step in
 * plan 25 and is never run by an agent. Nothing here prints a row, an e-mail, a key or a connection string.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Same skeleton as scripts/seed.ts: load the local stack values before any kernel module reads env.
const envFile = resolve(process.cwd(), 'apps/api/.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { runMoveCli } = await import('../apps/api/src/move');

const code = await runMoveCli(process.argv.slice(2).filter((arg) => arg !== '--'));
process.exit(code);
