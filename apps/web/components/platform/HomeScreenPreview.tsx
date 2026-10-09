import { hexColorSchema, NEUTRAL_BRAND } from '@rede-social/contracts/branding';
import { cn } from '@rede-social/ui';
import type { ReactNode } from 'react';
import { ANDROID_SAFE_ZONE, homeScreenLabel } from '@/lib/app-icon';

export type HomeScreenTile = 'ios' | 'android';

export type HomeScreenPreviewLabels = {
  /** The wallpaper's accessible name: it is ONE image for assistive technology. */
  aria: string;
  /** The column captions ("iPhone", "Android"): names, but still the catalog's. */
  ios: string;
  android: string;
};

export interface HomeScreenPreviewProps {
  /** The tenant's name: the iPhone shows it whole (cut by the tile's width), Android its 12 characters. */
  displayName: string;
  /** The saved primary: Android's circle behind the icon, as the worker's maskable icon has it. */
  primary: string;
  /**
   * What fills one tile's square: the icon as an `<img>` or a `<canvas>` sized to fill it, `null`
   * for an empty tile. Called once per tile, so each gets its own element.
   */
  renderIcon: (tile: HomeScreenTile) => ReactNode;
  labels: HomeScreenPreviewLabels;
  className?: string;
}

/**
 * The installed app on a phone's home screen (2026-10-09, "Ícone do app"), as each system draws the
 * icons the worker derives: the iPhone tile is the square with its corners cut (22.37%, the
 * system's own rounding), black behind any transparent pixel (iOS fills the apple-touch-icon's
 * transparency with black), under the full name cut to the tile's width; the Android tile is the
 * maskable icon in a circle, the square at 80% over the primary (`ANDROID_SAFE_ZONE`), under the
 * manifest's 12-character short name (`homeScreenLabel`).
 *
 * Presentational: the caller draws the icon (`renderIcon`). The wallpaper is a dark-theme scope
 * (tokens only), so the labels read as on a phone whatever the panel's theme. It never carries
 * `data-brand-scope`: that attribute belongs to the `BrandPreview` frames the specs count.
 */
export function HomeScreenPreview({
  displayName,
  primary,
  renderIcon,
  labels,
  className,
}: HomeScreenPreviewProps) {
  const parsed = hexColorSchema.safeParse(primary);
  const ground = parsed.success ? parsed.data : NEUTRAL_BRAND.primary;
  const safe = `${ANDROID_SAFE_ZONE * 100}%`;
  const caption = 'text-[11px] font-bold text-text-secondary';
  const name = 'w-20 truncate text-center text-[11px] leading-tight text-text';

  return (
    <div
      role="img"
      aria-label={labels.aria}
      data-home-screen
      data-theme="dark"
      className={cn(
        'grid grid-cols-2 gap-4 rounded-2xl bg-gradient-to-b from-bg-tertiary to-bg px-4 py-5',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col items-center gap-2">
        <span className={caption}>{labels.ios}</span>
        <span
          data-home-tile="ios"
          className="grid size-16 place-items-center overflow-hidden rounded-[22.37%] bg-black shadow-sm"
        >
          {renderIcon('ios')}
        </span>
        <span className={name}>{displayName.trim()}</span>
      </div>
      <div className="flex min-w-0 flex-col items-center gap-2">
        <span className={caption}>{labels.android}</span>
        <span
          data-home-tile="android"
          className="grid size-16 place-items-center overflow-hidden rounded-full shadow-sm"
          style={{ backgroundColor: ground }}
        >
          <span className="grid place-items-center" style={{ width: safe, height: safe }}>
            {renderIcon('android')}
          </span>
        </span>
        <span className={name}>{homeScreenLabel(displayName)}</span>
      </div>
    </div>
  );
}
