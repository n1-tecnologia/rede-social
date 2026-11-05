'use client';

import { mediaAcceptFor, PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import {
  CATEGORY_MAX_NAME,
  type Category,
  type CategoryInput,
  type CategoryPatch,
} from '@rede-social/module-courses/contracts';
import { BottomSheet, Button, ConfirmDialog, Input, useToast } from '@rede-social/ui';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { CoverSizeHint } from '@/components/media/CoverSizeHint';
import { useCoverPreview } from '@/components/media/useCoverPreview';
import { useSignedUpload } from '@/components/media/useSignedUpload';
import { DANGER_OVERRIDES } from '../admin-styles';
import { CoverField } from '../CoverField';
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
 *
 * 2026-10-22 (the courses area redesign): the cover is the shared `CoverField` in its compact frame
 * (the 120px 3:4 frame IS the control, "Remover capa" on the label line, no drop zone), and "Remover
 * categoria" is the danger zone's outlined button, still disabled with its reason while courses use
 * the category. No behaviour changed.
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
          {/* ── Capa: the 3:4 frame at 120px (the catalogue's category art, UI-D-409). ── */}
          <CoverField
            hook="category"
            ratio="poster"
            compact
            accept={ACCEPT}
            assetId={coverAssetId}
            widths={coverWidths}
            previewUrl={preview.previewUrl}
            sizes="120px"
            upload={upload}
            error={coverError}
            helper={t('category.form.coverHelper')}
            alsoAs={[{ key: 'tile', ratio: 'tile', label: t('coverField.as.tile') }]}
            sizeHint={<CoverSizeHint kind="category" />}
            labels={{
              pickFile: t('coverField.pickFile'),
              camera: t('coverField.camera'),
              ways: t('coverField.ways'),
              waysTouch: t('coverField.waysTouch'),
              dropHere: t('coverField.dropHere'),
              field: t('form.cover.label'),
              add: t('category.form.coverAdd'),
              change: t('category.form.coverChange'),
              remove: t('category.form.coverRemove'),
              preview: t('form.cover.preview'),
              progress: (percent) => tm('progress', { percent }),
              processing: tm('photo.preparing'),
            }}
            onPick={(file) => void upload.pick(file)}
            onRemove={() => {
              setCoverAssetId(null);
              setCoverError(null);
              upload.reset();
            }}
          />

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
                  variant="outline"
                  size="md"
                  data-category-remove
                  className={DANGER_OVERRIDES}
                  disabled={courseCount > 0}
                  aria-describedby={courseCount > 0 ? 'category-remove-helper' : undefined}
                  onClick={() => setRemoving(true)}
                >
                  <Trash2 aria-hidden size={18} />
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
