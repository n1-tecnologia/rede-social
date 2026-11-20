import { avatarUrlFor } from '@rede-social/contracts/profiles';
import { cutOnWord } from '@rede-social/contracts/text';
import {
  type CaseCard,
  type CaseEvent,
  CHAT_PREVIEW_GRAPHEMES,
  type ChatCaseAction,
  type ChatCaseCategory,
  type ChatCasePriority,
  type ChatCaseState,
  type DirectComposerState,
  type DirectDetail,
  type DirectListAnswer,
  type DirectListRow,
  type DirectOther,
  type DirectPreview,
  type DirectSupportSummary,
  type DirectWithAnswer,
  type InboxRow,
  type MemberCase,
  type MessageRow,
  type StaffCase,
} from '@rede-social/module-chat/contracts';
import type {
  InboxRowState,
  MessageBubbleLabel,
  MessageBubbleVoice,
  MessageListItem,
} from '@rede-social/module-chat/ui';
import type { getTranslations } from 'next-intl/server';
import { formatEventTime, tenantDayKey } from './events-view';

/**
 * THE formatter module for the support chat (UI-D-259, UI-D-14): every time, day key and day label a
 * chat surface prints is built here, pinned to `bootstrap.tenant.timezone` through the events
 * formatter (UI-D-203). There is no date library.
 *
 * **Clock-free.** Nothing here reads the clock: `tenantDayKeys` takes `nowMs` from its caller, which
 * reads `Date.now()` ONCE per request (the page, a BFF route, the send action). The formatting
 * functions (`chatMessageView`, `tenantDayKeys`) run on the SERVER only; the pure helpers
 * (`chatDayLabel`, `chatRuns`) are also safe on the client, because they only compare the
 * server-provided tenant-local day keys and format a calendar date that is already fixed. A device in
 * Manaus therefore reads the tenant's São Paulo clock, and hydration output is byte-identical.
 *
 * **Privacy (D-222).** A view carries the agent's FIRST NAME only, exactly what the API sends; there
 * is no avatar, surname or id field to fill.
 */

/** The same untyped translator every `lib/*-view` module takes, scoped to the `chat` namespace. */
type Translator = Awaited<ReturnType<typeof getTranslations>>;

/** The tenant-local calendar days a chat page compares against. */
export interface ChatDayKeys {
  todayKey: string;
  yesterdayKey: string;
}

/** The two relative day words, from the catalog (`chat.day.today`, `chat.day.yesterday`). */
export interface ChatDayWords {
  today: string;
  yesterday: string;
}

/** Who is reading: the member in their own thread, or staff in the inbox thread (07-10). */
export type ChatViewer = 'member' | 'staff';

/** One message, formatted for a bubble. Serializable: the page hands these to the client pane. */
export interface ChatMessageView {
  id: string;
  seq: number;
  /** The viewer's side is `own` (right, brand fill). */
  side: 'own' | 'other';
  /** Groups a run: the member, or one agent by first name (the only author fact a view has). */
  authorKey: string;
  body: string;
  label: MessageBubbleLabel | null;
  /** `HH:mm` (h23) in the tenant zone. */
  time: string;
  /** Tenant-local calendar day, `2026-10-12`. */
  dayKey: string;
  /** The instant, for the 5-minute run rule. */
  createdAtMs: number;
  /** An optimistic bubble while its send is in flight (client only). */
  pending?: boolean;
  /**
   * 12.5 (D-846, VOICE-04): the recording of a voice message, ABSENT on a text view. `body` is the empty
   * string then, so text and recording stay mutually exclusive in practice.
   */
  voice?: ChatVoiceView;
  /**
   * 12.5-15 (UI-D-846, client only): how far a pending voice bubble got. `percent` is `null` while the take is
   * queued behind another and during the finishing step, so the footer reads the plain pending label.
   */
  voiceUpload?: { percent: number | null };
  /**
   * 12.5-15 (UI-D-847, client only): a voice send that ended. `retriable` offers "Tentar novamente" and
   * "Descartar"; `permanent` offers "Descartar" alone. The view keeps `pending: true` in the pane's list (so
   * the server's merge never drops it) and `chatRuns` draws it as a failed bubble.
   */
  voiceFailed?: 'retriable' | 'permanent';
}

/**
 * The recording of one message, finished (D-853). Only what a screen needs: the media id the HOST turns into
 * the player link (UI-D-857), the stored length and its two finished labels. There is no file name, URL or
 * mime type here, and `deleted` exists only when the row says the recording is gone (D-868).
 */
export interface ChatVoiceView {
  mediaId: string;
  durationSeconds: number;
  /** `m:ss`, e.g. `0:42`. */
  durationLabel: string;
  /** The screen-reader length, e.g. `1 minuto e 5 segundos`. */
  spokenLabel: string;
  deleted?: true;
}

/** The longest recording, in seconds (D-850): the same bound the API contract enforces. */
const VOICE_MAX_SECONDS = 300;

/** A stored duration as a whole number of seconds inside `0..300` (T-12.5-40): NaN reads as 0. */
function clampVoiceSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.min(Math.max(Math.round(seconds), 0), VOICE_MAX_SECONDS);
}

