'use client';

import { MediaImage } from '@rede-social/core/ui';
import { cn } from '@rede-social/ui';
import { Plus } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * The 64x64 ring + disc + label unit (UI-D-27, UI-D-28, UI-D-59..UI-D-63) — the whole of the row's
 * vocabulary on `/inicio` and on a community page, and the one shape 05.2's highlight screens reuse.
 *
 * **The ring and the disc are independent props.** The ring says what a circle MEANS to the viewer
 * (`brand` = the tenant circle, `neutral` = an archive, `dashed` = "only you see this", UI-D-63); the
 * disc says what it SHOWS (a story thumbnail, the admin's publish `Plus`, the tenant logo, a
 * monogram, a host glyph). Every combination keeps the identical 64px geometry, so no circle can
 * drift in size.
 *
 * **UI-D-28, amended 2026-10-02: the publish door is a centred `Plus`, not the admin's photo.** The
 * `own` disc used to be the admin's avatar with a 24px brand `Plus` badge in its corner. The
 * client's adjustments asked for the language of the row's manage circle (at the other end of the
 * row) instead: the `Plus` (20px, the size of the manage `Pencil`) centred on the tertiary ground,
 * with no photo and no badge. The `Plus` is drawn HERE rather than passed in like the manage
 * glyph, so `{ kind: 'own' }` stays plain data that a server component (the Início slot, a
 * community page) can build. Every host pairs it with the dashed ring: only a publisher ever sees
 * this circle (UI-D-63).
 *
 * **UI-D-60, amended 2026-10-03 (the client's item #2b): the tenant circle wears a FACE.** The
 * `photo` disc is the profile photo of whoever published the tenant's newest live story — the
 * owner's face rather than the logo — cover-cropped to the whole 64px disc, the way the `own` disc
 * used to show the admin's avatar. It carries its own `fallback`, the tenant identity the circle
 * wore before (the logo, or the monogram), and swaps to it when the photo cannot be fetched (an
 * expired redirect, a photo the author has since replaced): the circle never shows a broken image,
 * and never an empty ring. The accessible name is unchanged — it is the host's `actionLabel` on the
 * control, so the photo is `alt=""` like every other disc.
 *
 * Presentational and props-only, the `CommunityCard` posture: it fetches nothing, formats no date,
 * resolves no URL and **ships no words** (PWA-03). A plain `<a>`, never `next/link`: a module must
 * not depend on the framework (MOD-02).
 *
 * **THREE THINGS A REVIEWER MUST NOT "FIX":**
 *
 * 1. **The seen state exists (D-105), but it lives on the SERVER and shows ONLY on the tenant
 *    circle** — as the host's choice of `ring` (brand while something is unseen) and of the
 *    `actionLabel` it passes (UI-D-61, WCAG 1.4.1: never colour alone). This component stores,
 *    derives and remembers nothing about who watched what. A highlight circle NEVER carries it: a
 *    highlight is an archive, and its ring is always neutral (UI-D-61).
 * 2. **`label` is a STRING the host already formatted** (UI-D-14). There is no `Date.now()` and no
 *    `new Date()` in this file: a clock in render is a hydration mismatch and a per-second
 *    re-render, and the server is where the relative time is computed.
 * 3. **A circle with a route is an ANCHOR, never a button** (UI-D-28, UI-D-63). `/stories/publicar`
 *    and the manage screens are full-screen ROUTES that must not live in a dismissible layer — the
 *    same reason `ComposeFab` is a link.
 *
 * `onOpen` is OPTIONAL on purpose. A circle with nowhere to go yet renders as an inert `<span>`
 * rather than as a button that does nothing when tapped. Supplying the handler is the whole of what
 * turns it interactive, and nothing here has to change for it.
 */

/** What the circle's ring means (UI-D-61, UI-D-63). Independent of the disc. */
export type StoryCircleRing = 'brand' | 'neutral' | 'dashed';

/**
 * What a `photo` disc shows when its photo cannot be fetched: the tenant identity the circle wore
 * before the photo (UI-D-60) — plain data, so a server component can still build the whole disc.
 */
export type StoryPhotoFallback = { kind: 'logo'; src: string } | { kind: 'monogram'; text: string };

/** What the 64px disc shows. Every kind renders at the identical geometry. */
export type StoryCircleDisc =
  /** A story or highlight cover; `assetId: null` is the neutral `bg-bg-tertiary` ground. */
  | { kind: 'asset'; assetId: string | null; variantWidths: readonly number[] }
  /** The admin's publish door: a centred `Plus` on the tertiary ground (UI-D-28, amended). */
  | { kind: 'own' }
  /** The tenant logo, whole, `object-contain` in a 48px box (UI-D-60). */
  | { kind: 'logo'; src: string }
  /** The gradient initial for a logo-less tenant or a cover-less highlight (UI-D-60, UI-D-62). */
  | { kind: 'monogram'; text: string }
  /**
   * A person's photo, cover-cropped to the whole disc — the face of the tenant's newest story's
   * author (UI-D-60 as amended, #2b). `src` is the stable `/v1/media/{assetId}/w128` path the API
   * projected; `fallback` is what shows when it cannot be fetched.
   */
  | { kind: 'photo'; src: string; fallback: StoryPhotoFallback }
  /** A host-passed icon on the tertiary ground — the manage circle (UI-D-63). */
  | { kind: 'glyph'; icon: ReactNode };

export interface StoryCircleProps {
  ring: StoryCircleRing;
  disc: StoryCircleDisc;
  /** 12/400 tertiary, truncated. ALREADY FORMATTED by the host (UI-D-14) — never derived here. */
  label: string;
  /** Accessible name of the control ("Abrir stories de {tenant}" / "Publicar um story"). */
  actionLabel: string;
  /** The destination the host chose (MOD-02 — the module assembles no route). Makes an `<a>`. */
  href?: string;
  /** Opens the viewer at this circle. Absent → the circle is inert (see the note above). */
  onOpen?: () => void;
  /** `true` for the first three circles only: they are above the fold on `/inicio`. */
  eager?: boolean;
}

/** The ring wrapper's border, per ring. The brand ring is a STATE indicator (UI-D-61, item 11). */
const RING: Record<StoryCircleRing, string> = {
  brand: 'border-brand',
  neutral: 'border-border',
  dashed: 'border-dashed border-border-secondary',
};

/**
 * The first user-perceived character of `text`, upper-cased — never a `.slice()`, which would split
 * a surrogate pair or a joined emoji (edge: encoding). `Intl.Segmenter` is the grapheme authority;
 * `Array.from` (code points) is the fallback on an engine without it.
 */
function firstGrapheme(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  let first: string | undefined;
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segments = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(trimmed);
    first = segments[Symbol.iterator]().next().value?.segment;
  } else {
    first = Array.from(trimmed)[0];
  }
  return (first ?? '').toLocaleUpperCase('pt-BR');
}

