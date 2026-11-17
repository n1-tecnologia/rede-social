'use client';

import { BottomSheet, Button, Skeleton, StatusPill } from '@rede-social/ui';
import {
  CircleCheck,
  Lock,
  type LucideIcon,
  MessageCirclePlus,
  Pencil,
  RotateCcw,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  type CaseHistoryView,
  type ChatDayKeys,
  caseCategoryLabel,
  caseOpenedMoment,
  casePriorityView,
  type StaffCaseHeaderView,
} from '@/lib/chat-view';
import { CASE_STATE_GLYPHS } from './caseStateGlyphs';

/**
 * The details sheet of the team's case bar (UI-D-829, D-810, D-224, CASE-12, CASE-18) [designed]: a
 * `BottomSheet` "Chamado #N" (the centred card from `md`, `scroll="sheet"` so the title stays and a long
 * history scrolls inside it), opened from the bar's row 1 and from the menu's "Ver detalhes e histórico".
 * There is no side panel. The sheet is READ-ONLY: every change goes through the action sheet.
 *
 * - **Dados** (a definition list, from the finished staff header the pane already holds): Estado (the pill),
 *   Categoria, Prioridade, Responsável (the full name or "Sem responsável") and "Aberto em" in the thread's
 *   day-label rule and the tenant clock, from the day keys the server last sent (this component reads no
 *   clock).
 * - **Histórico**, oldest first: one row per event, a 32px neutral disc with a 16px glyph, the finished
 *   sentence (the actor's name in bold) and the time under it. The sentences and the times come FINISHED
 *   from `GET .../case/history` (plan 20), including the automatic close, which has no actor, and an actor
 *   who left, who reads through the catalog. The history is loaded LAZILY, when the sheet opens: three
 *   skeleton rows, then the list, or the inline line "Não foi possível carregar o histórico." with a ghost
 *   retry.
 * - **Chamados anteriores deste membro**: up to five cases the same member opened BEFORE this one, each an
 *   anchor to `/suporte/{id}` with its state pill and its opening date; "Mostrando os 5 mais recentes."
 *   closes the section when more exist, and with none the section is not drawn at all.
 *
 * The body is mounted only while the sheet is open, so every opening reads the history again. No id of the
 * case, the owner or an actor is ever drawn; every name and subject is React text (T-12.4-73). The thread
 * pane mounts this sheet for the STAFF viewer only (T-12.4-91): the history route refuses a member too.
 */

export interface CaseDetailsSheetProps {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  /** The finished staff header: the "Dados" facts. */
  header: StaffCaseHeaderView;
  /** The tenant-local day keys the thread last had from the server (for the "Aberto em" day word). */
  keys: ChatDayKeys;
  /** The tenant's IANA time zone. */
  timeZone: string;
}

const EVENT_GLYPHS: Record<CaseHistoryView['events'][number]['kind'], LucideIcon> = {
  opened: MessageCirclePlus,
  taken: UserCheck,
  assigned: UserPlus,
  resolved: CircleCheck,
  closed: Lock,
  reopened: RotateCcw,
  edited: Pencil,
};

/** The most earlier cases the sheet ever draws (A-UI-22). */
const EARLIER_MAX = 5;

type HistoryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; history: CaseHistoryView };

/** Anything that is not the handler's own shape is a failed read, never a crash. */
function historyOf(body: unknown): CaseHistoryView | null {
  if (typeof body !== 'object' || body === null) return null;
  const { events, earlier, hasMoreEarlier } = body as Record<string, unknown>;
  if (!Array.isArray(events) || !Array.isArray(earlier)) return null;
  return { events, earlier, hasMoreEarlier: hasMoreEarlier === true } as CaseHistoryView;
}

async function fetchHistory(conversationId: string): Promise<CaseHistoryView | null> {
  try {
    const res = await fetch(
      `/api/chat/conversations/${encodeURIComponent(conversationId)}/case/history`,
      { cache: 'no-store', credentials: 'same-origin', redirect: 'manual' },
    );
    if (!res.ok) return null;
    return historyOf(await res.json());
  } catch {
    return null;
  }
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-sm font-normal text-text-tertiary">{term}</dt>
      <dd className="min-w-0 text-right text-sm font-bold text-text">{children}</dd>
    </div>
  );
}

