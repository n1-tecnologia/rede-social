import { cn } from '@tria/ui';

export type TenantLogoSize = 'topbar' | 'rail' | 'auth' | 'home';

export interface TenantLogoProps {
  /** Public URL of the tenant logo, or null when the tenant has not uploaded one. */
  logoUrl: string | null;
  /** Tenant display name: the `alt` text of the logo and the visible fallback without one (D-26). */
  displayName: string;
  /** Fixed box per placement (UI-SPEC Shell / Auth contracts). */
  size: TenantLogoSize;
  className?: string;
}

/** Fixed boxes per placement: the image is contained inside, never cropped or stretched. */
const BOX: Record<TenantLogoSize, string> = {
  topbar: 'h-7 max-w-[120px]',
  rail: 'h-12 max-w-full px-2',
  auth: 'h-16 max-w-[220px]',
  home: 'h-16',
};

const IMG: Record<TenantLogoSize, string> = {
  topbar: 'h-7',
  rail: 'max-h-8',
  auth: 'h-16',
  home: 'h-16',
};

/** Display-name fallback typography per placement. */
const TEXT: Record<TenantLogoSize, string> = {
  topbar: 'text-base font-bold tracking-tight truncate',
  rail: 'text-base font-bold tracking-tight truncate',
  auth: 'text-2xl font-bold tracking-[-0.02em] text-text',
  home: 'text-2xl font-bold tracking-[-0.02em] text-text',
};

/**
 * Renders the tenant logo exactly as uploaded (D-26): a plain `<img>` inside a fixed box with no
 * tint, no recolouring and no shape applied — the customer's brand asset is shown as-is on both
 * themes. Without a logo the display name renders as text; there is no placeholder image.
 *
 * Client-safe: this file lives under `@tria/core/ui` and may not import the kernel's server or
 * database code (Biome override in biome.json).
 */
export function TenantLogo({ logoUrl, displayName, size, className }: TenantLogoProps) {
  if (!logoUrl) {
    return <span className={cn('inline-block min-w-0', TEXT[size], className)}>{displayName}</span>;
  }
  return (
    <span className={cn('inline-flex items-center', BOX[size], className)}>
      {/* biome-ignore lint/performance/noImgElement: D-26 — the customer's logo is served as-is (any format, any origin); next/image would re-encode and constrain it. */}
      <img src={logoUrl} alt={displayName} className={cn('w-auto object-contain', IMG[size])} />
    </span>
  );
}
