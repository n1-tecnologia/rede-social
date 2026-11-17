'use client';

import { Button, IconButton, StatusPill } from '@rede-social/ui';
import { CircleCheck, CircleDot, Ellipsis, Info, Lock, UserCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import type { CaseStateGlyph, StaffCaseHeaderView } from '@/lib/chat-view';
import { CaseActionSheet, type StaffSheetKind } from './CaseActionSheet';
import { CaseDialogs } from './CaseDialogs';
import { type CaseActionKind, useCaseActions } from './useCaseActions';

/**
 * The team's case bar of the staff thread (UI-D-825, UI-D-826, UI-D-827) [designed], under the shipped staff
 * `ThreadHeader` and above the scroller.
 *
 * **Two rows at 320, 390 and `lg`.** Row 1 is ONE button (min-h 44px, named "Ver detalhes do chamado #N")
 * holding "#N", the subject label (always present, D-839) on one truncated line and the state pill; it asks
 * the thread pane for the details sheet. Row 2 holds the meta text ("{categoria} · {Prioridade} · Com Carla",
 * truncated: at 320 px it can hide the owner's name, which the details sheet holds in full, sketch 023
 * outcome 4), then the primary action and the 44px "Mais ações" button. A `Fechado` case keeps the same
 * geometry with no primary action and only the read-only menu rows.
 *
 * **What it decides: nothing.** The primary button is the server's `actions[]` read through the state: the
 * verb is drawn only when the server listed it (Assumir brand on an unowned open case, Resolver outline on a
 * case the viewer owns, Assumir outline for a take-over, Reabrir outline on a resolved one). The legality of
 * every transition, the owner and the priority are the finished header's; a tap runs `useCaseActions`, which
 * sends the intent with the state the screen showed and believes only the answer.
 *
 * The strips of the thread's footer (the reply-takes hint and the read-only closed strip) are exported here
 * for the pane. Every word is the `chat` catalog's.
 */

const GLYPHS: Record<CaseStateGlyph, typeof CircleDot> = {
  CircleDot,
  UserCheck,
  CircleCheck,
  Lock,
};

interface Primary {
  kind: CaseActionKind;
  variant: 'brand' | 'outline';
}

/** The state's one primary button, and only when the server listed its verb (UI-D-826). */
function primaryOf(header: StaffCaseHeaderView): Primary | null {
  const listed = (kind: CaseActionKind) => header.actions.includes(kind);
  switch (header.state.state) {
    case 'open':
      return listed('take') ? { kind: 'take', variant: 'brand' } : null;
    case 'in_progress':
      if (header.ownerIsViewer)
        return listed('resolve') ? { kind: 'resolve', variant: 'outline' } : null;
      return listed('take') ? { kind: 'take', variant: 'outline' } : null;
    case 'resolved':
      return listed('reopen') ? { kind: 'reopen', variant: 'outline' } : null;
    default:
      return null;
  }
}

export interface StaffCaseBarProps {
  conversationId: string;
  /** The finished staff header (plans 11 and 20): the server's facts, drawn as they are. */
  header: StaffCaseHeaderView;
  /** An action succeeded: the fresh header the server answered. */
  onHeader: (header: StaffCaseHeaderView) => void;
  /** A refusal said the screen was behind the case: re-read it. */
  onRefresh: () => void;
  /** The rows that open another sheet (assign, edit) and the bar's own details button. */
  onOpenSheet: (kind: StaffSheetKind) => void;
}

export function StaffCaseBar({
  conversationId,
  header,
  onHeader,
  onRefresh,
  onOpenSheet,
}: StaffCaseBarProps) {
  const t = useTranslations('chat');
  const [menuOpen, setMenuOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  /** Which control opened the dialog, so focus goes back to it when the dialog settles. */
  const openerRef = useRef<'primary' | 'menu'>('menu');

  const { pending, dialog, request, confirm, dismiss } = useCaseActions({
    conversationId,
    header,
    onHeader,
    onStale: onRefresh,
  });

  const primary = primaryOf(header);
  const Glyph = GLYPHS[header.state.glyph];
  const busy = pending !== null;

  const closeDialog = () => {
    dismiss();
    // The menu row that opened the dialog left with its sheet: hand the focus to a control that is still here.
    const target =
      openerRef.current === 'primary'
        ? barRef.current?.querySelector<HTMLElement>('[data-case-primary]')
        : null;
    setTimeout(
      () => (target?.isConnected ? target : menuRef.current)?.focus({ preventScroll: true }),
      0,
    );
  };

  return (
    <>
      <div
        ref={barRef}
        data-case-bar
        data-case-staff
        className="shrink-0 border-b border-border bg-bg-secondary px-4 py-2"
      >
        <button
          type="button"
          aria-label={t('staffCase.detailsLabel', { number: String(header.number) })}
          onClick={() => onOpenSheet('details')}
          className="flex min-h-11 w-full items-center gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span aria-hidden className="shrink-0 text-sm font-bold text-text">
            {`#${header.number}`}
          </span>
          <span
            aria-hidden
            data-case-subject
            className="min-w-0 flex-1 truncate text-sm font-normal text-text"
          >
            {header.subject}
          </span>
          <StatusPill aria-hidden tone={header.state.tone} className="ml-auto shrink-0">
            <Glyph aria-hidden size={12} />
            {header.state.label}
          </StatusPill>
        </button>
        <div className="flex items-center gap-2">
          <p
            data-case-meta
            className="min-w-0 flex-1 truncate text-xs font-normal text-text-tertiary"
          >
            {header.meta}
          </p>
          {primary ? (
            <Button
              data-case-primary
              size="sm"
              hitArea
              variant={primary.variant}
              className="shrink-0"
              loading={pending === primary.kind}
              disabled={busy}
              onClick={() => {
                openerRef.current = 'primary';
                request(primary.kind);
              }}
            >
              {t(`action.${primary.kind}`)}
            </Button>
          ) : null}
          <IconButton
            ref={menuRef}
            icon={Ellipsis}
            label={t('action.more')}
            className="shrink-0"
            disabled={busy}
            onClick={() => setMenuOpen(true)}
          />
        </div>
      </div>

      <CaseActionSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        actions={header.actions}
        onAction={(kind) => {
          openerRef.current = 'menu';
          request(kind);
        }}
        onOpenSheet={onOpenSheet}
      />
      <CaseDialogs dialog={dialog} onConfirm={confirm} onClose={closeDialog} />
    </>
  );
}

/**
 * UI-D-828a: on an `Aberto` case with no owner, the line above the composer that says a reply takes it.
 * Not drawn on a case owned by someone else, a resolved one, or when a notice replaces the composer.
 */
export function StaffTakeHint() {
  const t = useTranslations('chat');
  return (
    <div data-case-take-hint className="flex items-start gap-2 px-4 py-2">
      <Info aria-hidden size={14} className="mt-0.5 shrink-0 text-text-tertiary" />
      <p className="text-xs font-normal text-text-secondary">{t('staffCase.takeOnReply')}</p>
    </div>
  );
}

/**
 * UI-D-828d: a `Fechado` case is read-only for the team too: this strip REPLACES the composer (the shipped
 * geometry of the member's closed strip, with no "Novo chamado": staff never open a case of their own).
 */
export function StaffClosedStrip() {
  const t = useTranslations('chat');
  return (
    <div
      role="status"
      data-case-closed
      className="flex items-center gap-3 border-t border-border bg-bg-secondary px-4 py-3"
    >
      <Lock aria-hidden size={20} className="shrink-0 text-text-tertiary" />
      <p className="min-w-0 flex-1 text-sm font-normal text-text-secondary">
        {t('staffCase.closedNotice')}
      </p>
    </div>
  );
}
