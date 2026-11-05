/**
 * The per-tenant app release command (13-29, D-605, D-607, D-611, D-619; NATIVE-02, 15 build half, 27, 28):
 *
 *   pnpm platform:app-release <slug> [--env prod|hml] [--platform ios|android|all] [--dry-run]
 *                             [--min-version x.y.z] [--store-url-ios URL] [--store-url-android URL]
 *                             [--contact-email E --contact-name N --contact-phone P | --skip-listing]
 *
 * Three subcommands (the first word, `dispatch` when omitted):
 *   dispatch  the operator's: checks the tenant, the held credentials and the checklist, then starts the protected
 *             workflow with `gh workflow run` and prints the run URL (`--check-only` stops after the checks);
 *   prepare   CI's: derives the build record from the tenant, unseals the credentials into a temporary directory,
 *             registers the identifiers, generates the signing material on first use and writes `build.json`;
 *   publish   CI's: pushes the store listing (13-31: text, age-rating answers, the App Review detail with the
 *             reviewer demo account; `--skip-listing` for a run that only uploads a build), waits for the build,
 *             uploads to the Play internal track, records the last build and sets the minimum version and store links.
 * A fourth, `cleanup --secrets-dir <dir>`, removes the directory `prepare --secrets-dir` left for the build steps.
 *
 * `--dry-run` sends every store call to local fake servers (nothing leaves the machine and nothing is persisted:
 * generated signing material is kept in memory) and prints the `gh` command instead of running it. The operator
 * never edits a `.env` or code per tenant: the tenant is a slug, and everything else is read from its record.
 *
 * Output is closed outcomes only (`report.ts`): no value, token, key id or password is ever printed. Exit codes:
 * 0 done, 1 refused or failed (a closed reason), 2 usage. The command never submits an app for review.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { cleanupDirectory, defaultTempBase } from './cleanup';
import type { ReleaseEnv } from './config';
import type { ListingContact } from './listing';
import { type PlatformChoice, runDispatch, runPrepare } from './prepare';
import { type PublishDeps, runPublish } from './publish';
import { createReporter, ReleaseRefusal, type Reporter } from './report';
import { memoryGeneratedStore, pgGeneratedStore, runTool } from './signing';
import { httpsLogoReader, localLogoReader, pgTenantSource } from './sources';
import { StoreError } from './store-http';
import type { CredentialKind, ReadCredential } from './unseal';
import { memoryVersionStore, pgVersionStore } from './versions';

const SUBCOMMANDS = ['dispatch', 'prepare', 'publish', 'cleanup'] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

export type CliArgs = {
  command: Subcommand;
  slug: string;
  env: ReleaseEnv;
  platform: PlatformChoice;
  dryRun: boolean;
  checkOnly: boolean;
  minVersion: string | null;
  storeUrlIos: string | null;
  storeUrlAndroid: string | null;
  outDir: string;
  secretsDir: string | null;
  aab: string | null;
  /** 13-31: a run that only uploads a build skips the listing (and its checks). */
  skipListing: boolean;
  contact: ListingContact | null;
};

