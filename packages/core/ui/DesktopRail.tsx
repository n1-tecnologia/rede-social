'use client';

import { Badge, cn } from '@tria/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { activeTabKey, iconFor, isNavItemActive, type NavItem, type ShellNav } from './nav';
import { TenantLogo } from './TenantLogo';

export interface DesktopRailProps {
  brand: { displayName: string; logoUrl: string | null };
  nav: ShellNav;
  counters: { unreadNotifications: number; unreadConversations: number };
  labels: { mainNav: string; settings: string; logout: string; theme: string };
  settingsHref: string;
  logoutAction: () => Promise<void>;
  /** The "Tema" row's control (a `ThemeToggle`); the row is omitted when absent. */
  themeToggle?: ReactNode;
}

const rowBase =
  'flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
const rowIdle = 'text-text-secondary hover:bg-bg-hover';
const rowActive = 'bg-[var(--theme-chip)] font-bold text-brand';

function RailLink({ item, active, count }: { item: NavItem; active: boolean; count?: number }) {
  const Icon = iconFor(item.icon);
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(rowBase, active ? rowActive : rowIdle)}
    >
      <Icon aria-hidden size={22} strokeWidth={active ? 2.3 : 1.7} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {count !== undefined && count > 0 ? <Badge count={count} /> : null}
    </Link>
  );
}

/**
 * Desktop left rail (D-39, UI-SPEC §Shell Contract, mockup #desktop-shell-home): 240px, sticky for the
 * whole screen height, tenant logo on top (display name below it when the logo is missing, D-26),
 * the registry tabs as icon + label rows, and a bottom group pinned with `mt-auto`: the registry
 * `topbar` slots as rows, Configurações, Tema, Sair. On short viewports the nav region scrolls
 * (`min-h-0 flex-1 overflow-y-auto`) while the bottom group stays pinned. Hidden below `md`.
 */
export function DesktopRail({
  brand,
  nav,
  counters,
  labels,
  settingsHref,
  logoutAction,
  themeToggle,
}: DesktopRailProps) {
  const pathname = usePathname() ?? '';
  const active = activeTabKey(nav.tabs, pathname);
  const SettingsIcon = iconFor('settings');
  const ThemeIcon = iconFor('sun');
  const LogoutIcon = iconFor('log-out');

  return (
    <aside className="sticky top-0 hidden h-[var(--screen-h)] w-60 shrink-0 flex-col border-r border-border bg-bg-secondary px-3 py-6 md:flex">
      <Link href="/inicio" className="flex flex-col gap-2 px-1">
        {brand.logoUrl ? (
          <TenantLogo logoUrl={brand.logoUrl} displayName={brand.displayName} size="rail" />
        ) : (
          <span className="line-clamp-2 text-base font-bold tracking-tight text-text">
            {brand.displayName}
          </span>
        )}
      </Link>

      <nav
        aria-label={labels.mainNav}
        data-shell-nav="rail"
        className="mt-8 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
      >
        {nav.tabs.map((tab) => (
          <RailLink key={tab.key} item={tab} active={tab.key === active} />
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-1 border-t border-divider pt-3">
        {nav.topbar.map((slot) => (
          <RailLink
            key={slot.key}
            item={slot}
            active={isNavItemActive(pathname, slot.href)}
            count={slot.badge ? counters[slot.badge] : undefined}
          />
        ))}

        <Link
          href={settingsHref}
          aria-current={isNavItemActive(pathname, settingsHref) ? 'page' : undefined}
          className={cn(rowBase, isNavItemActive(pathname, settingsHref) ? rowActive : rowIdle)}
        >
          <SettingsIcon aria-hidden size={22} strokeWidth={1.7} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{labels.settings}</span>
        </Link>

        {themeToggle ? (
          <div className={cn(rowBase, 'text-text-secondary')}>
            <ThemeIcon aria-hidden size={22} strokeWidth={1.7} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{labels.theme}</span>
            {themeToggle}
          </div>
        ) : null}

        <form action={logoutAction}>
          <button type="submit" className={cn(rowBase, rowIdle, 'hover:text-danger')}>
            <LogoutIcon aria-hidden size={22} strokeWidth={1.7} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">{labels.logout}</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
