import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import type { AppTab } from '@rede-social/contracts/native';
import { cleanupDirectory, createTempDirectory, isOwnSecretsDirectory } from './cleanup';
import {
  deriveBuildRecord,
  type LogoReader,
  type ReleaseEnv,
  renderAssets,
  type TenantSource,
  writeBuildRecord,
} from './config';
import { maskValues } from './mask';
import { printUrl, ReleaseRefusal, type Reporter } from './report';
import {
  ensureAndroidKeystore,
  ensureIosSigning,
  type GeneratedStore,
  type MakeCsr,
  type PackP12,
  type Random,
  type ToolRunner,
} from './signing';
import { createAppleClient } from './store-apple';
import { createGoogleClient } from './store-google';
import { StoreError } from './store-http';
import {
  type CredentialKind,
  type ReadCredential,
  readSecretFile,
  SECRET_FILES,
  unsealToDirectory,
  writeSecretFile,
} from './unseal';

/**
 * The three halves of `platform:app-release` (13-29, D-605, D-619). `dispatch` is the operator's: it checks and
 * starts the protected workflow. `prepare` is CI's first step: derive, unseal, register, generate signing material,
 * write `build.json`. `publish` (publish.ts) is CI's last. The command has no code path that submits an app for
 * review (Apple 4.2.6): nothing here, or in the store clients, can.
 */

export type PlatformChoice = 'ios' | 'android' | 'all';
export const platformsOf = (choice: PlatformChoice): readonly ('ios' | 'android')[] =>
  choice === 'all' ? ['ios', 'android'] : [choice];

export type ReleaseDeps = {
  source: TenantSource;
  readLogo: LogoReader;
  /** Reads a credential of any kind (the entered three through the kernel, the generated ones through the store). */
  readCredential: ReadCredential;
  generatedStore: GeneratedStore;
  tools: ToolRunner;
  report: Reporter;
  /** Receives every `::add-mask::` line. In CI it is standard output (the runner consumes it). */
  maskSink: (line: string) => void;
  tempBase: string;
  /** Store origins: absent means the real hosts. The dry run points them at the fakes. */
  stores: {
    apple?: { origin: string };
    google?: { origin: string; tokenOrigin: string };
  };
  random?: Random;
  makeCsr?: MakeCsr;
  packP12?: PackP12;
  /** Waits between polls and retries; tests pass an instant one. */
  sleep?: (ms: number) => Promise<void>;
};

export type PrepareOptions = {
  slug: string;
  env: ReleaseEnv;
  platform: PlatformChoice;
  /** Where `build.json` and the images go (`apps/mobile/.tenant` by default). */
  outDir: string;
  /** CI hands the unsealed files to the build steps through this directory, which `cleanup` removes last. */
  secretsDir?: string | undefined;
};

/** What each platform needs held before anything starts (credentials), and ticked (accounts). */
const CREDENTIALS_FOR = {
  ios: ['asc_key', 'apns_key'],
  android: ['play_service_account'],
} as const;
const ACCOUNT_FOR = { ios: 'appleAccount', android: 'playAccount' } as const;

/**
 * The closed list of what is missing for the chosen platforms: the held credentials first, then the account
 * steps the operator ticks. Never a value. The `links` row is not required here: the Play signing fingerprint
 * exists only after the first upload (UI-D-624), so requiring it would make a first build impossible.
 */
export function assertReady(tab: AppTab, platforms: readonly ('ios' | 'android')[]): void {
  const held = new Set(tab.credentials.filter((entry) => entry.held).map((entry) => entry.kind));
  const credentials: string[] = [];
  const checklist: string[] = [];
  for (const platform of platforms) {
    for (const kind of CREDENTIALS_FOR[platform]) if (!held.has(kind)) credentials.push(kind);
    if (!tab.checklist.manual[ACCOUNT_FOR[platform]]) checklist.push(ACCOUNT_FOR[platform]);
  }
  if (credentials.length > 0) throw new ReleaseRefusal('missing_credentials', credentials);
  if (checklist.length > 0) throw new ReleaseRefusal('missing_checklist', checklist);
}