/** The repository root, so the command works from any working directory. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_OUT_DIR = resolve(REPO_ROOT, 'apps/mobile/.tenant');

/** Parses the argument list, rejecting unknown flags, missing values and bad choices. Throws `bad_arguments`. */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        env: { type: 'string' },
        platform: { type: 'string' },
        'dry-run': { type: 'boolean' },
        'check-only': { type: 'boolean' },
        'min-version': { type: 'string' },
        'store-url-ios': { type: 'string' },
        'store-url-android': { type: 'string' },
        out: { type: 'string' },
        'secrets-dir': { type: 'string' },
        aab: { type: 'string' },
        'skip-listing': { type: 'boolean' },
        'contact-email': { type: 'string' },
        'contact-name': { type: 'string' },
        'contact-phone': { type: 'string' },
      },
    });
  } catch {
    throw new ReleaseRefusal('bad_arguments');
  }
  const bad = () => new ReleaseRefusal('bad_arguments');
  const positionals = parsed.positionals.filter((word) => word !== '--');
  const first = positionals[0];
  let command: Subcommand = 'dispatch';
  let slugWord = first;
  if (positionals.length > 1 && SUBCOMMANDS.includes(first as Subcommand)) {
    command = first as Subcommand;
    slugWord = positionals[1];
  }
  if (positionals.length > 2 || slugWord === undefined) throw bad();

  const value = parsed.values;
  const text = (name: string): string | null => {
    const raw = value[name];
    return typeof raw === 'string' ? raw : null;
  };
  const env = text('env') ?? 'hml';
  const platform = text('platform') ?? 'all';
  if (env !== 'hml' && env !== 'prod') throw bad();
  if (platform !== 'ios' && platform !== 'android' && platform !== 'all') throw bad();
  const minVersion = text('min-version');
  if (minVersion !== null && !/^\d+\.\d+\.\d+$/.test(minVersion)) throw bad();
  for (const name of ['store-url-ios', 'store-url-android'] as const) {
    const url = text(name);
    if (url !== null && !/^https:\/\/\S+$/.test(url)) throw bad();
  }
  const contactEmail = text('contact-email');
  const contactName = text('contact-name');
  const contactPhone = text('contact-phone');
  if (contactEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw bad();
  if (contactName !== null && (contactName.trim() === '' || contactName.length > 100)) throw bad();
  if (contactPhone !== null && !/^\+?[0-9 ()-]{6,30}$/.test(contactPhone)) throw bad();
  return {
    command,
    slug: slugWord,
    env,
    platform,
    dryRun: value['dry-run'] === true,
    checkOnly: value['check-only'] === true,
    minVersion,
    storeUrlIos: text('store-url-ios'),
    storeUrlAndroid: text('store-url-android'),
    outDir: resolve(text('out') ?? DEFAULT_OUT_DIR),
    secretsDir: text('secrets-dir'),
    aab: text('aab'),
    skipListing: value['skip-listing'] === true,
    contact:
      contactEmail !== null
        ? { email: contactEmail, name: contactName ?? '', phone: contactPhone ?? '' }
        : null,
  };
}

// biome-ignore lint/suspicious/noUndeclaredEnvVars: set by the CI runner, not by the repository
const inGithubActions = (): boolean => process.env.GITHUB_ACTIONS === 'true';

const GENERATED: readonly CredentialKind[] = ['android_keystore', 'ios_distribution'];

/** Builds the real or the dry-run dependencies. The kernel is loaded here, after the environment is in place. */
export async function buildDeps(
  args: CliArgs,
  report: Reporter,
): Promise<{ deps: PublishDeps; close(): Promise<void> }> {
  const { readAppCredential } = await import('@rede-social/core/server/apps/index');
  const entered = async (tenantId: string, kind: CredentialKind) =>
    readAppCredential(tenantId, kind as 'asc_key' | 'play_service_account' | 'apns_key');

  if (!args.dryRun) {
    const readCredential: ReadCredential = (tenantId, kind) =>
      GENERATED.includes(kind)
        ? pgGeneratedStore.peek(tenantId, kind as 'android_keystore')
        : entered(tenantId, kind);
    return {
      deps: {
        source: pgTenantSource,
        readLogo: httpsLogoReader,
        readCredential,
        generatedStore: pgGeneratedStore,
        tools: runTool,
        report,
        // Only a GitHub Actions runner consumes `::add-mask::` lines. Anywhere else the line would just print the
        // secret on the operator's terminal, so it is dropped.
        maskSink: (line) => {
          if (inGithubActions()) process.stdout.write(`${line}\n`);
        },
        tempBase: defaultTempBase(),
        stores: {},
        versionStore: pgVersionStore,
      },
      close: async () => {},
    };
  }

  const { createFakeStores } = await import('./fake-stores');
  const { seal, open } = await import('@rede-social/core/server/secrets/sealed');
  const fakes = await createFakeStores();
  const generatedStore = memoryGeneratedStore({ seal, open });
  const readCredential: ReadCredential = (tenantId, kind) =>
    GENERATED.includes(kind)
      ? generatedStore.peek(tenantId, kind as 'android_keystore')
      : entered(tenantId, kind);
  return {
    deps: {
      source: pgTenantSource,
      readLogo: localLogoReader(resolve(REPO_ROOT, 'apps/web/public')),
      readCredential,
      generatedStore,
      tools: runTool,
      report,
      // A dry run has no runner to consume mask lines, and printing them would print the secrets.
      maskSink: () => {},
      tempBase: defaultTempBase(),
      stores: { apple: fakes.apple, google: fakes.google },
      // The fake store's certificate is not a real DER, so the dry run packs a stand-in bundle.
      packP12: async () => Buffer.from('dry-run-p12'),
      // Nothing a dry run records is persisted.
      versionStore: memoryVersionStore(),
      // The workflow's own upload of the iOS build, stood in by the fake store.
      beforePublish: (build) => fakes.markBuildUploaded(build.bundleId, build.buildNumber),
    },
    close: () => fakes.close(),
  };
}

