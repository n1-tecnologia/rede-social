import type { CSSProperties, ReactNode } from 'react';
import type { ShellNav } from './nav';

export interface AppShellProps {
  brand: { displayName: string; logoUrl: string | null };
  nav: ShellNav;
  counters: { unreadNotifications: number; unreadConversations: number };
  avatar: { src: string | null; alt: string };
  labels: { mainNav: string; profile: string; settings: string; logout: string; theme: string };
  settingsHref: string;
  logoutAction: () => Promise<void>;
  themeToggle?: ReactNode;
  style?: CSSProperties;
  children: ReactNode;
}

export function AppShell(_props: AppShellProps): ReactNode {
  throw new Error('not implemented');
}
