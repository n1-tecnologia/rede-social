'use client';

import { MediaImage } from '@tria/core/ui';
import { Avatar, cn } from '@tria/ui';
import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The 64x64 ring + thumbnail + label unit (UI-D-27, UI-D-28) — the whole of the strip's vocabulary,
 * and the same unit 05-08's community "Destaques" row reuses with another ring.
 *
 * Presentational and props-only, the `CommunityCard` posture: it fetches nothing, formats no date,
 * resolves no URL and **ships no words** (PWA-03). A plain `<a>`, never `next/link`: a module must
 * not depend on the framework (MOD-02).
 *
 * **THREE THINGS A REVIEWER MUST NOT "FIX":**
 *
 * 1. **There is no seen/unseen state, and there must never be one** (D-79). Every circle in a given
 *    row is identical to every other; expiry, pinned state and seen state are all invisible. What
 *    tells a member what is new is the ORDER, newest first (UI-D-27). A ring that remembered whether
 *    somebody had watched would quietly turn watching a story into a tracked act performed on a
 *    member by their own organisation — which is exactly what the phase's prohibition forbids.
 * 2. **`label` is a STRING the host already formatted** (UI-D-14). There is no `Date.now()` and no
 *    `new Date()` in this file: a clock in render is a hydration mismatch and a per-second
 *    re-render, and the server is where the relative time is computed.
 * 3. **The `own` variant is an ANCHOR, never a button** (UI-D-28). `/stories/publicar` is a
 *    full-screen ROUTE that must not live in a dismissible layer — the same reason `ComposeFab` is
 *    a link.
 *
 * `onOpen` is OPTIONAL on purpose. 05-06 owns the viewer; until that route exists a circle renders
 * as an inert `<span>` rather than as a button that does nothing when tapped. Supplying the handler
 * is the whole of what turns the row interactive, and nothing here has to change for it.
 */

/** Which ring a circle wears. `own` is the admin's avatar + `Plus` badge (UI-D-28). */
export type StoryCircleVariant = 'brand' | 'neutral' | 'own';

export interface StoryCircleProps {
  /** `brand` in the `/inicio` strip, `neutral` on a community page, `own` for the publish door. */
  variant: StoryCircleVariant;
  /** 12/400 tertiary, truncated. ALREADY FORMATTED by the host (UI-D-14) — never derived here. */
  label: string;
  /** Accessible name of the control ("Abrir story de há 2 h" / "Publicar um story"). */
  actionLabel: string;
  /** The thumbnail asset; null renders the neutral glyph ground (UI empty/E02). */
  assetId?: string | null;
  /** The variant ladder `MediaImage` builds its `srcSet` from (R-06) — never a hand-written list. */
  variantWidths?: readonly number[];
  /** `own` only: the admin's avatar; null falls back to the shipped neutral `User` glyph. */
  avatarUrl?: string | null;
  /** `own` only: the destination the host chose (MOD-02 — the module assembles no route). */
  href?: string;
  /** Opens the viewer at this circle's index. Absent → the circle is inert (see the note above). */
  onOpen?: () => void;
  /** `true` for the first three circles only: they are above the fold on `/inicio`. */
  eager?: boolean;
}

/** The ring wrapper's border, per variant. The brand ring is a STATE indicator (UI-D-27, item 11). */
const RING: Record<StoryCircleVariant, string> = {
  brand: 'border-brand',
  neutral: 'border-border',
  own: 'border-border',
};

export function StoryCircle({
  variant,
  label,
  actionLabel,
  assetId = null,
  variantWidths = [],
  avatarUrl = null,
  href,
  onOpen,
  eager = false,
}: StoryCircleProps) {
  /**
   * The 64x64 disc itself. `bg-bg-tertiary` is the ground a missing, failed or not-yet-derived
   * thumbnail falls back to — `MediaImage` degrades to exactly that box rather than to a
   * broken-image glyph, which is what keeps UI partial/E02 true: the ring and the label survive a
   * thumbnail that never loads, so the circle never loses its place in the sequence.
   */
  const disc: ReactNode =
    variant === 'own' ? (
      <span className="relative block h-16 w-16">
        <Avatar src={avatarUrl} alt="" size="xl" className="h-16 w-16" />
        <span
          data-testid="story-own-badge"
          aria-hidden
          className="absolute right-0 bottom-0 grid h-6 w-6 place-items-center rounded-full border-2 border-bg bg-brand text-on-brand"
        >
          <Plus size={16} />
        </span>
      </span>
    ) : (
      <span className="block h-16 w-16 overflow-hidden rounded-full bg-bg-tertiary">
        {assetId === null ? null : (
          <MediaImage
            assetId={assetId}
            widths={variantWidths}
            alt=""
            sizes="64px"
            eager={eager}
            ratio="aspect-square"
            className="h-16 w-16 rounded-full"
          />
        )}
      </span>
    );

  const ring = (
    <span className={cn('block rounded-full border-2 p-0.5', RING[variant])}>{disc}</span>
  );

  const focus =
    'rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

  /**
   * Three shells, one geometry: the own-circle is an anchor, an openable circle is a button, and a
   * circle with nowhere to go yet is a plain span. All three wrap the IDENTICAL ring, so no variant
   * can drift in size or radius.
   */
  const control =
    variant === 'own' && href !== undefined ? (
      <a href={href} aria-label={actionLabel} className={cn('block', focus)}>
        {ring}
      </a>
    ) : onOpen ? (
      <button
        type="button"
        onClick={onOpen}
        aria-label={actionLabel}
        className={cn('block', focus)}
      >
        {ring}
      </button>
    ) : (
      ring
    );

  return (
    <span className="flex shrink-0 flex-col items-center gap-1.5">
      {control}
      {/* `max-w-16` matches the disc exactly, so a long label can never widen a circle's column and
          shift every circle after it. Truncation is CSS only — there is no `.slice()` of `label`
          anywhere in this file, so a multi-byte grapheme can never be split (edge: encoding). */}
      <span className="max-w-16 truncate text-xs font-normal text-text-tertiary">{label}</span>
    </span>
  );
}
