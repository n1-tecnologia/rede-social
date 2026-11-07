'use client';

import {
  type AdminBranch,
  type AdminQuestion,
  type AdminStep,
  codePoints,
  PROFILE_FORM_LIMITS,
} from '@rede-social/contracts/profile-form';
import {
  BottomSheet,
  Button,
  ConfirmDialog,
  Input,
  SectionTitle,
  Textarea,
  useMediaQuery,
  useToast,
} from '@rede-social/ui';
import { Archive, ChevronRight, CircleAlert, Info, Lock, Split, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useMemo, useRef, useState } from 'react';
import {
  branchLevel,
  buildBranchTree,
  membersOf,
  orderedBranchesOf,
  usableBranch,
} from '@/lib/profile-form/branch-tree';
import { describeBranch } from '@/lib/profile-form/describe-branch';
import { isChoiceType } from '@/lib/profile-form/question-types';
import { ArchiveDialog, type ArchiveKind } from './ArchiveDialog';
import {
  archiveQuestionAction,
  createQuestionAction,
  deleteQuestionAction,
  type ImpactActionResult,
  type RemoveResult,
  readImpactAction,
  replaceQuestionAction,
  type SaveQuestionResult,
  updateQuestionAction,
} from './actions';
import { useBranchLabeler } from './BranchBlock';
import { DependentsAlert } from './DependentsAlert';
import {
  blankDraft,
  branchOptionsFor,
  canSave,
  changeType,
  checkStepMove,
  conditionOptionsText,
  type DependentsRefusal,
  type DraftErrors,
  dependentBranchesOf,
  draftFromQuestion,
  type EditorMode,
  groupsFromServer,
  hasChanges,
  hasErrors,
  isDirty,
  isOpenerType,
  lockFlags,
  optionUsage,
  privacyTitlesIf,
  privateOpenerOf,
  type QuestionDraft,
  type Reopening,
  refusalOfUpdate,
  reopeningOf,
  replaceDraftFrom,
  serverFieldError,
  serverLimitsError,
  serverOptionsErrors,
  titlesAsDependents,
  toCreateBody,
  toUpdateBody,
  validateDraft,
} from './editor-state';
import { ImpactDialog } from './ImpactDialog';
import { LimitsFields } from './LimitsFields';
import { OptionsEditor } from './OptionsEditor';
import { SheetSelect } from './SheetSelect';
import { TypePicker } from './TypePicker';
import { VisibilitySwitches } from './VisibilitySwitches';

export interface QuestionEditorSheetProps {
  open: boolean;
  mode: EditorMode;
  /** The question being edited (edit) or replaced (replace); `null` for a new one. */
  question?: AdminQuestion | null;
  /**
   * The step a NEW question lands in (12.1-16: the "Adicionar pergunta" of a step well). Absent means the last
   * step, which the server picks (D-629). Ignored for an edit and a replace, which keep their step.
   */
  stepId?: string;
  /**
   * The ACTIVE questions the builder holds (12.1-17): the tree the "Ramo" field is judged against. Absent means
   * the caller does not know them, and then the sheet shows no "Onde e quando aparece" block at all.
   */
  questions?: AdminQuestion[];
  /** The tenant's steps in order (12.1-17): the "Etapa" field shows with two or more. */
  steps?: AdminStep[];
  /**
   * The tenant's branches (12.2-16, D-640): the "Ramo" field lists the eligible ones and shows only when there is
   * at least one. Absent reads as none.
   */
  branches?: AdminBranch[];
  /** The branch a NEW question starts in (the Lista footer "Adicionar pergunta ao ramo", D-651). */
  initialBranchId?: string;
  /**
   * "Criar ramo" (12.2-16, D-651): the host closes this sheet and opens the branch sheet for this question. Absent
   * means the host cannot create a branch, and the whole block "Ramos desta pergunta" is not offered.
   */
  onCreateBranch?: (opener: AdminQuestion) => void;
  /**
   * A row of "Ramos desta pergunta": the host closes this sheet and opens that branch (plan 17). Absent means the
   * rows are not drawn, so no row exists that does nothing.
   */
  onOpenBranch?: (branch: AdminBranch) => void;
  /** The tenant's display name, the `{tenant}` of the LGPD notice. */
  tenantName: string;
  /** The most active questions a tenant may have: the limit sentence when a create hits it. */
  limit: number;
  /** MUST be stable (`useCallback`): the shipped focus trap re-arms when it changes. */
  onClose: () => void;
  /** "Criar nova pergunta e arquivar esta": the host re-opens the sheet in replace mode for this question. */
  onReplace?: (question: AdminQuestion) => void;
}

const TITLE_ID = 'pf-title';
const HELP_ID = 'pf-help';
const STEP_ID = 'pf-step';
const BRANCH_ID = 'pf-branch';
const NO_STEPS: AdminStep[] = [];
const NO_BRANCHES: AdminBranch[] = [];
const NO_QUESTIONS: AdminQuestion[] = [];

