import {
  REPORT_LIST_STATES,
  type ReportItem,
  type ReportListState,
  type ReportReason,
  type ReportResolveAction,
  type ReportStatus,
  type ReportSubjectType,
} from '@rede-social/contracts/moderation';
import type { getTranslations } from 'next-intl/server';
import { formatVoiceDuration } from './chat-view';
import { formatLogTime } from './moderation-view';

/**
 * The report views (11-18, MODER-05, D-730, D-731, D-732, UI-D-871, UI-D-873, UI-D-874). PURE: no clock, no
 * request, no HTML. Every word comes from the catalog through the translator the caller scopes (`safety`
 * for the subject and the queue strings, `moderation` for the resolve rows), and every member string (a
 * caption, a name, a message copy, a community description) is returned as a plain string the component
 * renders as React text (T-11-16).
 *
 * Exhaustive over the six subjects: each `switch` ends in a `never` assignment, so a seventh subject in
 * `REPORT_SUBJECT_TYPES` is a compile error here, and an unknown value at runtime throws rather than
 * rendering a half-built row.
 */

type Translator = Awaited<ReturnType<typeof getTranslations>>;

/** The queue's body is a caption or comment cut to this many graphemes (UI-D-873, UI-D-637). */
const EXCERPT_GRAPHEMES = 120;

const segmenter = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' });

/** The first `max` graphemes of `text`, with an ellipsis ONLY when something was cut (never mid-emoji). */
function cutGraphemes(text: string, max: number): string {
  const graphemes = Array.from(segmenter.segment(text.trim()), (part) => part.segment);
  if (graphemes.length <= max) return graphemes.join('');
  return `${graphemes.slice(0, max).join('').trimEnd()}…`;
}

/** The closed `?estado=` of the queue (UI-D-637): anything outside the list reads as the open queue. */
export function parseReportEstado(raw: string | string[] | undefined): ReportListState {
  if (typeof raw !== 'string') return 'abertas';
  return (REPORT_LIST_STATES as readonly string[]).includes(raw)
    ? (raw as ReportListState)
    : 'abertas';
}

/** The words of one subject: its type pill, its report sheet title and, for a message, its privacy line. */
export interface ReportSubjectView {
  subjectType: ReportSubjectType;
  typePill: string;
  sheetTitle: string;
  /** The one assurance a message report adds under the intro (UI-D-871); `null` for every other subject. */
  privacy: string | null;
}

/** The catalog key of each subject (`safety.subject.<key>`); the `never` guard makes a seventh a type error. */
function subjectKey(subject: ReportSubjectType): string {
  switch (subject) {
    case 'feed_post':
      return 'feedPost';
    case 'post_comment':
      return 'postComment';
    case 'story':
      return 'story';
    case 'story_comment':
      return 'storyComment';
    case 'community':
      return 'community';
    case 'direct_message':
      return 'directMessage';
    default: {
      const unreachable: never = subject;
      throw new Error(`unknown report subject: ${String(unreachable)}`);
    }
  }
}

/**
 * D-730, UI-D-871: one subject as the queue's pill and the report sheet's title and privacy line. `voice`
 * only changes a direct message ("Denunciar mensagem de voz" and its own line); a post, a comment, a story
 * and a community read the same either way.
 */
export function reportSubjectView(
  subject: ReportSubjectType,
  t: Translator,
  { voice = false }: { voice?: boolean } = {},
): ReportSubjectView {
  const key = subjectKey(subject);
  const message = subject === 'direct_message';
  return {
    subjectType: subject,
    typePill: t(`subject.${key}.pill`),
    sheetTitle: t(message && voice ? `subject.${key}.titleVoice` : `subject.${key}.title`),
    privacy: message ? t(voice ? `subject.${key}.privacyVoice` : `subject.${key}.privacy`) : null,
  };
}

/** The finished body of a queue row (UI-D-873). A message has NO clamp: the administrator judges its own words. */
export type ReportBodyView =
  | { kind: 'text'; text: string; clamp: 3 }
  | { kind: 'story'; text: string; clamp: 3 }
  | { kind: 'community'; name: string; description: string }
  | { kind: 'message'; text: string; note: string }
  | {
      kind: 'voice';
      mediaId: string;
      durationSeconds: number;
      durationLabel: string;
      note: string;
    }
  | { kind: 'voiceGone'; text: string; note: string }
  | { kind: 'unavailable'; text: string };

