import type { Bootstrap } from '@tria/contracts';
import type { LucideIcon } from 'lucide-react';

/** The `bootstrap.counters` key a TopBar/rail slot reads for its count badge (D-40). */
export type NavBadge = 'unreadNotifications' | 'unreadConversations';

/** One rendered navigation entry (a tab or a TopBar/rail slot). `icon` is a name, resolved by `iconFor`. */
export interface NavItem {
  key: string;
  href: string;
  icon: string;
  label: string;
  badge?: NavBadge;
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

export function buildNav(_modules: ReadonlyArray<NavModule>, _labels: NavLabels): ShellNav {
  throw new Error('not implemented');
}

export function isNavItemActive(_pathname: string, _href: string): boolean {
  throw new Error('not implemented');
}

export function activeTabKey(_tabs: ReadonlyArray<NavItem>, _pathname: string): string | null {
  throw new Error('not implemented');
}

export function iconFor(_name: string): LucideIcon {
  throw new Error('not implemented');
}
