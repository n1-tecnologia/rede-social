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
import { CircleAlert, Layers } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useRef, useState } from 'react';
import { type BranchFieldKey, createBranchAction, type SaveBranchResult } from './actions';
import { BranchValuesPicker } from './BranchValuesPicker';

export interface BranchSheetProps {
  open: boolean;
  /** The question that decides (D-651: the branch is created from it); read-only in create mode. */
  opener: AdminQuestion;
  /** The tenant's steps in order: the opener's step shows as a pill from two steps on. */
  steps: AdminStep[];
  /** MUST be stable (`useCallback`): the shipped focus trap re-arms when it changes. */
  onClose: () => void;
  /** The branch was created: the host closes the sheet (the page was already refreshed here). */
  onSaved: (branch: AdminBranch) => void;
}

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
export function BranchSheet({ open, opener, steps, onClose, onSaved }: BranchSheetProps) {
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