/** The tone of a state pill (the shipped `StatusPill`): open and dismissed are neutral, a resolution is success. */
export interface ReportStatePill {
  label: string;
  tone: 'neutral' | 'success';
}

/** One queue row, finished (UI-D-873). Serializable. */
export interface ReportRowView {
  id: string;
  subjectType: ReportSubjectType;
  typePill: string;
  statePill: ReportStatePill;
  body: ReportBodyView;
  /** "Motivo: {motivo} · por {nome} · {data}" (the reporter, the date in the tenant zone). */
  meta: string;
  /** The author's name ("Membro removido" for a departed account). */
  author: string;
  /** "Resolver" exists only on an open report. */
  open: boolean;
  /** The item's own page; `null` for a message (never a link), for an item that is gone, or with no `ref`. */
  viewHref: string | null;
  viewLabel: string | null;
}

/**
 * The item's own page (UI-D-873, A-UI-14), built from the API's `ref` because the API knows no web route:
 * a post `/post/{id}`, a post comment `/post/{id}?comentario={commentId}`, a story and a story comment
 * `/stories/{id}`, a community `/comunidades/{id}`. NEVER for a message, and `null` when the item is gone or
 * the `ref` it needs is missing.
 */
export function reportHref(item: ReportItem): string | null {
  if (!item.contentAvailable) return null;
  switch (item.subjectType) {
    case 'feed_post':
      return `/post/${item.ref?.postId ?? item.subjectId}`;
    case 'post_comment':
      return item.ref?.postId ? `/post/${item.ref.postId}?comentario=${item.subjectId}` : null;
    case 'story':
      return `/stories/${item.ref?.storyId ?? item.subjectId}`;
    case 'story_comment':
      return item.ref?.storyId ? `/stories/${item.ref.storyId}` : null;
    case 'community':
      return `/comunidades/${item.subjectId}`;
    case 'direct_message':
      return null;
    default: {
      const unreachable: never = item.subjectType;
      throw new Error(`unknown report subject: ${String(unreachable)}`);
    }
  }
}

const REASON_KEY: Record<ReportReason, string> = {
  offensive: 'reasons.offensive',
  harassment: 'reasons.harassment',
  spam: 'reasons.spam',
  sexual_violent: 'reasons.sexualViolent',
  other: 'reasons.other',
};

/** A community's name and description: the API's split, else the stored snapshot's first line and the rest. */
function communityBody(item: ReportItem): ReportBodyView {
  if (item.community) {
    return {
      kind: 'community',
      name: item.community.name,
      description: item.community.description,
    };
  }
  const [name = '', ...rest] = item.excerpt.split(/\r?\n/);
  return { kind: 'community', name: name.trim(), description: rest.join('\n').trim() };
}

function bodyOf(item: ReportItem, t: Translator): ReportBodyView {
  const unavailable: ReportBodyView = { kind: 'unavailable', text: t('queue.body.unavailable') };
  switch (item.subjectType) {
    case 'feed_post':
    case 'post_comment':
    case 'story_comment':
      return item.contentAvailable
        ? { kind: 'text', text: cutGraphemes(item.excerpt, EXCERPT_GRAPHEMES), clamp: 3 }
        : unavailable;
    case 'story': {
      if (!item.contentAvailable) return unavailable;
      const caption = cutGraphemes(item.excerpt, EXCERPT_GRAPHEMES);
      return {
        kind: 'story',
        text: caption === '' ? t('queue.body.storyEmpty') : caption,
        clamp: 3,
      };
    }
    case 'community':
      return item.contentAvailable ? communityBody(item) : unavailable;
    case 'direct_message': {
      const note = t('queue.body.messageNote');
      if (item.voice?.gone) return { kind: 'voiceGone', text: t('queue.body.voiceGone'), note };
      if (item.voice) {
        return {
          kind: 'voice',
          mediaId: item.voice.mediaId,
          durationSeconds: item.voice.durationSeconds,
          durationLabel: formatVoiceDuration(item.voice.durationSeconds),
          note,
        };
      }
      // The WHOLE stored copy (at most 280 characters), no clamp: the message is judged on its own words.
      return { kind: 'message', text: item.excerpt, note };
    }
    default: {
      const unreachable: never = item.subjectType;
      throw new Error(`unknown report subject: ${String(unreachable)}`);
    }
  }
}

