'use client';

import { mediaAcceptFor, PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { parseBrlToCents, STORE_MAX_PRICE_CENTS } from '@rede-social/contracts/money';
import { MediaImage } from '@rede-social/core/ui';
import { CommunityPickerSheet } from '@rede-social/module-communities/ui';
import { CoursePickerSheet } from '@rede-social/module-courses/ui';
import {
  type ProductInput,
  type ProductPatch,
  STORE_MAX_DESCRIPTION,
  STORE_MAX_LINKS,
  STORE_MAX_NAME,
  type StoreIssue,
} from '@rede-social/module-store/contracts';
import {
  Button,
  ConfirmDialog,
  FileDropZone,
  IconButton,
  Input,
  PageHeader,
  Textarea,
  useToast,
} from '@rede-social/ui';
import {
  Archive,
  ArchiveRestore,
  Check,
  Image as ImageIcon,
  Lock,
  Plus,
  Radio,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useCoverPreview } from '@/components/media/useCoverPreview';
import { useSignedUpload } from '@/components/media/useSignedUpload';
import { leaveForm, replaceFormWith, returnAfterSave } from '@/lib/form-exit';
import {
  type LockWarningView,
  lockWarningView,
  type ProductFormCommunity,
  type ProductFormCourse,
  type ProductFormDefaults,
  type ProductFormLinkList,
  type ProductFormLive,
  priceInputText,
  type StoreTranslator,
} from '@/lib/store-view';
import {
  createProductAction,
  lockPreviewAction,
  type ProductWriteResult,
  setProductStatusAction,
  updateProductAction,
} from './product-actions';

/**
 * THE product form (08.2-10, D-362, D-363, UI-D-377): one component, two routes, `/loja/novo` in
 * `create` mode and `/loja/[productId]/editar` in `edit` mode. It is the `CommunityForm` shell
 * copied (the admin's create/edit/archive muscle memory): a task screen (`data-shell-hide="nav"`),
 * the `PageHeader` with the 44x44 `X` close (a dirty form asks before discarding) and the brand
 * submit in the trailing slot.
 *
 * **ZERO UPLOAD CODE LIVES HERE.** The image runs the Phase 3 machine, `useSignedUpload` with
 * purpose `cover`, which sends the bytes straight to Storage through a signed target; this file
 * holds an asset id, never a byte (MEDIA-01). The preview is the SAME 4:5 box the card and the
 * product page draw, so the admin sees the exact crop members will see.
 *
 * **Money is integer cents** (D-361, UI-D-383): the price text is parsed with `parseBrlToCents`
 * (no float ever), re-displayed as "19,90" on blur, and the cap is `STORE_MAX_PRICE_CENTS`.
 *
 * **This is the ONLY place links are written** (D-363): the community edit form shows them read-
 * only. On edit the save sends ONLY the keys the admin changed (the patch contract has no defaults,
 * so a price change can never wipe the description, the image or the links); `communityIds` is sent
 * only when the selection differs from the saved set.
 *
 * **Courses and lives are linked here too, and only here** (08.4, D-418, UI-D-413..UI-D-416): the
 * "Cursos liberados" and "Lives liberadas" blocks sit right after "Comunidades liberadas", clones of
 * it, both opening the courses module's `CoursePickerSheet` (the live one with the 16:10 thumb). Each
 * keeps its own selection and dirty check: the create body carries `courseIds` / `liveIds` exactly
 * when the block is present, the patch each key only when that set changed. Every live date arrives
 * finished from the server, in the tenant's timezone (UI-D-288): this file never reads the clock. A
 * refused course or live (`course_invalid`, `too_many_courses` and the live twins) is a field error
 * under its block, cleared by that block's next change; a failed list read is told apart from an
 * empty school in the sheet (UI-D-419, UI-D-420); after a row's `X` the focus moves to the next row's
 * `X`, else the previous one, else the block's open button (UI-D-421). The
 * lock preview stays communities-only (A-UI-3): adding a course never opens a dialog, notifies
 * anyone or sends a push (PR-3).
 *
 * **No community locks without the admin being told** (D-364, UI-D-378, T-08.2-43): when the
 * selection adds a community that is not among the saved links, the save first asks the lock
 * preview and, if any of them would NEWLY lock, shows the danger confirmation with the exact count
 * of members losing access. A failed preview saves NOTHING; "Voltar" returns with the selection
 * kept. A community another product already gates comes back from the preview as no row, so it
 * saves without the dialog.
 */
export type ProductFormMode = 'create' | 'edit';

export interface ProductFormProps {
  mode: ProductFormMode;
  /** Edit mode only. */
  productId?: string;
  /** Edit mode only: the product as it stands (`productFormDefaults`). */
  initial?: ProductFormDefaults;
  /** The tenant's display name, for the image helper ("usamos as cores de {tenant}"). */
  tenantName: string;
  /**
   * The tenant's ACTIVE communities for the picker, or `null` while the communities module is off
   * (then the "Comunidades liberadas" field is absent and the save never sends links).
   */
  communities: readonly ProductFormCommunity[] | null;
  /**
   * The tenant's DRAFT and PUBLISHED courses for the "Cursos liberados" picker (08.4, UI-D-413), or
   * `null` while the courses module is off or the viewer lacks `courses.manage`: then the block is
   * absent from the DOM and the save never sends `courseIds`.
   */
  courses: ProductFormLinkList<ProductFormCourse> | null;
  /**
   * The tenant's NON-CANCELLED lives for the "Lives liberadas" picker (08.4, UI-D-413), upcoming then
   * past, under the SAME gate as `courses`: `null` = block absent, `liveIds` never sent.
   */
  lives: ProductFormLinkList<ProductFormLive> | null;
}

const ACCEPT = mediaAcceptFor('image', 'cover');
/** Announced at these percentages only, not on every tick (the `CommunityForm` rule). */
const QUARTILES = [25, 50, 75, 100];

const EMPTY: ProductFormDefaults = {
  name: '',
  description: '',
  priceText: '',
  priceCents: 0,
  imageAssetId: null,
  communities: [],
  courses: [],
  lives: [],
  status: 'active',
};

/** The price field's verdict on its text (UI-D-383). */
type PriceVerdict =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'too_high'; cents: number }
  | { kind: 'ok'; cents: number };

