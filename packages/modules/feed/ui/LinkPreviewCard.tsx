import { MediaImage } from '@rede-social/core/ui';
import { Play } from 'lucide-react';
import type { ReactNode } from 'react';

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
 * 2. **No frame element, ever.** YouTube and Vimeo render as the SAME card with the provider
 *    thumbnail and a play badge, opening externally (UI-D-12). `apps/web` has no
 *    Content-Security-Policy today, so an embedded third-party frame could navigate the top frame
 *    and set cookies inside the tenant's origin. Inline playback is a Phase 8 item behind a real CSP.
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
};

export type LinkPreviewCardProps = {
  preview: LinkPreviewView;
  /** The link's accessible name, already interpolated by the host's catalog. */
  ariaLabel: string;
  /** "YouTube" / "Vimeo" — what the meta slot reads when `provider` is set. */
  providerLabel?: string;
};

/** The card's column is 680px on desktop (D-39) and the viewport width on a phone. */
const IMAGE_SIZES = '(min-width: 768px) 680px, 100vw';

export function LinkPreviewCard({
  preview,
  ariaLabel,
  providerLabel,
}: LinkPreviewCardProps): ReactNode {
  // UI-D-11 / UI-D-13: pending, failed and refused are ONE rendering — nothing at all.
  if (preview.status !== 'resolved') return null;
  // A resolved row with no title and no description carries nothing the bare link does not already
  // say, so it degrades to the bare link rather than to a bordered box with a hostname in it.
  if (preview.title === null && preview.description === null) return null;

  // The meta slot: the provider name when this came through oEmbed, else the hostname (UI-D-12).
  const meta = preview.provider !== null ? (providerLabel ?? preview.hostname) : preview.hostname;

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
