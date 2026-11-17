'use client';

import { BottomSheet, Button, Chip, cn, Skeleton, Tabs } from '@rede-social/ui';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';
import {
  anyInboxFilter,
  INBOX_DEFAULTS,
  INBOX_TABS,
  type InboxPriority,
  type InboxQueryState,
  type InboxTab,
  withInboxTab,
} from '@/lib/inbox-query';
import { useStaffRoster } from './useStaffRoster';

/**
 * The control stack of the team's inbox list (UI-D-823, A-UI-5, A-UI-28) [designed], under the list's header
 * and above the rows:
 *
 * - **Tabs** (the shipped `Tabs`, `density="compact"`): "Em aberto" (the default), "Resolvidos" and
 *   "Fechados", with NO counts (A-UI-21: the staff badge already counts what is waiting).
 * - **Filter row** of shipped `Chip`s that never wraps and scrolls sideways: "Responsável" and
 *   "Prioridade" each open a `BottomSheet` (`desktopCard` from `md`) holding a radio list; "Aguardando
 *   resposta" is a toggle (`aria-pressed`) shown ONLY on "Em aberto", because only active cases await.
 *   A sheet row applies AT ONCE and closes the sheet (no "Aplicar" button), with `Check` on the picked
 *   row; the chip then reads "Responsável: Eu" in the brand fill. Focus returns to the chip that opened
 *   the sheet (the shipped trap).
 * - **"Limpar filtros"** (ghost link under the chips) only when an owner, a priority or the toggle is on;
 *   it keeps the tab.
 *
 * The view is CONTROLLED: the host reads it from the URL and writes a change back there. The owner list is
 * the shared names-only roster (`useStaffRoster`): three skeleton radio rows while it loads, an inline
 * retry line when it fails; the three fixed rows (Todos, Eu, Sem responsável) never wait for it. No client
 * code here decides which cases belong to a tab or which actions are legal: the server lists and filters.
 *
 * Every word is the `chat` catalog's and every name is React text (T-12.4-67).
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

const PRIORITY_KEY: Record<InboxPriority, string> = {
  alta: 'priority.high',
  normal: 'priority.normal',
  baixa: 'priority.low',
};

const PRIORITIES: readonly InboxPriority[] = ['alta', 'normal', 'baixa'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One radio row of a sheet: the label on one truncated line and `Check` on the picked row. */
function RadioRow({
  checked,
  label,
  onSelect,
}: {
  checked: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a radio row is a button that takes the whole line; `<input type="radio">` cannot hold the check glyph and the 44px row.
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        'flex min-h-11 w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-text transition-colors hover:bg-bg-hover active:bg-bg-active',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand',
      )}
    >
      <span
        data-radio-label
        className={cn('min-w-0 flex-1 truncate', checked ? 'font-bold' : 'font-normal')}
      >
        {label}
      </span>
      {checked ? (
        <Check data-radio-check aria-hidden size={16} className="shrink-0 text-brand" />
      ) : null}
    </button>
  );
}

/**
 * What a chip that opens a sheet says to assistive technology: a dialog popup, never a pressed toggle. The
 * shipped `Chip` draws `aria-pressed` on every button chip, so the attribute is cleared here (a spread, so it
 * is overridden after the chip's own).
 */
const OPENER_ARIA = { 'aria-pressed': undefined, 'aria-haspopup': 'dialog' } as const;

/** A chip that opens a sheet: text on one truncated line and a `ChevronDown`; never a toggle. */
function SheetChip({
  active,
  label,
  onOpen,
}: {
  active: boolean;
  label: string;
  onOpen: () => void;
}) {
  return (
    <Chip active={active} onClick={onOpen} {...OPENER_ARIA} className="max-w-[16rem]">
      <span data-chip-text className="min-w-0 truncate">
        {label}
      </span>
      <ChevronDown aria-hidden size={14} className="shrink-0" />
    </Chip>
  );
}

