import { THEME_COOKIE } from '@tria/contracts/branding';
import { ThemeToggle } from '@tria/core/ui';
import { ToastProvider } from '@tria/ui';
import { SunMoon } from 'lucide-react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { setTheme } from '@/app/(app)/actions';
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
 *
 * Theme row (D-41, 02-16): the kernel `ThemeToggle` is mounted into the rail's `themeSlot` with the
 * same strict cookie read as the root layout (only the literal `dark` selects dark, T-02-30/T-02-133)
 * and 02-07's `setTheme` action, so the next server render already carries `data-theme` (no flash).
 * The label is `app.nav.theme` — no new catalog key. The platform host keeps the neutral tokens, so
 * the checked track renders the neutral accent by design.
 */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode !== 'platform') notFound();

  await requirePlatformAccess();
  const t = await getTranslations('platform');
  const ta = await getTranslations('app');
  const theme = (await cookies()).get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';

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
          themeSlot={
            <div className="flex h-11 items-center gap-3 px-3 text-sm text-text-secondary">
              <SunMoon aria-hidden size={22} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{ta('nav.theme')}</span>
              <ThemeToggle initial={theme} label={ta('nav.theme')} action={setTheme} />
            </div>
          }
        />
        <main className="min-w-0 flex-1 px-4 pb-12 pt-6 md:px-6 md:pt-12">
          <div className="mx-auto w-full max-w-[1040px]">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
