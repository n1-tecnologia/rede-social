import type { AdminLaneEntry, SiteClass } from './index';

/** The media area (`packages/core/server/media/**`). One row per site, in site order. */
const group = (
  file: string,
  rows: readonly (readonly [fn: string, cls: SiteClass, plan: number, note?: string])[],
): AdminLaneEntry[] =>
  rows.map(([fn, cls, plan, note]) => ({
    file,
    fn,
    class: cls,
    status: 'pending',
    plan,
    ...(note ? { note } : {}),
  }));

export const media: readonly AdminLaneEntry[] = [
  ...group('packages/core/server/media/derive-job.ts', [
    ['markDerivationFailed', 'T', 5],
    ['requeueVariantDerivation', 'T', 5],
  ]),
  ...group('packages/core/server/media/service.ts', [
    [
      'startVideoUpload',
      'T',
      5,
      'also reads the verified primary tenant_domains row (public URL only): a P read inside the T transaction, split when migrated',
    ],
    ['startVideoUpload', 'T', 5],
    ['startUpload', 'T', 5],
    ['completeUpload', 'T', 5],
    ['completeUpload', 'T', 5],
    ['deleteAsset', 'T', 5],
    ['deriveAssetVariants', 'T', 5],
    ['deriveAssetVariants', 'T', 5],
    ['armSweeper', 'L', 9],
    ['purgeAsset', 'T', 5],
  ]),
  ...group('packages/core/server/media/sweep-job.ts', [
    ['runSweepFunction', 'L', 9],
    ['reconcilable', 'L', 9],
    ['collectable', 'L', 9],
  ]),
  ...group('packages/core/server/media/video/event-job.ts', [
    ['resolveAsset', 'N', 10],
    ['applyReady', 'T', 5],
    ['applyReady', 'T', 5],
    ['applyReady', 'T', 5],
    ['applyErrored', 'T', 5],
  ]),
  ...group('packages/core/server/media/video/fake.ts', [['enqueueSyntheticReady', 'T', 5]]),
  ...group('packages/core/server/media/video/inbox.ts', [['recordProviderEvent', 'N', 10]]),
];
