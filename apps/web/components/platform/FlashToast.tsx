'use client';

import { useToast } from '@rede-social/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

/**
 * Fires the toast a server-action redirect asked for (`?toast=created` after `createTenantAction`)
 * once on mount, then strips the parameter with `router.replace` so a reload does not repeat it.
 * Mount under `<Suspense>` (it reads the search params). Unknown keys are ignored.
 */
export function FlashToast() {
  const t = useTranslations('platform');
  const { show } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const key = searchParams.get('toast');

  // biome-ignore lint/correctness/useExhaustiveDependencies: fire once per landing, keyed by the param
  useEffect(() => {
    if (!key) return;
    const messages: Record<string, string> = { created: t('new.created') };
    const message = messages[key];
    if (message) show({ tone: 'success', message });
    router.replace(pathname);
  }, [key]);

  return null;
}
