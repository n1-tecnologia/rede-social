import type { Bootstrap } from '@rede-social/contracts';
import {
  Bell,
  Building2,
  CalendarDays,
  ChevronRight,
  Film,
  Home,
  Info,
  LayoutGrid,
  LogOut,
  type LucideIcon,
  MessageCircle,
  Moon,
  Palette,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  User,
  UserCircle,
  Users,
} from 'lucide-react';

/** The `bootstrap.counters` key a TopBar/rail slot reads for its count badge (D-40). */
export type NavBadge = 'unreadNotifications' | 'unreadConversations';

/** One rendered navigation entry (a tab or a TopBar/rail slot). `icon` is a name, resolved by `iconFor`. */
export interface NavItem {
  key: string;
  href: string;
  icon: string;
  label: string;
  badge?: NavBadge;
  /**
   * UI-D-81: `'media'` = the dark media chrome (no mobile TopBar, dark BottomNav) while this tab is
   * active. Declared by the module's manifest nav entry and carried through the bootstrap; absent on
   * every other entry.
   */
  chrome?: 'media';
  /**
   * A red dot on the tab, with no number (2026-10-03: Eventos while the tenant has an event to
   * come). Never from the bootstrap: the host decides it per request (`withTabDots`) and words it.
   * `description` is what assistive tech reads after the tab's name ("Há eventos por vir", through
   * `aria-describedby`): the NAME stays the tab's own, so a tab is always found by it.
   */
  dot?: { description: string };
  /**
   * While this tab's pages scroll down, the BottomNav folds into the corner (2026-10-03:
   * Comunidades, as in the REINE prototype): the tabs fade out and the pill closes on one round
   * button, the tab's own icon, that takes the page back to the top (and with it the whole bar).
   * Never from the bootstrap: the host decides it (`withCollapsingTabs`) and words the button.
   * `label` is its accessible name ("Comunidades: voltar ao topo").
   */
  collapse?: { label: string };
}

/** What the shell renders: the tab row (BottomNav / rail nav) and the slot row (TopBar / rail bottom group). */
export interface ShellNav {
  tabs: NavItem[];
  topbar: NavItem[];
}

/** Catalog strings for the kernel entries plus a resolver for module labels (`<key>.nav` → fallback). */
export interface NavLabels {
  home: string;
  profile: string;
  module: (key: string, fallback: string) => string | null;
}

/** The slice of a bootstrap module entry the nav needs (structurally satisfied by `Bootstrap['modules']`). */
export type NavModule = Pick<Bootstrap['modules'][number], 'key' | 'nav'>;

type NavEntry = NavModule & { nav: NonNullable<NavModule['nav']> };

const hasNav = (m: NavModule): m is NavEntry => m.nav !== undefined;

/** `nav.order` ascending, then key ascending — the same rule `enabledModulesForBootstrap` applies. */
const byOrderThenKey = (a: NavEntry, b: NavEntry) =>
  a.nav.order === b.nav.order ? a.key.localeCompare(b.key) : a.nav.order - b.nav.order;

function toItem(m: NavEntry, labels: NavLabels): NavItem {
  return {
    key: m.key,
    href: m.nav.href,
    icon: m.nav.icon,
    label: labels.module(m.key, m.nav.label) ?? m.nav.label,
    ...(m.nav.badge ? { badge: m.nav.badge } : {}),
    ...(m.nav.chrome ? { chrome: m.nav.chrome } : {}),
  };
}

/**
 * MOD-04 / D-40: the shell's navigation from the bootstrap's ENABLED module entries.
 *
 * - tabs: kernel Início first, module entries whose `placement` is absent or `'tab'` by order then
 *   key, kernel Perfil last. The two kernel entries have no `tenant_modules` flag (D-16) and are
 *   unconditional; every module entry exists only because the tenant's flags put it in
 *   `bootstrap.modules`, so a disabled module's tab never renders.
 * - topbar: module entries with `placement: 'topbar'`, same sort, carrying their `badge` key.
 *
 * Labels: the module's own catalog namespace (`<key>.nav`) wins over the manifest label (PWA-03).
 */
export function buildNav(modules: ReadonlyArray<NavModule>, labels: NavLabels): ShellNav {
  const entries = modules.filter(hasNav).sort(byOrderThenKey);
  const tabs = entries.filter((m) => (m.nav.placement ?? 'tab') === 'tab');
  const topbar = entries.filter((m) => m.nav.placement === 'topbar');
  return {
    tabs: [
      { key: 'home', href: '/inicio', icon: 'home', label: labels.home },
      ...tabs.map((m) => toItem(m, labels)),
      { key: 'profile', href: '/perfil', icon: 'user', label: labels.profile },
    ],
    topbar: topbar.map((m) => toItem(m, labels)),
  };
}

