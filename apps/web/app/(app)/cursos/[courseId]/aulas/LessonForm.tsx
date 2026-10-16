'use client';

import {
  LESSON_MAX_DESCRIPTION,
  LESSON_MAX_MATERIALS,
  LESSON_MAX_TITLE,
  type LessonInput,
  type LessonPatch,
} from '@rede-social/module-courses/contracts';
import {
  Button,
  ConfirmDialog,
  Input,
  PageHeader,
  Switch,
  Textarea,
  useToast,
} from '@rede-social/ui';
import { Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useState, useTransition } from 'react';
import {
  type LessonFormDefaults,
  type LessonFormVideo,
  lessonHref,
  type MaterialDraft,
} from '@/lib/courses-view';
import {
  createLessonAction,
  deleteLessonAction,
  type LessonWriteResult,
  materialUrlAction,
  replaceMaterialsAction,
  updateLessonAction,
} from '../../lesson-actions';
import { MaterialsList } from './MaterialsList';
import { VideoBlock } from './VideoBlock';

/**
 * THE lesson form (08.3-09, D-407, D-409, D-410, D-413, UI-D-398, UI-D-399, UI-D-404, UI-D-405,
 * UI-D-411, COURSE-06, COURSE-07): one component, two routes — `…/aulas/nova?modulo=` in `create`
 * mode and `…/aulas/[lessonId]` in `edit` mode. The `ProductForm` / `CourseForm` shell: a task
 * screen (`data-shell-hide="nav"`), the `PageHeader` with the 44×44 `X` close (a dirty form asks
 * "Descartar aula?" first) and the brand submit "Criar aula" / "Salvar alterações" in the trailing
 * slot, with the module named under it ("Módulo {position} · {module}").
 *
 * Sections in order (UI-D-398): Título (120), Descrição (2 000, the counter), the `VideoBlock`
 * (five states on the direct Mux upload under the `lesson` purpose — the form SAVES IN ANY OF THEM;
 * only publishing the course waits, D-413), the "Aula aberta" `Switch` (D-407: its helper says what
 * the flag means on a gated course, or that an open course needs no sample — the switch stays
 * editable either way), the "Exige concluir a aula anterior" `Switch` (08.5-10, D-428, UI-D-438,
 * A-UI-6: its helper says why before the tap — disabled on the first lesson of the course, disabled
 * and OFF while "Aula aberta" is on, the rule's sentence otherwise; the server forces it off on both
 * anyway, plan 03), the `MaterialsList` (D-410), and on edit the hairline and the `ghost` danger
 * "Remover aula" → "Remover aula?" → "Aula removida.".
 *
 * **ZERO UPLOAD CODE LIVES HERE.** The video runs the kernel field browser → provider; every material
 * runs `useSignedUpload` browser → Storage; this file holds asset ids, never bytes (MEDIA-01, PR-7).
 * **Nothing about the video is typed** (D-409, PR-6): no URL, no embed, no duration, no thumbnail —
 * the caption is the asset's seconds, read by the block.
 *
 * Saving: create → `createLessonAction` with the whole body, then — only when the draft carries
 * materials — ONE `replaceMaterialsAction` with the set in the admin's order; edit → the patch with
 * ONLY the changed keys (`videoAssetId: null` detaches), then ONE `replaceMaterialsAction` only when
 * the set or the order changed (UI-D-399). A saved row's name mints a fresh ten-minute URL per tap
 * through `materialUrlAction` and opens it with `noopener` (T-08.3-06); the URL is never kept.
 *
 * Every field renders as React text (UI-D-407, T-08.3-25); every string comes from the catalogs.
 */
export type LessonFormMode = 'create' | 'edit';

export interface LessonFormProps {
  mode: LessonFormMode;
  courseId: string;
  moduleId: string;
  moduleTitle: string;
  /** The module's 1-based position in the course (the subtitle's numeral). */
  modulePosition: number;
  /** D-407: a product gates the course (store on AND a link exists) — picks the free helper. */
  hasProducts: boolean;
  /**
   * 08.5-10 (D-428, UI-D-438): the lesson is (or, created now, would be) the course's first one —
   * `isFirstLessonOfCourse` over the course detail. The sequence switch is then disabled and off.
   */
  isFirstLesson: boolean;
  /** Edit mode only. */
  lessonId?: string;
  /** Edit mode only: the saved lesson as the form holds it (`lessonFormDefaults`). */
  initial?: LessonFormDefaults;
}

const EMPTY: LessonFormDefaults = {
  title: '',
  description: '',
  video: null,
  isFree: false,
  requiresPrevious: false,
  materials: [],
};

