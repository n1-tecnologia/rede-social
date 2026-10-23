/**
 * Break-glass: re-derive a tenant project's whole credential set from the platform token alone (Phase 09.2-14,
 * DBT-47, D-539). For the day `PLATFORM_MASTER_KEYS` is lost or leaked and the sealed registry columns can no
 * longer be opened.
 *
 *   pnpm platform:reissue-credentials -- --ref <project ref>
 *
 * Recovery, in order:
 *   1. generate a NEW master key and set `PLATFORM_MASTER_KEYS` (and `PLATFORM_MASTER_KEY_ID`) to it, in the
 *      environment this command and the API/worker will use;
 *   2. set `PROJECT_PROVIDER=supabase`, `SUPABASE_PAT` and `SUPABASE_ORG_SLUG` (the platform token is the ONLY
 *      thing the command needs from the old world; it never reads a stored credential);
 *   3. run this command once per project: it reveals or creates the project's keys, sets a new `postgres`
 *      password, re-creates the `api_user` password, writes a new hook secret into the project's Auth
 *      configuration, re-seals every credential column under the new key and bumps `credential_version`;
 *   4. restart the API and the worker (their pools are keyed on the credential version).
 *
 * Exit codes: 0 reissued; 1 failed or refused (the project is busy: a bootstrap step is running, or another
 * reissue, credential replacement or create holds the project lock; try again in a minute); 2 usage.
 * Output is one JSON line of ids, a status and a number, never a value (T-09.2-67).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type ReissueArgs = { ref: string } | { error: string };

/** `--ref <ref>` or `--ref=<ref>`; anything else is a usage error. Pure, so the shape is testable. */
export function parseReissueArgs(argv: readonly string[]): ReissueArgs {
  const args = argv.filter((arg) => arg !== '--');
  let ref: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === '--ref') {
      ref = args[i + 1];
      i += 1;
    } else if (arg.startsWith('--ref=')) {
      ref = arg.slice('--ref='.length);
    } else {
      return { error: 'unknown argument' };
    }
  }
  if (!ref || !/^[a-z][a-z0-9-]{2,39}$/.test(ref)) return { error: 'a project ref is required' };
  return { ref };
}

async function main(): Promise<number> {
  // Same skeleton as scripts/reseal.ts: load the local stack values before any kernel module reads env.
  const envFile = resolve(process.cwd(), 'apps/api/.env.local');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const parsed = parseReissueArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(`platform:reissue-credentials: ${parsed.error} (usage: --ref <project ref>)`);
    return 2;
  }

  const { projectIdByRef, reissueCredentials } = await import(
    '@rede-social/core/server/projects/reissue'
  );
  const projectId = await projectIdByRef(parsed.ref);
  if (!projectId) {
    console.log(JSON.stringify({ status: 'not_found' }));
    return 1;
  }
  try {
    const result = await reissueCredentials(projectId);
    console.log(JSON.stringify({ projectId, ...result }));
    return result.status === 'reissued' ? 0 : 1;
  } catch (error) {
    const reason = (error as { reason?: unknown }).reason;
    console.log(
      JSON.stringify({
        projectId,
        status: 'failed',
        reason: typeof reason === 'string' ? reason : 'unknown',
      }),
    );
    return 1;
  } finally {
    const { sqlClient } = await import('@rede-social/core/db');
    await sqlClient.end({ timeout: 5 });
  }
}

// Run only as a command; importing this file (the integration test does) executes nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      // Content-free: a connection string or a key may sit in a driver error.
      console.error('platform:reissue-credentials failed');
      process.exit(1);
    });
}
