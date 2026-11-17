'use client';

import { Tabs } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { INBOX_TABS, type InboxQueryState, type InboxTab, withInboxTab } from '@/lib/inbox-query';

/**
 * The control stack of the team's inbox list (UI-D-823) [designed]: the three tabs of the shipped `Tabs`
 * (`density="compact"`), "Em aberto" the default, "Resolvidos" and "Fechados", with NO counts on them
 * (A-UI-21: the count of a tab would need a read of its own, and the staff badge already counts what is
 * waiting). The view is controlled: the host reads it from the URL and writes a change back there.
 */
export interface InboxFiltersProps {
  query: InboxQueryState;
  onChange: (next: InboxQueryState) => void;
}

const TAB_KEY: Record<InboxTab, string> = {
  'em-aberto': 'inbox.tab.open',
  resolvidos: 'inbox.tab.resolved',
  fechados: 'inbox.tab.closed',
};

export function InboxFilters({ query, onChange }: InboxFiltersProps) {
  const t = useTranslations('chat');
  return (
    <div data-inbox-filters className="shrink-0 border-b border-divider bg-card">
      <Tabs
        density="compact"
        label={t('inbox.tab.label')}
        value={query.tab}
        onChange={(key) => onChange(withInboxTab(query, key as InboxTab))}
        items={INBOX_TABS.map((tab) => ({ key: tab, label: t(TAB_KEY[tab]) }))}
      />
    </div>
  );
}
