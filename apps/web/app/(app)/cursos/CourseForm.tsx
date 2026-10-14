'use client';

import { mediaAcceptFor, PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import {
  COURSE_MAX_DESCRIPTION,
  COURSE_MAX_HOURS,
  COURSE_MAX_OUTCOME,
  COURSE_MAX_OUTCOMES,
  COURSE_MAX_TAGLINE,
  COURSE_MAX_TITLE,
  type CourseInput,
  type CourseLevel,
  type CoursePatch,
} from '@rede-social/module-courses/contracts';
import { CategoryPickerSheet } from '@rede-social/module-courses/ui';
import {
  Button,
  Chip,
  ConfirmDialog,
  FileDropZone,
  IconButton,
  Input,
  PageHeader,
  Textarea,
  useToast,
} from '@rede-social/ui';
import { Archive, ChevronDown, Image as ImageIcon, Plus, Tag, User, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState, useTransition } from 'react';
import { useCoverPreview } from '@/components/media/useCoverPreview';
import { useSignedUpload } from '@/components/media/useSignedUpload';
import {
  COURSE_LEVEL_LABEL_KEY,
  COURSE_LEVEL_ORDER,
  type CourseFormCategory,
  type CourseFormDefaults,
  type CourseFormProduct,
} from '@/lib/courses-view';
import {
  type CourseWriteResult,
  createCourseAction,
  setCourseStatusAction,
  updateCourseAction,
} from './course-actions';
import { ProductPickerSheet, ProductThumb } from './ProductPickerSheet';

/**
 * THE course form (08.3-07, D-404, D-405, D-411, D-412, UI-D-393, UI-D-409, COURSE-02): one
 * component, two routes — `/cursos/novo` in `create` mode and `/cursos/[courseId]/editar` in `edit`
 * mode. It is the `ProductForm` shell copied (the admin's create/edit/archive muscle memory): a task
 * screen (`data-shell-hide="nav"`), the `PageHeader` with the 44×44 `X` close (a dirty form asks
 * "Descartar curso?" before discarding) and the brand submit in the trailing slot.
 *
 * Sections in order (UI-D-393): Capa (a 3:4 preview, the exact crop of the member catalogue),
 * Título, Frase de venda, Descrição, Categoria (a 44px picker row → the module's single-select
 * `CategoryPickerSheet`, plus the "Gerenciar categorias" link), Nível (three `aria-pressed` chips;
 * tapping the active one clears), Instrutor (a required name and an optional 64px round photo,
 * D-412 — free text, no membership search), O que você vai dominar (up to 10 items), Carga horária,
 * Acesso (ONLY while the store is on and the admin holds `store.product.manage`: `products` is
 * null otherwise and the block is absent, D-405) and, on edit, the hairline and "Arquivar curso"
 * (or the archived note).
 *
 * **ZERO UPLOAD CODE LIVES HERE.** The cover and the photo run the Phase 3 machine, `useSignedUpload`
 * with purpose `cover`, straight to Storage; this file holds asset ids, never bytes (MEDIA-01).
 *
 * **This is the ONLY place course-to-product links are written** (D-404, the STORE-03 posture). On
 * edit the save sends ONLY the keys the admin changed (the patch contract has no defaults, so a
 * tagline change can never wipe the outcomes, the cover or the links); `productIds` is sent only
 * when the selection differs from the saved SET (`sameSet`). A saved link to a product the store
 * has since archived stays in the selection; if the admin changes the set, the API refuses the
 * archived id by name (`product_invalid`) and the product error line asks them to check the list —
 * removing that row and saving again is the way through. No lock-impact dialog exists: no member
 * reads a course in this phase (UI-D-393).
 *
 * Every field renders as React text (UI-D-407, T-08.3-25); every string comes from the `courses`
 * catalog (PWA-03).
 */
export type CourseFormMode = 'create' | 'edit';

export interface CourseFormProps {
  mode: CourseFormMode;
  /** Edit mode only. */
  courseId?: string;
  /** Edit mode only: the course as it stands (`courseFormDefaults`). */
  initial?: CourseFormDefaults;
  /** The tenant's display name, for the cover helper ("usamos as cores de {tenant}"). */
  tenantName: string;
  /** The tenant's categories for the picker (the API's order), cover included. */
  categories: readonly CourseFormCategory[];
  /**
   * The tenant's ACTIVE products for the picker, or `null` while the store is off or the admin
   * lacks `store.product.manage` (then the Acesso block is absent and the save never sends links).
   */
  products: readonly CourseFormProduct[] | null;
  /** Where the close, the discard and a successful save land (the hub by default). */
  returnHref?: string;
}

const ACCEPT = mediaAcceptFor('image', 'cover');
/** Announced at these percentages only, not on every tick (the `CommunityForm` rule). */
const QUARTILES = [25, 50, 75, 100];

const EMPTY: CourseFormDefaults = {
  title: '',
  tagline: '',
  description: '',
  categoryId: null,
  categoryName: null,
  level: null,
  coverAssetId: null,
  instructorName: '',
  instructorPhotoAssetId: null,
  outcomes: [],
  certificateHours: null,
  products: [],
  status: 'draft',
};

/** The hours field's verdict on its text: empty is valid (the hours are optional). */
export type HoursVerdict = { kind: 'empty' } | { kind: 'invalid' } | { kind: 'ok'; hours: number };

export function hoursVerdict(text: string): HoursVerdict {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'empty' };
  if (!/^\d+$/.test(trimmed)) return { kind: 'invalid' };
  const hours = Number(trimmed);
  if (!Number.isInteger(hours) || hours < 0 || hours > COURSE_MAX_HOURS) return { kind: 'invalid' };
  return { kind: 'ok', hours };
}

