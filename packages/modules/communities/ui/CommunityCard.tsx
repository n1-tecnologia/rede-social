'use client';

import { Card } from '@rede-social/ui';
import { ChevronRight, MessageCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { CommunityCover } from './CommunityCover';

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
  /**
   * Optional slot in the counts row, between the post count and the chevron — host-supplied exactly
   * like `CommunityHeader`'s, so the module still ships no words. Today it carries the neutral
   * "Arquivada" pill on the `Arquivadas` list (D-88, UI-D-50). It lives INSIDE the card's one anchor:
   * the card stays a single tap target (D-90), and nothing about an archived card is dimmed.
   */
  statusPill?: ReactNode;
  /**
   * UI-D-372 (08.2): an over-media badge on the cover, top-left, on both cover branches — the
   * store's "Exclusiva" pill, composed by the host from the store access read (the communities
   * module stays ignorant of products). It lives inside the card's one anchor, so its text is read
   * as part of the link and adds no focus stop. Nothing else on the card changes: the cover stays
   * in colour, and the name, description and post count are the same.
   */
  coverBadge?: ReactNode;
}

export function CommunityCard({
  href,
  name,
  description,
  coverAssetId,
  coverVariantWidths,
  postCountLabel,
  coverAlt,
  statusPill,
  coverBadge,
}: CommunityCardProps) {
  /**
   * The name and description over a PHOTOGRAPH: white ink over the veil, the established over-media
   * pattern (Phase 4's carousel dots and play badge), which clears 4.5:1 by construction.
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
   * The SAME two lines over the `--brand-gradient` fallback, in the persisted `--brand-on-primary`
   * ink that `CommunityCover` applies — never `text-white` on a tenant hex nobody has seen (D-69,
   * UI-D-35). Sharing the geometry with `overlay` above is what stops the two branches drifting in
   * size, weight or position.
   */
  const fallbackOverlay = (
    <>
      <p className="truncate text-base font-bold">{name}</p>
      {description ? (
        <p className="line-clamp-1 text-xs font-normal opacity-80">{description}</p>
      ) : null}
    </>
  );

  return (
    <Card>
      <a
        href={href}
        data-testid="community-card"
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        {/* The cover is `CommunityCover` at the `card` geometry (05-04): ONE component, so the veil,
            the ratio box and the error degradation cannot drift from the community page's header. */}
        <CommunityCover
          geometry="card"
          coverAssetId={coverAssetId}
          coverVariantWidths={coverVariantWidths}
          coverAlt={coverAlt}
          overlay={overlay}
          fallbackOverlay={fallbackOverlay}
          coverBadge={coverBadge}
        />

        {/* The counts row: the post count and nothing else. No member count, no activity badge, no
            timestamp (D-75). `tabular-nums` keeps the digits from shifting as the count grows. */}
        <div className="flex items-center gap-2 px-4 py-3">
          <MessageCircle size={16} aria-hidden className="shrink-0 text-text-tertiary" />
          <span className="min-w-0 flex-1 truncate text-xs font-normal text-text-tertiary tabular-nums">
            {postCountLabel}
          </span>
          {/* `shrink-0` beside the label's `min-w-0 flex-1 truncate`: a long count truncates, the
              pill and the chevron keep their width, and the row never wraps (UI-D-50). */}
          {statusPill ? <span className="shrink-0">{statusPill}</span> : null}
          <ChevronRight size={18} aria-hidden className="shrink-0 text-text-tertiary" />
        </div>
      </a>
    </Card>
  );
}
