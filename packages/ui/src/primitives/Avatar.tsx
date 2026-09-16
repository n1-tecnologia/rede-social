'use client';

import { User } from 'lucide-react';
import type { MouseEventHandler } from 'react';
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

/** Circular avatar with the `User` fallback on the tertiary surface. */
export function Avatar({ src, alt, size = 'md', onClick, className }: AvatarProps) {
  const surface = (
    <span
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded-full',
        sizeMap[size],
        !src && 'bg-bg-tertiary',
      )}
    >
      {src ? (
        <img src={src} alt={alt} className="h-full w-full object-cover" draggable={false} />
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