export function InboxFilters({ query, onChange }: InboxFiltersProps) {
  const t = useTranslations('chat');
  const te = useTranslations('app.error');
  const [sheet, setSheet] = useState<'owner' | 'priority' | null>(null);
  const roster = useStaffRoster();
  const { load } = roster;

  // The roster is read when the owner sheet opens, or when the URL names a staff member the chip must say.
  const ownerIsStaff = query.owner !== null && UUID_RE.test(query.owner);
  useEffect(() => {
    if (sheet === 'owner' || ownerIsStaff) load();
  }, [sheet, ownerIsStaff, load]);

  const apply = (next: InboxQueryState) => {
    onChange(next);
    setSheet(null);
  };

  const ownerName =
    query.owner === null
      ? null
      : query.owner === 'eu'
        ? t('inbox.filter.ownerMe')
        : query.owner === 'sem'
          ? t('inbox.filter.ownerNone')
          : (roster.items.find((member) => member.userId === query.owner)?.name ?? null);
  const ownerChip =
    ownerName === null
      ? t('inbox.filter.owner')
      : t('inbox.filter.ownerValue', { value: ownerName });
  const priorityChip =
    query.priority === null
      ? t('inbox.filter.priority')
      : t('inbox.filter.priorityValue', { value: t(PRIORITY_KEY[query.priority]) });

  let staffRows: ReactNode = null;
  if (roster.status === 'ready') {
    staffRows = roster.items.map((member) => (
      <RadioRow
        key={member.userId}
        checked={query.owner === member.userId}
        label={member.name}
        onSelect={() => apply({ ...query, owner: member.userId })}
      />
    ));
  } else if (roster.status === 'loading' || roster.status === 'idle') {
    staffRows = [0, 1, 2].map((index) => (
      <div key={index} data-roster-skeleton className="flex min-h-11 items-center px-3">
        <Skeleton variant="text" width={index === 1 ? '36%' : '52%'} className="h-3.5" />
      </div>
    ));
  }

  return (
    <div data-inbox-filters className="shrink-0 border-b border-divider bg-card">
      <Tabs
        density="compact"
        label={t('inbox.tab.label')}
        value={query.tab}
        onChange={(key) => onChange(withInboxTab(query, key as InboxTab))}
        items={INBOX_TABS.map((tab) => ({ key: tab, label: t(TAB_KEY[tab]) }))}
      />

      <div
        data-inbox-chips
        className="flex gap-2 overflow-x-auto px-4 py-2 scrollbar-none [&::-webkit-scrollbar]:hidden"
      >
        <SheetChip
          active={query.owner !== null}
          label={ownerChip}
          onOpen={() => setSheet('owner')}
        />
        <SheetChip
          active={query.priority !== null}
          label={priorityChip}
          onOpen={() => setSheet('priority')}
        />
        {query.tab === 'em-aberto' ? (
          <Chip
            active={query.awaiting}
            onClick={() => onChange({ ...query, awaiting: !query.awaiting })}
          >
            {t('inbox.filter.awaiting')}
          </Chip>
        ) : null}
      </div>

      {anyInboxFilter(query) ? (
        <div className="px-4 pb-1">
          <Button
            variant="ghost"
            size="sm"
            hitArea
            className="-ml-4"
            onClick={() => onChange({ ...INBOX_DEFAULTS, tab: query.tab })}
          >
            {t('inbox.filter.clear')}
          </Button>
        </div>
      ) : null}

      <BottomSheet
        open={sheet === 'owner'}
        onClose={() => setSheet(null)}
        title={t('inbox.filter.owner')}
        desktopCard
      >
        <div
          role="radiogroup"
          aria-label={t('inbox.filter.owner')}
          aria-busy={roster.status === 'loading' || undefined}
          className="flex flex-col"
        >
          <RadioRow
            checked={query.owner === null}
            label={t('inbox.filter.ownerAll')}
            onSelect={() => apply({ ...query, owner: null })}
          />
          <RadioRow
            checked={query.owner === 'eu'}
            label={t('inbox.filter.ownerMe')}
            onSelect={() => apply({ ...query, owner: 'eu' })}
          />
          <RadioRow
            checked={query.owner === 'sem'}
            label={t('inbox.filter.ownerNone')}
            onSelect={() => apply({ ...query, owner: 'sem' })}
          />
          {staffRows}
        </div>
        {roster.status === 'error' ? (
          <div data-roster-error className="flex flex-col items-center gap-2 px-4 py-3 text-center">
            <p className="text-sm font-normal text-danger">{t('inbox.filter.rosterError')}</p>
            <Button variant="ghost" size="sm" onClick={roster.retry}>
              {te('retry')}
            </Button>
          </div>
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={sheet === 'priority'}
        onClose={() => setSheet(null)}
        title={t('inbox.filter.priority')}
        desktopCard
      >
        <div role="radiogroup" aria-label={t('inbox.filter.priority')} className="flex flex-col">
          <RadioRow
            checked={query.priority === null}
            label={t('inbox.filter.priorityAll')}
            onSelect={() => apply({ ...query, priority: null })}
          />
          {PRIORITIES.map((priority) => (
            <RadioRow
              key={priority}
              checked={query.priority === priority}
              label={t(PRIORITY_KEY[priority])}
              onSelect={() => apply({ ...query, priority })}
            />
          ))}
        </div>
      </BottomSheet>
    </div>
  );
}
