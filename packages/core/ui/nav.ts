import type { Bootstrap } from '@rede-social/contracts';
import {
  Bell,
  Building2,
  CalendarDays,
  Camera,
  ChevronRight,
  CreditCard,
  Film,
  GraduationCap,
  Heart,
  Home,
  Info,
  LayoutGrid,
  LogOut,
  type LucideIcon,
  Menu,
  MessageCircle,
  Moon,
  Palette,
  QrCode,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Sun,
  Ticket,
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
  /**
   * Extra path prefixes that ALSO mark this tab current (`activeTabKey`), besides `href`'s own: a tab
   * whose entry page moved off the path its detail pages still live under (the member area at its
   * own route, the course pages shared with the admin). Never from the bootstrap: the host sets it
   * (`withTabOverrides`).
   */
  matches?: ReadonlyArray<string>;
}

/** What the shell renders: the tab row (BottomNav / rail nav) and the slot row (TopBar / rail bottom group). */
/**
 * A tab whose pages form an AREA with screens of their own (2026-10-06, the REINE prototype's
 * Eventos: Eventos, Fotos, Check-in, Meus). While the member is inside it, the phone's TopBar names
 * the area beside the logo ("· Eventos") and its right side collapses into one menu: the area's
 * screens first, then the bar's own shortcuts. The rail lists the screens under the tab. Never from
 * the bootstrap: the host declares it (`withAreas`) and words it.
 */
export interface NavArea {
  /** The tab whose pages ARE the area (`NavItem.key`). */
  key: string;
  /** "Eventos": the TopBar's label and the menu's section title. */
  label: string;
  /** The menu button's accessible name ("Menu de Eventos"). */
  menuLabel: string;
  /** The area's screens, in order. */
  screens: NavItem[];
}

