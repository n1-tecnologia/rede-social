import { ToastProvider } from '@tria/ui';
import type { CSSProperties, ReactNode } from 'react';
import { BottomNav } from './BottomNav';
import { DesktopRail } from './DesktopRail';
import type { ShellNav } from './nav';
import { ScrollRoot } from './ScrollRoot';
import { TopBar } from './TopBar';

export interface AppShellProps {
  /** Tenant identity from the bootstrap (D-26) — or the neutral name on TRIA's own platform host. */
  brand: { displayName: string; logoUrl: string | null };
  /** `buildNav(bootstrap.modules, labels)` — never a hard-coded list (MOD-04). */
  nav: ShellNav;
  counters: { unreadNotifications: number; unreadConversations: number };
  avatar: { src: string | null; alt: string };
  labels: { mainNav: string; profile: string; settings: string; logout: string; theme: string };
  settingsHref: string;
  /** The device-local sign-out server action (D-08). */
  logoutAction: () => Promise<void>;
  /** The rail's "Tema" control (a `ThemeToggle`). */
  themeToggle?: ReactNode;
  /** `brandStyleVars(resolveBranding(tenant.branding))` on tenant hosts; omitted on the platform host. */
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * The responsive member shell (UI-03, D-39): one server component, both trees rendered and one hidden
 * by CSS at `md` so there is no layout flash — mobile = prototype TopBar + floating glass BottomNav,
 * desktop = 240px rail + centred 680px column. The root carries `[data-brand-root]` and the tenant's
 * `--brand-*` variables (from the bootstrap only — never the host), owns the `--screen-h` /
 * `--safe-*` / `--nav-height` contract, mounts the `#liquid-glass` SVG filter once and the single
 * scroll root (`ScrollRoot`). The children render exactly once; only the chrome is duplicated.
 */
export function AppShell({
  brand,
  nav,
  counters,
  avatar,
  labels,
  settingsHref,
  logoutAction,
  themeToggle,
  style,
  children,
}: AppShellProps) {
  return (
    <div
      data-brand-root
      style={style}
      className="flex h-[var(--screen-h)] min-h-[var(--screen-h)] flex-col bg-bg md:grid md:grid-cols-[240px_1fr] md:[--nav-height:0px]"
    >
      {/* Refraction filter behind the glass bar (prototype DeviceShell): backdrop-filter: url(#id) resolves by global id, so it is mounted here exactly once. */}
      <svg aria-hidden width="0" height="0" className="absolute h-0 w-0">
        <filter id="liquid-glass" x="-60%" y="-60%" width="220%" height="220%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.004 0.009"
            numOctaves="1"
            seed="7"
            result="n"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="n"
            scale="290"
            xChannelSelector="R"
            yChannelSelector="G"
            result="d"
          />
          <feGaussianBlur in="d" stdDeviation="0.6" result="b" />
          <feColorMatrix
            in="b"
            type="matrix"
            values="1.25 0 0 0 0  0 1.25 0 0 0  0 0 1.25 0 0  0 0 0 1 0"
          />
        </filter>
      </svg>

      <DesktopRail
        brand={brand}
        nav={nav}
        counters={counters}
        labels={labels}
        settingsHref={settingsHref}
        logoutAction={logoutAction}
        themeToggle={themeToggle}
      />

      <TopBar
        brand={brand}
        slots={nav.topbar}
        counters={counters}
        avatar={avatar}
        profileLabel={labels.profile}
      />

      <ToastProvider>
        <ScrollRoot className="pt-[calc(var(--safe-top)+3.5rem)] pb-[calc(var(--safe-bottom)+5.25rem)] md:flex md:justify-center md:px-6 md:pt-12 md:pb-16">
          <div className="w-full md:max-w-[680px]">{children}</div>
        </ScrollRoot>
      </ToastProvider>

      <BottomNav tabs={nav.tabs} label={labels.mainNav} />
    </div>
  );
}
