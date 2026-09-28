'use client';

import { WifiOff } from 'lucide-react';
import { useOffline } from 'next/offline';
import { useTranslations } from 'next-intl';

/**
 * Connectivity banner (PWA-01), mounted once in the root layout so it shows on every route.
 * `useOffline()` only reports offline when `experimental.useOffline` is on (next.config.ts); with it,
 * Next keeps failed navigations/actions pending and retries them itself when the connection returns —
 * so this banner never refreshes the page and has no dismiss: it simply disappears once the app is
 * back online.
 *
 * Neutral tokens only (it renders above tenant and non-tenant pages alike), pinned under the safe-area
 * top inset, `z-[90]` — below the `@rede-social/ui` toast layer (`z-[100]`). `role="status"` + polite live
 * region so assistive tech announces the change without stealing focus.
 */
export function OfflineBanner() {
  const isOffline = useOffline();
  const t = useTranslations('pwa');
  if (!isOffline) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-[var(--safe-top)] z-[90] mx-auto flex max-w-md items-center justify-center gap-2 rounded-b-xl border-x border-b border-border bg-bg-secondary px-4 py-2 text-sm text-text shadow-sm"
    >
      <WifiOff aria-hidden size={16} className="shrink-0" />
      <span>{t('offline.banner')}</span>
    </div>
  );
}
