'use client';

import { Avatar, Badge, cn } from '@rede-social/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { activeTabChrome, iconFor, isNavItemActive, type NavItem } from './nav';
import { useLiveCounters } from './realtime/LiveCountersProvider';
import { slotAccessibleName, slotBadgeStyle, useSlotBadgeLabel } from './realtime/SlotBadgeLabels';
import { TenantLogo } from './TenantLogo';

export interface TopBarProps {
  brand: { displayName: string; logoUrl: string | null };
  /** Registry `topbar` slots (bell, support chat …) in order; empty this phase. */
  slots: ReadonlyArray<NavItem>;
  /**
   * The server-rendered counters. Inside a `LiveCountersProvider` (the tenant shell) the live value
   * wins; without one (the platform shell, tests) this static prop is what the slots show.
   */
  counters: {
    unreadNotifications: number;
    unreadConversations: number;
    /** 07-09: the chat slot draws a member's `dot` or the staff `count` (default). */
    conversationsBadge?: 'dot' | 'count';
  };
  avatar: { src: string | null; alt: string };
  /** Accessible name of the avatar link (`/perfil`). */
  profileLabel: string;
  profileHref?: string;
  /**
   * The shell's tab row (`nav.tabs`). When given, the bar is not rendered while the active tab
   * declares `chrome: 'media'` (UI-D-81).
   */
  tabs?: ReadonlyArray<NavItem>;
}

const slotLinkClasses =
  'relative inline-flex h-11 w-11 items-center justify-center rounded-full text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * Mobile TopBar ported from the prototype (UI-SPEC §Shell Contract): fixed under the safe area,
 * tenant identity on the left, registry slots + the avatar link on the right. The identity is the
 * logo as-is and ALONE (D-26, product decision 2026-10-02: the name is no longer drawn beside it);
 * the display name shows only without a logo, or when the logo fails to load (`TenantLogo`). Either
 * way the home link's accessible name is the display name exactly once (the img's alt, or the text).
 * The right side's geometry is fixed (gap-3, slots then avatar) so the bar never reflows when later
 * modules declare slots; the brand is the only flexible element (the logo box caps at 120px, the
 * name truncates). The home link never narrows under 44px (`min-w-11`, the slots' tap target): a
 * square logo alone is only 28px wide. Hidden on desktop (`md:hidden`) — the rail carries the same
 * information there.
 *
 * `data-shell-topbar` is what tokens.css hides while a full-screen surface declares
 * `data-shell-hide="chrome"` (the story viewer); `data-shell-brand` marks the home link for tests.
 *
 * Media chrome (UI-D-81): while the active tab's nav entry declares `chrome: 'media'` the bar is not
 * rendered at all, so the video surface owns the top of the screen. The rule is declarative — it reads
 * the active tab's declaration through `activeTabChrome` — because a pathname check in `@rede-social/core/ui`
 * would couple the kernel to a module (MOD-02). The desktop rail keeps the tenant identity there.
 */
export function TopBar({
  brand,
  slots,
  counters,
  avatar,
  profileLabel,
  profileHref = '/perfil',
  tabs,
}: TopBarProps) {
  const pathname = usePathname() ?? '';
  const onProfile = isNavItemActive(pathname, profileHref);
  const live = useLiveCounters();
  const labelFor = useSlotBadgeLabel();
  const shown = live ?? counters;

  if (tabs && activeTabChrome(tabs, pathname) === 'media') return null;

  return (
    <header
      data-shell-topbar
      className="fixed inset-x-0 top-0 z-50 border-b border-border bg-bg-secondary pt-[var(--safe-top)] md:hidden"
    >
      <div className="flex h-12 items-center justify-between px-4">
        <Link href="/inicio" data-shell-brand className="flex h-11 min-w-11 items-center">
          <TenantLogo logoUrl={brand.logoUrl} displayName={brand.displayName} size="topbar" />
        </Link>

        <div className="flex shrink-0 items-center gap-3">
          {slots.map((slot) => {
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
                className={cn(slotLinkClasses, active && 'text-brand')}
              >
                <Icon aria-hidden size={24} strokeWidth={active ? 2 : 1.5} />
                {count > 0 ? (
                  <span aria-hidden className="absolute top-0.5 right-0.5">
                    <Badge count={count} variant={style} />
                  </span>
                ) : null}
              </Link>
            );
          })}

          <Link
            href={profileHref}
            aria-label={profileLabel}
            aria-current={onProfile ? 'page' : undefined}
            className={cn(
              'inline-flex rounded-full border-2 transition-colors active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              onProfile ? 'border-brand' : 'border-transparent',
            )}
          >
            <Avatar size="sm" src={avatar.src} alt={avatar.alt} />
          </Link>
        </div>
      </div>
    </header>
  );
}