/** The refusals of a move into or out of a branch that land under the "Ramo" field (D-641, D-644, D-646). */
type BranchRefusal =
  | 'condition_order'
  | 'branch_depth'
  | 'condition_locked'
  | 'public_under_private';
const BRANCH_REFUSALS: ReadonlySet<string> = new Set<BranchRefusal>([
  'condition_order',
  'branch_depth',
  'condition_locked',
  'public_under_private',
]);

/**
 * The question editor (12-16, D-585, D-590, D-593, D-594, UI-D-569..UI-D-573; PFORM-02, PFORM-22): ONE
 * `BottomSheet` (the centred card from `md`) with three modes: create, edit and replace. The order of the
 * sheet is the order of the contract: the LGPD notice first (create and replace only; never dismissible, no
 * purpose field, no blocking of titles or types), the replace banner, the type (nothing below the grid
 * until a tile is chosen), the title and the help text with live counters, the type-specific block, the two
 * switches, "Salvar pergunta" and, in edit mode, "Arquivar pergunta" or "Excluir pergunta".
 *
 * **Locks (D-587, D-593).** For a stored question with answers the sheet only explains what the server
 * refuses: a read-only type row, locked options, "Outro" locked on, widen-only limits, a private question
 * that cannot become public. Each shows its reason and its way out (one tap to "Criar nova pergunta e
 * arquivar esta"). A race the sheet could not see comes back as a coded 409 and is shown in the sheet.
 *
 * **It cannot be closed while it saves**, and a close with unsaved edits asks first (the dirty guard):
 * backdrop, handle and Escape all reach `requestClose`. The fields are one disabled `fieldset` while the
 * save runs. The sheet remounts per opening (the host keys it), so each opening starts from its source.
 *
 * **The server decides.** A refusal lands under its field, a transport failure toasts and KEEPS the draft,
 * the limit and a lost permission follow the builder's other screens. React text only: a title, a help
 * text and an option label are admin-typed and shown to every member (T-12-35).
 */
