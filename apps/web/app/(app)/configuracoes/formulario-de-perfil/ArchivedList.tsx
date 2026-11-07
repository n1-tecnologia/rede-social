'use client';

import type {
  AdminBranch,
  AdminQuestion,
  ArchivedQuestion,
} from '@rede-social/contracts/profile-form';
import { Button, Card, ConfirmDialog, EmptyState, StatusPill, useToast } from '@rede-social/ui';
import { Archive, ArchiveRestore, Info } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { describeCondition } from '@/lib/profile-form/describe-condition';
import { typeNameKey } from '@/lib/profile-form/type-key';
import {
  type ImpactActionResult,
  type ReactivateResult,
  reactivateQuestionAction,
  readImpactAction,
} from './actions';
import { conditionOptionsText, openerIndex } from './editor-state';
import { ImpactDialog } from './ImpactDialog';

export interface ArchivedListProps {
  /** The archived questions, newest archive first (the API's order). Aggregates only: counts, no answers. */
  questions: ArchivedQuestion[];
  /**
   * 12.2-18 (D-653): every branch of the form, active and archived (the archived read's), so a branch can be named
   * and an archived one drawn as a group. RED stub: accepted and not used yet.
   */
  branches?: AdminBranch[];
  /** How many questions are active now, and the most a tenant may have: the limit check needs no write. */
  activeCount: number;
  limit: number;
  /**
   * The ACTIVE questions (12.1-17): the openers a reactivated question may name. Optional; the page passes what its
   * read of the active list returned. Without it only an opener that is itself archived can be named.
   */
  activeQuestions?: AdminQuestion[];
  /** The tenant's IANA time zone: the archive date is its calendar day, `dd/MM/yyyy`. */
  timeZone: string;
}

/** `dd/MM/yyyy` in the tenant's time zone; an unreadable instant is shown as it came (never a crash). */
function archiveDate(iso: string, timeZone: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(instant);
  } catch {
    return iso;
  }
}

type Pending =
  | { kind: 'plain'; question: ArchivedQuestion }
  | { kind: 'impact'; question: ArchivedQuestion; members: number };

/**
 * The Arquivadas tab (12-15, D-585, D-588, UI-D-576, UI-D-578; PFORM-03): the note, then one `Card` per
 * archived question with its type, "Arquivada em {data} · {n} respostas guardadas", whether it was
 * required, and "Reativar". A row is NOT an editor opener: an archived question is read-only, and to change
 * it you reactivate it first.
 *
 * **Reativar**, in order, and a write only at the end:
 *  1. at the active limit the dialog is not opened and the toast says the limit sentence;
 *  2. an OPTIONAL question opens the brand "Reativar pergunta?" confirmation;
 *  3. a REQUIRED one first READS the impact. If the read fails, the toast says so and NOTHING is written
 *     (T-12-34, UI-D-576); with 0 members it reactivates directly; otherwise it opens the impact dialog.
 * The question returns at the END of the list; the page refreshes; the toast says "Pergunta reativada."
 * A 403 or a module turned off ends in a refresh into the page's `notFound()`.
 *
 * The component fetches nothing itself and shows aggregate counts only (PFORM-23).
 */