/** D-853: `m:ss` with no leading zero on the minutes (`0:42`, `1:05`, `5:00`), clamped to 0..300 and rounded. */
export function formatVoiceDuration(seconds: number): string {
  const whole = clampVoiceSeconds(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * The duration as a screen reader says it (D-853, sketch 024 #2): "42 segundos", "1 minuto e 5 segundos",
 * "1 minuto", "5 minutos" and "0 segundos". A whole number of minutes uses the single-unit sentence, so 5:00 is
 * never "5 minutos e 0 segundo".
 */
export function spokenVoiceDuration(seconds: number, t: Translator): string {
  const whole = clampVoiceSeconds(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes === 0) return t('voice.spokenSeconds', { seconds: rest });
  if (rest === 0) return t('voice.spokenMinutes', { minutes });
  return t('voice.spoken', { minutes, seconds: rest });
}

/** D-860: the one-line preview of a recording, "Mensagem de voz · 0:42" (the words, a middle dot, `m:ss`). */
export function voicePreviewText(seconds: number, t: Translator): string {
  return t('voice.preview', { duration: formatVoiceDuration(seconds) });
}

/** D-868: what a preview or a bubble says for a recording whose sender left, "Mensagem de voz apagada". */
export function voiceDeletedText(t: Translator): string {
  return t('voice.deleted');
}

/**
 * What a list preview is made of (D-860, D-868): ordinary `text`, a `voice` recording (the screen draws the
 * microphone glyph for this kind only) or a recording that is gone (`voiceDeleted`: the words alone, no glyph).
 */
export type PreviewKind = 'text' | 'voice' | 'voiceDeleted';

/**
 * The finished words of a last message and their kind. A deleted recording wins over its stored length (no
 * duration is ever shown for it); a text message keeps its one-line text exactly as before.
 */
function previewParts(
  message: { preview: string; voiceSeconds?: number; voiceDeleted?: true },
  t: Translator,
): { text: string; kind: PreviewKind } {
  if (message.voiceDeleted) return { text: voiceDeletedText(t), kind: 'voiceDeleted' };
  if (message.voiceSeconds !== undefined) {
    return { text: voicePreviewText(message.voiceSeconds, t), kind: 'voice' };
  }
  return { text: oneLine(message.preview), kind: 'text' };
}

/** The playback speeds, in cycle order (D-854). The speed resets per player and is never stored. */
const PLAYBACK_RATES: readonly number[] = [1, 1.5, 2];
const PLAYBACK_RATE_KEYS = ['voice.rate.one', 'voice.rate.oneHalf', 'voice.rate.two'] as const;

/** D-854: 1 to 1.5 to 2 and back to 1; any other value (unknown, NaN, absent) restarts at 1. */
export function nextPlaybackRate(rate: number | undefined): number {
  const index = rate === undefined ? -1 : PLAYBACK_RATES.indexOf(rate);
  if (index === -1) return 1;
  return PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length] ?? 1;
}

/** D-854: the catalog label of a speed, "1x", "1,5x" (decimal comma, A-UI-12) or "2x"; an unknown speed reads "1x". */
export function playbackRateLabel(rate: number, t: Translator): string {
  const index = PLAYBACK_RATES.indexOf(rate);
  return t(PLAYBACK_RATE_KEYS[index === -1 ? 0 : index] ?? PLAYBACK_RATE_KEYS[0]);
}

const DAY_MS = 86_400_000;
const RUN_GAP_MS = 5 * 60_000;

/** `{ todayKey, yesterdayKey }` for `nowMs` in `timeZone`. */
export function tenantDayKeys(nowMs: number, timeZone: string): ChatDayKeys {
  const todayKey = tenantDayKey(nowMs, timeZone);
  const [y, m, d] = todayKey.split('-').map(Number);
  const yesterday = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) - DAY_MS);
  return { todayKey, yesterdayKey: yesterday.toISOString().slice(0, 10) };
}

/** A calendar day key formatted as a date. The day is already fixed, so the zone is irrelevant. */
const dayFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const dayFormatterWithYear = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * "Hoje", "Ontem", or `sáb., 12 de out.` (with ` de 2025` when the day is in another tenant-local
 * year than today). Pure: it compares keys and formats a fixed calendar date.
 */
export function chatDayLabel(dayKey: string, keys: ChatDayKeys, words: ChatDayWords): string {
  if (dayKey === keys.todayKey) return words.today;
  if (dayKey === keys.yesterdayKey) return words.yesterday;
  const [y, m, d] = dayKey.split('-').map(Number);
  const noon = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12));
  const otherYear = dayKey.slice(0, 4) !== keys.todayKey.slice(0, 4);
  return (otherYear ? dayFormatterWithYear : dayFormatter).format(noon);
}

/**
 * One API row as a bubble for `viewer` (UI-D-259):
 * - member view: own messages right with no label; EVERY staff bubble left, labelled with the
 *   agent's first name, the `ShieldCheck` mark and the screen-reader suffix ", da equipe";
 * - staff view: every team message right, labelled with the agent's first name, or "Você" for the
 *   viewer's own; member messages left with no label (the header names the member).
 */
export function chatMessageView(
  row: MessageRow,
  { timeZone, viewer, t }: { timeZone: string; viewer: ChatViewer; t: Translator },
): ChatMessageView {
  // A member viewer owns the member-side rows THEY wrote. In a support thread that is every member-side row, so
  // nothing changes there; in a direct conversation (11-22, D-720) both people write on the member side, and
  // `authorIsViewer` (the API's own fact, never a client comparison of ids) is what tells the other's bubble.
  const own =
    viewer === 'member' ? row.side === 'member' && row.authorIsViewer : row.side === 'staff';
  const firstName = row.author?.firstName ?? '';
  let label: MessageBubbleLabel | null = null;
  if (row.side === 'staff') {
    label =
      viewer === 'member'
        ? { firstName, srSuffix: t('sender.staffSr'), icon: 'shield' }
        : { firstName: row.authorIsViewer ? t('sender.you') : firstName, srSuffix: '', icon: null };
  }
  return {
    id: row.id,
    seq: row.seq,
    side: own ? 'own' : 'other',
    authorKey:
      row.side === 'member'
        ? viewer === 'member' && !own
          ? 'member:other'
          : 'member'
        : `staff:${firstName}`,
    body: row.body,
    label,
    time: formatEventTime(row.createdAt, timeZone),
    dayKey: tenantDayKey(row.createdAt, timeZone),
    createdAtMs: Date.parse(row.createdAt),
    ...(row.voice ? { voice: voiceView(row.voice, t) } : {}),
  };
}

/** The `voice` of a row as the finished view: the stored length as its two labels, `deleted` only when true. */
function voiceView(voice: NonNullable<MessageRow['voice']>, t: Translator): ChatVoiceView {
  return {
    mediaId: voice.mediaId,
    durationSeconds: voice.durationSeconds,
    durationLabel: formatVoiceDuration(voice.durationSeconds),
    spokenLabel: spokenVoiceDuration(voice.durationSeconds, t),
    ...(voice.deleted ? { deleted: true as const } : {}),
  };
}

/** Same run: same side and author, same tenant-local day, at most five minutes apart. */
function sameRun(a: ChatMessageView, b: ChatMessageView): boolean {
  return (
    a.side === b.side &&
    a.authorKey === b.authorKey &&
    a.dayKey === b.dayKey &&
    b.createdAtMs - a.createdAtMs <= RUN_GAP_MS
  );
}

/**
 * The list items for `MessageList`: settled views sorted by `seq`, a day separator before each new
 * tenant-local day, and the time kept only on the LAST bubble of each run. The sender label repeats on
 * every labelled bubble (D-222: "each staff bubble"). Pending (optimistic) views follow the settled
 * ones in the order given, showing `pendingLabel` in the time slot. Pure and client-safe.
 */
