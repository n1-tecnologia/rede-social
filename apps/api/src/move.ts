import { parseArgs } from 'node:util';
import {
  MoveError,
  type MoveLine,
  type MoveMode,
  runMove,
} from '@rede-social/core/server/projects/move/index';
import { env } from './env';

/**
 * `ROLE=move` (09.2-23, D-535, D-536, DBT-34): the operator's move tool as a process role of the API image, run
 * by Igor as a one-off Cloud Run Job execution (plan 25) and locally by `pnpm platform:move-tenant`. It binds
 * no listener and returns an exit code; the caller (`main.ts`, or the local move wrapper under the repo scripts folder) exits with it.
 *
 *   --tenant <slug>        the tenant to move (lowercase letters, digits and hyphens)
 *   --to <ref>             the target project's ref (start, --dry-run)
 *   --dry-run              print the plan and write NOTHING (no move row, no registration, no suspension)
 *   --resume               continue an interrupted move from its recorded state
 *   --rollback             undo the move (valid before `done`, and after it until the source is deleted)
 *   --accept-loss          with --rollback: accept losing the rows written in the target since the cutover
 *   --recopy               wipe the target's rows of the tenant and copy again (a failed verification)
 *   --confirm-delete       THE ONLY way anything leaves the source project; needs --confirm-slug
 *   --confirm-slug <slug>  the tenant's slug typed again (must equal --tenant)
 *   --status               print the move and its trail; read only
 *   --actor <label>        who is acting, recorded on the move (default `cli`)
 *   --owner <platform|customer>  whose project the target is (start and --dry-run only). Absent: the registry
 *                          decides for a known target and `platform` is assumed for a new one. `customer`
 *                          on a ref the registry does not know registers it, asking for the token at the
 *                          hidden prompt of the LOCAL wrapper; the Job has no terminal and answers
 *                          `register_first` (register it ahead with `pnpm platform:set-owner --register`)
 *   --expires <YYYY-MM-DD> with `--owner customer`: the date the typed token stops working (optional)
 *
 * Exactly one mode at a time; no mode flag at all starts a new move. The waits come from `MOVE_QUIESCE_MS`
 * (default 65,000) and `MOVE_REGISTRY_WAIT_MS` (default 20,000).
 *
 * Exit 0 the move or mode succeeded, 1 a `MoveError` (the code is printed), 2 a usage error. Every line
 * printed is one JSON object of ids, states, counts, table names and codes: never a row, an e-mail, a hash, a
 * key or a connection string.
 */

const SLUG = /^[a-z0-9-]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MODE_FLAGS = ['dry-run', 'resume', 'rollback', 'recopy', 'confirm-delete', 'status'] as const;

const usageLine = (message: string) => JSON.stringify({ kind: 'usage', message });

export type MoveCliDeps = {
  /** The hidden prompt, injected by the local wrapper only (09.4-12, D-567). The Job passes nothing. */
  readSecret?: ((label: string) => Promise<string>) | undefined;
};

