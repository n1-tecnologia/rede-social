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
  StatusPill,
  useMediaQuery,
  useToast,
} from '@rede-social/ui';
import { CircleAlert, Layers, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useMemo, useRef, useState } from 'react';
import { buildBranchTree, eligibleOpenersFor, membersOf } from '@/lib/profile-form/branch-tree';
import {
  type BranchFieldKey,
  createBranchAction,
  type SaveBranchResult,
  updateBranchAction,
} from './actions';
import { BranchValuesPicker } from './BranchValuesPicker';
import { SheetSelect } from './SheetSelect';

interface BranchSheetBaseProps {
  open: boolean;
  /** The tenant's steps in order: the opener's step shows as a pill from two steps on. */
  steps: AdminStep[];
  /** MUST be stable (`useCallback`): the shipped focus trap re-arms when it changes. */
  onClose: () => void;
  /** The branch was saved: the host closes the sheet (the page was already refreshed here). */
  onSaved: (branch: AdminBranch) => void;
}

/** Create mode (12.2-16): the branch is created from its opener (D-651). */
export interface BranchSheetCreateProps extends BranchSheetBaseProps {
  /** The question that decides (D-651: the branch is created from it); read-only in create mode. */
  opener: AdminQuestion;
  branch?: undefined;
}

/** Edit mode (12.2-17): an existing branch, judged against the one admin read the page holds. */
export interface BranchSheetEditProps extends BranchSheetBaseProps {
  opener?: undefined;
  /** The branch in its newest copy (the host re-reads it from `branches` at render). */
  branch: AdminBranch;
  /** The ACTIVE questions in stored order. */
  questions: AdminQuestion[];
  /** Every branch of the read, archived ones included. */
  branches: AdminBranch[];
  /** "Adicionar pergunta ao ramo": the host opens the question sheet with the branch and this step. */
  onAddQuestion?: (branch: AdminBranch, stepId: string) => void;
}

export type BranchSheetProps = BranchSheetCreateProps | BranchSheetEditProps;

const NAME_ID = 'pf-branch-name';

/** What the sheet says after a refusal that is not a field's: the transport failure, or a limit line. */
type Refusal = 'failed' | 'limit' | 'depth';

/**
 * The branch sheet, create mode (12.2-16, D-640, D-642, D-644, D-651; UI-D-671, UI-D-682..UI-D-684): ONE
 * `BottomSheet` (the centred card from `md`) titled "Novo ramo". Top to bottom: (a) "Pergunta que decide", a
 * read-only block with the opener's title and, with two or more steps, a neutral pill "Etapa {n}"; (b) "Mostrar
 * quando a resposta for", the answers picker (extracted from the 12.1 condition editor); (c) "Nome do ramo
 * (opcional)", at most 60 CODE POINTS, shown only to the admin (T-12.2-03); and the brand "Salvar ramo" button,
 * disabled until one answer is ticked. A new branch is appended after the opener's others and starts empty.
 *
 * **It cannot be closed while it saves**, and a close with a ticked answer or a typed name asks first (the dirty
 * guard): backdrop, handle and Escape all reach `requestClose`. The sheet remounts per opening (the host keys
 * it). The server stays the authority: its 400 lands under the field, its 409 `branch_limit` and `branch_depth`
 * as the limit lines, any other refusal as the failure line, and a transport failure KEEPS the draft. React text
 * only: the opener title and the name are admin-typed (T-12.2-15).
 */
