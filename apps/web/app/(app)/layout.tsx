import { brandStyleVars, resolveBranding } from '@rede-social/contracts';
import { THEME_COOKIE } from '@rede-social/contracts/branding';
import { AppShell, buildNav, type ShellNav, ThemeToggle } from '@rede-social/core/ui';
import type { Viewport } from 'next';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { LiveShell } from '@/components/shell/LiveShell';
import { getBootstrap, requireBootstrap } from '@/lib/bootstrap';
import { env } from '@/lib/env';
import { requirePlatformTenants } from '@/lib/platform';
import { moduleLabelResolver } from '@/lib/registry';
import { getHostTenant } from '@/lib/tenant-host';
import { logout, setTheme } from './actions';

/**
 * `theme-color` = the tenant's primary on tenant hosts (UI-SPEC §PWA); the client updates the meta on
 * the theme toggle. The bootstrap is the React-cached call the layout makes anyway; when it refuses,
 * the layout performs the redirect — here the colour is simply omitted.
 */
export async function generateViewport(): Promise<Viewport> {
  const base: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };
  const host = await getHostTenant();
  if (host.mode !== 'tenant') return base;
  try {
    const { tenant } = await getBootstrap();
    return { ...base, themeColor: resolveBranding(tenant.branding).colors.primary };
  } catch {
    return base;
  }
}

/**
 * Authenticated shell (UI-03, D-39). proxy.ts already required a verified session; this layout
 * resolves the tenant of record from `GET /v1/me/bootstrap` (never from the host) and renders the
 * responsive `AppShell` around every (app) page. On the platform host there is no membership to
 * bootstrap (D-21; authorised by `GET /v1/platform/tenants`), so the shell is neutral and its single
 * tab points at the platform panel (`/plataforma`, 02-12) — the landing stays `/inicio`, no redirect.
 *
 * TENANT-02 / MOD-04: brand (`--brand-*` on `[data-brand-root]`) and navigation (`buildNav` over the
 * ENABLED module entries) come from the bootstrap alone, per request, never cached by path (Pitfall 1),
 * so the first server-rendered HTML already carries the member's own brand and tabs.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const [hostTenant, t, tp, tRoot, cookieStore] = await Promise.all([
    getHostTenant(),
    getTranslations('app'),
    getTranslations('platform'),
    getTranslations(),
    cookies(),
  ]);
  // D-41: the theme is per device, not per tenant — the same cookie read as the root layout's.
  const theme = cookieStore.get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  const labels = {
    mainNav: t('nav.mainNav'),
    profile: t('nav.openProfile'),
    settings: t('nav.settings'),
    logout: t('logout'),
    theme: t('nav.theme'),
  };

  if (hostTenant.mode === 'platform') {
    // D-21/D-23: authorised by the API, never by claims; refusals redirect (see requirePlatformTenants).
    await requirePlatformTenants();
    const nav: ShellNav = {
      tabs: [{ key: 'tenants', href: '/plataforma', icon: 'building-2', label: tp('tenants') }],
      topbar: [],
    };
    return (
      <AppShell
        brand={{ displayName: tp('title'), logoUrl: null }}
        nav={nav}
        counters={{ unreadNotifications: 0, unreadConversations: 0 }}
        avatar={{ src: null, alt: '' }}
        labels={labels}
        settingsHref="/configuracoes"
        logoutAction={logout}
        themeToggle={<ThemeToggle initial={theme} label={t('nav.theme')} action={setTheme} />}
      >
        {children}
      </AppShell>
    );
  }

  // 401/403 refusals (blocked, host mismatch, no membership) redirect — see requireBootstrap.
  const bootstrap = await requireBootstrap();
  const { tenant, membership } = bootstrap;
  const branding = resolveBranding(tenant.branding);
  const nav = buildNav(bootstrap.modules, {
    home: t('nav.home'),
    profile: t('nav.profile'),
    module: moduleLabelResolver(tRoot),
  });

  // 07-03 (NOTIF-02): the live layer — one Realtime client, the live counters and the stateful slot
  // labels — wraps the tenant shell only. The platform branch above stays static.
  return (
    <LiveShell
      supabaseUrl={env.NEXT_PUBLIC_SUPABASE_URL}
      publishableKey={env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}
      tenantId={tenant.id}
      userId={bootstrap.user.id}
      initialCounters={bootstrap.counters}
      notificationsEnabled={bootstrap.modules.some((m) => m.key === 'notifications')}
      vapidPublicKey={env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
    >
      <AppShell
        brand={{ displayName: tenant.displayName, logoUrl: branding.logoUrl }}
        nav={nav}
        counters={bootstrap.counters}
        avatar={{ src: membership.profile.avatarUrl, alt: membership.profile.displayName }}
        labels={labels}
        settingsHref="/configuracoes"
        logoutAction={logout}
        themeToggle={<ThemeToggle initial={theme} label={t('nav.theme')} action={setTheme} />}
        style={brandStyleVars(branding)}
      >
        {children}
      </AppShell>
    </LiveShell>
  );
}
