/**
 * Phase 09.4-11 (D-566 journey 3, D-567, D-568, CTK-03, CTK-04): tell the platform that a project now lives in
 * the customer's Supabase account, with a token scoped to that project, WITHOUT copying anything.
 *
 *   pnpm platform:set-owner --tenant <slug> [--expires <YYYY-MM-DD>] [--actor <label>] [--dry-run]
 *
 *   --tenant <slug>        the tenant whose project Supabase transferred to the customer (lowercase letters,
 *                          digits and hyphens). Run on a project that is ALREADY the customer's, the same
 *                          command re-pins: it reads the organisation again with the new token and stores the
 *                          new pin (the only way to accept a legitimate organisation change, D-568).
 *   --expires <YYYY-MM-DD> the day the customer's token expires, typed by the operator (after today, at most a
 *                          year ahead); omitted means "no expiry recorded"
 *   --actor <label>        who is acting, recorded in the audit trail (default `cli`)
 *   --dry-run              validate exactly as the real run (it still asks for the token) and write NOTHING
 *
 * The token is typed at a HIDDEN prompt and nowhere else: there is no token flag, no environment variable and
 * no piped stdin, so it never reaches the shell history, the process list or a log (D-567). The prompt comes
 * after the arguments and the tenant are checked: an unknown tenant, a tenant on the central project and a
 * tenant with an open move are refused before the operator types anything.
 *
 * Direction: only platform to customer (and the re-pin) exists. Customer to platform is deliberately not a flag:
 * a project still in the customer's account is unreachable with the platform token, so flipping the owner back
 * would leave a project nobody can manage; the way back is a move with a platform target.
 *
 * Exit codes: 0 done; 1 refused (the closed code is printed); 2 usage (also a stdin that is not a terminal,
 * before any request); 130 aborted at the prompt. Output is ONE JSON line of ids, the event kind and closed
 * codes: never a token, a prefix, a length, an organisation slug or a project ref.
 *
 * It is tried first with a FAKE token against the fake provider (`PROJECT_PROVIDER=fake`, a made-up `sbp_fc_...`
 * string typed at the prompt). Real tokens are typed by the operator, never by an agent.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSecret } from './lib/read-secret';

export type SetOwnerDeps = {
  /** The hidden prompt; the command's only way to receive a token. */
  readSecret: (label: string) => Promise<string>;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Test seam: the follow-up after the commit (default: a best-effort health check of the project). */
  afterChange?: (projectId: string) => unknown;
};

export type SetOwnerArgs =
  | {
      tenant: string;
      expires: string | null;
      actor: string;
      dryRun: boolean;
    }
  | { error: string };

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ACTOR = /^[A-Za-z0-9:_@.-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const USAGE =
  'usage: pnpm platform:set-owner --tenant <slug> [--expires <YYYY-MM-DD>] [--actor <label>] [--dry-run]';

/** Flags that take a value. A token can never be one of them: any other flag is an unknown argument. */
const VALUE_FLAGS = new Set(['--tenant', '--expires', '--actor']);

/**
 * Strict, hand-rolled: `--flag value` or `--flag=value`, `--` filtered, an unknown flag, a positional argument,
 * a repeated flag or a bad shape is an error. The message names the problem, never an argument's value.
 */
export function parseSetOwnerArgs(argv: readonly string[]): SetOwnerArgs {
  const args = argv.filter((arg) => arg !== '--');
  const values = new Map<string, string>();
  let dryRun = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    const eq = arg.indexOf('=');
    const flag = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg;
    if (flag === '--dry-run' && eq < 0) {
      if (dryRun) return { error: 'repeated argument' };
      dryRun = true;
    } else if (VALUE_FLAGS.has(flag)) {
      if (values.has(flag)) return { error: 'repeated argument' };
      let value: string | undefined;
      if (eq > 0) {
        value = arg.slice(eq + 1);
      } else {
        value = args[i + 1];
        i += 1;
      }
      if (value === undefined || value.startsWith('--')) return { error: 'missing value' };
      values.set(flag, value);
    } else {
      return { error: 'unknown argument' };
    }
  }

  const tenant = values.get('--tenant');
  if (tenant === undefined) return { error: 'a tenant is required' };
  if (!SLUG.test(tenant)) return { error: 'the tenant slug has an invalid shape' };
  const expires = values.get('--expires') ?? null;
  if (expires !== null && !DAY.test(expires)) return { error: 'the expiry must be YYYY-MM-DD' };
  const actor = values.get('--actor') ?? 'cli';
  if (!ACTOR.test(actor)) return { error: 'the actor label has an invalid shape' };
  return { tenant, expires, actor, dryRun };
}

const PROMPT = 'Cole o token do projeto e aperte Enter. Nada aparece na tela: ';

/** Whether the closed error is one the prompt raises; matched by name so a second module copy cannot hide it. */
const nameOf = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error === 'string' ? error : '';

/**
 * The command, with its terminal and output injected so a test drives it without a terminal. Returns the exit
 * code. Order is fixed: arguments, then the database facts, then the prompt, then the kernel.
 */
export async function main(
  argv: readonly string[],
  deps: Partial<SetOwnerDeps> = {},
): Promise<number> {
  const prompt = deps.readSecret ?? readSecret;
  const out = deps.out ?? ((line: string) => console.log(line));
  const err = deps.err ?? ((line: string) => console.error(line));

  const parsed = parseSetOwnerArgs(argv);
  if ('error' in parsed) {
    err(`platform:set-owner: ${parsed.error}`);
    err(USAGE);
    return 2;
  }

  const { findOwnerTarget, OwnerChangeError, setProjectOwner, TokenRefusal } = await import(
    '@rede-social/core/server/projects/token'
  );
  const refused = (code: string): number => {
    out(JSON.stringify({ kind: 'refused', code }));
    return 1;
  };
  try {
    // The database facts first: a bad target costs the operator nothing.
    await findOwnerTarget(parsed.tenant);

    let token: string;
    try {
      token = await prompt(PROMPT);
    } catch (error) {
      if (nameOf(error) === 'NoTerminalError') {
        err(
          'platform:set-owner: the token is typed at a hidden prompt, so stdin must be a terminal',
        );
        err(USAGE);
        return 2;
      }
      if (nameOf(error) === 'SecretAbortError') return 130;
      throw error;
    }

    const result = await setProjectOwner({
      tenantSlug: parsed.tenant,
      token,
      expiresAt: parsed.expires,
      actor: parsed.actor,
      dryRun: parsed.dryRun,
      ...(deps.afterChange === undefined ? {} : { afterChange: deps.afterChange }),
    });
    out(
      JSON.stringify({
        kind: result.repinned ? 'repinned' : 'owner_changed',
        projectId: result.projectId,
        repinned: result.repinned,
        dryRun: result.dryRun,
      }),
    );
    return 0;
  } catch (error) {
    if (error instanceof TokenRefusal || error instanceof OwnerChangeError) {
      return refused(error.code);
    }
    throw error;
  }
}

/** The command entry: loads the local stack values before any kernel module reads env, then runs `main`. */
async function runAsCommand(): Promise<number> {
  // Same skeleton as scripts/reissue-credentials.ts.
  const envFile = resolve(process.cwd(), 'apps/api/.env.local');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  try {
    return await main(process.argv.slice(2));
  } finally {
    const { sqlClient } = await import('@rede-social/core/db');
    await sqlClient.end({ timeout: 5 });
  }
}

// Run only as a command; importing this file (the integration test does) executes nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runAsCommand()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      // Content-free: a connection string or a sealed value may sit in a driver error.
      console.error('platform:set-owner failed');
      process.exit(1);
    });
}
