'use client';

import {
  MODULE_MAX_SUMMARY,
  MODULE_MAX_TITLE,
  type ModuleInput,
  type ModulePatch,
  type ModuleView,
} from '@rede-social/module-courses/contracts';
import {
  BottomSheet,
  Button,
  ConfirmDialog,
  Input,
  Switch,
  Textarea,
  useToast,
} from '@rede-social/ui';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import {
  createModuleAction,
  deleteModuleAction,
  type ModuleWriteResult,
  updateModuleAction,
} from '../curriculum-actions';

/**
 * The module sheet (08.3-08, D-406, UI-D-396, UI-D-404, UI-D-407): "Novo módulo" / "Editar módulo"
 * over the shipped `BottomSheet` — the `Input` **Título** (120, required), the `Textarea` **Resumo**
 * (500, optional, 3 rows, the counter), the `Switch` row **"Exige concluir o módulo anterior"** with
 * its helper — present but DISABLED with "Este é o primeiro módulo." on the first module, where the
 * API forces the flag off — and the brand `fullWidth` submit "Criar módulo" / "Salvar alterações"
 * ("Criando…" / "Salvando…" while pending). In edit mode, under a hairline, the `ghost` danger-ink
 * **"Remover módulo"** (`Trash2` 20) → the danger "Remover módulo?" dialog → `deleteModuleAction`.
 *
 * Focus: the title field on open (after the trap's own first-focus), back to the opener on close
 * (the trap). A dirty close asks "Descartar módulo?" first. An empty title is the field error; a save
 * failure toasts and keeps the sheet; a remove failure toasts and keeps the row (E07 error). The
 * dialogs render BESIDE the sheet, never inside its form (the category sheet's rule).
 */
export interface ModuleSheetProps {
  open: boolean;
  mode: 'new' | 'edit';
  courseId: string;
  /** Edit mode: the module as the editor's draft holds it. */
  module: ModuleView | null;
  /** The module's 1-based position in the draft (the next one on create): `1` disables the switch. */
  position: number;
  onClose: () => void;
  onCreated: (module: ModuleView) => void;
  onUpdated: (module: ModuleView) => void;
  onRemoved: (id: string) => void;
}

