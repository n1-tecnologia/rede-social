'use client';

import { mediaAcceptFor, PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import {
  LESSON_PICKER_MAX,
  type LessonPickerItem,
  LIVE_MAX_DESCRIPTION,
  LIVE_MAX_DURATION,
  LIVE_MAX_TITLE,
  LIVE_MAX_URL,
  LIVE_MIN_DURATION,
  type LiveInput,
  type LivePatch,
  type LiveStatus,
} from '@rede-social/module-courses/contracts';
import { LessonPickerSheet } from '@rede-social/module-courses/ui';
import {
  Button,
  ConfirmDialog,
  FileDropZone,
  Input,
  PageHeader,
  SectionTitle,
  StatusPill,
  Textarea,
  useToast,
} from '@rede-social/ui';
import { ChevronDown, ExternalLink, Image as ImageIcon, Video, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useRef, useState, useTransition } from 'react';
import { useCoverPreview } from '@/components/media/useCoverPreview';
import { useSignedUpload } from '@/components/media/useSignedUpload';
import {
  groupLessonsForPicker,
  type LiveFormDefaults,
  type LiveWallClock,
  tenantWallClockToInstant,
} from '@/lib/courses-view';
import { type AccessProductView, communityAccessSegments } from '@/lib/store-view';
import {
  cancelLiveAction,
  createLiveAction,
  type LiveWriteResult,
  updateLiveAction,
} from '../live-actions';

/**
 * THE live form (08.3-11, D-416, D-418, UI-D-403, UI-D-404, UI-D-405, UI-D-418, COURSE-11): one component, two routes
 * — `/cursos/lives/nova` in `create` mode and `/cursos/lives/[liveId]` in `edit` mode. The
 * `TrackForm` shell (the admin's create/edit muscle memory): a task screen (`data-shell-hide="nav"`),
 * the `PageHeader` with the 44×44 `X` close (a dirty form asks "Descartar live?") and the brand submit
 * in the trailing slot; in edit mode the DERIVED status pill sits under the title.
 *
 * A live is an agenda entry (D-416). Sections: Capa (the track's 16:10 block), Título (120), Descrição
 * (2 000), **Quando** — the `EventForm` pair (`date` + `time step=300` in the
 * `grid-cols-[minmax(0,1fr)_8rem]` row, stacked below 360px) and Duração (`number` 5–600, suffix
 * "min", the helper), **Onde acontece** — the `type="url"` "Link da transmissão" (https only), **Acesso**
 * — edit mode only, READ-ONLY: "Liberada pelos produtos: …" with each product a link to `/loja/{id}`,
 * only while the store is on, the admin manages it and a product opens the live (UI-D-418; also on a
 * cancelled live), **Replay** — edit mode, ONLY once the server says
 * the live is `recorded`: the 44px picker row opening the module's `LessonPickerSheet` grouped by
 * course — and, on edit, the hairline and the `ghost` danger "Cancelar live" (or the cancelled note).
 *
 * **The clock is the server's** (UI-D-403, UI-D-407): the status arrives with the page, the replay
 * row shows only when the server computed `recorded`, and NOTHING here reads the browser clock. The two
 * inputs hold the TENANT's wall clock; the submit builds the ISO instant with
 * `tenantWallClockToInstant(start, timeZone)` so 19:00 in São Paulo is stored as 22:00Z (A-UI-5: a
 * start in the past is accepted and reads "Gravada"). A cancelled live is read-only: every field is
 * disabled, the note replaces the cancel row, the replay row is hidden (the API refuses
 * `409 live_cancelled` anyway).
 *
 * **One write per save**: create → `POST` with the whole body; edit → `PATCH` with ONLY the changed
 * keys, `replayLessonId` among them. Neither ever carries a product link: since 08.4 the product form
 * in the Loja is the only place a live is linked to a product (D-418). Toasts: "Live agendada." /
 * "Alterações salvas." / "Replay definido." (when the patch carried the replay). Cancel →
 * "Cancelar live?" (danger; confirm "Cancelar live", dismiss "Voltar") → "Live cancelada." and the
 * form refreshes into its read-only state; nobody is notified (PR-10).
 *
 * **ZERO UPLOAD CODE LIVES HERE.** The cover runs the Phase 3 machine (`useSignedUpload`, purpose
 * `cover`), straight to Storage; this file holds an asset id, never bytes (MEDIA-01). Every field
 * renders as React text (T-08.3-25); every string comes from the `courses` catalog (PWA-03).
 */
export type LiveFormMode = 'create' | 'edit';

export interface LiveFormProps {
  mode: LiveFormMode;
  /** Edit mode only. */
  liveId?: string;
  /** Edit mode only: the live as it stands (`liveFormDefaults`). */
  initial?: LiveFormDefaults;
  /** Edit mode only: the status the SERVER computed when it answered the page (never recomputed). */
  status?: LiveStatus;
  /** The tenant's display name, for the cover helper ("usamos as cores de {tenant}"). */
  tenantName: string;
  /** `bootstrap.tenant.timezone`: the zone the date and time inputs are the wall clock of. */
  timeZone: string;
  /**
   * Edit mode only: the products that open the live (archived included, the API's order), or
   * undefined while the store is off, the admin lacks `store.product.manage` or no product links
   * the live — then the read-only Acesso line is absent (UI-D-418).
   */
  accessProducts?: readonly AccessProductView[];
  /**
   * The tenant's lessons for the replay picker (edit mode, `recorded` only), or `null` while they
   * load (the sheet draws skeletons). Absent on create and before the end.
   */
  lessons?: readonly LessonPickerItem[] | null;
  /** Where the close, the discard and a successful save land (the Lives tab by default). */
  returnHref?: string;
}

const ACCEPT = mediaAcceptFor('image', 'cover');
/** Announced at these percentages only, not on every tick (the `CommunityForm` rule). */
const QUARTILES = [25, 50, 75, 100];

/** The Lives tab. */
const LIVES_TAB = '/cursos?aba=lives';

/** The planned slot the form opens with: an hour, the sketch's figure (within 5..600). */
const DEFAULT_DURATION = 60;

const EMPTY_START: LiveWallClock = { date: '', time: '' };

/** The gradient the 16:10 preview falls back to (D-69, UI-D-403). */
const GRADIENT = (
  <span
    aria-hidden
    className="block h-full w-full"
    style={{ backgroundImage: 'var(--brand-gradient)' }}
  />
);

/** The duration field's verdict on its text: an integer within the contract's bounds. */
export type DurationVerdict = { kind: 'invalid' } | { kind: 'ok'; minutes: number };

export function durationVerdict(text: string): DurationVerdict {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return { kind: 'invalid' };
  const minutes = Number(trimmed);
  if (!Number.isInteger(minutes) || minutes < LIVE_MIN_DURATION || minutes > LIVE_MAX_DURATION) {
    return { kind: 'invalid' };
  }
  return { kind: 'ok', minutes };
}

/** `https` only (D-416, T-08.3-11): the browser's URL parser, then the scheme, then the cap. */
export function isHttpsUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > LIVE_MAX_URL) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** The pill tones of UI-D-392: Ao vivo `success`, the rest `neutral`. */
const PILL_TONE: Record<LiveStatus, 'neutral' | 'success'> = {
  scheduled: 'neutral',
  live: 'success',
  recorded: 'neutral',
  cancelled: 'neutral',
};