export function chatRuns(
  views: readonly ChatMessageView[],
  keys: ChatDayKeys,
  words: ChatDayWords & {
    pending: string;
    /** 12.5-15: the footer of an uploading voice bubble, "Enviando… 62%"; absent, the plain pending label. */
    voiceProgress?: (percent: number) => string;
  },
  /**
   * 12.5-15: maps a view that carries a recording to the bubble's finished voice props. Without it (every
   * caller before the voice host) a voice view is drawn as an empty text bubble, as it always was.
   */
  voiceFor?: (view: ChatMessageView) => MessageBubbleVoice | undefined,
): MessageListItem[] {
  const settled = views.filter((view) => !view.pending).sort((a, b) => a.seq - b.seq);
  const pending = views.filter((view) => view.pending);
  const items: MessageListItem[] = [];

  /** The bubble content of a view: its voice props when it has a recording and a mapper, else its text. */
  const contentOf = (view: ChatMessageView) => {
    const voice = view.voice && voiceFor ? voiceFor(view) : undefined;
    return voice ? { voice } : { body: view.body };
  };

  settled.forEach((view, index) => {
    const previous = settled[index - 1];
    const next = settled[index + 1];
    if (!previous || previous.dayKey !== view.dayKey) {
      items.push({
        kind: 'day',
        key: `day-${view.dayKey}`,
        label: chatDayLabel(view.dayKey, keys, words),
      });
    }
    items.push({
      kind: 'message',
      key: view.id,
      side: view.side,
      ...contentOf(view),
      label: view.label,
      time: next && sameRun(view, next) ? null : view.time,
    });
  });

  for (const view of pending) {
    const percent = view.voiceUpload?.percent;
    // A failed voice bubble is not in flight: no dimming, no pending footer (the bubble draws its failure).
    const failed = view.voice !== undefined && view.voiceFailed !== undefined;
    items.push({
      kind: 'message',
      key: view.id,
      side: view.side,
      ...contentOf(view),
      label: view.label,
      ...(failed ? {} : { pending: true as const }),
      pendingLabel:
        typeof percent === 'number' && words.voiceProgress
          ? words.voiceProgress(percent)
          : words.pending,
    });
  }
  return items;
}

/** `dd/MM` in the tenant zone: the inbox's older-than-yesterday time (UI-D-262). */
function formatDayMonthNumeric(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit' }).format(
    new Date(iso),
  );
}

/**
 * The inbox time (UI-D-262): "HH:mm" when the instant falls on the tenant's today, the catalog's
 * "Ontem" on the tenant's yesterday, else `dd/MM`. Absolute on purpose (no relative ticking), and
 * clock-free: `keys` come from the caller's ONE `Date.now()`.
 */
export function inboxTime(
  iso: string,
  keys: ChatDayKeys,
  timeZone: string,
  words: Pick<ChatDayWords, 'yesterday'>,
): string {
  const dayKey = tenantDayKey(iso, timeZone);
  if (dayKey === keys.todayKey) return formatEventTime(iso, timeZone);
  if (dayKey === keys.yesterdayKey) return words.yesterday;
  return formatDayMonthNumeric(iso, timeZone);
}

/** One inbox row, formatted for `InboxRow`. Serializable: the layout hands these to the client list. */
export interface InboxRowView {
  conversationId: string;
  href: string;
  name: string;
  avatar: string | null;
  preview: string;
  /**
   * 12.5 (D-860): what the preview is made of, so the screen draws the microphone glyph for `voice` only.
   * Optional in the type, ALWAYS assigned by `inboxRowView`.
   */
  previewKind?: PreviewKind;
  time: string;
  /**
   * The API's own UTC microsecond instant of the last message (`null` for a case with none), kept ONLY as the
   * order key of the keyset list so `reconcileInboxPage` can tell which loaded rows a fresh page 1 covers.
   * Never drawn, never formatted (WR-01).
   */
  lastMessageAt: string | null;
  awaiting: boolean;
  state: InboxRowState;
  /** 12.4: the case facts as finished strings (UI-D-824). `null` when the API sent none (the previous API). */
  case: InboxCaseView | null;
}

/**
 * The case facts of one inbox row, finished (UI-D-824): the "#42 · subject" line, the state pill, the
 * priority pill (only `Alta` and `Baixa`, never `Normal`) and the "{categoria} · Com ..." meta text.
 */
export interface InboxCaseView {
  number: number;
  subjectLine: string;
  state: CaseStateView;
  priority: CasePriorityView | null;
  meta: string;
}

/** Newlines (and any run of whitespace) as one space: the preview is ONE line (UI E11/long-text). */
const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * One API inbox row as the staff list draws it (UI-D-262):
 * - a team message previews as "{firstName}: {preview}" (`chat.inbox.teamPreview`); an agent who has
 *   since left (empty first name) previews the text alone;
 * - a departed member reads `chat.removed.name` with no avatar (UI-D-24); a blocked one keeps name and
 *   photo, and the row draws the "Bloqueado" pill;
 * - the time is `inboxTime` in the tenant zone.
 */
export function inboxRowView(
  row: InboxRow,
  { timeZone, keys, t }: { timeZone: string; keys: ChatDayKeys; t: Translator },
): InboxRowView {
  const removed = row.member.state === 'removed';
  const name = removed ? t('removed.name') : (row.member.displayName ?? t('removed.name'));
  const message = row.lastMessage;
  let preview = '';
  let previewKind: PreviewKind = 'text';
  if (message) {
    const parts = previewParts(message, t);
    const firstName = message.authorFirstName ?? '';
    previewKind = parts.kind;
    preview =
      message.side === 'staff' && firstName
        ? t('inbox.teamPreview', { firstName, preview: parts.text })
        : parts.text;
  }
  return {
    conversationId: row.conversationId,
    href: `/suporte/${row.conversationId}`,
    name,
    avatar: removed ? null : avatarUrlFor(row.member.avatarAssetId),
    preview,
    previewKind,
    time: row.lastMessageAt
      ? inboxTime(row.lastMessageAt, keys, timeZone, { yesterday: t('day.yesterday') })
      : '',
    lastMessageAt: row.lastMessageAt,
    awaiting: row.awaiting,
    state: row.member.state,
    case: row.case ? inboxCaseView(row.case, t) : null,
  };
}

/**
 * True when row `a` sorts strictly BEFORE row `b` in the server order of `listInbox`:
 * `last_message_at desc, id desc`, the Postgres default for a descending sort (a null instant comes first).
 * The two instants and the ids are compared as the API's own strings with no normalisation (A-12.4-GAP-ENC):
 * instants are the fixed-width UTC microsecond text one `to_char` format produces and ids are the lowercase
 * canonical uuid text, so the text order is the chronological and the byte order of the database.
 */
function sortsBefore(
  a: { lastMessageAt: string | null; conversationId: string },
  b: { lastMessageAt: string | null; conversationId: string },
): boolean {
  if (a.lastMessageAt !== b.lastMessageAt) {
    if (a.lastMessageAt === null) return true;
    if (b.lastMessageAt === null) return false;
    return a.lastMessageAt > b.lastMessageAt;
  }
  return a.conversationId > b.conversationId;
}

