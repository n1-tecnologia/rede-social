'use client';

import { mediaAcceptFor, PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import {
  TRACK_MAX_AUDIENCE,
  TRACK_MAX_DESCRIPTION,
  TRACK_MAX_SUBTITLE,
  TRACK_MAX_TITLE,
  type TrackInput,
  type TrackPatch,
} from '@rede-social/module-courses/contracts';
import { CoursePickerSheet, ReorderList } from '@rede-social/module-courses/ui';
import {
  Button,
  ConfirmDialog,
  cn,
  IconButton,
  Input,
  PageHeader,
  SectionTitle,
  StatusPill,
  Textarea,
  useToast,
} from '@rede-social/ui';
import { Archive, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, useTransition } from 'react';
import { CoverSizeHint } from '@/components/media/CoverSizeHint';
import { useCoverPreview } from '@/components/media/useCoverPreview';
import { useSignedUpload } from '@/components/media/useSignedUpload';
import {
  publishedTrackCourseIds,
  TRACK_PICKER_MAX,
  type TrackFormCourse,
  type TrackFormDefaults,
  trackFilterHref,
} from '@/lib/courses-view';
import { DANGER_OVERRIDES, DASHED_OVERRIDES } from '../admin-styles';
import { CoverField } from '../CoverField';
import { PagePreview, TrackCardPreview } from '../CoverPreviews';
import {
  createTrackAction,
  replaceTrackCoursesAction,
  setTrackStatusAction,
  type TrackWriteResult,
  updateTrackAction,
} from '../track-actions';

/**
 * THE track form (08.3-10, D-414, D-415, UI-D-402, UI-D-404, UI-D-405, COURSE-10): one component,
 * two routes — `/cursos/trilhas/nova` in `create` mode and `/cursos/trilhas/[trackId]` in `edit`
 * mode. The `CourseForm` shell (the admin's create/edit/archive muscle memory): a task screen
 * (`data-shell-hide="nav"`), the `PageHeader` with the 44×44 `X` close (a dirty form asks "Descartar
 * trilha?") and the brand submit in the trailing slot.
 *
 * A track is a course picker and an order, nothing else (D-415). Sections: Capa (a 16:10 preview
 * capped at 320px, purpose `cover`), Título (120), Subtítulo (160), Para quem é (60), Descrição
 * (2 000, optional), Cursos da trilha — the selected courses as the module's `ReorderList`
 * (`renderItem`: a 40×53 3:4 thumb, the title in two lines, the two arrows the list builds and the
 * `X` "Remover {course}"), "Nenhum curso ainda." when empty, the `outline` "Escolher cursos" /
 * "Alterar cursos" opening the `CoursePickerSheet` over the PUBLISHED catalogue, and the helper — and,
 * on edit, the hairline and the `ghost` danger "Arquivar trilha" (or the archived note).
 *
 * **A linked course that is no longer published** (the admin read lists every link with its current
 * status) is drawn with the `neutral` "Não publicado" pill and a tertiary title, stays removable and
 * reorderable, and is EXCLUDED from the save (`publishedTrackCourseIds`): the API would refuse it
 * (`course_invalid`, COURSE-10), so the 400 is explained before it can happen. Its link row stays in
 * the database until the admin saves a list without it (D-415: drop at read time, never a delete).
 *
 * **The save is two writes, the second only when needed**: create → `POST` then ONE `PUT …/order`
 * with the published ids (only when the draft has any); edit → `PATCH` with ONLY the changed keys
 * (skipped when none changed) then ONE `PUT …/order` ONLY when the course list changed — the one write
 * path of membership and order (D-414, A8). A create whose `PUT` is refused keeps the form open on the
 * new track (`createdId`), so the next submit patches and retries the list rather than creating twice.
 * `course_invalid` toasts its sentence and keeps the list (E12 error).
 *
 * **ZERO UPLOAD CODE LIVES HERE.** The cover runs the Phase 3 machine (`useSignedUpload`, purpose
 * `cover`), straight to Storage; this file holds an asset id, never bytes (MEDIA-01). Every field
 * renders as React text (T-08.3-25); every string comes from the `courses` catalog (PWA-03).
 *
 * 2026-10-22 (the courses area redesign on the social-igoralves prototype): the cover is the shared
 * `CoverField` (the 16:10 frame IS the control); "Cursos da trilha" draws as the member's path — a
 * numbered disc per course on a rail (muted on a course that is no longer published), the course in
 * an outlined block beside it (thumb and title on top, the two arrows and the `X` on a row of their
 * own under the title, as on the prototype, so the 44px targets never squeeze the title on a phone),
 * and the picker's dashed "+" as the path's last node; "Arquivar trilha"
 * is the danger zone's outlined button. A save and an archive land on the Trilhas list's own page
 * (`/cursos/trilhas`, the archive on its Arquivadas chip). Rules, writes and hooks are unchanged.
 */
export type TrackFormMode = 'create' | 'edit';

export interface TrackFormProps {
  mode: TrackFormMode;
  /** Edit mode only. */
  trackId?: string;
  /** Edit mode only: the track as it stands (`trackFormDefaults`). */
  initial?: TrackFormDefaults;
  /** The tenant's display name, for the cover helper ("usamos as cores de {tenant}"). */
  tenantName: string;
  /** The tenant's PUBLISHED courses for the picker (the API's order, first 50). */
  courses: readonly TrackFormCourse[];
  /** Where the close, the discard and a successful save land (the Trilhas tab by default). */
  returnHref?: string;
}

const ACCEPT = mediaAcceptFor('image', 'cover');
/** Announced at these percentages only, not on every tick (the `CommunityForm` rule). */
const QUARTILES = [25, 50, 75, 100];

/** The Trilhas list's own page; an archive lands on its Arquivadas chip (2026-10-22). */
const TRACKS_TAB = trackFilterHref('active');
const ARCHIVED_TAB = trackFilterHref('archived');

const EMPTY: TrackFormDefaults = {
  title: '',
  subtitle: '',
  audience: '',
  description: '',
  coverAssetId: null,
  topCoverAssetId: null,
  courses: [],
  status: 'active',
};

/** The gradient the 16:10 preview and the 3:4 row thumbs fall back to (D-69, UI-D-409). */
const GRADIENT = (
  <span
    aria-hidden
    className="block h-full w-full"
    style={{ backgroundImage: 'var(--brand-gradient)' }}
  />
);

/** Same ids in the same order: the course list is an ORDERED list, so order counts. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** The 40×53 3:4 thumb of a selected or picker row: the catalogue's crop, or the tenant gradient. */
function CourseThumb({
  course,
  size,
}: {
  course: Pick<TrackFormCourse, 'coverAssetId' | 'title'>;
  size: 'row' | 'picker';
}) {
  const alt = '';
  const image =
    course.coverAssetId === null ? (
      GRADIENT
    ) : (
      <MediaImage
        assetId={course.coverAssetId}
        widths={PURPOSE_WIDTHS.cover}
        alt={alt}
        sizes={size === 'row' ? '40px' : '32px'}
        ratio=""
        className="h-full w-full"
        fallback={GRADIENT}
      />
    );
  if (size === 'picker') return <>{image}</>;
  return (
    <span
      aria-hidden
      data-track-course-thumb
      className="relative block h-[53px] w-10 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary"
    >
      {image}
    </span>
  );
}

export function TrackForm({
  mode,
  trackId,
  initial,
  tenantName,
  courses,
  returnHref = TRACKS_TAB,
}: TrackFormProps) {
  const t = useTranslations('courses');
  const tm = useTranslations('media');
  const toast = useToast();
  const router = useRouter();

  const start = initial ?? EMPTY;
  const [title, setTitle] = useState(start.title);
  const [subtitle, setSubtitle] = useState(start.subtitle);
  const [audience, setAudience] = useState(start.audience);
  const [description, setDescription] = useState(start.description);
  const [coverAssetId, setCoverAssetId] = useState<string | null>(start.coverAssetId);
  const [coverWidths, setCoverWidths] = useState<readonly number[]>(PURPOSE_WIDTHS.cover);
  /** NOVF-02: the Topo is its own image with its own id, never a copy of the card's (UI-D-691). */
  const [topCoverAssetId, setTopCoverAssetId] = useState<string | null>(start.topCoverAssetId);
  const [topCoverWidths, setTopCoverWidths] = useState<readonly number[]>(PURPOSE_WIDTHS.cover);
  /** The draft list, first to last, every row with its current status (UI-D-402). */
  const [selected, setSelected] = useState<TrackFormCourse[]>(() => [...start.courses]);

  const [titleTouched, setTitleTouched] = useState(false);
  const [serverTitleError, setServerTitleError] = useState<string | undefined>(undefined);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [topCoverError, setTopCoverError] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [pending, startTransition] = useTransition();
  /** A create whose course list was refused: the track exists, the next submit patches it. */
  const createdId = useRef<string | null>(null);

  const coursesTitleId = useId();
  const coursesHelperId = useId();

  /* ── The cover: the Phase 3 machine, purpose `cover`, a 16:10 preview (UI-D-402, UI-D-409) ──── */
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

  /* ── The Topo: a second machine of the same kind, its own asset (NOVF-02, UI-D-691) ───────────── */
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

  /* ── Verdicts, dirtiness and the submit gate ─────────────────────────────────────────────────── */
  const titleError =
    serverTitleError ??
    (titleTouched && title.trim().length === 0 ? t('track.form.errors.titleRequired') : undefined);

  const startIds = start.courses.map((course) => course.id);
  const selectedIds = selected.map((course) => course.id);
  const listChanged = !sameOrder(selectedIds, startIds);
  const fieldsChanged =
    title !== start.title ||
    subtitle !== start.subtitle ||
    audience !== start.audience ||
    description !== start.description ||
    coverAssetId !== start.coverAssetId ||
    topCoverAssetId !== start.topCoverAssetId;
  const dirty = fieldsChanged || listChanged;

  const valid = title.trim().length > 0;
  const busy = pending || coverUploading || topUploading;
  const submittable = valid && (mode === 'create' || dirty);
  const archived = mode === 'edit' && start.status === 'archived';

  /** The picker lists PUBLISHED courses only (D-415), whatever the page handed over. */
  const pickerItems = courses.filter((course) => course.status === 'published');

  const close = () => {
    if (dirty) {
      setDiscarding(true);
      return;
    }
    router.push(returnHref);
  };

  /** The create body, or the edit patch with ONLY the changed keys (no defaults re-applied). */
  const fieldPayload = (): TrackInput | TrackPatch => {
    if (mode === 'create' && createdId.current === null) {
      return { title, subtitle, audience, description, coverAssetId, topCoverAssetId };
    }
    const patch: TrackPatch = {};
    if (title !== start.title) patch.title = title;
    if (subtitle !== start.subtitle) patch.subtitle = subtitle;
    if (audience !== start.audience) patch.audience = audience;
    if (description !== start.description) patch.description = description;
    if (coverAssetId !== start.coverAssetId) patch.coverAssetId = coverAssetId;
    if (topCoverAssetId !== start.topCoverAssetId) patch.topCoverAssetId = topCoverAssetId;
    return patch;
  };

  /** Field issues land under their field; `course_invalid` and the rest are toasts (draft kept). */
  const showRefusal = (result: Exclude<TrackWriteResult, { ok: true }>) => {
    switch (result.code) {
      case 'title_required':
      case 'title_too_long':
        setServerTitleError(t('track.form.errors.titleRequired'));
        return;
      case 'cover_invalid':
        setCoverError(t('form.errors.imageInvalid'));
        return;
      case 'top_cover_invalid':
        setTopCoverError(t('coverField.topCover.invalid'));
        return;
      case 'course_invalid':
        toast.show({ tone: 'error', message: t('track.form.errors.courseInvalid') });
        return;
      case 'disabled':
        toast.show({ tone: 'error', message: t('errors.disabled') });
        return;
      default:
        toast.show({ tone: 'error', message: t('form.errors.save') });
    }
  };

  /**
   * Runs the writes; resolves once the outcome has been shown (or the page left). The course list is
   * the SECOND write and goes only when it has to: on create when the draft has published rows, on
   * edit when the list changed. Only the PUBLISHED rows are sent (UI-D-402).
   */
  const save = async (): Promise<void> => {
    const ids = publishedTrackCourseIds(selected);
    let id = mode === 'edit' ? (trackId ?? null) : createdId.current;
    try {
      if (id === null) {
        const created = await createTrackAction(fieldPayload());
        if (!created.ok) {
          showRefusal(created);
          return;
        }
        id = created.trackId;
        createdId.current = id;
        if (ids.length > 0) {
          const ordered = await replaceTrackCoursesAction(id, ids);
          if (!ordered.ok) {
            showRefusal(ordered);
            return;
          }
        }
        toast.show({ tone: 'success', message: t('toasts.trackCreated') });
        router.push(returnHref);
        return;
      }
      const patch = fieldPayload() as TrackPatch;
      if (Object.keys(patch).length > 0) {
        const updated = await updateTrackAction(id, patch);
        if (!updated.ok) {
          showRefusal(updated);
          return;
        }
      }
      // A create retried after a refused list has no "start" to compare against: send the list.
      if (listChanged || mode === 'create') {
        const ordered = await replaceTrackCoursesAction(id, ids);
        if (!ordered.ok) {
          showRefusal(ordered);
          return;
        }
      }
      toast.show({
        tone: 'success',
        message: mode === 'edit' ? t('toasts.saved') : t('toasts.trackCreated'),
      });
      router.push(returnHref);
    } catch (error) {
      // Shape only: never a title.
      console.error('courses.track_save_failed', { error: String(error) });
      toast.show({ tone: 'error', message: t('form.errors.save') });
    }
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

  const archive = async () => {
    if (!trackId) return;
    let result: TrackWriteResult;
    try {
      result = await setTrackStatusAction(trackId, 'archived');
    } catch (error) {
      console.error('courses.track_status_failed', { error: String(error) });
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
    toast.show({ tone: 'success', message: t('toasts.trackArchived') });
    router.push(ARCHIVED_TAB);
  };

  /* ── The course list: pick, remove, reorder (D-414, UI-D-402) ──────────────────────────────── */
  const toggleCourse = (id: string) => {
    setSelected((current) => {
      if (current.some((course) => course.id === id)) {
        return current.filter((course) => course.id !== id);
      }
      const course = pickerItems.find((item) => item.id === id);
      return course ? [...current, course] : current;
    });
  };

  const removeCourse = (id: string) => {
    setSelected((current) => current.filter((course) => course.id !== id));
  };

  const moveCourses = (ids: string[]) => {
    const byId = new Map(selected.map((course) => [course.id, course]));
    const next: TrackFormCourse[] = [];
    for (const id of ids) {
      const course = byId.get(id);
      if (!course) return;
      next.push(course);
    }
    if (next.length !== selected.length) return;
    setSelected(next);
  };

  const reorderLabels = {
    moveUp: (name: string) => t('reorder.moveUp', { name }),
    moveDown: (name: string) => t('reorder.moveDown', { name }),
    moved: (name: string, position: number, total: number) =>
      t('reorder.moved', { name, position, total }),
  };

  const rows = selected.map((course) => ({ ...course, name: course.title }));

  const submitLabel = pending
    ? mode === 'edit'
      ? t('form.saving')
      : t('form.creating')
    : mode === 'edit'
      ? t('form.save')
      : t('track.form.create');

  return (
    <form
      data-track-form
      data-mode={mode}
      data-shell-hide="nav"
      className="mx-auto flex w-full max-w-[680px] flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <PageHeader
        title={mode === 'edit' ? t('track.form.editTitle') : t('track.form.createTitle')}
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
        {/* ── (1) Capa: the 16:10 crop the track card and the member catalogue show (UI-D-402). ── */}
        {/* 2026-10-27 ("adicione os tipos de imagem que podem aparecer na trilha"): the two places a
            track's cover shows, each as the member sees it with the title being typed: the card of
            Início and Trilhas and the wide top of the track's page, each in its own block with its
            size and its own "Escolher arquivo" (one image under both: the track has one cover). */}
        <CoverField
          hook="track"
          ratio="card"
          dropzoneId="track-cover-dropzone"
          accept={ACCEPT}
          assetId={coverAssetId}
          widths={coverWidths}
          previewUrl={coverPreview.previewUrl}
          sizes="320px"
          upload={coverUpload}
          error={coverError}
          helper={t('track.form.coverHelper', { tenant: tenantName })}
          announced={coverAnnounced}
          layout="blocks"
          frameLabel={t('coverField.as.trackCard')}
          frameDecor={
            <TrackCardPreview
              eyebrow={t('member.home.trackEyebrow', { kind: 'other', n: selected.length })}
              title={title.trim()}
              cta={t('member.home.access')}
            />
          }
          topCover={{
            assetId: topCoverAssetId,
            widths: topCoverWidths,
            previewUrl: topPreview.previewUrl,
            upload: topUpload,
            error: topCoverError,
            announced: topAnnounced,
            ratio: 'banner',
            sizeHint: <CoverSizeHint kind="trackBanner" />,
            helper: t('coverField.topCover.helper'),
            fallbackStatus: t('coverField.topCover.fallback'),
            decor: (
              <PagePreview
                eyebrow={t('member.tracks.step', { n: 1, total: Math.max(1, selected.length) })}
                title={title.trim()}
              />
            ),
            labels: {
              field: t('coverField.as.trackPage'),
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
          sizeHint={<CoverSizeHint kind="trackCard" />}
          labels={{
            pickFile: t('coverField.pickFile'),
            camera: t('coverField.camera'),
            ways: t('coverField.ways'),
            waysTouch: t('coverField.waysTouch'),
            dropHere: t('coverField.dropHere'),
            field: t('form.cover.label'),
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

        {/* ── (2) Título ── */}
        <Input
          id="track-title"
          name="title"
          label={t('track.form.title')}
          value={title}
          maxLength={TRACK_MAX_TITLE}
          required
          error={titleError}
          onChange={(event) => {
            setTitle(event.target.value);
            setServerTitleError(undefined);
          }}
          onBlur={() => setTitleTouched(true)}
        />

        {/* ── (3) Subtítulo ── */}
        <Input
          id="track-subtitle"
          name="subtitle"
          label={t('track.form.subtitle')}
          value={subtitle}
          maxLength={TRACK_MAX_SUBTITLE}
          onChange={(event) => setSubtitle(event.target.value)}
        />

        {/* ── (4) Para quem é ── */}
        <Input
          id="track-audience"
          name="audience"
          label={t('track.form.audience')}
          placeholder={t('track.form.audiencePlaceholder')}
          value={audience}
          maxLength={TRACK_MAX_AUDIENCE}
          onChange={(event) => setAudience(event.target.value)}
        />

        {/* ── (5) Descrição: grows to its content; the page scrolls (E12 long-text). ── */}
        <Textarea
          id="track-description"
          name="description"
          label={t('track.form.description')}
          value={description}
          rows={4}
          maxLength={TRACK_MAX_DESCRIPTION}
          counter={{ value: description.length, max: TRACK_MAX_DESCRIPTION }}
          onInput={(event) => {
            const el = event.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
          }}
          onChange={(event) => setDescription(event.target.value)}
        />

        {/* ── (6) Cursos da trilha: the ordered path, the picker and the helper (D-414, D-415). ── */}
        <div data-track-courses className="flex flex-col gap-3">
          <SectionTitle id={coursesTitleId} as="h2" variant="group">
            {t('track.form.coursesTitle')}
          </SectionTitle>

          {selected.length === 0 ? (
            <p data-track-courses-none className="text-sm font-normal text-text-secondary">
              {t('track.form.none')}
            </p>
          ) : (
            <ReorderList
              items={rows}
              onChange={moveCourses}
              disabled={busy}
              labelledBy={coursesTitleId}
              describedBy={coursesHelperId}
              labels={reorderLabels}
              className="flex flex-col"
              testId="track-courses"
              renderItem={(row, arrows, index) => {
                const unpublished = row.status !== 'published';
                return (
                  // The path: a numbered disc on the rail (its line runs into the next node, the
                  // picker's "+" included), then the course's block.
                  <div className="flex gap-3 pb-2">
                    <span aria-hidden className="flex w-8 shrink-0 flex-col items-center">
                      <span
                        className={cn('h-3 w-0.5', index === 0 ? 'bg-transparent' : 'bg-border')}
                      />
                      <span
                        data-track-course-step
                        className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-card text-xs font-extrabold tabular-nums',
                          unpublished
                            ? 'border-border text-text-tertiary'
                            : 'border-brand/40 text-brand',
                        )}
                      >
                        {index + 1}
                      </span>
                      <span className="-mb-2 w-0.5 flex-1 bg-border" />
                    </span>
                    <div
                      data-track-course-row={row.id}
                      data-track-course-status={row.status}
                      className="flex min-w-0 flex-1 flex-col gap-1 rounded-xl border border-border bg-card px-2 pt-2 pb-1"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <CourseThumb course={row} size="row" />
                        {/* The only flexible child: the title gives way (two lines, then clipped). */}
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span
                            className={
                              unpublished
                                ? 'line-clamp-2 break-words text-sm font-bold text-text-tertiary'
                                : 'line-clamp-2 break-words text-sm font-bold text-text'
                            }
                          >
                            {row.title}
                          </span>
                          {unpublished ? (
                            <span className="self-start">
                              <StatusPill tone="neutral">{t('status.notPublished')}</StatusPill>
                            </span>
                          ) : null}
                        </span>
                      </div>
                      {/* The controls sit UNDER the title, right-aligned (the prototype's own call):
                          in a side column the three 44px targets eat the title on a 390px phone. */}
                      <div className="flex items-center justify-end gap-1">
                        {arrows}
                        <IconButton
                          icon={X}
                          size={20}
                          label={t('track.form.remove', { course: row.title })}
                          disabled={busy}
                          onClick={() => removeCourse(row.id)}
                          className="shrink-0"
                        />
                      </div>
                    </div>
                  </div>
                );
              }}
            />
          )}

          {/* The path's last node: the picker, a dashed "+" (Escolher cursos / Alterar cursos). */}
          <div className="flex gap-3">
            {selected.length > 0 ? (
              <span aria-hidden className="flex w-8 shrink-0 flex-col items-center">
                {/* The rail runs on from the last course, over the list's gap, into this node. */}
                <span className="-mt-3 h-[18px] w-0.5 bg-border" />
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-border bg-card text-text-tertiary">
                  <Plus size={14} />
                </span>
              </span>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="md"
              className={cn(DASHED_OVERRIDES, 'min-w-0 flex-1')}
              data-track-courses-pick
              disabled={busy}
              onClick={() => setPickerOpen(true)}
            >
              <Plus aria-hidden size={18} className="shrink-0" />
              {selected.length === 0 ? t('track.form.choose') : t('track.form.change')}
            </Button>
          </div>

          <p id={coursesHelperId} className="text-xs font-normal text-text-secondary">
            {t('track.form.coursesHelper')}
          </p>
        </div>

        {/* ── (7) Edit only: the hairline and the danger zone's "Arquivar trilha", or the archived
            note (UI-D-402). ── */}
        {mode === 'edit' && trackId ? (
          <>
            <div aria-hidden className="h-px bg-border" />
            {archived ? (
              <p data-track-archived-note className="text-sm font-normal text-text-secondary">
                {t('track.form.archivedNote')}
              </p>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="md"
                data-track-archive
                className={DANGER_OVERRIDES}
                onClick={() => setArchiving(true)}
              >
                <Archive aria-hidden size={18} />
                {t('track.form.archive')}
              </Button>
            )}
          </>
        ) : null}
      </div>

      <CoursePickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onDone={() => setPickerOpen(false)}
        title={t('track.picker.title')}
        helper={
          // WR-06: a list that reached the walk's cap says it shows only the most recent courses.
          courses.length >= TRACK_PICKER_MAX
            ? t('track.picker.helperCapped', { count: TRACK_PICKER_MAX })
            : t('track.picker.helper')
        }
        items={pickerItems.map((course) => ({
          id: course.id,
          title: course.title,
          thumb:
            course.coverAssetId === null ? undefined : (
              <CourseThumb course={course} size="picker" />
            ),
        }))}
        selectedIds={selectedIds}
        onToggle={toggleCourse}
        labels={{
          rowOn: (course) => t('track.picker.rowOn', { course }),
          rowOff: (course) => t('track.picker.rowOff', { course }),
          done: t('track.picker.done'),
        }}
        empty={{ title: t('track.picker.empty.title'), body: t('track.picker.empty.body') }}
      />

      <ConfirmDialog
        open={discarding}
        tone="danger"
        title={t('discard.track')}
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
        title={t('track.archiveDialog.title')}
        body={t('track.archiveDialog.body')}
        confirmLabel={t('track.archiveDialog.confirm')}
        cancelLabel={t('track.archiveDialog.cancel')}
        onConfirm={archive}
        onClose={() => setArchiving(false)}
        onError={(error) => {
          console.error('courses.track_status_failed', { error: String(error) });
          toast.show({ tone: 'error', message: t('form.errors.save') });
        }}
      />
    </form>
  );
}
