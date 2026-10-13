'use client';

import { Tabs } from '@rede-social/ui';
import { useRouter } from 'next/navigation';

export interface HubTabItem {
  key: string;
  label: string;
  href: string;
}

export interface HubTabsProps {
  /** The tablist's accessible name ("Áreas de Cursos"). */
  label: string;
  /** Already translated by the server page from `COURSE_HUB_TABS`. */
  items: readonly HubTabItem[];
  /** The active key, decided on the server from `?aba=`. */
  value: string;
  className?: string;
}

/**
 * The hub's area sub-nav (UI-D-390): the shipped underline `Tabs` with `href` items, so each tab is
 * a LINK (back works, a shared URL lands on the same tab) while ArrowLeft/ArrowRight/Home/End move
 * through the roving tabindex and navigate. The server page cannot hand a function to the `Tabs`
 * primitive, so this thin client wrapper owns the `onChange` → `router.push` of the item's href.
 * Every word arrives translated from the server.
 */
export function HubTabs({ label, items, value, className }: HubTabsProps) {
  const router = useRouter();
  return (
    <Tabs
      className={className}
      label={label}
      items={items.map((item) => ({ key: item.key, label: item.label, href: item.href }))}
      value={value}
      onChange={(key) => {
        const target = items.find((item) => item.key === key);
        if (target) router.push(target.href);
      }}
    />
  );
}