export async function runMoveCli(argv: string[], deps: MoveCliDeps = {}): Promise<number> {
  let values: {
    tenant?: string;
    to?: string;
    'dry-run'?: boolean;
    resume?: boolean;
    rollback?: boolean;
    'accept-loss'?: boolean;
    recopy?: boolean;
    'confirm-delete'?: boolean;
    'confirm-slug'?: string;
    status?: boolean;
    actor?: string;
    owner?: string;
    expires?: string;
  };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        tenant: { type: 'string' },
        to: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        resume: { type: 'boolean', default: false },
        rollback: { type: 'boolean', default: false },
        'accept-loss': { type: 'boolean', default: false },
        recopy: { type: 'boolean', default: false },
        'confirm-delete': { type: 'boolean', default: false },
        'confirm-slug': { type: 'string' },
        status: { type: 'boolean', default: false },
        actor: { type: 'string' },
        owner: { type: 'string' },
        expires: { type: 'string' },
      },
      strict: true,
    }));
  } catch {
    console.error(usageLine('unknown or malformed flag; see the header of apps/api/src/move.ts'));
    return 2;
  }

  // Validated before any query (a violation is a usage error, nothing is read or written).
  if (values.tenant === undefined || !SLUG.test(values.tenant)) {
    console.error(usageLine('--tenant must be a slug of lowercase letters, digits and hyphens'));
    return 2;
  }
  const chosen = MODE_FLAGS.filter((flag) => values[flag] === true);
  if (chosen.length > 1) {
    console.error(usageLine(`one mode at a time (got ${chosen.join(', ')})`));
    return 2;
  }
  if (values['accept-loss'] && !values.rollback) {
    console.error(usageLine('--accept-loss belongs to --rollback'));
    return 2;
  }
  if (values['confirm-slug'] !== undefined && !values['confirm-delete']) {
    console.error(usageLine('--confirm-slug belongs to --confirm-delete'));
    return 2;
  }
  if (values['confirm-delete'] && values['confirm-slug'] === undefined) {
    console.error(usageLine('--confirm-delete needs --confirm-slug <slug>'));
    return 2;
  }
  const mode: MoveMode = (chosen[0] as MoveMode | undefined) ?? 'start';
  if ((mode === 'start' || mode === 'dry-run') && values.to === undefined) {
    console.error(usageLine('--to <ref> is required to start a move or to plan one'));
    return 2;
  }

  // The target's owner and the typed expiry belong to a start (or its plan), and only a customer has an expiry.
  if (values.owner !== undefined && values.owner !== 'platform' && values.owner !== 'customer') {
    console.error(usageLine('--owner must be platform or customer'));
    return 2;
  }
  if (values.owner !== undefined && mode !== 'start' && mode !== 'dry-run') {
    console.error(usageLine('--owner belongs to a start or a --dry-run'));
    return 2;
  }
  if (values.expires !== undefined && values.owner !== 'customer') {
    console.error(usageLine('--expires belongs to --owner customer'));
    return 2;
  }
  if (values.expires !== undefined && !DATE.test(values.expires)) {
    console.error(usageLine('--expires must be a date as YYYY-MM-DD'));
    return 2;
  }
  const owner =
    values.owner === 'platform' || values.owner === 'customer' ? values.owner : undefined;

  // The token is asked for ONLY by a real start on a customer target, and only through the prompt the local
  // wrapper hands in. No argument, environment variable or Job parameter can carry it (T-09.4-43).
  const prompt = deps.readSecret;
  const readToken =
    mode === 'start' && owner === 'customer' && prompt
      ? () => prompt('Token de acesso do projeto (sbp_fc...): ')
      : undefined;

  const emit = (line: MoveLine) => console.log(JSON.stringify(line));
  try {
    await runMove(
      {
        mode,
        tenantSlug: values.tenant,
        toRef: values.to,
        actor: values.actor ?? 'cli',
        quiesceMs: env.MOVE_QUIESCE_MS,
        registryWaitMs: env.MOVE_REGISTRY_WAIT_MS,
        acceptLoss: values['accept-loss'] === true,
        confirmSlug: values['confirm-slug'],
        owner,
        tokenExpiresAt: values.expires ?? null,
      },
      { emit, ...(readToken ? { target: { readToken } } : {}) },
    );
    return 0;
  } catch (error) {
    // A code, and the names of the tables it is about: never a driver message.
    if (error instanceof MoveError) {
      console.error(JSON.stringify({ kind: 'error', code: error.code, tables: [...error.tables] }));
      if (error.code === 'target_not_ready' && error.tables.includes('register_first')) {
        console.error(
          usageLine(
            'register the customer project first: pnpm platform:set-owner --register --ref <ref>',
          ),
        );
      }
      return error.code === 'usage' ? 2 : 1;
    }
    console.error(JSON.stringify({ kind: 'error', code: 'unknown' }));
    return 1;
  }
}
