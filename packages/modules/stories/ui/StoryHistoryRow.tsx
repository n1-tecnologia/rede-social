'use client';

import { MediaImage } from '@tria/core/ui';
import { cn, StatusPill } from '@tria/ui';
import { Pin } from 'lucide-react';

/**
 * UI-D-40 — one row of "Seus stories" (D-84), the admin's own history.
 *
 * **Why a ROW and not a grid cell**, stated here because the tempting "improvement" is to make this
 * screen a 9:16 grid like every other story history: a grid of crops would hide exactly the two
 * things this screen exists for — the COUNTS and the PINNED STATE — and would have nowhere to put
 * the `Processando` / `Recusado` pill (Pitfall 5). D-45 already rejected a story grid on `/perfil`
 * for the same reason.
 *
 * Presentational and props-only, the `StoryCircle` posture: it fetches nothing, formats no date,
 * resolves no route and **ships no words** (PWA-03). The meta line arrives fully composed
 * ("{date} · {n} curtidas · {n} comentários") because only the host knows the locale and the
 * plural rules, and the pin indicator's label arrives plural-aware for the same reason.
 *
 * **THREE THINGS A REVIEWER MUST NOT "FIX":**
 *
 * 1. **The COUNT is the presence test for the pin indicator, never a null check.** A story pinned
 *    nowhere renders no indicator at all — not a `0`, not a hollow glyph (UI zero-one-many/E08).
 *    `pinnedCommunityCount` is always a number on the payload, so `pinned?.count > 0` is the only
 *    honest condition; a `pinned !== undefined` test would draw a zero.
 * 2. **The geometry is fixed by the THUMBNAIL, not by the body.** A row may carry a pill, an
 *    indicator, both or neither, and its caption may be the absent-caption fallback — and none of
 *    those combinations may reflow the list (UI partial/E08). The thumbnail is a fixed 48×64 and
 *    `min-h-14` is the floor; the body is the only flexible child and it is `min-w-0`, so
 *    truncation always falls on the text and never pushes the trailing slot out of the row.
 * 3. **`captionMuted` is a STYLE flag, not a content one.** The fallback words ("Sem legenda") are
 *    the host's; this component only knows to render them tertiary so they never read as something
 *    the admin actually typed.
 */

export interface StoryHistoryRowProps {
  /** The story's own media asset; null renders the neutral box (UI media/E08). */
  thumbnailAssetId: string | null;
  /** The variant ladder `MediaImage` builds its `srcSet` from (R-06) — never a hand-written list. */
  thumbnailVariantWidths: readonly number[];
  thumbnailAlt: string;
  /** The caption's first line, or the host's absent-caption fallback. */
  caption: string;
  /** True when `caption` is that fallback — renders tertiary (see point 3). */
  captionMuted?: boolean;
  /** "{date} · {n} curtidas · {n} comentários", ALREADY COMPOSED by the host (UI-D-14). */
  meta: string;
  /** An optional third line — the processing note (Pitfall 5). Absent renders nothing. */
  note?: string;
  /** Phase 3's media vocabulary: `warning` = Processando, `danger` = Recusado. */
  status?: { tone: 'warning' | 'danger'; label: string };
  /** The pinned-community count and its plural-aware label. `count === 0` renders NOTHING. */
  pinned?: { count: number; label: string };
  /** Accessible name of the row control ("Opções do story …"). */
  actionLabel: string;
  /** The whole row is the control — it opens the host's row menu. */
  onOpen: () => void;
}

/** The thumb is a fixed 48×64 in every row, so `sizes` never needs the viewport. */
const THUMB_SIZES = '48px';

export function StoryHistoryRow({
  thumbnailAssetId,
  thumbnailVariantWidths,
  thumbnailAlt,
  caption,
  captionMuted = false,
  meta,
  note,
  status,
  pinned,
  actionLabel,
  onOpen,
}: StoryHistoryRowProps) {
  const showPin = pinned !== undefined && pinned.count > 0;

  return (
    <button
      type="button"
      aria-label={actionLabel}
      onClick={onOpen}
      data-story-history-row
      className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      {thumbnailAssetId !== null ? (
        <span
          data-story-history-thumb
          className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary"
        >
          <MediaImage
            assetId={thumbnailAssetId}
            widths={thumbnailVariantWidths}
            alt={thumbnailAlt}
            sizes={THUMB_SIZES}
            ratio=""
            className="h-full w-full"
          />
        </span>
      ) : (
        // The same neutral box `MediaImage` degrades to, so an asset that never produced a
        // thumbnail and one whose fetch failed look identical — the row is about the counts.
        <span
          aria-hidden
          data-story-history-thumb
          data-story-history-thumb-fallback
          className="h-16 w-12 shrink-0 rounded-lg bg-bg-tertiary"
        />
      )}

      {/* The ONLY flexible child. `min-w-0` is what makes `truncate` below actually cut rather
          than widen the row, so at any caption length the trailing slot keeps its size. */}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            'truncate text-sm font-normal',
            captionMuted ? 'text-text-tertiary' : 'text-text',
          )}
        >
          {caption}
        </span>
        <span className="truncate text-xs font-normal text-text-tertiary tabular-nums">{meta}</span>
        {note ? (
          <span className="text-xs font-normal text-text-tertiary leading-relaxed">{note}</span>
        ) : null}
      </span>

      <span className="flex shrink-0 items-center gap-2">
        {status ? (
          <StatusPill tone={status.tone} data-testid="story-history-status">
            {status.label}
          </StatusPill>
        ) : null}
        {showPin ? (
          <span
            data-testid="story-history-pin"
            className="flex items-center gap-1 text-xs font-normal text-text-secondary tabular-nums"
          >
            <Pin aria-hidden size={16} />
            {pinned.label}
          </span>
        ) : null}
      </span>
    </button>
  );
}