// --- dispatch ----------------------------------------------------------------------------------------------------

export const WORKFLOW_FILE = 'app-release.yml';

export async function runDispatch(
  options: {
    slug: string;
    env: ReleaseEnv;
    platform: PlatformChoice;
    dryRun: boolean;
    checkOnly: boolean;
  },
  deps: Pick<ReleaseDeps, 'source' | 'tools' | 'report' | 'sleep'> & {
    print?: (line: string) => void;
  },
): Promise<void> {
  const record = await deps.source.load(options.slug);
  if (!record) throw new ReleaseRefusal('tenant_not_found');
  if (record.primaryHost === null) throw new ReleaseRefusal('no_primary_host');
  if (record.tab.identity.bundleId === null || record.tab.identity.applicationId === null) {
    throw new ReleaseRefusal('no_app_ids');
  }
  assertReady(record.tab, platformsOf(options.platform));
  deps.report('dispatch.check', 'ok');
  if (options.checkOnly) return;

  const args = [
    'workflow',
    'run',
    WORKFLOW_FILE,
    '-f',
    `tenant=${options.slug}`,
    '-f',
    `env=${options.env}`,
    '-f',
    `platform=${options.platform}`,
  ];
  if (options.dryRun) {
    deps.report('dispatch.workflow', 'planned');
    return;
  }
  const started = await deps.tools('gh', args);
  if (started.code !== 0)
    throw new ReleaseRefusal(started.missing ? 'tool_missing' : 'store_failed');
  deps.report('dispatch.workflow', 'ok');

  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await sleep(3000);
    const listed = await deps.tools(
      'gh',
      [
        'run',
        'list',
        '--workflow',
        WORKFLOW_FILE,
        '--limit',
        '1',
        '--json',
        'url',
        '--jq',
        '.[0].url',
      ],
      { capture: true },
    );
    const url = listed.stdout?.trim();
    if (listed.code === 0 && url) {
      printUrl(url, deps.print);
      return;
    }
  }
}

// --- prepare -----------------------------------------------------------------------------------------------------

/** The App Store Connect and Play clients for the unsealed credentials in `dir`. */
export async function appleClientFrom(dir: string, deps: Pick<ReleaseDeps, 'stores'>) {
  const key = JSON.parse(await readSecretFile(dir, SECRET_FILES.ascKeyJson)) as {
    key_id: string;
    issuer_id: string;
    key: string;
  };
  return createAppleClient({
    ...(deps.stores.apple ? { origin: deps.stores.apple.origin } : {}),
    keyId: key.key_id,
    issuerId: key.issuer_id,
    privateKey: key.key,
  });
}

export async function googleClientFrom(dir: string, deps: Pick<ReleaseDeps, 'stores'>) {
  return createGoogleClient({
    ...(deps.stores.google
      ? { origin: deps.stores.google.origin, tokenOrigin: deps.stores.google.tokenOrigin }
      : {}),
    serviceAccount: await readSecretFile(dir, SECRET_FILES.playServiceAccount),
  });
}

/** Runs a store step; a store failure becomes the closed `store_failed`, and the step is reported either way. */
async function step<T>(
  deps: Pick<ReleaseDeps, 'report'>,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const value = await fn();
    return value;
  } catch (error) {
    if (error instanceof ReleaseRefusal) {
      deps.report(name, 'refused', error.reason);
      throw error;
    }
    if (error instanceof StoreError) {
      deps.report(name, 'failed', error.code);
      throw new ReleaseRefusal('store_failed');
    }
    throw error;
  }
}

