'use client';

import { mediaAcceptFor, PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import {
  CATEGORY_MAX_NAME,
  type Category,
  type CategoryInput,
  type CategoryPatch,
} from '@rede-social/module-courses/contracts';
import { BottomSheet, Button, ConfirmDialog, Input, useToast } from '@rede-social/ui';
import { Image as ImageIcon, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useCoverPreview } from '@/components/media/useCoverPreview';
import { useSignedUpload } from '@/components/media/useSignedUpload';
import {
  type CategoryWriteResult,
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
} from './category-actions';

/**
 * The category sheet (08.3-07, D-411, UI-D-400, UI-D-404): "Nova categoria" / "Editar categoria"
 * over the shipped `BottomSheet` — a `FileDropZone`-less cover field (the 3:4 preview at 120px, the
 * add/change/remove controls; the upload is the Phase 3 machine, purpose `cover`), the `Input`
 * **Nome** (60) and the brand `fullWidth` submit. In edit mode, a hairline and the `ghost`
 * danger-ink **"Remover categoria"**: DISABLED with the helper "Esta categoria tem {N} cursos. Mude
 * a categoria deles antes de remover." while `courseCount > 0` — the rule is said BEFORE the tap —
 * else the danger "Remover categoria?" dialog. A `409 category_in_use` on a stale count toasts the
 * same sentence with the server's count; a `409 category_exists` renders the name error.
 *
 * Focus (UI-D-407): the name field on open (after the trap's own first-focus), back to the opener on
 * close (the trap). A dirty close asks "Descartar categoria?" first. The dialogs render BESIDE the
 * sheet, never inside its form.
 */
export interface CategorySheetProps {
  open: boolean;
  mode: 'new' | 'edit';
  /** Edit mode: the category as the list holds it (its `courseCount` decides the remove control). */
  category: Category | null;
  onClose: () => void;
  onCreated: (category: Category) => void;
  onUpdated: (category: Category) => void;
  onRemoved: (id: string) => void;
}

const ACCEPT = mediaAcceptFor('image', 'cover');

const GRADIENT = (
  <span
    aria-hidden
    className="block h-full w-full"
    style={{ backgroundImage: 'var(--brand-gradient)' }}
  />
);

export function CategorySheet({
  open,
  mode,
  category,
  onClose,
  onCreated,
  onUpdated,
  onRemoved,
}: CategorySheetProps) {
  const t = useTranslations('courses');
  const tm = useTranslations('media');
  const toast = useToast();

  const startName = category?.name ?? '';
  const startCover = category?.coverAssetId ?? null;
  const courseCount = category?.courseCount ?? 0;

  const [name, setName] = useState(startName);
  const [nameTouched, setNameTouched] = useState(false);
  const [serverNameError, setServerNameError] = useState<string | undefined>(undefined);
  const [coverAssetId, setCoverAssetId] = useState<string | null>(startCover);
  const [coverWidths, setCoverWidths] = useState<readonly number[]>(PURPOSE_WIDTHS.cover);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [pending, startTransition] = useTransition();

  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const preview = useCoverPreview(coverAssetId);
  const upload = useSignedUpload({
    kind: 'image',
    purpose: 'cover',
    successKey: null,
    onPicked: preview.onPicked,
    onCompleted: (asset) => {
      preview.onUploaded(asset.id);
      setCoverAssetId(asset.id);
      const widths = asset.variants.map((variant) => variant.width);
      setCoverWidths(widths.length > 0 ? widths : PURPOSE_WIDTHS.cover);
      setCoverError(null);
    },
  });
  const uploading = upload.state === 'preparing' || upload.state === 'progress';

  // UI-D-407: the name field on open, after the shipped trap's own first-focus has run.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => nameRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const nameError =
    serverNameError ??
    (nameTouched && name.trim().length === 0 ? t('category.form.errors.nameRequired') : undefined);
  const dirty = name !== startName || coverAssetId !== startCover;
  const valid = name.trim().length > 0;
  const busy = pending || uploading;
  const submittable = valid && (mode === 'new' || dirty);

  const requestClose = () => {
    if (dirty) {
      setDiscarding(true);
      return;
    }
    onClose();
  };

  const showRefusal = (result: Exclude<CategoryWriteResult, { ok: true }>) => {
    switch (result.code) {
      case 'title_required':
      case 'title_too_long':
        setServerNameError(t('category.form.errors.nameRequired'));
        return;
      case 'category_exists':
        setServerNameError(t('category.form.errors.nameExists'));
        return;
      case 'cover_invalid':
        setCoverError(t('form.errors.imageInvalid'));
        return;
      case 'disabled':
        toast.show({ tone: 'error', message: t('errors.disabled') });
        return;
      default:
        toast.show({ tone: 'error', message: t('form.errors.save') });
    }
  };

  const save = async () => {
    let result: CategoryWriteResult;
    try {
      if (mode === 'edit' && category) {
        const patch: CategoryPatch = {};
        if (name !== startName) patch.name = name;
        if (coverAssetId !== startCover) patch.coverAssetId = coverAssetId;
        result = await updateCategoryAction(category.id, patch);
      } else {
        const body: CategoryInput = { name, coverAssetId };
        result = await createCategoryAction(body);
      }
    } catch (error) {
      console.error('courses.category_save_failed', { error: String(error) });
      toast.show({ tone: 'error', message: t('form.errors.save') });
      return;
    }
    if (!result.ok) {
      showRefusal(result);
      return;
    }
    if (result.category === null) return;
    if (mode === 'edit') onUpdated(result.category);
    else onCreated(result.category);
  };

  const submit = () => {
    setServerNameError(undefined);
    setNameTouched(true);
    if (!valid) return;
    startTransition(async () => {
      await save();
    });
  };

  const remove = async () => {
    if (!category) return;
    let result: CategoryWriteResult;
    try {
      result = await deleteCategoryAction(category.id);
    } catch (error) {
      console.error('courses.category_delete_failed', { error: String(error) });
      toast.show({ tone: 'error', message: t('form.errors.save') });
      return;
    }
    if (!result.ok) {
      if (result.code === 'category_in_use') {
        // The count was stale: the same sentence the helper would have said, as a toast.
        toast.show({
          tone: 'error',
          message: t('category.inUse', { N: result.courseCount ?? courseCount }),
        });
      } else {
        toast.show({
          tone: 'error',
          message: result.code === 'disabled' ? t('errors.disabled') : t('form.errors.save'),
        });
      }
      return;
    }
    onRemoved(category.id);
  };

  const submitLabel = pending
    ? mode === 'edit'
      ? t('form.saving')
      : t('form.creating')
    : mode === 'edit'
      ? t('form.save')
      : t('category.form.create');

  return (
    <>
      <BottomSheet
        open={open}
        onClose={requestClose}
        title={mode === 'edit' ? t('category.form.editTitle') : t('category.form.createTitle')}
      >
        <form
          data-category-sheet
          data-mode={mode}
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {/* ── Capa: the 3:4 preview at 120px (the catalogue's category art, UI-D-409). ── */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-normal text-text-secondary">{t('form.cover.label')}</span>
            <div
              data-category-cover-preview
              className="relative aspect-[3/4] w-full max-w-[120px] overflow-hidden rounded-xl bg-bg-tertiary"
            >
              {preview.previewUrl ? (
                // biome-ignore lint/performance/noImgElement: a local object URL of the file being uploaded
                <img
                  src={preview.previewUrl}
                  alt={t('form.cover.preview')}
                  data-category-cover-local
                  className="h-full w-full object-cover object-center"
                />
              ) : coverAssetId !== null ? (
                <MediaImage
                  assetId={coverAssetId}
                  widths={coverWidths}
                  alt={t('form.cover.preview')}
                  sizes="120px"
                  ratio=""
                  className="h-full w-full"
                  fallback={GRADIENT}
                />
              ) : (
                <span
                  data-category-cover-fallback
                  aria-hidden
                  className="block h-full w-full"
                  style={{ backgroundImage: 'var(--brand-gradient)' }}
                />
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              aria-label={
                coverAssetId ? t('category.form.coverChange') : t('category.form.coverAdd')
              }
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void upload.pick(file);
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                loading={uploading}
                onClick={() => fileRef.current?.click()}
              >
                <ImageIcon aria-hidden size={16} className="shrink-0" />
                {coverAssetId ? t('category.form.coverChange') : t('category.form.coverAdd')}
              </Button>
              {coverAssetId ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="px-2"
                  disabled={uploading}
                  onClick={() => {
                    setCoverAssetId(null);
                    setCoverError(null);
                    upload.reset();
                  }}
                >
                  <X aria-hidden size={16} className="shrink-0" />
                  {t('category.form.coverRemove')}
                </Button>
              ) : null}
            </div>
            {upload.state === 'progress' ? (
              <span className="text-xs tabular-nums text-text-tertiary">
                {tm('progress', { percent: upload.progress })}
              </span>
            ) : null}
            {upload.error || coverError ? (
              <p role="alert" data-category-cover-error className="text-sm font-normal text-danger">
                {upload.error ?? coverError}
              </p>
            ) : null}
            <p className="text-xs font-normal text-text-tertiary">
              {t('category.form.coverHelper')}
            </p>
          </div>

          {/* ── Nome ── */}
          <Input
            ref={nameRef}
            id="category-name"
            name="name"
            label={t('category.form.name')}
            placeholder={t('category.form.namePlaceholder')}
            value={name}
            maxLength={CATEGORY_MAX_NAME}
            required
            error={nameError}
            onChange={(event) => {
              setName(event.target.value);
              setServerNameError(undefined);
            }}
            onBlur={() => setNameTouched(true)}
          />

          <Button
            type="submit"
            variant="brand"
            size="md"
            fullWidth
            disabled={!submittable || busy}
            loading={pending}
            aria-busy={busy || undefined}
          >
            {submitLabel}
          </Button>

          {/* ── Edit only: the rule said before the tap (UI-D-400). ── */}
          {mode === 'edit' && category ? (
            <>
              <div aria-hidden className="h-px bg-border" />
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  data-category-remove
                  className="justify-start self-start px-0 text-danger"
                  disabled={courseCount > 0}
                  aria-describedby={courseCount > 0 ? 'category-remove-helper' : undefined}
                  onClick={() => setRemoving(true)}
                >
                  <Trash2 aria-hidden size={20} />
                  {t('category.form.remove')}
                </Button>
                {courseCount > 0 ? (
                  <p
                    id="category-remove-helper"
                    data-category-remove-helper
                    className="text-xs font-normal text-text-tertiary"
                  >
                    {t('category.inUse', { N: courseCount })}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </form>
      </BottomSheet>

      <ConfirmDialog
        open={discarding}
        tone="danger"
        title={t('discard.category')}
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
        title={t('category.removeDialog.title')}
        body={t('category.removeDialog.body')}
        confirmLabel={t('category.removeDialog.confirm')}
        cancelLabel={t('category.removeDialog.cancel')}
        onConfirm={remove}
        onClose={() => setRemoving(false)}
        onError={(error) => {
          console.error('courses.category_delete_failed', { error: String(error) });
          toast.show({ tone: 'error', message: t('form.errors.save') });
        }}
      />
    </>
  );
}
