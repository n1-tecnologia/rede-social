'use client';

import { mediaAcceptFor, PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import {
  EVENT_DEFAULT_DURATION_MINUTES,
  EVENT_MAX_ADDRESS,
  EVENT_MAX_CAPACITY,
  EVENT_MAX_CATEGORY,
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
  Switch,
  Textarea,
  useToast,
} from '@rede-social/ui';
import { ArrowLeft, ArrowRight, Image as ImageIcon, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useCoverPreview } from '@/components/media/useCoverPreview';
import { useSignedUpload } from '@/components/media/useSignedUpload';
import {
  type AddressParts,
  addressIssues,
  composeEventAddress,
  EMPTY_ADDRESS_PARTS,
  extractCep,
  isCep,
  parseEventAddress,
} from '@/lib/event-address';
import {
  composeEventDescription,
  EMPTY_EVENT_EXTRAS,
  type EventExtras,
  EXTRAS_CAPS,
  effectiveSchedule,
  normaliseSchedule,
  type ScheduleItem,
  splitEventDescription,
} from '@/lib/event-extras';
import { CancelEventControl } from './[eventId]/CancelEventControl';
import { ReactivateEventControl } from './[eventId]/ReactivateEventControl';
import { createEventAction, type EventWriteResult, updateEventAction } from './actions';
import { ADDRESS_FIELD_IDS, EventAddressFields } from './EventAddressFields';
import { eventSpanDays, ScheduleEditor } from './ScheduleEditor';
import { useCepLookup } from './useCepLookup';

/**
 * THE event form (EVENT-01, UI-D-212, sketch 006 surface 1): one component, two routes,
 * `/eventos/novo` in `create` mode and `/eventos/[eventId]/editar` in `edit` mode bound to values.
 *
 * **The community form's chrome** (UI-D-38): a full-screen route, the `PageHeader` at its default
 * sticky offset with the `X` "Fechar" (a dirty form confirms the discard first), the title, and the
 * trailing brand submit with its pending label. The form root declares `data-shell-hide="nav"`: a
 * task screen hides the BottomNav (the shell rule in tokens.css), so the floating pill never sits
 * over a field mid-scroll. The cover runs the Phase 3 machine (`useSignedUpload`,
 * `purpose: 'cover'`): this file holds an asset id, never a byte.
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
 * **The address is parts, stored as one string** (PDF item #10): CEP, rua, número, complemento,
 * bairro, cidade and UF (`EventAddressFields`), the CEP looked up on its 8th digit
 * (`useCepLookup`, through `/api/cep/{cep}`), composed into the contract's `address` in the
 * canonical format of `lib/event-address.ts`. Create mode is always parts. Edit mode opens as parts
 * when the stored address parses back (or there is none, an online event turning in person);
 * anything else is a LEGACY free text, kept in today's textarea with a hint, "Preencher pelo CEP"
 * to switch, and "Manter endereço anterior" to come back: saving an untouched legacy text sends it
 * unchanged, so nobody re-types an address on an unrelated edit.
 *
 * **Errors wait for the first submit** (the CommunityForm rule, UI E10/empty): the submit is
 * disabled until the name, the four date/time fields and the active format's fields are filled (in
 * person: the venue and the CEP, rua, cidade and UF, or the legacy text); after the first submit,
 * each field shows its own inline message (a 7-digit CEP or an unknown UF included: "filled" opens
 * the submit, the URL rule) and a failed save shows the top `role="alert"` card with every value
 * kept.
 *
 * Edit mode adds the note under "Quando" and the bottom row: "Cancelar evento" while active and before
 * the end, "Reativar evento" while cancelled and before the start, or the locked note. All three
 * flags are computed by the RSC from ONE request instant (UI-D-14: no clock read in client render).
 *
 * **2026-10-03: "Categoria" and "Vagas", both optional and both sent by either format.** The
 * category sits under the name (the poster prints it above the title), capped at
 * `EVENT_MAX_CATEGORY` by the field itself; blank is "no category". "Vagas" closes the form: a
 * digits-only field (`inputMode="numeric"`, up to six digits) whose empty value is "no limit"
 * (null) and whose number must fall in `1..EVENT_MAX_CAPACITY`, the schema's own rule, spoken after
 * the first submit like every other field. A limit below the confirmations already given is
 * accepted: the answers stay (the edit note says so).
 *
 * **2026-10-07: the "Cronograma" is its own field, `schedule`** (quick 261007-n1g), no longer text
 * in the description: it is sent normalised and sorted, and ONLY when it has moments. The key is
 * omitted when empty on purpose: the parsed payload is what travels, and a key an older (strict) API
 * does not know would refuse every save until the API release catches up; an absent key is also what
 * clears a stored schedule on the whole-event `PUT`. Only the "Informações úteis" block still lives
 * in the description. An event written before the column keeps its schedule as text in the
 * description: the form READS it (`effectiveSchedule`: the API's own list first, else the legacy
 * lines), and saving writes the field and a description without the programme lines, which moves
 * that event over without a bulk migration. The `dirty` baseline is composed the same way, so an
 * untouched legacy event is still clean.
 */
export type EventFormMode = 'create' | 'edit';

export type EventFormInitial = {
  title: string;
  description: string;
  coverAssetId: string | null;
  coverVariantWidths: readonly number[];
  /** 2026-10-03. Absent (a host that predates it) is "no category" / "no limit". */
  category?: string;
  capacity?: number | null;
  format: EventFormat;
  venueName: string;
  address: string;
  meetingUrl: string;
  start: WallClock;
  end: WallClock;
  /**
   * 2026-10-07: the stored programme (`events.schedule`). Absent (an API that predates the column)
   * or empty falls back to the LEGACY programme parsed out of `description`.
   */
  schedule?: readonly ScheduleItem[];
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
  category: '',
  capacity: null,
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

type FieldKey =
  | 'title'
  | 'start'
  | 'end'
  | 'venue'
  | 'address'
  | 'cep'
  | 'street'
  | 'city'
  | 'state'
  | 'addressTooLong'
  | 'url'
  | 'capacity'
  | 'description';

/** `100000` is six digits: the field keeps at most that many, and the schema bounds the value. */
const CAPACITY_MAX_DIGITS = String(EVENT_MAX_CAPACITY).length;

/** The "Vagas" field's text as the API takes it: nothing is "no limit" (null), else the number. */
const capacityValue = (text: string): number | null => (text === '' ? null : Number(text));

/** PDF item #10: the address as parts (always in create mode), or a stored free text kept as is. */
type AddressMode = 'structured' | 'legacy';

/** The legacy side's switch, where focus lands when the admin goes back to the old text. */
const USE_CEP_ID = 'event-address-use-cep';

/** The parts a CEP lookup fills; número and complemento are the admin's alone. */
const LOOKUP_PARTS = ['street', 'district', 'city', 'state'] as const;

/** What one lookup wrote: the CEP it answered for, and each part it filled, with what. */
type LookupWrite = {
  cep: string;
  wrote: Partial<Pick<AddressParts, (typeof LOOKUP_PARTS)[number]>>;
};

/** The parts with each one the lookup wrote, and nobody changed since, empty again. */
function withoutLookup(parts: AddressParts, wrote: LookupWrite['wrote']): AddressParts {
  const next = { ...parts };
  for (const key of LOOKUP_PARTS) {
    if (parts[key] === wrote[key]) next[key] = '';
  }
  return next;
}

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
  const initialCategory = start.category ?? '';
  const initialCapacity =
    start.capacity === null || start.capacity === undefined ? '' : String(start.capacity);
  const [title, setTitle] = useState(start.title);
  // 2026-10-06: step 2, the "Informações úteis", lives at the end of the stored description
  // (`lib/event-extras.ts`): the description field shows the text alone, step 2 the rest. The
  // programme is its own field since 2026-10-07; an older event's text programme is read as a fallback.
  const initialSplit = splitEventDescription(start.description);
  const initialExtras = initialSplit.extras ?? EMPTY_EVENT_EXTRAS;
  const initialSchedule = effectiveSchedule(start.schedule, initialExtras.schedule);
  const [description, setDescription] = useState(initialSplit.text);
  const [step, setStep] = useState<1 | 2>(1);
  const [dressCode, setDressCode] = useState(initialExtras.dressCode ?? '');
  const [included, setIncluded] = useState<string[]>(initialExtras.included);
  const [bring, setBring] = useState<string[]>(initialExtras.bring);
  const [certificate, setCertificate] = useState(initialExtras.certificate !== null);
  const [certificateHours, setCertificateHours] = useState(
    initialExtras.certificate?.hours ? String(initialExtras.certificate.hours) : '',
  );
  const [schedule, setSchedule] = useState<ScheduleItem[]>(initialSchedule);
  const [category, setCategory] = useState(initialCategory);
  // The digits as typed; `capacityValue` turns them into what the API takes.
  const [capacityText, setCapacityText] = useState(initialCapacity);
  const [coverAssetId, setCoverAssetId] = useState<string | null>(start.coverAssetId);
  const [coverWidths, setCoverWidths] = useState<readonly number[]>(start.coverVariantWidths);
  const [format, setFormat] = useState<EventFormat>(start.format);
  // Both sides of the XOR live in memory; only the visible one is submitted.
  const [venueName, setVenueName] = useState(start.venueName);
  // PDF item #10: a stored address that parses back (or none) opens as parts; anything else is the
  // legacy free text, which `address` keeps verbatim while the parts stay in memory beside it.
  const initialParts = parseEventAddress(start.address);
  const initialAddressMode: AddressMode =
    mode === 'create' || !filled(start.address) || initialParts !== null ? 'structured' : 'legacy';
  const [addressMode, setAddressMode] = useState<AddressMode>(initialAddressMode);
  const [parts, setParts] = useState<AddressParts>(initialParts ?? EMPTY_ADDRESS_PARTS);
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
  // The address switch that was clicked unmounts with its side; focus lands on the other side.
  const [focusTarget, setFocusTarget] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  /** What the last CEP lookup wrote, so a move to another CEP takes back exactly that. */
  const lookupRef = useRef<LookupWrite | null>(null);

  /**
   * The CEP lookup fills what ViaCEP knows and nothing else: rua and bairro only when it returned
   * them (a city-wide CEP answers neither, and what the admin typed stays), cidade and UF always,
   * número and complemento never. What it wrote is kept in `lookupRef` for `changeCep`. While the
   * admin is still in the CEP field, focus moves on to the first field they owe: the número, or
   * the rua for a city-wide CEP.
   */
  const cepLookup = useCepLookup((found) => {
    const wrote: LookupWrite['wrote'] = { city: found.city, state: found.state };
    if (found.street !== '') wrote.street = found.street;
    if (found.district !== '') wrote.district = found.district;
    lookupRef.current = { cep: found.cep, wrote };
    setParts((current) => ({ ...current, ...wrote }));
    if (document.activeElement?.id === ADDRESS_FIELD_IDS.cep) {
      const next = found.street === '' ? ADDRESS_FIELD_IDS.street : ADDRESS_FIELD_IDS.number;
      document.getElementById(next)?.focus();
    }
  });

  useEffect(() => {
    if (focusTarget === null) return;
    document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  // The picked file stands in for the cover while the worker derives its ladder (`useCoverPreview`).
  const coverPreview = useCoverPreview(coverAssetId);
  const upload = useSignedUpload({
    kind: 'image',
    purpose: 'cover',
    // No toast: the preview replacing the gradient IS the confirmation, and nothing is saved yet.
    successKey: null,
    onPicked: coverPreview.onPicked,
    onCompleted: (asset) => {
      coverPreview.onUploaded(asset.id);
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
  const structured = addressMode === 'structured';

  // PDF item #10: complete parts compose the canonical string; incomplete ones send '' and the
  // schema refuses them, so a half address is never stored. The legacy text goes as it stands.
  const partIssues = addressIssues(parts);
  const composedAddress = partIssues.length === 0 ? composeEventAddress(parts) : '';
  const effectiveAddress = structured ? composedAddress : address;

  /**
   * The body the API receives: the VISIBLE side of the XOR only (D-213), plus the category and the
   * limit, which both formats carry. The PUT is a whole-event replacement, so both are always sent:
   * a cleared field clears the stored value.
   */
  const capacity = capacityValue(capacityText);
  // The programme is sent as its own field, not through the description (`schedule: []` here).
  const extras: EventExtras = {
    dressCode: dressCode.trim() === '' ? null : dressCode,
    included,
    bring,
    certificate: certificate
      ? { hours: certificateHours === '' ? null : Number(certificateHours) }
      : null,
    schedule: [],
  };
  // What the API stores in the description: the text, then the step-2 block (none when empty).
  const storedDescription = composeEventDescription(description, extras);
  // The programme as the API stores it; the key travels ONLY when there is something in it.
  const storedSchedule = normaliseSchedule(schedule);
  const scheduleField = storedSchedule.length > 0 ? { schedule: storedSchedule } : {};
  const payload = inPerson
    ? {
        title,
        description: storedDescription,
        coverAssetId,
        category,
        capacity,
        ...scheduleField,
        format,
        venueName,
        address: effectiveAddress,
        start: startAt,
        end: endAt,
      }
    : {
        title,
        description: storedDescription,
        coverAssetId,
        category,
        capacity,
        ...scheduleField,
        format,
        meetingUrl,
        start: startAt,
        end: endAt,
      };

  // The address side the admin is looking at: the switch itself is a change (X asks first), and
  // coming back to the untouched legacy text is not.
  const dirty =
    JSON.stringify([
      title,
      storedDescription,
      storedSchedule,
      coverAssetId,
      category,
      capacityText,
      format,
      venueName,
      structured ? ['structured', parts] : ['legacy', address],
      meetingUrl,
      startAt,
      endAt,
    ]) !==
    JSON.stringify([
      start.title,
      // The SAME composition as the live side, not the raw stored text: an old event that still
      // holds its programme as text must not look edited before the admin changes anything.
      composeEventDescription(initialSplit.text, initialExtras),
      normaliseSchedule(initialSchedule),
      start.coverAssetId,
      initialCategory,
      initialCapacity,
      start.format,
      start.venueName,
      initialAddressMode === 'structured'
        ? ['structured', initialParts ?? EMPTY_ADDRESS_PARTS]
        : ['legacy', start.address],
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
    (inPerson
      ? filled(venueName) &&
        (structured
          ? filled(parts.cep) && filled(parts.street) && filled(parts.city) && filled(parts.state)
          : filled(address))
      : filled(meetingUrl));

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
      if (structured) {
        if (partIssues.includes('cep')) errors.cep = t('form.errors.cepInvalid');
        if (partIssues.includes('street')) errors.street = t('form.errors.streetRequired');
        if (partIssues.includes('city')) errors.city = t('form.errors.cityRequired');
        if (partIssues.includes('state')) errors.state = t('form.errors.stateInvalid');
        // Defensive: the per-part caps keep the worst case at 295 of the contract's 300.
        if (composedAddress.length > EVENT_MAX_ADDRESS) {
          errors.addressTooLong = t('form.errors.addressTooLong');
        }
      } else if (!filled(address)) {
        errors.address = t('form.errors.addressRequired');
      }
    } else if (!filled(meetingUrl)) {
      errors.url = t('form.errors.urlRequired');
    } else if (has('url_invalid') || has('url_required')) {
      errors.url = t('form.errors.urlInvalid');
    }
    // "Vagas": a number outside 1..100000 (`0` included); empty is "no limit" and never an issue.
    if (on('capacity')) errors.capacity = t('form.errors.capacityInvalid');
    // The text plus the step-2 block past the contract's limit.
    if (on('description')) {
      errors.description = t('form.errors.descriptionTooLong', { max: EVENT_MAX_DESCRIPTION });
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

  /**
   * The CEP's digits from the field. The same digits again (a 9th digit the field drops, the same
   * CEP pasted again) are no change: nothing is stored and nothing is asked, so a lookup nobody
   * asked for never overwrites a restored or hand-edited address. Deleting a digit and typing it
   * back does ask again, on purpose.
   *
   * Another full CEP takes back, at once, every part the previous lookup wrote that still reads as
   * it wrote it: those belong to the old CEP, and a city-wide, unknown or failed answer would
   * compose them with the new one (a rua of São Paulo in Poconé). What the admin typed or changed
   * stays, and the same CEP typed back keeps its own answer.
   */
  const changeCep = (cep: string) => {
    if (cep === parts.cep) return;
    const previous = lookupRef.current;
    const stale = isCep(cep) && previous !== null && previous.cep !== cep ? previous.wrote : null;
    if (stale) lookupRef.current = null;
    setParts((current) => ({ ...(stale ? withoutLookup(current, stale) : current), cep }));
    cepLookup.request(cep);
  };

  /**
   * Legacy text → parts. While rua, bairro, cidade and UF are empty (a lookup has nothing of the
   * admin's to overwrite there), the CEP is looked up at once: the one the parts hold (a trip back
   * to the text before the answer came), or else the one the old text carries. Parts the admin
   * already filled (a round trip through "Manter endereço anterior") stay, and nothing is asked.
   */
  const fillByCep = () => {
    setAddressMode('structured');
    setFocusTarget(ADDRESS_FIELD_IDS.cep);
    if (LOOKUP_PARTS.some((key) => filled(parts[key]))) return;
    const cep = parts.cep === '' ? extractCep(address) : parts.cep;
    if (cep !== parts.cep) setParts((current) => ({ ...current, cep }));
    cepLookup.request(cep);
  };

  /** Parts → the legacy text, exactly as it arrived (or as the admin edited it). */
  const keepLegacy = () => {
    cepLookup.reset();
    setAddressMode('legacy');
    setFocusTarget(USE_CEP_ID);
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
      const tooLong = parsed.error.issues.some((issue) => issue.path[0] === 'description');
      setFormError(
        tooLong
          ? t('form.errors.descriptionTooLong', { max: EVENT_MAX_DESCRIPTION })
          : t('form.errors.save'),
      );
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
      data-shell-hide="nav"
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

        {/* 2026-10-06: two steps, the event and its "Informações úteis". The header's submit saves
            from either: step 2 is optional, and a step's fields stay mounted (`hidden`) so nothing
            typed is lost between them. */}
        <ol aria-label={t('form.steps.label')} className="grid grid-cols-2 gap-2">
          {([1, 2] as const).map((n) => (
            <li key={n}>
              <button
                type="button"
                data-event-step-tab={n}
                aria-current={step === n ? 'step' : undefined}
                onClick={() => setStep(n)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                  step === n
                    ? 'border-brand bg-brand/10 text-text'
                    : 'border-border text-text-secondary hover:bg-bg-hover',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                    step === n ? 'bg-brand text-on-brand' : 'bg-bg-input text-text-tertiary',
                  )}
                >
                  {n}
                </span>
                <span className="min-w-0 truncate">
                  {t(n === 1 ? 'form.steps.event' : 'form.steps.extras')}
                </span>
              </button>
            </li>
          ))}
        </ol>

        <div hidden={step !== 1} data-event-step="1" className="flex flex-col gap-6 md:gap-8">
          {/* ── (1) Capa: the hero geometry, so the admin sees what a member will see. ── */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-normal text-text-secondary">{t('form.cover.label')}</span>
            <div data-event-cover-preview className="overflow-hidden rounded-xl">
              <EventCover
                geometry="hero"
                coverAssetId={coverAssetId}
                coverVariantWidths={coverWidths}
                coverAlt={t('cover.alt', { title: title || tenantName })}
                previewUrl={coverPreview.previewUrl}
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
                  upload.state === 'progress' || upload.state === 'processing'
                    ? upload.state
                    : 'idle'
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

          {/* ── (2b) Categoria (2026-10-03): optional, printed above the title on the poster. ── */}
          <div className="flex flex-col gap-2">
            <Input
              id="event-category"
              name="category"
              autoComplete="off"
              label={t('form.category.label')}
              placeholder={t('form.category.placeholder')}
              value={category}
              maxLength={EVENT_MAX_CATEGORY}
              aria-describedby="event-category-helper"
              onChange={(event) => setCategory(event.target.value)}
            />
            <p id="event-category-helper" className="text-xs font-normal text-text-tertiary">
              {t('form.category.helper')}
            </p>
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
            error={errors.description}
            onInput={(event) => {
              const el = event.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
            onChange={(event) => setDescription(event.target.value)}
          />

          {/* ── (4) Quando: native date + time, wall clock of the TENANT. ──
            UI-D-212 amended for iOS (PDF item #11): once the Input guard turns WebKit's
            auto-sizing off, a half track left the pt-BR date ("28 de nov. de 2026") about 139px
            at 390px, so the date takes the free track beside an 8rem time, and each pair stacks
            below 360px. */}
          <div className="flex flex-col gap-3">
            <SectionTitle variant="group" as="h3">
              {t('form.when.title')}
            </SectionTitle>
            <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-[minmax(0,1fr)_8rem]">
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
            <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-[minmax(0,1fr)_8rem]">
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
              {/* ── Endereço (PDF item #10): the parts, or a legacy free text kept as is. ── */}
              {structured ? (
                <EventAddressFields
                  parts={parts}
                  status={cepLookup.status}
                  errors={{
                    cep: errors.cep,
                    street: errors.street,
                    city: errors.city,
                    state: errors.state,
                    tooLong: errors.addressTooLong,
                  }}
                  onCepChange={changeCep}
                  onPartChange={(key, value) =>
                    setParts((current) => ({ ...current, [key]: value }))
                  }
                  onKeepLegacy={initialAddressMode === 'legacy' ? keepLegacy : undefined}
                />
              ) : (
                <div data-event-address="legacy" className="flex flex-col gap-2">
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
                    aria-describedby={
                      errors.address
                        ? 'event-address-error event-address-hint'
                        : 'event-address-hint'
                    }
                    onInput={(event) => {
                      const el = event.currentTarget;
                      el.style.height = 'auto';
                      el.style.height = `${el.scrollHeight}px`;
                    }}
                    onChange={(event) => setAddress(event.target.value)}
                  />
                  <p id="event-address-hint" className="text-xs font-normal text-text-tertiary">
                    {t('form.address.legacyHint')}
                  </p>
                  <Button
                    id={USE_CEP_ID}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    data-event-address-use-cep
                    onClick={fillByCep}
                  >
                    {t('form.address.useCep')}
                  </Button>
                </div>
              )}
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

          {/* ── (6b) Vagas (2026-10-03): digits only, empty = no limit, for either format. ── */}
          <div className="flex flex-col gap-2">
            <Input
              id="event-capacity"
              name="capacity"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              label={t('form.capacity.label')}
              placeholder={t('form.capacity.placeholder')}
              value={capacityText}
              maxLength={CAPACITY_MAX_DIGITS}
              error={errors.capacity}
              aria-describedby={
                errors.capacity
                  ? 'event-capacity-error event-capacity-helper'
                  : 'event-capacity-helper'
              }
              onChange={(event) =>
                setCapacityText(event.target.value.replace(/\D/g, '').slice(0, CAPACITY_MAX_DIGITS))
              }
            />
            <p id="event-capacity-helper" className="text-xs font-normal text-text-tertiary">
              {t('form.capacity.helper')}
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="md"
            fullWidth
            data-event-step-next
            onClick={() => {
              setStep(2);
              window.scrollTo?.({ top: 0 });
              document.getElementById('app-scroll')?.scrollTo?.({ top: 0 });
            }}
          >
            {t('form.steps.next')}
            <ArrowRight aria-hidden size={16} />
          </Button>

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

        {/* ── Step 2: "Informações úteis" (REINE's "Bom saber"), all optional. ── */}
        <div hidden={step !== 2} data-event-step="2" className="flex flex-col gap-6">
          <div>
            <SectionTitle>{t('form.extras.title')}</SectionTitle>
            <p className="mt-1 text-xs text-text-tertiary">{t('form.extras.helper')}</p>
          </div>
          <Input
            id="event-dress-code"
            label={t('form.extras.dressCode.label')}
            placeholder={t('form.extras.dressCode.placeholder')}
            value={dressCode}
            maxLength={EXTRAS_CAPS.dressCode}
            onChange={(event) => setDressCode(event.target.value)}
          />
          <ExtrasList
            id="event-included"
            label={t('form.extras.included.label')}
            placeholder={t('form.extras.included.placeholder')}
            addLabel={t('form.extras.add')}
            removeLabel={(item) => t('form.extras.remove', { item })}
            limitLabel={t('form.extras.limit', { max: EXTRAS_CAPS.items })}
            items={included}
            onChange={setIncluded}
          />
          <ExtrasList
            id="event-bring"
            label={t('form.extras.bring.label')}
            placeholder={t('form.extras.bring.placeholder')}
            addLabel={t('form.extras.add')}
            removeLabel={(item) => t('form.extras.remove', { item })}
            limitLabel={t('form.extras.limit', { max: EXTRAS_CAPS.items })}
            items={bring}
            onChange={setBring}
          />
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-text">{t('form.extras.certificate.label')}</span>
              <Switch
                checked={certificate}
                onChange={setCertificate}
                label={t('form.extras.certificate.label')}
              />
            </div>
            {certificate ? (
              <Input
                id="event-certificate-hours"
                label={t('form.extras.certificate.hours')}
                placeholder={t('form.extras.certificate.hoursPlaceholder')}
                inputMode="numeric"
                value={certificateHours}
                maxLength={3}
                onChange={(event) =>
                  setCertificateHours(event.target.value.replace(/\D/g, '').replace(/^0+/, ''))
                }
              />
            ) : null}
          </div>
          {/* 2026-10-06: the programme, shown on the event page under "Programação". */}
          <div className="flex flex-col gap-3">
            <div>
              <SectionTitle variant="group" as="h3">
                {t('form.extras.schedule.label')}
              </SectionTitle>
              <p className="mt-1 text-xs text-text-tertiary">{t('form.extras.schedule.helper')}</p>
            </div>
            <ScheduleEditor
              items={schedule}
              onChange={setSchedule}
              startDate={startAt.date}
              days={eventSpanDays(startAt.date, endAt.date)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="md"
            fullWidth
            data-event-step-back
            onClick={() => setStep(1)}
          >
            <ArrowLeft aria-hidden size={16} />
            {t('form.steps.back')}
          </Button>
        </div>
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

/**
 * One of step 2's lists ("Incluso no ingresso", "O que levar"): a field and "Adicionar" (Enter adds
 * too, never submitting the form), then the items as chips, each with its own remove control. At
 * most `EXTRAS_CAPS.items`, each up to `EXTRAS_CAPS.item` characters.
 */
function ExtrasList({
  id,
  label,
  placeholder,
  addLabel,
  removeLabel,
  limitLabel,
  items,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  addLabel: string;
  removeLabel: (item: string) => string;
  limitLabel: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const full = items.length >= EXTRAS_CAPS.items;
  const add = () => {
    const value = draft.replace(/\s+/g, ' ').trim();
    if (value === '' || full || items.includes(value)) return;
    onChange([...items, value]);
    setDraft('');
  };
  return (
    <div data-extras-list={id} className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input
            id={id}
            label={label}
            placeholder={placeholder}
            value={draft}
            maxLength={EXTRAS_CAPS.item}
            disabled={full}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              add();
            }}
          />
        </div>
        <Button type="button" variant="outline" size="md" onClick={add} disabled={full}>
          <Plus aria-hidden size={16} />
          {addLabel}
        </Button>
      </div>
      {items.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <li
              key={item}
              className="inline-flex items-center gap-1 rounded-full bg-bg-input py-1 pr-1 pl-3 text-xs font-medium text-text-secondary"
            >
              {item}
              <button
                type="button"
                aria-label={removeLabel(item)}
                onClick={() => onChange(items.filter((other) => other !== item))}
                className="grid h-6 w-6 place-items-center rounded-full hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <X aria-hidden size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {full ? <p className="text-xs text-text-tertiary">{limitLabel}</p> : null}
    </div>
  );
}
