import { cn } from '../cn';

/**
 * The one button look (UI-SPEC §Component Inventory), shared by `Button` and by every link styled
 * as a button (quick 261016-eg6, 08.5 UI-REVIEW fix 2: the class strings had been hand-copied into
 * six files and had drifted).
 *
 * Kept OUT of Button.tsx on purpose, for the same reason as `chipBase.ts` (PDF item #9): Button.tsx
 * is a 'use client' module, and in the RSC graph Next replaces EVERY export of a client module with
 * a client-reference function. Server Components (PreviewBanner, LiveStateZone, MemberLessonPage)
 * call this helper, so it must live in a directive-less module. Never re-export it from Button.tsx.
 *
 * `brand` merges the prototype's `primary` and `accent` variants and reads the tenant through
 * `bg-button`/`text-on-button` — never `text-white` on the fill, the on-colour is computed per
 * tenant. Since 2026-10-03 the filled button has its own colour, separate from the primary that
 * chips, switches and tabs keep; unset (everywhere but the wizard's preview, for now) it IS the
 * primary, the same paint as `bg-brand`, hover included. The focus ring stays on the primary
 * (`ring-brand`). A gradient button paints its image over that fill (`bg-(image:--button-image)`,
 * and the hover's), `none` unless the gradient is set. A caller className with its own `bg-*`
 * colour still replaces `bg-button` (tailwind-merge), but the image and its hover are other utility
 * groups and stay (`bg-none` alone takes the image, never the hover's): a caller repainting a brand
 * button adds `bg-none hover:bg-none` too, or under a gradient the tenant's hovered image covers
 * its hover colour.
 */
const variantStyles = {
  brand:
    'bg-button bg-(image:--button-image) text-on-button hover:bg-button-hover hover:bg-(image:--button-image-hover) active:opacity-80',
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

/**
 * UI-D-443: every control is at least 44px. A transparent `::after` reaching 4px above and below
 * grows a 36px `sm` control to a 44px tap target without changing its look (nothing sideways, so it
 * never covers a neighbour in the row). Tailwind v4's `after:` variant supplies the empty
 * `content`. Only `sm` needs it: `md` is already 44px.
 */
const HIT_AREA = 'relative after:absolute after:inset-x-0 after:-inset-y-1';

export interface ButtonClassesOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** The transparent 44px tap target for `sm` (UI-D-443). */
  hitArea?: boolean;
  /** Call-site classes, merged last through tailwind-merge (`px-3` replaces the size's `px-5`). */
  className?: string;
}

export function buttonClasses({
  variant = 'brand',
  size = 'md',
  fullWidth = false,
  hitArea = false,
  className,
}: ButtonClassesOptions = {}): string {
  return cn(
    'inline-flex items-center justify-center rounded-xl font-bold transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
    'disabled:pointer-events-none disabled:opacity-50',
    variantStyles[variant],
    sizeStyles[size],
    fullWidth && 'w-full',
    hitArea && HIT_AREA,
    className,
  );
}
