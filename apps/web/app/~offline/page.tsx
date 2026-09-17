import { EmptyState } from '@tria/ui';
import { WifiOff } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RetryButton } from './RetryButton';

/**
 * Offline fallback (PWA-01, UI consideration E09, D-33 [designed] screen `offline`). The service
 * worker precaches this page once per origin at build time and serves it for any document
 * navigation that fails while offline.
 *
 * It therefore lives OUTSIDE the (app)/(auth) groups and renders NOTHING session- or tenant-bound
 * (T-02-74): no bootstrap, no brand root, no host brand, no cookies — neutral tokens and catalog
 * strings only, so it renders correctly under both `data-theme` values without a brand root (D-41).
 * "Tentar novamente" reloads; while still offline the reload lands on this same page.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('pwa');
  return { title: t('offline.title'), robots: { index: false } };
}

export default async function OfflinePage() {
  const t = await getTranslations('pwa');
  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <EmptyState
          icon={WifiOff}
          title={t('offline.title')}
          body={t('offline.body')}
          action={<RetryButton label={t('offline.retry')} />}
        />
      </div>
    </main>
  );
}
