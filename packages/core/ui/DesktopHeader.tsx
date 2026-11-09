'use client';

import { Avatar, Badge, cn } from '@rede-social/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useBeforeLogout, useLogoutSubmit } from './BeforeLogout';
import {
  activeArea,
  activeTabChrome,
  activeTabKey,
  iconFor,
  isAreaScreenCurrent,
  isNavItemActive,
  type ShellNav,
} from './nav';
import { useLiveCounters } from './realtime/LiveCountersProvider';
import { slotAccessibleName, slotBadgeStyle, useSlotBadgeLabel } from './realtime/SlotBadgeLabels';

export interface DesktopHeaderProps {
  /** The shell's nav: the page's name comes from it, and its slots are the header's shortcuts. */
  nav: ShellNav;
  /**
   * The server-rendered counters. Inside a `LiveCountersProvider` (the tenant shell) the live value
   * wins; without one (the platform shell, tests) this static prop is what the shortcuts show.
   */
  counters: {
    unreadNotifications: number;
    unreadConversations: number;
    /** 07-09: the chat slot draws a member's `dot` or the staff `count` (default). */
    conversationsBadge?: 'dot' | 'count';
  };
  labels: {
    settings: string;
    logout: string;
    theme: string;
    /**
     * The profile's name ("Meu perfil"): the account button's name without `accountMenu`, and the
     * menu's profile row without `viewProfile`.
     */
    profile?: string;
    /** `shortcuts` ("Atalhos") names the shortcuts' navigation. */
    sections?: { shortcuts?: string };
    /** The account button's name ("Menu da conta"). */
    accountMenu?: string;
    /** The account menu's profile row ("Ver perfil"). */
    viewProfile?: string;
    /** The kernel home tab's name on the desktop ("Feed"), as the rail names it. */
    homeTab?: string;
  };
  /** The signed-in person: the photo on the account button, the name beside it from `lg`. */
  account?: { name: string; avatarSrc: string | null };
  settingsHref: string;
  /** The device-local sign-out server action (D-08). */
  logoutAction: () => Promise<void>;
  /** The "Tema" row's control (a `ThemeToggle`); the row is omitted when absent. */
  themeToggle?: ReactNode;
}

type HeaderLabels = DesktopHeaderProps['labels'];

/**
 * The name of the page, from the nav alone: the area screen that IS this page ("Fotos", "Comprados"),
 * else the area ("Membros" on a lesson), else the current tab (the home tab under its desktop name),
 * else the current slot ("Notificações"), else Configurações on its pages. `null` anywhere else.
 */
function pageTitle(
  nav: ShellNav,
  pathname: string,
  labels: HeaderLabels,
  settingsHref: string,
): string | null {
  const area = activeArea(nav.tabs, nav.areas, pathname, nav.topbar);
  if (area) {
    return (
      area.screens.find((screen) => isAreaScreenCurrent(pathname, screen))?.label ?? area.label
    );
  }
  const tabKey = activeTabKey(nav.tabs, pathname);
  const tab = nav.tabs.find((item) => item.key === tabKey);
  if (tab) return tab.key === 'home' && labels.homeTab ? labels.homeTab : tab.label;
  const slotKey = activeTabKey(nav.topbar, pathname);
  const slot = nav.topbar.find((item) => item.key === slotKey);
  if (slot) return slot.label;
  return isNavItemActive(pathname, settingsHref) ? labels.settings : null;
}

/**
 * Whether the shell's scroll root (`#app-scroll`, a sibling of the header) has left its top: the
 * header's ground shows only then. Re-read on every route, which the scroll root resets to the top.
 */
function useScrolledPage(pathname: string): boolean {
  const [scrolled, setScrolled] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the pathname IS the trigger, a new page starts at its top
  useEffect(() => {
    const root = document.getElementById('app-scroll');
    if (!root) return;
    const update = () => setScrolled(root.scrollTop > 0);
    update();
    root.addEventListener('scroll', update, { passive: true });
    return () => root.removeEventListener('scroll', update);
  }, [pathname]);
  return scrolled;
}

const slotClasses =
  'relative inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary';

const menuRow =
  'flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary';
const menuRowIdle = 'text-text-secondary hover:bg-bg-hover hover:text-text';
const menuRowActive = 'bg-[var(--theme-chip)] font-semibold text-brand';