export interface ShellNav {
  tabs: NavItem[];
  topbar: NavItem[];
  /** 2026-10-06: the tabs that form an area (`withAreas`); absent, no area anywhere. */
  areas?: NavArea[];
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

/** A slot's position in the TopBar row: its `topbarOrder` when it declares one, else its `order`. */
const slotOrder = (m: NavEntry) => m.nav.topbarOrder ?? m.nav.order;

/** The TopBar row's sort: slot order ascending, then key ascending (the kernel tie-break). */
const bySlotOrderThenKey = (a: NavEntry, b: NavEntry) =>
  slotOrder(a) === slotOrder(b) ? a.key.localeCompare(b.key) : slotOrder(a) - slotOrder(b);

/** True when the entry declares at least one key it yields its tab to. */
const declaresYield = (m: NavEntry) => (m.nav.yieldsTabTo?.length ?? 0) > 0;

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
 * - topbar: module entries with `placement: 'topbar'`, carrying their `badge` key, plus every
 *   yielded tab (below), sorted by `topbarOrder ?? order`, then key.
 *
 * Yield (D-401 / D-419, data-driven): a tab entry whose `yieldsTabTo` names a key that is itself a
 * tab here, and does not yield in turn, renders as a TopBar slot instead (Reels while the school's
 * Cursos tab exists). The rule is one hop over the bootstrap's own data, so two entries naming each
 * other both stay tabs, and an entry naming a disabled or slot-only module stays a tab. The kernel
 * never names a module: which entry yields to which is the manifests' declaration (MOD-02). A
 * yielded entry keeps its `chrome`, which `activeTabChrome` reads over the slots as well.
 *
 * Labels: the module's own catalog namespace (`<key>.nav`) wins over the manifest label (PWA-03).
 */
export function buildNav(modules: ReadonlyArray<NavModule>, labels: NavLabels): ShellNav {
  const entries = modules.filter(hasNav).sort(byOrderThenKey);
  const candidates = entries.filter((m) => (m.nav.placement ?? 'tab') === 'tab');
  const steadyTabKeys = new Set<string>(
    candidates.filter((m) => !declaresYield(m)).map((m) => m.key),
  );
  const yields = (m: NavEntry) => m.nav.yieldsTabTo?.some((key) => steadyTabKeys.has(key)) ?? false;
  const tabs = candidates.filter((m) => !yields(m));
  const topbar = [
    ...entries.filter((m) => m.nav.placement === 'topbar'),
    ...candidates.filter(yields),
  ].sort(bySlotOrderThenKey);
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

/** What the host may rewrite on one tab (`withTabOverrides`); every field is optional. */
export interface TabOverride {
  href?: string;
  label?: string;
  matches?: ReadonlyArray<string>;
}

/**
 * The nav with the named tabs rewritten by the host: `overrides` maps a tab key to the `href`,
 * `label` and `matches` to apply to THAT tab. A key with no tab in the row (a slot key included) is
 * ignored, an empty `href` or `label` is ignored field by field, only the map's own keys are read,
 * the slots and areas never change, and the input nav is never mutated. The manifest's nav entry is
 * identical for every role, so a role-aware href or name is the host's call, made per request (as
 * with `withTabDots`); the tab keeps its key, order and neighbours.
 */
export function withTabOverrides(
  nav: ShellNav,
  overrides: Readonly<Record<string, TabOverride>>,
): ShellNav {
  return {
    ...nav,
    tabs: nav.tabs.map((tab) => {
      const override = Object.hasOwn(overrides, tab.key) ? overrides[tab.key] : undefined;
      if (!override) return tab;
      return {
        ...tab,
        ...(override.href ? { href: override.href } : {}),
        ...(override.label ? { label: override.label } : {}),
        ...(override.matches && override.matches.length > 0
          ? { matches: [...override.matches] }
          : {}),
      };
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
 * The tab to mark `aria-current="page"`: the longest matching path, across each tab's `href` and its
 * `matches`; ties go to the FIRST tab in order, so a module anchor on `/inicio` (`/inicio#exemplo`)
 * never steals Início's active state. A tab without `matches` is tested by its `href` alone. `null`
 * when no tab matches (e.g. `/configuracoes`).
 */
export function activeTabKey(tabs: ReadonlyArray<NavItem>, pathname: string): string | null {
  let best: { key: string; length: number } | null = null;
  for (const tab of tabs) {
    for (const candidate of [tab.href, ...(tab.matches ?? [])]) {
      if (!isNavItemActive(pathname, candidate)) continue;
      const length = pathOf(candidate).length;
      if (!best || length > best.length) best = { key: tab.key, length };
    }
  }
  return best?.key ?? null;
}

/** The areas the host declares (2026-10-06), kept only for tabs the shell actually has. */
export function withAreas(nav: ShellNav, areas: ReadonlyArray<NavArea>): ShellNav {
  const keys = new Set(nav.tabs.map((tab) => tab.key));
  const kept = areas.filter((area) => keys.has(area.key) && area.screens.length > 0);
  return kept.length > 0 ? { ...nav, areas: kept } : nav;
}

/** The area the member is inside: the one of the ACTIVE tab, or null. */
export function activeArea(
  tabs: ReadonlyArray<NavItem>,
  areas: ReadonlyArray<NavArea> | undefined,
  pathname: string,
): NavArea | null {
  if (!areas || areas.length === 0) return null;
  const key = activeTabKey(tabs, pathname);
  return areas.find((area) => area.key === key) ?? null;
}

/**
 * UI-D-81: the chrome the ACTIVE item declares (`'media'`), or `null` for the normal chrome. The one
 * rule TopBar and BottomNav share: the kernel reads the declaration from the nav entry and never
 * tests a module's pathname, so any future media entry gets the chrome by declaring it (MOD-02).
 *
 * It reads whatever items it is given (same longest-match rule as `activeTabKey`). The shell passes
 * `[...tabs, ...topbar]` (UI-D-423): a media entry that yielded its tab to another module (Reels
 * while Cursos is a tab) keeps the dark chrome when reached from its TopBar slot. The `aria-current`
 * tab is still `activeTabKey(tabs, …)` alone, so no tab is current there.
 */
export function activeTabChrome(items: ReadonlyArray<NavItem>, pathname: string): 'media' | null {
  const key = activeTabKey(items, pathname);
  return items.find((item) => item.key === key)?.chrome ?? null;
}

/**
 * Serialisable icon names (the manifest travels through the bootstrap) → lucide components. The
 * notifications glyph is `Bell` (D-40); the prototype's heart names Notificações only inside an area's menu (2026-10-06, as the REINE prototype draws it).
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
  // 2026-10-06: the events area's screens (Fotos, Check-in, Meus) and its menu (REINE's heart for
  // Notificações, the menu glyph).
  camera: Camera,
  'qr-code': QrCode,
  ticket: Ticket,
  heart: Heart,
  menu: Menu,
  // 08.2-07 (UI-D-366): the store's TopBar slot and rail row, and the Configurações "Loja" row.
  'shopping-bag': ShoppingBag,
  // 08.3-03 (UI-D-389): the Configurações "Cursos" row.
  'graduation-cap': GraduationCap,
  // 09.1-13 (UI-D-513): the Configurações "Pagamentos" row.
  'credit-card': CreditCard,
};

export function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? LayoutGrid;
}
