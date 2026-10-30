'use client';

import { Tabs } from '@rede-social/ui';
import { useRouter } from 'next/navigation';

export interface ProfileFormTabItem {
  key: string;
  label: string;
  href: string;
}

export interface ProfileFormTabsProps {
  /** The tablist's accessible name ("Áreas do Formulário de perfil"). */
  label: string;
  /** Already translated by the server page from `PROFILE_FORM_TABS`. */
  items: readonly ProfileFormTabItem[];
  /** The active key, decided on the server from `?aba=`. */
  value: string;
  className?: string;
}

/**
 * The Formulário de perfil sub-nav (UI-D-564): the shipped underline `Tabs` with `href` items, so each
 * tab is a LINK (back works, a shared URL lands on the same tab). The server page cannot hand a function
 * to the `Tabs` primitive, so this small client wrapper owns the `onChange` to `router.push` of the
 * item's href. It is the `pagamentos/PaymentsTabs.tsx` wrapper re-declared here (no route imports
 * another route's component). Every word arrives translated from the server.
 */
export function ProfileFormTabs({ label, items, value, className }: ProfileFormTabsProps) {
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