export function QuestionEditorSheet({
  open,
  mode,
  question,
  stepId,
  questions,
  steps = NO_STEPS,
  branches = NO_BRANCHES,
  initialBranchId,
  onCreateBranch,
  onOpenBranch,
  tenantName,
  limit,
  onClose,
  onReplace,
}: QuestionEditorSheetProps) {
  const t = useTranslations('profileForm.admin');
  const te = useTranslations('profileForm.admin.editor');
  const tc = useTranslations('profileForm.member.controls');
  const tAdmin = useTranslations('admin');
  const router = useRouter();
  const toast = useToast();
  const desktop = useMediaQuery('(min-width: 768px)');

  const [initial] = useState<QuestionDraft>(() => {
    if (mode === 'edit' && question) return draftFromQuestion(question);
    if (mode === 'replace' && question) return replaceDraftFrom(question);
    // A new question lands in the step the sheet was opened from, or in the last one (D-629).
    return blankDraft(stepId ?? steps[steps.length - 1]?.id ?? null, initialBranchId ?? null);
  });
  const stored = mode === 'edit' ? (question ?? null) : null;
  const locks = lockFlags(stored);
  const [draft, setDraft] = useState<QuestionDraft>(initial);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [saving, setSaving] = useState(false);
  const [gridOpen, setGridOpen] = useState(draft.type === null);
  const [discardOpen, setDiscardOpen] = useState(false);
  // What a confirmed discard does: close the sheet, leave for the replace flow, or hand over to a branch sheet.
  const [afterDiscard, setAfterDiscard] = useState<'close' | 'replace' | 'branch'>('close');
  const handOver = useRef<(() => void) | null>(null);
  // The 409 of the truth: another admin changed the question, or answers arrived and a lock now applies.
  const [conflict, setConflict] = useState(false);
  // The archive or delete confirmation; `removeKind` is kept for the dialog's exit animation.
  const [removeKind, setRemoveKind] = useState<ArchiveKind>('archive');
  const [removeOpen, setRemoveOpen] = useState(false);
  // `impact` keeps the figure for the dialog's exit animation; `impactOpen` is what the dialog follows.
  const [impact, setImpact] = useState<{ members: number; kind: Reopening['kind'] } | null>(null);
  const [impactOpen, setImpactOpen] = useState(false);
  // "Onde e quando aparece": the step field's refusal (D-623) and the refusal of a move into a branch (D-641..D-646).
  const [stepRefusal, setStepRefusal] = useState<ReturnType<typeof checkStepMove> | null>(null);
  const [branchRefusal, setBranchRefusal] = useState<BranchRefusal | null>(null);
  // The opener edits the question refuses (12.1-17, D-632): archive, delete, retype, remove an option. The alert
  // renders from the list the page holds (no round trip) or from the server's 409 list (a race).
  const [refusal, setRefusal] = useState<DependentsRefusal | null>(null);

  const activeQuestions = questions ?? NO_QUESTIONS;
  const showStepField = steps.length >= 2;

  // The tree the "Ramo" field is judged against (D-641, D-644): built from the one read the page holds.
  const tree = useMemo(
    () => buildBranchTree({ steps, questions: activeQuestions, branches }),
    [steps, activeQuestions, branches],
  );
  const labelOf = useBranchLabeler(tree);
  // The ACTIVE branches that hang on this question (D-646): they block its archive, delete, retype and option
  // removal, and the refusal lists them with the titles of their questions (UI-D-673).
  const textOf = (branch: AdminBranch) => labelOf(branch).label;
  const groups = stored ? dependentBranchesOf(tree, stored.id, textOf) : [];
  const usedCounts = stored ? optionUsage(tree, stored.id) : undefined;
  // WR-06 (PFORM-53, UI-D-675): a question whose branch chain holds an opener that does not show on the profile
  // cannot show on it either; the nearest such opener is the reason the switch gives.
  const privateOpener = privateOpenerOf(tree, draft.branchId);
  const hasBranches = questions !== undefined && branches.length > 0;
  // A question with answers cannot enter, leave or change branch (D-646): the select is a lock row.
  const branchLocked = stored !== null && stored.answerCount > 0;
  const showBranchField = hasBranches && !branchLocked;
  const showBranchLock = hasBranches && branchLocked;
  const branchChoices = showBranchField
    ? branchOptionsFor(
        question && mode !== 'create'
          ? { id: question.id, showOnProfile: draft.showOnProfile }
          : { id: null, showOnProfile: draft.showOnProfile, stepId: draft.stepId },
        tree,
        draft.branchId,
      )
    : null;
  const yesNoWords = { yes: tc('yes'), no: tc('no') };

  // "Ramos desta pergunta" (D-651, UI-D-670): only for the four types that can open a branch, and only when the
  // host can create one. The depth and the limit come from the limits, never from a string.
  const showBranchesBlock =
    onCreateBranch !== undefined && draft.type !== null && isOpenerType(draft.type);
  const ownBranches = stored ? orderedBranchesOf(tree, stored.id) : [];
  const storedLevel = stored?.branchId ? branchLevel(tree, stored.branchId) : null;
  const depthReached = storedLevel !== null && storedLevel >= PROFILE_FORM_LIMITS.branchDepth;
  const branchLimitReached =
    branches.filter((branch) => branch.archivedAt === null).length >= PROFILE_FORM_LIMITS.branches;

  /** "Só conta quem vê esta pergunta: …" for the branch the draft sits in, or `null` (the impact dialog). */
  function branchNote(): string | null {
    const branch = usableBranch(tree, draft.branchId);
    if (branch === undefined) return null;
    const described = describeBranch(branch, tree.questionById);
    if (described === null) return null;
    const options = conditionOptionsText(described, yesNoWords);
    if (options === '') return null;
    return t('impact.conditionalNote', { opener: described.openerTitle, options });
  }

  const dirty = isDirty(initial, draft);

  // `requestClose` must be stable: the focus trap re-arms when it changes. It reads the latest flags from a ref.
  const latest = useRef({ dirty, saving, onClose });
  latest.current = { dirty, saving, onClose };
  const requestClose = useCallback(() => {
    const { dirty: unsaved, saving: busy, onClose: close } = latest.current;
    if (busy) return;
    if (unsaved) {
      setAfterDiscard('close');
      setDiscardOpen(true);
    } else close();
  }, []);

  /** The replace flow starts from the stored question; unsaved edits are asked about first. */
  function startReplace() {
    if (!question || !onReplace) return;
    if (dirty) {
      setAfterDiscard('replace');
      setDiscardOpen(true);
      return;
    }
    onReplace(question);
  }

  /**
   * Leaves this sheet for a branch sheet (D-651, UI-D-670): the sheet closes FIRST, through the dirty guard, so
   * nothing typed is lost silently, and only then does the host open the branch sheet. Never stacked.
   */
  function leaveFor(go: () => void) {
    if (dirty) {
      handOver.current = go;
      setAfterDiscard('branch');
      setDiscardOpen(true);
      return;
    }
    go();
  }

  function patch(change: Partial<QuestionDraft>) {
    setDraft((current) => ({ ...current, ...change }));
  }

  function clear(field: keyof DraftErrors) {
    setErrors((current) =>
      current[field] === undefined ? current : { ...current, [field]: undefined },
    );
  }

  /** Puts focus on the first field with an error, in the order of the sheet. */
  function focusFirst(found: DraftErrors) {
    let id: string | null = null;
    if (found.title) id = TITLE_ID;
    else if (found.helpText) id = HELP_ID;
    else if (found.options) {
      const row = draft.options.find((option) => found.options?.rows[option.key] !== undefined);
      const target = row ?? draft.options[0];
      id = target ? `pf-option-${target.key}` : null;
    } else if (found.min || found.limits) id = 'pf-min';
    else if (found.max) id = 'pf-max';
    if (id) document.getElementById(id)?.focus();
  }

  /**
   * A change of the step field (UI-D-647). A change that breaks D-623 is NOT applied: the select stays on the
   * step it had and a `role="alert"` line says which question forces it. One that only makes the draft branch
   * ineligible clears the branch (the "Ramo" select then reads "Nenhum"). The question stays in its branch's
   * rules: it goes to the END of the new step.
   */
  function changeStep(nextStepId: string) {
    if (nextStepId === draft.stepId) return;
    const result = checkStepMove({
      questions: activeQuestions,
      steps,
      branches,
      stored,
      branchId: draft.branchId,
      nextStepId,
    });
    if (result.kind !== 'ok') {
      setStepRefusal(result);
      return;
    }
    setStepRefusal(null);
    setBranchRefusal(null);
    setDraft((current) => ({
      ...current,
      stepId: nextStepId,
      branchId: result.clearBranch ? null : current.branchId,
    }));
  }

  function changeBranch(next: string) {
    setBranchRefusal(null);
    patch({ branchId: next === '' ? null : next });
  }

  function lostPermission(message: string) {
    toast.show({ tone: 'error', message });
    router.refresh();
    onClose();
  }

  function applyFailure(result: Extract<SaveQuestionResult, { ok: false }>) {
    switch (result.code) {
      case 'forbidden':
        lostPermission(tAdmin('errors.forbidden'));
        return;
      case 'moduleOff':
        lostPermission(t('errors.moduleOff'));
        return;
      case 'limit':
        toast.show({ tone: 'error', message: t('list.limit', { max: limit }) });
        return;
      case 'conflict':
        // An opener turned private above a public question (WR-06): the server's titles, in the privacy alert.
        if (
          result.issue === 'public_under_private' &&
          stored !== null &&
          stored.showOnProfile &&
          !draft.showOnProfile &&
          result.titles !== undefined &&
          result.titles.length > 0
        ) {
          setRefusal({ kind: 'privacy', dependents: titlesAsDependents(result.titles) });
          router.refresh();
          return;
        }
        // A move into or out of a branch the server refuses lands under the "Ramo" field (D-646).
        if (BRANCH_REFUSALS.has(result.issue)) {
          setBranchRefusal(result.issue as BranchRefusal);
          return;
        }
        if (result.issue === 'has_dependents') {
          // Another admin gave this question a branch after the page was read: show the server's list.
          const listed = groupsFromServer(result.branches ?? [], tree, textOf);
          const shown =
            mode === 'edit' && question
              ? refusalOfUpdate(question, draft, listed, tree)
              : listed.length > 0
                ? { kind: 'archive' as const, groups: listed }
                : null;
          if (shown) {
            setRefusal(shown);
            router.refresh();
            return;
          }
        }
        // Nothing was saved. The page is refreshed so reopening the question shows the current version.
        setConflict(true);
        router.refresh();
        return;
      case 'invalid': {
        const found: DraftErrors = {};
        for (const field of ['title', 'helpText'] as const) {
          const code = result.fields[field];
          if (code === undefined) continue;
          const message = serverFieldError(field, code);
          if (message) found[field] = message;
        }
        const options = result.fields.options;
        const optionsErrors = options === undefined ? null : serverOptionsErrors(options);
        if (optionsErrors) found.options = optionsErrors;
        const limits = result.fields.limits;
        const limitsError = limits === undefined ? null : serverLimitsError(draft.type, limits);
        if (limitsError) found.limits = limitsError;
        // A branch the server does not know (or that is gone) is the stale-copy alert: nothing was saved.
        if (
          result.fields.branch !== undefined ||
          result.fields.condition !== undefined ||
          result.fields.form === 'unknown_branch'
        ) {
          setConflict(true);
          router.refresh();
          return;
        }
        if (hasErrors(found)) {
          setErrors(found);
          focusFirst(found);
        } else {
          toast.show({ tone: 'error', message: te('errors.saveFailed') });
        }
        return;
      }
      default:
        toast.show({ tone: 'error', message: te('errors.saveFailed') });
    }
  }

  async function write(reopens: boolean) {
    setSaving(true);
    let result: SaveQuestionResult = { ok: false, code: 'failed' };
    try {
      if (mode === 'edit' && question) {
        result = await updateQuestionAction(question.id, toUpdateBody(question, draft), {
          reopens,
        });
      } else if (mode === 'replace' && question) {
        result = await replaceQuestionAction(
          { ...toCreateBody(draft), replaces: question.id },
          { reopens },
        );
      } else {
        const body = toCreateBody(draft);
        // The top "Adicionar pergunta" names no step: the server adds to the last one (D-629), unless the admin
        // picked another in the "Etapa" field. A well's own button names its step.
        if (stepId === undefined && draft.stepId === initial.stepId) delete body.stepId;
        result = await createQuestionAction(body, { reopens });
      }
    } catch {
      // A thrown request reads like any other failed write: the sheet stays open with the draft.
    } finally {
      setSaving(false);
    }
    if (!result.ok) {
      applyFailure(result);
      return;
    }
    // The count in the toast is the SERVER's, read after the write; the preview was only a snapshot.
    const done =
      mode === 'edit'
        ? te('toasts.updated')
        : mode === 'replace'
          ? te('toasts.replaced')
          : te('toasts.added');
    const message =
      reopens && mode === 'create'
        ? t('impact.added', { n: result.pending ?? 0 }).trim()
        : reopens
          ? `${done} ${t('impact.pending', { n: result.pending ?? 0 })}`.trim()
          : done;
    toast.show({ tone: 'success', message });
    router.refresh();
    onClose();
  }

  /**
   * Reads the impact BEFORE any write that reopens the form (D-585, UI-D-576, T-12-34). A failed read
   * writes nothing: a reopening change is never applied on a guess of how many members it holds out.
   * Zero members writes directly; otherwise only the dialog's confirm writes.
   */
  async function confirmReopening(reopening: Reopening) {
    setSaving(true);
    let read: ImpactActionResult = { ok: false, code: 'failed' };
    try {
      read = await readImpactAction({
        change: reopening.change,
        ...(reopening.questionId ? { questionId: reopening.questionId } : {}),
        ...(reopening.branchId ? { branchId: reopening.branchId } : {}),
      });
    } catch {
      // Falls through to "could not calculate": nothing is written.
    } finally {
      setSaving(false);
    }
    if (!read.ok) {
      if (read.code === 'forbidden') lostPermission(tAdmin('errors.forbidden'));
      else if (read.code === 'moduleOff') lostPermission(t('errors.moduleOff'));
      else toast.show({ tone: 'error', message: t('impact.previewFailed') });
      return;
    }
    if (read.members === 0) {
      await write(true);
      return;
    }
    setImpact({ members: read.members, kind: reopening.kind });
    setImpactOpen(true);
  }

  /** Archive or delete the stored question (D-588). Both free members, so neither reads an impact. */
  async function remove(kind: ArchiveKind) {
    if (!question) return;
    let result: RemoveResult = { ok: false, code: 'failed' };
    try {
      result =
        kind === 'archive'
          ? await archiveQuestionAction(question.id)
          : await deleteQuestionAction(question.id);
    } catch {
      // Falls through to the failure toast: the question was not changed as far as this screen knows.
    }
    if (result.ok) {
      toast.show({ tone: 'success', message: t(`${kind}.done`) });
      router.refresh();
      onClose();
      return;
    }
    switch (result.code) {
      case 'hasDependents': {
        const listed = groupsFromServer(result.branches ?? [], tree, textOf);
        if (listed.length > 0) {
          setRefusal({ kind, groups: listed });
          router.refresh();
          return;
        }
        setConflict(true);
        router.refresh();
        return;
      }
      case 'hasAnswers':
        // An answer arrived between the page read and the tap: archive instead (D-588).
        toast.show({ tone: 'error', message: t('delete.hasAnswers') });
        router.refresh();
        onClose();
        return;
      case 'forbidden':
        lostPermission(tAdmin('errors.forbidden'));
        return;
      case 'moduleOff':
        lostPermission(t('errors.moduleOff'));
        return;
      case 'gone':
        setConflict(true);
        router.refresh();
        return;
      default:
        toast.show({ tone: 'error', message: t(`${kind}.failed`) });
    }
  }

  function askRemove(kind: ArchiveKind) {
    // The page already holds who depends on this question: refuse here, with the list, before any dialog or request.
    if (groups.length > 0) {
      setRefusal({ kind, groups });
      return;
    }
    setRefusal(null);
    setRemoveKind(kind);
    setRemoveOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !canSave(draft)) return;
    setRefusal(null);
    const found = validateDraft(draft, stored);
    setErrors(found);
    if (hasErrors(found)) {
      focusFirst(found);
      return;
    }
    // An edit that changes nothing has nothing to send: the sheet simply closes.
    if (stored && !hasChanges(toUpdateBody(stored, draft))) {
      onClose();
      return;
    }
    // WR-06 (PFORM-53): an opener cannot stop showing on the profile while a public question hangs below it, at
    // any depth. Refused here, from the tree the page holds, with the titles; nothing is sent. The server's
    // `public_under_private` is the authority behind it.
    if (stored?.showOnProfile && !draft.showOnProfile) {
      const exposed = privacyTitlesIf(tree, { questionId: stored.id, showOnProfile: false });
      if (exposed.length > 0) {
        setRefusal({ kind: 'privacy', dependents: titlesAsDependents(exposed) });
        return;
      }
    }
    const reopening = reopeningOf(mode, draft, question ?? null);
    if (reopening) await confirmReopening(reopening);
    else await write(false);
  }

  /** The line under the "Ramo" field for a refusal the server sent (D-646); reuses the approved sentences. */
  function branchErrorOf(): string | undefined {
    switch (branchRefusal) {
      case 'condition_order': {
        const branch = draft.branchId ? tree.branchById.get(draft.branchId) : undefined;
        const opener = branch ? tree.questionById.get(branch.openerQuestionId) : undefined;
        return opener
          ? te('step.errors.mustFollow', { opener: opener.title })
          : te('errors.conflict');
      }
      case 'branch_depth':
        return te('branch.helper', { max: PROFILE_FORM_LIMITS.branchDepth });
      case 'condition_locked':
        // An answer arrived since the page was read, so there is at least one.
        return te('branch.locked', { n: Math.max(stored?.answerCount ?? 0, 1) });
      case 'public_under_private':
        return te('branch.privateHidden');
      default:
        return undefined;
    }
  }

  const title =
    mode === 'replace' ? te('replaceTitle') : mode === 'edit' ? te('editTitle') : te('createTitle');
  const acceptance = draft.type === 'acceptance';
  const titleError = errors.title ? te(errors.title.key, errors.title.values) : undefined;
  const helpError = errors.helpText ? te(errors.helpText.key, errors.helpText.values) : undefined;
  const titleCount = codePoints(draft.title);
  const branchError = branchErrorOf();

  return (
    <>
      <BottomSheet
        open={open}
        onClose={requestClose}
        title={title}
        desktopCard={desktop}
        dismiss="handle"
        handleLabel={te('close')}
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <fieldset disabled={saving} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
            {mode !== 'edit' ? (
              <div
                data-lgpd-notice
                className="flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-3 text-xs font-normal text-text"
              >
                <CircleAlert aria-hidden size={16} className="mt-px shrink-0 text-warning" />
                <span className="min-w-0 flex-1">{te('lgpd', { tenant: tenantName })}</span>
              </div>
            ) : null}

            {mode === 'replace' && question ? (
              <div
                data-replace-banner
                className="flex items-start gap-2 rounded-xl bg-bg-tertiary px-3 py-3 text-xs font-normal text-text"
              >
                <Info aria-hidden size={16} className="mt-px shrink-0 text-text-secondary" />
                <span className="min-w-0 flex-1 break-words">
                  {te('replaceBanner', { title: question.title })}
                </span>
              </div>
            ) : null}

            <TypePicker
              value={draft.type}
              onChange={(type) => setDraft((current) => changeType(current, type))}
              gridOpen={gridOpen}
              onGridOpenChange={setGridOpen}
              lock={
                locks.typeLocked && onReplace
                  ? { answerCount: locks.answerCount, onReplace: startReplace }
                  : undefined
              }
              droppedOptions={
                stored !== null && isChoiceType(stored.type) && !isChoiceType(draft.type)
              }
              blocked={groups.length > 0}
              onBlocked={() => setRefusal({ kind: 'type', groups })}
            />
            {refusal?.kind === 'type' ? (
              <DependentsAlert
                kind="type"
                groups={refusal.groups}
                dependents={refusal.dependents}
              />
            ) : null}

            {draft.type !== null ? (
              <>
                <div className="flex flex-col gap-1">
                  <Input
                    id={TITLE_ID}
                    label={acceptance ? te('fields.acceptanceTitle') : te('fields.title')}
                    placeholder={
                      acceptance
                        ? te('fields.acceptancePlaceholder')
                        : te('fields.titlePlaceholder')
                    }
                    maxLength={PROFILE_FORM_LIMITS.title}
                    value={draft.title}
                    error={titleError}
                    onChange={(event) => {
                      patch({ title: event.target.value });
                      clear('title');
                    }}
                  />
                  <span
                    aria-live="off"
                    className="text-right text-xs tabular-nums text-text-tertiary"
                  >
                    {`${titleCount}/${PROFILE_FORM_LIMITS.title}`}
                  </span>
                </div>

                <Textarea
                  id={HELP_ID}
                  label={te('fields.help')}
                  placeholder={te('fields.helpPlaceholder')}
                  rows={2}
                  maxLength={PROFILE_FORM_LIMITS.helpText}
                  counter={{ value: codePoints(draft.helpText), max: PROFILE_FORM_LIMITS.helpText }}
                  value={draft.helpText}
                  error={helpError}
                  onChange={(event) => {
                    patch({ helpText: event.target.value });
                    clear('helpText');
                  }}
                />

                {isChoiceType(draft.type) ? (
                  <OptionsEditor
                    options={draft.options}
                    allowOther={draft.allowOther}
                    errors={errors.options}
                    lockedCounts={locks.lockedOptions}
                    usedCounts={usedCounts}
                    otherLocked={locks.otherLocked}
                    onChange={(options) => {
                      patch({ options });
                      clear('options');
                    }}
                    onAllowOtherChange={(allowOther) => patch({ allowOther })}
                  />
                ) : (
                  <LimitsFields
                    type={draft.type}
                    min={draft.min}
                    max={draft.max}
                    minError={errors.min}
                    maxError={errors.max}
                    pairError={errors.limits}
                    widenOnly={locks.limitsWidenOnly}
                    onMinChange={(min) => {
                      patch({ min });
                      clear('min');
                      clear('limits');
                    }}
                    onMaxChange={(max) => {
                      patch({ max });
                      clear('max');
                      clear('limits');
                    }}
                  />
                )}

                <VisibilitySwitches
                  required={draft.required}
                  showOnProfile={draft.showOnProfile}
                  onRequiredChange={(required) => patch({ required })}
                  onShowOnProfileChange={(showOnProfile) => {
                    patch({ showOnProfile });
                    if (refusal?.kind === 'privacy') setRefusal(null);
                  }}
                  privateOpener={privateOpener ?? undefined}
                  lock={
                    locks.visibilityFrozen || locks.visibilityRatchet
                      ? {
                          frozen: locks.visibilityFrozen,
                          ratchet: locks.visibilityRatchet,
                          onReplace: startReplace,
                        }
                      : undefined
                  }
                />

                {showStepField || showBranchField || showBranchLock ? (
                  <div className="flex flex-col gap-4" data-where-block>
                    <SectionTitle variant="micro" as="h3">
                      {te('where.title')}
                    </SectionTitle>
                    {showStepField ? (
                      <SheetSelect
                        id={STEP_ID}
                        label={te('step.label')}
                        value={draft.stepId ?? ''}
                        onChange={changeStep}
                        helper={te('step.helper')}
                        error={
                          stepRefusal?.kind === 'mustFollow'
                            ? te('step.errors.mustFollow', { opener: stepRefusal.opener })
                            : stepRefusal?.kind === 'mustPrecede'
                              ? te('step.errors.mustPrecede', { dependent: stepRefusal.dependent })
                              : undefined
                        }
                      >
                        {steps.map((step) => (
                          <option key={step.id} value={step.id}>
                            {step.title}
                          </option>
                        ))}
                      </SheetSelect>
                    ) : null}
                    {branchChoices ? (
                      <div className="flex flex-col" data-branch-field>
                        <SheetSelect
                          id={BRANCH_ID}
                          label={te('branch.label')}
                          value={draft.branchId ?? ''}
                          onChange={changeBranch}
                          helper={te('branch.helper', { max: PROFILE_FORM_LIMITS.branchDepth })}
                          extraHelper={
                            branchChoices.leftOutForPrivacy ? te('branch.privateHidden') : undefined
                          }
                          error={branchError}
                        >
                          <option value="">{te('branch.none')}</option>
                          {branchChoices.groups.map((group) => (
                            <optgroup key={group.opener.id} label={group.opener.title}>
                              {group.branches.map((branch) => (
                                <option key={branch.id} value={branch.id}>
                                  {labelOf(branch).label}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </SheetSelect>
                        <div role="status" data-branch-note>
                          {draft.required && draft.branchId ? (
                            <p className="mt-2 flex items-start gap-2 text-xs font-normal text-text-secondary">
                              <Info aria-hidden size={16} className="mt-px shrink-0" />
                              <span className="min-w-0 flex-1">{te('branch.requiredNote')}</span>
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {showBranchLock && stored ? (
                      <div className="flex flex-col gap-3" data-branch-locked>
                        <p className="flex items-start gap-2 break-words text-xs font-normal text-text-secondary">
                          <Lock
                            aria-hidden
                            size={16}
                            className="mt-px shrink-0 text-text-tertiary"
                          />
                          <span className="min-w-0 flex-1">
                            {te('branch.locked', { n: stored.answerCount })}
                          </span>
                        </p>
                        {onReplace ? (
                          <Button variant="outline" fullWidth onClick={startReplace}>
                            {te('locked.replace')}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {showBranchesBlock ? (
                  <div className="flex flex-col gap-3" data-branches-block>
                    <SectionTitle variant="micro" as="h3">
                      {te('branches.title')}
                    </SectionTitle>
                    <p className="text-xs font-normal text-text-tertiary">{te('branches.hint')}</p>
                    {depthReached ? (
                      <p className="flex items-start gap-2 break-words text-xs font-normal text-text-secondary">
                        <Info aria-hidden size={16} className="mt-px shrink-0" />
                        <span className="min-w-0 flex-1">
                          {te('branches.depth', { max: PROFILE_FORM_LIMITS.branchDepth })}
                        </span>
                      </p>
                    ) : (
                      <>
                        {ownBranches.length === 0 ? (
                          <p className="text-xs font-normal text-text-secondary">
                            {te('branches.none')}
                          </p>
                        ) : onOpenBranch ? (
                          <ul aria-label={te('branches.title')} className="flex flex-col gap-2">
                            {ownBranches.map((branch) => (
                              <li key={branch.id}>
                                <button
                                  type="button"
                                  onClick={() => leaveFor(() => onOpenBranch(branch))}
                                  className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-bg-tertiary px-3 py-2 text-left"
                                >
                                  <Split
                                    aria-hidden
                                    size={16}
                                    className="shrink-0 text-text-tertiary"
                                  />
                                  <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="line-clamp-2 break-words text-sm font-bold text-text">
                                      {labelOf(branch).label}
                                    </span>
                                    <span className="text-xs font-normal text-text-secondary">
                                      {t('branches.count', {
                                        count: membersOf(tree, branch.id).length,
                                      })}
                                    </span>
                                  </span>
                                  <ChevronRight
                                    aria-hidden
                                    size={16}
                                    className="shrink-0 text-text-tertiary"
                                  />
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <Button
                          variant="outline"
                          fullWidth
                          disabled={stored === null || branchLimitReached || saving}
                          onClick={() => {
                            if (stored) leaveFor(() => onCreateBranch?.(stored));
                          }}
                        >
                          <Split aria-hidden size={18} />
                          {te('branches.create')}
                        </Button>
                        {stored === null ? (
                          <p className="text-xs font-normal text-text-tertiary">
                            {te('branches.saveFirst')}
                          </p>
                        ) : branchLimitReached ? (
                          <p className="text-xs font-normal text-text-tertiary">
                            {t('branches.limit', { max: PROFILE_FORM_LIMITS.branches })}
                          </p>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
              </>
            ) : null}
          </fieldset>

          {conflict ? (
            <div
              role="alert"
              data-conflict-alert
              className="rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger"
            >
              {te('errors.conflict')}
            </div>
          ) : null}

          {refusal && refusal.kind !== 'type' ? (
            <DependentsAlert
              kind={refusal.kind}
              groups={refusal.groups}
              dependents={refusal.dependents}
              label={refusal.label}
            />
          ) : null}

          <Button type="submit" fullWidth size="lg" loading={saving} disabled={!canSave(draft)}>
            {saving ? te('saving') : te('save')}
          </Button>

          {stored ? (
            <div className="flex flex-col gap-3 border-t border-divider pt-4" data-remove-block>
              {stored.answerCount > 0 ? (
                <Button
                  variant="outline"
                  fullWidth
                  disabled={saving}
                  onClick={() => askRemove('archive')}
                >
                  <Archive aria-hidden size={18} />
                  {te('archive')}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  fullWidth
                  className="text-danger"
                  disabled={saving}
                  onClick={() => askRemove('delete')}
                >
                  <Trash2 aria-hidden size={18} />
                  {te('delete')}
                </Button>
              )}
            </div>
          ) : null}
        </form>
      </BottomSheet>

      {/* Beside the sheet, never inside it: a `fixed` dialog inside the sheet's transformed panel would be
          positioned against the panel instead of the screen. */}
      <ImpactDialog
        open={impactOpen}
        kind={impact?.kind ?? 'add'}
        members={impact?.members ?? 0}
        note={
          impact?.kind === 'replace' && question
            ? t('impact.replaceBody', { title: question.title })
            : undefined
        }
        conditionNote={
          impact && impact.kind !== 'unconditional' && draft.branchId !== null
            ? (branchNote() ?? undefined)
            : undefined
        }
        onConfirm={() => write(true)}
        onClose={() => setImpactOpen(false)}
      />
      <ConfirmDialog
        open={discardOpen}
        tone="brand"
        title={te('discard.title')}
        body={te('discard.body')}
        confirmLabel={te('discard.confirm')}
        cancelLabel={te('discard.cancel')}
        onConfirm={() => {
          if (afterDiscard === 'replace' && question) onReplace?.(question);
          else if (afterDiscard === 'branch') handOver.current?.();
          else onClose();
        }}
        onClose={() => setDiscardOpen(false)}
      />
      {stored ? (
        <ArchiveDialog
          open={removeOpen}
          kind={removeKind}
          answerCount={stored.answerCount}
          required={stored.required}
          onConfirm={() => remove(removeKind)}
          onClose={() => setRemoveOpen(false)}
        />
      ) : null}
    </>
  );
}