function CreateBranchSheet({
  open,
  opener,
  steps,
  onClose,
  onSaved,
}: Omit<BranchSheetCreateProps, 'branch'>) {
  const t = useTranslations('profileForm.admin');
  const ts = useTranslations('profileForm.admin.branches.sheet');
  const te = useTranslations('profileForm.admin.editor');
  const tAdmin = useTranslations('admin');
  const router = useRouter();
  const toast = useToast();
  const desktop = useMediaQuery('(min-width: 768px)');

  const [values, setValues] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<BranchFieldKey, true>>>({});
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const dirty = values.length > 0 || name !== '';
  const latest = useRef({ dirty, saving, onClose });
  latest.current = { dirty, saving, onClose };
  const requestClose = useCallback(() => {
    const { dirty: unsaved, saving: busy, onClose: close } = latest.current;
    if (busy) return;
    if (unsaved) setDiscardOpen(true);
    else close();
  }, []);

  function lostPermission(message: string) {
    toast.show({ tone: 'error', message });
    router.refresh();
    onClose();
  }

  function applyFailure(result: Extract<SaveBranchResult, { ok: false }>) {
    switch (result.code) {
      case 'forbidden':
        lostPermission(tAdmin('errors.forbidden'));
        return;
      case 'moduleOff':
        lostPermission(t('errors.moduleOff'));
        return;
      case 'limit':
        // Another admin created the last branch meanwhile: the page re-reads and "Criar ramo" disables itself.
        setRefusal('limit');
        router.refresh();
        return;
      case 'conflict':
        // `branch_depth` is the depth line; the opener or its answers changed meanwhile is the failure line.
        setRefusal(result.issue === 'branch_depth' ? 'depth' : 'failed');
        router.refresh();
        return;
      case 'invalid': {
        const found: Partial<Record<BranchFieldKey, true>> = {};
        if (result.fields.name !== undefined) found.name = true;
        if (result.fields.values !== undefined) found.values = true;
        if (Object.keys(found).length === 0) {
          setRefusal('failed');
          return;
        }
        setFieldErrors(found);
        if (found.name) document.getElementById(NAME_ID)?.focus();
        return;
      }
      default:
        setRefusal('failed');
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || values.length === 0) return;
    const trimmed = name.trim();
    if (codePoints(trimmed) > PROFILE_FORM_LIMITS.branchName) {
      setFieldErrors({ name: true });
      document.getElementById(NAME_ID)?.focus();
      return;
    }

    setSaving(true);
    setRefusal(null);
    setFieldErrors({});
    let result: SaveBranchResult = { ok: false, code: 'failed' };
    try {
      result = await createBranchAction({
        openerQuestionId: opener.id,
        values,
        // A blank name is no name at all (PFORM-57).
        ...(trimmed === '' ? {} : { name: trimmed }),
      });
    } catch {
      // A thrown request reads like any other failed write: the sheet stays open with the draft.
    } finally {
      setSaving(false);
    }
    if (!result.ok) {
      applyFailure(result);
      return;
    }
    toast.show({ tone: 'success', message: t('branches.toasts.created') });
    router.refresh();
    onSaved(result.branch);
  }

  const stepNumber = steps.findIndex((step) => step.id === opener.stepId) + 1;
  const nameError = fieldErrors.name
    ? ts('name.tooLong', { max: PROFILE_FORM_LIMITS.branchName })
    : undefined;
  const valuesError = fieldErrors.values ? ts('errors.values') : undefined;
  const refusalText =
    refusal === 'limit'
      ? t('branches.limit', { max: PROFILE_FORM_LIMITS.branches })
      : refusal === 'depth'
        ? te('branches.depth', { max: PROFILE_FORM_LIMITS.branchDepth })
        : refusal === 'failed'
          ? ts('failed')
          : null;

  return (
    <>
      <BottomSheet
        open={open}
        onClose={requestClose}
        title={ts('createTitle')}
        desktopCard={desktop}
        dismiss="handle"
        handleLabel={te('close')}
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <fieldset disabled={saving} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
            {refusalText ? (
              <div
                role="alert"
                {...(refusal === 'failed' ? { 'data-branch-failed': true } : {})}
                data-branch-refusal={refusal}
                className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
              >
                <CircleAlert aria-hidden size={16} className="mt-px shrink-0" />
                <span className="min-w-0 flex-1 break-words">{refusalText}</span>
              </div>
            ) : null}

            <div className="flex flex-col gap-2" data-branch-opener>
              <span className="text-sm font-normal text-text-secondary">{ts('opener')}</span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-words text-sm font-bold text-text">
                  {opener.title}
                </span>
                {steps.length >= 2 && stepNumber > 0 ? (
                  <StatusPill tone="neutral">
                    <Layers aria-hidden size={12} />
                    {t('steps.eyebrow', { n: stepNumber })}
                  </StatusPill>
                ) : null}
              </div>
            </div>

            <BranchValuesPicker
              opener={opener}
              values={values}
              error={valuesError}
              onChange={(next) => {
                setValues(next);
                setFieldErrors((current) => ({ ...current, values: undefined }));
              }}
            />

            <div className="flex flex-col gap-1">
              <Input
                id={NAME_ID}
                label={ts('name.label')}
                placeholder={ts('name.placeholder')}
                maxLength={PROFILE_FORM_LIMITS.branchName}
                value={name}
                error={nameError}
                aria-describedby={[nameError ? `${NAME_ID}-error` : null, `${NAME_ID}-help`]
                  .filter(Boolean)
                  .join(' ')}
                onChange={(event) => {
                  setName(event.target.value);
                  setFieldErrors((current) => ({ ...current, name: undefined }));
                }}
              />
              <span aria-live="off" className="text-right text-xs tabular-nums text-text-tertiary">
                {ts('name.counter', {
                  n: codePoints(name),
                  max: PROFILE_FORM_LIMITS.branchName,
                })}
              </span>
              <span id={`${NAME_ID}-help`} className="text-xs font-normal text-text-tertiary">
                {ts('name.help')}
              </span>
            </div>
          </fieldset>

          <Button type="submit" fullWidth size="lg" loading={saving} disabled={values.length === 0}>
            {saving ? ts('saving') : ts('save')}
          </Button>
        </form>
      </BottomSheet>

      {/* Beside the sheet, never inside it: a `fixed` dialog inside the sheet's transformed panel would be
          positioned against the panel instead of the screen. */}
      <ConfirmDialog
        open={discardOpen}
        tone="brand"
        title={te('discard.title')}
        body={ts('discardBody')}
        confirmLabel={te('discard.confirm')}
        cancelLabel={te('discard.cancel')}
        onConfirm={() => onClose()}
        onClose={() => setDiscardOpen(false)}
      />
    </>
  );
}