export function ModuleSheet({
  open,
  mode,
  courseId,
  module,
  position,
  onClose,
  onCreated,
  onUpdated,
  onRemoved,
}: ModuleSheetProps) {
  const t = useTranslations('courses');
  const toast = useToast();

  const startTitle = module?.title ?? '';
  const startSummary = module?.summary ?? '';
  const firstModule = position === 1;
  // WR-02 (08.3 review): the EFFECTIVE value — a first module never requires a previous one, so a
  // stale stored `true` must not open the sheet already dirty (nor be silently written on save).
  const startRequires = firstModule ? false : (module?.requiresPrevious ?? false);

  const [title, setTitle] = useState(startTitle);
  const [titleTouched, setTitleTouched] = useState(false);
  const [serverTitleError, setServerTitleError] = useState<string | undefined>(undefined);
  const [summary, setSummary] = useState(startSummary);
  // D-406: the first module never requires a previous one — the API forces it off, the switch says so.
  const [requiresPrevious, setRequiresPrevious] = useState(startRequires);
  const [discarding, setDiscarding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [pending, startTransition] = useTransition();

  const titleRef = useRef<HTMLInputElement>(null);

  // UI-D-407: the title field on open, after the shipped trap's own first-focus has run.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const titleError =
    serverTitleError ??
    (titleTouched && title.trim().length === 0 ? t('module.form.errors.titleRequired') : undefined);
  const dirty =
    title !== startTitle || summary !== startSummary || requiresPrevious !== startRequires;
  const valid = title.trim().length > 0;
  const submittable = valid && (mode === 'new' || dirty);

  const requestClose = () => {
    if (dirty) {
      setDiscarding(true);
      return;
    }
    onClose();
  };

  const showRefusal = (result: Exclude<ModuleWriteResult, { ok: true }>) => {
    switch (result.code) {
      case 'title_required':
      case 'title_too_long':
        setServerTitleError(t('module.form.errors.titleRequired'));
        return;
      case 'disabled':
        toast.show({ tone: 'error', message: t('errors.disabled') });
        return;
      default:
        toast.show({ tone: 'error', message: t('form.errors.save') });
    }
  };

  const save = async () => {
    let result: ModuleWriteResult;
    try {
      if (mode === 'edit' && module) {
        const patch: ModulePatch = {};
        if (title !== startTitle) patch.title = title;
        if (summary !== startSummary) patch.summary = summary;
        if (requiresPrevious !== startRequires) patch.requiresPrevious = requiresPrevious;
        result = await updateModuleAction(courseId, module.id, patch);
      } else {
        const body: ModuleInput = { title, summary, requiresPrevious };
        result = await createModuleAction(courseId, body);
      }
    } catch (error) {
      console.error('courses.module_save_failed', { error: String(error) });
      toast.show({ tone: 'error', message: t('form.errors.save') });
      return;
    }
    if (!result.ok) {
      showRefusal(result);
      return;
    }
    if (result.module === null) return;
    if (mode === 'edit') onUpdated(result.module);
    else onCreated(result.module);
  };

  const submit = () => {
    setServerTitleError(undefined);
    setTitleTouched(true);
    if (!valid) return;
    startTransition(async () => {
      await save();
    });
  };

  const remove = async () => {
    if (!module) return;
    let result: ModuleWriteResult;
    try {
      result = await deleteModuleAction(courseId, module.id);
    } catch (error) {
      console.error('courses.module_delete_failed', { error: String(error) });
      toast.show({ tone: 'error', message: t('form.errors.save') });
      return;
    }
    if (!result.ok) {
      toast.show({
        tone: 'error',
        message: result.code === 'disabled' ? t('errors.disabled') : t('form.errors.save'),
      });
      return;
    }
    onRemoved(module.id);
  };

  const submitLabel = pending
    ? mode === 'edit'
      ? t('form.saving')
      : t('form.creating')
    : mode === 'edit'
      ? t('form.save')
      : t('module.form.create');

  return (
    <>
      <BottomSheet
        open={open}
        onClose={requestClose}
        title={mode === 'edit' ? t('module.form.editTitle') : t('module.form.createTitle')}
      >
        <form
          data-module-sheet
          data-mode={mode}
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Input
            ref={titleRef}
            id="module-title"
            name="title"
            label={t('module.form.title')}
            placeholder={t('module.form.titlePlaceholder')}
            value={title}
            maxLength={MODULE_MAX_TITLE}
            required
            error={titleError}
            onChange={(event) => {
              setTitle(event.target.value);
              setServerTitleError(undefined);
            }}
            onBlur={() => setTitleTouched(true)}
          />

          <Textarea
            id="module-summary"
            name="summary"
            label={t('module.form.summary')}
            placeholder={t('module.form.summaryPlaceholder')}
            value={summary}
            rows={3}
            maxLength={MODULE_MAX_SUMMARY}
            counter={{ value: summary.length, max: MODULE_MAX_SUMMARY }}
            onChange={(event) => setSummary(event.target.value)}
          />

          {/* D-406: the sequential lock, modeled now and enforced in the member phase. */}
          <div data-module-requires className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span id="module-requires-label" className="text-sm font-bold text-text">
                {t('module.form.requiresPrevious')}
              </span>
              <span
                id="module-requires-helper"
                data-module-requires-helper
                className="text-xs font-normal text-text-tertiary"
              >
                {firstModule
                  ? t('module.form.firstModule')
                  : t('module.form.requiresPreviousHelper')}
              </span>
            </div>
            <Switch
              checked={requiresPrevious}
              onChange={setRequiresPrevious}
              label={t('module.form.requiresPrevious')}
              aria-describedby="module-requires-helper"
              disabled={firstModule}
              className="mt-0.5"
            />
          </div>

          <Button
            type="submit"
            variant="brand"
            size="md"
            fullWidth
            disabled={!submittable || pending}
            loading={pending}
          >
            {submitLabel}
          </Button>

          {mode === 'edit' && module ? (
            <>
              <div aria-hidden className="h-px bg-border" />
              <Button
                type="button"
                variant="ghost"
                size="md"
                data-module-remove
                className="justify-start self-start px-0 text-danger"
                onClick={() => setRemoving(true)}
              >
                <Trash2 aria-hidden size={20} />
                {t('module.form.remove')}
              </Button>
            </>
          ) : null}
        </form>
      </BottomSheet>

      <ConfirmDialog
        open={discarding}
        tone="danger"
        title={t('discard.module')}
        body={t('discard.body')}
        confirmLabel={t('discard.confirm')}
        cancelLabel={t('discard.cancel')}
        onConfirm={() => {
          setDiscarding(false);
          onClose();
        }}
        onClose={() => setDiscarding(false)}
      />

      <ConfirmDialog
        open={removing}
        tone="danger"
        icon={Trash2}
        title={t('module.removeDialog.title')}
        body={t('module.removeDialog.body')}
        confirmLabel={t('module.removeDialog.confirm')}
        cancelLabel={t('module.removeDialog.cancel')}
        onConfirm={remove}
        onClose={() => setRemoving(false)}
        onError={(error) => {
          console.error('courses.module_delete_failed', { error: String(error) });
          toast.show({ tone: 'error', message: t('form.errors.save') });
        }}
      />
    </>
  );
}
