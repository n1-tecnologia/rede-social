'use client';

import {
  type AdminBranch,
  type AdminQuestion,
  type ArchivedQuestion,
  PROFILE_FORM_LIMITS,
} from '@rede-social/contracts/profile-form';
import { Button, Card, ConfirmDialog, EmptyState, StatusPill, useToast } from '@rede-social/ui';
import { Archive, ArchiveRestore, Info, Split } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { buildBranchTree } from '@/lib/profile-form/branch-tree';
import { describeBranch } from '@/lib/profile-form/describe-branch';
import { typeNameKey } from '@/lib/profile-form/type-key';
import {
  type ImpactActionResult,
  type ReactivateBranchResult,
  type ReactivateResult,
  reactivateBranchAction,
  reactivateQuestionAction,
  readImpactAction,
} from './actions';
import { useBranchLabeler } from './BranchBlock';
import { type ArchivedGroup, archivedLayout, conditionOptionsText } from './editor-state';
import { ImpactDialog } from './ImpactDialog';

export interface ArchivedListProps {
  /** The archived questions, newest archive first (the API's order). Aggregates only: counts, no answers. */
  questions: ArchivedQuestion[];
  /**
   * 12.2-18 (D-653): every branch of the form, active and archived (the archived read's), so an archived one is
   * drawn as a group and a question can say which branch it was in. Absent reads as none.
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

const NO_BRANCHES: AdminBranch[] = [];
const NO_QUESTIONS: AdminQuestion[] = [];

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
  | { kind: 'impact'; question: ArchivedQuestion; members: number }
  | { kind: 'block'; branch: AdminBranch; members: number };

/**
 * The Arquivadas tab (12-15, D-585, D-588, UI-D-576, UI-D-578; 12.2-18, D-653, UI-D-674; PFORM-03, PFORM-57): the
 * note, then the archived entries newest first. A branch archived by "Arquivar ramo" is a GROUP: a header (its
 * label, "Arquivado em {data} · N perguntas", "Reativar ramo") above the archived rows it took with it, in the
 * order they had, with the branches archived inside it nested after those rows. A question archived on its own
 * keeps its card, says which branch it was in, and comes back to that branch. A row is NOT an editor opener: an
 * archived question is read-only, and to change it you reactivate it first.
 *
 * **Reativar** (a question), in order, and a write only at the end:
 *  1. a question that sits in a branch that is still archived is refused with the one sentence naming the branch;
 *  2. at the active limit the dialog is not opened and the toast says the limit sentence;
 *  3. an OPTIONAL question opens the brand "Reativar pergunta?" confirmation;
 *  4. a REQUIRED one first READS the impact. If the read fails, the toast says so and NOTHING is written
 *     (T-12-34, UI-D-576); with 0 members it reactivates directly; otherwise it opens the impact dialog.
 * **Reativar ramo** follows the same contract over the whole block: an archived opener is refused with the one
 * sentence naming it; the block counts against the limit; the impact is read (`reactivate_branch`), a failed read
 * writes nothing, 0 members writes directly, otherwise the impact dialog's confirm writes. The page refreshes and
 * the toast says "Pergunta reativada." A 403 or a module turned off ends in a refresh into the page's `notFound()`.
 *
 * The component fetches nothing itself and shows aggregate counts only (PFORM-23). Branch names and labels are
 * admin-typed and drawn as React text (T-12.2-15); only ids reach the server.
 */
export function ArchivedList({
  questions,
  branches = NO_BRANCHES,
  activeCount,
  limit,
  activeQuestions = NO_QUESTIONS,
  timeZone,
}: ArchivedListProps) {
  const t = useTranslations('profileForm');
  const tAdmin = useTranslations('admin');
  const router = useRouter();
  const toast = useToast();

  const [checking, setChecking] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  // `pending` keeps the entry for the dialog's exit animation; `open` is what the dialog follows.
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState(false);

  // The tree only names things: the questions it can title (active and archived) and the branches it can label.
  const tree = useMemo(
    () => buildBranchTree({ steps: [], questions: [...activeQuestions, ...questions], branches }),
    [activeQuestions, questions, branches],
  );
  const labelOf = useBranchLabeler(tree);
  const layout = useMemo(
    () => archivedLayout({ questions, branches, active: activeQuestions }),
    [questions, branches, activeQuestions],
  );

  const limitSentence = t('admin.list.limit', { max: limit });

  /** The refusals the API can answer to any call: a toast, then a refresh into `notFound()`. */
  function refuse(code: 'forbidden' | 'moduleOff'): void {
    toast.show({
      tone: 'error',
      message: code === 'moduleOff' ? t('admin.errors.moduleOff') : tAdmin('errors.forbidden'),
    });
    router.refresh();
  }

  function failed(): void {
    toast.show({ tone: 'error', message: t('admin.archived.failed') });
  }

  /** The title of a question by id, from the active list and the archived one the page holds. */
  function titleOf(id: string | null | undefined): string | null {
    if (id === null || id === undefined) return null;
    return tree.questionById.get(id)?.title ?? null;
  }

  /** The label of a branch by id (its name, else its condition sentence), or `null` when the page does not know it. */
  function branchLabel(id: string | null | undefined): string | null {
    if (id === null || id === undefined) return null;
    const branch = tree.branchById.get(id);
    return branch === undefined ? null : labelOf(branch).label;
  }

  /**
   * "Só conta quem vê esta pergunta: quem respondeu “{opener}” com {options}." for a reactivated question that
   * returns to an ACTIVE branch (UI-D-649): the count is of who sees it, and the dialog says so.
   */
  function branchNoteOf(question: ArchivedQuestion): string | undefined {
    const branch = question.branchId ? tree.branchById.get(question.branchId) : undefined;
    if (branch === undefined || branch.archivedAt !== null) return undefined;
    const described = describeBranch(branch, tree.questionById);
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
      // The opener left the form between the read and the tap (a race): the one sentence names it.
      const opener = titleOf(result.openerId);
      if (opener === null) failed();
      else
        toast.show({
          tone: 'error',
          message: t('admin.archived.openerArchived', { title: question.title, opener }),
        });
      router.refresh();
    } else if (result.code === 'branchArchived') {
      // Its branch is archived (a race, or the page was stale): the one sentence names the branch.
      const label = branchLabel(result.branchId ?? question.branchId);
      if (label === null) failed();
      else
        toast.show({
          tone: 'error',
          message: t('admin.archived.branch.branchArchived', { title: question.title, label }),
        });
      router.refresh();
    } else {
      failed();
    }
  }