/**
 * What a fresh page 1 of the CURRENT view does to the staff list (WR-01, T7, UI-D-830, A-UI-12, D-805): the
 * pure rule behind "a case that left the tab leaves on the next refetch". It reads no case state, no label
 * and no owner; the only fact it uses is the server's own order key (`lastMessageAt`, then the id).
 *
 * - **Whole** (`holdsOnlyPage1`, or the answer ends the view, `hasMore` false, or it is empty): the fresh page
 *   IS the view, so the list becomes exactly `fresh` in its order (a row absent from it is gone, a row in
 *   both takes the fresh facts, once). The caller then takes the answer's cursor and resets the page count.
 * - **Not whole** (more than one page loaded and the fresh page is not the whole view): `fresh` covers the
 *   window of the server order down to its LAST row. A loaded row not in `fresh` that sorts before or at that
 *   row was inside the window and is not listed any more: dropped. A loaded row that sorts strictly after it
 *   lies deeper than the fresh page can see and stays, in its loaded order, after the fresh rows
 *   (A-12.4-GAP-DEEP). The cursor and the page count are left alone by the caller.
 *
 * The inputs are never mutated.
 */
export function reconcileInboxPage<
  T extends { conversationId: string; lastMessageAt: string | null },
>(
  current: readonly T[],
  fresh: readonly T[],
  { holdsOnlyPage1, hasMore }: { holdsOnlyPage1: boolean; hasMore: boolean },
): { items: T[]; whole: boolean } {
  const tail = fresh.at(-1);
  if (holdsOnlyPage1 || !hasMore || tail === undefined) return { items: [...fresh], whole: true };
  const ids = new Set(fresh.map((row) => row.conversationId));
  const deeper = current.filter((row) => !ids.has(row.conversationId) && sortsBefore(tail, row));
  return { items: [...fresh, ...deeper], whole: false };
}

/**
 * ---------------------------------------------------------------------------------------------------
 * Support cases (Phase 12.4, D-803, D-805, D-811, UI-D-816, UI-D-817, UI-D-834).
 *
 * The functions below are PURE and client-safe: they import only types, read no clock and decide no
 * transition. A case state, its words, its tone and its glyph come out of ONE function
 * (`caseStateView`), and the host hands the module UI finished strings (MOD-02). The server sends the
 * finished `subjectLabel` and the `actions[]` the viewer may take; nothing here recomputes either.
 * ---------------------------------------------------------------------------------------------------
 */

/** The tones of the shipped `StatusPill` a case state may use (UI-D-817). */
export type CaseStateTone = 'warning' | 'brand' | 'success' | 'neutral';

/** The lucide glyph NAMES of the four pills (the screen maps a name to the icon, MOD-02). */
export type CaseStateGlyph = 'CircleDot' | 'UserCheck' | 'CircleCheck' | 'Lock';

/** A case state as a pill draws it: the word, the tone and the glyph, finished. */
export interface CaseStateView {
  state: ChatCaseState;
  label: string;
  tone: CaseStateTone;
  glyph: CaseStateGlyph;
}

const CASE_STATE_VIEW: Record<
  ChatCaseState,
  { key: string; tone: CaseStateTone; glyph: CaseStateGlyph }
> = {
  open: { key: 'state.open', tone: 'warning', glyph: 'CircleDot' },
  in_progress: { key: 'state.inProgress', tone: 'brand', glyph: 'UserCheck' },
  resolved: { key: 'state.resolved', tone: 'success', glyph: 'CircleCheck' },
  closed: { key: 'state.closed', tone: 'neutral', glyph: 'Lock' },
};

/** UI-D-817: one state, its catalog word, its pill tone and its glyph. */
export function caseStateView(state: ChatCaseState, t: Translator): CaseStateView {
  const entry = CASE_STATE_VIEW[state];
  return { state, label: t(entry.key), tone: entry.tone, glyph: entry.glyph };
}

const CASE_CATEGORY_KEY: Record<ChatCaseCategory, string> = {
  check_in: 'category.checkIn',
  events: 'category.events',
  payment: 'category.payment',
  account: 'category.account',
  other: 'category.other',
};

/** The category word of the closed list (D-811). A value outside the list (never expected) reads as itself. */
export function caseCategoryLabel(category: string, t: Translator): string {
  const key = CASE_CATEGORY_KEY[category as ChatCaseCategory];
  return key ? t(key) : category;
}

const CASE_PRIORITY_KEY: Record<ChatCasePriority, string> = {
  low: 'priority.low',
  normal: 'priority.normal',
  high: 'priority.high',
};

/** The team's priority as a pill: `Alta` danger, `Baixa` neutral and `Normal` draws nothing (UI-D-824, A-UI-7). */
export interface CasePriorityView {
  priority: ChatCasePriority;
  label: string;
  tone: 'danger' | 'neutral';
  /** False for `normal`: the inbox row draws no pill for it. */
  pill: boolean;
}

/** UI-D-824: the priority word and whether the inbox row draws a pill for it. Team facts only. */
export function casePriorityView(priority: ChatCasePriority, t: Translator): CasePriorityView {
  return {
    priority,
    label: t(CASE_PRIORITY_KEY[priority]),
    tone: priority === 'high' ? 'danger' : 'neutral',
    pill: priority !== 'normal',
  };
}

/** "Chamado #42": the number is a plain integer with no thousands separator (UI-D-816, A-UI-25). */
export function caseTitle(t: Translator, number: number): string {
  return t('case.title', { number: String(number) });
}

/** "#42 · {subject}": the row and header subject line; `subjectLabel` is the server's finished label. */
export function caseSubjectLine(t: Translator, number: number, subjectLabel: string): string {
  return t('inbox.rowSubject', { number: String(number), subject: oneLine(subjectLabel) });
}

/**
 * The client-safe twin of the server helper `firstNameOf` (D-222): the first whitespace-separated token
 * of a display name, `''` for a missing or blank one. A unit test compares both on one table of names.
 */
export function firstNameOf(displayName: string | null | undefined): string {
  if (!displayName) return '';
  const [first] = displayName.trim().split(/\s+/u);
  return first ?? '';
}

/** What `caseMetaText` reads: the owner facts, and the priority when the staff bar (not the inbox row) draws it. */
export interface CaseMetaFacts {
  category: ChatCaseCategory;
  /** Present: the staff bar's "{categoria} · {Prioridade} · Com ..."; absent: the inbox row's "{categoria} · Com ...". */
  priority?: ChatCasePriority;
  ownerName: string | null;
  ownerIsViewer: boolean;
}

/**
 * UI-D-824 and UI-D-825: "{categoria} · Com {primeiro nome}", "{categoria} · Sem responsável" or
 * "{categoria} · Com você" (the inbox row), and the same with the priority written out after the category
 * (the staff bar, always, `Normal` included). The owner is the viewer first, then a name, else nobody.
 */
