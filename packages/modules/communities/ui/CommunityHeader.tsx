'use client';

import type { ReactNode } from 'react';
import { CommunityCover } from './CommunityCover';

/**
 * The community page's header (UI-D-43): the `h-36` cover (or the UI-D-35 gradient block), a 44x44
 * back control over it, then the community name at the Title role and the description.
 *
 * **D-67's three drops are the point of this component, not an omission.** The prototype draws an
 * overlapping avatar, a human credit line and a verification badge under the cover. None of them is
 * ported and none may be added later: the organisation owns the container, and D-52 already puts a
 * face on every post inside it, so a byline here would compete with the real one and invent an
 * authorship claim the product does not make. `created_by_user_id` is stored on the row and never
 * projected, so there is nothing to render even if a caller asked.
 *
 * **The name WRAPS and must never be clipped.** With the avatar gone it has the full width and
 * becomes the page's single anchor, so it takes the Title role (24/700, `tracking-[-0.02em]`) the
 * same way `ProfileHeader`'s name did in Phase 3. `truncate` or `line-clamp` here would hide the one
 * string the screen exists to name. The description wraps freely for the same reason.
 *
 * **The back control is a LINK, not a `<button>`.** Leaving a community is a navigation, and this
 * repo's rule is that a navigation is an `<a>` even when it looks like an icon button (the same
 * reason `ComposeFab` is a link). The geometry is `IconButton`'s — 44x44 minimum (UI-D-07, the
 * prototype's 36px normalised) — on `bg-black/40 backdrop-blur-sm` at `top-3 left-3` so it stays
 * legible over a photograph and over the gradient alike.
 *
 * Presentational and props-only, the `PostHeader` posture: it fetches nothing, formats no date,
 * resolves no URL and ships no words (PWA-03). The pill and the note are host NODES rather than
 * strings, so the module never learns what "Arquivada" means.
 */
export interface CommunityHeaderProps {
  name: string;
  /** `''` is "no description" — the header then closes up with no reserved height (E11/empty). */
  description: string;
  /** Built by the HOST; the module knows no route table (MOD-02). */
  backHref: string;
  backLabel: string;
  coverAssetId: string | null;
  coverVariantWidths: readonly number[];
  coverAlt: string;
  /** Optional slot BESIDE the name (the neutral "Arquivada" pill, UI-D-37). */
  statusPill?: ReactNode;
  /** Optional slot UNDER the description (the archived note). */
  note?: ReactNode;
}

const BACK_CONTROL =
  'absolute top-3 left-3 z-10 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/40';

export function CommunityHeader({
  name,
  description,
  backHref,
  backLabel,
  coverAssetId,
  coverVariantWidths,
  coverAlt,
  statusPill,
  note,
}: CommunityHeaderProps) {
  return (
    <header data-community-header>
      <CommunityCover
        geometry="page"
        coverAssetId={coverAssetId}
        coverVariantWidths={coverVariantWidths}
        coverAlt={coverAlt}
      >
        <a href={backHref} aria-label={backLabel} className={BACK_CONTROL}>
          {/* The glyph is drawn rather than imported so the control needs no icon prop: a chevron
              is the one shape every back affordance in this product already uses. */}
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            width={22}
            height={22}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </a>
      </CommunityCover>

      <div className="px-4 pb-4">
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <h1
            data-community-name
            className="min-w-0 text-2xl font-bold leading-tight tracking-[-0.02em] text-text"
          >
            {name}
          </h1>
          {statusPill}
        </div>

        {/* E11/empty: an absent description renders NO node — no reserved height, no placeholder. */}
        {description ? (
          <p
            data-testid="community-description"
            className="mt-2 text-sm font-normal leading-relaxed text-text-secondary"
          >
            {description}
          </p>
        ) : null}

        {note ? <div className="mt-2 text-sm font-normal text-text-secondary">{note}</div> : null}
      </div>
    </header>
  );
}
