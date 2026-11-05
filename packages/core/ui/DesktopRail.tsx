'use client';

import { Badge, cn } from '@rede-social/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, useId } from 'react';
import { useBeforeLogout, useLogoutSubmit } from './BeforeLogout';
import { HidingLogoImage } from './HidingLogoImage';
import {
  activeArea,
  activeTabKey,
  iconFor,
  isAreaScreenCurrent,
  isNavItemActive,
  type NavArea,
  type NavItem,
  type ShellNav,
} from './nav';
import { useLiveCounters } from './realtime/LiveCountersProvider';
import { slotAccessibleName, slotBadgeStyle, useSlotBadgeLabel } from './realtime/SlotBadgeLabels';
import { TenantLogo } from './TenantLogo';
import { reselectTab } from './tab-reselect';

export interface DesktopRailProps {
  /**
   * The tenant's identity: the logo (or the name without one) beside the mark once the rail opens,
   * and since 2026-10-26 `markUrl`, the page's favicon, the collapsed rail's mark (the name's initial
   * without one).
   */
  brand: { displayName: string; logoUrl: string | null; markUrl?: string | null };
  nav: ShellNav;
  counters: {
    unreadNotifications: number;
    unreadConversations: number;
    /** 07-09: the chat slot draws a member's `dot` or the staff `count` (default). */
    conversationsBadge?: 'dot' | 'count';
  };
  labels: {
    mainNav: string;
    /**
     * 2026-10-23: the navigation's title ("Principal"). Not drawn since 2026-10-26: Instagram's rail
     * has no section title, and the navigation keeps its `aria-label`.
     */
    sections?: { main: string };
    /** 2026-10-23: the kernel home tab's name on the desktop ("Feed"); the phone keeps its own. */
    homeTab?: string;
    /** 2026-10-26: the foot's sign-out row ("Sair"); drawn only with `logoutAction`. */
    logout?: string;
  };
  /** 2026-10-26: the shell's sign-out action; with it (and `labels.logout`) the rail ends in "Sair". */
  logoutAction?: () => Promise<void>;
}

/**
 * 2026-10-26 — Instagram's rows (the product owner: "a menu bar lateral quero que seja igual ao
 * instagram desktop"): 48px, a 24px glyph and then the name at 15px, the glyph's stroke heavier and
 * the name in bold on the page that is open, over the same quiet ground the hover gives. The glyph
 * sits where the collapsed rail centres it (12px of the panel's side, 12px of the row's), so it never
 * moves when the rail opens.
 */
const rowBase =
  'flex h-12 w-full items-center gap-4 rounded-lg px-3 text-[15px] text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset';
const rowIdle = 'hover:bg-bg-hover';
const rowActive = 'bg-bg-hover';

/**
 * The name beside the glyph: in the row at all times (its text is what assistive tech and the area
 * menus' readers read), shown only while the rail is open (`data-shell-rail-label`, tokens.css).
 */
function RailLabel({ children, strong = false }: { children: string; strong?: boolean }) {
  return (
    <span
      data-shell-rail-label=""
      className={cn(
        'min-w-0 flex-1 truncate whitespace-nowrap text-left',
        strong ? 'font-bold' : 'font-normal',
      )}
    >
      {children}
    </span>
  );
}

