import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupDirectory, createTempDirectory } from './cleanup';
import { readBuildRecord } from './config';
import { type ListingContact, pushListing } from './listing';
import {
  appleClientFrom,
  assertReady,
  googleClientFrom,
  type PlatformChoice,
  platformsOf,
  type ReleaseDeps,
} from './prepare';
import { ReleaseRefusal } from './report';
import { StoreError } from './store-http';
import { type CredentialKind, unsealToDirectory } from './unseal';
import type { VersionPatch, VersionStore } from './versions';

/**
 * `publish` (13-29, D-619): the last step of a CI release. For iOS it waits until App Store Connect has processed
 * the build the workflow uploaded and offers it to the internal TestFlight group; for Android it uploads the signed
 * bundle to the INTERNAL track, validates and commits the edit. A platform's last build, and any `--min-version` or
 * store link passed for it, are recorded only after every step of THAT platform succeeded. The command never moves
 * a build past internal testing and never submits for review (Apple 4.2.6): the tenant does that (D-604).
 */

export type PublishOptions = {
  slug: string;
  platform: PlatformChoice;
  outDir: string;
  /** The signed Android bundle the workflow built. */
  aab: string | null;
  /** Dry run only: bundle bytes when there is no file. */
  aabBytes?: Buffer | undefined;
  minVersion: string | null;
  storeUrlIos: string | null;
  storeUrlAndroid: string | null;
  /** The people-facing contact the listing needs (13-31). Required unless the listing is skipped. */
  contact?: ListingContact | null | undefined;
  /** For a run that only uploads a build: the listing is neither checked nor pushed (13-31). */
  skipListing?: boolean | undefined;
};

export type PublishDeps = ReleaseDeps & {
  versionStore: VersionStore;
  /** Dry run: stands in for the workflow's own upload of the iOS build to the fake store. */
  beforePublish?: ((build: { bundleId: string; buildNumber: number }) => void) | undefined;
};

