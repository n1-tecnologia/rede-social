import { ToastProvider } from '@rede-social/ui';
import type { CSSProperties, ReactNode } from 'react';
import { BackStackTracker } from './BackStackTracker';
import { BottomNav } from './BottomNav';
import { DesktopHeader } from './DesktopHeader';
import { DesktopRail } from './DesktopRail';
import type { ShellNav } from './nav';
import { ScrollRoot } from './ScrollRoot';
import { TopBar } from './TopBar';

export interface AppShellProps {
  /**
   * Tenant identity from the bootstrap (D-26) — or the neutral name on the platform's own platform
   * host. `markUrl` (2026-10-26): the page's favicon, the collapsed desktop rail's mark;
   * without it the rail draws the name's initial.
   */
  brand: { displayName: string; logoUrl: string | null; markUrl?: string | null };
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
  labels: {
    mainNav: string;
    profile: string;
    settings: string;
    logout: string;
    theme: string;
    /**
     * 2026-10-23: the desktop rail's navigation title ("Principal"); `shortcuts` ("Atalhos"), the
     * title of the rail's foot until 2026-10-26, names the desktop header's shortcuts since.
     */
    sections?: { main: string; shortcuts: string };
    /** 2026-10-23: the desktop account button ("Menu da conta"), in the header since 2026-10-26. */
    accountMenu?: string;
    /** 2026-10-23: the account menu's profile row ("Ver perfil"). */
    viewProfile?: string;
    /** 2026-10-23: the home tab's name on the desktop, in the rail and the header ("Feed"). */
    homeTab?: string;
  };
  settingsHref: string;
  /** The device-local sign-out server action (D-08). */
  logoutAction: () => Promise<void>;
  /** The desktop account menu's "Tema" control (a `ThemeToggle`). */
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
 * desktop = the rail + centred 680px column. The root carries `[data-brand-root]` and the tenant's
 * `--brand-*` variables (from the bootstrap only — never the host), with its saved look since
 * 2026-10-03 (the look's custom properties in `style`, its markers in `brandAttributes`), owns the `--screen-h` /
 * `--safe-*` / `--nav-height` contract, mounts the `#liquid-glass` SVG filter once and the single
 * scroll root (`ScrollRoot`). The children render exactly once; only the chrome is duplicated.
 * Since 2026-10-09 it also mounts the `BackStackTracker`, which records the screens the member walks
 * through so every header's back control (`BackLink`) returns to the previous one.
 *
 * 2026-10-23 — the desktop rail is a grouped sidebar (`DesktopRail`): "Principal" and "Atalhos" with
 * the account card at its foot, which reads the person's name and photo from `avatar`.
 *
 * 2026-10-26 — a DESKTOP HEADER (`DesktopHeader`) over the content column takes the rail's foot: the
 * page's name on the left, the shortcuts and the account menu on the right. On the media chrome
 * (Reels) the header is not rendered. The desktop chrome keeps its 7rem of height (the pages'
 * `calc(var(--screen-h) - 7rem)`, which fits a screen to the column): the 4rem header and 1.5rem
 * over and under the page, where the column was padded 3rem and 4rem before. Since the end of
 * 2026-10-26 the header sits OVER the scroll root's top (Instagram's chrome, below).
 *
 * 2026-10-23 — a WIDE page: a page that renders an element with `data-shell-wide` (the courses
 * area, whose screens lay out grids and a player that use the width) lifts the desktop column's cap
 * from 680px to 1280px (`:has()`, so the shell never learns which routes are wide). Every other page
 * keeps the 680px column (D-39).
 *
 * 2026-10-26 — a FULL page: `data-shell-full` (the member area on the academy reference, the product
 * owner: "o aproveitamento de tela deve ser igual, sem grandes margens brancas") lifts the cap
 * entirely; the column keeps the scroll root's 24px sides. A page carries one of the two, never both.
 *
 * 2026-10-26 — Instagram's chrome (the product owner: "a menu bar lateral igual ao instagram
 * desktop, sem bg, e o header também não, porém ao scrollar ele deve desfocar o fundo na área
 * dele"): the grid has ONE row from `md`. The rail is 72px, its glyphs alone ("quero o mesmo efeito
 * de recolhido", on every desktop width); the header and the scroll root share the content cell, the header over the scroll root's top,
 * so the page scrolls UNDER it and the header blurs what passes beneath (`DesktopHeader`). The scroll
 * root's top padding is the header's 4rem plus the 1.5rem over the page, so the page starts where it
 * did, sticky elements stop under the header (a sticky offset counts from the padded edge) and the
 * desktop chrome keeps its 7rem.
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
      className="flex h-[var(--screen-h)] min-h-[var(--screen-h)] flex-col bg-bg md:grid md:grid-cols-[72px_1fr] md:grid-rows-[minmax(0,1fr)] md:[--nav-height:0px]"
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
        logoutAction={logoutAction}
      />

      <TopBar
        brand={brand}
        slots={nav.topbar}
        counters={counters}
        avatar={avatar}
        profileLabel={labels.profile}
        tabs={nav.tabs}
        areas={nav.areas}
        layout={nav.phoneLayout}
      />

      {/* After the TopBar in the DOM, so the desktop's Tab order reads rail, header, page. */}
      <DesktopHeader
        nav={nav}
        counters={counters}
        labels={labels}
        account={{ name: avatar.alt, avatarSrc: avatar.src }}
        settingsHref={settingsHref}
        logoutAction={logoutAction}
        themeToggle={themeToggle}
      />

      <ToastProvider>
        <BackStackTracker />
        {/* `md:scroll-pt-[5.5rem]`: what scrolls into view (a link's target, the focus) stops under
            the header, never beneath it. */}
        <ScrollRoot className="pt-[calc(var(--safe-top)+3.5rem)] pb-[calc(var(--safe-bottom)+5.25rem)] md:col-start-2 md:row-start-1 md:flex md:scroll-pt-[5.5rem] md:justify-center md:px-6 md:pt-[5.5rem] md:pb-6">
          <div className="w-full md:max-w-[680px] md:has-[[data-shell-wide]]:max-w-[1280px] md:has-[[data-shell-full]]:max-w-none">
            {children}
          </div>
        </ScrollRoot>
      </ToastProvider>

      <BottomNav
        tabs={nav.tabs}
        slots={nav.topbar}
        layout={nav.phoneLayout}
        label={labels.mainNav}
      />
    </div>
  );
}
