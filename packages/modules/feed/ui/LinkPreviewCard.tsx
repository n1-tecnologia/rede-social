'use client';

import { MediaImage } from '@rede-social/core/ui';
import { Play } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * The link preview card (MEDIA-04, UI-SPEC E06 / UI-D-11 / UI-D-12 / UI-D-13).
 *
 * FOUR RULES THIS FILE EXISTS TO HOLD:
 *
 * 1. **It draws ONLY for a RESOLVED preview.** A pending or failed one returns null and
 *    the post renders the bare auto-linked URL already inside the caption — nothing else. There is
 *    deliberately NO skeleton: the unfurl is a worker job that may never succeed, and a skeleton
 *    that may never resolve is indistinguishable from a broken one (UI-D-11). A refused URL takes
 *    the same path, which is what makes UI-D-13's silence structural rather than a message we
 *    remembered not to write.
 * 2. **No frame until the member taps play, and only the server's frame** (08-08, UI-D-282,
 *    superseding Phase 4's "no frame element, ever"). Without `embedUrl` the card is the shipped
 *    external card, byte for byte. With it (a resolved YouTube/Vimeo preview whose URL yielded a
 *    strict id, `server/embed-url.ts`), a flat black 16:9 stage with the play disc sits above the
 *    text block; nothing third-party loads until the tap, which swaps in a sandboxed iframe
 *    (scripts, same-origin, presentation and popups only: the frame can never navigate the
 *    tenant's top-level page, T-08-42) on one of the two hosts the enforced Content Security
 *    Policy's `frame-src` names. The text block stays the external link in both variants, so "open
 *    on YouTube" still works where the inline player fails.
 * 3. **Never an HTML-injection sink** (T-04-32, the `PostCaption` rule restated). Title, description,
 *    site name and hostname are UNTRUSTED REMOTE METADATA rendered as plain text through React's
 *    default escaping. No raw-HTML escape hatch appears here or anywhere under
 *    `packages/modules/feed/ui/**`.
 * 4. **The image is an ASSET REFERENCE, never a remote URL.** It renders through `MediaImage` over
 *    `/v1/media/{assetId}/{variant}`; a remote thumbnail is never injected into the DOM, which is
 *    why `imageAssetId` is null in V1 and the card simply renders body-only (see
 *    `server/unfurl/job.ts`).
 *
 * Presentational, the `PostMedia` posture: it fetches nothing, parses no URL (the host is projected
 * server-side) and ships no language — every label is a prop (PWA-03).
 */
export type LinkPreviewView = {
  status: 'pending' | 'resolved' | 'failed';
  /** The external target. Already validated to `http:`/`https:` server-side. */
  url: string;
  hostname: string;
  title: string | null;
  description: string | null;
  /** 'youtube' | 'vimeo' — drives the play badge and the meta slot (UI-D-12). */
  provider: 'youtube' | 'vimeo' | null;
  imageAssetId: string | null;
  /** The variant ladder for `imageAssetId`; empty when there is no image. */
  imageVariantWidths: readonly number[];
  /** 08-08: the server-computed inline player URL (UI-D-282); absent → the shipped external card. */
  embedUrl?: string;
};

export type LinkPreviewCardProps = {
  preview: LinkPreviewView;
  /** The link's accessible name, already interpolated by the host's catalog. */
  ariaLabel: string;
  /** "YouTube" / "Vimeo" — what the meta slot reads when `provider` is set. */
  providerLabel?: string;
  /** 08-08: the play button's name when the preview has a title ("Assistir {title} aqui"). */
  playLabel?: string;
  /** 08-08: the play button's name when it has none ("Assistir vídeo aqui"). */
  playUntitledLabel?: string;
  /** 08-08: the iframe's accessible title ("{provider}: {title}"). */
  frameTitle?: string;
};

/** The card's column is 680px on desktop (D-39) and the viewport width on a phone. */
const IMAGE_SIZES = '(min-width: 768px) 680px, 100vw';

export function LinkPreviewCard({
  preview,
  ariaLabel,
  providerLabel,
  playLabel,
  playUntitledLabel,
  frameTitle,
}: LinkPreviewCardProps): ReactNode {
  // UI-D-11 / UI-D-13: pending, failed and refused are ONE rendering — nothing at all.
  if (preview.status !== 'resolved') return null;
  // A resolved row with no title and no description carries nothing the bare link does not already
  // say, so it degrades to the bare link rather than to a bordered box with a hostname in it.
  if (preview.title === null && preview.description === null) return null;

  // The meta slot: the provider name when this came through oEmbed, else the hostname (UI-D-12).
  const meta = preview.provider !== null ? (providerLabel ?? preview.hostname) : preview.hostname;

  // UI-D-282: the click-to-play variant needs the frame URL AND its labels; an unlabelled control is
  // worse than the external card, so a host that passes no labels keeps the shipped card.
  const playName = preview.title !== null ? playLabel : playUntitledLabel;
  if (preview.embedUrl && playName && frameTitle) {
    return (
      <InlinePlayerCard
        preview={preview}
        embedUrl={preview.embedUrl}
        meta={meta}
        ariaLabel={ariaLabel}
        playName={playName}
        frameTitle={frameTitle}
      />
    );
  }

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      data-testid="post-link-preview"
      data-provider={preview.provider ?? undefined}
      className="mx-4 mt-3 block overflow-hidden rounded-xl border border-border bg-bg-secondary hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      {preview.imageAssetId !== null ? (
        // `relative` so the play badge can centre over it. The explicit `aspect-video` box is what
        // keeps the card from reflowing while the image loads, and `MediaImage`'s own error path
        // degrades to the neutral ground rather than a broken-image glyph (UI-SPEC E06 loading/error).
        <span className="relative block">
          <MediaImage
            assetId={preview.imageAssetId}
            widths={preview.imageVariantWidths}
            alt=""
            sizes={IMAGE_SIZES}
            ratio="aspect-video"
            className="w-full"
          />
          {preview.provider !== null ? (
            // UI-D-12's badge: white on a FIXED scrim, never the tenant accent — a brand hex over an
            // arbitrary video thumbnail has no guaranteed contrast.
            <span
              aria-hidden
              data-testid="post-link-preview-play"
              className="pointer-events-none absolute inset-0 grid place-items-center"
            >
              <span className="grid h-14 w-14 place-items-center rounded-full bg-black/60 text-white">
                <Play size={24} fill="currentColor" />
              </span>
            </span>
          ) : null}
        </span>
      ) : null}

      <span className="flex flex-col gap-1 px-4 py-3">
        <span className="truncate text-xs font-normal text-text-tertiary">{meta}</span>
        {preview.title !== null ? (
          <span className="line-clamp-2 text-sm font-bold text-text">{preview.title}</span>
        ) : null}
        {preview.description !== null ? (
          <span className="line-clamp-2 text-sm font-normal text-text-secondary">
            {preview.description}
          </span>
        ) : null}
      </span>
    </a>
  );
}

