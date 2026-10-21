'use client';

import { Tabs } from '@rede-social/ui';
import { useRouter } from 'next/navigation';

export interface PaymentsTabItem {
  key: string;
  label: string;
  href: string;
}

export interface PaymentsTabsProps {
  /** The tablist's accessible name ("Áreas de Pagamentos"). */
  label: string;
  /** Already translated by the server page from `PAYMENTS_TABS`. */
  items: readonly PaymentsTabItem[];
  /** The active key, decided on the server from `?aba=`. */
  value: string;
  className?: string;
}

/**
 * The Pagamentos area sub-nav (UI-D-513): the shipped underline `Tabs` with `href` items, so each tab
 * is a LINK (back works, a shared URL lands on the same tab). The server page cannot hand a function
 * to the `Tabs` primitive, so this three-line client wrapper owns the `onChange` → `router.push` of
 * the item's href. It is the `cursos/HubTabs.tsx` wrapper re-declared here (planning decision 2): no
 * route imports another route's component. Every word arrives translated from the server.
 */
export function PaymentsTabs({ label, items, value, className }: PaymentsTabsProps) {
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