/** The monogram's box and type, per size. 64 is the row; 48 the manage card; 32 a sheet row. */
const MONOGRAM_SIZE: Record<32 | 48 | 64, string> = {
  32: 'h-8 w-8 text-xs',
  48: 'h-12 w-12 text-base',
  64: 'h-16 w-16 text-base',
};

export interface StoryMonogramProps {
  /** The display name or title; the monogram shows its first grapheme only. */
  text: string;
  /** 64 in the row (default), 48 on the manage card, 32 in a sheet row. */
  size?: 32 | 48 | 64;
}

/**
 * The ONE fallback shape for a tenant without a logo and a highlight without a cover (UI-D-60,
 * UI-D-62): the `--brand-gradient` disc with the first grapheme at 700 `text-on-brand uppercase`.
 * An empty text is the gradient disc with no letter. Decorative: the name lives on the control.
 */
export function StoryMonogram({ text, size = 64 }: StoryMonogramProps) {
  return (
    <span
      data-testid="story-monogram"
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-bold text-on-brand uppercase',
        MONOGRAM_SIZE[size],
      )}
      style={{ backgroundImage: 'var(--brand-gradient)' }}
    >
      {firstGrapheme(text)}
    </span>
  );
}

/** The photo's box, per size: 64 is the row's disc, 32 the viewer header's avatar slot. */
const PHOTO_SIZE: Record<32 | 64, string> = {
  32: 'h-8 w-8',
  64: 'h-16 w-16',
};

export interface StoryPhotoProps {
  /** The stable `/v1/media/{assetId}/w128` path the API projected — never a signed URL (R-05). */
  src: string;
  /** What replaces the photo when it cannot be fetched: the identity the host showed before it. */
  fallback: ReactNode;
  /** 64 in the row (default), 32 at the viewer header's avatar slot. */
  size?: 32 | 64;
  /** `true` only for a circle above the fold (the row's first three). */
  eager?: boolean;
}

/**
 * A person's photo on a story surface (#2b): the tenant circle's disc and the viewer header's
 * avatar, cover-cropped to a circle on the tertiary ground every other disc loads on. Decorative
 * (`alt=""`): the name is always the host's, on the control or beside the photo.
 *
 * **A photo that cannot be fetched is replaced by `fallback`, never shown broken** — the shipped
 * `Avatar`'s posture (UI-SPEC E9/error), with the host choosing what the fallback is (the tenant's
 * logo or monogram) instead of a generic person glyph. The failure is keyed by `src`, so a new photo
 * retries instead of inheriting the previous one's failure, and it is also read from the element on
 * mount: a server-rendered photo can fail BEFORE React hydrates, and that `error` event never reaches
 * the handler (`complete` with a zero natural width is a fetch that ended without an image).
 */
