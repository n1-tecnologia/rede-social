'use client';

import { MediaImage } from '@rede-social/core/ui';
import type { ReactNode } from 'react';

/**
 * The community cover (UI-D-35, D-69) — ONE component, TWO geometries, TWO branches.
 *
 * **Why one component and not two.** The list card and the community page draw the same object at
 * two sizes, and the only thing that genuinely differs between them is what the cover-less fallback
 * carries. Extracting this out of `CommunityCard` is what stops a later change to the veil, the
 * ratio box or the error degradation landing on one surface and not the other.
 *
 * **The asymmetry IS UI-D-35, and it must not be "fixed".** On the CARD the name is always overlaid
 * on the cover, so a cover-less card would be a nameless coloured block unless the fallback carried
 * it. On the PAGE the name always renders BELOW the cover, so a fallback that carried text there
 * would print the name twice. Hence `fallbackOverlay` is rendered on the `card` geometry only, and
 * the rule lives HERE rather than at two call sites that could drift.
 *
 * **The gradient branch carries NO black scrim.** `--brand-gradient` already carries its contrast
 * against the persisted `--brand-on-primary` ink (Phase 2 persists that pair at >= 4.5:1), so a
 * scrim on top would only darken a surface that is already accessible on a tenant hex nobody has
 * seen. The photograph branch keeps the prototype's veil, which is what makes white type legible
 * over an arbitrary image.
 *
 * **Layout never moves.** Both branches are the SAME explicit box — `aspect-[16/7]` on the card,
 * `h-36` on the page — so loading, loaded and failed differ in ink only (the Phase 3 CLS rule).
 * `MediaImage`'s own error path degrades to the neutral `bg-bg-tertiary` ground rather than a
 * broken-image glyph, so a deleted or cross-tenant cover still reads as a cover-shaped block.
 *
 * Presentational and props-only: it fetches nothing, resolves no URL and ships no words (PWA-03).
 * The gradient and its ink are INLINE STYLES because both are runtime tenant variables with no
 * Tailwind class — the same reason `PostMedia` sets its aspect ratio inline.
 */

/** `card` → the list card's `aspect-[16/7]` block · `page` → the community page's `h-36` block. */
export type CommunityCoverGeometry = 'card' | 'page';

export interface CommunityCoverProps {
  geometry: CommunityCoverGeometry;
  /** Null takes the `--brand-gradient` branch (D-69). */
  coverAssetId: string | null;
  /** The variant ladder `MediaImage` builds its `srcSet` from (R-06) — never a hand-written list. */
  coverVariantWidths: readonly number[];
  coverAlt: string;
  /**
   * The picture the admin just chose, as a local object URL (2026-10-06): shown in place of the
   * served image while the form's new cover is still being derived (its ladder is empty until then).
   * Only the form passes it; a member always sees the served image.
   */
  previewUrl?: string | null;
  /** Rendered over the PHOTOGRAPH, above the veil (the card's name and description). */
  overlay?: ReactNode;
  /** Rendered inside the GRADIENT fallback, in the persisted contrast ink. `card` geometry only. */
  fallbackOverlay?: ReactNode;
  /** A free slot pinned inside the box on BOTH branches (the page's back control). */
  children?: ReactNode;
}

/** `sizes` for a full-bleed cover in the 680px column: the viewport up to the column's own cap. */
const COVER_SIZES = '(min-width: 680px) 680px, 100vw';

const BOX = {
  card: 'relative aspect-[16/7] w-full',
  page: 'relative h-36 w-full',
} as const;

/**
 * The prototype's two veils, verbatim. The card's is darker because its name sits ON the image at
 * 16/700; the page's only has to keep a back control legible.
 */
const VEIL = {
  card: 'absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent',
  page: 'absolute inset-0 bg-gradient-to-t from-black/70 to-transparent',
} as const;

export function CommunityCover({
  geometry,
  coverAssetId,
  coverVariantWidths,
  coverAlt,
  previewUrl,
  overlay,
  fallbackOverlay,
  children,
}: CommunityCoverProps) {
  if (coverAssetId !== null) {
    return (
      <div data-testid="community-cover-image" data-geometry={geometry} className={BOX[geometry]}>
        {/* The wrapper carries the test id because `MediaImage` takes no data attributes, and the
            BRANCH — not a loaded bitmap — is what a test may assert: an object the lane cannot see
            degrades inside this same box to the neutral ground, by design. */}
        <span data-testid="community-cover-media" className="block h-full w-full">
          {previewUrl ? (
            // A local object URL of the file being uploaded: a plain `<img>`, as next/image cannot load it.
            <img
              src={previewUrl}
              alt={coverAlt}
              data-cover-local-preview
              className="h-full w-full object-cover"
            />
          ) : (
            <MediaImage
              assetId={coverAssetId}
              widths={coverVariantWidths}
              alt={coverAlt}
              sizes={COVER_SIZES}
              ratio=""
              className="h-full w-full"
            />
          )}
        </span>
        <div aria-hidden className={VEIL[geometry]} />
        {overlay}
        {children}
      </div>
    );
  }

  return (
    <div
      data-testid="community-cover-fallback"
      data-geometry={geometry}
      className={`${BOX[geometry]} flex items-end`}
      style={{ backgroundImage: 'var(--brand-gradient)' }}
    >
      {/* UI-D-35: text on the CARD only. The page's name renders below the cover, always. */}
      {geometry === 'card' && fallbackOverlay ? (
        <div
          className="absolute right-4 bottom-3 left-4"
          style={{ color: 'var(--brand-on-primary)' }}
        >
          {fallbackOverlay}
        </div>
      ) : null}
      {children}
    </div>
  );
}