const OPENER_ID = 'pf-branch-opener';

/** The same set of tokens, in any order. */
function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

/** The most questions of the branch the sheet lists before "e mais N" (UI-D-671). */
const QUESTIONS_SHOWN = 5;

/** What the edit sheet says after a refusal that is not a field's. */
type EditRefusal = 'failed' | 'depth' | 'stale';

/**
 * The branch sheet, edit mode (12.2-17, D-640, D-642, D-646, D-653; UI-D-671, UI-D-682..UI-D-684): the SAME
 * `BottomSheet` as create mode, titled "Editar ramo", for a branch that exists. Top to bottom: (a) "Pergunta que
 * decide" as a native `select` of the eligible openers (`eligibleOpenersFor`), grouped by step; changing it
 * clears the ticked answers and says so in a polite `role="status"` line; (b) "Mostrar quando a resposta for",
 * the same picker as create mode; (c) the optional name; (d) "Perguntas deste ramo": up to five titles, then "e
 * mais N", a neutral step pill from two steps, the empty line for a branch with no question, the required note
 * and the ghost "Adicionar pergunta ao ramo". "Salvar ramo" sends ONLY what changed, under the `revision` of the
 * branch; a stale revision is shown in the sheet with the draft kept.
 *
 * What changed is measured against the branch as it was WHEN THE SHEET OPENED (the draft's base), never against
 * the newest copy the page re-read: after a stale answer the retry sends the keys this admin touched under the
 * newest revision and does not overwrite what the other admin changed. The sheet remounts per opening (the host
 * keys it). The server stays the authority. React text only: the names and titles are admin-typed (T-12.2-15).
 */
