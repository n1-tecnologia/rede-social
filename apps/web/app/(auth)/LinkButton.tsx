import { cn } from '@rede-social/ui';
import Link from 'next/link';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

/**
 * A `next/link` anchor that looks like `@rede-social/ui` `Button` (server component — the public pages are
 * server-rendered and a navigation needs an `<a>`, so `getByRole('link', { name })` keeps matching).
 * `@rede-social/ui` exposes no class builder for `Button`, so the geometry is mirrored HERE only; the colours
 * are the same tokens (`bg-button` / `text-on-button`, the button colour that defaults to the
 * primary, with the gradient button's image over it, `none` unless set; `border-border-secondary`,
 * `text-brand`). A caller className goes through the same `cn` as `Button`'s: its own `bg-*`
 * colour replaces `bg-button`, but the image and its hover are other utility groups and stay
 * (`bg-none` alone takes the image, never the hover's), so a caller repainting a brand link adds
 * `bg-none hover:bg-none` too, or under a gradient the tenant's hovered image covers its hover
 * colour.
 */
const variantStyles = {
  brand:
    'bg-button bg-(image:--button-image) text-on-button hover:bg-button-hover hover:bg-(image:--button-image-hover) active:opacity-80',
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