export function caseMetaText(t: Translator, facts: CaseMetaFacts): string {
  const group = facts.priority === undefined ? 'inbox.meta' : 'staffCase.meta';
  const variant = facts.ownerIsViewer ? 'mine' : firstNameOf(facts.ownerName) ? 'owned' : 'unowned';
  const values: Record<string, string> = {
    category: caseCategoryLabel(facts.category, t),
    name: firstNameOf(facts.ownerName),
  };
  if (facts.priority !== undefined) values.priority = t(CASE_PRIORITY_KEY[facts.priority]);
  return t(`${group}.${variant}`, values);
}

/** The finished header of a case for the MEMBER: number, state and subject, nothing a member must not see. */
export interface MemberCaseHeaderView {
  viewer: 'member';
  id: string;
  number: number;
  title: string;
  state: CaseStateView;
  /** The server's finished label: the typed subject, else the start of the first message. */
  subject: string;
  subjectLine: string;
}

/** The finished header of a case for the TEAM: the member's fields plus the meta text and the server's action list. */
export interface StaffCaseHeaderView extends Omit<MemberCaseHeaderView, 'viewer'> {
  viewer: 'staff';
  meta: string;
  /** What the server says this viewer may do, untouched (UI-D-826). */
  actions: ChatCaseAction[];
  /**
   * The owner facts the bar needs for a take-over (UI-D-827, D-843): the STORED owner id (sent back as the
   * expected owner), the live display name (`null` for no owner or an owner who left the staff, who then
   * reads as unowned) and whether the viewer is the owner. The client decides nothing from them.
   */
  ownerUserId: string | null;
  ownerName: string | null;
  ownerIsViewer: boolean;
  /**
   * The facts the edit and details sheets open on (UI-D-827, UI-D-829): the closed category and priority words
   * (the sheets word them through the catalog), the TYPED subject (`null` when the member typed none, so the
   * edit sheet never prefills the first-message fallback) and the opening instant as an ISO string (the
   * details sheet words it in the tenant clock with `caseOpenedMoment`).
   */
  category: ChatCaseCategory;
  priority: ChatCasePriority;
  typedSubject: string | null;
  openedAt: string;
}

export type CaseHeaderView = MemberCaseHeaderView | StaffCaseHeaderView;

/**
 * UI-D-818, UI-D-825, UI-D-835: the finished case header for `viewer`. The member header is built from
 * NAMED fields only (T-12.4-50), so a priority, an owner or an action list that a payload wrongly carries
 * never reaches it. The subject line is never omitted: `subjectLabel` is always a string.
 */
export function caseHeaderView(
  kase: MemberCase | StaffCase,
  { viewer, t }: { viewer: ChatViewer; t: Translator },
): CaseHeaderView {
  const shared = {
    id: kase.id,
    number: kase.number,
    title: caseTitle(t, kase.number),
    state: caseStateView(kase.state, t),
    subject: kase.subjectLabel,
    subjectLine: caseSubjectLine(t, kase.number, kase.subjectLabel),
  };
  if (viewer === 'member') return { viewer: 'member', ...shared };
  const team = kase as StaffCase;
  return {
    viewer: 'staff',
    ...shared,
    meta: caseMetaText(t, {
      category: team.category,
      priority: team.priority,
      ownerName: team.ownerName,
      ownerIsViewer: team.ownerIsViewer,
    }),
    actions: [...team.actions],
    ownerUserId: team.ownerUserId,
    ownerName: team.ownerName,
    ownerIsViewer: team.ownerIsViewer,
    category: team.category,
    priority: team.priority,
    typedSubject: team.subject,
    openedAt: team.openedAt,
  };
}

/** Format `InboxRow.case` for the row (UI-D-824). The owner shows as a first name, never an id. */
function inboxCaseView(kase: NonNullable<InboxRow['case']>, t: Translator): InboxCaseView {
  const priority = casePriorityView(kase.priority, t);
  return {
    number: kase.number,
    subjectLine: caseSubjectLine(t, kase.number, kase.subjectLabel),
    state: caseStateView(kase.state, t),
    priority: priority.pill ? priority : null,
    meta: caseMetaText(t, {
      category: kase.category,
      ownerName: kase.ownerName,
      ownerIsViewer: kase.ownerIsViewer,
    }),
  };
}

/**
 * One history row as the details sheet draws it (UI-D-829). The API row plus two optional hints the host
 * may add: `byMember` (the reopen came from a member message, not from the team) and `actorGone` (the
 * actor left the tenant, so the API omits the name; without it a close with no actor is the automatic one).
 */
export type CaseEventInput = CaseEvent & { byMember?: boolean; actorGone?: boolean };

/** A run of a history sentence: the actor's name is `strong`, everything else is plain. */
export interface CaseEventPart {
  text: string;
  strong: boolean;
}

/** One finished history sentence: the whole text and the same text split so the actor can be bold. */
export interface CaseEventSentence {
  kind: CaseEvent['kind'];
  text: string;
  parts: CaseEventPart[];
}

/** Private-use markers around the bold slot; a name that carries them has them stripped (it cannot forge a run). */
const SLOT_OPEN = '\uE000';
const SLOT_CLOSE = '\uE001';
const withoutSlotMarkers = (value: string) => value.replace(/[\uE000\uE001]/gu, '');

/**
 * UI-D-829, D-810: ONE sentence for a history event, from the catalog's `history.*` keys. The actor (or the
 * member, for the two member sentences) sits in the bold slot; an actor who left the tenant reads
 * `history.actorGone` and a member who left reads `removed.name`; a close with no actor and no
 * `actorGone` hint is the automatic one (`history.autoClosed`). The time is NOT in the sentence.
 */
export function caseEventSentence(t: Translator, event: CaseEventInput): CaseEventSentence {
  const present = (name: string | undefined) => (name?.trim() ? withoutSlotMarkers(name) : null);
  const bold = (value: string) => `${SLOT_OPEN}${withoutSlotMarkers(value)}${SLOT_CLOSE}`;
  const actor = bold(present(event.actorName) ?? t('history.actorGone'));
  const member = bold(present(event.actorName) ?? t('removed.name'));
  const target = present(event.targetName) ?? withoutSlotMarkers(t('history.actorGone'));

  let formatted: string;
  switch (event.kind) {
    case 'opened':
      formatted = t('history.opened', { member });
      break;
    case 'taken':
      formatted = t('history.taken', { actor });
      break;
    case 'assigned':
      formatted = t('history.assigned', { actor, target });
      break;
    case 'resolved':
      formatted = t('history.resolved', { actor });
      break;
    case 'closed':
      formatted =
        present(event.actorName) === null && !event.actorGone
          ? t('history.autoClosed')
          : t('history.closed', { actor });
      break;
    case 'reopened':
      formatted = event.byMember
        ? t('history.reopenedByMember', { member })
        : t('history.reopened', { actor });
      break;
    default:
      // `edited`: the field decides the sentence; a row with no known field reads as the subject change.
      if (event.field === 'category')
        formatted = t('history.category', {
          actor,
          from: withoutSlotMarkers(caseCategoryLabel(event.from ?? '', t)),
          to: withoutSlotMarkers(caseCategoryLabel(event.to ?? '', t)),
        });
      else if (event.field === 'priority')
        formatted = t('history.priority', {
          actor,
          from: withoutSlotMarkers(casePriorityLabel(event.from ?? '', t)),
          to: withoutSlotMarkers(casePriorityLabel(event.to ?? '', t)),
        });
      else formatted = t('history.subject', { actor });
  }

  const parts: CaseEventPart[] = [];
  const slot = /\uE000([^\uE001]*)\uE001/gu;
  let cursor = 0;
  for (const match of formatted.matchAll(slot)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: formatted.slice(cursor, index), strong: false });
    parts.push({ text: match[1] ?? '', strong: true });
    cursor = index + match[0].length;
  }
  if (cursor < formatted.length) parts.push({ text: formatted.slice(cursor), strong: false });
  return { kind: event.kind, text: withoutSlotMarkers(formatted), parts };
}

