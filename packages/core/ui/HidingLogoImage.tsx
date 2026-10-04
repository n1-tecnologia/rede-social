'use client';

import { cn } from '@rede-social/ui';
import { type ReactNode, useEffect, useRef, useState } from 'react';

export interface HidingLogoImageProps {
  src: string;
  alt: string;
  boxClassName: string;
  imgClassName: string;
  /**
   * What takes the logo's place once the image fails to load: nothing by default (the thread header
   * and the support greeting show their title alone), the display name for every other placement
   * (`TenantLogo`), so the shell's brand slot is never empty.
   */
  fallback?: ReactNode;
}

/**
 * The tenant logo inside its fixed box, replaced by `fallback` when the image fails to load (07-09,
 * UI-D-258, E09/media): never a broken image glyph or an empty box.
 *
 * The failure is keyed by `src`, so a NEW logo is tried again instead of inheriting the last one's
 * failure (the wizard's preview swaps object URLs, and the draft revokes the one it replaces).
 *
 * A server-rendered logo can fail BEFORE React hydrates, and React does not replay that `error`
 * event to the handler below. The element remembers it: `complete` with no natural width. That alone
 * is not proof, because an SVG wordmark with no intrinsic size reads the same (the seed logos carry
 * one, a customer's may not), so `decode()` settles it: it rejects only for an image that cannot be
 * shown.
 */
export function HidingLogoImage({
  src,
  alt,
  boxClassName,
  imgClassName,
  fallback = null,
}: HidingLogoImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img?.complete || img.naturalWidth !== 0) return;
    let live = true;
    img.decode().catch(() => {
      if (live) setFailedSrc(src);
    });
    return () => {
      live = false;
    };
  }, [src]);

  if (failedSrc === src) return fallback;
  return (
    <span data-tenant-logo className={cn('inline-flex shrink-0 items-center', boxClassName)}>
      {/* biome-ignore lint/performance/noImgElement: D-26 — the customer's logo is served as-is (any format, any origin); next/image would re-encode and constrain it. */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onError={() => setFailedSrc(src)}
        className={cn('w-auto object-contain', imgClassName)}
      />
    </span>
  );
}
