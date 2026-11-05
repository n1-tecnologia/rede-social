'use client';

import {
  type AdminStep,
  codePoints,
  PROFILE_FORM_LIMITS,
} from '@rede-social/contracts/profile-form';
import {
  BottomSheet,
  Button,
  ConfirmDialog,
  Input,
  useMediaQuery,
  useToast,
} from '@rede-social/ui';
import { CircleAlert, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useRef, useState } from 'react';
import {
  type CreateStepResult,
  createStepAction,
  type DeleteStepActionResult,
  deleteStepAction,
  type RenameStepResult,
  renameStepAction,
  type StepIssue,
} from './actions';

export type StepSheetMode = 'create' | 'rename';

export interface StepSheetProps {
  open: boolean;
  mode: StepSheetMode;
  /** The step being renamed (rename); `null` for a new one. Read at save time, so a refresh brings its newest revision. */
  step?: AdminStep | null;
  /** How many ACTIVE questions the step holds: a step with any cannot be deleted (UI-D-645). */
  questionCount?: number;
  /** How many steps the form has: the only step cannot be deleted. */
  stepCount?: number;
  /** MUST be stable (`useCallback`): the shipped focus trap re-arms when it changes. */
  onClose: () => void;
}

const TITLE_ID = 'pf-step-title';

/**
 * The step sheet (12.1-16, D-627, UI-D-645): ONE `BottomSheet` (the centred card from `md`) in two modes,
 * "Nova etapa" and "Renomear etapa". One field, the title (`maxLength` 60 with its live counter, required,
 * no description), and the brand "Salvar etapa" button, disabled until the title is not empty. In rename mode
 * a divided block follows the button: "Excluir etapa" (danger confirmation) only for a step with no active
 * question, otherwise the sentence that says what to do first, or that a form needs at least one step.
 *
 * **It cannot be closed while it saves**, and a close with an unsaved title asks first (the dirty guard):
 * backdrop, handle and Escape all reach `requestClose`. The sheet remounts per opening (the host keys it).
 * A new step is appended LAST and empty by the server. The title is the admin's text: React text only
 * (T-12.1-12), bounded to 60 characters here and checked again by the server.
 */
