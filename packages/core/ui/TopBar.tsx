'use client';

import { Avatar, Badge, cn } from '@tria/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { iconFor, isNavItemActive, type NavItem } from './nav';
import { TenantLogo } from './TenantLogo';

export interface TopBarProps {
  brand: { displayName: string; logoUrl: string | null };
  /** Registry `topbar` slots (bell, support chat …) in order; empty this phase. */
  slots: ReadonlyArray<NavItem>;
  counters: { unreadNotifications: number; unreadConversations: number };
  avatar: { src: string | null; alt: string };
  /** Accessible name of the avatar link (`/perfil`). */
  profileLabel: string;
  profileHref?: string;
}

const slotLinkClasses =
  'relative inline-flex h-11 w-11 items-center justify-center rounded-full text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * Mobile TopBar ported from the prototype (UI-SPEC §Shell Contract): fixed under the safe area,
 * tenant identity on the left (logo as-is + display name, D-26), registry slots + the avatar link on
 * the right. The right side's geometry is fixed (gap-3, slots then avatar) so the bar never reflows
 * when later modules declare slots; the display name is the only flexible element and truncates.
 * Hidden on desktop (`md:hidden`) — the rail carries the same information there.
 */
export function TopBar({
  brand,
  slots,
  counters,
  avatar,
  profileLabel,
  profileHref = '/perfil',
}: TopBarProps) {
  const pathname = usePathname() ?? '';
  const onProfile = isNavItemActive(pathname, profileHref);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-bg-secondary pt-[var(--safe-top)] md:hidden">
      <div className="flex h-12 items-center justify-between px-4">
        <Link href="/inicio" className="flex min-w-0 items-center gap-2">
          <TenantLogo logoUrl={brand.logoUrl} displayName={brand.displayName} size="topbar" />
          {brand.logoUrl ? (
            <span className="hidden truncate text-base font-bold tracking-tight text-text min-[360px]:inline">
              {brand.displayName}
            </span>
          ) : null}
        </Link>

        <div className="flex shrink-0 items-center gap-3">
          {slots.map((slot) => {
            const Icon = iconFor(slot.icon);
            const active = isNavItemActive(pathname, slot.href);
            const count = slot.badge ? counters[slot.badge] : 0;
            return (
              <Link
                key={slot.key}
                href={slot.href}
                aria-label={slot.label}
                aria-current={active ? 'page' : undefined}
                className={cn(slotLinkClasses, active && 'text-brand')}
              >
                <Icon aria-hidden size={24} strokeWidth={active ? 2 : 1.5} />
                {count > 0 ? (
                  <span className="absolute top-0.5 right-0.5">
                    <Badge count={count} />
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
