'use client';

import { mediaVariantUrl } from '@tria/contracts/media';
import { cn } from '@tria/ui';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

export interface MediaImageProps {
  /** The `media_assets` id; the serving path is derived from it, never handed over in a payload. */
  assetId: string;
  /** The variant ladder the payload declares (R-06) — never a hand-written width list. */
  widths: readonly number[];
  alt: string;
  /** `sizes` per call site (the component cannot know its own layout). */
  sizes: string;
  /** The width `src` points at; defaults to the narrowest rung of the ladder. */
  baseWidth?: number;
  /** `true` only for a screen's visual anchor (the profile header avatar). */
  eager?: boolean;
  /** Explicit aspect ratio of the box, so nothing reflows while the image loads (UI-D-06). */
  ratio?: string;
  /** Classes of the BOX (size, radius); the `<img>` always fills it. */
  className?: string;
  /**
   * How the `<img>` fills its box. `cover` everywhere a thumbnail is cropped to a shape (every
   * caller before 05-06); `contain` for the story viewer, where UI-D-33 forbids cropping — a story
   * is a whole composition the admin framed on their phone, and the black ground is the surface.
   */
  fit?: 'cover' | 'contain';
  /**
   * Fired once the bytes have decoded. The story viewer's clock does not start until this arrives,
   * so a slow image never burns its five seconds invisibly (UI loading/E03).
   */
  onReady?: () => void;
  /** Fired when the asset cannot be rendered — the same moment the fallback below takes over. */
  onFailed?: () => void;
  /**
   * What replaces the box when the asset cannot be rendered (expired, deleted, another tenant's).
   * Typically the neutral `Avatar`; when omitted the plain `bg-bg-tertiary` box stays.
   */
  fallback?: ReactNode;
}

/**
 * Every private image renders through here (UI-SPEC §Media rendering contract, R-05): an `<img>` over
 * the STABLE `/v1/media/{assetId}/{variant}` endpoint, which 302s to a freshly signed, tenant-checked
 * Storage URL on every fetch. An inline signed Storage URL never reaches a payload or the DOM.
 *
 * The `<img>` sits in a `bg-bg-tertiary` box carrying an explicit aspect ratio, so there is no CLS and
 * no spinner over an image. `onError` clears `src`: an expired, deleted or cross-tenant asset degrades
 * to EXACTLY the "no photo" state — the neutral `Avatar` icon or the plain box — and a broken-image
 * glyph is never shown (UI-SPEC E9/error).
 */
export function MediaImage({
  assetId,
  widths,
  alt,
  sizes,
  baseWidth,
  eager = false,
  ratio = 'aspect-square',
  className,
  fit = 'cover',
  onReady,
  onFailed,
  fallback,
}: MediaImageProps) {
  // Keyed by asset id rather than a bare boolean, so pointing the component at another asset retries
  // instead of inheriting the previous one's failure.
  const [failedId, setFailedId] = useState<string | null>(null);
  const failed = failedId === assetId;
  const imgRef = useRef<HTMLImageElement>(null);

  // A server-rendered image can fail BEFORE React hydrates, and that `error` event is never
  // delivered to the handler below. The element remembers it: `complete` with a zero natural width
  // is a fetch that ended without an image, so the fallback is applied on mount as well.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth === 0) {
      setFailedId(assetId);
      onFailed?.();
      return;
    }
    // A server-rendered image that is ALREADY decoded never fires `load` either, so the ready
    // signal has to be reported here too — otherwise a cached story would leave the clock paused.
    if (img?.complete && img.naturalWidth > 0) onReady?.();
  }, [assetId, onReady, onFailed]);

  const ladder = widths.length > 0 ? widths : [];
  const base = baseWidth ?? ladder[0];
  const src = base === undefined ? null : mediaVariantUrl(assetId, `w${base}`);
  const srcSet = ladder
    .map((width) => `${mediaVariantUrl(assetId, `w${width}`)} ${width}w`)
    .join(', ');

  if (failed || src === null)
    return <>{fallback ?? <span className={cn('block bg-bg-tertiary', ratio, className)} />}</>;

  return (
    <span className={cn('relative block overflow-hidden bg-bg-tertiary', ratio, className)}>
      {/* biome-ignore lint/performance/noImgElement: R-05 — `/v1/media/...` is a private, per-request
          signed redirect; next/image would re-fetch it server-side and duplicate the worker's variant
          ladder. The same posture as the branding `LogoUpload` preview. */}
      <img
        ref={imgRef}
        src={src}
        srcSet={srcSet}
        sizes={sizes}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        draggable={false}
        onLoad={onReady}
        onError={() => {
          setFailedId(assetId);
          onFailed?.();
        }}
        className={cn('h-full w-full', fit === 'contain' ? 'object-contain' : 'object-cover')}
      />
    </span>
  );
}