export function StepSheet({
  open,
  mode,
  step = null,
  questionCount = 0,
  stepCount = 0,
  onClose,
}: StepSheetProps) {
  const t = useTranslations('profileForm.admin');
  const ts = useTranslations('profileForm.admin.steps');
  const te = useTranslations('profileForm.admin.editor');
  const tAdmin = useTranslations('admin');
  const router = useRouter();
  const toast = useToast();
  const desktop = useMediaQuery('(min-width: 768px)');

  const [initial] = useState(() => (mode === 'rename' && step ? step.title : ''));
  const [title, setTitle] = useState(initial);
  const [issue, setIssue] = useState<StepIssue | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const dirty = title !== initial;
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

  /** Refusals every step write shares; returns true when it handled the result. */
  function applyShared(code: string): boolean {
    if (code === 'forbidden') {
      lostPermission(tAdmin('errors.forbidden'));
      return true;
    }
    if (code === 'moduleOff') {
      lostPermission(t('errors.moduleOff'));
      return true;
    }
    return false;
  }

  function applyFailure(result: Extract<CreateStepResult | RenameStepResult, { ok: false }>) {
    if (applyShared(result.code)) return;
    switch (result.code) {
      case 'invalid':
        setIssue(result.issue);
        document.getElementById(TITLE_ID)?.focus();
        return;
      case 'limit_reached':
        // Another admin added the tenth step meanwhile: the page re-reads and the button disables itself.
        toast.show({
          tone: 'error',
          message: ts('limit', { max: PROFILE_FORM_LIMITS.steps }),
        });
        router.refresh();
        onClose();
        return;
      case 'gone':
        toast.show({ tone: 'error', message: ts('sheet.failed') });
        router.refresh();
        onClose();
        return;
      case 'stale_revision':
        // Nothing was saved. The page is re-read so the next try carries the newest revision; the typed
        // title stays in the field.
        setFailed(true);
        router.refresh();
        return;
      default:
        setFailed(true);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || title.length === 0) return;
    const trimmed = title.trim();
    if (trimmed === '') {
      setIssue('required');
      document.getElementById(TITLE_ID)?.focus();
      return;
    }
    if (codePoints(trimmed) > PROFILE_FORM_LIMITS.stepTitle) {
      setIssue('too_long');
      document.getElementById(TITLE_ID)?.focus();
      return;
    }
    // A rename that changes nothing has nothing to send: the sheet simply closes.
    if (mode === 'rename' && step && trimmed === step.title) {
      onClose();
      return;
    }

    setSaving(true);
    setFailed(false);
    let result: CreateStepResult | RenameStepResult = { ok: false, code: 'failed' };
    try {
      result =
        mode === 'rename' && step
          ? await renameStepAction({ id: step.id, revision: step.revision, title: trimmed })
          : await createStepAction({ title: trimmed });
    } catch {
      // A thrown request reads like any other failed write: the sheet stays open with the draft.
    } finally {
      setSaving(false);
    }
    if (!result.ok) {
      applyFailure(result);
      return;
    }
    toast.show({
      tone: 'success',
      message: mode === 'rename' ? ts('toasts.renamed') : ts('toasts.added'),
    });
    router.refresh();
    onClose();
  }

  async function removeStep() {
    if (!step) return;
    let result: DeleteStepActionResult = { ok: false, code: 'failed' };
    try {
      result = await deleteStepAction(step.id);
    } catch {
      // Falls through to the failure toast: the step was not changed as far as this screen knows.
    }
    if (result.ok) {
      toast.show({ tone: 'success', message: ts('toasts.deleted') });
      router.refresh();
      onClose();
      return;
    }
    if (applyShared(result.code)) return;
    switch (result.code) {
      case 'step_not_empty':
        // Questions arrived between the page read and the tap (UI-D-645).
        toast.show({ tone: 'error', message: ts('errors.notEmpty') });
        router.refresh();
        onClose();
        return;
      case 'last_step':
        toast.show({ tone: 'error', message: ts('sheet.last') });
        router.refresh();
        onClose();
        return;
      case 'gone':
        toast.show({ tone: 'error', message: ts('sheet.failed') });
        router.refresh();
        onClose();
        return;
      default:
        toast.show({ tone: 'error', message: ts('sheet.failed') });
    }
  }

  const titleError =
    issue === null
      ? undefined
      : issue === 'too_long'
        ? ts('sheet.errors.tooLong', { max: PROFILE_FORM_LIMITS.stepTitle })
        : ts('sheet.errors.required');
  const heading = mode === 'rename' ? ts('sheet.renameTitle') : ts('sheet.createTitle');
  const onlyStep = stepCount <= 1;

  return (
    <>
      <BottomSheet
        open={open}
        onClose={requestClose}
        title={heading}
        desktopCard={desktop}
        dismiss="handle"
        handleLabel={te('close')}
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <fieldset disabled={saving} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
            {failed ? (
              <div
                role="alert"
                data-step-failed
                className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
              >
                <CircleAlert aria-hidden size={16} className="mt-px shrink-0" />
                <span className="min-w-0 flex-1">{ts('sheet.failed')}</span>
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <Input
                id={TITLE_ID}
                label={ts('sheet.field')}
                placeholder={ts('sheet.placeholder')}
                maxLength={PROFILE_FORM_LIMITS.stepTitle}
                value={title}
                error={titleError}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setIssue(null);
                }}
              />
              <span aria-live="off" className="text-right text-xs tabular-nums text-text-tertiary">
                {ts('sheet.counter', {
                  n: codePoints(title),
                  max: PROFILE_FORM_LIMITS.stepTitle,
                })}
              </span>
            </div>
          </fieldset>

          <div className="flex flex-col gap-3">
            <Button
              type="submit"
              fullWidth
              size="lg"
              loading={saving}
              disabled={title.length === 0}
            >
              {saving ? ts('sheet.saving') : ts('sheet.save')}
            </Button>

            {mode === 'rename' && step ? (
              <div className="flex flex-col gap-3 border-t border-divider pt-3" data-remove-block>
                {onlyStep ? (
                  <p className="text-xs font-normal text-text-tertiary">{ts('sheet.last')}</p>
                ) : questionCount > 0 ? (
                  <p className="text-xs font-normal text-text-tertiary">{ts('sheet.notEmpty')}</p>
                ) : (
                  <Button
                    variant="ghost"
                    fullWidth
                    className="text-danger"
                    disabled={saving}
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 aria-hidden size={18} />
                    {ts('sheet.delete')}
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        </form>
      </BottomSheet>

      {/* Beside the sheet, never inside it: a `fixed` dialog inside the sheet's transformed panel would be
          positioned against the panel instead of the screen. */}
      <ConfirmDialog
        open={discardOpen}
        tone="brand"
        title={te('discard.title')}
        body={ts('sheet.discardBody')}
        confirmLabel={te('discard.confirm')}
        cancelLabel={te('discard.cancel')}
        onConfirm={() => onClose()}
        onClose={() => setDiscardOpen(false)}
      />
      <ConfirmDialog
        open={deleteOpen}
        tone="danger"
        icon={Trash2}
        title={ts('delete.title')}
        body={ts('delete.body')}
        confirmLabel={ts('delete.confirm')}
        cancelLabel={ts('delete.cancel')}
        onConfirm={removeStep}
        onClose={() => setDeleteOpen(false)}
      />
    </>
  );
}
