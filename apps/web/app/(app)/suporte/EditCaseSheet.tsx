'use client';

import {
  CHAT_CASE_CATEGORIES,
  CHAT_CASE_PRIORITIES,
  type ChatCaseCategory,
  type ChatCasePriority,
} from '@rede-social/module-chat/contracts';
import { BottomSheet, Button, Chip, Input, useToast } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { caseCategoryLabel, casePriorityView, type StaffCaseHeaderView } from '@/lib/chat-view';
import { editCaseAction } from './actions';

/**
 * The edit sheet of the team's case bar (UI-D-827, D-811, D-812, CASE-10) [designed]: a `BottomSheet` "Editar
 * chamado #N" (the centred card from `md`) where the team corrects the category, the subject and the priority.
 *
 * **The sheet exists only when the server listed `edit`** (never on a `Fechado` case): the thread pane
 * mounts it from `actions[]`, and the PATCH re-enforces it.
 *
 * - The five category chips are the opener's chips (`aria-pressed`, one always selected, the current one
 *   active) in a group named by their caption.
 * - The subject is the shipped `Input` (16px, `maxLength` 80) prefilled with the TYPED subject only: a case
 *   that shows the first-message fallback starts empty, so saving never freezes the fallback as a typed
 *   subject. The helper line says what a blank one does.
 * - The three priority chips "Baixa", "Normal" and "Alta" are a labelled group, one always selected.
 *
 * **What it sends** is ONLY the fields that changed, plus the state the sheet opened on (a case that moved
 * while it was open is refused as stale). A blanked subject is sent as `null`; a field the admin did not touch
 * is absent; there is no state and no owner key, so an edit can never be a transition (T-12.4-90). The
 * server's strict contract re-validates it all.
 *
 * Success toasts "Alterações salvas." and closes; a stale or failed answer toasts as the bar does and KEEPS
 * every draft value. The body is mounted only while the sheet is open, so each opening starts from the case.
 * Every word is the `chat` catalog's.
 */

export interface EditCaseSheetProps {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  /** The finished staff header: the values the sheet opens on and the state it expects. */
  header: StaffCaseHeaderView;
  /** The fresh finished header the server answered after the save. */
  onHeader: (header: StaffCaseHeaderView) => void;
  /** The screen was behind the case: re-read it. */
  onStale: () => void;
}

/** The subject's cap, the same 80 the API enforces (`CHAT_SUBJECT_MAX`, A-UI-19). */
const SUBJECT_MAX_LENGTH = 80;

/** The fields the PATCH accepts: only the changed ones are ever present. */
interface EditChanges {
  category?: ChatCaseCategory;
  subject?: string | null;
  priority?: ChatCasePriority;
}

function EditBody({
  onClose,
  conversationId,
  header,
  onHeader,
  onStale,
}: Omit<EditCaseSheetProps, 'open'>) {
  const t = useTranslations('chat');
  const { show } = useToast();
  const uid = useId();
  const categoryCaption = `${uid}-category`;
  const priorityCaption = `${uid}-priority`;
  const helpId = `${uid}-help`;
  const [pending, setPending] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  /** What the sheet opened on: the draft's baseline and the state a save expects (UI-D-830). */
  const [initial] = useState(() => ({
    state: header.state.state,
    category: header.category,
    priority: header.priority,
    subject: header.typedSubject ?? '',
  }));
  const [category, setCategory] = useState(initial.category);
  const [priority, setPriority] = useState(initial.priority);
  const [subject, setSubject] = useState(initial.subject);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const trimmed = subject.trim();
  const changes: EditChanges = {};
  if (category !== initial.category) changes.category = category;
  if (trimmed !== initial.subject.trim()) changes.subject = trimmed === '' ? null : trimmed;
  if (priority !== initial.priority) changes.priority = priority;
  const changed = Object.keys(changes).length > 0;

  const save = async () => {
    if (!changed || busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    try {
      const result = await editCaseAction(conversationId, {
        expectedState: initial.state,
        ...changes,
      });
      if (result.ok) {
        onHeader(result.header);
        show({ tone: 'success', message: t('toast.saved') });
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        data-edit-scroll
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-2"
      >
        <div className="flex flex-col gap-2">
          <p id={categoryCaption} className="text-xs font-bold text-text-secondary">
            {t('sheet.edit.category')}
          </p>
          <fieldset aria-labelledby={categoryCaption} className="flex min-w-0 flex-wrap gap-2">
            {CHAT_CASE_CATEGORIES.map((value) => (
              <Chip
                key={value}
                active={value === category}
                disabled={pending}
                onClick={() => setCategory(value)}
              >
                {caseCategoryLabel(value, t)}
              </Chip>
            ))}
          </fieldset>
        </div>

        <div className="flex flex-col gap-1">
          <Input
            id={`${uid}-subject`}
            label={t('sheet.edit.subject')}
            placeholder={t('open.subject.placeholder')}
            maxLength={SUBJECT_MAX_LENGTH}
            autoComplete="off"
            aria-describedby={helpId}
            disabled={pending}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
          <p id={helpId} className="text-xs font-normal text-text-tertiary">
            {t('sheet.edit.subjectHelp')}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <p id={priorityCaption} className="text-xs font-bold text-text-secondary">
            {t('sheet.edit.priority')}
          </p>
          <fieldset aria-labelledby={priorityCaption} className="flex min-w-0 flex-wrap gap-2">
            {CHAT_CASE_PRIORITIES.map((value) => (
              <Chip
                key={value}
                active={value === priority}
                disabled={pending}
                onClick={() => setPriority(value)}
              >
                {casePriorityView(value, t).label}
              </Chip>
            ))}
          </fieldset>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-divider px-4 py-3">
        <Button
          variant="brand"
          fullWidth
          loading={pending}
          disabled={!changed}
          onClick={() => void save()}
        >
          {t('sheet.edit.confirm')}
        </Button>
        <Button variant="ghost" fullWidth disabled={pending} onClick={onClose}>
          {t('dialog.cancel')}
        </Button>
      </div>
    </div>
  );
}

export function EditCaseSheet({ open, ...body }: EditCaseSheetProps) {
  const t = useTranslations('chat');
  return (
    <BottomSheet
      open={open}
      onClose={body.onClose}
      title={t('sheet.edit.title', { number: String(body.header.number) })}
      desktopCard
      scroll="content"
    >
      <EditBody {...body} />
    </BottomSheet>
  );
}