/** The text block both variants share: meta, title, description (plain text, React-escaped). */
function PreviewText({ preview, meta }: { preview: LinkPreviewView; meta: string }): ReactNode {
  return (
    <span className="flex flex-col gap-1 px-4 py-3">
      <span className="truncate text-xs font-normal text-text-tertiary">{meta}</span>
      {preview.title !== null ? (
        <span className="line-clamp-2 text-sm font-bold text-text">{preview.title}</span>
      ) : null}
      {preview.description !== null ? (
        <span className="line-clamp-2 text-sm font-normal text-text-secondary">
          {preview.description}
        </span>
      ) : null}
    </span>
  );
}

/**
 * UI-D-282 (E15): the stage is static until the tap (no skeleton, no remote thumbnail: a flat
 * `bg-black` ground), and `w-full aspect-video` inside the card so it never outgrows it at any
 * viewport. The tap is the user gesture, so the provider's `autoplay=1` starts playback, and the
 * provider's own player shows its loading state inside the frame. Focus moves to the frame so a
 * keyboard user lands on the player they asked for.
 */
function InlinePlayerCard({
  preview,
  embedUrl,
  meta,
  ariaLabel,
  playName,
  frameTitle,
}: {
  preview: LinkPreviewView;
  embedUrl: string;
  meta: string;
  ariaLabel: string;
  playName: string;
  frameTitle: string;
}): ReactNode {
  const [playing, setPlaying] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (playing) frameRef.current?.focus();
  }, [playing]);

  return (
    <div
      data-testid="post-link-preview"
      data-provider={preview.provider ?? undefined}
      className="mx-4 mt-3 block overflow-hidden rounded-xl border border-border bg-bg-secondary"
    >
      {playing ? (
        <iframe
          ref={frameRef}
          src={embedUrl}
          title={frameTitle}
          data-testid="post-link-preview-frame"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
          className="block aspect-video w-full border-0"
        />
      ) : (
        <span
          data-testid="post-link-preview-stage"
          className="relative block aspect-video w-full bg-black"
        >
          <button
            type="button"
            aria-label={playName}
            data-testid="post-link-preview-play"
            onClick={() => setPlaying(true)}
            className="absolute inset-0 grid place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
          >
            <span className="grid h-14 w-14 place-items-center rounded-full bg-black/60 text-white">
              <Play size={24} fill="currentColor" aria-hidden />
            </span>
          </button>
        </span>
      )}
      <a
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={ariaLabel}
        data-testid="post-link-preview-link"
        className="block hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
      >
        <PreviewText preview={preview} meta={meta} />
      </a>
    </div>
  );
}