export async function runPrepare(options: PrepareOptions, deps: ReleaseDeps): Promise<void> {
  const platforms = platformsOf(options.platform);
  if (options.secretsDir && !isOwnSecretsDirectory(options.secretsDir, deps.tempBase)) {
    // CI's hand-off folder must be `app-release-*` directly under the runner's temp folder, so `cleanup` can never
    // be pointed at anything else.
    throw new ReleaseRefusal('bad_arguments');
  }
  try {
    await fs.access(join(options.outDir, '..'));
  } catch {
    throw new ReleaseRefusal('workspace_missing');
  }

  const derived = await deriveBuildRecord({
    slug: options.slug,
    env: options.env,
    source: deps.source,
    readLogo: deps.readLogo,
  });
  deps.report('derive', 'ok');
  assertReady(derived.tab, platforms);
  deps.report('checklist', 'ok');

  const dir = options.secretsDir ?? (await createTempDirectory(deps.tempBase));
  try {
    if (options.secretsDir) await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const kinds: CredentialKind[] = platforms.flatMap((platform) => [...CREDENTIALS_FOR[platform]]);
    const unsealed = await unsealToDirectory({
      tenantId: derived.tenantId,
      kinds,
      dir,
      write: deps.maskSink,
      readCredential: deps.readCredential,
    });
    if (unsealed.missing.length > 0)
      throw new ReleaseRefusal('missing_credentials', unsealed.missing);
    deps.report('unseal', 'ok');

    const { build } = derived;
    if (platforms.includes('ios')) {
      const apple = await appleClientFrom(dir, deps);
      const signing = await step(deps, 'ios.register', () =>
        ensureIosSigning({
          tenantId: derived.tenantId,
          bundleId: build.bundleId,
          storeName: build.storeName,
          apple,
          store: deps.generatedStore,
          tools: deps.tools,
          dir,
          ...(deps.makeCsr ? { makeCsr: deps.makeCsr } : {}),
          ...(deps.packP12 ? { packP12: deps.packP12 } : {}),
          ...(deps.random ? { random: deps.random } : {}),
          mask: (values) => maskValues(values, deps.maskSink),
        }),
      );
      deps.report('ios.bundle-id', 'ok');
      deps.report('ios.certificate', signing.certificateCreated ? 'created' : 'reused');
      deps.report('ios.profile', signing.profile.created ? 'created' : 'reused');
      const record = await step(deps, 'ios.app-record', () => apple.findApp(build.bundleId));
      if (record === null) {
        deps.report('ios.app-record', 'refused', 'app_record_missing');
        throw new ReleaseRefusal('app_record_missing', ['ios']);
      }
      deps.report('ios.app-record', 'ok');
      await unsealToDirectory({
        tenantId: derived.tenantId,
        kinds: ['ios_distribution'],
        dir,
        write: deps.maskSink,
        readCredential: deps.readCredential,
      });
      await writeSecretFile(
        dir,
        SECRET_FILES.iosProfile,
        Buffer.from(signing.profile.content, 'base64'),
      );
    }

    if (platforms.includes('android')) {
      const google = await googleClientFrom(dir, deps);
      // The preflight: an edit can be opened only for an app that exists in the Play Console.
      await step(deps, 'android.app-record', async () => {
        try {
          const edit = await google.insertEdit(build.applicationId);
          await google.deleteEdit(build.applicationId, edit.id);
        } catch (error) {
          if (error instanceof StoreError && error.code === 'store_not_found') {
            throw new ReleaseRefusal('app_record_missing', ['android']);
          }
          throw error;
        }
      });
      deps.report('android.app-record', 'ok');
      const keystore = await ensureAndroidKeystore({
        tenantId: derived.tenantId,
        applicationId: build.applicationId,
        store: deps.generatedStore,
        tools: deps.tools,
        dir,
        ...(deps.random ? { random: deps.random } : {}),
        mask: (values) => maskValues(values, deps.maskSink),
      });
      deps.report('android.keystore', keystore.created ? 'created' : 'reused');
      await unsealToDirectory({
        tenantId: derived.tenantId,
        kinds: ['android_keystore'],
        dir,
        write: deps.maskSink,
        readCredential: deps.readCredential,
      });
    }

    await writeBuildRecord({
      dir: options.outDir,
      build,
      assets: await renderAssets(derived),
    });
    deps.report('build-record', 'ok');
  } finally {
    if (!options.secretsDir) await cleanupDirectory(dir);
  }
}
