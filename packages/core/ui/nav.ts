import type { Bootstrap } from '@rede-social/contracts';
import {
  Bell,
  Building2,
  CalendarDays,
  Camera,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ClipboardList,
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
  PackageCheck,
  Palette,
  QrCode,
  Radio,
  Route,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Sun,
  Tag,
  Ticket,
  TrendingUp,
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
  /**
   * 2026-10-23: drawn in the desktop rail only; the phone's BottomNav leaves it out. `buildNav` sets
   * it on the kernel Perfil when the row is full (a tab that declares `yieldsTabTo` meets its
   * target): on a phone the TopBar's avatar (or the area menu's "Meu perfil") is already Perfil's
   * door, so the bar keeps every module tab instead. The desktop has no TopBar and keeps the row.
   */
  railOnly?: true;
  /**
   * 2026-10-23: a slot (`ShellNav.topbar`) the desktop rail lists under Principal, after the tabs,
   * instead of among the shortcuts (the Loja, at the product owner's request): the Atalhos at the
   * rail's foot until 2026-10-26, the desktop header's icon links since. The phone's TopBar is
   * unchanged. Never from the bootstrap: the host decides it (`withRailMainSlots`).
   */
  railMain?: true;
  /**
   * 2026-10-28: a slot (`ShellNav.topbar`) the phone's BottomNav draws as one more tab, after the
   * module tabs (the Loja, at the product owner's request: "no mobile o ícone de loja deve estar na
   * menubar inferior"). The phone's TopBar, and the shortcuts of its area menus, leave it out so it
   * is drawn once; its own area ("· Loja") still names the bar on its pages. The desktop is unchanged.
   * Never from the bootstrap: the host decides it (`withPhoneTabSlots`).
   */
  phoneTab?: true;
}

/** What the shell renders: the tab row (BottomNav / rail nav) and the slot row (TopBar / desktop header). */
/**
 * A tab whose pages form an AREA with screens of their own (2026-10-06, the REINE prototype's
 * Eventos: Eventos, Fotos, Check-in, Meus). While the member is inside it, the phone's TopBar names
 * the area beside the logo ("· Eventos") and its right side collapses into one menu: the area's
 * screens first, then the bar's own shortcuts. The rail lists the screens under the tab. Never from
 * the bootstrap: the host declares it (`withAreas`) and words it.
 *
 * 2026-10-22 (the courses area): a tab may declare SEVERAL areas under its key, told apart by
 * `within`. A manager's courses tab is "Cursos" (the authoring screens) everywhere, and "Membros"
 * (the member's screens, every link in preview) under the member area's path, so "Ver como aluno"
 * shows the member's own menu. `activeArea` picks the variant.
 *
 * 2026-10-24 (the Loja area): a TopBar SLOT may own an area too, the store's "· Loja" (Produtos,
 * Comprados, the manager's Gerenciar). A tab always wins: a slot's area applies only on the pages
 * no tab claims (`activeArea`), so every page a tab claims behaves as before. The rail lists its
 * screens under the slot's row when the slot sits under Principal (`NavItem.railMain`); the area of
 * a slot left among the shortcuts (the desktop header's since 2026-10-26) shows on the phone only.
 */
export interface NavArea {
  /** The tab, or since 2026-10-24 the TopBar slot, whose pages ARE the area (`NavItem.key`). */
  key: string;
  /** "Eventos": the TopBar's label and the menu's section title. */
  label: string;
  /** The menu button's accessible name ("Menu de Eventos"). */
  menuLabel: string;
  /** The area's screens, in order. */
  screens: NavItem[];
  /**
   * 2026-10-22: the paths (and their sub-paths) under which THIS variant applies. Absent on an area
   * that is the tab's only one (Eventos) or its everywhere-else variant.
   */
  within?: ReadonlyArray<string>;
}

export interface ShellNav {
  tabs: NavItem[];
  topbar: NavItem[];
  /**
   * 2026-10-06: the areas, each keyed by the tab, or since 2026-10-24 the TopBar slot, whose pages
   * are the area (`withAreas`); absent, no area anywhere.
   */
  areas?: NavArea[];
  /**
   * 2026-11-05: where each item sits on the PHONE (the product owner: "personalizar hotbar do
   * usuário selecionando quais itens ele quer que entre ali, a ordem dos itens clicando segurando e
   * arrastando, escolhendo se vai ter algum desses itens no header", "somente no mobile"). Absent,
   * the shell's own placement. The desktop never reads it. 12.3-16: it arrives through the tenant's
   * brand in the bootstrap (`branding.phoneMenu`, the same for every member and role) and the host
   * applies it per request with `withPhoneLayout`; `phoneChrome` decides the placement.
   */
  phoneLayout?: PhoneLayout;
}

/**
 * The phone's chrome as the tenant's administrator arranged it (2026-11-05): the bottom bar's keys
 * in order, the TopBar's own keys in order (beside the fixed ones, `isFixedTopSlot`) and the keys
 * drawn nowhere on the phone. An item none of the three names keeps the shell's own place, so a
 * module turned on later still shows.
 */
