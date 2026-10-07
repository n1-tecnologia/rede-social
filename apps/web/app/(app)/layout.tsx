import { resolveBranding } from '@rede-social/contracts';
import { THEME_COOKIE } from '@rede-social/contracts/branding';
import {
  AppShell,
  buildNav,
  type ShellNav,
  ThemeToggle,
  withAreas,
  withCollapsingTabs,
  withTabDots,
} from '@rede-social/core/ui';
import type { Viewport } from 'next';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { TitleFontSheet } from '@/components/brand/TitleFontSheet';
import { FirstOpenAsk } from '@/components/push/FirstOpenAsk';
import { LiveShell } from '@/components/shell/LiveShell';
import { TabDotRefresh } from '@/components/shell/TabDotRefresh';
import { getBootstrap, requireBootstrap } from '@/lib/bootstrap';
import { brandScope } from '@/lib/brand-scope';
import { env } from '@/lib/env';
import { requirePlatformTenants } from '@/lib/platform';
import { areasFor, collapsingTabsFor, moduleLabelResolver, tabDotsFor } from '@/lib/registry';
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
 *
 * The saved look (2026-10-03, the bootstrap brand's `look`): `brandScope` adds its custom properties
 * to the root's style and its markers to the root (`brandAttributes`: the ground tones, the dark
 * theme's own pair, the title font and the inks of both themes, which tokens.css and globals.css
 * pick per theme), and `TitleFontSheet` loads the saved family's one Google stylesheet after
 * hydration. A brand without a look renders exactly as before.
 *
 * Tab dots (2026-10-03): the red dot on a tab whose module asks for it (`tabDotsFor`, the registry's
 * loaders; today Eventos while an event is to come) is read here too, per request, after the
 * bootstrap, and drawn by the kernel's BottomNav and rail; `TabDotRefresh` asks again when a dot
 * may change while the app stays open.
 *
 * Folding bar (2026-10-03): over the pages of a tab whose module asks for it (`collapsingTabsFor`;
 * today Comunidades, as in the REINE prototype), the phone's BottomNav folds into the corner as the
 * page scrolls down, one button named here ("Comunidades: voltar ao topo").
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
        counters={{ unreadNotifications: 0, unreadConversations: 0, conversationsBadge: 'count' }}
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
  const scope = brandScope(branding);
  const tabs = buildNav(bootstrap.modules, {
    home: t('nav.home'),
    profile: t('nav.profile'),
    module: moduleLabelResolver(tRoot),
  });
  const dots = Object.entries(await tabDotsFor(bootstrap, tabs.tabs));
  // 2026-10-06: the areas (today Eventos) fold the TopBar's shortcuts into the area's menu.
  const nav = withAreas(
    withCollapsingTabs(
      withTabDots(tabs, Object.fromEntries(dots.map(([key, dot]) => [key, dot.description]))),
      Object.fromEntries(
        collapsingTabsFor(tabs.tabs).map((tab) => [
          tab.key,
          t('nav.backToTop', { tab: tab.label }),
        ]),
      ),
    ),
    areasFor(tabs.tabs, (key) => tRoot(key)),
  );
  const dotBoundaries = dots.flatMap(([, dot]) => (dot.until ? [dot.until] : []));

  // 07-03 (NOTIF-02): the live layer — one Realtime client, the live counters and the stateful slot
  // labels — wraps the tenant shell only. The platform branch above stays static.
  // 07 review C-WR-01: without the notifications module the API answers every push route with
  // MODULE_DISABLED, so the shell gets no VAPID key and never re-saves a subscription on open.
  const notificationsOn = bootstrap.modules.some((m) => m.key === 'notifications');
  const vapidPublicKey = notificationsOn ? (env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null) : null;
  return (
    <LiveShell
      supabaseUrl={env.NEXT_PUBLIC_SUPABASE_URL}
      publishableKey={env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}
      tenantId={tenant.id}
      userId={bootstrap.user.id}
      initialCounters={bootstrap.counters}
      notificationsEnabled={notificationsOn}
      supportInbox={bootstrap.permissions.includes('chat.support')}
      vapidPublicKey={vapidPublicKey}
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
        style={scope.style}
        brandAttributes={scope.attributes}
      >
        {children}
        {vapidPublicKey ? (
          // Quick 261007-kyp: the installed app's one-time notification ask, inside AppShell so it
          // sits under the ToastProvider and the tenant's brand root. It renders nothing outside
          // standalone and never prompts on its own (see components/push/FirstOpenAsk.tsx).
          <FirstOpenAsk
            vapidKey={vapidPublicKey}
            tenantName={tenant.displayName}
            staff={bootstrap.permissions.includes('chat.support')}
          />
        ) : null}
      </AppShell>
      {scope.titleFontHref ? <TitleFontSheet href={scope.titleFontHref} /> : null}
      {dotBoundaries.length > 0 ? <TabDotRefresh boundaries={dotBoundaries} /> : null}
    </LiveShell>
  );
}
