'use client';

import { mediaAcceptFor, PURPOSE_WIDTHS } from '@rede-social/contracts/media';
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
  Textarea,
  useMediaQuery,
  useToast,
} from '@rede-social/ui';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { CoverSizeHint } from '@/components/media/CoverSizeHint';
import { useCoverPreview } from '@/components/media/useCoverPreview';
import { useSignedUpload } from '@/components/media/useSignedUpload';
import { DANGER_OVERRIDES } from '../admin-styles';
import { CoverField } from '../CoverField';
import { PagePreview } from '../CoverPreviews';
import {
  createModuleAction,
  deleteModuleAction,
  type ModuleWriteResult,
  updateModuleAction,
} from '../curriculum-actions';
import { SwitchRow } from '../SwitchRow';

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
 *
 * 2026-10-22 (the courses area redesign): the switch is a `SwitchRow` block (the panel's: name,
 * helper, switch), and "Remover módulo" is the danger zone's outlined button under the hairline. No
 * behaviour changed.
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

/** The cover field's accepted types. */
const MODULE_COVER_ACCEPT = mediaAcceptFor('image', 'cover');
/** Announced at these percentages only, not on every tick (the `CommunityForm` rule). */
const QUARTILES = [25, 50, 75, 100];

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
  const tm = useTranslations('media');
  const desktop = useMediaQuery('(min-width: 768px)');
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

  // 12.3-08 (NOVF-03, OQ-1, UI-D-691): a module has TWO image columns, so the sheet holds two real
  // pickers, each its own Phase 3 upload machine (purpose `cover`) and its own asset id: the card
  // image (16:9) and the Topo (4:1). An empty one is sent as null and never filled from the other or
  // from the course's cover: the member pages compute that fallback (`lib/cover-fallback.ts`).
  const startCover = module?.coverAssetId ?? null;
  const startTopCover = module?.topCoverAssetId ?? null;
  const [coverAssetId, setCoverAssetId] = useState<string | null>(startCover);
  const [coverWidths, setCoverWidths] = useState<readonly number[]>(PURPOSE_WIDTHS.cover);
  const [topCoverAssetId, setTopCoverAssetId] = useState<string | null>(startTopCover);
  const [topCoverWidths, setTopCoverWidths] = useState<readonly number[]>(PURPOSE_WIDTHS.cover);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [topCoverError, setTopCoverError] = useState<string | null>(null);

  const coverPreview = useCoverPreview(coverAssetId);
  const coverUpload = useSignedUpload({
    kind: 'image',
    purpose: 'cover',
    // No toast: the preview replacing the gradient IS the confirmation; nothing is saved yet.
    successKey: null,
    onPicked: coverPreview.onPicked,
    onCompleted: (asset) => {
      coverPreview.onUploaded(asset.id);
      setCoverAssetId(asset.id);
      const widths = asset.variants.map((variant) => variant.width);
      setCoverWidths(widths.length > 0 ? widths : PURPOSE_WIDTHS.cover);
      setCoverError(null);
    },
  });
  const coverUploading = coverUpload.state === 'preparing' || coverUpload.state === 'progress';
  const coverAnnounced = QUARTILES.includes(coverUpload.progress)
    ? tm('progress', { percent: coverUpload.progress })
    : '';

  const topPreview = useCoverPreview(topCoverAssetId);
  const topUpload = useSignedUpload({
    kind: 'image',
    purpose: 'cover',
    successKey: null,
    onPicked: topPreview.onPicked,
    onCompleted: (asset) => {
      topPreview.onUploaded(asset.id);
      setTopCoverAssetId(asset.id);
      const widths = asset.variants.map((variant) => variant.width);
      setTopCoverWidths(widths.length > 0 ? widths : PURPOSE_WIDTHS.cover);
      setTopCoverError(null);
    },
  });
  const topUploading = topUpload.state === 'preparing' || topUpload.state === 'progress';
  const topAnnounced = QUARTILES.includes(topUpload.progress)
    ? tm('progress', { percent: topUpload.progress })
    : '';

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
    title !== startTitle ||
    summary !== startSummary ||
    requiresPrevious !== startRequires ||
    coverAssetId !== startCover ||
    topCoverAssetId !== startTopCover;
  const valid = title.trim().length > 0;
  const busy = pending || coverUploading || topUploading;
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
      case 'cover_invalid':
        setCoverError(t('form.errors.imageInvalid'));
        return;
      case 'top_cover_invalid':
        setTopCoverError(t('coverField.topCover.invalid'));
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
        // The PATCH carries only what changed; an image removed is an explicit null.
        if (coverAssetId !== startCover) patch.coverAssetId = coverAssetId;
        if (topCoverAssetId !== startTopCover) patch.topCoverAssetId = topCoverAssetId;
        result = await updateModuleAction(courseId, module.id, patch);
      } else {
        // A create always names both images, null for one never set (never the other's id).
        const body: ModuleInput = {
          title,
          summary,
          requiresPrevious,
          coverAssetId,
          topCoverAssetId,
        };
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
    setCoverError(null);
    setTopCoverError(null);
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
        // 2026-10-27 (the product owner: "o ato de criar um módulo quero que abra um popup ao
        // centro"): the centred card from `md`, the sheet from the bottom on a phone.
        desktopCard={desktop}
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
          <CoverField
            hook="module"
            ratio="video"
            layout="blocks"
            frameLabel={t('coverField.as.moduleCard')}
            accept={MODULE_COVER_ACCEPT}
            assetId={coverAssetId}
            widths={coverWidths}
            previewUrl={coverPreview.previewUrl}
            sizes="360px"
            upload={coverUpload}
            error={coverError}
            helper={t('module.form.coverHelper')}
            announced={coverAnnounced}
            topCover={{
              assetId: topCoverAssetId,
              widths: topCoverWidths,
              previewUrl: topPreview.previewUrl,
              upload: topUpload,
              error: topCoverError,
              announced: topAnnounced,
              ratio: 'banner',
              sizeHint: <CoverSizeHint kind="moduleBanner" />,
              helper: t('module.form.topCoverHelper'),
              fallbackStatus: t('coverField.topCover.fallback'),
              decor: <PagePreview title={title.trim()} line={summary.trim()} />,
              labels: {
                field: t('coverField.as.modulePage'),
                add: t('coverField.topCover.add'),
                change: t('coverField.topCover.change'),
                remove: t('coverField.topCover.remove'),
                preview: t('coverField.topCover.preview'),
                pickFile: t('coverField.pickFile'),
                camera: t('coverField.camera'),
                dropHere: t('coverField.topCover.dropHere'),
                progress: (percent) => tm('progress', { percent }),
                processing: tm('photo.preparing'),
                cancel: tm('cancel'),
              },
              onPick: (file) => void topUpload.pick(file),
              onRemove: () => {
                setTopCoverAssetId(null);
                setTopCoverError(null);
                topUpload.reset();
              },
              onCancel: topUpload.cancel,
            }}
            sizeHint={<CoverSizeHint kind="moduleCard" />}
            labels={{
              pickFile: t('coverField.pickFile'),
              camera: t('coverField.camera'),
              ways: t('coverField.ways'),
              waysTouch: t('coverField.waysTouch'),
              dropHere: t('coverField.dropHere'),
              field: t('module.form.cover'),
              add: t('form.cover.add'),
              change: t('form.cover.change'),
              remove: t('form.cover.remove'),
              preview: t('form.cover.preview'),
              progress: (percent) => tm('progress', { percent }),
              processing: tm('photo.preparing'),
              cancel: tm('cancel'),
            }}
            onPick={(file) => void coverUpload.pick(file)}
            onRemove={() => {
              setCoverAssetId(null);
              setCoverError(null);
              coverUpload.reset();
            }}
            onCancel={coverUpload.cancel}
          />

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
          <SwitchRow
            id="module-requires"
            hook="module-requires"
            label={t('module.form.requiresPrevious')}
            helper={
              firstModule ? t('module.form.firstModule') : t('module.form.requiresPreviousHelper')
            }
            checked={requiresPrevious}
            onChange={setRequiresPrevious}
            disabled={firstModule}
          />

          <Button
            type="submit"
            variant="brand"
            size="md"
            fullWidth
            disabled={!submittable || busy}
            loading={busy}
          >
            {submitLabel}
          </Button>

          {mode === 'edit' && module ? (
            <>
              <div aria-hidden className="h-px bg-border" />
              <Button
                type="button"
                variant="outline"
                size="md"
                data-module-remove
                className={DANGER_OVERRIDES}
                onClick={() => setRemoving(true)}
              >
                <Trash2 aria-hidden size={18} />
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