/**
 * The account button at the header's right end and the menu it drops (2026-10-26, the rail's old
 * account card): the person's photo (and name from `lg`) as ONE button that opens, right-aligned
 * under it, the profile, Configurações, the theme switch and Sair. Without a name (the platform
 * host's shell) the photo is the generic one and the same menu holds Configurações, Tema and Sair.
 *
 * A disclosure (the area menu's): `aria-expanded`/`aria-controls` over a panel of links and the
 * sign-out form, whose submit first runs the host's pre-logout cleanup (`useBeforeLogout`, bounded to
 * 2 s). A tap outside, Escape (focus back on the button) and a route change close it.
 */
function AccountMenu({
  account,
  profileHref,
  settingsHref,
  labels,
  logoutAction,
  themeToggle,
}: {
  account?: DesktopHeaderProps['account'];
  profileHref: string | null;
  settingsHref: string;
  labels: HeaderLabels;
  logoutAction: () => Promise<void>;
  themeToggle?: ReactNode;
}) {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const onLogoutSubmit = useLogoutSubmit(useBeforeLogout());
  const ProfileIcon = iconFor('user');
  const SettingsIcon = iconFor('settings');
  const ThemeIcon = iconFor('sun');
  const LogoutIcon = iconFor('log-out');
  const ChevronIcon = iconFor('chevron-down');
  const name = account?.name.trim() ?? '';
  const onProfile = profileHref !== null && isNavItemActive(pathname, profileHref);
  const onSettings = isNavItemActive(pathname, settingsHref);

  // A route change closes the menu.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the pathname IS the trigger
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative" data-shell-account="">
      <button
        ref={buttonRef}
        type="button"
        aria-label={labels.accountMenu ?? (name ? (labels.profile ?? name) : labels.settings)}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex h-11 items-center gap-1.5 rounded-full p-1 pr-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary',
          name && 'lg:gap-2 lg:pr-3',
          open ? 'bg-bg-hover' : 'hover:bg-bg-hover',
        )}
      >
        {/* The button is named by `aria-label`: the photo is decorative here. On the profile or the
            settings, the ring marks the account as the place the person is in (the TopBar avatar's). */}
        <span
          className={cn(
            'inline-flex rounded-full border-2 transition-colors',
            onProfile || onSettings ? 'border-brand' : 'border-transparent',
          )}
        >
          <Avatar size="sm" src={account?.avatarSrc ?? null} alt="" />
        </span>
        {name ? (
          <span className="hidden max-w-40 truncate text-sm font-semibold text-text lg:block">
            {name}
          </span>
        ) : null}
        <ChevronIcon
          aria-hidden
          size={16}
          className={cn('shrink-0 text-text-tertiary', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div
          id={panelId}
          data-shell-account-menu=""
          className="absolute top-full right-0 mt-2 flex w-60 flex-col gap-0.5 rounded-xl border border-border bg-bg-secondary p-1.5 shadow-lg"
        >
          {profileHref ? (
            <Link
              href={profileHref}
              aria-current={onProfile ? 'page' : undefined}
              className={cn(menuRow, onProfile ? menuRowActive : menuRowIdle)}
            >
              <ProfileIcon aria-hidden size={18} strokeWidth={1.8} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {labels.viewProfile ?? labels.profile ?? name}
              </span>
            </Link>
          ) : null}
          <Link
            href={settingsHref}
            aria-current={onSettings ? 'page' : undefined}
            className={cn(menuRow, onSettings ? menuRowActive : menuRowIdle)}
          >
            <SettingsIcon aria-hidden size={18} strokeWidth={1.8} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{labels.settings}</span>
          </Link>
          {themeToggle ? (
            <div className={cn(menuRow, 'text-text-secondary')}>
              <ThemeIcon aria-hidden size={18} strokeWidth={1.8} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{labels.theme}</span>
              {/* The control's only child: the host's element reaches a client component as a lazy
                  reference in development, and among siblings React would ask it for a key. */}
              <span className="inline-flex shrink-0">{themeToggle}</span>
            </div>
          ) : null}
          <div aria-hidden className="mx-2 my-1 h-px bg-divider" />
          <form action={logoutAction} onSubmit={onLogoutSubmit}>
            <button type="submit" className={cn(menuRow, menuRowIdle, 'hover:text-danger')}>
              <LogoutIcon aria-hidden size={18} strokeWidth={1.8} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">{labels.logout}</span>
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Desktop header (2026-10-26, the product owner: "no sistema todo em modo desktop um header com as
 * informações que estão no rodapé da navbar lateral"): the 64px bar over the content column, right
 * of the `DesktopRail`, hidden below `md` (the phone keeps its TopBar). What sat at the rail's foot
 * lives here now:
 *
 *  - on the left, the page's name as plain text (`data-shell-header-title`), read from the nav
 *    alone (`pageTitle`); never a heading, the page keeps its one h1;
 *  - on the right, the registry `topbar` slots the rail does not list under Principal (the
 *    Notificações and Suporte shortcuts, `data-shell-shortcuts`): 44px round icon links with their
 *    live counts, as the phone's TopBar draws them;
 *  - then the account button and its menu (`AccountMenu`, `data-shell-account`).
 *
 * A SIBLING of the scroll root, over its top in the same cell of the shell's grid (`AppShell`), whose
 * top padding keeps the page's first line clear of it. It sits on the stacking ladder's chrome rung
 * (`z-50`, the TopBar's), so its menu drops over the page's sticky layer (40), and the full-screen
 * surfaces (52) and the sheets and dialogs (55) still open over it; its own stacking context never
 * holds an overlay.
 *
 * **2026-10-26 — no ground of its own** (the product owner: "o header também não [deve ter bg],
 * porém ao scrollar a página ele deve desfocar o fundo na área dele"): at the top of a page it is the
 * page's name and its controls on the page itself; once the page scrolls under it, a layer behind
 * them (`data-shell-header-ground`) fades in and blurs what passes beneath, with a hairline at its
 * foot. The blur lives on that layer, never on the header, so the header never becomes the
 * containing block of anything fixed inside it.
 *
 * Media chrome (UI-D-81): while the active entry declares `chrome: 'media'` (Reels) the header is not
 * rendered, as the phone's TopBar is not: the video stage owns the top of the screen there, and the
 * rail beside it keeps the way out.
 */
export function DesktopHeader({
  nav,
  counters,
  labels,
  account,
  settingsHref,
  logoutAction,
  themeToggle,
}: DesktopHeaderProps) {
  const pathname = usePathname() ?? '';
  // Live counters inside the tenant shell's provider; the static prop otherwise (platform, tests).
  const shown = useLiveCounters() ?? counters;
  const labelFor = useSlotBadgeLabel();
  const scrolled = useScrolledPage(pathname);

  if (activeTabChrome([...nav.tabs, ...nav.topbar], pathname) === 'media') return null;

  const title = pageTitle(nav, pathname, labels, settingsHref);
  // The slots the rail lists under Principal (`railMain`, the Loja) stay there.
  const shortcuts = nav.topbar.filter((slot) => !slot.railMain);
  // The kernel Perfil is the account menu's first row; the rail leaves it out of its tabs.
  const profileHref = nav.tabs.find((tab) => tab.key === 'profile')?.href ?? null;

  return (
    <header
      data-shell-header=""
      data-scrolled={scrolled || undefined}
      className="relative z-50 hidden h-16 min-w-0 items-center gap-4 px-6 md:col-start-2 md:row-start-1 md:flex md:self-start"
    >
      <div
        aria-hidden
        data-shell-header-ground=""
        className={cn(
          // The shell's frosted glass (tokens.css), the open desktop rail's too.
          'shell-glass pointer-events-none absolute inset-0 -z-10 border-b border-border transition-opacity duration-200 motion-reduce:transition-none',
          scrolled ? 'opacity-100' : 'opacity-0',
        )}
      />
      {title ? (
        <p data-shell-header-title="" className="min-w-0 truncate text-sm font-semibold text-text">
          {title}
        </p>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {shortcuts.length > 0 ? (
          <nav
            aria-label={labels.sections?.shortcuts}
            data-shell-shortcuts=""
            className="flex items-center gap-1"
          >
            {shortcuts.map((slot) => {
              const Icon = iconFor(slot.icon);
              const active = isNavItemActive(pathname, slot.href);
              const count = slot.badge ? shown[slot.badge] : 0;
              // D-237/D-238: the chat slot follows `conversationsBadge` (member dot, staff count).
              const style = slotBadgeStyle(slot.badge, shown.conversationsBadge);
              return (
                <Link
                  key={slot.key}
                  href={slot.href}
                  data-slot={slot.key}
                  aria-label={slotAccessibleName(slot.label, slot.badge, count, labelFor, style)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    slotClasses,
                    active
                      ? 'bg-[var(--theme-chip)] text-brand'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text',
                  )}
                >
                  <Icon aria-hidden size={20} strokeWidth={active ? 2.2 : 1.8} />
                  {count > 0 ? (
                    <span aria-hidden className="absolute top-1 right-1">
                      <Badge count={count} variant={style} />
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        ) : null}

        <AccountMenu
          account={account}
          profileHref={profileHref}
          settingsHref={settingsHref}
          labels={labels}
          logoutAction={logoutAction}
          themeToggle={themeToggle}
        />
      </div>
    </header>
  );
}