export function priceVerdict(text: string): PriceVerdict {
  if (text.trim() === '') return { kind: 'empty' };
  const cents = parseBrlToCents(text);
  if (cents === null) return { kind: 'invalid' };
  if (cents > STORE_MAX_PRICE_CENTS) return { kind: 'too_high', cents };
  return { kind: 'ok', cents };
}

/** Same members in any order: the link set is a SET. */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const other = new Set(b);
  return a.every((id) => other.has(id));
}

/**
 * The selected rows' order (08.4, UI-D-414, the API's own order after a save): the newly picked
 * ids first, in pick order, then the saved ids still selected, in the detail's order.
 */
function linkOrder(selected: readonly string[], saved: readonly string[]): string[] {
  const savedSet = new Set(saved);
  const picked = selected.filter((id) => !savedSet.has(id));
  const kept = saved.filter((id) => selected.includes(id));
  return [...picked, ...kept];
}

/** Every course (or live) the form can name: the saved links, refreshed by the picker's rows. */
function knownLinks<T extends { id: string }>(
  saved: readonly T[],
  listed: readonly T[] | undefined,
): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of saved) map.set(row.id, row);
  for (const row of listed ?? []) map.set(row.id, row);
  return map;
}

function toggled(current: readonly string[], id: string): string[] {
  return current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
}

