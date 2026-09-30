'use client';

import { cn } from '@rede-social/ui';
import { useState } from 'react';

export interface HidingLogoImageProps {
  src: string;
  alt: string;
  boxClassName: string;
  imgClassName: string;
}

/**
 * The tenant logo inside its fixed box, omitted entirely when the image fails to load (07-09,
 * UI-D-258, E09/media): the thread header and the greeting then show the title alone, never a broken
 * image glyph or an empty box. Only the `error` event hides it: a decoded-size probe would misread an
 * SVG wordmark with no intrinsic size (the seed logos) as broken.
 */
export function HidingLogoImage({ src, alt, boxClassName, imgClassName }: HidingLogoImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) return null;
  return (
    <span data-tenant-logo className={cn('inline-flex shrink-0 items-center', boxClassName)}>
      {/* biome-ignore lint/performance/noImgElement: D-26 — the customer's logo is served as-is (any format, any origin); next/image would re-encode and constrain it. */}
      <img
        src={src}
        alt={alt}
        onError={() => setFailed(true)}
        className={cn('w-auto object-contain', imgClassName)}
      />
    </span>
  );
}
