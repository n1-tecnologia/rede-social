import type { TenantRole } from '@rede-social/contracts';
import {
  MODERATION_ACTIONS,
  type ModerationAction,
  type ModerationLogEntry,
} from '@rede-social/contracts/moderation';

/**
 * `ModerationLogEntry` (the wire contract) → what one log row renders (UI-D-278). PURE: no catalog,
 * no clock, no request — the copy arrives as TEMPLATES (`t.raw`, placeholders intact) and the time
 * zone as a value, so every rule here is unit-testable (`moderation-view.test.ts`).
 *
 * - The sentence is returned as PARTS: the actor and the target are the bold spans (`strong`), every
 *   other run is plain text. The row renders them; no markup ever comes from the catalog or the API.
 * - The actor reads "Você" when the API marked the caller (`actor.isViewer`, computed in SQL — the
 *   client never compares ids); a departed actor or target reads "Membro removido" (UI-D-24).
 * - The time is ABSOLUTE, "{date} às {time}" with `dd/MM/yyyy` and `HH:mm` (h23) in the TENANT's time
 *   zone (UI-D-14: formatted on the server, so the page and its hydration agree).
 */

export type ModerationLogLabels = {
  rows: {
    commentRemoved: string;
    blocked: string;
    unblocked: string;
    roleChanged: string;
  };
  roles: Record<TenantRole, string>;
  you: string;
  removedMember: string;
  context: { post: string; story: string };
  /** "“{excerpt}”" */
  excerpt: string;
  /** "Motivo: {reason}" */
  reason: string;
  /** "{date} às {time}" */
  time: string;
};

/**
 * The `?acao=` filter (D-337, UI-D-277): the URL carries the API's own action values. Anything else —
 * absent, repeated, unknown, a different case — reads as "Tudo" (`null`), never as an error, so a
 * hand-edited URL still shows the whole log.
 */
export function parseModerationAction(raw: string | string[] | undefined): ModerationAction | null {
  if (typeof raw !== 'string') return null;
  return (MODERATION_ACTIONS as readonly string[]).includes(raw) ? (raw as ModerationAction) : null;
}

/** The chip row, in UI-D-277's order: "Tudo" first (`null`), then one chip per action. */
export const MODERATION_LOG_FILTERS: readonly {
  action: ModerationAction | null;
  key: 'all' | 'comments' | 'blocks' | 'unblocks' | 'roles';
}[] = [
  { action: null, key: 'all' },
  { action: 'comment_removed', key: 'comments' },
  { action: 'member_blocked', key: 'blocks' },
  { action: 'member_unblocked', key: 'unblocks' },
  { action: 'role_changed', key: 'roles' },
];

/** What `moderationLogLabels` needs from a `next-intl` translator scoped to `moderation.log`. */
export type ModerationLogTranslator = {
  (key: string): string;
  raw: (key: string) => unknown;
};

/**
 * The row labels from the `moderation.log` namespace — ONE builder shared by the page (page 1) and
 * the load-more action, so the two can never format a row differently. `raw`: the templates keep
 * their `{…}` slots for the pure view to fill.
 */
export function moderationLogLabels(t: ModerationLogTranslator): ModerationLogLabels {
  return {
    rows: {
      commentRemoved: String(t.raw('rows.commentRemoved')),
      blocked: String(t.raw('rows.blocked')),
      unblocked: String(t.raw('rows.unblocked')),
      roleChanged: String(t.raw('rows.roleChanged')),
    },
    roles: {
      admin_tenant: t('roles.admin_tenant'),
      support_tenant: t('roles.support_tenant'),
      member: t('roles.member'),
    },
    you: t('you'),
    removedMember: t('removedMember'),
    context: { post: t('context.post'), story: t('context.story') },
    excerpt: String(t.raw('excerpt')),
    reason: String(t.raw('reason')),
    time: String(t.raw('time')),
  };
}

export type SentencePart = { text: string; strong: boolean };

export type ModerationLogRowView = {
  id: string;
  action: ModerationAction;
  sentence: SentencePart[];
  /** "Comentário em um post" / "… story" — comment removals only. */
  context: string | null;
  /** The excerpt inside pt-BR quotes, whole (never clamped: it is the evidence). */
  excerpt: string | null;
  reason: string | null;
  /** "02/10/2026 às 14:05" */
  time: string;
  /** The ISO instant, for the `<time dateTime>` attribute. */
  iso: string;
};

const TEMPLATE_KEY: Record<ModerationAction, keyof ModerationLogLabels['rows']> = {
  comment_removed: 'commentRemoved',
  member_blocked: 'blocked',
  member_unblocked: 'unblocked',
  role_changed: 'roleChanged',
};

/** Splits a template on its `{name}` slots; `bold` names render as strong parts, the rest inline. */
function sentenceParts(
  template: string,
  values: Record<string, string>,
  bold: ReadonlySet<string>,
): SentencePart[] {
  const parts: SentencePart[] = [];
  const push = (text: string, strong: boolean) => {
    if (text === '') return;
    const last = parts[parts.length - 1];
    if (last && last.strong === strong && !strong) last.text += text;
    else parts.push({ text, strong });
  };
  let cursor = 0;
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    const index = match.index ?? 0;
    push(template.slice(cursor, index), false);
    const name = match[1] ?? '';
    push(values[name] ?? match[0], bold.has(name));
    cursor = index + match[0].length;
  }
  push(template.slice(cursor), false);
  return parts;
}

const isBlank = (value: string | null) => value === null || value.trim() === '';

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);

/** `dd/MM/yyyy` and `HH:mm` (h23) of an instant in `timeZone`, from explicit 2-digit fields. */
export function formatLogTime(iso: string, timeZone: string, template: string): string {
  const at = new Date(iso);
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return fill(template, {
    date: `${part('day')}/${part('month')}/${part('year')}`,
    time: `${part('hour')}:${part('minute')}`,
  });
}

export function toModerationLogView(
  entry: ModerationLogEntry,
  { timezone, labels }: { timezone: string; labels: ModerationLogLabels },
): ModerationLogRowView {
  const actor = entry.actor.isViewer
    ? labels.you
    : (entry.actor.displayName ?? labels.removedMember);
  const target = entry.target.displayName ?? labels.removedMember;
  const values: Record<string, string> = { actor, target };
  if (entry.details) {
    values.from = labels.roles[entry.details.from];
    values.to = labels.roles[entry.details.to];
  }

  return {
    id: entry.id,
    action: entry.action,
    sentence: sentenceParts(
      labels.rows[TEMPLATE_KEY[entry.action]],
      values,
      new Set(['actor', 'target']),
    ),
    context:
      entry.action === 'comment_removed'
        ? entry.subjectType === 'story_comment'
          ? labels.context.story
          : labels.context.post
        : null,
    // E10/empty: an empty stored excerpt (a defensive case) omits the block; the context stays.
    excerpt: isBlank(entry.excerpt) ? null : fill(labels.excerpt, { excerpt: entry.excerpt ?? '' }),
    // MODER-03 empty: a reason that is empty or only whitespace is no reason — no "Motivo" line.
    reason: isBlank(entry.reason) ? null : fill(labels.reason, { reason: entry.reason ?? '' }),
    time: formatLogTime(entry.createdAt, timezone, labels.time),
    iso: entry.createdAt,
  };
}