function statePillOf(item: ReportItem, t: Translator): ReportStatePill {
  const status: ReportStatus = item.status;
  switch (status) {
    case 'open':
      return { label: t('queue.state.open'), tone: 'neutral' };
    case 'dismissed':
      return { label: t('queue.state.dismissed'), tone: 'neutral' };
    case 'content_removed':
      // A community's removal is an archive, and the administrator reads it as one (D-732).
      return {
        label: t(
          item.subjectType === 'community'
            ? 'queue.state.communityArchived'
            : 'queue.state.contentRemoved',
        ),
        tone: 'success',
      };
    case 'author_blocked':
      return { label: t('queue.state.authorBlocked'), tone: 'success' };
    default: {
      const unreachable: never = status;
      throw new Error(`unknown report status: ${String(unreachable)}`);
    }
  }
}

/**
 * UI-D-873: one API item as the queue row. The reporter's NOTE is deliberately not part of the row, and a
 * message row carries no conversation, counterpart or link of any kind (D-731).
 */
export function reportRowView(
  item: ReportItem,
  { timeZone, t }: { timeZone: string; t: Translator },
): ReportRowView {
  const removed = t('queue.removedMember');
  const href = reportHref(item);
  return {
    id: item.id,
    subjectType: item.subjectType,
    typePill: reportSubjectView(item.subjectType, t).typePill,
    statePill: statePillOf(item, t),
    body: bodyOf(item, t),
    meta: t('queue.meta', {
      motivo: t(REASON_KEY[item.reason]),
      nome: item.reporter.displayName ?? removed,
      data: formatLogTime(item.createdAt, timeZone, '{date}'),
    }),
    author: item.author.displayName ?? removed,
    open: item.status === 'open',
    viewHref: href,
    viewLabel: href === null ? null : t('queue.viewContent'),
  };
}

/** The lucide glyph NAMES of the resolve rows (the screen maps a name to the icon, MOD-02). */
export type ResolveGlyph = 'Check' | 'Trash2' | 'Archive' | 'Ban';

/** One legal action of the resolve sheet, finished. A row that is not legal for the subject does not exist. */
export interface ResolveRowView {
  /** The API's own verb (`POST /v1/admin/reports/{id}/resolve { resolution }`). */
  action: ReportResolveAction;
  /** What the screen opens: nothing (`dismiss`), the removal dialog, the archive dialog or the block dialog. */
  kind: 'dismiss' | 'remove' | 'archive' | 'block';
  label: string;
  glyph: ResolveGlyph;
  /** The destructive rows draw the shipped danger ink with their words (never colour alone). */
  danger: boolean;
}

export interface ResolveRowsView {
  rows: ResolveRowView[];
  /** "Uma mensagem enviada não pode ser removida." under a message's two rows; `null` otherwise. */
  helper: string | null;
}

/**
 * UI-D-874, D-732: the ordered LEGAL actions of an open report, never a disabled one. Ignore always; then
 * remove (a community ARCHIVES and is never labelled "Remover", so the administrator knows it is
 * reversible), then block author only when the server says the author is a member. A direct message can
 * only be ignored or have its author blocked (removing it is the API's 409 `not_removable`), with the
 * helper line under the rows. A report that is not open has nothing to resolve.
 */
export function resolveRowsFor(item: ReportItem, t: Translator): ResolveRowsView {
  if (item.status !== 'open') return { rows: [], helper: null };
  const message = item.subjectType === 'direct_message';
  const rows: ResolveRowView[] = [
    {
      action: 'dismiss',
      kind: 'dismiss',
      label: t('report.resolve.dismiss'),
      glyph: 'Check',
      danger: false,
    },
  ];
  if (!message) {
    const archive = item.subjectType === 'community';
    rows.push({
      action: 'remove_content',
      kind: archive ? 'archive' : 'remove',
      label: t(archive ? 'report.resolve.archive' : 'report.resolve.remove'),
      glyph: archive ? 'Archive' : 'Trash2',
      danger: true,
    });
  }
  if (item.author.isMember) {
    rows.push({
      action: 'block_author',
      kind: 'block',
      label: t('report.resolve.block'),
      glyph: 'Ban',
      danger: true,
    });
  }
  return { rows, helper: message ? t('report.resolve.helperMessage') : null };
}