function DetailsBody({
  conversationId,
  header,
  keys,
  timeZone,
}: Omit<CaseDetailsSheetProps, 'open' | 'onClose'>) {
  const t = useTranslations('chat');
  const te = useTranslations('app.error');
  const [state, setState] = useState<HistoryState>({ status: 'loading' });
  const alive = useRef(true);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    const history = await fetchHistory(conversationId);
    if (!alive.current) return;
    setState(history ? { status: 'ready', history } : { status: 'error' });
  }, [conversationId]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const StateGlyph = CASE_STATE_GLYPHS[header.state.glyph];
  const earlier = state.status === 'ready' ? state.history.earlier.slice(0, EARLIER_MAX) : [];

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="case-details-data" className="flex flex-col gap-3">
        <h3 id="case-details-data" className="text-base font-bold text-text">
          {t('details.data')}
        </h3>
        <dl className="flex flex-col gap-3">
          <Row term={t('details.state')}>
            <StatusPill tone={header.state.tone}>
              <StateGlyph aria-hidden size={12} />
              {header.state.label}
            </StatusPill>
          </Row>
          <Row term={t('details.category')}>{caseCategoryLabel(header.category, t)}</Row>
          <Row term={t('details.priority')}>{casePriorityView(header.priority, t).label}</Row>
          <Row term={t('details.owner')}>
            {header.ownerName?.trim() ? header.ownerName : t('details.noOwner')}
          </Row>
          <Row term={t('details.openedAt')}>
            {caseOpenedMoment(header.openedAt, { keys, timeZone, t })}
          </Row>
        </dl>
      </section>

      <section aria-labelledby="case-details-history" className="flex flex-col gap-3">
        <h3 id="case-details-history" className="text-base font-bold text-text">
          {t('history.title')}
        </h3>
        {state.status === 'loading' ? (
          <div aria-busy="true" className="flex flex-col gap-4">
            {[0, 1, 2].map((index) => (
              <div key={index} data-history-skeleton className="flex items-start gap-3">
                <Skeleton variant="circle" width={32} height={32} />
                <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
                  <Skeleton variant="text" width={index === 1 ? '60%' : '80%'} className="h-3.5" />
                  <Skeleton variant="text" width="30%" className="h-3" />
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {state.status === 'error' ? (
          <div
            data-history-error
            className="flex flex-col items-center gap-2 px-4 py-3 text-center"
          >
            <p className="text-sm font-normal text-danger">{t('history.errors.load')}</p>
            <Button variant="ghost" size="sm" onClick={() => void load()}>
              {te('retry')}
            </Button>
          </div>
        ) : null}
        {state.status === 'ready' ? (
          <ol className="flex flex-col gap-4">
            {state.history.events.map((event, index) => {
              const Glyph = EVENT_GLYPHS[event.kind] ?? Pencil;
              return (
                // The API's order is the order of the story; a row is identified by its place in it.
                // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id and are never reordered.
                <li key={index} data-history-row={event.kind} className="flex items-start gap-3">
                  <span
                    data-history-disc
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-text-secondary"
                  >
                    <Glyph aria-hidden size={16} />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="text-sm font-normal text-text">
                      {event.parts.map((part, partIndex) =>
                        part.strong ? (
                          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one sentence are fixed.
                          <strong key={partIndex} data-strong className="font-bold">
                            {part.text}
                          </strong>
                        ) : (
                          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one sentence are fixed.
                          <span key={partIndex}>{part.text}</span>
                        ),
                      )}
                    </p>
                    <p className="text-xs font-normal text-text-tertiary">{event.time}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}
      </section>

      {earlier.length > 0 ? (
        <section aria-labelledby="case-details-earlier" className="flex flex-col gap-1">
          <h3 id="case-details-earlier" className="text-base font-bold text-text">
            {t('details.earlier')}
          </h3>
          <ul className="flex flex-col">
            {earlier.map((row) => {
              const Glyph = CASE_STATE_GLYPHS[row.state.glyph];
              return (
                <li key={row.id}>
                  <Link
                    href={row.href}
                    className="flex min-h-12 items-center gap-3 rounded-xl px-2 py-1 hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-normal text-text">
                      {row.subjectLine}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <StatusPill tone={row.state.tone}>
                        <Glyph aria-hidden size={12} />
                        {row.state.label}
                      </StatusPill>
                      <span className="text-xs font-normal text-text-tertiary">{row.date}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {state.status === 'ready' && state.history.hasMoreEarlier ? (
            <p className="px-2 text-xs font-normal text-text-tertiary">
              {t('details.earlierMore')}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export function CaseDetailsSheet({ open, onClose, ...body }: CaseDetailsSheetProps) {
  const t = useTranslations('chat');
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t('details.title', { number: String(body.header.number) })}
      desktopCard
      scroll="sheet"
    >
      <DetailsBody {...body} />
    </BottomSheet>
  );
}
