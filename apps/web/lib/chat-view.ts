import { avatarUrlFor } from '@rede-social/contracts/profiles';
import type {
  CaseCard,
  CaseEvent,
  ChatCaseAction,
  ChatCaseCategory,
  ChatCasePriority,
  ChatCaseState,
  InboxRow,
  MemberCase,
  MessageRow,
  StaffCase,
} from '@rede-social/module-chat/contracts';
import type {
  InboxRowState,
  MessageBubbleLabel,
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
  const own = viewer === 'member' ? row.side === 'member' : row.side === 'staff';
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
    authorKey: row.side === 'member' ? 'member' : `staff:${firstName}`,
    body: row.body,
    label,
    time: formatEventTime(row.createdAt, timeZone),
    dayKey: tenantDayKey(row.createdAt, timeZone),
    createdAtMs: Date.parse(row.createdAt),
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
  words: ChatDayWords & { pending: string },
): MessageListItem[] {
  const settled = views.filter((view) => !view.pending).sort((a, b) => a.seq - b.seq);
  const pending = views.filter((view) => view.pending);
  const items: MessageListItem[] = [];

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
      body: view.body,
      label: view.label,
      time: next && sameRun(view, next) ? null : view.time,
    });
  });

  for (const view of pending) {
    items.push({
      kind: 'message',
      key: view.id,
      side: view.side,
      body: view.body,
      label: view.label,
      pending: true,
      pendingLabel: words.pending,
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
  time: string;
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
  if (message) {
    const text = oneLine(message.preview);
    const firstName = message.authorFirstName ?? '';
    preview =
      message.side === 'staff' && firstName
        ? t('inbox.teamPreview', { firstName, preview: text })
        : text;
  }
  return {
    conversationId: row.conversationId,
    href: `/suporte/${row.conversationId}`,
    name,
    avatar: removed ? null : avatarUrlFor(row.member.avatarAssetId),
    preview,
    time: row.lastMessageAt
      ? inboxTime(row.lastMessageAt, keys, timeZone, { yesterday: t('day.yesterday') })
      : '',
    awaiting: row.awaiting,
    state: row.member.state,
    case: row.case ? inboxCaseView(row.case, t) : null,
  };
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
  const text = message ? oneLine(message.preview) : '';
  return {
    id: card.id,
    href: `/suporte/${card.id}`,
    number: card.number,
    title: caseTitle(t, card.number),
    state: caseStateView(card.state, t),
    subject: card.subjectLabel,
    hasSubject: card.subject !== null && card.subject.trim() !== '',
    preview: message
      ? t(message.side === 'member' ? 'mine.previewOwn' : 'mine.previewTeam', { text })
      : '',
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
