// biome-ignore-all lint/a11y/useSemanticElements: the carousel container and each slide are
// `role="group"` per UI-SPEC §Feed surface contract "Gallery". Biome proposes `<fieldset>`, which is
// a FORM grouping — it would announce a photograph as a set of form controls.
'use client';

import { MediaImage } from '@tria/core/ui';
import { cn, DoubleTapHeart, useToast } from '@tria/ui';
import { type KeyboardEvent, type ReactNode, useCallback, useRef, useState } from 'react';
import { type AttachmentDescriptor, AttachmentRow } from './AttachmentRow';
import { LinkPreviewCard, type LinkPreviewCardProps } from './LinkPreviewCard';

/**
 * The post's media band: one of THREE branches (D-53) — an image gallery, one video, or nothing —
 * each optionally followed by the attachment list. Gallery and video are mutually exclusive by
 * database constraint (`feed_post_media_kind_fk`), by composer rule and by this renderer, so a post
 * can never present both.
 *
 * **`MediaImage` is imported, the player is INJECTED.** A module package may not import from
 * `apps/web` (MOD-02). `MediaImage` depends only on `@tria/contracts/media` and `@tria/ui`, so it was
 * promoted into `@tria/core/ui` and is imported here. `VideoPlayer` was NOT promoted: it binds an
 * app-scoped server action for its per-request playback token (D-44) and the next-intl catalog, so
 * it arrives as `video` — an ALREADY-CREATED client element, which crosses the RSC boundary safely
 * (a component object is what 02-08 found Flight refuses).
 *
 * Presentational, the `FeedList` posture: it fetches nothing, formats no size and resolves no URL.
 * Every label arrives as a prop, so the module ships no language (PWA-03).
 */
export type PostMediaImage = {
  assetId: string;
  /** The variant ladder the payload declares (R-06) — never a hand-written width list. */
  variantWidths: readonly number[];
  /** The asset's alt text; `''` when the admin gave none (decorative, never a filename). */
  alt: string;
  /** Already interpolated by the host: "1 de 3". Also what the live region announces. */
  label: string;
  /** Stored intrinsic size. Only the FIRST image's is read — UI-D-09's shared-ratio rule. */
  width: number | null;
  height: number | null;
};

export type PostMediaLabels = {
  /** `aria-roledescription` for the strip — "carrossel". */
  carousel: string;
  /** The generic message the host's toast carries when an attachment download fails (UI-D-23). */
  attachmentError: string;
};

export type PostMediaProps = {
  /** The PARENT's own discriminator, never a count over `media`: a PDF-only post is still `none`. */
  mediaKind: 'none' | 'gallery' | 'video';
  images: readonly PostMediaImage[];
  /** The already-created player element; absent for every other branch. */
  video?: ReactNode;
  attachments: readonly AttachmentDescriptor[];
  /**
   * MEDIA-04. Absent when the post carries no link, and — because the server projects a preview
   * ONLY once it has resolved — also absent while one is pending, failed or refused. The card
   * itself returns null for a non-resolved status as well, so the "no pending card" rule (UI-D-11)
   * holds at both ends and the post renders the bare auto-linked URL inside its caption.
   */
  linkPreview?: LinkPreviewCardProps;
  onDoubleTapLike?: () => void;
  labels: PostMediaLabels;
};

/**
 * UI-D-09's clamp. A 4:5 portrait is the tallest a post image may be and 1.91:1 the widest, so a
 * 9:16 phone photo cannot eat a whole screen and a panorama cannot become a letterbox sliver.
 */
const MIN_RATIO = 4 / 5;
const MAX_RATIO = 1.91;
/** What an asset with no stored dimensions renders at — square, never "collapse to nothing". */
const FALLBACK_RATIO = 1;

/** The card's column is 680px on desktop (D-39) and the viewport width on a phone. */
const GALLERY_SIZES = '(min-width: 768px) 680px, 100vw';

/**
 * ONE ratio for the whole gallery, computed from the FIRST image and clamped (UI-D-09). Reading each
 * slide's own ratio would make the strip jump on every swipe, which is the worst version of the CLS
 * contract Phase 3 established.
 */
function sharedRatio(images: readonly PostMediaImage[]): number {
  const first = images[0];
  if (!first || first.width === null || first.height === null) return FALLBACK_RATIO;
  if (first.width <= 0 || first.height <= 0) return FALLBACK_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, first.width / first.height));
}