export function StoryPhoto({ src, fallback, size = 64, eager = false }: StoryPhotoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!failed && img?.complete && img.naturalWidth === 0) setFailedSrc(src);
  }, [src, failed]);

  if (failed) return <>{fallback}</>;

  return (
    <span
      data-testid="story-photo"
      className={cn('block shrink-0 overflow-hidden rounded-full bg-bg-tertiary', PHOTO_SIZE[size])}
    >
      <img
        ref={imgRef}
        src={src}
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        draggable={false}
        onError={() => setFailedSrc(src)}
        className={cn('rounded-full object-cover', PHOTO_SIZE[size])}
      />
    </span>
  );
}

/** The 64x64 disc for each kind. Every branch is `h-16 w-16`, so no kind can change the geometry. */
function Disc({ disc, eager }: { disc: StoryCircleDisc; eager: boolean }) {
  switch (disc.kind) {
    case 'photo':
      // The fallback is a whole disc of its own kind, so the swap keeps the identical geometry.
      return (
        <StoryPhoto
          src={disc.src}
          size={64}
          eager={eager}
          fallback={<Disc disc={disc.fallback} eager={eager} />}
        />
      );
    case 'own':
      // The glyph disc's exact classes and the manage `Pencil`'s size, so the publish door and the
      // manage circle read as one family (UI-D-28 as amended, see the note above). Decorative: the
      // accessible name is the host's `actionLabel`, on the anchor around it.
      return (
        <span
          data-testid="story-disc-own"
          className="grid h-16 w-16 place-items-center rounded-full bg-bg-tertiary text-text-secondary"
        >
          <Plus aria-hidden size={20} />
        </span>
      );
    case 'logo':
      // UI-D-60: logos are often wordmarks. `object-contain` in a centred 48px box (8px inset) shows
      // a wide logo whole — `object-cover` would crop the commonest tenant asset — and keeps a logo
      // with a white background off the ring. `alt=""`: the accessible name is on the control.
      return (
        <span
          data-testid="story-disc-logo"
          className="grid h-16 w-16 place-items-center overflow-hidden rounded-full bg-bg-secondary"
        >
          <span className="block h-12 w-12">
            <img src={disc.src} alt="" className="h-12 w-12 object-contain" />
          </span>
        </span>
      );
    case 'monogram':
      return <StoryMonogram text={disc.text} size={64} />;
    case 'glyph':
      return (
        <span
          data-testid="story-disc-glyph"
          className="grid h-16 w-16 place-items-center rounded-full bg-bg-tertiary text-text-secondary"
        >
          {disc.icon}
        </span>
      );
    case 'asset':
      /**
       * `bg-bg-tertiary` is the ground a missing, failed or not-yet-derived thumbnail falls back to
       * — `MediaImage` degrades to exactly that box rather than to a broken-image glyph, which is
       * what keeps UI partial/E02 true: the ring and the label survive a thumbnail that never loads.
       */
      return (
        <span className="block h-16 w-16 overflow-hidden rounded-full bg-bg-tertiary">
          {disc.assetId === null ? null : (
            <MediaImage
              assetId={disc.assetId}
              widths={disc.variantWidths}
              alt=""
              sizes="64px"
              eager={eager}
              ratio="aspect-square"
              className="h-16 w-16 rounded-full object-cover"
            />
          )}
        </span>
      );
  }
}

export function StoryCircle({
  ring,
  disc,
  label,
  actionLabel,
  href,
  onOpen,
  eager = false,
}: StoryCircleProps) {
  const ringed = (
    <span
      data-testid="story-circle-ring"
      className={cn('block rounded-full border-2 p-0.5', RING[ring])}
    >
      <Disc disc={disc} eager={eager} />
    </span>
  );

  const focus =
    'rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

  /**
   * Three shells, one geometry: a circle with a route is an anchor, an openable circle is a button,
   * and a circle with nowhere to go yet is a plain span. All three wrap the IDENTICAL ring.
   */
  const control =
    href !== undefined ? (
      <a href={href} aria-label={actionLabel} className={cn('block', focus)}>
        {ringed}
      </a>
    ) : onOpen ? (
      <button
        type="button"
        onClick={onOpen}
        aria-label={actionLabel}
        className={cn('block', focus)}
      >
        {ringed}
      </button>
    ) : (
      ringed
    );

  return (
    <span className="flex shrink-0 flex-col items-center gap-1.5">
      {control}
      {/* `max-w-16` matches the disc exactly, so a long label can never widen a circle's column and
          shift every circle after it. Truncation is CSS only — this file never cuts `label` into
          pieces, so a multi-byte grapheme can never be split (edge: encoding). */}
      <span className="max-w-16 truncate text-xs font-normal text-text-tertiary">{label}</span>
    </span>
  );
}