export async function runPublish(options: PublishOptions, deps: PublishDeps): Promise<void> {
  const platforms = platformsOf(options.platform);
  if (
    (options.storeUrlIos !== null && !platforms.includes('ios')) ||
    (options.storeUrlAndroid !== null && !platforms.includes('android'))
  ) {
    throw new ReleaseRefusal('bad_arguments');
  }

  const build = await readBuildRecord(options.outDir);
  if (build.slug !== options.slug) throw new ReleaseRefusal('artifact_missing', ['build.json']);
  const record = await deps.source.load(options.slug);
  if (!record) throw new ReleaseRefusal('tenant_not_found');
  if (
    record.tab.identity.bundleId !== build.bundleId ||
    record.tab.identity.applicationId !== build.applicationId
  ) {
    // The ids were changed after the build was made: what was built is not what the tenant now has.
    throw new ReleaseRefusal('artifact_missing', ['build.json']);
  }
  assertReady(record.tab, platforms);

  let aab: Buffer | null = null;
  if (platforms.includes('android')) {
    try {
      aab = options.aab ? await fs.readFile(options.aab) : (options.aabBytes ?? null);
    } catch {
      aab = null;
    }
    if (aab === null || aab.length === 0) throw new ReleaseRefusal('artifact_missing', ['aab']);
  }

  const dir = await createTempDirectory(deps.tempBase);
  try {
    const kinds: CredentialKind[] = platforms.map((platform) =>
      platform === 'ios' ? 'asc_key' : 'play_service_account',
    );
    const unsealed = await unsealToDirectory({
      tenantId: record.tenantId,
      kinds,
      dir,
      write: deps.maskSink,
      readCredential: deps.readCredential,
    });
    if (unsealed.missing.length > 0)
      throw new ReleaseRefusal('missing_credentials', unsealed.missing);
    deps.report('publish.unseal', 'ok');

    // Dry run: the workflow's own build upload has already happened by the time `publish` runs, and it is also what
    // gives the fake store its app record, which the listing below needs. A real run has no hook here.
    if (platforms.includes('ios')) {
      deps.beforePublish?.({ bundleId: build.bundleId, buildNumber: build.buildNumber });
    }

    // The listing goes first (13-31): its refusals (no privacy URL, no reviewer, no contact) come before any
    // upload, so a build is never sent to a store whose text could not be set.
    if (options.skipListing !== true) {
      const listingApple = platforms.includes('ios') ? await appleClientFrom(dir, deps) : null;
      const listingGoogle = platforms.includes('android')
        ? await googleClientFrom(dir, deps)
        : null;
      let playIcon: Buffer | null = null;
      if (listingGoogle) {
        playIcon = await fs.readFile(join(options.outDir, 'play-icon.png')).catch(() => null);
      }
      if (record.primaryHost === null) throw new ReleaseRefusal('no_primary_host');
      await pushListing({
        tenant: {
          tenantId: record.tenantId,
          displayName: record.displayName,
          modules: record.modules ?? [],
          primaryHost: record.primaryHost,
          privacyUrl: record.tab.listing.privacyUrl,
          reviewerEmail: record.tab.listing.reviewerEmail,
          reviewerHeld: record.tab.listing.reviewerHeld,
          bundleId: build.bundleId,
          applicationId: build.applicationId,
          contact: options.contact ?? null,
          playIcon,
        },
        apple: listingApple,
        google: listingGoogle,
        deps: { readCredential: deps.readCredential, maskSink: deps.maskSink, report: deps.report },
      });
      deps.report('publish.listing', 'ok');
    }

    const value = { version: build.version, buildNumber: build.buildNumber };
    const patch = (platform: 'ios' | 'android'): VersionPatch => ({
      last: { [platform]: value },
      ...(options.minVersion !== null ? { minVersion: { [platform]: options.minVersion } } : {}),
      ...(platform === 'ios' && options.storeUrlIos !== null
        ? { storeUrl: { ios: options.storeUrlIos } }
        : {}),
      ...(platform === 'android' && options.storeUrlAndroid !== null
        ? { storeUrl: { android: options.storeUrlAndroid } }
        : {}),
    });

    if (platforms.includes('ios')) {
      try {
        const apple = await appleClientFrom(dir, deps);
        const app = await apple.findApp(build.bundleId);
        if (app === null) throw new ReleaseRefusal('app_record_missing', ['ios']);
        const state = await apple.pollBuild({
          appId: app.id,
          buildNumber: build.buildNumber,
          ...(deps.sleep ? { sleep: deps.sleep } : {}),
        });
        if (state !== 'VALID') {
          deps.report('publish.ios.build', 'failed', `build_${state.toLowerCase()}`);
          throw new ReleaseRefusal('store_failed');
        }
        deps.report('publish.ios.build', 'ok');
        const attached = await apple.attachBuildToInternalGroup({
          appId: app.id,
          buildNumber: build.buildNumber,
        });
        deps.report('publish.ios.testflight', attached.attached ? 'ok' : 'skipped');
      } catch (error) {
        if (error instanceof StoreError) {
          deps.report('publish.ios', 'failed', error.code);
          throw new ReleaseRefusal('store_failed');
        }
        throw error;
      }
      await deps.versionStore.write(record.tenantId, patch('ios'));
      deps.report('publish.ios.record', 'ok');
    }

    if (platforms.includes('android') && aab !== null) {
      const google = await googleClientFrom(dir, deps);
      let editId: string | null = null;
      try {
        editId = (await google.insertEdit(build.applicationId)).id;
        const { versionCode } = await google.uploadBundle(build.applicationId, editId, aab);
        deps.report('publish.android.upload', 'ok');
        await google.updateInternalTrack(build.applicationId, editId, { versionCode });
        await google.validateEdit(build.applicationId, editId);
        await google.commitEdit(build.applicationId, editId);
        editId = null;
        deps.report('publish.android.track', 'ok');
      } catch (error) {
        if (editId !== null) {
          // An edit left open would hold the next release back; failing to delete it changes nothing here.
          await google.deleteEdit(build.applicationId, editId).catch(() => undefined);
        }
        if (error instanceof StoreError) {
          deps.report('publish.android', 'failed', error.code);
          throw new ReleaseRefusal(
            error.code === 'store_not_found' ? 'app_record_missing' : 'store_failed',
          );
        }
        throw error;
      }
      await deps.versionStore.write(record.tenantId, patch('android'));
      deps.report('publish.android.record', 'ok');
    }
  } finally {
    await cleanupDirectory(dir);
  }
}