/** The priority word of an `edited` row's value; a value outside the closed list reads as itself. */
function casePriorityLabel(priority: string, t: Translator): string {
  const key = CASE_PRIORITY_KEY[priority as ChatCasePriority];
  return key ? t(key) : priority;
}

/** One "Meus chamados" card, finished (UI-D-821). Member facts only: no priority, owner or history. */
export interface CaseCardView {
  id: string;
  href: string;
  number: number;
  title: string;
  state: CaseStateView;
  /** The server's finished label (the typed subject, else the start of the first message). */
  subject: string;
  /** False when the member typed no subject: the card draws the label in the regular weight. */
  hasSubject: boolean;
  /** One line with its "Você: " or "Equipe: " prefix; empty when the case has no message. */
  preview: string;
  /** 12.5 (D-860): what the preview is made of (the microphone glyph is for `voice`). Always assigned. */
  previewKind?: PreviewKind;
  category: string;
  time: string;
  /** A closed case is not faded: the card keeps its contrast and only the pill and subject tone change. */
  closed: boolean;
}

/**
 * UI-D-821: one API card as "Meus chamados" draws it. The time is the last message's (the case's opening
 * instant when it has none), in the tenant zone through `inboxTime`, clock-free like the inbox row.
 */
export function caseCardView(
  card: CaseCard,
  { timeZone, keys, t }: { timeZone: string; keys: ChatDayKeys; t: Translator },
): CaseCardView {
  const message = card.lastMessage;
  const parts = message ? previewParts(message, t) : null;
  return {
    id: card.id,
    href: `/suporte/${card.id}`,
    number: card.number,
    title: caseTitle(t, card.number),
    state: caseStateView(card.state, t),
    subject: card.subjectLabel,
    hasSubject: card.subject !== null && card.subject.trim() !== '',
    preview:
      message && parts
        ? t(message.side === 'member' ? 'mine.previewOwn' : 'mine.previewTeam', {
            text: parts.text,
          })
        : '',
    previewKind: parts?.kind ?? 'text',
    category: caseCategoryLabel(card.category, t),
    time: inboxTime(card.lastMessageAt ?? card.openedAt, keys, timeZone, {
      yesterday: t('day.yesterday'),
    }),
    closed: card.state === 'closed',
  };
}

/** The whole "Meus chamados" page, finished (UI-D-821, 12.4-20): the current card, the closed ones, the counts. */
export interface MyCasesPageView {
  current: CaseCardView | null;
  items: CaseCardView[];
  /** The member's CLOSED cases (the one in `current` is not counted): the "Anteriores" count. */
  total: number;
  nextCursor: string | null;
}

/**
 * The finished "Meus chamados" page the BFF handler and the server action both answer. EVERY page,
 * the first and a later one, carries `current` and `total` (the API sends them on every page), so a
 * pull-to-refresh that asks for page 1 replaces the section counts, the current card and the list,
 * while a load-more appends `items` only. Named fields only: nothing a member must not see exists.
 */
export function myCasesPageView(
  page: { current: CaseCard | null; items: CaseCard[]; total: number; nextCursor: string | null },
  context: { timeZone: string; keys: ChatDayKeys; t: Translator },
): MyCasesPageView {
  return {
    current: page.current ? caseCardView(page.current, context) : null,
    items: page.items.map((card) => caseCardView(card, context)),
    total: page.total,
    nextCursor: page.nextCursor,
  };
}

/** `Hoje`, `Ontem` or `dd/MM` for a calendar day in the tenant zone (the details sheet's day rule). */
function caseDayWord(iso: string, keys: ChatDayKeys, timeZone: string, t: Translator): string {
  const dayKey = tenantDayKey(iso, timeZone);
  if (dayKey === keys.todayKey) return t('day.today');
  if (dayKey === keys.yesterdayKey) return t('day.yesterday');
  return formatDayMonthNumeric(iso, timeZone);
}

/** "Hoje · 14:02", "Ontem · 09:10" or "12/10 · 16:40" in the tenant zone (UI-D-829). Clock-free. */
function caseMoment(iso: string, keys: ChatDayKeys, timeZone: string, t: Translator): string {
  return `${caseDayWord(iso, keys, timeZone, t)} · ${formatEventTime(iso, timeZone)}`;
}

/**
 * UI-D-829: the details sheet's "Aberto em" for a case opened at `iso`, in the thread's day-label rule and the
 * tenant clock (`Hoje · 14:02`, `Ontem · 09:10`, `12/10 · 16:40`). Clock-free: the day keys come from the host.
 */
export function caseOpenedMoment(
  iso: string,
  { keys, timeZone, t }: { keys: ChatDayKeys; timeZone: string; t: Translator },
): string {
  return caseMoment(iso, keys, timeZone, t);
}

/** One history row as the details sheet draws it: the finished sentence (actor in the bold part) and its time. */
export interface CaseHistoryRowView {
  kind: CaseEvent['kind'];
  text: string;
  parts: CaseEventPart[];
  time: string;
}

/** One earlier case of the same member (UI-D-829): the anchor target, the "#38 · subject" line, the pill and the opening date. */
export interface EarlierCaseView {
  id: string;
  href: string;
  subjectLine: string;
  state: CaseStateView;
  date: string;
}

export interface CaseHistoryView {
  events: CaseHistoryRowView[];
  earlier: EarlierCaseView[];
  hasMoreEarlier: boolean;
}

/**
 * UI-D-829, 12.4-20: the details sheet's history and earlier cases, finished and in the API's order
 * (events oldest first). The history row carries no bit for the two sentences that differ, so the hints
 * `caseEventSentence` takes are derived HERE from what the rows do say:
 * - `byMember`: a reopen whose actor is the very person who opened the case (the member's own reply
 *   reopens it; a team reopen names a staff member);
 * - `actorGone`: a close with no actor that started from a known state other than `resolved` (the 7-day job only closes
 *   `resolved` cases, so a close from any other state had a person behind it who has since left).
 * A manual close of a `resolved` case by a person who has since left reads as the automatic one: the
 * row cannot say otherwise.
 */
