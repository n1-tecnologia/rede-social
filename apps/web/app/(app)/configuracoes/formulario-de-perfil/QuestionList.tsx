'use client';

import type { AdminQuestion } from '@rede-social/contracts/profile-form';
import { Button, Card, IconButton, SectionTitle, StatusPill, useToast } from '@rede-social/ui';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Eye, Lock, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { typeNameKey } from '@/lib/profile-form/question-types';
import { type ReorderResult, reorderQuestionsAction } from './actions';

export interface QuestionListProps {
  /** The ACTIVE questions in the order members see them (the API's order). */
  questions: AdminQuestion[];
  /** The most active questions a tenant may have. */
  limit: number;
  /**
   * Opens the question in the editor. Plan 16 supplies it (the editor sheet); until then a row is a
   * button that takes no click handler of its own.
   */
  onOpen?: (question: AdminQuestion) => void;
  /** Opens the editor for a new question (12-16). Without it the list shows no "Adicionar pergunta". */
  onAdd?: () => void;
  /** Opens "Como o membro vê" (12-17). Without it the list shows no "Ver como o membro vê". */
  onPreview?: () => void;
}

type Direction = 'up' | 'down';

/** The body every row shares: position, title, badges and the meta line (UI-D-566). */
function RowBody({ question, position }: { question: AdminQuestion; position: number }) {
  const t = useTranslations('profileForm');
  const answered = question.answerCount > 0;
  return (
    <>
      <span aria-hidden className="w-5 shrink-0 pt-px text-xs font-bold text-text-tertiary">
        {position}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="line-clamp-3 break-words text-sm font-bold text-text">
          {question.title}
        </span>
        <span className="flex flex-wrap gap-2">
          <StatusPill tone="neutral">{t(typeNameKey(question.type))}</StatusPill>
          {question.showOnProfile ? (
            <StatusPill tone="neutral">
              <Eye aria-hidden size={12} />
              {t('admin.row.onProfile')}
            </StatusPill>
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-normal text-text-secondary">
          <span className={question.required ? 'font-bold text-text' : 'text-text-tertiary'}>
            {question.required ? t('admin.row.required') : t('admin.row.optional')}
          </span>
          <span aria-hidden>·</span>
          <span>{t('admin.row.answers', { count: question.answerCount })}</span>
          {answered ? (
            <>
              <Lock aria-hidden size={12} className="shrink-0" />
              <span className="sr-only">{t('admin.row.locked')}</span>
            </>
          ) : null}
        </span>
      </span>
    </>
  );
}

interface RowProps {
  question: AdminQuestion;
  position: number;
  total: number;
  onOpen?: (question: AdminQuestion) => void;
}

/**
 * One question of the builder (UI-D-566): the WHOLE row is one `button` (`min-h-11`) that opens the
 * editor. Colour and weight never carry a state alone: the required state, the position and the count
 * are words, and the position and the state are also in the accessible description.
 */
function QuestionRow({ question, position, total, onOpen }: RowProps) {
  const t = useTranslations('profileForm');
  const descriptionId = useId();
  const answered = question.answerCount > 0;
  const stateWord = question.required ? t('admin.row.required') : t('admin.row.optional');
  const description = [
    t('admin.row.position', { position, total }),
    stateWord,
    t('admin.row.answers', { count: question.answerCount }),
    answered ? t('admin.row.locked') : null,
  ]
    .filter((part): part is string => part !== null)
    .map((part) => `${part}.`)
    .join(' ');

  return (
    <li>
      <Card className="p-0">
        <button
          type="button"
          aria-label={t('admin.row.edit', { title: question.title })}
          aria-describedby={descriptionId}
          onClick={onOpen ? () => onOpen(question) : undefined}
          className="flex min-h-11 w-full items-start gap-3 p-4 text-left transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
        >
          <RowBody question={question} position={position} />
          <ChevronRight aria-hidden size={18} className="mt-0.5 shrink-0 text-text-tertiary" />
        </button>
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      </Card>
    </li>
  );
}

interface ReorderRowProps {
  question: AdminQuestion;
  index: number;
  total: number;
  busy: boolean;
  register: (key: string, element: HTMLButtonElement | null) => void;
  onMove: (id: string, delta: -1 | 1) => void;
}

/**
 * A row in reorder mode (UI-D-567): not an editor opener (no accidental taps). The chevron is replaced
 * by two 44x44 `IconButton`s, disabled on the first and the last row (a list of one has both disabled).
 * While a write runs the buttons are `aria-busy` and ignore presses instead of becoming `disabled`, so
 * the focused control keeps focus through the write.
 */
function ReorderRow({ question, index, total, busy, register, onMove }: ReorderRowProps) {
  const t = useTranslations('profileForm.admin.reorder');
  return (
    <li>
      <Card className="p-0">
        <div className="flex min-h-11 w-full items-start gap-3 p-4">
          <RowBody question={question} position={index + 1} />
          <span className="-my-2 -mr-2 flex shrink-0 items-center">
            <IconButton
              ref={(element) => register(`${question.id}:up`, element)}
              icon={ArrowUp}
              size={18}
              label={t('up', { title: question.title })}
              disabled={index === 0}
              aria-busy={busy || undefined}
              onClick={() => onMove(question.id, -1)}
            />
            <IconButton
              ref={(element) => register(`${question.id}:down`, element)}
              icon={ArrowDown}
              size={18}
              label={t('down', { title: question.title })}
              disabled={index === total - 1}
              aria-busy={busy || undefined}
              onClick={() => onMove(question.id, 1)}
            />
          </span>
        </div>
      </Card>
    </li>
  );
}

/**
 * The active list of the Perguntas tab (12-15, D-582, UI-D-565..UI-D-567): the actions row ("Adicionar pergunta",
 * "Reordenar", "Ver como o membro vê"), the limit line, the "Perguntas
 * ativas (n)" micro-title and the rows in the admin's order, which is the order members see.
 *
 * **Reorder is a mode with buttons, never a drag** (a drag fights the scroll of a mobile page, and the
 * buttons are the keyboard alternative). Each press moves the row, SAVES AT ONCE with one write of the
 * WHOLE ordered id list through the server action, keeps focus on the same button at its new position
 * (re-applied after React moves the row, because a moved node loses focus; if that button is now disabled
 * at an edge, its sibling takes the focus) and announces the new position through an `aria-live="polite"`
 * region. A failed write puts the row back and toasts; a lost permission or a module turned off ends in
 * a refresh into the page's `notFound()`.
 *
 * The tab is read once per request on the server: the list holds the server's copy and the optimistic
 * order only while a write is in flight, and the page refreshes when the mode ends. It shows aggregate
 * counts only (PFORM-23): never an individual member's answer, and it makes no request of its own.
 */
export function QuestionList({ questions, limit, onOpen, onAdd, onPreview }: QuestionListProps) {
  const t = useTranslations('profileForm');
  const tAdmin = useTranslations('admin');
  const router = useRouter();
  const toast = useToast();

  // The server's list wins whenever it re-renders with a new one (after a refresh).
  const [source, setSource] = useState(questions);
  const [items, setItems] = useState(questions);
  if (source !== questions) {
    setSource(questions);
    setItems(questions);
  }

  const [reordering, setReordering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const controls = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<{ id: string; direction: Direction } | null>(null);

  function register(key: string, element: HTMLButtonElement | null) {
    if (element) controls.current.set(key, element);
    else controls.current.delete(key);
  }

  // After the rows have moved, put focus back on the control the admin pressed (its row's key), or on
  // the sibling when that control is now disabled at an edge. Runs only when a move asked for it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `items` is the trigger, focus is read through the refs
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const other: Direction = target.direction === 'up' ? 'down' : 'up';
    const first = controls.current.get(`${target.id}:${target.direction}`);
    const second = controls.current.get(`${target.id}:${other}`);
    const winner = first && !first.disabled ? first : second && !second.disabled ? second : null;
    winner?.focus();
  }, [items]);

  async function move(id: string, delta: -1 | 1) {
    if (busy) return;
    const from = items.findIndex((question) => question.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= items.length) return;

    const previous = items;
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    const direction: Direction = delta < 0 ? 'up' : 'down';

    pendingFocus.current = { id, direction };
    setItems(next);
    setBusy(true);

    let result: ReorderResult;
    try {
      result = await reorderQuestionsAction(next.map((question) => question.id));
    } catch {
      result = { ok: false, code: 'failed' };
    }
    setBusy(false);

    if (result.ok) {
      setAnnouncement(
        t('admin.reorder.moved', { title: moved.title, position: to + 1, total: next.length }),
      );
      return;
    }

    // The row goes back where it was and the pressed control keeps focus.
    pendingFocus.current = { id, direction };
    setItems(previous);
    if (result.code === 'moduleOff') {
      toast.show({ tone: 'error', message: t('admin.errors.moduleOff') });
      router.refresh();
    } else if (result.code === 'forbidden') {
      toast.show({ tone: 'error', message: tAdmin('errors.forbidden') });
      router.refresh();
    } else {
      toast.show({ tone: 'error', message: t('admin.reorder.failed') });
      if (result.code === 'mismatch') router.refresh();
    }
  }

  function toggleReordering() {
    if (busy) return;
    const leaving = reordering;
    setReordering(!reordering);
    // Every write refreshes: leaving the mode re-reads the list the server now holds.
    if (leaving) router.refresh();
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {onAdd ? (
          <Button size="md" disabled={items.length >= limit} onClick={onAdd}>
            <Plus aria-hidden size={18} />
            {t('admin.actions.add')}
          </Button>
        ) : null}
        <Button variant="outline" size="md" aria-pressed={reordering} onClick={toggleReordering}>
          <ArrowUpDown aria-hidden size={18} />
          {reordering ? t('admin.actions.reorderDone') : t('admin.actions.reorder')}
        </Button>
        {onPreview ? (
          <Button variant="ghost" size="md" disabled={items.length === 0} onClick={onPreview}>
            {t('admin.preview.open')}
          </Button>
        ) : null}
      </div>
      {items.length >= limit ? (
        <p data-limit-line className="text-xs font-normal text-text-tertiary">
          {t('admin.list.limit', { max: limit })}
        </p>
      ) : null}
      <SectionTitle variant="micro">{t('admin.list.title', { count: items.length })}</SectionTitle>
      <p aria-live="polite" aria-atomic="true" data-reorder-live className="sr-only">
        {announcement}
      </p>
      <ul className="flex flex-col gap-3">
        {items.map((question, index) =>
          reordering ? (
            <ReorderRow
              key={question.id}
              question={question}
              index={index}
              total={items.length}
              busy={busy}
              register={register}
              onMove={move}
            />
          ) : (
            <QuestionRow
              key={question.id}
              question={question}
              position={index + 1}
              total={items.length}
              onOpen={onOpen}
            />
          ),
        )}
      </ul>
    </section>
  );
}
