'use client';

import { MediaImage } from '@rede-social/core/ui';
import type { ReactNode } from 'react';

/**
 * The event cover (UI-D-201, UI-SPEC "To build"): ONE component, FOUR geometries, TWO branches.
 *
 * - `poster`: the list card, `aspect-[4/5] rounded-xl` [proto];
 * - `hero`: the detail page's card, `aspect-[16/10]` [proto];
 * - `ticket`: the check-in boarding pass, `aspect-video` [proto];
 * - `thumb`: the Início card's 64×80 thumbnail, `h-20 w-16 rounded-lg`, with no overlay and no veil.
 *
 * **Branches.** A cover asset renders `MediaImage` under the geometry's [proto] veil, which is what
 * keeps white type legible over an arbitrary photo. No cover (D-69) renders the `--brand-gradient`
 * block, whose `fallbackOverlay` is drawn in the persisted `--brand-on-primary` ink with NO scrim:
 * the pair already clears 4.5:1, so a scrim would only darken an accessible surface (UI-D-35).
 *
 * **`grayscale` applies to the PHOTO branch only** (UI-D-202, the cancelled texture). The gradient is
 * the tenant's own colour and never desaturates; the text and veil are unchanged, so contrast is too.
 *
 * Every branch is the SAME explicit box, so loading, loaded and failed differ in ink only (the
 * Phase 3 CLS rule). Presentational and props-only: it fetches nothing, resolves no URL and ships no
 * words (PWA-03). The gradient and its ink are inline styles because both are runtime tenant
 * variables with no Tailwind class.
 */
export type EventCoverGeometry = 'poster' | 'hero' | 'ticket' | 'thumb';

export interface EventCoverProps {
  geometry: EventCoverGeometry;
  /** Null takes the `--brand-gradient` branch (D-69). */
  coverAssetId: string | null;
  /** The variant ladder `MediaImage` builds its `srcSet` from — never a hand-written list. */
  coverVariantWidths: readonly number[];
  coverAlt: string;
  /** Desaturates the photograph (a cancelled event, UI-D-202). Ignored on the gradient branch. */
  grayscale?: boolean;
  /** The first posters of a list load eagerly; the rest are `loading="lazy" decoding="async"`. */
  eager?: boolean;
  /** Rendered over the PHOTOGRAPH, above the veil. Never rendered on `thumb`. */
  overlay?: ReactNode;
  /** Rendered over the GRADIENT, in the `--brand-on-primary` ink. Never rendered on `thumb`. */
  fallbackOverlay?: ReactNode;
  /** A free slot pinned inside the box on BOTH branches (the poster's pill). */
  children?: ReactNode;
}

const BOX = {
  poster: 'relative aspect-[4/5] w-full overflow-hidden rounded-xl',
  hero: 'relative aspect-[16/10] w-full overflow-hidden',
  ticket: 'relative aspect-video w-full overflow-hidden',
  thumb: 'relative h-20 w-16 shrink-0 overflow-hidden rounded-lg',
} as const;

/** The prototype's veils, verbatim per surface. `thumb` has none: it carries no text. */
const VEIL = {
  poster: 'absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent',
  hero: 'absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent',
  ticket: 'absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent',
  thumb: null,
} as const;

/** `sizes` per geometry: the poster is at most one of two ~340px columns, the others fill 680px. */
const SIZES = {
  poster: '(min-width: 640px) 340px, 100vw',
  hero: '(min-width: 680px) 680px, 100vw',
  ticket: '(min-width: 680px) 680px, 100vw',
  thumb: '64px',
} as const;

export function EventCover({
  geometry,
  coverAssetId,
  coverVariantWidths,
  coverAlt,
  grayscale = false,
  eager = false,
  overlay,
  fallbackOverlay,
  children,
}: EventCoverProps) {
  const texted = geometry !== 'thumb';

  if (coverAssetId !== null) {
    const veil = VEIL[geometry];
    return (
      <div data-testid="event-cover-image" data-geometry={geometry} className={BOX[geometry]}>
        {/* The wrapper carries the test id and the grayscale filter: `MediaImage` takes neither a
            data attribute nor a filter, and the BRANCH is what a test asserts. */}
        <span
          data-testid="event-cover-media"
          className={grayscale ? 'block h-full w-full grayscale' : 'block h-full w-full'}
        >
          <MediaImage
            assetId={coverAssetId}
            widths={coverVariantWidths}
            alt={coverAlt}
            sizes={SIZES[geometry]}
            eager={eager}
            ratio=""
            className="h-full w-full"
          />
        </span>
        {veil ? <div aria-hidden className={veil} /> : null}
        {texted ? overlay : null}
        {children}
      </div>
    );
  }

  return (
    <div
      data-testid="event-cover-fallback"
      data-geometry={geometry}
      className={BOX[geometry]}
      style={{ backgroundImage: 'var(--brand-gradient)' }}
    >
      {texted && fallbackOverlay ? (
        <div className="absolute inset-0" style={{ color: 'var(--brand-on-primary)' }}>
          {fallbackOverlay}
        </div>
      ) : null}
      {children}
    </div>
  );
}