/** Same members in any order: the link set is a SET. */
export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const other = new Set(b);
  return a.every((id) => other.has(id));
}

/** The outcomes the form will send: trimmed, empty items dropped (the empty input is a UI affordance). */
function effectiveOutcomes(items: readonly string[]): string[] {
  return items.map((item) => item.trim()).filter((item) => item.length > 0);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/** The gradient the 3:4 cover preview and the picker thumbs fall back to (D-69, UI-D-409). */
const GRADIENT = (
  <span
    aria-hidden
    className="block h-full w-full"
    style={{ backgroundImage: 'var(--brand-gradient)' }}
  />
);

const GHOST_LINK =
  'inline-flex h-9 items-center justify-center gap-1.5 self-start rounded-xl px-2 text-xs font-bold text-brand transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export function CourseForm({
  mode,
  courseId,
  initial,
  tenantName,
  categories,
  products,
  returnHref = '/cursos',
}: CourseFormProps) {
  const t = useTranslations('courses');
  const tRoot = useTranslations();
  const tm = useTranslations('media');
  const toast = useToast();
  const router = useRouter();

  const start = initial ?? EMPTY;
  const [title, setTitle] = useState(start.title);
  const [tagline, setTagline] = useState(start.tagline);
  const [description, setDescription] = useState(start.description);
  const [categoryId, setCategoryId] = useState<string | null>(start.categoryId);
  const [level, setLevel] = useState<CourseLevel | null>(start.level);
  const [coverAssetId, setCoverAssetId] = useState<string | null>(start.coverAssetId);
  const [coverWidths, setCoverWidths] = useState<readonly number[]>(PURPOSE_WIDTHS.cover);
  const [instructorName, setInstructorName] = useState(start.instructorName);
  const [photoAssetId, setPhotoAssetId] = useState<string | null>(start.instructorPhotoAssetId);
  const [photoWidths, setPhotoWidths] = useState<readonly number[]>(PURPOSE_WIDTHS.cover);
  // E08/empty: no outcome → ONE empty item input.
  const [outcomes, setOutcomes] = useState<string[]>(() =>
    start.outcomes.length > 0 ? [...start.outcomes] : [''],
  );
  const [hoursText, setHoursText] = useState(
    start.certificateHours === null ? '' : String(start.certificateHours),
  );
  const [selected, setSelected] = useState<string[]>(() => start.products.map((p) => p.id));

  /** Required-field errors show once the field has been left (or a save tried), then follow each edit. */
  const [titleTouched, setTitleTouched] = useState(false);
  const [instructorTouched, setInstructorTouched] = useState(false);
  const [hoursTouched, setHoursTouched] = useState(false);
  const [serverTitleError, setServerTitleError] = useState<string | undefined>(undefined);
  const [serverInstructorError, setServerInstructorError] = useState<string | undefined>(undefined);
  const [serverHoursError, setServerHoursError] = useState<string | undefined>(undefined);
  const [outcomesError, setOutcomesError] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [productError, setProductError] = useState<string | null>(null);

  const [categoryOpen, setCategoryOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [pending, startTransition] = useTransition();

  const coverInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  /* ── The cover: the Phase 3 machine, purpose `cover`, a 3:4 preview (UI-D-409) ─────────────── */
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

  /* ── The instructor photo: the same machine, a 64px round preview (D-412, UI-D-409) ────────── */
  const photoPreview = useCoverPreview(photoAssetId);
  const photoUpload = useSignedUpload({
    kind: 'image',
    purpose: 'cover',
    successKey: null,
    onPicked: photoPreview.onPicked,
    onCompleted: (asset) => {
      photoPreview.onUploaded(asset.id);
      setPhotoAssetId(asset.id);
      const widths = asset.variants.map((variant) => variant.width);
      setPhotoWidths(widths.length > 0 ? widths : PURPOSE_WIDTHS.cover);
      setPhotoError(null);
    },
  });
  const photoUploading = photoUpload.state === 'preparing' || photoUpload.state === 'progress';

  /* ── Categories and products the form can name ──────────────────────────────────────────────── */
  const categoryName = useMemo(() => {
    if (categoryId === null) return null;
    const known = categories.find((category) => category.id === categoryId);
    if (known) return known.name;
    return categoryId === start.categoryId ? start.categoryName : null;
  }, [categories, categoryId, start.categoryId, start.categoryName]);

  /** Every product the form can name: the saved links, refreshed by the picker's rows. */
  const knownProducts = useMemo(() => {
    const map = new Map<string, CourseFormProduct>();
    for (const product of start.products) map.set(product.id, product);
    for (const product of products ?? []) map.set(product.id, product);
    return map;
  }, [products, start.products]);

  const selectedProducts = selected
    .map((id) => knownProducts.get(id))
    .filter((row): row is CourseFormProduct => row !== undefined);

  /* ── Verdicts, dirtiness and the submit gate (UI-D-393) ─────────────────────────────────────── */
  const hours = hoursVerdict(hoursText);
  const titleError =
    serverTitleError ??
    (titleTouched && title.trim().length === 0 ? t('form.errors.titleRequired') : undefined);
  const instructorError =
    serverInstructorError ??
    (instructorTouched && instructorName.trim().length === 0
      ? t('form.errors.instructorRequired')
      : undefined);
  const hoursError =
    serverHoursError ??
    (hoursTouched && hours.kind === 'invalid' ? t('form.errors.hoursInvalid') : undefined);

  const sentOutcomes = effectiveOutcomes(outcomes);
  const sentHours = hours.kind === 'ok' ? hours.hours : null;
  const startIds = start.products.map((product) => product.id);
  const linksChanged = products !== null && !sameSet(selected, startIds);
  const dirty =
    title !== start.title ||
    tagline !== start.tagline ||
    description !== start.description ||
    categoryId !== start.categoryId ||
    level !== start.level ||
    coverAssetId !== start.coverAssetId ||
    instructorName !== start.instructorName ||
    photoAssetId !== start.instructorPhotoAssetId ||
    !sameList(sentOutcomes, start.outcomes) ||
    (hours.kind === 'invalid' ? hoursText !== '' : sentHours !== start.certificateHours) ||
    linksChanged;

  const valid =
    title.trim().length > 0 && instructorName.trim().length > 0 && hours.kind !== 'invalid';
  const busy = pending || coverUploading || photoUploading;
  const submittable = valid && (mode === 'create' || dirty);

  const close = () => {
    if (dirty) {
      setDiscarding(true);
      return;
    }
    router.push(returnHref);
  };

  /** The create body, or the edit patch with ONLY the changed keys (D-404, no defaults). */
  const payload = (): CourseInput | CoursePatch => {
    if (mode === 'create') {
      return {
        title,
        tagline,
        description,
        categoryId,
        level,
        coverAssetId,
        instructorName,
        instructorPhotoAssetId: photoAssetId,
        outcomes: sentOutcomes,
        certificateHours: sentHours,
        ...(products !== null ? { productIds: selected } : {}),
      };
    }
    const patch: CoursePatch = {};
    if (title !== start.title) patch.title = title;
    if (tagline !== start.tagline) patch.tagline = tagline;
    if (description !== start.description) patch.description = description;
    if (categoryId !== start.categoryId) patch.categoryId = categoryId;
    if (level !== start.level) patch.level = level;
    if (coverAssetId !== start.coverAssetId) patch.coverAssetId = coverAssetId;
    if (instructorName !== start.instructorName) patch.instructorName = instructorName;
    if (photoAssetId !== start.instructorPhotoAssetId) patch.instructorPhotoAssetId = photoAssetId;
    if (!sameList(sentOutcomes, start.outcomes)) patch.outcomes = sentOutcomes;
    if (sentHours !== start.certificateHours) patch.certificateHours = sentHours;
    if (linksChanged) patch.productIds = selected;
    return patch;
  };

  /** Field issues land under their field; anything else is the save toast (draft kept). */
  const showRefusal = (result: Exclude<CourseWriteResult, { ok: true }>) => {
    switch (result.code) {
      case 'title_required':
      case 'title_too_long':
        setServerTitleError(t('form.errors.titleRequired'));
        return;
      case 'instructor_required':
        setServerInstructorError(t('form.errors.instructorRequired'));
        return;
      case 'hours_invalid':
        setServerHoursError(t('form.errors.hoursInvalid'));
        return;
      case 'outcome_too_long':
      case 'outcomes_too_many':
        setOutcomesError(t('form.errors.outcomeTooLong'));
        return;
      case 'cover_invalid':
        setCoverError(t('form.errors.imageInvalid'));
        return;
      case 'photo_invalid':
        setPhotoError(t('form.errors.imageInvalid'));
        return;
      case 'category_invalid':
        setCategoryError(t('form.errors.categoryInvalid'));
        return;
      case 'product_invalid':
      case 'too_many_products':
        setProductError(t('form.errors.productInvalid'));
        return;
      case 'disabled':
        toast.show({ tone: 'error', message: t('errors.disabled') });
        return;
      default:
        toast.show({ tone: 'error', message: t('form.errors.save') });
    }
  };

  const clearServerErrors = () => {
    setServerTitleError(undefined);
    setServerInstructorError(undefined);
    setServerHoursError(undefined);
    setOutcomesError(null);
    setCategoryError(null);
    setProductError(null);
  };

  /** Runs the write; resolves once the outcome has been shown (or the page left). */
  const save = async (): Promise<void> => {
    const body = payload();
    let result: CourseWriteResult;
    try {
      result =
        mode === 'edit' && courseId
          ? await updateCourseAction(courseId, body)
          : await createCourseAction(body);
    } catch (error) {
      // Shape only: never a title.
      console.error('courses.save_failed', { error: String(error) });
      toast.show({ tone: 'error', message: t('form.errors.save') });
      return;
    }
    if (result.ok) {
      toast.show({
        tone: 'success',
        message: mode === 'edit' ? t('toasts.saved') : t('toasts.courseCreated'),
      });
      router.push(returnHref);
      return;
    }
    showRefusal(result);
  };

  const submit = () => {
    clearServerErrors();
    setTitleTouched(true);
    setInstructorTouched(true);
    setHoursTouched(true);
    if (!valid) return;
    startTransition(async () => {
      await save();
    });
  };

  const archive = async () => {
    if (!courseId) return;
    let result: CourseWriteResult;
    try {
      result = await setCourseStatusAction(courseId, 'archived');
    } catch (error) {
      console.error('courses.status_failed', { error: String(error) });
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
    toast.show({ tone: 'success', message: t('toasts.archived') });
    router.push('/cursos?filtro=arquivados');
  };

  const toggleProduct = (id: string) => {
    setProductError(null);
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const setOutcome = (index: number, value: string) => {
    setOutcomesError(null);
    setOutcomes((current) => current.map((item, i) => (i === index ? value : item)));
  };
  const removeOutcome = (index: number) => {
    setOutcomesError(null);
    setOutcomes((current) => {
      const next = current.filter((_, i) => i !== index);
      return next.length > 0 ? next : [''];
    });
  };
  const addOutcome = () => {
    setOutcomes((current) => (current.length < COURSE_MAX_OUTCOMES ? [...current, ''] : current));
  };

  const submitLabel = pending
    ? mode === 'edit'
      ? t('form.saving')
      : t('form.creating')
    : mode === 'edit'
      ? t('form.save')
      : t('form.create');

  const categoryItems = categories.map((category) => ({
    id: category.id,
    name: category.name,
    thumb:
      category.coverAssetId === null ? undefined : (
        <MediaImage
          assetId={category.coverAssetId}
          widths={PURPOSE_WIDTHS.cover}
          alt=""
          sizes="32px"
          ratio=""
          className="h-full w-full"
          fallback={GRADIENT}
        />
      ),
  }));

  return (
    <form
      data-course-form
      data-mode={mode}
      data-shell-hide="nav"
      className="mx-auto flex w-full max-w-[680px] flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <PageHeader
        title={mode === 'edit' ? t('form.editTitle') : t('form.createTitle')}
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

      <div className="flex flex-col gap-6 px-4 py-4 md:gap-8 md:px-6">
        {/* ── (1) Capa: the 3:4 centre crop the catalogue thumb shows (UI-D-409). ── */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-normal text-text-secondary">{t('form.cover.label')}</span>

          <div
            data-course-cover-preview
            className="relative aspect-[3/4] w-full max-w-[240px] overflow-hidden rounded-xl bg-bg-tertiary"
          >
            {coverPreview.previewUrl ? (
              // biome-ignore lint/performance/noImgElement: a local object URL of the file being uploaded; next/image cannot load it (the `CommunityCover` precedent)
              <img
                src={coverPreview.previewUrl}
                alt={t('form.cover.preview')}
                data-course-cover-local
                className="h-full w-full object-cover object-center"
              />
            ) : coverAssetId !== null ? (
              <MediaImage
                assetId={coverAssetId}
                widths={coverWidths}
                alt={t('form.cover.preview')}
                sizes="240px"
                ratio=""
                className="h-full w-full"
                fallback={GRADIENT}
              />
            ) : (
              <span
                data-course-cover-fallback
                aria-hidden
                className="block h-full w-full"
                style={{ backgroundImage: 'var(--brand-gradient)' }}
              />
            )}
          </div>

          <div className="hidden md:block">
            <FileDropZone
              id="course-cover-dropzone"
              icon={ImageIcon}
              accept={ACCEPT}
              // The hook owns the verdict (a phone photo is re-encoded in the browser).
              screen={false}
              state={
                coverUpload.state === 'progress' || coverUpload.state === 'processing'
                  ? coverUpload.state
                  : 'idle'
              }
              progress={coverUpload.progress}
              onFile={(file) => void coverUpload.pick(file)}
              labels={{
                caption: coverAssetId ? t('form.cover.change') : t('form.cover.add'),
                progress: (percent) => tm('progress', { percent }),
                processing: tm('photo.preparing'),
              }}
            />
          </div>

          <input
            ref={coverInputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            aria-label={coverAssetId ? t('form.cover.change') : t('form.cover.add')}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void coverUpload.pick(file);
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={coverUploading}
              onClick={() => coverInputRef.current?.click()}
            >
              <ImageIcon aria-hidden size={18} className="shrink-0" />
              {coverAssetId ? t('form.cover.change') : t('form.cover.add')}
            </Button>
            {coverAssetId ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={coverUploading}
                onClick={() => {
                  setCoverAssetId(null);
                  setCoverError(null);
                  coverUpload.reset();
                }}
              >
                <X aria-hidden size={18} className="shrink-0" />
                {t('form.cover.remove')}
              </Button>
            ) : null}
          </div>

          {coverUpload.state === 'progress' ? (
            <div className="flex flex-col gap-2">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={coverUpload.progress}
                className="h-1 w-full overflow-hidden rounded-full bg-bg-tertiary"
              >
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-200 ease-linear"
                  style={{ width: `${coverUpload.progress}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs tabular-nums text-text-tertiary">
                  {tm('progress', { percent: coverUpload.progress })}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={coverUpload.cancel}>
                  {tm('cancel')}
                </Button>
              </div>
            </div>
          ) : null}

          <span aria-live="polite" className="sr-only">
            {coverAnnounced}
          </span>

          {coverUpload.error || coverError ? (
            <p role="alert" data-course-cover-error className="text-sm font-normal text-danger">
              {coverUpload.error ?? coverError}
            </p>
          ) : null}
          <p className="text-xs font-normal text-text-tertiary">
            {t('form.cover.helper', { tenant: tenantName })}
          </p>
        </div>

        {/* ── (2) Título ── */}
        <Input
          id="course-title"
          name="title"
          label={t('form.title.label')}
          placeholder={t('form.title.placeholder')}
          value={title}
          maxLength={COURSE_MAX_TITLE}
          required
          error={titleError}
          onChange={(event) => {
            setTitle(event.target.value);
            setServerTitleError(undefined);
          }}
          onBlur={() => setTitleTouched(true)}
        />

        {/* ── (3) Frase de venda ── */}
        <div className="flex flex-col gap-2">
          <Input
            id="course-tagline"
            name="tagline"
            label={t('form.tagline.label')}
            placeholder={t('form.tagline.placeholder')}
            value={tagline}
            maxLength={COURSE_MAX_TAGLINE}
            onChange={(event) => setTagline(event.target.value)}
          />
          <p className="text-xs font-normal text-text-tertiary">{t('form.tagline.helper')}</p>
        </div>

        {/* ── (4) Descrição: grows to its content; the page scrolls (E08/long-text). ── */}
        <Textarea
          id="course-description"
          name="description"
          label={t('form.description.label')}
          placeholder={t('form.description.placeholder')}
          value={description}
          rows={4}
          maxLength={COURSE_MAX_DESCRIPTION}
          counter={{ value: description.length, max: COURSE_MAX_DESCRIPTION }}
          onInput={(event) => {
            const el = event.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
          }}
          onChange={(event) => setDescription(event.target.value)}
        />

        {/* ── (5) Categoria: the 44px picker row → the module's single-select sheet (D-411). ── */}
        <div className="flex flex-col gap-2">
          <span id="course-category-label" className="text-sm font-normal text-text-secondary">
            {t('form.category.label')}
          </span>
          <button
            type="button"
            data-course-category-open
            aria-haspopup="dialog"
            aria-expanded={categoryOpen}
            aria-labelledby="course-category-label course-category-value"
            onClick={() => setCategoryOpen(true)}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl text-left transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <Tag aria-hidden size={20} className="shrink-0 text-text-secondary" />
            <span
              id="course-category-value"
              data-course-category-value
              className="min-w-0 flex-1 truncate text-sm font-normal text-text"
            >
              {categoryName ?? t('form.category.none')}
            </span>
            <ChevronDown aria-hidden size={18} className="shrink-0 text-text-tertiary" />
          </button>
          {categoryError ? (
            <p role="alert" data-course-category-error className="text-sm font-normal text-danger">
              {categoryError}
            </p>
          ) : null}
          <a href="/cursos/categorias" data-course-categories-manage className={GHOST_LINK}>
            {t('form.category.manage')}
          </a>

          <CategoryPickerSheet
            open={categoryOpen}
            onClose={() => setCategoryOpen(false)}
            title={t('form.category.pickerTitle')}
            helper={t('form.category.pickerHelper')}
            items={categoryItems}
            selectedId={categoryId}
            noneLabel={t('form.category.none')}
            onSelect={(id) => {
              setCategoryId(id);
              setCategoryError(null);
              setCategoryOpen(false);
            }}
          />
        </div>

        {/* ── (6) Nível: three aria-pressed chips; tapping the active one clears (E08/overflow: wrap). ── */}
        <fieldset data-course-level className="flex min-w-0 flex-col gap-2">
          <legend className="mb-2 text-sm font-normal text-text-secondary">
            {t('form.level.label')}
          </legend>
          <div data-course-level-chips className="flex flex-wrap gap-2">
            {COURSE_LEVEL_ORDER.map((key) => (
              <Chip
                key={key}
                active={level === key}
                data-course-level-chip={key}
                onClick={() => setLevel((current) => (current === key ? null : key))}
              >
                {tRoot(COURSE_LEVEL_LABEL_KEY[key])}
              </Chip>
            ))}
          </div>
          <p className="text-xs font-normal text-text-tertiary">{t('form.level.helper')}</p>
        </fieldset>

        {/* ── (7) Instrutor: a required name and the optional 64px round photo (D-412). ── */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-normal text-text-secondary">
            {t('form.instructor.label')}
          </span>
          <div className="flex items-center gap-3">
            <span
              data-course-photo
              className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-tertiary"
            >
              {photoPreview.previewUrl ? (
                // biome-ignore lint/performance/noImgElement: a local object URL of the file being uploaded
                <img
                  src={photoPreview.previewUrl}
                  alt=""
                  data-course-photo-local
                  className="h-full w-full object-cover object-center"
                />
              ) : photoAssetId !== null ? (
                <MediaImage
                  assetId={photoAssetId}
                  widths={photoWidths}
                  alt=""
                  sizes="64px"
                  ratio=""
                  className="h-full w-full"
                  fallback={<User aria-hidden size={28} className="text-text-tertiary" />}
                />
              ) : (
                <User
                  aria-hidden
                  data-course-photo-fallback
                  size={28}
                  className="text-text-tertiary"
                />
              )}
            </span>
            <input
              ref={photoInputRef}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              aria-label={
                photoAssetId ? t('form.instructor.changePhoto') : t('form.instructor.addPhoto')
              }
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void photoUpload.pick(file);
              }}
            />
            <div className="flex flex-wrap items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="px-2"
                disabled={photoUploading}
                loading={photoUploading}
                onClick={() => photoInputRef.current?.click()}
              >
                {photoAssetId ? t('form.instructor.changePhoto') : t('form.instructor.addPhoto')}
              </Button>
              {photoAssetId ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="px-2"
                  disabled={photoUploading}
                  onClick={() => {
                    setPhotoAssetId(null);
                    setPhotoError(null);
                    photoUpload.reset();
                  }}
                >
                  {t('form.instructor.removePhoto')}
                </Button>
              ) : null}
            </div>
          </div>
          {photoUpload.error || photoError ? (
            <p role="alert" data-course-photo-error className="text-sm font-normal text-danger">
              {photoUpload.error ?? photoError}
            </p>
          ) : null}
          <Input
            id="course-instructor"
            name="instructorName"
            aria-label={t('form.instructor.label')}
            placeholder={t('form.instructor.placeholder')}
            value={instructorName}
            maxLength={COURSE_MAX_TITLE}
            required
            error={instructorError}
            onChange={(event) => {
              setInstructorName(event.target.value);
              setServerInstructorError(undefined);
            }}
            onBlur={() => setInstructorTouched(true)}
          />
          <p className="text-xs font-normal text-text-tertiary">{t('form.instructor.helper')}</p>
        </div>

        {/* ── (8) O que você vai dominar: up to 10 items; "Adicionar item" hides at the cap. ── */}
        <div className="flex flex-col gap-2">
          <span id="course-outcomes-label" className="text-sm font-normal text-text-secondary">
            {t('form.outcomes.label')}
          </span>
          <ol
            aria-labelledby="course-outcomes-label"
            data-course-outcomes
            className="flex flex-col gap-2"
          >
            {outcomes.map((item, index) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: the items are positional inputs; a removal re-renders the list from its position
                key={index}
                data-course-outcome={index + 1}
                className="flex items-center gap-1"
              >
                <Input
                  id={`course-outcome-${index + 1}`}
                  containerClassName="min-w-0 flex-1"
                  placeholder={t('form.outcomes.placeholder')}
                  value={item}
                  maxLength={COURSE_MAX_OUTCOME}
                  onChange={(event) => setOutcome(index, event.target.value)}
                />
                <IconButton
                  icon={X}
                  size={18}
                  className="shrink-0 text-text-tertiary"
                  label={t('form.outcomes.remove', { n: index + 1 })}
                  onClick={() => removeOutcome(index)}
                />
              </li>
            ))}
          </ol>
          {outcomes.length < COURSE_MAX_OUTCOMES ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              data-course-outcomes-add
              onClick={addOutcome}
            >
              <Plus aria-hidden size={16} className="shrink-0" />
              {t('form.outcomes.add')}
            </Button>
          ) : null}
          {outcomesError ? (
            <p role="alert" data-course-outcomes-error className="text-sm font-normal text-danger">
              {outcomesError}
            </p>
          ) : null}
          <p className="text-xs font-normal text-text-tertiary">{t('form.outcomes.helper')}</p>
        </div>

        {/* ── (9) Carga horária: a number 0–999 with the suffix; empty is valid. ── */}
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-3">
            <Input
              id="course-hours"
              name="certificateHours"
              type="number"
              inputMode="numeric"
              min={0}
              max={COURSE_MAX_HOURS}
              step={1}
              containerClassName="w-28"
              className="tabular-nums"
              label={t('form.hours.label')}
              value={hoursText}
              error={hoursError}
              onChange={(event) => {
                setHoursText(event.target.value);
                setServerHoursError(undefined);
              }}
              onBlur={() => setHoursTouched(true)}
            />
            <span className="pb-3 text-sm font-normal text-text-secondary">
              {t('form.hours.suffix')}
            </span>
          </div>
          <p className="text-xs font-normal text-text-tertiary">{t('form.hours.helper')}</p>
        </div>

        {/* ── (10) Acesso: only while the store is on AND the admin manages it (D-404, D-405). ── */}
        {products !== null ? (
          <div data-course-products className="flex flex-col gap-2">
            <span className="text-sm font-normal text-text-secondary">
              {t('form.products.label')}
            </span>
            {selectedProducts.length > 0 ? (
              <ul className="flex flex-col">
                {selectedProducts.map((product) => (
                  <li
                    key={product.id}
                    data-course-product={product.id}
                    className="flex min-h-11 items-center gap-3"
                  >
                    <ProductThumb product={product} />
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-text">
                      {product.name}
                    </span>
                    <IconButton
                      icon={X}
                      size={18}
                      className="shrink-0 text-text-tertiary"
                      label={t('form.products.remove', { product: product.name })}
                      onClick={() => toggleProduct(product.id)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p data-course-products-none className="text-sm font-normal text-text">
                {t('form.products.none')}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="md"
              className="self-start"
              data-course-products-open
              onClick={() => setProductsOpen(true)}
            >
              <Plus aria-hidden size={18} className="shrink-0" />
              {selectedProducts.length > 0 ? t('form.products.change') : t('form.products.choose')}
            </Button>
            {productError ? (
              <p
                role="alert"
                data-course-products-error
                className="text-sm font-normal text-danger"
              >
                {productError}
              </p>
            ) : null}
            <p className="text-xs font-normal text-text-tertiary">{t('form.products.helper')}</p>

            <ProductPickerSheet
              open={productsOpen}
              onClose={() => setProductsOpen(false)}
              products={products}
              selected={selected}
              onToggle={toggleProduct}
            />
          </div>
        ) : null}

        {/* ── (11) Edit only: the hairline and "Arquivar curso", or the archived note (UI-D-394). ── */}
        {mode === 'edit' && courseId ? (
          <>
            <div aria-hidden className="h-px bg-border" />
            {start.status === 'archived' ? (
              <p data-course-archived-note className="text-sm font-normal text-text-secondary">
                {t('course.archivedNote')}
              </p>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="md"
                data-course-archive
                className="justify-start self-start px-0 text-danger"
                onClick={() => setArchiving(true)}
              >
                <Archive aria-hidden size={20} />
                {t('form.archive')}
              </Button>
            )}
          </>
        ) : null}
      </div>

      <ConfirmDialog
        open={discarding}
        tone="danger"
        title={t('discard.course')}
        body={t('discard.body')}
        confirmLabel={t('discard.confirm')}
        cancelLabel={t('discard.cancel')}
        onConfirm={() => router.push(returnHref)}
        onClose={() => setDiscarding(false)}
      />

      {/* UI-D-404: the danger confirmation; a refusal after confirming toasts and keeps the screen. */}
      <ConfirmDialog
        open={archiving}
        tone="danger"
        icon={Archive}
        title={t('course.archiveDialog.title')}
        body={t('course.archiveDialog.body')}
        confirmLabel={t('course.archiveDialog.confirm')}
        cancelLabel={t('course.archiveDialog.cancel')}
        onConfirm={archive}
        onClose={() => setArchiving(false)}
        onError={(error) => {
          console.error('courses.status_failed', { error: String(error) });
          toast.show({ tone: 'error', message: t('form.errors.save') });
        }}
      />
    </form>
  );
}