export function ArchivedList({
  questions,
  activeCount,
  limit,
  activeQuestions,
  timeZone,
}: ArchivedListProps) {
  const t = useTranslations('profileForm');
  const tAdmin = useTranslations('admin');
  const router = useRouter();
  const toast = useToast();

  const [checking, setChecking] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  // `pending` keeps the question for the dialog's exit animation; `open` is what the dialog follows.
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState(false);

  const limitSentence = t('admin.list.limit', { max: limit });

  /** The refusals the API can answer to either call: a toast, then a refresh into `notFound()`. */
  function refuse(code: 'forbidden' | 'moduleOff'): void {
    toast.show({
      tone: 'error',
      message: code === 'moduleOff' ? t('admin.errors.moduleOff') : tAdmin('errors.forbidden'),
    });
    router.refresh();
  }

  /** The title of a question by id, from the archived list and the active one the page holds. */
  function openerTitle(id: string | null): string | null {
    if (id === null) return null;
    return (
      questions.find((candidate) => candidate.id === id)?.title ??
      activeQuestions?.find((candidate) => candidate.id === id)?.title ??
      null
    );
  }

  /**
   * "Só conta quem vê esta pergunta: quem respondeu “{opener}” com {options}." for a reactivated CONDITIONAL
   * question (12.1-17, UI-D-649): its opener is active here (an archived one would have refused already).
   */
  function conditionNote(question: ArchivedQuestion): string | undefined {
    if (!question.condition || !activeQuestions) return undefined;
    const described = describeCondition(question.condition, openerIndex(activeQuestions));
    if (described === null) return undefined;
    const options = conditionOptionsText(described, {
      yes: t('member.controls.yes'),
      no: t('member.controls.no'),
    });
    if (options === '') return undefined;
    return t('admin.impact.conditionalNote', { opener: described.openerTitle, options });
  }

  async function reactivate(question: ArchivedQuestion): Promise<void> {
    setWriting(true);
    let result: ReactivateResult;
    try {
      result = await reactivateQuestionAction(question.id);
    } catch {
      result = { ok: false, code: 'failed' };
    } finally {
      setWriting(false);
    }
    if (result.ok) {
      toast.show({ tone: 'success', message: t('admin.archived.done') });
      router.refresh();
    } else if (result.code === 'limit') {
      toast.show({ tone: 'error', message: limitSentence });
      router.refresh();
    } else if (result.code === 'forbidden' || result.code === 'moduleOff') {
      refuse(result.code);
    } else if (result.code === 'conditionInvalid') {
      // The opener left the form between the read and the tap (a race): the same sentence as the client's check.
      const opener = openerTitle(result.openerId ?? question.condition?.questionId ?? null);
      toast.show({
        tone: 'error',
        message:
          opener === null
            ? t('admin.archived.failed')
            : t('admin.archived.openerArchived', { title: question.title, opener }),
      });
      router.refresh();
    } else {
      toast.show({ tone: 'error', message: t('admin.archived.failed') });
    }
  }

  async function onReactivate(question: ArchivedQuestion): Promise<void> {
    if (checking !== null || writing) return;
    // A shown question whose opener is still archived cannot come back before it: one sentence, one dependency,
    // so a toast and no dialog (D-632, UI-D-651).
    const opener = question.condition
      ? questions.find((candidate) => candidate.id === question.condition?.questionId)
      : undefined;
    if (opener) {
      toast.show({
        tone: 'error',
        message: t('admin.archived.openerArchived', {
          title: question.title,
          opener: opener.title,
        }),
      });
      return;
    }
    // At the limit the dialog is not even opened: the answer is the sentence, with no request.
    if (activeCount >= limit) {
      toast.show({ tone: 'error', message: limitSentence });
      return;
    }
    if (!question.required) {
      setPending({ kind: 'plain', question });
      setOpen(true);
      return;
    }

    setChecking(question.id);
    let impact: ImpactActionResult;
    try {
      impact = await readImpactAction({ change: 'reactivate', questionId: question.id });
    } catch {
      impact = { ok: false, code: 'failed' };
    } finally {
      setChecking(null);
    }
    if (!impact.ok) {
      // No count, no write: the change is never applied on a guess of how many members it holds out.
      if (impact.code === 'forbidden' || impact.code === 'moduleOff') refuse(impact.code);
      else toast.show({ tone: 'error', message: t('admin.impact.previewFailed') });
      return;
    }
    if (impact.members === 0) {
      await reactivate(question);
      return;
    }
    setPending({ kind: 'impact', question, members: impact.members });
    setOpen(true);
  }

  if (questions.length === 0) {
    return (
      <EmptyState
        variant="card"
        icon={Archive}
        title={t('admin.archived.empty.title')}
        body={t('admin.archived.empty.body')}
      />
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-xl bg-bg-tertiary px-3 py-3 text-xs font-normal text-text-secondary">
        <Info aria-hidden size={16} className="mt-px shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="break-words">{t('admin.archived.noteArchived')}</p>
          <p className="break-words">{t('admin.archived.noteReactivate')}</p>
        </div>
      </div>
      <ul className="flex flex-col gap-3">
        {questions.map((question) => (
          <li key={question.id}>
            <Card className="flex flex-col gap-3 p-4">
              <div className="flex min-w-0 flex-col gap-2">
                <h3 className="break-words text-sm font-bold text-text">{question.title}</h3>
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone="neutral">{t(typeNameKey(question.type))}</StatusPill>
                </div>
                <p className="break-words text-xs font-normal text-text-secondary">
                  {t('admin.archived.meta', {
                    date: archiveDate(question.archivedAt, timeZone),
                    count: question.answerCount,
                  })}
                </p>
                <p
                  className={
                    question.required
                      ? 'text-xs font-bold text-text'
                      : 'text-xs font-normal text-text-tertiary'
                  }
                >
                  {question.required
                    ? t('admin.archived.wasRequired')
                    : t('admin.archived.wasOptional')}
                </p>
              </div>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  hitArea
                  loading={checking === question.id}
                  aria-label={t('admin.archived.reactivateLabel', { title: question.title })}
                  onClick={() => onReactivate(question)}
                >
                  <ArchiveRestore aria-hidden size={16} />
                  {t('admin.archived.reactivate')}
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={open && pending?.kind === 'plain'}
        tone="brand"
        icon={ArchiveRestore}
        title={t('admin.archived.confirmTitle')}
        body={t('admin.archived.confirmBody')}
        confirmLabel={t('admin.archived.confirm')}
        cancelLabel={t('admin.impact.cancel')}
        onConfirm={async () => {
          if (pending) await reactivate(pending.question);
        }}
        onClose={() => setOpen(false)}
      />
      <ImpactDialog
        open={open && pending?.kind === 'impact'}
        kind="reactivate"
        members={pending?.kind === 'impact' ? pending.members : 0}
        branchNote={pending?.kind === 'impact' ? conditionNote(pending.question) : undefined}
        onConfirm={async () => {
          if (pending) await reactivate(pending.question);
        }}
        onClose={() => setOpen(false)}
      />
    </section>
  );
}
