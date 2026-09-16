'use client';

import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

/**
 * Brand-bearing button (UI-SPEC §Component Inventory). `brand` merges the prototype's `primary` and
 * `accent` variants and reads the tenant through `bg-brand`/`text-on-brand` — never `text-white`
 * on brand, the on-colour is computed per tenant.
 */
const variantStyles = {
  brand: 'bg-brand text-on-brand hover:bg-brand-hover active:opacity-80',
  secondary: 'bg-bg-tertiary text-text hover:bg-bg-active active:bg-bg-tertiary/80',
  outline: 'border border-border-secondary text-text hover:bg-bg-hover active:bg-bg-tertiary',
  ghost: 'bg-transparent text-brand hover:bg-bg-hover active:bg-bg-tertiary',
  danger: 'bg-danger text-white hover:bg-danger/90 active:bg-danger/80',
} as const;

const sizeStyles = {
  sm: 'h-9 px-4 text-xs gap-1.5',
  md: 'h-11 px-5 text-sm gap-2',
  lg: 'h-13 px-7 text-base gap-2.5',
} as const;

export type ButtonVariant = keyof typeof variantStyles;
export type ButtonSize = keyof typeof sizeStyles;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Shows the spinner, sets `aria-busy` and disables the button while an action runs. */
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'brand',
  size = 'md',
  fullWidth = false,
  loading = false,
  disabled,
  type = 'button',
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-xl font-bold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        'disabled:pointer-events-none disabled:opacity-50',
        variantStyles[variant],
        sizeStyles[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 aria-hidden className="shrink-0 animate-spin" size={size === 'sm' ? 14 : 18} />
      ) : null}
      {children}
    </button>
  );
}
