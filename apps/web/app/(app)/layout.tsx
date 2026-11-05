import { resolveBranding } from '@rede-social/contracts';
import { THEME_COOKIE } from '@rede-social/contracts/branding';
import {
  AppShell,
  type ShellNav,
  ThemeToggle,
  withAreas,
  withCollapsingTabs,
  withPhoneLayout,
  withPhoneTabSlots,
  withRailMainSlots,
  withTabDots,
} from '@rede-social/core/ui';
import type { Viewport } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { TitleFontSheet } from '@/components/brand/TitleFontSheet';
import { FirstOpenAsk } from '@/components/push/FirstOpenAsk';
import { LiveShell } from '@/components/shell/LiveShell';
import { TabDotRefresh } from '@/components/shell/TabDotRefresh';
import { getBootstrap, requireBootstrap } from '@/lib/bootstrap';
import { brandScope } from '@/lib/brand-scope';
import { env } from '@/lib/env';
import { iconsFor } from '@/lib/manifest';
import { requirePlatformTenants } from '@/lib/platform';
import { readPhoneNavLayout } from '@/lib/phone-nav-layout-cookie';
import { areasFor, collapsingTabsFor, tabDotsFor } from '@/lib/registry';
import { MAIN_SLOTS, shellTabs } from '@/lib/shell-tabs';
import { coordinatesForRequest, SupabaseCoordinatesUnavailableError } from '@/lib/supabase/server';
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
 *
 * Areas per request (2026-10-22): `areasFor` gets the bootstrap, because the courses area depends on
 * the caller ("Membros" for a member; "Cursos", plus the "Membros" preview variant under the member
 * area, for a manager, whose Cursos tab is also current there: `memberAreaTabOverrides`).
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
    // 2026-10-23: the desktop rail's groups and its account card (the grouped sidebar).
    sections: { main: t('nav.sections.main'), shortcuts: t('nav.sections.shortcuts') },
    accountMenu: t('nav.accountMenu'),
    viewProfile: t('nav.viewProfile'),
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
  // The caller's tabs and slots (`shellTabs`, shared with Marca's phone bar order since 2026-10-28).
  const tabs = shellTabs(
    bootstrap,
    { home: t('nav.home'), profile: t('nav.profile'), memberNav: tRoot('courses.memberNav') },
    tRoot,
  );
  const dots = Object.entries(await tabDotsFor(bootstrap, tabs.tabs));
  // 2026-10-06: the areas (Eventos; since 2026-10-22 the school's too) fold the TopBar's shortcuts
  // into the area's menu. 2026-10-23: on the desktop rail the Loja is a destination of its own,
  // under Principal with the tabs; the other slots stay the Atalhos at the rail's foot. 2026-10-24:
  // the Loja slot owns an area too ("· Loja"), so the areas are read over the tabs AND the slots.
  // 2026-10-28: on the phone the Loja leaves the TopBar for the BottomNav, as its last tab.
  // 2026-11-05: the phone's bar and top follow the "Menu do app" chosen in Configurações on this
  // device (`lib/phone-nav-layout.ts`); the desktop never reads it.
  const nav = withPhoneLayout(
    withPhoneTabSlots(
      withRailMainSlots(
        withAreas(
          withCollapsingTabs(
            withTabDots(tabs, Object.fromEntries(dots.map(([key, dot]) => [key, dot.description]))),
            Object.fromEntries(
              collapsingTabsFor(tabs.tabs).map((tab) => [
                tab.key,
                t('nav.backToTop', { tab: tab.label }),
              ]),
            ),
          ),
          areasFor([...tabs.tabs, ...tabs.topbar], (key) => tRoot(key), bootstrap),
        ),
        MAIN_SLOTS,
      ),
      MAIN_SLOTS,
    ),
    await readPhoneNavLayout(),
  );
  const dotBoundaries = dots.flatMap(([, dot]) => (dot.until ? [dot.until] : []));

  // 07-03 (NOTIF-02): the live layer — one Realtime client, the live counters and the stateful slot
  // labels — wraps the tenant shell only. The platform branch above stays static.
  // 07 review C-WR-01: without the notifications module the API answers every push route with
  // MODULE_DISABLED, so the shell gets no VAPID key and never re-saves a subscription on open.
  // 09.2-17 (D-538): the Realtime client talks to the HOST's project. A tenant whose project address was
  // refused has no coordinates and is unavailable to the shell, never served from the central project.
  let live: Awaited<ReturnType<typeof coordinatesForRequest>> | null = null;
  try {
    live = await coordinatesForRequest();
  } catch (error) {
    if (!(error instanceof SupabaseCoordinatesUnavailableError)) throw error;
  }
  if (!live) redirect('/comunidade-indisponivel');
  // 2026-10-26 — the collapsed desktop rail's mark is the page's favicon (the product owner: "o que
  // deve aparecer quando o menu estiver recolhido é a mesma imagem do favicon"): the same choice the
  // root layout's <link rel="icon"> makes (`iconsFor`, the manifest's allow-list, T-02-72), the
  // brand's own or the neutral one, read from the HOST's project (09.2-17), as the root layout does.
  const markUrl = iconsFor(branding, live.origin).favicon;

  const notificationsOn = bootstrap.modules.some((m) => m.key === 'notifications');
  const vapidPublicKey = notificationsOn ? (env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null) : null;
  return (
    <LiveShell
      supabaseUrl={live.url}
      publishableKey={live.publishableKey}
      tenantId={tenant.id}
      userId={bootstrap.user.id}
      initialCounters={bootstrap.counters}
      notificationsEnabled={notificationsOn}
      supportInbox={bootstrap.permissions.includes('chat.support')}
      vapidPublicKey={vapidPublicKey}
    >
      <AppShell
        brand={{ displayName: tenant.displayName, logoUrl: branding.logoUrl, markUrl }}
        nav={nav}
        counters={bootstrap.counters}
        avatar={{ src: membership.profile.avatarUrl, alt: membership.profile.displayName }}
        labels={{
          ...labels,
          // 2026-10-23: on the desktop the home tab is named for what it holds, "Feed", while the
          // feed module is on (without it the home has no feed and stays "Início"); the phone keeps
          // "Início" either way.
          homeTab: bootstrap.modules.some((m) => m.key === 'feed') ? t('nav.feed') : undefined,
        }}
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
