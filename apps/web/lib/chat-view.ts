import type { MessageRow } from '@rede-social/module-chat/contracts';
import type { MessageBubbleLabel, MessageListItem } from '@rede-social/module-chat/ui';
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
