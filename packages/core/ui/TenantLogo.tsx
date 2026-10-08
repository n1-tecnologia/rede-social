import { cn } from '@rede-social/ui';
import { HidingLogoImage } from './HidingLogoImage';

export type TenantLogoSize = 'topbar' | 'rail' | 'auth' | 'home' | 'thread';

export interface TenantLogoProps {
  /** Public URL of the tenant logo, or null when the tenant has not uploaded one. */
  logoUrl: string | null;
  /**
   * Tenant display name: the `alt` text of the logo and the visible fallback without one, or when the
   * logo fails to load (D-26).
   */
  displayName: string;
  /** Fixed box per placement (UI-SPEC Shell / Auth contracts). */
  size: TenantLogoSize;
  /**
   * Render NOTHING when the image fails to load (07-09, E09/media), instead of the display name.
   * Always on for `thread`; the support greeting turns it on for `home`.
   */
  hideOnError?: boolean;
  className?: string;
}

/** Fixed boxes per placement: the image is contained inside, never cropped or stretched. */
// 2026-10-06 ("aumente consideravelmente o tamanho da logo no header"): the TopBar logo went from
// 28px to 40px tall and up to 176px wide, never wider than what the bar's right side leaves on a
// 320px phone; the rail's from 32px to 48px.
// 08.2-12 (E01 overflow): the cap alone assumed two slots. With the store's third slot the right
// side needs ~204px, so a wide wordmark at 320px kept its 128px and slid under the Loja slot. The
// box now also SHRINKS (`min-w-0 shrink`, overriding the image wrapper's `shrink-0`) to what the bar
// leaves, and the `object-contain` image scales down inside it: never wider than the space, never
// cropped or stretched.
const BOX: Record<TenantLogoSize, string> = {
  topbar: 'h-10 min-w-0 shrink max-w-[min(11rem,calc(100vw-12rem))]',
  rail: 'h-14 max-w-full px-2',
  auth: 'h-16 max-w-[220px]',
  home: 'h-16',
  // 07-09 (UI-D-258): the member thread header. A wide wordmark is capped at 64px so "Equipe
  // {tenant}" keeps the width at 320px.
  thread: 'h-8 max-w-[64px]',
};

const IMG: Record<TenantLogoSize, string> = {
  topbar: 'h-10 max-w-full',
  rail: 'max-h-12 max-w-full',
  auth: 'h-16',
  home: 'h-16',
  thread: 'max-h-8',
};

/** Display-name fallback typography per placement. */
const TEXT: Record<TenantLogoSize, string> = {
  topbar: 'text-base font-bold tracking-tight truncate',
  rail: 'text-base font-bold tracking-tight truncate',
  auth: 'text-2xl font-bold tracking-[-0.02em] text-text',
  home: 'text-2xl font-bold tracking-[-0.02em] text-text',
  // Never rendered: the thread header shows no fallback (its title already names the tenant).
  thread: '',
};

/**
 * Renders the tenant logo exactly as uploaded (D-26): a plain `<img>` inside a fixed box with no
 * tint, no recolouring and no shape applied — the customer's brand asset is shown as-is on both
 * themes. Without a logo the display name renders as text; there is no placeholder image.
 *
 * A logo that fails to load counts as no logo: `HidingLogoImage` swaps in the same display name, so
 * a 404 or an expired URL never leaves a broken glyph. That matters most in the TopBar and the rail,
 * which show the logo ALONE (product decision, 2026-10-02): the name is never drawn beside it, so a
 * failing logo must not leave the shell nameless.
 *
 * `thread` (07-09, UI-D-258) is the exception: the member thread header already reads "Equipe
 * {tenant}", so without a logo (or when the image fails to load) it renders NOTHING. `hideOnError`
 * asks the same of a failing logo elsewhere (the support greeting's `home`).
 *
 * Client-safe: this file lives under `@rede-social/core/ui` and may not import the kernel's server or
 * database code (Biome override in biome.json).
 */
export function TenantLogo({
  logoUrl,
  displayName,
  size,
  hideOnError = false,
  className,
}: TenantLogoProps) {
  const name =
    size === 'thread' ? null : (
      <span className={cn('inline-block min-w-0', TEXT[size], className)}>{displayName}</span>
    );
  if (!logoUrl) return name;
  return (
    <HidingLogoImage
      src={logoUrl}
      alt={displayName}
      boxClassName={cn(BOX[size], className)}
      imgClassName={IMG[size]}
      fallback={hideOnError ? null : name}
    />
  );
}
