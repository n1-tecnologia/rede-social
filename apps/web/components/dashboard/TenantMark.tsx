'use client';

import { useEffect, useRef, useState } from 'react';

export interface TenantMarkProps {
  /** The tenant's initial, the tile's text and its fallback. */
  initial: string;
  /** The tenant's square app icon (`branding.iconUrls.i192`), or null when it has none. */
  iconUrl: string | null;
}

/**
 * The tenant's mark in the owner panel's header: a brand-filled tile with the tenant's initial, the
 * rede-social-dashboard header's mark, covered by the tenant's square app icon when it has one. The
 * name follows it in the header, so the mark is decorative (`aria-hidden`, empty alt).
 *
 * An icon that fails to load uncovers the initial: never a broken image glyph. A server-rendered
 * image can fail before React hydrates, and React does not replay that `error` event, so the element
 * is checked once on mount (`complete` with no natural width, settled by `decode()`), as
 * `HidingLogoImage` does for the tenant logo.
 */
export function TenantMark({ initial, iconUrl }: TenantMarkProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!iconUrl || !img?.complete || img.naturalWidth !== 0) return;
    let live = true;
    img.decode().catch(() => {
      if (live) setFailedSrc(iconUrl);
    });
    return () => {
      live = false;
    };
  }, [iconUrl]);

  const showIcon = iconUrl !== null && failedSrc !== iconUrl;

  return (
    <span
      aria-hidden
      data-tenant-mark
      className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-brand text-base font-extrabold text-on-brand"
    >
      {initial}
      {showIcon ? (
        // biome-ignore lint/performance/noImgElement: the tenant's own icon is served as-is (any origin), like `HidingLogoImage`'s logo.
        <img
          ref={imgRef}
          src={iconUrl}
          alt=""
          onError={() => setFailedSrc(iconUrl)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
    </span>
  );
}