export interface PhoneLayout {
  bar: ReadonlyArray<string>;
  top: ReadonlyArray<string>;
  hidden: ReadonlyArray<string>;
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
 * - topbar: module entries with `placement: 'topbar'`, carrying their `badge` key, sorted by
 *   `topbarOrder ?? order`, then key.
 *
 * A full row (D-401 / D-419 read anew on 2026-10-23, data-driven): a tab entry whose `yieldsTabTo`
 * names a key that is itself a tab here, and does not yield in turn, says the row is full (Reels
 * while the school's Cursos tab exists). Until 2026-10-23 that entry left the row for a TopBar slot;
 * now, at the product owner's request, it KEEPS its tab and the kernel Perfil turns `railOnly`: the
 * phone's BottomNav drops it (the TopBar's avatar, or the area menu's "Meu perfil", is its door
 * there) and the desktop rail, which has no TopBar, keeps it. The rule is one hop over the
 * bootstrap's own data, so two entries naming each other, or an entry naming a disabled or
 * slot-only module, leave the row as it is. The kernel never names a module: which entry fills the
 * row is the manifests' declaration (MOD-02).
 *
 * Labels: the module's own catalog namespace (`<key>.nav`) wins over the manifest label (PWA-03).
 */
export function buildNav(modules: ReadonlyArray<NavModule>, labels: NavLabels): ShellNav {
  const entries = modules.filter(hasNav).sort(byOrderThenKey);
  const tabs = entries.filter((m) => (m.nav.placement ?? 'tab') === 'tab');
  const steadyTabKeys = new Set<string>(tabs.filter((m) => !declaresYield(m)).map((m) => m.key));
  const full = tabs.some((m) => m.nav.yieldsTabTo?.some((key) => steadyTabKeys.has(key)) ?? false);
  const topbar = entries.filter((m) => m.nav.placement === 'topbar').sort(bySlotOrderThenKey);
  return {
    tabs: [
      { key: 'home', href: '/inicio', icon: 'home', label: labels.home },
      ...tabs.map((m) => toItem(m, labels)),
      {
        key: 'profile',
        href: '/perfil',
        icon: 'user',
        label: labels.profile,
        ...(full ? { railOnly: true as const } : {}),
      },
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

/**
 * The nav with the named SLOTS moved up into the desktop rail's main group (`NavItem.railMain`). A
 * key with no slot in the row (a tab key included) is ignored, and the tabs never change.
 */
export function withRailMainSlots(nav: ShellNav, keys: ReadonlyArray<string>): ShellNav {
  const named = new Set(keys);
  return {
    ...nav,
    topbar: nav.topbar.map((slot) =>
      named.has(slot.key) ? { ...slot, railMain: true as const } : slot,
    ),
  };
}

/**
 * The nav with the named SLOTS moved down into the phone's BottomNav (`NavItem.phoneTab`). A key
 * with no slot in the row (a tab key included) is ignored, and the tabs never change.
 */
export function withPhoneTabSlots(nav: ShellNav, keys: ReadonlyArray<string>): ShellNav {
  const named = new Set(keys);
  return {
    ...nav,
    topbar: nav.topbar.map((slot) =>
      named.has(slot.key) ? { ...slot, phoneTab: true as const } : slot,
    ),
  };
}

/** The nav with the phone arranged as the administrator chose (`ShellNav.phoneLayout`); `null` keeps it. */
export function withPhoneLayout(nav: ShellNav, layout: PhoneLayout | null): ShellNav {
  return layout ? { ...nav, phoneLayout: layout } : nav;
}

/**
 * A TopBar slot that always stays at the top of the phone (2026-11-05): one that carries a counter
 * (Notificações, the support chat), whose badge only the TopBar draws.
 */
export function isFixedTopSlot(slot: NavItem): boolean {
  return slot.badge !== undefined;
}

/**
 * What the phone's BottomNav draws by default, in order (2026-10-28): the tabs it keeps (a
 * `railOnly` tab is the rail's alone), then the `phoneTab` slots.
 */
export function phoneBarItems(
  tabs: ReadonlyArray<NavItem>,
  slots: ReadonlyArray<NavItem> = [],
): NavItem[] {
  return [...tabs.filter((tab) => !tab.railOnly), ...slots.filter((slot) => slot.phoneTab)];
}

/**
 * The phone's chrome (2026-11-05): what the BottomNav draws (`bar`) and what the TopBar draws on
 * its right side, before the avatar (`top`), both in order.
 *
 * Without a layout it is the shell's own: the bar of `phoneBarItems`, and every slot that is not a
 * `phoneTab` at the top, in the row's order. With one, any tab or slot may sit in the bar, at the top
 * or nowhere, in the layout's order; the counter slots (`isFixedTopSlot`) always stay at the top,
 * after the chosen ones; an item the layout does not name keeps its own place after the named ones.
 * A key with no item is ignored, and a layout that would leave the bar empty is not applied.
 */
export function phoneChrome(
  tabs: ReadonlyArray<NavItem>,
  slots: ReadonlyArray<NavItem>,
  layout?: PhoneLayout | null,
): { bar: NavItem[]; top: NavItem[] } {
  const defaultBar = phoneBarItems(tabs, slots);
  const defaultTop = slots.filter((slot) => !slot.phoneTab);
  if (!layout) return { bar: defaultBar, top: defaultTop };

  const items = new Map<string, NavItem>();
  for (const item of [...tabs, ...slots.filter((slot) => !isFixedTopSlot(slot))]) {
    if (!items.has(item.key)) items.set(item.key, item);
  }
  const placed = new Set([...layout.bar, ...layout.top, ...layout.hidden]);
  const taken = new Set<string>();
  const pick = (keys: ReadonlyArray<string>) =>
    keys.flatMap((key) => {
      const item = items.get(key);
      if (!item || taken.has(key)) return [];
      taken.add(key);
      return [item];
    });
  const bar = [
    ...pick(layout.bar),
    ...defaultBar.filter((item) => !placed.has(item.key) && !taken.has(item.key)),
  ];
  if (bar.length === 0) return { bar: defaultBar, top: defaultTop };
  const top = [
    ...pick(layout.top),
    ...defaultTop.filter(
      (slot) => isFixedTopSlot(slot) || (!placed.has(slot.key) && !taken.has(slot.key)),
    ),
  ];
  return { bar, top };
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

/**
 * True when `pathname` IS the area screen's page (2026-10-22). The path alone: a screen's href may
 * carry a query (a manager's preview links end in `?ver=aluno`), which a pathname never does. A
 * sub-path is not the screen: an event page under `/eventos` keeps the TAB current, not the
 * "Eventos" screen.
 */
export function isAreaScreenHere(pathname: string, href: string): boolean {
  return pathname === pathOf(href);
}

/**
 * 2026-10-23: the area screen the menu marks current. Its own page (`isAreaScreenHere`), or one of
 * its `matches` read as EXACT paths, never prefixes (on a tab, `matches` are prefixes): a screen that
 * gathers several pages, such as the courses area's "Gerenciar" over the management lists, is
 * current on each of them and on none of their detail pages.
 */
export function isAreaScreenCurrent(
  pathname: string,
  screen: Pick<NavItem, 'href' | 'matches'>,
): boolean {
  return isAreaScreenHere(pathname, screen.href) || (screen.matches?.includes(pathname) ?? false);
}

/**
 * The areas the host declares (2026-10-06), kept only for the tabs, and since 2026-10-24 the TopBar
 * slots (the Loja), the shell actually has; an area with no screens is dropped. Several areas may
 * share a key (2026-10-22, `NavArea.within`); each is kept on its own terms.
 */
export function withAreas(nav: ShellNav, areas: ReadonlyArray<NavArea>): ShellNav {
  const keys = new Set([...nav.tabs, ...nav.topbar].map((item) => item.key));
  const kept = areas.filter((area) => keys.has(area.key) && area.screens.length > 0);
  return kept.length > 0 ? { ...nav, areas: kept } : nav;
}

/**
 * The area the member is inside: the one of the ACTIVE tab, or null. When the tab has several
 * (2026-10-22), the variant whose `within` holds the path wins, else the one without `within`; a tab
 * whose only areas are scoped elsewhere has no area here.
 *
 * 2026-10-24 (the Loja area): given the shell's `slots` (`nav.topbar`), the area of the active SLOT
 * on the pages no tab claims, picked the same way. A tab always wins: once a tab is current its key
 * decides, even when that tab has no area, so a slot's area never takes over a tab's page. Without
 * `slots` the answer is the tabs' alone, as before.
 */
export function activeArea(
  tabs: ReadonlyArray<NavItem>,
  areas: ReadonlyArray<NavArea> | undefined,
  pathname: string,
  slots: ReadonlyArray<NavItem> = [],
): NavArea | null {
  if (!areas || areas.length === 0) return null;
  const key = activeTabKey(tabs, pathname) ?? activeTabKey(slots, pathname);
  if (key === null) return null;
  const variants = areas.filter((area) => area.key === key);
  return (
    variants.find((area) => area.within?.some((path) => isNavItemActive(pathname, path))) ??
    variants.find((area) => !area.within || area.within.length === 0) ??
    null
  );
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
  'chevrons-up-down': ChevronsUpDown,
  // 2026-10-26: the desktop header's account button (its menu drops down).
  'chevron-down': ChevronDown,
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
  // 2026-11-05: the Configurações "Menu do app" row (the phone's bar and top, on the phone only).
  smartphone: Smartphone,
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
  // 12-11 (UI-D-594): the platform Módulos row of the profile form module (danger `confirmDisable`).
  'clipboard-list': ClipboardList,
  // 2026-10-22: the courses area's screens (Trilhas, Lives, Progresso), the social-igoralves
  // prototype's glyphs.
  route: Route,
  radio: Radio,
  'trending-up': TrendingUp,
  // 2026-10-23: the courses area's "Gerenciar" (the manager's door to the management lists) and its
  // Categorias card.
  'sliders-horizontal': SlidersHorizontal,
  tag: Tag,
  // 2026-10-24: the store area's "Comprados" (its Produtos wears the shopping bag, its Gerenciar the
  // sliders).
  'package-check': PackageCheck,
};

export function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? LayoutGrid;
}