export async function runCli(
  argv: readonly string[],
  overrides: Partial<PublishDeps> = {},
): Promise<number> {
  const report = createReporter();
  let args: CliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (error) {
    if (error instanceof ReleaseRefusal) {
      report('arguments', 'refused', error.reason);
      return 2;
    }
    throw error;
  }

  try {
    if (args.command === 'cleanup') {
      if (args.secretsDir === null) throw new ReleaseRefusal('bad_arguments');
      await cleanupDirectory(resolve(args.secretsDir));
      report('cleanup', 'ok');
      return 0;
    }
    const built = await buildDeps(args, report);
    const deps: PublishDeps = { ...built.deps, ...overrides };
    const { close } = built;
    try {
      if (args.command === 'dispatch') {
        await runDispatch(
          {
            slug: args.slug,
            env: args.env,
            platform: args.platform,
            dryRun: args.dryRun,
            checkOnly: args.checkOnly,
          },
          deps,
        );
      } else if (args.command === 'prepare') {
        await runPrepare(
          {
            slug: args.slug,
            env: args.env,
            platform: args.platform,
            outDir: args.outDir,
            secretsDir: args.secretsDir ?? undefined,
          },
          deps,
        );
      } else if (args.command === 'publish') {
        await runPublish(
          {
            slug: args.slug,
            platform: args.platform,
            outDir: args.outDir,
            aab: args.aab,
            ...(args.dryRun && args.aab === null ? { aabBytes: Buffer.from('dry-run-aab') } : {}),
            minVersion: args.minVersion,
            storeUrlIos: args.storeUrlIos,
            storeUrlAndroid: args.storeUrlAndroid,
            skipListing: args.skipListing,
            contact: args.contact,
          },
          deps,
        );
      } else {
        throw new ReleaseRefusal('bad_arguments');
      }
    } finally {
      await close();
    }
    report('done', 'ok');
    return 0;
  } catch (error) {
    if (error instanceof ReleaseRefusal) {
      report('release', 'refused', error.reason);
      for (const item of error.missing)
        report('missing', 'refused', item.toLowerCase().replace(/[^a-z0-9_.:-]/g, '_'));
      return 1;
    }
    if (error instanceof StoreError) {
      report('release', 'failed', error.code);
      return 1;
    }
    // Content-free on purpose: a driver or store error may carry a connection string or a token.
    report('release', 'failed', 'unexpected');
    return 1;
  }
}

async function main(): Promise<void> {
  // Same skeleton as scripts/seed.ts: load the local stack values before any kernel module reads env.
  const envFile = resolve(process.cwd(), 'apps/api/.env.local');
  if (!inGithubActions() && existsSync(envFile)) process.loadEnvFile(envFile);
  const code = await runCli(process.argv.slice(2));
  try {
    const { sqlClient } = await import('@rede-social/core/db');
    await sqlClient.end({ timeout: 5 });
  } catch {
    // The pool was never opened (a usage error or a cleanup): nothing to close.
  }
  process.exit(code);
}

// Run only as a command; importing this file (the tests do) executes nothing.
if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  main().catch(() => {
    process.stderr.write('platform:app-release failed\n');
    process.exit(1);
  });
}
