'use client';

import { MediaImage } from '@rede-social/core/ui';
import { chipBase, cn } from '@rede-social/ui';
import { Radio } from 'lucide-react';
import { type ReactNode, useState } from 'react';

/**
 * The member agenda's live card (08.5-06, UI-D-434, D-431, COURSE-23) — DESIGNED this phase in the
 * prototype's lives-list language (no prototype component exists for it):
 *
 *  - ONE anchor with the host's accessible name, `rounded-xl bg-bg-secondary`, a plain `<a>` (MOD-02);
 *  - the 16:10 cover (the live's approved crop, UI-D-409) through `MediaImage` under the
 *    `from-black/60` veil, or the `--brand-gradient` when there is no cover or it fails to load —
 *    the SAME box either way, so nothing moves;
 *  - the top-left stack: the status as an over-media pill IN WORDS ("Ao vivo agora" with a leading
 *    `Radio` 12, "Agendada", "Gravada", "Cancelada") — never a pulsing dot (UI-D-443) — then the
 *    host's tag slot (the store's "Exclusiva");
 *  - the body `p-3`: the title 14/700 clamped to two lines and the `tabular-nums` meta. A cancelled
 *    card keeps its colour; only its title takes the secondary ink.
 *
 * Props only and no words (PWA-03): the status label, the meta (formatted on the server in the
 * tenant's timezone, UI-D-288), the tags and every name arrive from the host.
 */
export interface LiveCardProps {
  /** Built by the HOST (`/cursos/lives/{id}`). */
  href: string;
  /** The link's accessible name, composed by the host. */
  ariaLabel: string;
  title: string;
  /** "{date}, {time} · {duration} min". */
  meta: string;
  /** The status in words. */
  statusLabel: string;
  /** `radio` leads the pill while the live is on air. */
  statusIcon?: 'radio' | null;
  /** Null takes the gradient branch (D-69). */
  coverAssetId: string | null;
  /** The variant ladder `MediaImage` builds its `srcSet` from (R-06). */
  coverWidths: readonly number[];
  /** The store's "Exclusiva", host-composed; follows the status pill. */
  tags?: ReactNode;
  /** A cancelled live: the title takes `text-text-secondary`; the cover stays in colour. */
  cancelled?: boolean;
  eager?: boolean;
}

const COVER_SIZES = '(min-width: 640px) 210px, 50vw';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export function LiveCard({
  href,
  ariaLabel,
  title,
  meta,
  statusLabel,
  statusIcon,
  coverAssetId,
  coverWidths,
  tags,
  cancelled = false,
  eager = false,
}: LiveCardProps) {
  // Keyed by asset id, so a different cover retries instead of inheriting a previous failure.
  const [failedId, setFailedId] = useState<string | null>(null);
  const showImage = coverAssetId !== null && failedId !== coverAssetId;

  return (
    <a
      href={href}
      aria-label={ariaLabel}
      data-testid="live-card"
      data-cancelled={cancelled ? 'true' : undefined}
      className={cn(
        'flex flex-col overflow-hidden rounded-xl bg-bg-secondary transition-opacity active:opacity-80',
        FOCUS,
      )}
    >
      <div
        data-testid="live-card-cover"
        data-branch={showImage ? 'image' : 'gradient'}
        className="relative aspect-[16/10] bg-bg-tertiary"
      >
        {showImage && coverAssetId !== null ? (
          <>
            <MediaImage
              assetId={coverAssetId}
              widths={coverWidths}
              alt=""
              sizes={COVER_SIZES}
              eager={eager}
              ratio=""
              className="absolute inset-0 h-full w-full"
              onFailed={() => setFailedId(coverAssetId)}
            />
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"
            />
          </>
        ) : (
          <div
            aria-hidden
            data-testid="live-card-fallback"
            className="absolute inset-0"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          />
        )}

        <div
          data-testid="live-card-pills"
          className="absolute top-2 right-2 left-2 flex flex-wrap items-start gap-1"
        >
          <span
            data-testid="live-card-status"
            className={cn(chipBase, 'max-w-full truncate bg-black/60 text-white backdrop-blur-sm')}
          >
            {statusIcon === 'radio' ? <Radio size={12} aria-hidden className="shrink-0" /> : null}
            {statusLabel}
          </span>
          {tags}
        </div>
      </div>

      <div className="p-3">
        <p
          data-testid="live-card-title"
          className={cn(
            'line-clamp-2 text-sm font-bold leading-tight',
            cancelled ? 'text-text-secondary' : 'text-text',
          )}
        >
          {title}
        </p>
        <p
          data-testid="live-card-meta"
          className="mt-1 text-xs font-normal tabular-nums text-text-secondary"
        >
          {meta}
        </p>
      </div>
    </a>
  );
}