function EditBranchSheet({
  open,
  branch,
  questions,
  branches,
  steps,
  onClose,
  onSaved,
  onAddQuestion,
}: BranchSheetEditProps) {
  const t = useTranslations('profileForm.admin');
  const ts = useTranslations('profileForm.admin.branches.sheet');
  const te = useTranslations('profileForm.admin.editor');
  const tAdmin = useTranslations('admin');
  const router = useRouter();
  const toast = useToast();
  const desktop = useMediaQuery('(min-width: 768px)');

  const [base] = useState(branch);
  const [openerId, setOpenerId] = useState(base.openerQuestionId);
  const [values, setValues] = useState<string[]>(base.values);
  const [name, setName] = useState(base.name ?? '');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<BranchFieldKey, true>>>({});
  const [refusal, setRefusal] = useState<EditRefusal | null>(null);
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  /** What to do once the admin confirms the discard dialog; absent means close the sheet. */
  const afterDiscard = useRef<(() => void) | null>(null);

  const tree = useMemo(
    () => buildBranchTree({ steps, questions, branches }),
    [steps, questions, branches],
  );
  const opener = tree.questionById.get(openerId);
  const members = membersOf(tree, branch.id);

  // The eligible openers, plus the branch's own opener whatever the rules say today, so the select never lies.
  const openers = useMemo(() => {
    const eligible = eligibleOpenersFor(branch, tree);
    const own = tree.questionById.get(base.openerQuestionId);
    return own && !eligible.some((candidate) => candidate.id === own.id)
      ? [...eligible, own]
      : eligible;
  }, [branch, tree, base.openerQuestionId]);

  const trimmed = name.trim();
  const openerDirty = openerId !== base.openerQuestionId;
  const valuesDirty = !sameSet(values, base.values);
  const nameDirty = trimmed !== (base.name ?? '').trim();
  const changed = openerDirty || valuesDirty || nameDirty;

  const latest = useRef({ changed, saving, onClose });
  latest.current = { changed, saving, onClose };
  const requestClose = useCallback(() => {
    const { changed: unsaved, saving: busy, onClose: close } = latest.current;
    if (busy) return;
    if (unsaved) {
      afterDiscard.current = null;
      setDiscardOpen(true);
    } else close();
  }, []);

  /** Runs `go` at once when nothing is unsaved, else after the discard dialog is confirmed. */
  function leaveFor(go: () => void) {
    if (!changed) {
      go();
      return;
    }
    afterDiscard.current = go;
    setDiscardOpen(true);
  }

  function lostPermission(message: string) {
    toast.show({ tone: 'error', message });
    router.refresh();
    onClose();
  }

  function applyFailure(result: Extract<SaveBranchResult, { ok: false }>) {
    switch (result.code) {
      case 'forbidden':
        lostPermission(tAdmin('errors.forbidden'));
        return;
      case 'moduleOff':
        lostPermission(t('errors.moduleOff'));
        return;
      case 'stale_revision':
        // The page re-reads the branch; the draft stays so nothing the admin typed is lost.
        setRefusal('stale');
        router.refresh();
        return;
      case 'conflict':
        setRefusal(result.issue === 'branch_depth' ? 'depth' : 'failed');
        router.refresh();
        return;
      case 'invalid': {
        const found: Partial<Record<BranchFieldKey, true>> = {};
        if (result.fields.name !== undefined) found.name = true;
        if (result.fields.values !== undefined) found.values = true;
        if (Object.keys(found).length === 0) {
          setRefusal('failed');
          return;
        }
        setFieldErrors(found);
        if (found.name) document.getElementById(NAME_ID)?.focus();
        return;
      }
      default:
        setRefusal('failed');
    }
  }

  function changeOpener(next: string) {
    if (next === openerId) return;
    setOpenerId(next);
    // Going back to the original opener brings its answers back; any other opener starts with none ticked.
    setValues(next === base.openerQuestionId ? base.values : []);
    setFieldErrors((current) => ({ ...current, values: undefined }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !changed || values.length === 0) return;
    if (codePoints(trimmed) > PROFILE_FORM_LIMITS.branchName) {
      setFieldErrors({ name: true });
      document.getElementById(NAME_ID)?.focus();
      return;
    }

    setSaving(true);
    setRefusal(null);
    setFieldErrors({});
    let result: SaveBranchResult = { ok: false, code: 'failed' };
    try {
      result = await updateBranchAction(branch.id, {
        revision: branch.revision,
        ...(openerDirty ? { openerQuestionId: openerId } : {}),
        ...(valuesDirty ? { values } : {}),
        // A blank name clears it.
        ...(nameDirty ? { name: trimmed === '' ? null : trimmed } : {}),
      });
    } catch {
      // A thrown request reads like any other failed write: the sheet stays open with the draft.
    } finally {
      setSaving(false);
    }
    if (!result.ok) {
      applyFailure(result);
      return;
    }
    toast.show({ tone: 'success', message: t('branches.toasts.saved') });
    router.refresh();
    onSaved(result.branch);
  }

  const nameError = fieldErrors.name
    ? ts('name.tooLong', { max: PROFILE_FORM_LIMITS.branchName })
    : undefined;
  const valuesError = fieldErrors.values ? ts('errors.values') : undefined;
  const refusalText =
    refusal === 'stale'
      ? ts('stale')
      : refusal === 'depth'
        ? te('branches.depth', { max: PROFILE_FORM_LIMITS.branchDepth })
        : refusal === 'failed'
          ? ts('failed')
          : null;

  const stepNumberOf = (stepId: string) => (tree.stepOrdinal.get(stepId) ?? 0) as number;
  const shown = members.slice(0, QUESTIONS_SHOWN);
  const more = members.length - shown.length;
  const questionsLabelId = 'pf-branch-questions';

  // The step "Adicionar pergunta ao ramo" hands over: the step of the branch's last question in the form, else
  // the last step (an empty branch), else the step of the opener.
  function stepForAdd(): string {
    let last: AdminQuestion | undefined;
    for (const member of members) {
      if (
        last === undefined ||
        (tree.flatIndex.get(member.id) ?? 0) > (tree.flatIndex.get(last.id) ?? 0)
      ) {
        last = member;
      }
    }
    if (last !== undefined) return last.stepId;
    return steps[steps.length - 1]?.id ?? opener?.stepId ?? '';
  }

  const groups = steps.length >= 2 ? steps : null;
  const optionOf = (candidate: AdminQuestion) => (
    <option key={candidate.id} value={candidate.id}>
      {candidate.title}
    </option>
  );

  return (
    <>
      <BottomSheet
        open={open}
        onClose={requestClose}
        title={ts('editTitle')}
        desktopCard={desktop}
        dismiss="handle"
        handleLabel={te('close')}
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <fieldset disabled={saving} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
            {refusalText ? (
              <div
                role="alert"
                data-branch-refusal={refusal}
                className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
              >
                <CircleAlert aria-hidden size={16} className="mt-px shrink-0" />
                <span className="min-w-0 flex-1 break-words">{refusalText}</span>
              </div>
            ) : null}

            <div className="flex min-w-0 flex-col gap-2" data-branch-opener>
              <SheetSelect
                id={OPENER_ID}
                label={ts('opener')}
                value={openerId}
                onChange={changeOpener}
              >
                {groups
                  ? groups.map((step) => {
                      const inStep = openers.filter((candidate) => candidate.stepId === step.id);
                      return inStep.length === 0 ? null : (
                        <optgroup key={step.id} label={step.title}>
                          {inStep.map(optionOf)}
                        </optgroup>
                      );
                    })
                  : openers.map(optionOf)}
              </SheetSelect>
              <p
                role="status"
                aria-live="polite"
                data-branch-reset
                className="text-xs font-normal text-text-secondary"
              >
                {openerDirty ? ts('reset') : ''}
              </p>
            </div>

            {opener ? (
              <BranchValuesPicker
                key={opener.id}
                opener={opener}
                values={values}
                error={valuesError}
                onChange={(next) => {
                  setValues(next);
                  setFieldErrors((current) => ({ ...current, values: undefined }));
                }}
              />
            ) : null}

            <div className="flex flex-col gap-1">
              <Input
                id={NAME_ID}
                label={ts('name.label')}
                placeholder={ts('name.placeholder')}
                maxLength={PROFILE_FORM_LIMITS.branchName}
                value={name}
                error={nameError}
                aria-describedby={[nameError ? `${NAME_ID}-error` : null, `${NAME_ID}-help`]
                  .filter(Boolean)
                  .join(' ')}
                onChange={(event) => {
                  setName(event.target.value);
                  setFieldErrors((current) => ({ ...current, name: undefined }));
                }}
              />
              <span aria-live="off" className="text-right text-xs tabular-nums text-text-tertiary">
                {ts('name.counter', {
                  n: codePoints(name),
                  max: PROFILE_FORM_LIMITS.branchName,
                })}
              </span>
              <span id={`${NAME_ID}-help`} className="text-xs font-normal text-text-tertiary">
                {ts('name.help')}
              </span>
            </div>

            <div className="flex min-w-0 flex-col gap-2" data-branch-questions>
              <p id={questionsLabelId} className="text-sm font-bold text-text">
                {ts('questions')}
              </p>
              {members.length === 0 ? (
                <p
                  data-branch-empty
                  className="flex items-start gap-2 text-xs font-normal text-text-tertiary"
                >
                  <Layers aria-hidden size={16} className="mt-px shrink-0" />
                  <span className="min-w-0 flex-1">{t('branches.empty')}</span>
                </p>
              ) : (
                <>
                  <ul aria-labelledby={questionsLabelId} className="flex flex-col gap-2">
                    {shown.map((member) => (
                      <li key={member.id} className="flex min-w-0 items-start gap-2">
                        <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-normal text-text">
                          {member.title}
                        </span>
                        {steps.length >= 2 && stepNumberOf(member.stepId) > 0 ? (
                          <StatusPill tone="neutral">
                            <Layers aria-hidden size={12} />
                            {t('steps.eyebrow', { n: stepNumberOf(member.stepId) })}
                          </StatusPill>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {more > 0 ? (
                    <span className="text-xs font-normal text-text-secondary">
                      {ts('more', { count: more })}
                    </span>
                  ) : null}
                  {members.some((member) => member.required) ? (
                    <p className="text-xs font-normal text-text-tertiary">{ts('requiredNote')}</p>
                  ) : null}
                </>
              )}
              {onAddQuestion ? (
                <div className="flex">
                  <Button
                    variant="ghost"
                    size="sm"
                    hitArea
                    onClick={() => leaveFor(() => onAddQuestion(branch, stepForAdd()))}
                  >
                    <Plus aria-hidden size={16} />
                    {t('branches.addQuestion')}
                  </Button>
                </div>
              ) : null}
            </div>
          </fieldset>

          <Button
            type="submit"
            fullWidth
            size="lg"
            loading={saving}
            disabled={!changed || values.length === 0}
          >
            {saving ? ts('saving') : ts('save')}
          </Button>
        </form>
      </BottomSheet>

      {/* Beside the sheet, never inside it: a `fixed` dialog inside the sheet's transformed panel would be
          positioned against the panel instead of the screen. */}
      <ConfirmDialog
        open={discardOpen}
        tone="brand"
        title={te('discard.title')}
        body={ts('discardBody')}
        confirmLabel={te('discard.confirm')}
        cancelLabel={te('discard.cancel')}
        onConfirm={() => {
          const go = afterDiscard.current;
          afterDiscard.current = null;
          (go ?? onClose)();
        }}
        onClose={() => {
          afterDiscard.current = null;
          setDiscardOpen(false);
        }}
      />
    </>
  );
}

/** The branch sheet: create mode from an opener (12.2-16), edit mode from a branch (12.2-17). */
export function BranchSheet(props: BranchSheetProps) {
  if (props.branch !== undefined) return <EditBranchSheet {...props} />;
  const { branch: _branch, ...create } = props;
  return <CreateBranchSheet {...create} />;
}
