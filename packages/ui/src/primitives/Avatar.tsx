'use client';

import { User } from 'lucide-react';
import { type MouseEventHandler, useState } from 'react';
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
 */
export function Avatar({ src, alt, size = 'md', onClick, className }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const shown = src && src !== failedSrc ? src : null;

  const surface = (
    <span
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded-full',
        sizeMap[size],
        !shown && 'bg-bg-tertiary',
      )}
    >
      {shown ? (
        <img
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
      className={cn('inline-flex shrink-0 rounded-full', className)}
    >
      {surface}
    </span>
  );
}
