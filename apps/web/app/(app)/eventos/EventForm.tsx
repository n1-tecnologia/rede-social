'use client';

import { mediaAcceptFor, PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import {
  EVENT_DEFAULT_DURATION_MINUTES,
  EVENT_MAX_ADDRESS,
  EVENT_MAX_DESCRIPTION,
  EVENT_MAX_TITLE,
  EVENT_MAX_URL,
  EVENT_MAX_VENUE,
  type EventFormat,
  eventInputSchema,
  type WallClock,
} from '@rede-social/module-events/contracts';
import { EventCover } from '@rede-social/module-events/ui';
import {
  Button,
  ConfirmDialog,
  cn,
  FileDropZone,
  Input,
  PageHeader,
  SectionTitle,
  SegmentedControl,
  Textarea,
  useToast,
} from '@rede-social/ui';
import { Image as ImageIcon, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, useTransition } from 'react';
import { useSignedUpload } from '@/components/media/useSignedUpload';
import { CancelEventControl } from './[eventId]/CancelEventControl';
import { ReactivateEventControl } from './[eventId]/ReactivateEventControl';
import { createEventAction, type EventWriteResult, updateEventAction } from './actions';

/**
 * THE event form (EVENT-01, UI-D-212, sketch 006 surface 1): one component, two routes,
 * `/eventos/novo` in `create` mode and `/eventos/[eventId]/editar` in `edit` mode bound to values.
 *
 * **The community form's chrome** (UI-D-38): a full-screen route, `PageHeader stickyTop="0px"` with
 * the `X` "Fechar" (a dirty form confirms the discard first), the title, and the trailing brand submit
 * with its pending label. The cover runs the Phase 3 machine (`useSignedUpload`, `purpose: 'cover'`):
 * this file holds an asset id, never a byte.
 *
 * **Wall clock in, nothing converted here** (D-213). The four native inputs hold the TENANT's wall
 * clock as typed and are submitted as `{ date, time }` pairs; the API converts them in SQL with
 * `tenants.timezone`, so the device's zone never enters. The zone helper under "Quando" is a string
 * the server computed. The only arithmetic here is the end prefill: start + 2 h on the CALENDAR
 * (`Date.UTC` as a neutral calendar, never a zone), rolling past midnight, and only while the admin
 * has not touched the end by hand.
 *
 * **The XOR is visible and honest** (D-213): "Formato" is a `SegmentedControl`, Presencial / Online.
 * Switching keeps the hidden side's values in memory, but ONLY the visible side is submitted, and the
 * same `eventInputSchema` the API uses validates it here first.
 *
 * **Errors wait for the first submit** (the CommunityForm rule, UI E10/empty): the submit is disabled
 * until the name, the four date/time fields and the active format's fields are filled; after the
 * first submit, each field shows its own inline message and a failed save shows the top
 * `role="alert"` card with every value kept.
 *
 * Edit mode adds the note under "Quando" and the bottom row: "Cancelar evento" while active and before
 * the end, "Reativar evento" while cancelled and before the start, or the locked note. All three
 * flags are computed by the RSC from ONE request instant (UI-D-14: no clock read in client render).
 */
export type EventFormMode = 'create' | 'edit';

export type EventFormInitial = {
  title: string;
  description: string;
  coverAssetId: string | null;
  coverVariantWidths: readonly number[];
  format: EventFormat;
  venueName: string;
  address: string;
  meetingUrl: string;
  start: WallClock;
  end: WallClock;
};

export type EventFormProps = {
  mode: EventFormMode;
  /** Edit mode only. */
  eventId?: string;
  /** Edit mode only: the event in the TENANT's wall clock, as the manage-only read returned it. */
  initial?: EventFormInitial;
  /** The tenant's display name, for the cover helper. */
  tenantName: string;
  /** The tenant zone's generic name ("Horário Padrão de Brasília"), computed on the server. */
  zoneLabel: string;
  /** Edit mode only, server-computed: active and `now < ends_at`. */
  canCancel?: boolean;
  /** Edit mode only, server-computed: cancelled and `now < starts_at`. */
  canReactivate?: boolean;
  /** Edit mode only, server-computed: cancelled and `now >= starts_at` (no way back). */
  cancelledLocked?: boolean;
};

const ACCEPT = mediaAcceptFor('image', 'cover');
/** Announced at these percentages only, not on every tick. */
const QUARTILES = [25, 50, 75, 100];

const EMPTY: EventFormInitial = {
  title: '',
  description: '',
  coverAssetId: null,
  coverVariantWidths: PURPOSE_WIDTHS.cover,
  format: 'in_person',
  venueName: '',
  address: '',
  meetingUrl: '',
  start: { date: '', time: '' },
  end: { date: '', time: '' },
};

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/**
 * `start + minutes` on the wall-clock CALENDAR, rolling the date past midnight. `Date.UTC` is used
 * as a zone-free calendar only: both sides are the same tenant wall clock, so no zone is involved.
 * `null` while either part is missing or malformed.
 */
export function wallClockPlus(value: WallClock, minutes: number): WallClock | null {
  const [y, m, d] = value.date.split('-').map(Number);
  const [hh, mm] = value.time.split(':').map(Number);
  if ([y, m, d, hh, mm].some((part) => part === undefined || Number.isNaN(part))) return null;
  const shifted = new Date(
    Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0) + minutes * 60_000,
  );
  return {
    date: `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
  };
}

type FieldKey = 'title' | 'start' | 'end' | 'venue' | 'address' | 'url';

const filled = (value: string) => value.trim().length > 0;

export function EventForm({
  mode,
  eventId,
  initial,
  tenantName,
  zoneLabel,
  canCancel = false,
  canReactivate = false,
  cancelledLocked = false,
}: EventFormProps) {
  const t = useTranslations('events');
  const tm = useTranslations('media');
  const toast = useToast();
  const router = useRouter();
  const ids = useId();

  const start = initial ?? EMPTY;
  const [title, setTitle] = useState(start.title);
  const [description, setDescription] = useState(start.description);
  const [coverAssetId, setCoverAssetId] = useState<string | null>(start.coverAssetId);
  const [coverWidths, setCoverWidths] = useState<readonly number[]>(start.coverVariantWidths);
  const [format, setFormat] = useState<EventFormat>(start.format);
  // Both sides of the XOR live in memory; only the visible one is submitted.
  const [venueName, setVenueName] = useState(start.venueName);
  const [address, setAddress] = useState(start.address);
  const [meetingUrl, setMeetingUrl] = useState(start.meetingUrl);
  const [startAt, setStartAt] = useState<WallClock>(start.start);
  const [endAt, setEndAt] = useState<WallClock>(start.end);
  // An edit arrives with an end the admin chose, so the prefill never overwrites it.
  const [endTouched, setEndTouched] = useState(mode === 'edit');

  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [pending, startTransition] = useTransition();

  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useSignedUpload({
    kind: 'image',
    purpose: 'cover',
    // No toast: the preview replacing the gradient IS the confirmation, and nothing is saved yet.
    successKey: null,
    onCompleted: (asset) => {
      setCoverAssetId(asset.id);
      setCoverWidths(asset.variants.map((variant) => variant.width));
      setFormError(null);
    },
  });

  const uploading = upload.state === 'preparing' || upload.state === 'progress';
  const announced = QUARTILES.includes(upload.progress)
    ? tm('progress', { percent: upload.progress })
    : '';
  const busy = pending || uploading;
  const inPerson = format === 'in_person';

  /** The body the API receives: the VISIBLE side of the XOR only (D-213). */
  const payload = inPerson
    ? { title, description, coverAssetId, format, venueName, address, start: startAt, end: endAt }
    : { title, description, coverAssetId, format, meetingUrl, start: startAt, end: endAt };

  const dirty =
    JSON.stringify([
      title,
      description,
      coverAssetId,
      format,
      venueName,
      address,
      meetingUrl,
      startAt,
      endAt,
    ]) !==
    JSON.stringify([
      start.title,
      start.description,
      start.coverAssetId,
      start.format,
      start.venueName,
      start.address,
      start.meetingUrl,
      start.start,
      start.end,
    ]);

  /** UI-D-212: every required field of the visible side is filled. */
  const submittable =
    filled(title) &&
    filled(startAt.date) &&
    filled(startAt.time) &&
    filled(endAt.date) &&
    filled(endAt.time) &&
    (inPerson ? filled(venueName) && filled(address) : filled(meetingUrl));

  /**
   * Each field's message, from the SAME schema the API validates with. Computed every render, shown
   * only after the first submit (UI E10/empty), so a fix clears its message as the admin types.
   */
  const errors: Partial<Record<FieldKey, string>> = {};
  if (submitted) {
    const parsed = eventInputSchema.safeParse(payload);
    const issues = parsed.success ? [] : parsed.error.issues;
    const has = (message: string) => issues.some((issue) => issue.message === message);
    const on = (field: string) => issues.some((issue) => issue.path[0] === field);
    if (has('name_required')) errors.title = t('form.errors.nameRequired');
    if (on('start')) errors.start = t('form.errors.startRequired');
    if (issues.some((issue) => issue.path[0] === 'end' && issue.message !== 'end_before_start')) {
      errors.end = t('form.errors.endRequired');
    } else if (has('end_before_start')) {
      errors.end = t('form.errors.endBeforeStart');
    }
    if (inPerson) {
      if (!filled(venueName)) errors.venue = t('form.errors.venueRequired');
      if (!filled(address)) errors.address = t('form.errors.addressRequired');
    } else if (!filled(meetingUrl)) {
      errors.url = t('form.errors.urlRequired');
    } else if (has('url_invalid') || has('url_required')) {
      errors.url = t('form.errors.urlInvalid');
    }
  }

  const back = mode === 'edit' && eventId ? `/eventos/${eventId}` : '/eventos';

  const close = () => {
    if (dirty) {
      setDiscarding(true);
      return;
    }
    router.push(back);
  };

  /** D-213: a start change moves an UNTOUCHED end to start + 2 h. */
  const changeStart = (next: WallClock) => {
    setStartAt(next);
    if (endTouched) return;
    const prefill = wallClockPlus(next, EVENT_DEFAULT_DURATION_MINUTES);
    if (prefill) setEndAt(prefill);
  };

  const changeEnd = (next: WallClock) => {
    setEndTouched(true);
    setEndAt(next);
  };

  /** Exhaustive enough over what the actions answer: anything unmapped is the generic save line. */
  const messageFor = (code: Extract<EventWriteResult, { ok: false }>['code']): string => {
    switch (code) {
      case 'cover_invalid':
        return t('form.errors.coverInvalid');
      case 'not_found':
        return t('notFound.title');
      default:
        return t('form.errors.save');
    }
  };

  const submit = () => {
    setSubmitted(true);
    setFormError(null);
    const parsed = eventInputSchema.safeParse(payload);
    if (!parsed.success) {
      setFormError(t('form.errors.save'));
      return;
    }
    startTransition(async () => {
      const result =
        mode === 'edit' && eventId
          ? await updateEventAction(eventId, parsed.data)
          : await createEventAction(parsed.data);
      if (result.ok) {
        toast.show({
          tone: 'success',
          message: mode === 'edit' ? t('toasts.saved') : t('toasts.created'),
        });
        router.push(`/eventos/${result.eventId}`);
        return;
      }
      setFormError(messageFor(result.code));
    });
  };

  const submitLabel = pending
    ? mode === 'edit'
      ? t('form.submitSaving')
      : t('form.submitCreating')
    : mode === 'edit'
      ? t('form.submitEdit')
      : t('form.submitCreate');

  /** The title over the preview: white over the photo's veil, the tenant ink over the gradient. */
  const coverTitle = (ink: string) =>
    filled(title) ? (
      <div className="absolute right-4 bottom-3 left-4">
        <p className={cn('line-clamp-2 text-lg font-bold leading-tight', ink)}>{title}</p>
      </div>
    ) : null;

  const startErrorId = `${ids}-start-error`;
  const endErrorId = `${ids}-end-error`;
  const titleCounterAtCap = title.length >= EVENT_MAX_TITLE;

  return (
    <form
      data-event-form
      data-mode={mode}
      noValidate
      className="mx-auto flex w-full max-w-[680px] flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <PageHeader
        title={mode === 'edit' ? t('form.titleEdit') : t('form.titleCreate')}
        backIcon={X}
        backLabel={t('form.close')}
        onBack={close}
        stickyTop="0px"
        className="md:static md:px-0"
        trailing={
          <Button
            type="submit"
            variant="brand"
            size="sm"
            data-event-submit
            disabled={!submittable || busy}
            loading={busy}
            aria-busy={busy || undefined}
          >
            {submitLabel}
          </Button>
        }
      />

      <div className="flex flex-col gap-6 px-4 py-4 md:gap-8 md:px-6">
        {formError ? (
          <p
            role="alert"
            data-event-form-error
            className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm font-normal text-danger"
          >
            {formError}
          </p>
        ) : null}

        {/* ── (1) Capa: the hero geometry, so the admin sees what a member will see. ── */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-normal text-text-secondary">{t('form.cover.label')}</span>
          <div data-event-cover-preview className="overflow-hidden rounded-xl">
            <EventCover
              geometry="hero"
              coverAssetId={coverAssetId}
              coverVariantWidths={coverWidths}
              coverAlt={t('cover.alt', { title: title || tenantName })}
              overlay={coverTitle('text-white')}
              fallbackOverlay={coverTitle('')}
            />
          </div>
          <div className="hidden md:block">
            <FileDropZone
              id="event-cover-dropzone"
              icon={ImageIcon}
              accept={ACCEPT}
              // The hook owns the verdict: a phone-format or over-cap image is re-encoded first.
              screen={false}
              state={
                upload.state === 'progress' || upload.state === 'processing' ? upload.state : 'idle'
              }
              progress={upload.progress}
              onFile={(file) => void upload.pick(file)}
              labels={{
                caption: coverAssetId ? t('form.cover.change') : t('form.cover.add'),
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
            data-event-cover-input
            aria-label={coverAssetId ? t('form.cover.change') : t('form.cover.add')}
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
              <ImageIcon aria-hidden size={16} />
              {coverAssetId ? t('form.cover.change') : t('form.cover.add')}
            </Button>
            {coverAssetId ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={uploading}
                onClick={() => {
                  setCoverAssetId(null);
                  upload.reset();
                }}
              >
                {t('form.cover.remove')}
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

          {upload.error ? (
            <p role="alert" className="text-sm font-normal text-danger">
              {upload.error}
            </p>
          ) : (
            <p className="text-xs font-normal text-text-tertiary">
              {t('form.cover.helper', { tenant: tenantName })}
            </p>
          )}
        </div>

        {/* ── (2) Nome, with the counter the Input primitive does not carry. ── */}
        <div className="flex flex-col gap-2">
          <Input
            id="event-title"
            name="title"
            label={t('form.name.label')}
            placeholder={t('form.name.placeholder')}
            value={title}
            maxLength={EVENT_MAX_TITLE}
            required
            error={errors.title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <span
            aria-live="off"
            className={cn(
              'text-right text-xs tabular-nums',
              titleCounterAtCap ? 'text-danger' : 'text-text-tertiary',
            )}
          >
            {title.length}/{EVENT_MAX_TITLE}
          </span>
        </div>

        {/* ── (3) Descrição. ── */}
        <Textarea
          id="event-description"
          name="description"
          label={t('form.description.label')}
          placeholder={t('form.description.placeholder')}
          value={description}
          rows={4}
          maxLength={EVENT_MAX_DESCRIPTION}
          counter={{ value: description.length, max: EVENT_MAX_DESCRIPTION }}
          onInput={(event) => {
            const el = event.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
          }}
          onChange={(event) => setDescription(event.target.value)}
        />

        {/* ── (4) Quando: native date + time, wall clock of the TENANT. ── */}
        <div className="flex flex-col gap-3">
          <SectionTitle variant="group" as="h3">
            {t('form.when.title')}
          </SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Input
              id="event-start-date"
              type="date"
              label={t('form.when.startDate')}
              value={startAt.date}
              required
              aria-invalid={errors.start ? true : undefined}
              aria-describedby={errors.start ? startErrorId : undefined}
              className={errors.start ? 'border-danger' : undefined}
              onChange={(event) => changeStart({ ...startAt, date: event.target.value })}
            />
            <Input
              id="event-start-time"
              type="time"
              step={300}
              label={t('form.when.startTime')}
              value={startAt.time}
              required
              aria-invalid={errors.start ? true : undefined}
              aria-describedby={errors.start ? startErrorId : undefined}
              className={errors.start ? 'border-danger' : undefined}
              onChange={(event) => changeStart({ ...startAt, time: event.target.value })}
            />
          </div>
          {errors.start ? (
            <p id={startErrorId} role="alert" className="text-sm text-danger">
              {errors.start}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Input
              id="event-end-date"
              type="date"
              label={t('form.when.endDate')}
              value={endAt.date}
              required
              aria-invalid={errors.end ? true : undefined}
              aria-describedby={errors.end ? endErrorId : undefined}
              className={errors.end ? 'border-danger' : undefined}
              onChange={(event) => changeEnd({ ...endAt, date: event.target.value })}
            />
            <Input
              id="event-end-time"
              type="time"
              step={300}
              label={t('form.when.endTime')}
              value={endAt.time}
              required
              aria-invalid={errors.end ? true : undefined}
              aria-describedby={errors.end ? endErrorId : undefined}
              className={errors.end ? 'border-danger' : undefined}
              onChange={(event) => changeEnd({ ...endAt, time: event.target.value })}
            />
          </div>
          {errors.end ? (
            <p id={endErrorId} role="alert" data-event-end-error className="text-sm text-danger">
              {errors.end}
            </p>
          ) : null}
          <p data-event-zone className="text-xs font-normal text-text-tertiary">
            {t('form.when.zone', { zone: zoneLabel })}
          </p>
          {mode === 'edit' ? (
            <p className="text-xs font-normal text-text-tertiary">{t('form.editNote')}</p>
          ) : null}
        </div>

        {/* ── (5) Formato: two named options, never "online: off" (D-213). ── */}
        <SegmentedControl
          label={t('form.format.label')}
          options={[
            { value: 'in_person', label: t('form.format.inPerson') },
            { value: 'online', label: t('form.format.online') },
          ]}
          value={format}
          onChange={(value) => setFormat(value === 'online' ? 'online' : 'in_person')}
        />

        {inPerson ? (
          <>
            <Input
              id="event-venue"
              name="venueName"
              label={t('form.venue.label')}
              placeholder={t('form.venue.placeholder')}
              value={venueName}
              maxLength={EVENT_MAX_VENUE}
              required
              error={errors.venue}
              onChange={(event) => setVenueName(event.target.value)}
            />
            <Textarea
              id="event-address"
              name="address"
              label={t('form.address.label')}
              placeholder={t('form.address.placeholder')}
              value={address}
              rows={2}
              maxLength={EVENT_MAX_ADDRESS}
              required
              error={errors.address}
              onInput={(event) => {
                const el = event.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }}
              onChange={(event) => setAddress(event.target.value)}
            />
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <Input
              id="event-url"
              name="meetingUrl"
              type="url"
              inputMode="url"
              autoComplete="off"
              label={t('form.url.label')}
              placeholder={t('form.url.placeholder')}
              value={meetingUrl}
              maxLength={EVENT_MAX_URL}
              required
              error={errors.url}
              onChange={(event) => setMeetingUrl(event.target.value)}
            />
            <p className="text-xs font-normal text-text-tertiary">{t('form.url.helper')}</p>
          </div>
        )}

        {/* ── (7) Edit only: the status row at the bottom (UI-D-211). ── */}
        {mode === 'edit' && eventId && (canCancel || canReactivate || cancelledLocked) ? (
          <>
            <div aria-hidden className="h-px bg-border" />
            {canCancel ? (
              <CancelEventControl eventId={eventId} landing={`/eventos/${eventId}`} />
            ) : canReactivate ? (
              <ReactivateEventControl eventId={eventId} landing={`/eventos/${eventId}`} />
            ) : (
              <p data-event-cancelled-locked className="text-xs font-normal text-text-tertiary">
                {t('form.cancelledLocked')}
              </p>
            )}
          </>
        ) : null}
      </div>

      <ConfirmDialog
        open={discarding}
        tone="danger"
        title={mode === 'edit' ? t('confirm.discard.titleEdit') : t('confirm.discard.titleCreate')}
        body={t('confirm.discard.body')}
        confirmLabel={t('confirm.discard.confirm')}
        cancelLabel={t('confirm.discard.dismiss')}
        onConfirm={() => router.push(back)}
        onClose={() => setDiscarding(false)}
      />
    </form>
  );
}