export function caseHistoryView(
  history: {
    events: CaseEvent[];
    earlierCases: Array<{
      id: string;
      number: number;
      state: ChatCaseState;
      subjectLabel: string;
      openedAt: string;
    }>;
    hasMoreEarlier: boolean;
  },
  { timeZone, keys, t }: { timeZone: string; keys: ChatDayKeys; t: Translator },
): CaseHistoryView {
  const openedBy = history.events.find((event) => event.kind === 'opened')?.actorName;
  return {
    events: history.events.map((event) => {
      const sentence = caseEventSentence(t, {
        ...event,
        byMember:
          event.kind === 'reopened' && openedBy !== undefined && event.actorName === openedBy,
        actorGone:
          event.kind === 'closed' &&
          event.fromState !== undefined &&
          event.fromState !== 'resolved',
      });
      return {
        kind: sentence.kind,
        text: sentence.text,
        parts: sentence.parts,
        time: caseMoment(event.at, keys, timeZone, t),
      };
    }),
    earlier: history.earlierCases.map((earlier) => ({
      id: earlier.id,
      href: `/suporte/${earlier.id}`,
      subjectLine: caseSubjectLine(t, earlier.number, earlier.subjectLabel),
      state: caseStateView(earlier.state, t),
      date: caseDayWord(earlier.openedAt, keys, timeZone, t),
    })),
    hasMoreEarlier: history.hasMoreEarlier,
  };
}

/**
 * ---------------------------------------------------------------------------------------------------
 * Phase 11 (11-18, CHAT-06, D-719, UI-D-862, UI-D-866): the Conversas rows as FINISHED views.
 *
 * Pure and serializable: the BFF read and the page both return these, the client list only draws them,
 * and nothing here reads a clock (the caller's ONE `Date.now()` made `keys`). A view carries no "blocked
 * me" fact and no block word: the API's list never says one (D-722), and no field exists to fill.
 * ---------------------------------------------------------------------------------------------------
 */

/** The unread number of a row stops counting at 99 on screen; the API caps its own count at 100 (D-719). */
const UNREAD_DISPLAY_CAP = 99;

/** The other member of a direct conversation, finished (D-721): a departed account reads "Membro removido". */
export interface DirectOtherView {
  /** The public membership id; `null` for a departed account. */
  membershipId: string | null;
  name: string;
  avatar: string | null;
  removed: boolean;
  /** `/membros/{membershipId}`; `null` for a departed account (no link, UI-D-864). */
  profileHref: string | null;
}

/** The other member as the screens draw them: a departed one has no avatar, no link and the neutral name. */
export function directOtherView(other: DirectOther, t: Translator): DirectOtherView {
  const removed = other.removed;
  return {
    membershipId: removed ? null : other.membershipId,
    name: removed ? t('direct.removedName') : (other.displayName ?? t('direct.removedName')),
    avatar: removed ? null : avatarUrlFor(other.avatarAssetId),
    removed,
    profileHref: !removed && other.membershipId ? `/membros/${other.membershipId}` : null,
  };
}

/**
 * The finished words and kind of a direct preview (UI-D-866): a text is cut to the shipped preview length on
 * GRAPHEMES (never inside an emoji or a combining sequence) and read as one line; a recording reads from its
 * STORED length through the shipped `voicePreviewText` and, once retired, says so with no length (D-868).
 */
function directPreviewParts(
  preview: DirectPreview,
  t: Translator,
): { text: string; kind: PreviewKind } {
  if (preview.kind === 'voice') {
    return previewParts(
      {
        preview: '',
        voiceSeconds: preview.durationSeconds,
        ...(preview.deleted ? { voiceDeleted: true as const } : {}),
      },
      t,
    );
  }
  return { text: oneLine(cutOnWord(preview.text, CHAT_PREVIEW_GRAPHEMES)), kind: 'text' };
}

/** A prefix only in front of words: a blank message is a blank line, never a lone "Você:". */
const withPrefix = (prefix: string, text: string) => (text === '' ? '' : `${prefix}${text}`);

/** One Conversas row, finished (UI-D-862, UI-D-866). Serializable: the list client only draws it. */
export interface ConversationRowView {
  conversationId: string;
  /** `/conversas/{conversationId}`. */
  href: string;
  name: string;
  removed: boolean;
  avatar: string | null;
  profileHref: string | null;
  /** "Você: " in front of the viewer's own last message and NOTHING in front of the other member's. */
  preview: string;
  /** The screen draws the `Mic` glyph for `voice` only (UI-D-866). */
  previewKind: PreviewKind;
  /** `HH:mm`, "Ontem" or `dd/MM` in the tenant zone. */
  time: string;
  /** The API's own instant, kept ONLY as the merge key of a refetch; never drawn. */
  lastMessageAt: string;
  /** The count `Badge`: the number as it prints (`99+` above 99); `null` when nothing is unread. */
  unread: { count: number; text: string } | null;
  /** The row's accessible name (UI-D-866): the count clause only when unread. */
  label: string;
}

/**
 * UI-D-862 and UI-D-866: one API list row as the Conversas list draws it. Integers and graphemes only:
 * the `99+` cap is an integer comparison and the preview is cut by `Intl.Segmenter`.
 */
export function conversationRowView(
  row: DirectListRow,
  { timeZone, keys, t }: { timeZone: string; keys: ChatDayKeys; t: Translator },
): ConversationRowView {
  const other = directOtherView(row.other, t);
  const parts = directPreviewParts(row.lastPreview, t);
  const preview = withPrefix(row.lastPreview.own ? t('conversations.prefix.own') : '', parts.text);
  const count = Number.isInteger(row.unreadCount) && row.unreadCount > 0 ? row.unreadCount : 0;
  const label =
    count > 0
      ? t('conversations.row.label', { name: other.name, count, preview })
      : t('conversations.row.labelRead', { name: other.name, preview });
  return {
    conversationId: row.conversationId,
    href: `/conversas/${row.conversationId}`,
    name: other.name,
    removed: other.removed,
    avatar: other.avatar,
    profileHref: other.profileHref,
    preview,
    previewKind: parts.kind,
    time: inboxTime(row.lastMessageAt, keys, timeZone, { yesterday: t('day.yesterday') }),
    lastMessageAt: row.lastMessageAt,
    unread:
      count > 0
        ? { count, text: count > UNREAD_DISPLAY_CAP ? `${UNREAD_DISPLAY_CAP}+` : String(count) }
        : null,
    label: label.trim(),
  };
}

