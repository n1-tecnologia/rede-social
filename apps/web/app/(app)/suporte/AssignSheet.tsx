'use client';

import { BottomSheet, Button, cn, Skeleton, useToast } from '@rede-social/ui';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { StaffCaseHeaderView } from '@/lib/chat-view';
import { runCaseActionAction } from './actions';
import { useStaffRoster } from './useStaffRoster';

/**
 * The assign sheet of the team's case bar (UI-D-827, D-806, CASE-08) [designed]: a `BottomSheet` "Atribuir
 * chamado #N" (the centred card from `md`) over the live staff, for the holder of the assign permission.
 *
 * **The sheet exists only when the server listed `assign`**: the thread pane mounts it from `actions[]`, so
 * a viewer who may not assign never reaches it (T-12.4-89); the route and the definer re-enforce it.
 *
 * **The list** is the shared names-only roster (`useStaffRoster`, plan 14): it does not read itself, so the
 * body calls `load()` when the sheet opens. Three skeleton rows while it loads, an inline retry line when it
 * fails. The current owner is marked "responsável hoje"; picking that same person keeps the footer
 * disabled, so "Atribuir" is enabled only for a DIFFERENT person. The viewer is always a live staff member
 * and is in the list, so the list is never empty.
 *
 * **What it sends** is the intent and nothing else: `assign`, the state the sheet opened on and the id the
 * admin picked. It names no owner and no state transition; the server decides and answers the fresh case or
 * a refusal. A stale or failed answer toasts as the bar does and KEEPS the sheet open with the picked row.
 *
 * The body is mounted only while the sheet is open, so the roster hook (forgotten when its last consumer
 * leaves) and the pick are fresh on every opening. The list scrolls inside the sheet and the footer stays in
 * view (`scroll="content"`), also with thirty people at 320px. Every word is the `chat` catalog's and every
 * name is React text (T-12.4-73).
 */

export interface AssignSheetProps {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  /** The finished staff header: its state is the expected state, its owner the "responsável hoje" mark. */
  header: StaffCaseHeaderView;
  /** The fresh finished header the server answered after the assignment. */
  onHeader: (header: StaffCaseHeaderView) => void;
  /** The screen was behind the case: re-read it. */
  onStale: () => void;
}

/** One radio row: the name on one truncated line, the "responsável hoje" mark and `Check` on the pick. */
function PersonRow({
  checked,
  name,
  mark,
  disabled,
  onSelect,
}: {
  checked: boolean;
  name: string;
  mark: string | null;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a radio row is a button that takes the whole line; `<input type="radio">` cannot hold the mark, the check glyph and the 48px row.
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex min-h-12 w-full min-w-0 items-center gap-3 rounded-xl px-2 text-left text-base text-text transition-colors hover:bg-bg-hover active:bg-bg-active',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand',
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate', checked ? 'font-bold' : 'font-normal')}>{name}</span>
        {mark ? (
          <span data-assign-current className="text-xs font-normal text-text-tertiary">
            {mark}
          </span>
        ) : null}
      </span>
      {checked ? (
        <Check data-radio-check aria-hidden size={20} className="shrink-0 text-brand" />
      ) : null}
    </button>
  );
}

function AssignBody({
  onClose,
  conversationId,
  header,
  onHeader,
  onStale,
}: Omit<AssignSheetProps, 'open'>) {
  const t = useTranslations('chat');
  const te = useTranslations('app.error');
  const { show } = useToast();
  const roster = useStaffRoster();
  const { load } = roster;
  const [picked, setPicked] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  /** The state the sheet opened on: a case that moved while it was open is refused as stale (UI-D-830). */
  const [openedOn] = useState(header.state.state);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const number = String(header.number);
  const canAssign = picked !== null && picked !== header.ownerUserId && !pending;

  const assign = async () => {
    if (picked === null || !canAssign || busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    const target = roster.items.find((member) => member.userId === picked);
    try {
      const result = await runCaseActionAction(conversationId, {
        action: 'assign',
        expectedState: openedOn,
        assigneeUserId: picked,
      });
      if (result.ok) {
        onHeader(result.header);
        show({
          tone: 'success',
          message: t('toast.assigned', { number, name: target?.name ?? '' }),
        });
        onClose();
      } else if (
        result.error === 'stale' ||
        result.error === 'closed' ||
        result.error === 'not_allowed'
      ) {
        show({ tone: 'error', message: t('toast.stale') });
        onStale();
      } else {
        show({ tone: 'error', message: t('toast.failed') });
      }
    } catch {
      show({ tone: 'error', message: t('toast.failed') });
    } finally {
      busyRef.current = false;
      if (mounted.current) setPending(false);
    }
  };

  let rows: ReactNode = null;
  if (roster.status === 'ready') {
    rows = roster.items.map((member) => (
      <PersonRow
        key={member.userId}
        checked={picked === member.userId}
        name={member.name}
        mark={member.userId === header.ownerUserId ? t('sheet.assign.current') : null}
        disabled={pending}
        onSelect={() => setPicked(member.userId)}
      />
    ));
  } else if (roster.status === 'loading' || roster.status === 'idle') {
    rows = [0, 1, 2].map((index) => (
      <div key={index} data-roster-skeleton className="flex min-h-12 items-center px-2">
        <Skeleton variant="text" width={index === 1 ? '36%' : '52%'} className="h-4" />
      </div>
    ));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        data-assign-scroll
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2"
      >
        <div
          role="radiogroup"
          aria-label={t('sheet.assign.title', { number })}
          aria-busy={roster.status === 'loading' || undefined}
          className="flex flex-col"
        >
          {rows}
        </div>
        {roster.status === 'error' ? (
          <div data-roster-error className="flex flex-col items-center gap-2 px-4 py-3 text-center">
            <p className="text-sm font-normal text-danger">{t('inbox.filter.rosterError')}</p>
            <Button variant="ghost" size="sm" onClick={roster.retry}>
              {te('retry')}
            </Button>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col gap-3 border-t border-divider px-4 py-3">
        <p className="text-xs font-normal text-text-secondary">{t('sheet.assign.hint')}</p>
        <div className="flex flex-col gap-2">
          <Button
            variant="brand"
            fullWidth
            loading={pending}
            disabled={!canAssign}
            onClick={() => void assign()}
          >
            {t('sheet.assign.confirm')}
          </Button>
          <Button variant="ghost" fullWidth disabled={pending} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AssignSheet({ open, ...body }: AssignSheetProps) {
  const t = useTranslations('chat');
  return (
    <BottomSheet
      open={open}
      onClose={body.onClose}
      title={t('sheet.assign.title', { number: String(body.header.number) })}
      desktopCard
      scroll="content"
    >
      <AssignBody {...body} />
    </BottomSheet>
  );
}
