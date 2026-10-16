'use client';

import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { type ButtonSize, type ButtonVariant, buttonClasses } from './buttonClasses';

export type { ButtonSize, ButtonVariant } from './buttonClasses';

/**
 * Brand-bearing button (UI-SPEC §Component Inventory). Its className is exactly `buttonClasses()`
 * (`./buttonClasses`, a directive-less module so Server Components can style links with it too);
 * the variant and size notes live there.
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** The transparent 44px tap target for `sm` (UI-D-443); the 36px look is unchanged. */
  hitArea?: boolean;
  /** Shows the spinner, sets `aria-busy` and disables the button while an action runs. */
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'brand',
  size = 'md',
  fullWidth = false,
  hitArea = false,
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
      className={buttonClasses({ variant, size, fullWidth, hitArea, className })}
      {...props}
    >
      {loading ? (
        <Loader2 aria-hidden className="shrink-0 animate-spin" size={size === 'sm' ? 14 : 18} />
      ) : null}
      {children}
    </button>
  );
}