/** Same asset ids in the same order: the materials set is ORDERED (P28). */
export function sameOrder(a: readonly MaterialDraft[], b: readonly MaterialDraft[]): boolean {
  return a.length === b.length && a.every((item, index) => item.assetId === b[index]?.assetId);
}

export function LessonForm({
  mode,
  courseId,
  moduleId,
  moduleTitle,
  modulePosition,
  hasProducts,
  isFirstLesson,
  lessonId,
  initial,
}: LessonFormProps) {
  const t = useTranslations('courses');
  const tm = useTranslations('media');
  const toast = useToast();
  const router = useRouter();

  const start = initial ?? EMPTY;
  const returnHref = `/cursos/${encodeURIComponent(courseId)}`;

  const [title, setTitle] = useState(start.title);
  const [description, setDescription] = useState(start.description);
  const [video, setVideo] = useState<LessonFormVideo | null>(start.video);
  const [isFree, setIsFree] = useState(start.isFree);
  // D-428: the EFFECTIVE starting value (the ModuleSheet WR-02 rule) — a first or a free lesson never
  // requires the previous one, so a stale stored `true` neither opens the form dirty nor is re-sent.
  const startRequires = isFirstLesson || start.isFree ? false : start.requiresPrevious;
  const [requiresPrevious, setRequiresPrevious] = useState(startRequires);
  const [materials, setMaterials] = useState<MaterialDraft[]>(() => [...start.materials]);

  const [titleTouched, setTitleTouched] = useState(false);
  const [serverTitleError, setServerTitleError] = useState<string | undefined>(undefined);
  const [materialsError, setMaterialsError] = useState<string | null>(null);
  const [materialsBusy, setMaterialsBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [pending, startTransition] = useTransition();

  const onVideoChange = useCallback((next: LessonFormVideo | null) => setVideo(next), []);
  const onMaterialsChange = useCallback((next: MaterialDraft[]) => {
    setMaterialsError(null);
    setMaterials(next);
  }, []);
  const onMaterialsBusy = useCallback((busy: boolean) => setMaterialsBusy(busy), []);

  /* ── Verdicts, dirtiness and the submit gate ─────────────────────────────────────────────────── */
  const titleError =
    serverTitleError ??
    (titleTouched && title.trim().length === 0 ? t('lesson.form.errors.titleRequired') : undefined);
  const videoAssetId = video?.assetId ?? null;
  const startVideoAssetId = start.video?.assetId ?? null;
  const materialsChanged = !sameOrder(materials, start.materials);
  // A-UI-6: while "Aula aberta" is on (or on the first lesson) the rule is off and sent `false`.
  const requiresLocked = isFirstLesson || isFree;
  const requiresValue = requiresLocked ? false : requiresPrevious;
  const dirty =
    title !== start.title ||
    description !== start.description ||
    videoAssetId !== startVideoAssetId ||
    isFree !== start.isFree ||
    requiresValue !== startRequires ||
    materialsChanged;
  const valid = title.trim().length > 0;
  const busy = pending || materialsBusy;
  const submittable = valid && (mode === 'create' || dirty);

  const close = () => {
    if (dirty) {
      setDiscarding(true);
      return;
    }
    router.push(returnHref);
  };

  /** Field issues land under their field; anything else is the save toast (draft kept). */
  const showRefusal = (result: Exclude<LessonWriteResult, { ok: true }>) => {
    switch (result.code) {
      case 'title_required':
      case 'title_too_long':
        setServerTitleError(t('lesson.form.errors.titleRequired'));
        return;
      case 'too_many_materials':
        setMaterialsError(
          t('lesson.form.errors.tooManyMaterials', { limit: LESSON_MAX_MATERIALS }),
        );
        return;
      case 'material_invalid':
        setMaterialsError(t('form.errors.save'));
        return;
      case 'disabled':
        toast.show({ tone: 'error', message: t('errors.disabled') });
        return;
      default:
        // `video_invalid`, `video_in_use`, `not_found`, `generic`: the save sentence, the draft kept.
        toast.show({ tone: 'error', message: t('form.errors.save') });
    }
  };

  /** Runs the write(s); resolves once the outcome has been shown (or the page left). */
  const save = async (): Promise<void> => {
    const assetIds = materials.map((item) => item.assetId);
    try {
      if (mode === 'create') {
        // D-428: the switch's effective value — `false` on the first lesson and on a free one.
        const body: LessonInput = {
          title,
          description,
          videoAssetId,
          isFree,
          requiresPrevious: requiresValue,
        };
        const created = await createLessonAction(courseId, moduleId, body);
        if (!created.ok) {
          showRefusal(created);
          return;
        }
        const id = created.lesson?.id;
        if (id && assetIds.length > 0) {
          const replaced = await replaceMaterialsAction(courseId, id, assetIds);
          if (!replaced.ok) {
            // The lesson exists; its materials did not land. Say so and open it for a retry.
            toast.show({ tone: 'error', message: t('form.errors.save') });
            router.push(lessonHref(courseId, id));
            return;
          }
        }
        toast.show({ tone: 'success', message: t('toasts.lessonCreated') });
        router.push(returnHref);
        return;
      }

      if (!lessonId) return;
      const patch: LessonPatch = {};
      if (title !== start.title) patch.title = title;
      if (description !== start.description) patch.description = description;
      if (videoAssetId !== startVideoAssetId) patch.videoAssetId = videoAssetId;
      if (isFree !== start.isFree) patch.isFree = isFree;
      if (requiresValue !== startRequires) patch.requiresPrevious = requiresValue;
      if (Object.keys(patch).length > 0) {
        const updated = await updateLessonAction(courseId, lessonId, patch);
        if (!updated.ok) {
          showRefusal(updated);
          return;
        }
      }
      if (materialsChanged) {
        const replaced = await replaceMaterialsAction(courseId, lessonId, assetIds);
        if (!replaced.ok) {
          showRefusal(replaced);
          return;
        }
      }
      toast.show({ tone: 'success', message: t('toasts.saved') });
      router.push(returnHref);
    } catch (error) {
      // Shape only: never a title or a file name.
      console.error('courses.lesson_save_failed', { error: String(error) });
      toast.show({ tone: 'error', message: t('form.errors.save') });
    }
  };

  const submit = () => {
    setServerTitleError(undefined);
    setMaterialsError(null);
    setTitleTouched(true);
    if (!valid) return;
    startTransition(async () => {
      await save();
    });
  };

  const remove = async () => {
    if (!lessonId) return;
    let result: LessonWriteResult;
    try {
      result = await deleteLessonAction(courseId, lessonId);
    } catch (error) {
      console.error('courses.lesson_delete_failed', { error: String(error) });
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
    toast.show({ tone: 'success', message: t('toasts.lessonRemoved') });
    router.push(returnHref);
  };

  /**
   * T-08.3-06: minted per tap, opened once in a tab cut off from this one, never kept.
   *
   * WR-07 (08.3 review): the tab is opened SYNCHRONOUSLY, inside the tap's user gesture (this runs
   * before the first `await`), and navigated once the URL arrives — a `window.open` after the awaited
   * action is outside the gesture and iOS Safari's popup blocker drops it silently. `opener` is cut
   * at once (what `noopener` did). A failure closes the blank tab; a blocked blank tab (null) falls
   * back to the old `noopener` open, which is all a browser that blocks both would ever allow.
   */
  const openMaterial = async (materialId: string) => {
    if (!lessonId) return;
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const result = await materialUrlAction(lessonId, materialId);
      if (!result.ok) {
        tab?.close();
        toast.show({ tone: 'error', message: tm('errors.generic') });
        return;
      }
      if (tab) tab.location.href = result.url;
      else window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      tab?.close();
      console.error('courses.material_open_failed', { error: String(error) });
      toast.show({ tone: 'error', message: tm('errors.generic') });
    }
  };

  const submitLabel = pending
    ? mode === 'edit'
      ? t('form.saving')
      : t('form.creating')
    : mode === 'edit'
      ? t('form.save')
      : t('lesson.form.create');

  return (
    <form
      data-lesson-form
      data-mode={mode}
      data-shell-hide="nav"
      className="mx-auto flex w-full max-w-[680px] flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <PageHeader
        title={mode === 'edit' ? t('lesson.form.editTitle') : t('lesson.form.createTitle')}
        backIcon={X}
        backLabel={t('form.close')}
        onBack={close}
        className="md:static md:px-0"
        trailing={
          <Button
            type="submit"
            variant="brand"
            size="sm"
            disabled={!submittable || busy}
            loading={busy}
            aria-busy={busy || undefined}
          >
            {submitLabel}
          </Button>
        }
      />
      {/* UI-D-398: the module named under the header, 12/400 tertiary. */}
      <p data-lesson-module className="px-4 text-xs font-normal text-text-tertiary md:px-0">
        {t('lesson.form.subtitle', { position: modulePosition, module: moduleTitle })}
      </p>

      <div className="flex flex-col gap-6 px-4 py-4 md:gap-8 md:px-6">
        {/* ── (1) Título ── */}
        <Input
          id="lesson-title"
          name="title"
          label={t('lesson.form.title')}
          placeholder={t('lesson.form.titlePlaceholder')}
          value={title}
          maxLength={LESSON_MAX_TITLE}
          required
          error={titleError}
          onChange={(event) => {
            setTitle(event.target.value);
            setServerTitleError(undefined);
          }}
          onBlur={() => setTitleTouched(true)}
        />

        {/* ── (2) Descrição: grows to its content; the page scrolls (E09 long-text). ── */}
        <Textarea
          id="lesson-description"
          name="description"
          label={t('lesson.form.description')}
          placeholder={t('lesson.form.descriptionPlaceholder')}
          value={description}
          rows={4}
          maxLength={LESSON_MAX_DESCRIPTION}
          counter={{ value: description.length, max: LESSON_MAX_DESCRIPTION }}
          onInput={(event) => {
            const el = event.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
          }}
          onChange={(event) => setDescription(event.target.value)}
        />

        {/* ── (3) Vídeo: the five states on the direct upload (D-409). ── */}
        <VideoBlock video={video} onChange={onVideoChange} />

        {/* ── (4) Aula aberta (D-407): editable on every course; the helper says what it means. ── */}
        <div data-lesson-free className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span id="lesson-free-label" className="text-sm font-bold text-text">
              {t('lesson.free.label')}
            </span>
            <span
              id="lesson-free-helper"
              data-lesson-free-helper
              className="text-xs font-normal text-text-tertiary"
            >
              {hasProducts ? t('lesson.free.helperGated') : t('lesson.free.helperOpen')}
            </span>
          </div>
          <Switch
            checked={isFree}
            onChange={(next) => {
              setIsFree(next);
              // Turning "Aula aberta" on clears the rule: an open lesson is never locked (A-UI-6).
              if (next) setRequiresPrevious(false);
            }}
            label={t('lesson.free.label')}
            aria-describedby="lesson-free-helper"
            className="mt-0.5"
          />
        </div>

        {/* ── (4b) Exige concluir a aula anterior (D-428, UI-D-438): the disabled states say why. ── */}
        <div data-lesson-requires className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span id="lesson-requires-label" className="text-sm font-bold text-text">
              {t('lesson.requiresPrevious.label')}
            </span>
            <span
              id="lesson-requires-helper"
              data-lesson-requires-helper
              className="text-xs font-normal text-text-tertiary"
            >
              {isFirstLesson
                ? t('lesson.requiresPrevious.first')
                : isFree
                  ? t('lesson.requiresPrevious.free')
                  : t('lesson.requiresPrevious.helper')}
            </span>
          </div>
          <Switch
            checked={requiresValue}
            onChange={setRequiresPrevious}
            label={t('lesson.requiresPrevious.label')}
            aria-describedby="lesson-requires-helper"
            disabled={requiresLocked}
            className="mt-0.5"
          />
        </div>

        {/* ── (5) Materiais (D-410): the whole set saves with the lesson. ── */}
        <MaterialsList
          items={materials}
          onChange={onMaterialsChange}
          onOpen={(materialId) => void openMaterial(materialId)}
          disabled={pending}
          error={materialsError}
          onBusyChange={onMaterialsBusy}
        />

        {/* ── (6) Edit only: the hairline and "Remover aula" (UI-D-398). ── */}
        {mode === 'edit' && lessonId ? (
          <>
            <div aria-hidden className="h-px bg-border" />
            <Button
              type="button"
              variant="ghost"
              size="md"
              data-lesson-remove
              className="justify-start self-start px-0 text-danger"
              onClick={() => setRemoving(true)}
            >
              <Trash2 aria-hidden size={20} />
              {t('lesson.form.remove')}
            </Button>
          </>
        ) : null}
      </div>

      <ConfirmDialog
        open={discarding}
        tone="danger"
        title={t('discard.lesson')}
        body={t('discard.body')}
        confirmLabel={t('discard.confirm')}
        cancelLabel={t('discard.cancel')}
        onConfirm={() => router.push(returnHref)}
        onClose={() => setDiscarding(false)}
      />

      {/* UI-D-404: the danger confirmation; a refusal after confirming toasts and keeps the screen. */}
      <ConfirmDialog
        open={removing}
        tone="danger"
        icon={Trash2}
        title={t('lesson.removeDialog.title')}
        body={t('lesson.removeDialog.body')}
        confirmLabel={t('lesson.removeDialog.confirm')}
        cancelLabel={t('lesson.removeDialog.cancel')}
        onConfirm={remove}
        onClose={() => setRemoving(false)}
        onError={(error) => {
          console.error('courses.lesson_delete_failed', { error: String(error) });
          toast.show({ tone: 'error', message: t('form.errors.save') });
        }}
      />
    </form>
  );
}
