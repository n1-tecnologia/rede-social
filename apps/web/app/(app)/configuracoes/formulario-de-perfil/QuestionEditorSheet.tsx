'use client';

import {
  type AdminQuestion,
  codePoints,
  PROFILE_FORM_LIMITS,
} from '@rede-social/contracts/profile-form';
import {
  BottomSheet,
  Button,
  ConfirmDialog,
  Input,
  Textarea,
  useMediaQuery,
  useToast,
} from '@rede-social/ui';
import { Archive, CircleAlert, Info, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useRef, useState } from 'react';
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
import {
  blankDraft,
  canSave,
  changeType,
  type DraftErrors,
  draftFromQuestion,
  type EditorMode,
  hasChanges,
  hasErrors,
  isDirty,
  lockFlags,
  type QuestionDraft,
  type Reopening,
  reopeningOf,
  replaceDraftFrom,
  serverFieldError,
  serverLimitsError,
  serverOptionsErrors,
  toCreateBody,
  toUpdateBody,
  validateDraft,
} from './editor-state';
import { ImpactDialog } from './ImpactDialog';
import { LimitsFields } from './LimitsFields';
import { OptionsEditor } from './OptionsEditor';
import { TypePicker } from './TypePicker';
import { VisibilitySwitches } from './VisibilitySwitches';

export interface QuestionEditorSheetProps {
  open: boolean;
  mode: EditorMode;
  /** The question being edited (edit) or replaced (replace); `null` for a new one. */
  question?: AdminQuestion | null;
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
  tenantName,
  limit,
  onClose,
  onReplace,
}: QuestionEditorSheetProps) {
  const t = useTranslations('profileForm.admin');
  const te = useTranslations('profileForm.admin.editor');
  const tAdmin = useTranslations('admin');
  const router = useRouter();
  const toast = useToast();
  const desktop = useMediaQuery('(min-width: 768px)');

  const [initial] = useState<QuestionDraft>(() => {
    if (mode === 'edit' && question) return draftFromQuestion(question);
    if (mode === 'replace' && question) return replaceDraftFrom(question);
    return blankDraft();
  });
  const stored = mode === 'edit' ? (question ?? null) : null;
  const locks = lockFlags(stored);
  const [draft, setDraft] = useState<QuestionDraft>(initial);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [saving, setSaving] = useState(false);
  const [gridOpen, setGridOpen] = useState(draft.type === null);
  const [discardOpen, setDiscardOpen] = useState(false);
  // What a confirmed discard does: close the sheet, or leave for the replace flow.
  const [afterDiscard, setAfterDiscard] = useState<'close' | 'replace'>('close');
  // The 409 of the truth: another admin changed the question, or answers arrived and a lock now applies.
  const [conflict, setConflict] = useState(false);
  // The archive or delete confirmation; `removeKind` is kept for the dialog's exit animation.
  const [removeKind, setRemoveKind] = useState<ArchiveKind>('archive');
  const [removeOpen, setRemoveOpen] = useState(false);
  // `impact` keeps the figure for the dialog's exit animation; `impactOpen` is what the dialog follows.
  const [impact, setImpact] = useState<{ members: number; kind: Reopening['kind'] } | null>(null);
  const [impactOpen, setImpactOpen] = useState(false);

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
        result = await createQuestionAction(toCreateBody(draft), { reopens });
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
    setRemoveKind(kind);
    setRemoveOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !canSave(draft)) return;
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
    const reopening = reopeningOf(mode, draft, question ?? null);
    if (reopening) await confirmReopening(reopening);
    else await write(false);
  }

  const title =
    mode === 'replace' ? te('replaceTitle') : mode === 'edit' ? te('editTitle') : te('createTitle');
  const acceptance = draft.type === 'acceptance';
  const titleError = errors.title ? te(errors.title.key, errors.title.values) : undefined;
  const helpError = errors.helpText ? te(errors.helpText.key, errors.helpText.values) : undefined;
  const titleCount = codePoints(draft.title);

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
            />

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
                  onShowOnProfileChange={(showOnProfile) => patch({ showOnProfile })}
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