/**
 * The nav with a red dot on the tabs the host named: `dots` maps a tab key to the dot's description
 * (`NavItem.dot`). A key with no tab in the row, or an empty description, is ignored, and the slots
 * never change.
 */
export function withTabDots(nav: ShellNav, dots: Readonly<Record<string, string>>): ShellNav {
  return {
    ...nav,
    tabs: nav.tabs.map((tab) => {
      const description = Object.hasOwn(dots, tab.key) ? dots[tab.key] : undefined;
      return description ? { ...tab, dot: { description } } : tab;
    }),
  };
}

/**
 * The nav with the BottomNav folding into the corner on the tabs the host named (`NavItem.collapse`):
 * `labels` maps a tab key to the name of the button the bar folds into. A key with no tab in the row,
 * or an empty label, is ignored, and the slots never change.
 */
export function withCollapsingTabs(
  nav: ShellNav,
  labels: Readonly<Record<string, string>>,
): ShellNav {
  return {
    ...nav,
    tabs: nav.tabs.map((tab) => {
      const label = Object.hasOwn(labels, tab.key) ? labels[tab.key] : undefined;
      return label ? { ...tab, collapse: { label } } : tab;
    }),
  };
}

/** The path part of an href: hash and query stripped. */
function pathOf(href: string): string {
  const end = Math.min(
    ...['#', '?'].map((c) => href.indexOf(c)).filter((i) => i >= 0),
    href.length,
  );
  return href.slice(0, end) || '/';
}

/** True when `pathname` is the item's path or a sub-path of it (`/eventos/123` under `/eventos`). */
export function isNavItemActive(pathname: string, href: string): boolean {
  const path = pathOf(href);
  return pathname === path || pathname.startsWith(`${path.replace(/\/$/, '')}/`);
}

/**
 * The tab to mark `aria-current="page"`: the longest matching href path; ties go to the FIRST tab in
 * order, so a module anchor on `/inicio` (`/inicio#exemplo`) never steals Início's active state.
 * `null` when no tab matches (e.g. `/configuracoes`).
 */
export function activeTabKey(tabs: ReadonlyArray<NavItem>, pathname: string): string | null {
  let best: { key: string; length: number } | null = null;
  for (const tab of tabs) {
    if (!isNavItemActive(pathname, tab.href)) continue;
    const length = pathOf(tab.href).length;
    if (!best || length > best.length) best = { key: tab.key, length };
  }
  return best?.key ?? null;
}

/**
 * UI-D-81: the chrome the ACTIVE tab declares (`'media'`), or `null` for the normal chrome. The one
 * rule TopBar and BottomNav share: the kernel reads the declaration from the nav entry and never
 * tests a module's pathname, so any future media tab gets the chrome by declaring it (MOD-02).
 */
export function activeTabChrome(tabs: ReadonlyArray<NavItem>, pathname: string): 'media' | null {
  const key = activeTabKey(tabs, pathname);
  return tabs.find((tab) => tab.key === key)?.chrome ?? null;
}

/**
 * Serialisable icon names (the manifest travels through the bootstrap) → lucide components. The
 * notifications glyph is `Bell` (D-40) — the prototype's heart is not imported anywhere here.
 * Unknown names get a neutral glyph rather than throwing: a new module's typo must not break the shell.
 */
const ICONS: Record<string, LucideIcon> = {
  home: Home,
  user: User,
  users: Users,
  'calendar-days': CalendarDays,
  bell: Bell,
  'message-circle': MessageCircle,
  sparkles: Sparkles,
  'building-2': Building2,
  film: Film,
  settings: Settings,
  sun: Sun,
  moon: Moon,
  'log-out': LogOut,
  'chevron-right': ChevronRight,
  'user-circle': UserCircle,
  info: Info,
  'layout-grid': LayoutGrid,
  // 08-01 (UI-D-269): the Configurações "Moderação" row.
  'shield-check': ShieldCheck,
  // 08-06 (UI-D-269): the Configurações "Marca" row.
  palette: Palette,
  // 08-07 (UI-D-269): the Configurações "Regras da comunidade" row.
  'scroll-text': ScrollText,
};

export function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? LayoutGrid;
}
