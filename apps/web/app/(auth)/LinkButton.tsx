import { cn } from '@tria/ui';
import Link from 'next/link';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

/**
 * A `next/link` anchor that looks like `@tria/ui` `Button` (server component — the public pages are
 * server-rendered and a navigation needs an `<a>`, so `getByRole('link', { name })` keeps matching).
 * `@tria/ui` exposes no class builder for `Button`, so the geometry is mirrored HERE only; the colours
 * are the same tokens (`bg-brand` / `text-on-brand`, `border-border-secondary`, `text-brand`).
 */
const variantStyles = {
  brand: 'bg-brand text-on-brand hover:bg-brand-hover active:opacity-80',
  outline: 'border border-border-secondary text-text hover:bg-bg-hover active:bg-bg-tertiary',
  ghost: 'bg-transparent text-brand hover:bg-bg-hover active:bg-bg-tertiary',
} as const;

const sizeStyles = {
  md: 'h-11 px-5 text-sm gap-2',
  lg: 'h-13 px-7 text-base gap-2.5',
} as const;

export interface LinkButtonProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  variant?: keyof typeof variantStyles;
  size?: keyof typeof sizeStyles;
  fullWidth?: boolean;
  children: ReactNode;
}

export function LinkButton({
  href,
  variant = 'outline',
  size = 'md',
  fullWidth = false,
  className,
  children,
  ...props
}: LinkButtonProps) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center justify-center rounded-xl font-bold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        variantStyles[variant],
        sizeStyles[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}
