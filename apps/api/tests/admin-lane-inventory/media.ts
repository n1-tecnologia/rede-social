import type { AdminLaneEntry, SiteClass, SiteStatus } from './index';

/** The media area (`packages/core/server/media/**`). One row per site, in site order. */
const group = (
  file: string,
  rows: readonly (readonly [
    fn: string,
    cls: SiteClass,
    plan: number,
    note?: string,
    status?: SiteStatus,
  ])[],
): AdminLaneEntry[] =>
  rows.map(([fn, cls, plan, note, status]) => ({
    file,
    fn,
    class: cls,
    status: status ?? 'pending',
    plan,
    ...(note ? { note } : {}),
  }));

export const media: readonly AdminLaneEntry[] = [
  ...group('packages/core/server/media/derive-job.ts', [
    ['markDerivationFailed', 'T', 5, undefined, 'migrated'],
    ['requeueVariantDerivation', 'T', 5, undefined, 'migrated'],
  ]),
  ...group('packages/core/server/media/service.ts', [
    [
      'startVideoUpload',
      'T',
      5,
      'the verified primary tenant_domains read (public URL only) moved out to withPlatformTx (primaryOriginOf) and runs before this transaction',
      'migrated',
    ],
    ['startVideoUpload', 'T', 5, undefined, 'migrated'],
    ['startUpload', 'T', 5, undefined, 'migrated'],
    ['completeUpload', 'T', 5, undefined, 'migrated'],
    ['completeUpload', 'T', 5, undefined, 'migrated'],
    ['deleteAsset', 'T', 5, undefined, 'migrated'],
    ['deriveAssetVariants', 'T', 5, undefined, 'migrated'],
    ['deriveAssetVariants', 'T', 5, undefined, 'migrated'],
    ['armSweeper', 'L', 9],
    ['purgeAsset', 'T', 5, undefined, 'migrated'],
  ]),
  ...group('packages/core/server/media/sweep-job.ts', [
    ['runSweepFunction', 'L', 9],
    ['reconcilable', 'L', 9],
    ['collectable', 'L', 9],
  ]),
  ...group('packages/core/server/media/video/event-job.ts', [
    [
      'resolveAsset',
      'N',
      10,
      'a provider event names an asset, not a tenant: the lookup is what finds the tenant',
    ],
    ['applyReady', 'T', 5, undefined, 'migrated'],
    ['applyReady', 'T', 5, undefined, 'migrated'],
    ['applyReady', 'T', 5, undefined, 'migrated'],
    ['applyErrored', 'T', 5, undefined, 'migrated'],
  ]),
  ...group('packages/core/server/media/video/fake.ts', [
    ['enqueueSyntheticReady', 'T', 5, undefined, 'migrated'],
  ]),
  ...group('packages/core/server/media/video/inbox.ts', [['recordProviderEvent', 'N', 10]]),
];