  async function onReactivate(question: ArchivedQuestion): Promise<void> {
    if (checking !== null || writing) return;
    // A question that sits in a branch that is still archived cannot come back before it: one sentence, one
    // dependency, so a toast and no dialog (D-653, UI-D-674).
    const inside = question.branchId ? tree.branchById.get(question.branchId) : undefined;
    if (inside !== undefined && inside.archivedAt !== null) {
      toast.show({
        tone: 'error',
        message: t('admin.archived.branch.branchArchived', {
          title: question.title,
          label: labelOf(inside).label,
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

  async function reactivateBlock(branch: AdminBranch): Promise<void> {
    setWriting(true);
    let result: ReactivateBranchResult;
    try {
      result = await reactivateBranchAction(branch.id);
    } catch {
      result = { ok: false, code: 'failed' };
    } finally {
      setWriting(false);
    }
    if (result.ok) {
      toast.show({ tone: 'success', message: t('admin.archived.done') });
      router.refresh();
      return;
    }
    switch (result.code) {
      case 'limit':
        toast.show({ tone: 'error', message: limitSentence });
        router.refresh();
        return;
      case 'branchLimit':
        toast.show({
          tone: 'error',
          message: t('admin.branches.limit', { max: PROFILE_FORM_LIMITS.branches }),
        });
        router.refresh();
        return;
      case 'forbidden':
      case 'moduleOff':
        refuse(result.code);
        return;
      case 'openerArchived': {
        // The opener left the form between the read and the tap (a race): the one sentence names it.
        const opener = titleOf(result.openerId);
        if (opener === null) failed();
        else
          toast.show({
            tone: 'error',
            message: t('admin.archived.branch.openerArchived', {
              label: labelOf(branch).label,
              opener,
            }),
          });
        router.refresh();
        return;
      }
      case 'conflict':
      case 'gone':
        failed();
        router.refresh();
        return;
      default:
        failed();
    }
  }

  async function onReactivateBlock(group: ArchivedGroup): Promise<void> {
    if (checking !== null || writing) return;
    const { branch } = group;
    // The opener itself is archived: it must come back first, and the sentence says which one.
    const opener = questions.find((candidate) => candidate.id === branch.openerQuestionId);
    if (opener !== undefined) {
      toast.show({
        tone: 'error',
        message: t('admin.archived.branch.openerArchived', {
          label: labelOf(branch).label,
          opener: opener.title,
        }),
      });
      return;
    }
    // The whole block counts against the limit; at the limit no dialog and no request.
    if (activeCount + group.count > limit) {
      toast.show({ tone: 'error', message: limitSentence });
      return;
    }

    setChecking(branch.id);
    let impact: ImpactActionResult;
    try {
      impact = await readImpactAction({ change: 'reactivate_branch', branchId: branch.id });
    } catch {
      impact = { ok: false, code: 'failed' };
    } finally {
      setChecking(null);
    }
    if (!impact.ok) {
      if (impact.code === 'forbidden' || impact.code === 'moduleOff') refuse(impact.code);
      else toast.show({ tone: 'error', message: t('admin.impact.previewFailed') });
      return;
    }
    if (impact.members === 0) {
      await reactivateBlock(branch);
      return;
    }
    setPending({ kind: 'block', branch, members: impact.members });
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

  /** The card of one archived question: type, when, how many answers it keeps and whether it was required. */
  function questionCard(question: ArchivedQuestion, standalone: boolean) {
    const was = standalone ? branchLabel(question.branchId) : null;
    return (
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
          {was !== null ? (
            <p className="break-words text-xs font-normal text-text-tertiary">
              {t('admin.archived.branch.wasIn', { label: was })}
            </p>
          ) : null}
          <p
            className={
              question.required
                ? 'text-xs font-bold text-text'
                : 'text-xs font-normal text-text-tertiary'
            }
          >
            {question.required ? t('admin.archived.wasRequired') : t('admin.archived.wasOptional')}
          </p>
        </div>
        {standalone ? (
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
        ) : null}
      </Card>
    );
  }

  /** A group: its header, then the rows it took and the groups nested inside it. Only a top-level one reactivates. */
  function groupView(group: ArchivedGroup, topLevel: boolean) {
    const label = labelOf(group.branch).label;
    return (
      <li
        key={group.branch.id}
        data-archived-group={group.branch.id}
        className="flex flex-col gap-3"
      >
        <Card data-archived-header className="flex flex-col gap-2 p-4">
          <div className="flex items-start gap-2">
            <Split aria-hidden size={14} className="mt-[3px] shrink-0 text-text-tertiary" />
            <div className="flex min-w-0 flex-1 flex-col">
              <h3 className="line-clamp-2 break-words text-sm font-bold text-text">{label}</h3>
              <p className="text-xs font-normal text-text-secondary">
                {t('admin.archived.branch.meta', {
                  date: archiveDate(group.branch.archivedAt ?? '', timeZone),
                  count: group.count,
                })}
              </p>
            </div>
            {topLevel ? (
              <Button
                variant="ghost"
                size="sm"
                hitArea
                className="shrink-0"
                loading={checking === group.branch.id}
                aria-label={t('admin.archived.branch.reactivateLabel', { label })}
                onClick={() => onReactivateBlock(group)}
              >
                <ArchiveRestore aria-hidden size={16} />
                {t('admin.archived.branch.reactivate')}
              </Button>
            ) : null}
          </div>
        </Card>
        {group.rows.length > 0 || group.children.length > 0 ? (
          <ul
            data-archived-rows
            className="ml-1 flex flex-col gap-3 border-l-2 border-border-secondary pl-3"
          >
            {group.rows.map((row) => (
              <li key={row.id}>{questionCard(row, false)}</li>
            ))}
            {group.children.map((child) => groupView(child, false))}
          </ul>
        ) : null}
      </li>
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
      <ul data-archived-list className="flex flex-col gap-3">
        {layout.map((item) =>
          item.kind === 'group' ? (
            groupView(item.group, true)
          ) : (
            <li key={item.question.id}>{questionCard(item.question, true)}</li>
          ),
        )}
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
          if (pending?.kind === 'plain') await reactivate(pending.question);
        }}
        onClose={() => setOpen(false)}
      />
      <ImpactDialog
        open={open && (pending?.kind === 'impact' || pending?.kind === 'block')}
        kind={pending?.kind === 'block' ? 'reactivateBranch' : 'reactivate'}
        members={pending?.kind === 'impact' || pending?.kind === 'block' ? pending.members : 0}
        branchNote={pending?.kind === 'impact' ? branchNoteOf(pending.question) : undefined}
        onConfirm={async () => {
          if (pending?.kind === 'impact') await reactivate(pending.question);
          else if (pending?.kind === 'block') await reactivateBlock(pending.branch);
        }}
        onClose={() => setOpen(false)}
      />
    </section>
  );
}
