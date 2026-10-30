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
import { CircleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useRef, useState } from 'react';
import { isChoiceType } from '@/lib/profile-form/question-types';
import {
  createQuestionAction,
  type ImpactActionResult,
  readImpactAction,
  type SaveQuestionResult,
} from './actions';
import {
  blankDraft,
  canSave,
  changeType,
  type DraftErrors,
  type EditorMode,
  hasErrors,
  isDirty,
  type QuestionDraft,
  type Reopening,
  reopeningOf,
  serverFieldError,
  serverLimitsError,
  serverOptionsErrors,
  toCreateBody,
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
}

const TITLE_ID = 'pf-title';
const HELP_ID = 'pf-help';

/**
 * The question editor (12-16, D-585, D-590, D-593, D-594, UI-D-569..UI-D-573; PFORM-02, PFORM-22): ONE
 * `BottomSheet` (the centred card from `md`) to create a question. The order of the sheet is the order of
 * the contract: the LGPD notice first (never dismissible, no purpose field, no blocking of titles or
 * types), the type (nothing below the grid until a tile is chosen), the title and the help text with live
 * counters, the two switches and "Salvar pergunta".
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
}: QuestionEditorSheetProps) {
  const t = useTranslations('profileForm.admin');
  const te = useTranslations('profileForm.admin.editor');
  const tAdmin = useTranslations('admin');
  const router = useRouter();
  const toast = useToast();
  const desktop = useMediaQuery('(min-width: 768px)');

  const [initial] = useState<QuestionDraft>(() => blankDraft());
  const [draft, setDraft] = useState<QuestionDraft>(initial);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [saving, setSaving] = useState(false);
  const [gridOpen, setGridOpen] = useState(draft.type === null);
  const [discardOpen, setDiscardOpen] = useState(false);
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
    if (unsaved) setDiscardOpen(true);
    else close();
  }, []);

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
      result = await createQuestionAction(toCreateBody(draft), { reopens });
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
    toast.show({
      tone: 'success',
      message: reopens ? t('impact.added', { n: result.pending ?? 0 }).trim() : te('toasts.added'),
    });
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !canSave(draft)) return;
    const found = validateDraft(draft);
    setErrors(found);
    if (hasErrors(found)) {
      focusFirst(found);
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

            <TypePicker
              value={draft.type}
              onChange={(type) => setDraft((current) => changeType(current, type))}
              gridOpen={gridOpen}
              onGridOpenChange={setGridOpen}
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
                />
              </>
            ) : null}
          </fieldset>

          <Button type="submit" fullWidth size="lg" loading={saving} disabled={!canSave(draft)}>
            {saving ? te('saving') : te('save')}
          </Button>
        </form>
      </BottomSheet>

      {/* Beside the sheet, never inside it: a `fixed` dialog inside the sheet's transformed panel would be
          positioned against the panel instead of the screen. */}
      <ImpactDialog
        open={impactOpen}
        kind={impact?.kind ?? 'add'}
        members={impact?.members ?? 0}
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
        onConfirm={() => onClose()}
        onClose={() => setDiscardOpen(false)}
      />
    </>
  );
}
