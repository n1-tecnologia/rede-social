import { ToastProvider } from '@rede-social/ui';
import type { CSSProperties, ReactNode } from 'react';
import { BottomNav } from './BottomNav';
import { DesktopRail } from './DesktopRail';
import type { ShellNav } from './nav';
import { ScrollRoot } from './ScrollRoot';
import { TopBar } from './TopBar';

export interface AppShellProps {
  /** Tenant identity from the bootstrap (D-26) — or the neutral name on the platform's own platform host. */
  brand: { displayName: string; logoUrl: string | null };
  /** `buildNav(bootstrap.modules, labels)` — never a hard-coded list (MOD-04). */
  nav: ShellNav;
  /**
   * The bootstrap's counters. `conversationsBadge` (07-08) says how the chat slot draws its count, a
   * member's dot or the staff number; 07-09 renders it, and it is optional until then.
   */
  counters: {
    unreadNotifications: number;
    unreadConversations: number;
    conversationsBadge?: 'dot' | 'count';
  };
  avatar: { src: string | null; alt: string };
  labels: { mainNav: string; profile: string; settings: string; logout: string; theme: string };
  settingsHref: string;
  /** The device-local sign-out server action (D-08). */
  logoutAction: () => Promise<void>;
  /** The rail's "Tema" control (a `ThemeToggle`). */
  themeToggle?: ReactNode;
  /**
   * The tenant's brand on tenant hosts: `brandStyleVars(resolveBranding(tenant.branding))` followed
   * by its saved look's custom properties (apps/web `brandScope`); omitted on the platform host.
   */
  style?: CSSProperties;
  /**
   * The saved look's markers and tone ids for the root (`data-bg-tone`, `data-dark-primary`,
   * `data-title-font`, …: apps/web `appBrandLook`), which tokens.css and the app's stylesheet key
   * on; only `data-*` keys pass. Omitted (or empty) for a brand without a look, so the root renders
   * exactly as before.
   */
  brandAttributes?: Readonly<Record<`data-${string}`, string | undefined>>;
  children: ReactNode;
}

/** Only `data-*` keys reach the root, whatever the caller's object holds. */
function dataAttributes(
  attributes: AppShellProps['brandAttributes'],
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(attributes ?? {}).filter(([key]) => key.startsWith('data-')),
  );
}

/**
 * The responsive member shell (UI-03, D-39): one server component, both trees rendered and one hidden
 * by CSS at `md` so there is no layout flash — mobile = prototype TopBar + floating glass BottomNav,
 * desktop = 240px rail + centred 680px column. The root carries `[data-brand-root]` and the tenant's
 * `--brand-*` variables (from the bootstrap only — never the host), with its saved look since
 * 2026-10-03 (the look's custom properties in `style`, its markers in `brandAttributes`), owns the `--screen-h` /
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
  brandAttributes,
  children,
}: AppShellProps) {
  return (
    <div
      {...dataAttributes(brandAttributes)}
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
        tabs={nav.tabs}
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
