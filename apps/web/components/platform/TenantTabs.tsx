'use client';

import { Tabs } from '@rede-social/ui';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/** The five tab segments in their FIXED order (UI-SPEC tenant page). */
const TAB_KEYS = ['marca', 'modulos', 'dominios', 'admins', 'status'] as const;
type TabKey = (typeof TAB_KEYS)[number];

const TAB_LABEL_KEY: Record<TabKey, 'brand' | 'modules' | 'domains' | 'admins' | 'status'> = {
  marca: 'brand',
  modulos: 'modules',
  dominios: 'domains',
  admins: 'admins',
  status: 'status',
};

export interface TenantTabsProps {
  tenantId: string;
  className?: string;
}

/**
 * Marca · Módulos · Domínios · Admins · Status as links to the tab sub-routes; the active tab is the
 * segment after `/plataforma/tenants/{id}/` (the tenant root redirects to `marca`). Arrow keys move
 * through `@rede-social/ui` `Tabs`' roving tabindex and navigate.
 */
export function TenantTabs({ tenantId, className }: TenantTabsProps) {
  const t = useTranslations('platform');
  const pathname = usePathname();
  const router = useRouter();
  const base = `/plataforma/tenants/${tenantId}`;
  const segment = pathname.startsWith(`${base}/`)
    ? pathname.slice(base.length + 1).split('/')[0]
    : '';
  const active: TabKey = (TAB_KEYS as readonly string[]).includes(segment ?? '')
    ? (segment as TabKey)
    : 'marca';

  return (
    <Tabs
      className={className}
      label={t('tenant.tabsLabel')}
      items={TAB_KEYS.map((key) => ({
        key,
        label: t(`tenant.tabs.${TAB_LABEL_KEY[key]}`),
        href: `${base}/${key}`,
      }))}
      value={active}
      onChange={(key) => router.push(`${base}/${key}`)}
    />
  );
}
