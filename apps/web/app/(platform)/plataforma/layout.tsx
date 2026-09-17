import { ToastProvider } from '@tria/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PlatformRail } from '@/components/platform/PlatformRail';
import { requirePlatformAccess } from '@/lib/platform';
import { getHostTenant } from '@/lib/tenant-host';
import { signOutPlatform } from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('platform');
  return { title: t('title') };
}

/**
 * The platform panel's shell (D-21/D-23/D-33): a 240 px rail on desktop, a top bar on the phone,
 * and a 1040 px content column, always in the neutral TRIA brand (no tenant `--brand-*` is set on
 * the platform host).
 *
 * Access is enforced here, in this order and before anything renders:
 * 1. host gate — the panel exists ONLY on the platform host; a tenant or generic host answers 404
 *    without a single API call (T-02-60), through Next's default not-found (no panel chrome);
 * 2. authorisation — `requirePlatformAccess`: a 200 from `GET /v1/platform/tenants?limit=1` is the
 *    only proof this session is a super_admin; a member (403 FORBIDDEN) or a platform session on the
 *    wrong host (403 TENANT_HOST_MISMATCH) is signed out through `/auth/host-mismatch`, an expired
 *    session goes back to `/entrar`. Claims are never consulted.
 * Every page and tab re-proves it through `requirePlatformTenants` / `requirePlatformTenantDetail`.
 */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode !== 'platform') notFound();

  await requirePlatformAccess();
  const t = await getTranslations('platform');

  return (
    <ToastProvider>
      <div className="min-h-screen bg-bg text-text md:flex">
        <PlatformRail
          labels={{
            brand: t('nav.brand'),
            title: t('nav.title'),
            tenants: t('nav.tenants'),
            logout: t('nav.logout'),
            nav: t('nav.panelNav'),
          }}
          signOutAction={signOutPlatform}
        />
        <main className="min-w-0 flex-1 px-4 pb-12 pt-6 md:px-6 md:pt-12">
          <div className="mx-auto w-full max-w-[1040px]">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
