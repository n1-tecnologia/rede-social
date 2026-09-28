'use client';

import { mediaVariantUrl } from '@rede-social/contracts/media';
import { cn } from '@rede-social/ui';
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
  /**
   * Fired when the asset cannot be rendered — the same moment the fallback below takes over. It
   * covers BOTH failure shapes, including the one that is easy to mistake for silence: an EMPTY
   * variant ladder, where there is no `<img>` at all. Exactly one of `onReady`/`onFailed` always
   * arrives, because the caller is waiting on one of them (see the docblock on the mount effect).
   */
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

  /**
   * The two reports are read through refs that are reassigned during render — the same idiom
   * `apps/web/components/stories/StoryVideo.tsx` uses for its `controls` object, and for the same
   * reason: the caller rebuilds them on every pass and the effect below must not notice.
   */
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;

  // Derived ABOVE the effect so `src` is in scope for its dependency array — and because `src`
  // being null is itself an outcome the effect has to report (see its first branch).
  const ladder = widths.length > 0 ? widths : [];
  const base = baseWidth ?? ladder[0];
  const src = base === undefined ? null : mediaVariantUrl(assetId, `w${base}`);
  const srcSet = ladder
    .map((width) => `${mediaVariantUrl(assetId, `w${width}`)} ${width}w`)
    .join(', ');

  /**
   * The single mount effect, and the ONE rule that governs its dependency array: **this component
   * reports to a caller it does not control, so the array may name VALUES (`assetId`, `src`) and
   * never the caller's callback IDENTITIES.** A report that re-arms on the caller's identity is a
   * loop waiting for a caller that rebuilds its callbacks — which every caller that builds its
   * props inline does. Putting `onReady`/`onFailed` back here reopens the render loop that ran a
   * verifier probe to `FATAL ERROR: JavaScript heap out of memory` (05-VERIFICATION.md gap 2).
   *
   * A server-rendered image can fail BEFORE React hydrates, and that `error` event is never
   * delivered to the handler below. The element remembers it: `complete` with a zero natural width
   * is a fetch that ended without an image, so the fallback is applied on mount as well.
   */
  useEffect(() => {
    // An EMPTY variant ladder is not a quieter kind of success (CR-03). There is nothing to render
    // and no `<img>` to fire an event, so this branch is the ONLY place the outcome can be
    // reported — and it is reachable in production: the admin history (`listOwnStories`) omits
    // the `status = 'ready'` filter, so a still-transcoding asset arrives with no variants.
    // Returning the fallback while reporting nothing is what froze the story viewer in `loading`
    // with no progress, no auto-advance, no error copy and no retry. `src` is already a dependency,
    // so this runs once per asset; both the state write and the report happen in an effect rather
    // than during render, so neither breaks the render-purity rule the rest of this file follows.
    if (src === null) {
      setFailedId(assetId);
      onFailedRef.current?.();
      return;
    }
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth === 0) {
      setFailedId(assetId);
      onFailedRef.current?.();
      return;
    }
    // A server-rendered image that is ALREADY decoded never fires `load` either, so the ready
    // signal has to be reported here too — otherwise a cached story would leave the clock paused.
    if (img?.complete && img.naturalWidth > 0) onReadyRef.current?.();
  }, [assetId, src]);

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
        // DOM props, not dependencies: their identity is free to change every render.
        onLoad={() => onReadyRef.current?.()}
        onError={() => {
          setFailedId(assetId);
          onFailedRef.current?.();
        }}
        className={cn('h-full w-full', fit === 'contain' ? 'object-contain' : 'object-cover')}
      />
    </span>
  );
}