/** The pinned support row, finished (UI-D-862): its words, its dot (a flag, never a count) and its door. */
export interface SupportRowView {
  /** "Equipe {tenant}". */
  name: string;
  /** The row opens `/suporte`, exactly as the bubble does today. */
  href: '/suporte';
  preview: string;
  previewKind: PreviewKind;
  /** The member never wrote: the preview is the idle line, drawn in the tertiary tone. */
  idle: boolean;
  /** The shipped dot semantics (D-237): the team wrote past the member's position in an open case. */
  unread: boolean;
  /** "Equipe {tenant}. {preview}", with ", mensagem nova" when unread. */
  label: string;
}

/** UI-D-862: the support summary as the pinned first row. "Você: " for the member's own, "Equipe: " otherwise. */
export function supportRowView(
  summary: DirectSupportSummary,
  { tenant, t }: { tenant: string; t: Translator },
): SupportRowView {
  const name = t('conversations.support.name', { tenant });
  let preview: string;
  let previewKind: PreviewKind = 'text';
  const idle = summary.lastPreview === null;
  if (summary.lastPreview === null) {
    preview = t('conversations.support.idle', { tenant });
  } else {
    const parts = directPreviewParts(summary.lastPreview, t);
    previewKind = parts.kind;
    preview = withPrefix(
      summary.lastPreview.own ? t('conversations.prefix.own') : t('conversations.prefix.team'),
      parts.text,
    );
  }
  const label = t(
    summary.unread ? 'conversations.row.supportLabelUnread' : 'conversations.row.supportLabel',
    { name, preview },
  );
  return {
    name,
    href: '/suporte',
    preview,
    previewKind,
    idle,
    unread: summary.unread,
    label: label.trim(),
  };
}

/** One page of Conversas, finished: the support row on the FIRST page only, the rows and the opaque cursor. */
export interface ConversationsPageView {
  support?: SupportRowView;
  rows: ConversationRowView[];
  nextCursor: string | null;
}

/** The whole answer of `GET /v1/chat/direct` as finished views; a later page carries no support row. */
export function conversationsPageView(
  answer: DirectListAnswer,
  context: { tenant: string; timeZone: string; keys: ChatDayKeys; t: Translator },
): ConversationsPageView {
  const { tenant, timeZone, keys, t } = context;
  return {
    ...(answer.support ? { support: supportRowView(answer.support, { tenant, t }) } : {}),
    rows: answer.rows.map((row) => conversationRowView(row, { timeZone, keys, t })),
    nextCursor: answer.nextCursor,
  };
}

/**
 * ---------------------------------------------------------------------------------------------------
 * The composer area of a direct conversation (11-18, CHAT-07, D-722, D-723, UI-D-865).
 *
 * ONE finished enum: `open`, `closed` (the strip the BLOCKED side reads), `blocker` (the strip with the way
 * to unblock) and `removed` (the read-only strip of a departed account). The server chooses the word; this
 * function only dresses it, so the client never computes a state. The `closed` strip is the blocked
 * member's whole experience of a block: ONE sentence with a constant glyph, role and name, and NO name, no
 * reason, no date and no block word anywhere (T-11-03, UI-D-860). A unit test scans its whole output.
 * ---------------------------------------------------------------------------------------------------
 */

/** The lucide glyph NAMES of the strips (the screen maps a name to the icon, MOD-02). */
export type ComposerStripGlyph = 'Lock' | 'Ban';

/** The way out of the blocker's strip: the button, its pending word and the toast after it (UI-D-865). */
export interface ComposerUnblockView {
  label: string;
  pendingLabel: string;
  toast: string;
}

/** One strip under the message list, finished. `role` is always `status` (polite, spoken once). */
export interface ComposerStripView {
  kind: 'closed' | 'blocker' | 'removed';
  glyph: ComposerStripGlyph;
  role: 'status';
  text: string;
  /** The accessible name: the very same sentence (the blocked side hears only the one sentence). */
  label: string;
  /** The blocker's button; `null` on the two other strips. */
  unblock: ComposerUnblockView | null;
}

/** The composer slot: exactly one state; `strip` is `null` for `open` (the shipped composer is drawn). */
export interface ComposerStateView {
  state: DirectComposerState;
  strip: ComposerStripView | null;
}

/**
 * UI-D-865: the composer state and its strip. The precedence is removed, then blocker, then closed, else
 * open (the server applies it too; an account that left wins here whatever else the word says).
 */
export function composerStateView(
  composer: DirectComposerState,
  other: { removed: boolean; displayName: string | null },
  t: Translator,
): ComposerStateView {
  if (other.removed || composer === 'removed') {
    const text = t('direct.removed');
    return {
      state: 'removed',
      strip: { kind: 'removed', glyph: 'Lock', role: 'status', text, label: text, unblock: null },
    };
  }
  if (composer === 'blocker') {
    const nome = other.displayName ?? t('direct.removedName');
    const text = t('direct.blocker.text', { nome });
    return {
      state: 'blocker',
      strip: {
        kind: 'blocker',
        glyph: 'Ban',
        role: 'status',
        text,
        label: text,
        unblock: {
          label: t('direct.blocker.unblock'),
          pendingLabel: t('direct.blocker.unblocking'),
          toast: t('direct.blocker.unblocked', { nome }),
        },
      },
    };
  }
  if (composer === 'closed') {
    const text = t('direct.closed');
    return {
      state: 'closed',
      strip: { kind: 'closed', glyph: 'Lock', role: 'status', text, label: text, unblock: null },
    };
  }
  return { state: 'open', strip: null };
}

/** One conversation's screen facts, finished (UI-D-864, UI-D-865): the contact, the strip and the positions. */
export interface DirectDetailView extends ComposerStateView {
  conversationId: string;
  other: DirectOtherView;
  /** The server's own answer to "may the viewer block this person" (a member viewer, a live other, not blocked yet). */
  canBlock: boolean;
  lastSeq: number;
  lastReadSeq: number;
}

/** `GET /v1/chat/direct/{conversationId}` as the finished view the BFF read and the page both return. */
export function directDetailView(detail: DirectDetail, t: Translator): DirectDetailView {
  return {
    conversationId: detail.conversationId,
    other: directOtherView(detail.other, t),
    ...composerStateView(detail.composer, detail.other, t),
    canBlock: detail.canBlock,
    lastSeq: detail.lastSeq,
    lastReadSeq: detail.lastReadSeq,
  };
}

/** The "start a conversation" read, finished: the existing conversation id (or `null`), the contact, the strip. */
export interface DirectWithView extends ComposerStateView {
  conversationId: string | null;
  other: DirectOtherView;
}

/** `GET /v1/chat/direct/with/{membershipId}` as a finished view (the lazy first send, UI-D-864). */
export function directWithView(answer: DirectWithAnswer, t: Translator): DirectWithView {
  return {
    conversationId: answer.conversationId,
    other: directOtherView(answer.other, t),
    ...composerStateView(answer.composer, answer.other, t),
  };
}
