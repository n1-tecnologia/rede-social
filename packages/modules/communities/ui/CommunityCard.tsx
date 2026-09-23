'use client';

import { MediaImage } from '@tria/core/ui';
import { Card } from '@tria/ui';
import { ChevronRight, MessageCircle } from 'lucide-react';

/**
 * The `card-magazine` list card (UI-D-42), ported from the prototype onto the shipped `Card`.
 *
 * Presentational and props-only, the `PostHeader` posture: it fetches nothing, formats no date,
 * resolves no URL and **ships no words** (PWA-03) — the host passes `href`, every label and the
 * already-formatted post-count string. A plain `<a>`, never `next/link`: a module must not depend on
 * the framework (MOD-02).
 *
 * **There is no owner byline, and there must never be one** (D-67). The organisation owns the
 * container and every post inside it already shows a face; a second byline here would compete with
 * the real one and invent an authorship claim the product does not make. `created_by_user_id` is
 * stored on the row and never projected, so there is nothing to render even if a caller asked.
 *
 * **Three things the prototype has that this card deliberately does not** (D-75, UI-D-42): the
 * activity badge, the member count and the "last activity" timestamp. `last_activity_at` exists for
 * ORDERING; printing it would invite the read-marker semantics D-75 just refused. The prototype's
 * `text-accent` glyph tint is normalised to neutral as well — Phase 2's rule is that idle icons are
 * never brand.
 *
 * **Truncation is CSS only** (`truncate`, `line-clamp-1`). There is no `.slice()` of `name` or
 * `description` anywhere in this file, so a multi-byte grapheme can never be split (edge: encoding).
 */
export interface CommunityCardProps {
  /** Built by the HOST (`/comunidades/{id}`), never assembled inside the module. */
  href: string;
  name: string;
  description: string;
  /** Null, or an asset whose ladder the payload declared. Null takes the gradient branch (D-69). */
  coverAssetId: string | null;
  /** The variant ladder `MediaImage` builds its `srcSet` from (R-06) — never a hand-written list. */
  coverVariantWidths: readonly number[];
  /** Already formatted and pluralised by the host ("3 publicações"); the module ships no words. */
  postCountLabel: string;
  /** `alt` of the cover image, composed by the host from its own catalog. */
  coverAlt: string;
}

/** `sizes` for a full-bleed card in the 680px column: the viewport up to the column's own cap. */
const COVER_SIZES = '(min-width: 680px) 680px, 100vw';

export function CommunityCard({
  href,
  name,
  description,
  coverAssetId,
  coverVariantWidths,
  postCountLabel,
  coverAlt,
}: CommunityCardProps) {
  /**
   * The name and description overlay, shared by both cover branches so the two can never drift apart
   * in size, weight or position. 16/700 for the name, `line-clamp-1` for the description.
   */
  const overlay = (
    <div className="absolute right-4 bottom-3 left-4">
      <p className="truncate text-base font-bold text-white">{name}</p>
      {description ? (
        <p className="line-clamp-1 text-xs font-normal text-white/80">{description}</p>
      ) : null}
    </div>
  );

  /**
   * D-69 / UI-D-35: a cover-less community renders the `--brand-gradient` block carrying its own
   * name — never `bg-tertiary`, never a broken-image glyph, and deliberately **no black veil**: the
   * gradient already carries its contrast against the persisted `--brand-on-primary` ink, so a scrim
   * on top would only darken a surface that is already accessible on a tenant hex nobody has seen.
   *
   * The gradient and its ink are INLINE STYLES because both are runtime tenant variables with no
   * Tailwind class; that is the same reason `PostMedia` sets its aspect ratio inline.
   */
  const gradientCover = (
    <div
      data-testid="community-cover-fallback"
      className="relative flex aspect-[16/7] w-full items-end"
      style={{ backgroundImage: 'var(--brand-gradient)' }}
    >
      <div
        className="absolute right-4 bottom-3 left-4"
        style={{ color: 'var(--brand-on-primary)' }}
      >
        <p className="truncate text-base font-bold">{name}</p>
        {description ? (
          <p className="line-clamp-1 text-xs font-normal opacity-80">{description}</p>
        ) : null}
      </div>
    </div>
  );

  /**
   * The image branch keeps the prototype's veil, which is what makes white type legible over an
   * arbitrary photograph. `MediaImage`'s own error path degrades to the neutral `bg-bg-tertiary`
   * ground rather than a broken-image glyph, so a deleted or cross-tenant cover still reads as a
   * card with a name on it.
   */
  const imageCover =
    coverAssetId !== null ? (
      <div data-testid="community-cover-image" className="relative aspect-[16/7] w-full">
        <MediaImage
          assetId={coverAssetId}
          widths={coverVariantWidths}
          alt={coverAlt}
          sizes={COVER_SIZES}
          ratio=""
          className="h-full w-full"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
        {overlay}
      </div>
    ) : null;

  return (
    <Card>
      <a
        href={href}
        data-testid="community-card"
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        {imageCover ?? gradientCover}

        {/* The counts row: the post count and nothing else. No member count, no activity badge, no
            timestamp (D-75). `tabular-nums` keeps the digits from shifting as the count grows. */}
        <div className="flex items-center gap-2 px-4 py-3">
          <MessageCircle size={16} aria-hidden className="shrink-0 text-text-tertiary" />
          <span className="min-w-0 flex-1 truncate text-xs font-normal text-text-tertiary tabular-nums">
            {postCountLabel}
          </span>
          <ChevronRight size={18} aria-hidden className="shrink-0 text-text-tertiary" />
        </div>
      </a>
    </Card>
  );
}
