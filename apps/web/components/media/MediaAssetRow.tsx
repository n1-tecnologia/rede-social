'use client';

import type { MediaAsset } from '@tria/contracts/media';
import { cn, StatusPill, type StatusTone } from '@tria/ui';
import { Camera, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MediaImage } from '@/components/media/MediaImage';

/**
 * The community's timezone for the row's date. The bootstrap payload does not carry
 * `tenants.timezone` yet (only the platform panel's tenant payload does), so the row takes it as a
 * prop with the column's own default — which is what every seeded and newly provisioned community
 * actually has. Formatting is timezone-PINNED rather than local on purpose: the same ISO instant
 * must render identically on the server and after hydration (UI-SPEC §Motion & Accessibility,
 * "no `Date.now()` in render"). When a later phase adds `timezone` to the bootstrap, the screen
 * passes it and nothing else here changes.
 */
export const DEFAULT_TENANT_TIME_ZONE = 'America/Sao_Paulo';

const TONE_BY_STATUS: Record<string, StatusTone> = {
  pending: 'warning',
  processing: 'warning',
  ready: 'success',
  failed: 'danger',
  rejected: 'neutral',
  deleted: 'neutral',
};

const LABEL_KEY_BY_STATUS: Record<string, string> = {
  pending: 'processing',
  processing: 'processing',
  ready: 'ready',
  failed: 'failed',
  rejected: 'rejected',
  deleted: 'rejected',
};

/** `mm:ss` — the only variable string in the row besides the filename, and only when known. */
function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export interface MediaAssetRowProps {
  asset: MediaAsset;
  /** Only a `ready` row is interactive; the handler is ignored for every other status. */
  onOpen?: (asset: MediaAsset) => void;
  timeZone?: string;
}

/**
 * One row of the admin media library (UI-SPEC §Admin media step 2, E6).
 *
 * `flex items-center gap-3 px-4 py-3 min-h-14` — a `w-24 aspect-video` thumbnail box on the
 * `bg-bg-tertiary` ground (poster when ready, a centred `Loader2` 20 while processing, a `Camera` 20
 * when it failed), the original filename truncated, a `tabular-nums` pt-BR date with the duration
 * when it is known, and the status pill. A `ready` row is a `<button>` that opens the player; a
 * non-`ready` row is a plain `<div>` and carries no `role="button"` at all, so "not interactive"
 * is structural rather than a disabled attribute a pointer could still focus.
 */
export function MediaAssetRow({
  asset,
  onOpen,
  timeZone = DEFAULT_TENANT_TIME_ZONE,
}: MediaAssetRowProps) {
  const t = useTranslations('media');
  const ready = asset.status === 'ready';
  const processing = asset.status === 'pending' || asset.status === 'processing';
  const failed = asset.status === 'failed';

  const date = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(asset.createdAt));
  const duration = formatDuration(asset.durationSeconds);

  const thumbnail = (
    <div
      aria-hidden
      className="flex w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-bg-tertiary aspect-video"
      data-testid="media-row-thumb"
    >
      {/* E6/partial: a processing row shows NO poster — the asset has no still yet, so a broken box
          would be the only thing an <img> could produce. */}
      {ready && asset.variants.length > 0 ? (
        <MediaImage
          assetId={asset.id}
          widths={asset.variants.map((variant) => variant.width)}
          alt=""
          sizes="96px"
          ratio="aspect-video"
          className="h-full w-full"
        />
      ) : processing ? (
        <Loader2
          size={20}
          className="animate-spin text-text-tertiary motion-reduce:animate-none"
          data-testid="media-row-spinner"
        />
      ) : (
        <Camera size={20} className="text-text-tertiary" />
      )}
    </div>
  );

  const body = (
    <>
      {thumbnail}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="truncate text-base font-bold text-text">
          {asset.filename ?? t('library.title')}
        </span>
        <span className="text-xs tabular-nums text-text-tertiary">
          {duration ? `${date} · ${duration}` : date}
        </span>
        {failed ? (
          <span className="text-xs text-danger" data-testid="media-row-failure">
            {t('player.failed')}
          </span>
        ) : null}
      </div>
      <StatusPill tone={TONE_BY_STATUS[asset.status] ?? 'neutral'}>
        {t(`status.${LABEL_KEY_BY_STATUS[asset.status] ?? 'rejected'}`)}
      </StatusPill>
    </>
  );

  const shape = 'flex min-h-14 w-full items-center gap-3 px-4 py-3';

  if (ready && onOpen) {
    return (
      <button
        type="button"
        data-testid="media-row"
        data-status={asset.status}
        onClick={() => onOpen(asset)}
        className={cn(shape, 'transition-colors hover:bg-bg-hover')}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={shape} data-testid="media-row" data-status={asset.status}>
      {body}
    </div>
  );
}