function RailLink({
  item,
  active,
  count,
  style = 'count',
}: {
  item: NavItem;
  active: boolean;
  count?: number;
  style?: 'dot' | 'count';
}) {
  const Icon = iconFor(item.icon);
  const labelFor = useSlotBadgeLabel();
  const dotId = useId();
  const pathname = usePathname() ?? '';
  // A tab the host marked (`NavItem.dot`) shows the same dot a member's chat slot does; its name
  // stays its own and the dot's description is read after it.
  const shownCount = item.dot ? 1 : count;
  const shownStyle = item.dot ? 'dot' : style;
  return (
    <Link
      href={item.href}
      data-slot={item.key}
      aria-label={slotAccessibleName(item.label, item.badge, count ?? 0, labelFor, style)}
      aria-describedby={item.dot ? dotId : undefined}
      aria-current={active ? 'page' : undefined}
      // Re-tapping the row of the page already open takes it back to the top (`reselectTab`).
      onClick={(event) => reselectTab(event, pathname, item.href)}
      className={cn(rowBase, active ? rowActive : rowIdle)}
    >
      {/* The count or the dot sits on the glyph's corner, Instagram's. Decoration: the row's
          label names it, the count included. */}
      <span aria-hidden className="relative inline-flex shrink-0">
        <Icon aria-hidden size={24} strokeWidth={active ? 2.4 : 1.8} />
        {shownCount !== undefined && shownCount > 0 ? (
          <span aria-hidden className="absolute -top-1.5 -right-2 inline-flex">
            <Badge
              count={shownCount}
              variant={shownStyle}
              // The dot's ring separates it from the glyph on the rail's own ground.
              className={shownStyle === 'dot' ? 'ring-bg' : undefined}
            />
          </span>
        ) : null}
      </span>
      <RailLabel strong={active}>{item.label}</RailLabel>
      {item.dot ? (
        <span id={dotId} className="sr-only">
          {item.dot.description}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * Inside an area, its screens under the row that owns it (the phone's sandwich menu): a tab's, or
 * since 2026-10-24 a Principal slot's (the Loja). A list on a guide line, named by the area's menu
 * label, each screen matched by PATH (`isAreaScreenCurrent`). 2026-10-26 ("os submenus devem ser
 * como antes"): once the rail opens it is the indented list it always was, the line 22px in and each
 * name beside its glyph; collapsed, the line runs at the rail's edge and the glyphs stand centred
 * under the rows' (the indent is the rail's CSS, tokens.css, so it glides with the panel).
 */
function RailAreaScreens({ area, pathname }: { area: NavArea; pathname: string }) {
  return (
    <ul
      data-rail-area={area.key}
      aria-label={area.menuLabel}
      className="my-0.5 flex flex-col gap-0.5 border-l border-border"
    >
      {area.screens.map((screen) => {
        const Icon = iconFor(screen.icon);
        const here = isAreaScreenCurrent(pathname, screen);
        return (
          <li key={screen.key}>
            <Link
              href={screen.href}
              aria-label={screen.label}
              aria-current={here ? 'page' : undefined}
              className={cn(rowBase, 'h-10 gap-3 px-[11px] text-sm', here ? rowActive : rowIdle)}
            >
              <Icon aria-hidden size={20} strokeWidth={here ? 2.4 : 1.8} className="shrink-0" />
              <RailLabel strong={here}>{screen.label}</RailLabel>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The brand's initial on its colour, where the collapsed rail has no favicon to show (or it failed).
 * The letter is drawn by CSS (`attr(data-initial)`): the brand link holds no text of its own beside
 * the logo, so it is named once, by its label (PDF #1).
 */
function BrandInitial({ initial }: { initial: string }) {
  return (
    <span
      aria-hidden
      data-shell-brand-mark
      data-initial={initial}
      className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-lg font-bold text-on-brand before:content-[attr(data-initial)]"
    />
  );
}

/**
 * Desktop left rail (D-39, UI-SPEC §Shell Contract): sticky for the whole screen height, hidden
 * below `md`.
 *
 * **2026-10-23 — rebuilt from scratch as a grouped sidebar** (the product owner: the items sat
 * scattered, a navigation block on top and a block of utilities pinned to the bottom with an empty
 * gap between). Top to bottom:
 *
 *  - the tenant identity in its own band (`data-shell-brand`, the home link);
 *  - the navigation: the registry tabs (`data-shell-nav="rail"`), the kernel Perfil left out (it is
 *    the account menu's first row); inside an area, the area's screens under its tab, named by the
 *    area's menu label and matched by PATH (`isAreaScreenCurrent`: the path, or one of the screen's
 *    exact `matches`), so a manager's preview links still mark the page; a tab the host marked
 *    (`NavItem.dot`) carries the red dot, its name its own and the dot's description read after it;
 *    then the slots the host moved up (`NavItem.railMain`, the Loja). 2026-10-24: inside a slot's
 *    own area (the Loja's, on the pages no tab claims) its screens sit under the slot's row the same
 *    way, and the row, like a tab's, gives its highlight up to the screen that IS the page.
 *
 * **2026-10-26 — the foot moved to the `DesktopHeader`** (the Atalhos and the account), and **"Sair"**
 * came back to the foot (the product owner: "quero um botão de sair no navbar lateral do desktop"):
 * the same sign-out form as the header's account menu (the host's pre-logout cleanup first,
 * `useBeforeLogout`), drawn only when the shell passes its `logoutAction` and the word.
 *
 * **2026-10-26 — Instagram's rail, collapsed, opening on hover** (the product owner: "a menu bar
 * lateral quero que seja igual ao instagram desktop, ela não deve ter bg", "quero o mesmo efeito de
 * recolhido", then "ainda não está abrindo com o hover do mouse"): the shell gives it a 72px column
 * of glyphs with no ground of its own (the page's, the member skin's glows included, shows through),
 * no dividing line ("remova essa linha de divisão") and no section title. The rows live in a panel (`data-shell-rail-panel`) that opens over the page
 * to 240px, the names beside the glyphs, while the pointer is on the rail or the keyboard's focus is
 * inside it, on a frosted ground that keeps the names legible over the page (tokens.css). The brand
 * is the page's favicon (its initial without one) while collapsed, and only the whole logo (or the
 * name) once open. One rung
 * over the chrome (`z-[51]`): the open panel passes over the page and over the desktop header (50),
 * and the full-screen surfaces (52) and the sheets and dialogs (55) still cover it.
 */
export function DesktopRail({ brand, nav, counters, labels, logoutAction }: DesktopRailProps) {
  const pathname = usePathname() ?? '';
  const onLogoutSubmit = useLogoutSubmit(useBeforeLogout());
  const LogoutIcon = iconFor('log-out');
  const active = activeTabKey(nav.tabs, pathname);
  // 2026-10-24: a slot's area (the Loja's) on the pages no tab claims; a tab's always wins.
  const area = activeArea(nav.tabs, nav.areas, pathname, nav.topbar);
  // Inside an area, the screen row that IS this page carries the highlight instead of the row that
  // owns the area (its tab, or since 2026-10-24 its slot).
  const screenHere = area?.screens.some((screen) => isAreaScreenCurrent(pathname, screen)) ?? false;
  // Live counters inside the tenant shell's provider; the static prop otherwise (platform, tests).
  const shown = useLiveCounters() ?? counters;
  // The kernel Perfil is the account menu's row (the desktop header); the navigation keeps every
  // other tab.
  const tabs = nav.tabs
    .filter((tab) => tab.key !== 'profile')
    // The desktop names the kernel home tab after what it holds ("Feed"); the phone keeps "Início".
    .map((tab) => (tab.key === 'home' && labels.homeTab ? { ...tab, label: labels.homeTab } : tab));
  // 2026-10-23: the slots the host moved up (`railMain`, the Loja) close the navigation; the others
  // are the desktop header's shortcuts (2026-10-26).
  const mainSlots = nav.topbar.filter((slot) => slot.railMain);
  // The brand's mark under its app icon (or alone without one): the tenant's first letter.
  const initial = Array.from(brand.displayName.trim())[0]?.toLocaleUpperCase('pt-BR') ?? '';

  return (
    <aside
      data-shell-rail=""
      className="sticky top-0 z-[51] hidden h-[var(--screen-h)] w-[72px] shrink-0 md:block"
    >
      <div
        data-shell-rail-panel=""
        className="absolute inset-y-0 left-0 flex w-[72px] flex-col overflow-hidden"
      >
        {/* The open panel's ground: the shell's frosted glass, the desktop header's (tokens.css),
            faded in under the names while the rail is open, never painted at rest. */}
        <div
          aria-hidden
          data-shell-rail-ground=""
          className="shell-glass pointer-events-none absolute inset-0 -z-10"
        />
        <div className="flex h-16 shrink-0 items-center px-4">
          <Link
            href="/inicio"
            data-shell-brand
            aria-label={brand.displayName}
            className="relative flex h-10 min-w-10 items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {/* Collapsed: the page's favicon (the product owner: "o que deve aparecer quando o menu
                estiver recolhido é a mesma imagem do favicon"). Open: it gives its place to the whole
                logo ("quando a navbar lateral abrir o ícone deve sumir e ficar somente a logo
                inteira"), the two crossfading in the same spot (`data-shell-rail-mark`, tokens.css). */}
            <span
              aria-hidden
              data-shell-rail-mark=""
              className="absolute top-0 left-0 flex h-10 w-10"
            >
              {brand.markUrl ? (
                // A favicon that fails to load gives its place to the initial.
                <HidingLogoImage
                  src={brand.markUrl}
                  alt=""
                  boxClassName="h-10 w-10"
                  imgClassName="h-10 w-10 rounded-xl object-contain"
                  fallback={<BrandInitial initial={initial} />}
                />
              ) : (
                <BrandInitial initial={initial} />
              )}
            </span>
            <span data-shell-rail-label="" className="flex min-w-0">
              {brand.logoUrl ? (
                <TenantLogo
                  logoUrl={brand.logoUrl}
                  displayName={brand.displayName}
                  size="rail"
                  className="px-0"
                />
              ) : (
                <span className="truncate whitespace-nowrap text-base font-bold tracking-tight text-text">
                  {brand.displayName}
                </span>
              )}
            </span>
          </Link>
        </div>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-4">
          <nav aria-label={labels.mainNav} data-shell-nav="rail" className="flex flex-col">
            <div className="flex flex-col gap-1">
              {tabs.map((tab) => (
                <Fragment key={tab.key}>
                  <RailLink
                    item={tab}
                    active={tab.key === active && !(area?.key === tab.key && screenHere)}
                  />
                  {/* Inside an area, its screens under its tab (the phone's sandwich menu). */}
                  {area?.key === tab.key ? (
                    <RailAreaScreens area={area} pathname={pathname} />
                  ) : null}
                </Fragment>
              ))}
              {mainSlots.map((slot) => (
                <Fragment key={slot.key}>
                  <RailLink
                    item={slot}
                    // `owner`: the slot owns the area the member is inside (the Loja), so, like a
                    // tab's, its row gives the highlight up to the screen row that IS this page.
                    active={
                      isNavItemActive(pathname, slot.href) &&
                      !(area?.key === slot.key && screenHere)
                    }
                    count={slot.badge ? shown[slot.badge] : undefined}
                    style={slotBadgeStyle(slot.badge, shown.conversationsBadge)}
                  />
                  {/* 2026-10-24: inside a slot's own area (the Loja), its screens under its row. */}
                  {area?.key === slot.key ? (
                    <RailAreaScreens area={area} pathname={pathname} />
                  ) : null}
                </Fragment>
              ))}
            </div>
          </nav>
        </div>

        {logoutAction && labels.logout ? (
          <div className="shrink-0 px-3 pt-2 pb-4">
            <form action={logoutAction} onSubmit={onLogoutSubmit}>
              <button
                type="submit"
                data-shell-logout
                aria-label={labels.logout}
                className={cn(rowBase, rowIdle, 'hover:text-danger')}
              >
                <LogoutIcon aria-hidden size={24} strokeWidth={1.8} className="shrink-0" />
                <RailLabel>{labels.logout}</RailLabel>
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
