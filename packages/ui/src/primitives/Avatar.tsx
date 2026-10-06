'use client';

import { User } from 'lucide-react';
import { type MouseEventHandler, useEffect, useRef, useState } from 'react';
import { cn } from '../cn';

const sizeMap = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-14 w-14',
  xl: 'h-20 w-20',
} as const;

const fallbackIconSize = { sm: 14, md: 18, lg: 24, xl: 32 } as const;

export type AvatarSize = keyof typeof sizeMap;

export interface AvatarProps {
  src?: string | null;
  /** Accessible name (the person's or tenant's name). */
  alt: string;
  size?: AvatarSize;
  /** When present the avatar renders as a `<button>`. */
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
}

/**
 * Circular avatar with the `User` fallback on the tertiary surface.
 *
 * A photo that cannot be fetched — an expired signed redirect, a variant the worker has not derived
 * yet, another tenant's asset — falls back to exactly that neutral icon: a broken-image glyph is
 * never shown (UI-SPEC §Media rendering contract E9/error). The failure is keyed by `src`, so
 * pointing the avatar at another photo retries instead of inheriting the previous one's failure.
 *
 * The size lives on the OUTER element and the visible circle fills it, so a `className` size
 * resizes the whole avatar. Sized only on the inner circle, an `xl` (80px) avatar that its caller
 * asked for `h-16 w-16` spilled 16px out of its 64px box, over whatever sat around it.
 */
export function Avatar({ src, alt, size = 'md', onClick, className }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const shown = src && src !== failedSrc ? src : null;
  const imgRef = useRef<HTMLImageElement>(null);

  // A server-rendered photo can fail BEFORE React hydrates, and that `error` event never reaches the
  // handler below. The element remembers it: `complete` with a zero natural width is a fetch that
  // ended without an image.
  useEffect(() => {
    const img = imgRef.current;
    if (shown && img?.complete && img.naturalWidth === 0) setFailedSrc(shown);
  }, [shown]);

  const surface = (
    <span
      className={cn(
        'relative flex h-full w-full items-center justify-center overflow-hidden rounded-full',
        !shown && 'bg-bg-tertiary',
      )}
    >
      {shown ? (
        <img
          ref={imgRef}
          src={shown}
          alt={alt}
          className="h-full w-full object-cover"
          draggable={false}
          onError={() => setFailedSrc(shown)}
        />
      ) : (
        <User aria-hidden className="text-text-tertiary" size={fallbackIconSize[size]} />
      )}
    </span>
  );

  if (onClick) {
    return (
      <button
        type="button"
        aria-label={alt}
        onClick={onClick}
        className={cn(
          'inline-flex shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
          sizeMap[size],
          className,
        )}
      >
        {surface}
      </button>
    );
  }

  return (
    <span
      aria-label={alt}
      role="img"
      className={cn('inline-flex shrink-0 rounded-full', sizeMap[size], className)}
    >
      {surface}
    </span>
  );
}