export function LiveForm({
  mode,
  liveId,
  initial,
  status,
  tenantName,
  timeZone,
  accessProducts,
  lessons = null,
  returnHref = LIVES_TAB,
}: LiveFormProps) {
  const t = useTranslations('courses');
  const tRoot = useTranslations();
  const tm = useTranslations('media');
  const toast = useToast();
  const router = useRouter();

  const start = initial;
  const [title, setTitle] = useState(start?.title ?? '');
  const [description, setDescription] = useState(start?.description ?? '');
  const [coverAssetId, setCoverAssetId] = useState<string | null>(start?.coverAssetId ?? null);
  const [coverWidths, setCoverWidths] = useState<readonly number[]>(PURPOSE_WIDTHS.cover);
  const [when, setWhen] = useState<LiveWallClock>(start?.start ?? EMPTY_START);
  const [durationText, setDurationText] = useState(String(start?.durationMin ?? DEFAULT_DURATION));
  const [url, setUrl] = useState(start?.externalUrl ?? '');
  const [replayLessonId, setReplayLessonId] = useState<string | null>(
    start?.replayLesson?.id ?? null,
  );

  const [titleTouched, setTitleTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverTitleError, setServerTitleError] = useState<string | undefined>(undefined);
  const [serverStartError, setServerStartError] = useState<string | undefined>(undefined);
  const [serverDurationError, setServerDurationError] = useState<string | undefined>(undefined);
  const [serverUrlError, setServerUrlError] = useState<string | undefined>(undefined);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);

  const [replayOpen, setReplayOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pending, startTransition] = useTransition();

  const coverInputRef = useRef<HTMLInputElement>(null);
  const startErrorId = useId();
  const replayHelperId = useId();

  const cancelled = mode === 'edit' && status === 'cancelled';
  const recorded = mode === 'edit' && status === 'recorded';
  /** A cancelled live is read-only (the API refuses `409 live_cancelled`); nothing here may change. */
  const readOnly = cancelled;

  /* ── The cover: the Phase 3 machine, purpose `cover`, a 16:10 preview (UI-D-403, UI-D-409) ──── */
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

  /* ── Lessons the form can name ─────────────────────────────────────────────────────────────── */
  const lessonGroups = useMemo(() => groupLessonsForPicker(lessons ?? []), [lessons]);
  /** "{course} · {lesson}" for the chosen replay, from the picker's rows or the saved pointer. */
  const replayLabel = useMemo(() => {
    if (replayLessonId === null) return null;
    const fromPicker = (lessons ?? []).find((lesson) => lesson.id === replayLessonId);
    if (fromPicker) return { course: fromPicker.courseTitle, lesson: fromPicker.title };
    if (start?.replayLesson && start.replayLesson.id === replayLessonId) {
      return { course: start.replayLesson.courseTitle, lesson: start.replayLesson.title };
    }
    return null;
  }, [lessons, replayLessonId, start?.replayLesson]);

  /* ── Verdicts, dirtiness and the submit gate (UI-D-403, E13 error) ──────────────────────────── */
  const startsAt = tenantWallClockToInstant(when, timeZone);
  const duration = durationVerdict(durationText);
  const urlOk = isHttpsUrl(url);

  const titleError =
    serverTitleError ??
    ((titleTouched || submitted) && title.trim().length === 0
      ? t('live.form.errors.titleRequired')
      : undefined);
  const startError =
    serverStartError ??
    (submitted && startsAt === null ? t('live.form.errors.startRequired') : undefined);
  const durationError =
    serverDurationError ??
    (submitted && duration.kind === 'invalid' ? t('live.form.errors.durationInvalid') : undefined);
  const urlError =
    serverUrlError ?? (submitted && !urlOk ? t('live.form.errors.urlInvalid') : undefined);

  const startInstantChanged =
    start !== undefined &&
    (startsAt === null || Date.parse(startsAt) !== Date.parse(start.startsAt));
  const replayChanged = (start?.replayLesson?.id ?? null) !== replayLessonId;
  const dirty =
    start === undefined
      ? true
      : title !== start.title ||
        description !== start.description ||
        coverAssetId !== start.coverAssetId ||
        startInstantChanged ||
        (duration.kind === 'ok' ? duration.minutes !== start.durationMin : true) ||
        url !== start.externalUrl ||
        replayChanged;

  const valid = title.trim().length > 0 && startsAt !== null && duration.kind === 'ok' && urlOk;
  const busy = pending || coverUploading;
  /**
   * The submit arms on a title alone (the TrackForm rule): the start, the duration and the link are
   * judged ON the attempt, so their errors land under their fields (E13 error) instead of a silently
   * dead button. `submit()` stops before any write while `valid` is false.
   */
  const submittable = !readOnly && title.trim().length > 0 && (mode === 'create' || dirty);

  const close = () => {
    if (dirty && !readOnly && (mode === 'edit' || hasInput())) {
      setDiscarding(true);
      return;
    }
    router.push(returnHref);
  };

  /** On create, "dirty" means the admin typed something (the empty form closes without asking). */
  const hasInput = () =>
    title !== '' ||
    description !== '' ||
    coverAssetId !== null ||
    when.date !== '' ||
    when.time !== '' ||
    url !== '' ||
    durationText !== String(DEFAULT_DURATION);

  /** The create body, or the edit patch with ONLY the changed keys (no defaults; never a link, D-418). */
  const payload = (): LiveInput | LivePatch => {
    const minutes = duration.kind === 'ok' ? duration.minutes : DEFAULT_DURATION;
    if (mode === 'create' || start === undefined) {
      return {
        title,
        description,
        coverAssetId,
        startsAt: startsAt ?? '',
        durationMin: minutes,
        externalUrl: url.trim(),
      } as LiveInput;
    }
    const patch: LivePatch = {};
    if (title !== start.title) patch.title = title;
    if (description !== start.description) patch.description = description;
    if (coverAssetId !== start.coverAssetId) patch.coverAssetId = coverAssetId;
    if (startInstantChanged && startsAt !== null) patch.startsAt = startsAt;
    if (minutes !== start.durationMin) patch.durationMin = minutes;
    if (url !== start.externalUrl) patch.externalUrl = url.trim();
    if (replayChanged) patch.replayLessonId = replayLessonId;
    return patch;
  };

  /** Field issues land under their field; a race with a cancel refreshes into the server's truth. */
  const showRefusal = (result: Exclude<LiveWriteResult, { ok: true }>) => {
    switch (result.code) {
      case 'title_required':
      case 'title_too_long':
        setServerTitleError(t('live.form.errors.titleRequired'));
        return;
      case 'start_required':
        setServerStartError(t('live.form.errors.startRequired'));
        return;
      case 'duration_invalid':
        setServerDurationError(t('live.form.errors.durationInvalid'));
        return;
      case 'url_invalid':
        setServerUrlError(t('live.form.errors.urlInvalid'));
        return;
      case 'cover_invalid':
        setCoverError(t('form.errors.imageInvalid'));
        return;
      case 'lesson_invalid':
        setReplayError(t('live.form.errors.replayInvalid'));
        return;
      case 'live_cancelled':
      case 'replay_too_early':
        // The server's clock or a cancel moved under the form: show its truth, not the stale page.
        toast.show({ tone: 'error', message: t('form.errors.save') });
        router.refresh();
        return;
      case 'disabled':
        toast.show({ tone: 'error', message: t('errors.disabled') });
        return;
      default:
        toast.show({ tone: 'error', message: t('form.errors.save') });
    }
  };

  /** Runs the one write; resolves once the outcome has been shown (or the page left). */
  const save = async (): Promise<void> => {
    try {
      if (mode === 'create' || !liveId) {
        const created = await createLiveAction(payload());
        if (!created.ok) {
          showRefusal(created);
          return;
        }
        toast.show({ tone: 'success', message: t('toasts.liveScheduled') });
        router.push(returnHref);
        return;
      }
      const patch = payload() as LivePatch;
      if (Object.keys(patch).length === 0) {
        router.push(returnHref);
        return;
      }
      const updated = await updateLiveAction(liveId, patch);
      if (!updated.ok) {
        showRefusal(updated);
        return;
      }
      toast.show({
        tone: 'success',
        message:
          patch.replayLessonId !== undefined && patch.replayLessonId !== null
            ? t('toasts.replaySet')
            : t('toasts.saved'),
      });
      router.push(returnHref);
    } catch (error) {
      // Shape only: never a title or a link.
      console.error('courses.live_save_failed', { error: String(error) });
      toast.show({ tone: 'error', message: t('form.errors.save') });
    }
  };

  const submit = () => {
    setServerTitleError(undefined);
    setServerStartError(undefined);
    setServerDurationError(undefined);
    setServerUrlError(undefined);
    setCoverError(null);
    setReplayError(null);
    setTitleTouched(true);
    setSubmitted(true);
    if (!valid || readOnly) return;
    startTransition(async () => {
      await save();
    });
  };

  const cancel = async () => {
    if (!liveId) return;
    let result: LiveWriteResult;
    try {
      result = await cancelLiveAction(liveId);
    } catch (error) {
      console.error('courses.live_cancel_failed', { error: String(error) });
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
    toast.show({ tone: 'success', message: t('toasts.liveCancelled') });
    // The server now says `cancelled`: the refreshed page renders the note and the read-only form.
    router.refresh();
  };

  const submitLabel = pending
    ? mode === 'edit'
      ? t('form.saving')
      : t('form.creating')
    : mode === 'edit'
      ? t('form.save')
      : t('live.form.create');

  return (
    <form
      data-live-form
      data-mode={mode}
      data-live-status={status}
      data-shell-hide="nav"
      className="mx-auto flex w-full max-w-[680px] flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <PageHeader
        title={mode === 'edit' ? t('live.form.editTitle') : t('live.form.createTitle')}
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
        {/* ── (0) Edit only: the DERIVED status the server passed with the page (UI-D-403). ── */}
        {mode === 'edit' && status ? (
          <div data-live-status-pill className="-mt-2 flex">
            <StatusPill tone={PILL_TONE[status]}>{t(`status.${status}`)}</StatusPill>
          </div>
        ) : null}

        {/* ── (1) Capa: the 16:10 crop the live row shows (the track's block, UI-D-403). ── */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-normal text-text-secondary">{t('form.cover.label')}</span>
          <div
            data-live-cover-preview
            className="relative aspect-[16/10] w-full max-w-[320px] overflow-hidden rounded-xl bg-bg-tertiary"
          >
            {coverPreview.previewUrl ? (
              // biome-ignore lint/performance/noImgElement: a local object URL of the file being uploaded; next/image cannot load it (the `CommunityCover` precedent)
              <img
                src={coverPreview.previewUrl}
                alt={t('form.cover.preview')}
                data-live-cover-local
                className="h-full w-full object-cover object-center"
              />
            ) : coverAssetId !== null ? (
              <MediaImage
                assetId={coverAssetId}
                widths={coverWidths}
                alt={t('form.cover.preview')}
                sizes="320px"
                ratio=""
                className="h-full w-full"
                fallback={GRADIENT}
              />
            ) : (
              <span
                data-live-cover-fallback
                aria-hidden
                className="block h-full w-full"
                style={{ backgroundImage: 'var(--brand-gradient)' }}
              />
            )}
          </div>

          {readOnly ? null : (
            <>
              <div className="hidden md:block">
                <FileDropZone
                  id="live-cover-dropzone"
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
                <p role="alert" data-live-cover-error className="text-sm font-normal text-danger">
                  {coverUpload.error ?? coverError}
                </p>
              ) : null}
              <p className="text-xs font-normal text-text-tertiary">
                {t('live.form.coverHelper', { tenant: tenantName })}
              </p>
            </>
          )}
        </div>

        {/* ── (2) Título ── */}
        <Input
          id="live-title"
          name="title"
          label={t('form.title.label')}
          value={title}
          maxLength={LIVE_MAX_TITLE}
          required
          disabled={readOnly}
          error={titleError}
          onChange={(event) => {
            setTitle(event.target.value);
            setServerTitleError(undefined);
          }}
          onBlur={() => setTitleTouched(true)}
        />

        {/* ── (3) Descrição: grows to its content; the page scrolls. ── */}
        <Textarea
          id="live-description"
          name="description"
          label={t('form.description.label')}
          value={description}
          rows={4}
          maxLength={LIVE_MAX_DESCRIPTION}
          disabled={readOnly}
          counter={{ value: description.length, max: LIVE_MAX_DESCRIPTION }}
          onInput={(event) => {
            const el = event.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
          }}
          onChange={(event) => setDescription(event.target.value)}
        />

        {/* ── (4) Quando: the EventForm pair — the TENANT's wall clock — and the duration (UI-D-403). ──
          The date takes the free track beside an 8rem time; the pair stacks below 360px (E13 overflow). */}
        <div data-live-when className="flex flex-col gap-3">
          <SectionTitle variant="group" as="h2">
            {t('live.form.whenTitle')}
          </SectionTitle>
          <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-[minmax(0,1fr)_8rem]">
            <Input
              id="live-start-date"
              type="date"
              label={t('live.form.date')}
              value={when.date}
              required
              disabled={readOnly}
              aria-invalid={startError ? true : undefined}
              aria-describedby={startError ? startErrorId : undefined}
              className={startError ? 'border-danger' : undefined}
              onChange={(event) => {
                setWhen({ ...when, date: event.target.value });
                setServerStartError(undefined);
              }}
            />
            <Input
              id="live-start-time"
              type="time"
              step={300}
              label={t('live.form.time')}
              value={when.time}
              required
              disabled={readOnly}
              aria-invalid={startError ? true : undefined}
              aria-describedby={startError ? startErrorId : undefined}
              className={startError ? 'border-danger' : undefined}
              onChange={(event) => {
                setWhen({ ...when, time: event.target.value });
                setServerStartError(undefined);
              }}
            />
          </div>
          {startError ? (
            <p id={startErrorId} role="alert" data-live-start-error className="text-sm text-danger">
              {startError}
            </p>
          ) : null}

          <div className="flex flex-col gap-1">
            <div className="flex items-end gap-3">
              <Input
                id="live-duration"
                name="durationMin"
                type="number"
                inputMode="numeric"
                min={LIVE_MIN_DURATION}
                max={LIVE_MAX_DURATION}
                step={1}
                containerClassName="w-28"
                className="tabular-nums"
                label={t('live.form.duration')}
                value={durationText}
                required
                disabled={readOnly}
                error={durationError}
                onChange={(event) => {
                  setDurationText(event.target.value);
                  setServerDurationError(undefined);
                }}
              />
              <span className="pb-3 text-sm font-normal text-text-secondary">
                {t('live.form.durationSuffix')}
              </span>
            </div>
            <p className="text-xs font-normal text-text-tertiary">
              {t('live.form.durationHelper')}
            </p>
          </div>
        </div>

        {/* ── (5) Onde acontece: the https link (D-416, T-08.3-11). ── */}
        <div data-live-where className="flex flex-col gap-3">
          <SectionTitle variant="group" as="h2">
            {t('live.form.whereTitle')}
          </SectionTitle>
          <div className="flex flex-col gap-1">
            <Input
              id="live-url"
              name="externalUrl"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              icon={ExternalLink}
              label={t('live.form.url')}
              placeholder={t('live.form.urlPlaceholder')}
              value={url}
              maxLength={LIVE_MAX_URL}
              required
              disabled={readOnly}
              error={urlError}
              onChange={(event) => {
                setUrl(event.target.value);
                setServerUrlError(undefined);
              }}
            />
            <p className="text-xs font-normal text-text-tertiary">{t('live.form.urlHelper')}</p>
          </div>
        </div>

        {/* ── (6) Acesso, READ-ONLY (D-418, UI-D-418): edit mode only, and only while the store is on,
            the admin manages it and a product opens the live — also on a cancelled live. Each
            product links to its page in the Loja; no control writes from here. ── */}
        {mode === 'edit' && accessProducts !== undefined && accessProducts.length > 0 ? (
          <div data-live-access className="flex flex-col gap-2">
            <span className="text-sm font-normal text-text-secondary">
              {t('form.access.label')}
            </span>
            <p
              data-live-access-value
              className="text-sm font-normal text-text [overflow-wrap:anywhere]"
            >
              {communityAccessSegments(accessProducts, tRoot, 'courses.live.form.access.value').map(
                (segment, index) =>
                  segment.kind === 'text' ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: a fixed sentence, never reordered
                    <span key={`text-${index}`}>{segment.text}</span>
                  ) : (
                    <span key={segment.product.id}>
                      <a
                        href={segment.product.href}
                        data-live-access-product={segment.product.id}
                        className="font-bold text-text underline-offset-2 hover:underline [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                      >
                        {segment.product.name}
                      </a>
                      {segment.product.archived ? t('form.access.archivedSuffix') : null}
                    </span>
                  ),
              )}
            </p>
            <p className="text-xs font-normal text-text-tertiary">{t('form.access.helper')}</p>
          </div>
        ) : null}

        {/* ── (7) Replay: edit mode, ONLY once the server says the live has ended (A5, UI-D-403). ── */}
        {recorded ? (
          <div data-live-replay className="flex flex-col gap-2">
            <SectionTitle variant="group" as="h2">
              {t('live.form.replayTitle')}
            </SectionTitle>
            <button
              type="button"
              data-live-replay-row
              aria-describedby={replayHelperId}
              aria-haspopup="dialog"
              onClick={() => setReplayOpen(true)}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-border bg-bg-secondary px-3 py-2 text-left transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              <Video aria-hidden size={20} className="shrink-0 text-text-secondary" />
              <span
                data-live-replay-value
                className={
                  replayLabel
                    ? 'min-w-0 flex-1 truncate text-sm font-normal text-text'
                    : 'min-w-0 flex-1 truncate text-sm font-normal text-text-secondary'
                }
              >
                {replayLabel
                  ? t('live.form.replayValue', {
                      course: replayLabel.course,
                      lesson: replayLabel.lesson,
                    })
                  : t('live.form.replayNone')}
              </span>
              <ChevronDown aria-hidden size={18} className="shrink-0 text-text-tertiary" />
            </button>
            {replayError ? (
              <p role="alert" data-live-replay-error className="text-sm font-normal text-danger">
                {replayError}
              </p>
            ) : null}
            <p id={replayHelperId} className="text-xs font-normal text-text-tertiary">
              {t('live.form.replayHelper')}
            </p>

            <LessonPickerSheet
              open={replayOpen}
              onClose={() => setReplayOpen(false)}
              title={t('live.replay.title')}
              helper={
                // WR-06: the API lists at most LESSON_PICKER_MAX lessons (newest courses first); a
                // full list says so instead of truncating in silence.
                (lessons?.length ?? 0) >= LESSON_PICKER_MAX
                  ? t('live.replay.helperCapped', { count: LESSON_PICKER_MAX })
                  : t('live.replay.helper')
              }
              groups={lessonGroups}
              selectedId={replayLessonId}
              noneLabel={t('live.replay.none')}
              loading={lessons === null}
              onSelect={(id) => {
                setReplayLessonId(id);
                setReplayError(null);
                setReplayOpen(false);
              }}
              labels={{ row: (lesson, course) => t('live.replay.row', { lesson, course }) }}
              empty={{ title: t('live.replay.empty.title'), body: t('live.replay.empty.body') }}
            />
          </div>
        ) : null}

        {/* ── (8) Edit only: the hairline and "Cancelar live", or the cancelled note (UI-D-403). ── */}
        {mode === 'edit' && liveId ? (
          <>
            <div aria-hidden className="h-px bg-border" />
            {cancelled ? (
              <p data-live-cancelled-note className="text-sm font-normal text-text-secondary">
                {t('live.form.cancelledNote')}
              </p>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="md"
                data-live-cancel
                className="justify-start self-start px-0 text-danger"
                onClick={() => setCancelling(true)}
              >
                <X aria-hidden size={20} />
                {t('live.form.cancel')}
              </Button>
            )}
          </>
        ) : null}
      </div>

      <ConfirmDialog
        open={discarding}
        tone="danger"
        title={t('discard.live')}
        body={t('discard.body')}
        confirmLabel={t('discard.confirm')}
        cancelLabel={t('discard.cancel')}
        onConfirm={() => router.push(returnHref)}
        onClose={() => setDiscarding(false)}
      />

      {/* UI-D-404: the danger confirmation whose dismiss is "Voltar" (its confirm is itself "Cancelar live"). */}
      <ConfirmDialog
        open={cancelling}
        tone="danger"
        icon={X}
        title={t('live.cancelDialog.title')}
        body={t('live.cancelDialog.body')}
        confirmLabel={t('live.cancelDialog.confirm')}
        cancelLabel={t('live.cancelDialog.cancel')}
        onConfirm={cancel}
        onClose={() => setCancelling(false)}
        onError={(error) => {
          console.error('courses.live_cancel_failed', { error: String(error) });
          toast.show({ tone: 'error', message: t('form.errors.save') });
        }}
      />
    </form>
  );
}