export function PostMedia({
  mediaKind,
  images,
  video,
  attachments,
  linkPreview,
  onDoubleTapLike,
  labels,
}: PostMediaProps): ReactNode {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const lastIndex = Math.max(0, images.length - 1);

  /** The active slide follows the SCROLL POSITION, so a swipe and a key press agree by construction. */
  const onScroll = useCallback(() => {
    const strip = stripRef.current;
    if (!strip || strip.clientWidth === 0) return;
    const index = Math.round(strip.scrollLeft / strip.clientWidth);
    setActive(Math.min(Math.max(index, 0), Math.max(0, images.length - 1)));
  }, [images.length]);

  const goTo = useCallback(
    (index: number) => {
      const clamped = Math.min(Math.max(index, 0), Math.max(0, images.length - 1));
      setActive(clamped);
      const strip = stripRef.current;
      // Guarded: a zero-width strip (a pre-layout render, or a unit test's DOM) has nothing to
      // scroll, and the state above is already the truth the live region reads.
      if (strip && typeof strip.scrollTo === 'function' && strip.clientWidth > 0) {
        strip.scrollTo({ left: clamped * strip.clientWidth, behavior: 'smooth' });
      }
    },
    [images.length],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      // The ends are hard stops: a swipe cannot wrap around, so the keys must not either.
      goTo(active + (event.key === 'ArrowRight' ? 1 : -1));
    },
    [active, goTo],
  );

  const ratio = sharedRatio(images);

  const slide = (image: PostMediaImage, index: number) => (
    <div
      key={`${image.assetId}-${index}`}
      // UI-SPEC §Feed surface contract "Gallery": each slide is a group carrying the generated
      // "{i} de {n}" name. `<fieldset>` is a FORM grouping and would announce a photograph as a set
      // of form controls.
      role="group"
      aria-label={image.label}
      data-testid="post-gallery-slide"
      // The ratio is a RUNTIME value derived from the asset, so it is an inline style rather than a
      // Tailwind class (a dynamic `aspect-[w/h]` would never be compiled). `data-ratio` makes the
      // shared-ratio rule observable instead of merely "nothing visibly jumped".
      data-ratio={ratio}
      style={{ aspectRatio: String(ratio) }}
      className="w-full shrink-0 snap-center bg-bg-secondary"
    >
      <MediaImage
        assetId={image.assetId}
        widths={image.variantWidths}
        alt={image.alt}
        sizes={GALLERY_SIZES}
        // The BOX already carries the ratio, so the image just fills it; `MediaImage`'s own error
        // path then degrades to the neutral `bg-bg-tertiary` ground, never a broken-image glyph.
        ratio=""
        className="h-full w-full"
      />
    </div>
  );

  const attachmentList =
    attachments.length > 0 ? (
      <AttachmentList attachments={attachments} errorMessage={labels.attachmentError} />
    ) : null;

  // Under the media band in every branch — including `none`, where a link-only post is still a
  // caption with a card beneath it.
  const linkCard = linkPreview ? <LinkPreviewCard {...linkPreview} /> : null;

  // The player is returned BARE, with no gesture wrapper around it: a double tap on a video is a
  // SEEK gesture, not a like (UI-SPEC §Video). The keyboard/AT path to the like is the LikeButton
  // beside the card. A grep gate in 04-04's plan pins this branch as wrapper-free.
  if (mediaKind === 'video' && video !== undefined) {
    return (
      <>
        <div data-testid="post-video" className="w-full">
          {video}
        </div>
        {attachmentList}
        {linkCard}
      </>
    );
  }

  if (mediaKind === 'gallery' && images.length > 0) {
    return (
      <>
        <DoubleTapHeart onDoubleTap={onDoubleTapLike}>
          {images.length === 1 ? (
            slide(images[0] as PostMediaImage, 0)
          ) : (
            <>
              <div
                ref={stripRef}
                // The carousel container is a group with a role DESCRIPTION, per UI-SPEC;
                // `<fieldset>` carries form semantics that are wrong here.
                role="group"
                aria-roledescription={labels.carousel}
                // UI-SPEC §Motion & Accessibility requires the strip to be a tab stop, so the arrow
                // keys below can move one slide: a scroll container with no keyboard path is
                // exactly the gap this closes.
                // biome-ignore lint/a11y/noNoninteractiveTabindex: see the note above
                tabIndex={0}
                onScroll={onScroll}
                onKeyDown={onKeyDown}
                data-testid="post-gallery-strip"
                className="flex w-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset [&::-webkit-scrollbar]:hidden"
              >
                {images.map(slide)}
              </div>

              {/* UI-D-10: white on a fixed scrim, NEVER the accent — a tenant hex over an arbitrary
                  photograph has no guaranteed contrast. `pointer-events-none` keeps the dots out of
                  the swipe. */}
              <div
                data-testid="post-gallery-dots"
                aria-hidden
                className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/45 px-2 py-1"
              >
                {images.map((image, index) => (
                  <span
                    // A dot IS a position, and the same asset id may legitimately appear twice in
                    // one gallery, so the index is the only stable identity this decorative row has.
                    // biome-ignore lint/suspicious/noArrayIndexKey: see the note above
                    key={`${image.assetId}-dot-${index}`}
                    data-testid="post-gallery-dot"
                    data-active={index === active}
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      index === active ? 'bg-white' : 'bg-white/45',
                    )}
                  />
                ))}
              </div>
            </>
          )}

          {/* The only text the carousel chrome carries, and it is GENERATED ("{i} de {n}"), so no
              user string can grow it (UI-SPEC E04 long-text/overflow). */}
          <span data-testid="post-gallery-live" aria-live="polite" className="sr-only">
            {images[Math.min(active, lastIndex)]?.label ?? ''}
          </span>
        </DoubleTapHeart>
        {attachmentList}
        {linkCard}
      </>
    );
  }

  // `none` — no media frame at all, so the caption becomes the card's anchor. Attachments and the
  // link card still render: a `kind = 'file'` row constrains the parent's discriminator not at all,
  // and a link-only post has no media by definition.
  if (attachmentList === null && linkCard === null) return null;
  return (
    <>
      {attachmentList}
      {linkCard}
    </>
  );
}

/**
 * Mounted ONLY when there is at least one attachment, which is what lets it own `useToast` — the
 * hook throws outside a `ToastProvider`, and a media-only card must not need one. This is the
 * "host raises the generic toast" half of UI-D-23: `AttachmentRow` stays purely presentational with
 * an injected `onError`, and the message itself is still a prop, never a literal.
 */
function AttachmentList({
  attachments,
  errorMessage,
}: {
  attachments: readonly AttachmentDescriptor[];
  errorMessage: string;
}) {
  const toast = useToast();

  return (
    <ul data-testid="post-attachments" className="flex flex-col gap-2 px-4 pb-3">
      {attachments.map((attachment) => (
        <li key={attachment.assetId}>
          <AttachmentRow
            attachment={attachment}
            onError={() => toast.show({ tone: 'error', message: errorMessage })}
          />
        </li>
      ))}
    </ul>
  );
}