export function ProductForm({
  mode,
  productId,
  initial,
  tenantName,
  communities,
  courses,
  lives,
}: ProductFormProps) {
  const t = useTranslations('store');
  /** Full-key translator for the shared `lib/store-view` builders (`store.lockWarning.…`). */
  const tRoot = useTranslations() as unknown as StoreTranslator;
  const tm = useTranslations('media');
  const toast = useToast();
  const router = useRouter();

  const start = initial ?? EMPTY;
  const [name, setName] = useState(start.name);
  const [description, setDescription] = useState(start.description);
  const [priceText, setPriceText] = useState(start.priceText);
  /** The price error shows once the field has been left (or a save tried), then follows each edit. */
  const [priceTouched, setPriceTouched] = useState(false);
  const [imageAssetId, setImageAssetId] = useState<string | null>(start.imageAssetId);
  const [imageWidths, setImageWidths] = useState<readonly number[]>(PURPOSE_WIDTHS.cover);
  const [selected, setSelected] = useState<string[]>(() => start.communities.map((c) => c.id));
  const [selectedCourses, setSelectedCourses] = useState<string[]>(() =>
    start.courses.map((course) => course.id),
  );
  const [selectedLives, setSelectedLives] = useState<string[]>(() =>
    start.lives.map((live) => live.id),
  );

  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [imageError, setImageError] = useState<string | null>(null);
  const [serverPriceError, setServerPriceError] = useState<string | undefined>(undefined);
  /** UI-D-419: a refused course or live set, drawn under its block until that block changes. */
  const [courseError, setCourseError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [coursePickerOpen, setCoursePickerOpen] = useState(false);
  const [livePickerOpen, setLivePickerOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [statusDialog, setStatusDialog] = useState<'archive' | 'reactivate' | null>(null);
  /**
   * The lock warning and the cents its confirm will save (D-364). The last one is kept after
   * closing so the dialog's exit animation never flashes empty words.
   */
  const [lockWarning, setLockWarning] = useState<{ view: LockWarningView; cents: number } | null>(
    null,
  );
  const [lockOpen, setLockOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const inputRef = useRef<HTMLInputElement>(null);

  // The picked file stands in for the image while the worker derives its ladder.
  const imagePreview = useCoverPreview(imageAssetId);
  const upload = useSignedUpload({
    kind: 'image',
    purpose: 'cover',
    // No toast: the preview replacing the gradient IS the confirmation; nothing is saved yet.
    successKey: null,
    onPicked: imagePreview.onPicked,
    onCompleted: (asset) => {
      imagePreview.onUploaded(asset.id);
      setImageAssetId(asset.id);
      const widths = asset.variants.map((variant) => variant.width);
      setImageWidths(widths.length > 0 ? widths : PURPOSE_WIDTHS.cover);
      setImageError(null);
    },
  });

  const uploading = upload.state === 'preparing' || upload.state === 'progress';
  const announced = QUARTILES.includes(upload.progress)
    ? tm('progress', { percent: upload.progress })
    : '';

  /** Every community the form can name: the saved links, refreshed by the picker's rows. */
  const known = useMemo(() => {
    const map = new Map<string, ProductFormCommunity>();
    for (const community of start.communities) map.set(community.id, community);
    for (const community of communities ?? []) map.set(community.id, community);
    return map;
  }, [communities, start.communities]);

  const selectedRows = selected
    .map((id) => known.get(id))
    .filter((row): row is ProductFormCommunity => row !== undefined);

  /** 08.4: the saved courses plus the picker's rows (a saved course outside the walked pages stays named). */
  const knownCourses = useMemo(
    () => knownLinks(start.courses, courses?.items),
    [courses, start.courses],
  );
  const startCourseIds = useMemo(() => start.courses.map((course) => course.id), [start.courses]);
  const courseRows = linkOrder(selectedCourses, startCourseIds)
    .map((id) => knownCourses.get(id))
    .filter((row): row is ProductFormCourse => row !== undefined);

  const knownLives = useMemo(() => knownLinks(start.lives, lives?.items), [lives, start.lives]);
  const startLiveIds = useMemo(() => start.lives.map((live) => live.id), [start.lives]);
  const liveRows = linkOrder(selectedLives, startLiveIds)
    .map((id) => knownLives.get(id))
    .filter((row): row is ProductFormLive => row !== undefined);

  const price = priceVerdict(priceText);
  const priceError =
    serverPriceError ??
    (priceTouched && price.kind === 'invalid'
      ? t('form.errors.priceInvalid')
      : priceTouched && price.kind === 'too_high'
        ? t('form.errors.priceTooHigh')
        : undefined);

  const startIds = start.communities.map((community) => community.id);
  const linksChanged = communities !== null && !sameSet(selected, startIds);
  const coursesChanged = courses !== null && !sameSet(selectedCourses, startCourseIds);
  const livesChanged = lives !== null && !sameSet(selectedLives, startLiveIds);
  const priceChanged = price.kind !== 'ok' || price.cents !== start.priceCents;
  const dirty =
    name !== start.name ||
    description !== start.description ||
    imageAssetId !== start.imageAssetId ||
    (mode === 'create' ? priceText !== start.priceText : priceChanged) ||
    linksChanged ||
    coursesChanged ||
    livesChanged;

  /** UI-D-377: valid (a name and a price within the cap) and, on edit, dirty. */
  const valid = name.trim().length > 0 && price.kind === 'ok';
  const busy = pending || uploading;
  const submittable = valid && (mode === 'create' || dirty);

  const back = mode === 'edit' && productId ? `/loja/${productId}` : '/loja';

  const close = () => {
    if (dirty) {
      setDiscarding(true);
      return;
    }
    leaveForm(router, back);
  };

  /** The create body, or the edit patch with ONLY the changed keys (D-363, no defaults). */
  const payload = (cents: number): ProductInput | ProductPatch => {
    if (mode === 'create') {
      return {
        name,
        description,
        priceCents: cents,
        imageAssetId,
        ...(communities !== null ? { communityIds: selected } : {}),
        ...(courses !== null ? { courseIds: selectedCourses } : {}),
        ...(lives !== null ? { liveIds: selectedLives } : {}),
      };
    }
    const patch: ProductPatch = {};
    if (name !== start.name) patch.name = name;
    if (description !== start.description) patch.description = description;
    if (cents !== start.priceCents) patch.priceCents = cents;
    if (imageAssetId !== start.imageAssetId) patch.imageAssetId = imageAssetId;
    if (linksChanged) patch.communityIds = selected;
    if (coursesChanged) patch.courseIds = selectedCourses;
    if (livesChanged) patch.liveIds = selectedLives;
    return patch;
  };

  /** Field issues land under their field; anything else is the save toast (draft kept). */
  const showRefusal = (code: StoreIssue | 'not_found' | 'generic') => {
    switch (code) {
      case 'name_required':
        setNameError(t('form.errors.nameRequired'));
        return;
      case 'price_invalid':
        setServerPriceError(t('form.errors.priceInvalid'));
        return;
      case 'image_invalid':
        setImageError(t('form.errors.imageInvalid'));
        return;
      case 'course_invalid':
        setCourseError(t('form.errors.courseInvalid'));
        return;
      case 'too_many_courses':
        setCourseError(t('form.errors.tooManyCourses', { max: STORE_MAX_LINKS }));
        return;
      case 'live_invalid':
        setLiveError(t('form.errors.liveInvalid'));
        return;
      case 'too_many_lives':
        setLiveError(t('form.errors.tooManyLives', { max: STORE_MAX_LINKS }));
        return;
      default:
        toast.show({ tone: 'error', message: t('form.errors.save') });
    }
  };

  /** Runs the write; resolves once the outcome has been shown (or the page left). */
  const save = async (cents: number): Promise<void> => {
    const body = payload(cents);
    let result: ProductWriteResult;
    try {
      result =
        mode === 'edit' && productId
          ? await updateProductAction(productId, body)
          : await createProductAction(body);
    } catch (error) {
      // Shape only: never a product name.
      console.error('store.save_failed', { error: String(error) });
      toast.show({ tone: 'error', message: t('form.errors.save') });
      return;
    }
    if (result.ok) {
      const done = {
        tone: 'success',
        message: mode === 'edit' ? t('toasts.saved') : t('toasts.created'),
      } as const;
      toast.show(done);
      // 2026-10-09: an edit returns to the product it changed and a create replaces the form with
      // the new product, so the form is never left behind that product's "Voltar".
      const landing = `/loja/${result.productId}`;
      if (mode !== 'edit') replaceFormWith(router, landing);
      else if (!returnAfterSave(router, landing, done)) router.push(landing);
      return;
    }
    showRefusal(result.code);
  };

  const submit = () => {
    setNameError(undefined);
    setServerPriceError(undefined);
    setPriceTouched(true);
    if (name.trim().length === 0) {
      setNameError(t('form.errors.nameRequired'));
      return;
    }
    if (price.kind !== 'ok') return;
    const cents = price.cents;

    // D-364: only communities that are not among the SAVED links can newly lock anything.
    const added = communities === null ? [] : selected.filter((id) => !startIds.includes(id));
    if (added.length === 0) {
      startTransition(async () => {
        await save(cents);
      });
      return;
    }

    startTransition(async () => {
      let preview: Awaited<ReturnType<typeof lockPreviewAction>>;
      try {
        preview = await lockPreviewAction({
          ...(mode === 'edit' && productId ? { productId } : {}),
          communityIds: added,
        });
      } catch (error) {
        console.error('store.lock_preview_failed', { error: String(error) });
        preview = { ok: false };
      }
      // The prohibition: without the preview's answer nothing is saved.
      if (!preview.ok) {
        toast.show({ tone: 'error', message: t('form.errors.lockPreview') });
        return;
      }
      const names = new Map([...known].map(([id, community]) => [id, community.name]));
      const view = lockWarningView(preview.items, names, tRoot);
      if (view === null) {
        await save(cents);
        return;
      }
      setLockWarning({ view, cents });
      setLockOpen(true);
    });
  };

  const changeStatus = async () => {
    if (!productId || statusDialog === null) return;
    const target = statusDialog === 'archive' ? 'archived' : 'active';
    const result = await setProductStatusAction(productId, target);
    if (!result.ok) {
      toast.show({
        tone: 'error',
        message: statusDialog === 'archive' ? t('errors.archive') : t('errors.reactivate'),
      });
      return;
    }
    const done = {
      tone: 'success',
      message: statusDialog === 'archive' ? t('toasts.archived') : t('toasts.reactivated'),
    } as const;
    toast.show(done);
    const landing = `/loja/${productId}`;
    if (!returnAfterSave(router, landing, done)) router.push(landing);
  };

  const toggle = (id: string) => {
    setSelected((current) => toggled(current, id));
  };

  const toggleCourse = (id: string) => {
    setSelectedCourses((current) => toggled(current, id));
    setCourseError(null);
  };

  const toggleLive = (id: string) => {
    setSelectedLives((current) => toggled(current, id));
    setLiveError(null);
  };

  const submitLabel = pending
    ? mode === 'edit'
      ? t('form.saving')
      : t('form.creating')
    : mode === 'edit'
      ? t('form.save')
      : t('form.create');

  const pickerRows = (communities ?? []).map((community) => ({ ...community, coverAlt: '' }));

  return (
    <form
      data-product-form
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
        {/* ── (1) Imagem: the 4:5 preview the card and the product page share (UI-D-369). ── */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-normal text-text-secondary">{t('form.image.label')}</span>

          <div
            data-product-image-preview
            className="relative aspect-[4/5] w-full max-w-[240px] overflow-hidden rounded-xl bg-bg-tertiary"
          >
            {imagePreview.previewUrl ? (
              // biome-ignore lint/performance/noImgElement: a local object URL of the file being uploaded; next/image cannot load it (the `CommunityCover` precedent)
              <img
                src={imagePreview.previewUrl}
                alt={t('form.image.preview')}
                data-product-image-local
                className="h-full w-full object-cover"
              />
            ) : imageAssetId !== null ? (
              <MediaImage
                assetId={imageAssetId}
                widths={imageWidths}
                alt={t('form.image.preview')}
                sizes="240px"
                ratio=""
                className="h-full w-full"
              />
            ) : (
              <span
                data-product-image-fallback
                aria-hidden
                className="block h-full w-full"
                style={{ backgroundImage: 'var(--brand-gradient)' }}
              />
            )}
          </div>

          <div className="hidden md:block">
            <FileDropZone
              id="product-image-dropzone"
              icon={ImageIcon}
              accept={ACCEPT}
              // The hook owns the verdict (a phone photo is re-encoded in the browser).
              screen={false}
              state={
                upload.state === 'progress' || upload.state === 'processing' ? upload.state : 'idle'
              }
              progress={upload.progress}
              onFile={(file) => void upload.pick(file)}
              labels={{
                caption: imageAssetId ? t('form.image.change') : t('form.image.add'),
                progress: (percent) => tm('progress', { percent }),
                processing: tm('photo.preparing'),
              }}
            />
          </div>

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            aria-label={imageAssetId ? t('form.image.change') : t('form.image.add')}
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
              onClick={() => inputRef.current?.click()}
            >
              <ImageIcon aria-hidden size={18} className="shrink-0" />
              {imageAssetId ? t('form.image.change') : t('form.image.add')}
            </Button>
            {imageAssetId ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={uploading}
                onClick={() => {
                  setImageAssetId(null);
                  setImageError(null);
                  upload.reset();
                }}
              >
                <X aria-hidden size={18} className="shrink-0" />
                {t('form.image.remove')}
              </Button>
            ) : null}
          </div>

          {upload.state === 'progress' ? (
            <div className="flex flex-col gap-2">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={upload.progress}
                className="h-1 w-full overflow-hidden rounded-full bg-bg-tertiary"
              >
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-200 ease-linear"
                  style={{ width: `${upload.progress}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs tabular-nums text-text-tertiary">
                  {tm('progress', { percent: upload.progress })}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={upload.cancel}>
                  {tm('cancel')}
                </Button>
              </div>
            </div>
          ) : null}

          <span aria-live="polite" className="sr-only">
            {announced}
          </span>

          {upload.error || imageError ? (
            <p role="alert" data-product-image-error className="text-sm font-normal text-danger">
              {upload.error ?? imageError}
            </p>
          ) : null}
          <p className="text-xs font-normal text-text-tertiary">
            {t('form.image.helper', { tenant: tenantName })}
          </p>
        </div>

        {/* ── (2) Nome ── */}
        <Input
          id="product-name"
          name="name"
          label={t('form.name.label')}
          placeholder={t('form.name.placeholder')}
          value={name}
          maxLength={STORE_MAX_NAME}
          required
          error={nameError}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(undefined);
          }}
        />

        {/* ── (3) Descrição: grows to its content; the page scrolls (E11/long-text). ── */}
        <Textarea
          id="product-description"
          name="description"
          label={t('form.description.label')}
          placeholder={t('form.description.placeholder')}
          value={description}
          rows={4}
          maxLength={STORE_MAX_DESCRIPTION}
          counter={{ value: description.length, max: STORE_MAX_DESCRIPTION }}
          onInput={(event) => {
            const el = event.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
          }}
          onChange={(event) => setDescription(event.target.value)}
        />

        {/* ── (4) Preço (R$): integer cents through `parseBrlToCents` (UI-D-383). ── */}
        <div className="flex flex-col gap-2">
          <Input
            id="product-price"
            name="price"
            label={t('form.price.label')}
            placeholder={t('form.price.placeholder')}
            inputMode="decimal"
            autoComplete="off"
            className="tabular-nums"
            value={priceText}
            error={priceError}
            onChange={(event) => {
              setPriceText(event.target.value);
              setServerPriceError(undefined);
            }}
            onBlur={() => {
              setPriceTouched(true);
              const verdict = priceVerdict(priceText);
              if (verdict.kind === 'ok' || verdict.kind === 'too_high') {
                setPriceText(priceInputText(verdict.cents));
              }
            }}
          />
          <p className="text-xs font-normal text-text-tertiary">{t('form.price.helper')}</p>
        </div>

        {/* ── (5) Comunidades liberadas: only while the communities module is on (D-363). ── */}
        {communities !== null ? (
          <div data-product-communities className="flex flex-col gap-2">
            <span className="text-sm font-normal text-text-secondary">
              {t('form.communities.label')}
            </span>
            {selectedRows.length > 0 ? (
              <ul className="flex flex-col">
                {selectedRows.map((row) => (
                  <li
                    key={row.id}
                    data-product-community={row.id}
                    className="flex min-h-11 items-center gap-3"
                  >
                    <CommunityThumb community={row} />
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-text">
                      {row.name}
                    </span>
                    <IconButton
                      icon={X}
                      size={18}
                      className="shrink-0 text-text-tertiary"
                      label={t('form.communities.remove', { community: row.name })}
                      disabled={pending}
                      onClick={() => toggle(row.id)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p data-product-communities-none className="text-xs font-normal text-text-tertiary">
                {t('form.communities.none')}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="md"
              className="self-start"
              data-product-communities-open
              disabled={pending}
              onClick={() => setPickerOpen(true)}
            >
              <Plus aria-hidden size={18} className="shrink-0" />
              {selectedRows.length > 0
                ? t('form.communities.change')
                : t('form.communities.choose')}
            </Button>
            <p className="text-xs font-normal text-text-tertiary">{t('form.communities.helper')}</p>

            <CommunityPickerSheet
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              title={t('form.picker.title')}
              helper={t('form.picker.helper')}
              rows={pickerRows}
              rowLabel={(row) =>
                selected.includes(row.id)
                  ? t('form.picker.rowOn', { community: row.name })
                  : t('form.picker.rowOff', { community: row.name })
              }
              onSelect={(row) => toggle(row.id)}
              trailing={(row) =>
                selected.includes(row.id) ? (
                  <Check aria-hidden size={20} strokeWidth={2.5} className="text-brand" />
                ) : (
                  <span aria-hidden className="block h-5 w-5" />
                )
              }
              footer={
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  fullWidth
                  data-product-picker-done
                  onClick={() => setPickerOpen(false)}
                >
                  {t('form.picker.done')}
                </Button>
              }
            />
          </div>
        ) : null}

        {/* ── (5b) Cursos liberados: only while the courses module is on and the viewer manages
            courses (08.4, D-418, UI-D-413). A clone of the communities block (UI-D-414). ── */}
        {courses !== null ? (
          <LinkBlock
            markers={COURSE_MARKERS}
            shape="poster"
            label={t('form.courses.label')}
            rows={courseRows}
            removeLabel={(title) => t('form.courses.remove', { course: title })}
            onRemove={toggleCourse}
            none={t('form.courses.none')}
            openLabel={courseRows.length > 0 ? t('form.courses.change') : t('form.courses.choose')}
            onOpen={() => setCoursePickerOpen(true)}
            helper={t('form.courses.helper')}
            error={courseError}
            disabled={pending}
          >
            <CoursePickerSheet
              open={coursePickerOpen}
              onClose={() => setCoursePickerOpen(false)}
              onDone={() => setCoursePickerOpen(false)}
              title={t('form.coursePicker.title')}
              helper={
                courses.capped && !courses.failed
                  ? t('form.coursePicker.helperCapped', { count: courses.items.length })
                  : t('form.coursePicker.helper')
              }
              // UI-D-419: a failed read is never an empty school; the saved rows stay in the block.
              items={courses.failed ? [] : courses.items.map((row) => pickerItem(row, 'poster'))}
              selectedIds={selectedCourses}
              onToggle={toggleCourse}
              labels={{
                rowOn: (title) => t('form.coursePicker.rowOn', { course: title }),
                rowOff: (title) => t('form.coursePicker.rowOff', { course: title }),
                done: t('form.coursePicker.done'),
              }}
              empty={
                courses.failed
                  ? {
                      title: t('form.errors.coursesUnavailable'),
                      body: t('form.errors.pickerUnavailableBody'),
                    }
                  : {
                      title: t('form.coursePicker.empty.title'),
                      body: t('form.coursePicker.empty.body'),
                    }
              }
            />
          </LinkBlock>
        ) : null}

        {/* ── (5c) Lives liberadas: under the same gate as the courses (08.4, UI-D-413). ── */}
        {lives !== null ? (
          <LinkBlock
            markers={LIVE_MARKERS}
            shape="wide"
            label={t('form.lives.label')}
            rows={liveRows}
            removeLabel={(title) => t('form.lives.remove', { live: title })}
            onRemove={toggleLive}
            none={t('form.lives.none')}
            openLabel={liveRows.length > 0 ? t('form.lives.change') : t('form.lives.choose')}
            onOpen={() => setLivePickerOpen(true)}
            helper={t('form.lives.helper')}
            error={liveError}
            disabled={pending}
          >
            <CoursePickerSheet
              open={livePickerOpen}
              onClose={() => setLivePickerOpen(false)}
              onDone={() => setLivePickerOpen(false)}
              title={t('form.livePicker.title')}
              helper={
                lives.capped && !lives.failed
                  ? t('form.livePicker.helperCapped', { count: lives.items.length })
                  : t('form.livePicker.helper')
              }
              items={lives.failed ? [] : lives.items.map((row) => pickerItem(row, 'wide'))}
              selectedIds={selectedLives}
              onToggle={toggleLive}
              thumbShape="wide"
              emptyIcon={Radio}
              labels={{
                rowOn: (title) => t('form.livePicker.rowOn', { live: title }),
                rowOff: (title) => t('form.livePicker.rowOff', { live: title }),
                done: t('form.livePicker.done'),
              }}
              empty={
                lives.failed
                  ? {
                      title: t('form.errors.livesUnavailable'),
                      body: t('form.errors.pickerUnavailableBody'),
                    }
                  : {
                      title: t('form.livePicker.empty.title'),
                      body: t('form.livePicker.empty.body'),
                    }
              }
            />
          </LinkBlock>
        ) : null}

        {/* ── (6) Edit only: archive or reactivate, each behind its dialog (UI-D-38 pattern). ── */}
        {mode === 'edit' && productId ? (
          <>
            <div aria-hidden className="h-px bg-border" />
            {start.status === 'archived' ? (
              <Button
                type="button"
                variant="outline"
                size="md"
                data-product-reactivate
                className="justify-start self-start"
                onClick={() => setStatusDialog('reactivate')}
              >
                <ArchiveRestore aria-hidden size={20} />
                {t('form.reactivate')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="md"
                data-product-archive
                className="justify-start self-start px-0 text-danger"
                onClick={() => setStatusDialog('archive')}
              >
                <Archive aria-hidden size={20} />
                {t('form.archive')}
              </Button>
            )}
          </>
        ) : null}
      </div>

      {/* D-364 / UI-D-378: the danger confirmation; its pending state covers the save. A refusal
          after confirming toasts (in `save`) and the dialog closes onto the kept draft. */}
      <ConfirmDialog
        open={lockOpen && lockWarning !== null}
        tone="danger"
        icon={Lock}
        title={lockWarning?.view.title ?? ''}
        body={lockWarning?.view.body}
        confirmLabel={lockWarning?.view.confirmLabel ?? ''}
        cancelLabel={lockWarning?.view.cancelLabel ?? ''}
        scrollBody
        onConfirm={async () => {
          if (lockWarning) await save(lockWarning.cents);
        }}
        onClose={() => setLockOpen(false)}
        onError={(error) => {
          console.error('store.save_failed', { error: String(error) });
          toast.show({ tone: 'error', message: t('form.errors.save') });
        }}
      />

      <ConfirmDialog
        open={discarding}
        tone="danger"
        title={t('form.discard.title')}
        body={t('form.discard.body')}
        confirmLabel={t('form.discard.confirm')}
        cancelLabel={t('form.discard.cancel')}
        onConfirm={() => leaveForm(router, back)}
        onClose={() => setDiscarding(false)}
      />

      <ConfirmDialog
        open={statusDialog !== null}
        tone={statusDialog === 'archive' ? 'danger' : 'brand'}
        icon={statusDialog === 'archive' ? Archive : ArchiveRestore}
        title={
          statusDialog === 'archive'
            ? t('form.archiveDialog.title')
            : t('form.reactivateDialog.title')
        }
        body={
          statusDialog === 'archive'
            ? t('form.archiveDialog.body')
            : t('form.reactivateDialog.body')
        }
        confirmLabel={
          statusDialog === 'archive'
            ? t('form.archiveDialog.confirm')
            : t('form.reactivateDialog.confirm')
        }
        cancelLabel={
          statusDialog === 'archive'
            ? t('form.archiveDialog.cancel')
            : t('form.reactivateDialog.cancel')
        }
        onConfirm={changeStatus}
        onClose={() => setStatusDialog(null)}
        onError={(error) => {
          console.error('store.status_failed', { error: String(error) });
          toast.show({ tone: 'error', message: t('form.errors.save') });
        }}
      />
    </form>
  );
}

/** The 32px community thumb: the cover, or the brand gradient (also when the cover fails). */
function CommunityThumb({ community }: { community: ProductFormCommunity }) {
  const gradient = (
    <span
      aria-hidden
      className="block h-8 w-8 shrink-0 rounded-lg"
      style={{ backgroundImage: 'var(--brand-gradient)' }}
    />
  );
  if (community.coverAssetId === null) return gradient;
  return (
    <span aria-hidden className="block h-8 w-8 shrink-0 overflow-hidden rounded-lg">
      <MediaImage
        assetId={community.coverAssetId}
        widths={community.coverVariantWidths}
        alt=""
        sizes="32px"
        ratio=""
        className="h-full w-full"
        fallback={gradient}
      />
    </span>
  );
}

/* ── 08.4: the course and live blocks (D-418, UI-D-414, UI-D-415) ─────────────────────────────── */

/** The thumb geometry per link kind: courses 3:4 `w-8` (32px), lives 16:10 `w-12` (48px) (UI-D-409). */
const THUMB_SHAPE = {
  poster: { slot: 'w-8 aspect-[3/4]', sizes: '32px' },
  wide: { slot: 'w-12 aspect-[16/10]', sizes: '48px' },
} as const;
type ThumbShape = keyof typeof THUMB_SHAPE;

/** A course or a live as the blocks and the sheets draw it (`ProductFormCourse` / `ProductFormLive`). */
interface LinkRowView {
  id: string;
  title: string;
  coverAssetId: string | null;
  coverVariantWidths: readonly number[];
  meta: string | null;
}

/** The DOM markers of one block (the e2e and the unit tests read them). */
interface LinkMarkers {
  block: string;
  row: string;
  none: string;
  open: string;
  error: string;
}

const COURSE_MARKERS: LinkMarkers = {
  block: 'data-product-courses',
  row: 'data-product-course',
  none: 'data-product-courses-none',
  open: 'data-product-courses-open',
  error: 'data-product-courses-error',
};

const LIVE_MARKERS: LinkMarkers = {
  block: 'data-product-lives',
  row: 'data-product-live',
  none: 'data-product-lives-none',
  open: 'data-product-lives-open',
  error: 'data-product-lives-error',
};

/** The brand gradient that stands in for a missing or failed cover (D-69); it never changes size. */
function gradient(className: string) {
  return (
    <span aria-hidden className={className} style={{ backgroundImage: 'var(--brand-gradient)' }} />
  );
}

/** A picker row: the cover fills the sheet's thumb slot (the sheet draws the gradient when absent). */
function pickerItem(row: LinkRowView, shape: ThumbShape) {
  return {
    id: row.id,
    title: row.title,
    ...(row.meta ? { meta: row.meta } : {}),
    ...(row.coverAssetId === null
      ? {}
      : {
          thumb: (
            <MediaImage
              assetId={row.coverAssetId}
              widths={row.coverVariantWidths}
              alt=""
              sizes={THUMB_SHAPE[shape].sizes}
              ratio=""
              className="h-full w-full"
              fallback={gradient('block h-full w-full')}
            />
          ),
        }),
  };
}

/** A selected row's thumb: the cover at the member-facing ratio, or the brand gradient. */
function LinkThumb({ row, shape }: { row: LinkRowView; shape: ThumbShape }) {
  const slot = `block shrink-0 overflow-hidden rounded-lg bg-bg-tertiary ${THUMB_SHAPE[shape].slot}`;
  if (row.coverAssetId === null) return gradient(slot);
  return (
    <span aria-hidden className={slot}>
      <MediaImage
        assetId={row.coverAssetId}
        widths={row.coverVariantWidths}
        alt=""
        sizes={THUMB_SHAPE[shape].sizes}
        ratio=""
        className="h-full w-full"
        fallback={gradient('block h-full w-full')}
      />
    </span>
  );
}

interface LinkBlockProps {
  markers: LinkMarkers;
  shape: ThumbShape;
  label: string;
  rows: readonly LinkRowView[];
  removeLabel: (title: string) => string;
  onRemove: (id: string) => void;
  none: string;
  openLabel: string;
  onOpen: () => void;
  helper: string;
  /** UI-D-419: the refusal of this block's set (14/400 danger, `role="alert"`), or `null`. */
  error: string | null;
  /** While the submit runs, the block's controls are inert (E07 loading). */
  disabled: boolean;
  /** The block's picker sheet. */
  children: ReactNode;
}

/**
 * "Cursos liberados" / "Lives liberadas" (08.4, UI-D-414): the communities block cloned — the
 * secondary label naming the list, the selected rows (thumb, 14/700 title and 12/400 meta both
 * truncating, the `X` 18), the none line, the outline open button and the helper. Every word arrives
 * from the form; titles and metas render as React text (T-08.4-11).
 */
function LinkBlock({
  markers,
  shape,
  label,
  rows,
  removeLabel,
  onRemove,
  none,
  openLabel,
  onOpen,
  helper,
  error,
  disabled,
  children,
}: LinkBlockProps) {
  const labelId = `${markers.block}-label`;
  const rootRef = useRef<HTMLDivElement>(null);
  /**
   * UI-D-421: where the focus goes once a removed row has left the DOM: the next row's `X`, else the
   * previous row's, else the open button (`null` = nothing pending).
   */
  const [focusAfterRemove, setFocusAfterRemove] = useState<{ rowId: string | null } | null>(null);

  useEffect(() => {
    if (focusAfterRemove === null) return;
    const root = rootRef.current;
    setFocusAfterRemove(null);
    if (!root) return;
    const target =
      focusAfterRemove.rowId === null
        ? root.querySelector<HTMLElement>(`[${markers.open}]`)
        : (Array.from(root.querySelectorAll<HTMLElement>(`[${markers.row}]`))
            .find((row) => row.getAttribute(markers.row) === focusAfterRemove.rowId)
            ?.querySelector<HTMLElement>('button') ?? null);
    target?.focus();
  }, [focusAfterRemove, markers]);

  const remove = (index: number) => {
    const row = rows[index];
    if (!row) return;
    const neighbour = rows[index + 1] ?? rows[index - 1] ?? null;
    onRemove(row.id);
    setFocusAfterRemove({ rowId: neighbour?.id ?? null });
  };

  return (
    <div ref={rootRef} {...{ [markers.block]: '' }} className="flex flex-col gap-2">
      <span id={labelId} className="text-sm font-normal text-text-secondary">
        {label}
      </span>
      {rows.length > 0 ? (
        <ul aria-labelledby={labelId} className="flex flex-col">
          {rows.map((row, index) => (
            <li
              key={row.id}
              {...{ [markers.row]: row.id }}
              className="flex min-h-11 items-center gap-3"
            >
              <LinkThumb row={row} shape={shape} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-bold text-text">{row.title}</span>
                {row.meta ? (
                  <span className="truncate text-xs font-normal text-text-secondary">
                    {row.meta}
                  </span>
                ) : null}
              </span>
              <IconButton
                icon={X}
                size={18}
                className="shrink-0 text-text-tertiary"
                label={removeLabel(row.title)}
                disabled={disabled}
                onClick={() => remove(index)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p {...{ [markers.none]: '' }} className="text-xs font-normal text-text-tertiary">
          {none}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="md"
        className="self-start"
        {...{ [markers.open]: '' }}
        disabled={disabled}
        onClick={onOpen}
      >
        <Plus aria-hidden size={18} className="shrink-0" />
        {openLabel}
      </Button>
      {error ? (
        <p role="alert" {...{ [markers.error]: '' }} className="text-sm font-normal text-danger">
          {error}
        </p>
      ) : null}
      <p className="text-xs font-normal text-text-tertiary">{helper}</p>
      {children}
    </div>
  );
}
