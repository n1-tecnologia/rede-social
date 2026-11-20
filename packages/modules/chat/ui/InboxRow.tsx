import { Avatar, cn, StatusPill } from '@rede-social/ui';
import type { ReactNode } from 'react';

/**
 * One row of the staff inbox (UI-D-262, sketch 007 surface 1) [designed]: ONE link to the
 * conversation carrying D-224's four facts, the member (avatar and name), a one-line preview of the
 * latest message, its time, and whether the team still owes an answer.
 *
 * - **Awaiting** (the latest message is the member's and nobody of the team has read it, D-238): the
 *   preview is `text-text` and the 8px `bg-brand` dot sits under the time. A brand dot, not a danger
 *   badge: "awaiting" is information, and the count already sits on the chat slot. The name gets the
 *   screen-reader suffix `awaitingSr` (", aguardando resposta").
 * - **Blocked member:** the neutral `StatusPill` (`blockedLabel`) takes the dot slot.
 * - **Departed member** (`state: 'removed'`): the host passes the removed name ("Membro removido"),
 *   rendered 14/400 tertiary, and no avatar, so the neutral `User` fallback shows.
 * - **Active** (`active`): the open conversation in the desktop split is `bg-bg-active` with
 *   `aria-current="page"`.
 *
 * **The case facts (12.4, UI-D-824, A-UI-7, A-UI-24):** the host may add `subjectLine` ("#42 · subject", one
 * truncated line under the name), and a meta line under the preview made of `statePill` and `priorityPill`
 * (React nodes the host builds from the case state view; the priority pill only for Alta and Baixa, Normal
 * draws nothing) and `metaText` ("{categoria} · Com {primeiro nome}"). The 72px floor stays, but the row no
 * longer centres its content: it is top aligned and has NO fixed height, so it grows with its content, and
 * the meta line wraps (never truncates), up to three lines with two pills in the 288px list pane.
 *
 * Overflow: the name and the preview `truncate` inside a `min-w-0 flex-1` column; the trailing column
 * is `shrink-0`, so a 60-character name never pushes the time out. The preview is React text, one
 * line, with no linkifier and no HTML sink (T-07-70).
 *
 * A plain `<a>`, not the web framework's link: a module package does not depend on the web framework (MOD-02). The
 * host intercepts the click to navigate client-side, so the list keeps its scroll position.
 * Props-only: no words.
 */
export type InboxRowState = 'active' | 'blocked' | 'removed';

export interface InboxRowProps {
  href: string;
  /** The open conversation in the desktop split (UI-D-264). */
  active?: boolean;
  /** The member's avatar URL; `null` shows the neutral `User` fallback. */
  avatar: string | null;
  name: string;
  /** One line; the host already prefixed a team message with "{firstName}: ". */
  preview: string;
  /** "HH:mm", "Ontem" or "dd/MM", formatted by the host in the tenant clock. */
  time: string;
  awaiting: boolean;
  /** The screen-reader suffix appended to the name when awaiting; absent on a row whose `label` names it whole. */
  awaitingSr?: string;
  state: InboxRowState;
  /** The neutral pill text for a blocked member; absent on a list that has no blocked state. */
  blockedLabel?: string;
  /** "#42 · subject", finished by the host: one truncated line under the name. */
  subjectLine?: string;
  /** The case state pill, built by the host. */
  statePill?: ReactNode;
  /** The priority pill, built by the host only for Alta and Baixa; absent for Normal. */
  priorityPill?: ReactNode;
  /** "{categoria} · Com {primeiro nome}", "... · Sem responsável" or "... · Com você". */
  metaText?: string;
  /**
   * 12.5 (D-860, UI-D-853): a decorative node the host draws before the preview text (the microphone glyph
   * of a voice message). The host builds it (`aria-hidden`, `shrink-0`); the finished words stay in `preview`.
   * Absent, the preview line is exactly what it was.
   */
  previewLeading?: ReactNode;
  /**
   * 11-19 (UI-D-862, UI-D-866): the unread mark, built by the host (the count `Badge` of a direct conversation or
   * the dot of the support row). It takes the 8px awaiting dot's place under the time, and the dot is not drawn
   * beside it. A blocked member's pill still wins the slot. Absent, the row is exactly what it was.
   */
  unread?: ReactNode;
  /**
   * 11-19 (UI-D-862): a node drawn in place of the avatar, for the pinned support row (the tenant logo in a neutral
   * disc). The host builds it (`aria-hidden`); absent, the avatar draws as before.
   */
  avatarSlot?: ReactNode;
  /**
   * 11-19 (UI-D-879): the accessible name of the whole link, finished by the host ("{name}, {count} mensagens
   * novas. {preview}"). Absent, the link is named by its content, as before.
   */
  label?: string;
  /** 11-19 (UI-D-862): the preview in the tertiary tone, for the support row's idle line. */
  previewMuted?: boolean;
}

export function InboxRow({
  href,
  active = false,
  avatar,
  name,
  preview,
  time,
  awaiting,
  awaitingSr,
  state,
  blockedLabel,
  subjectLine,
  statePill,
  priorityPill,
  metaText,
  previewLeading,
  unread,
  avatarSlot,
  label,
  previewMuted = false,
}: InboxRowProps) {
  const removed = state === 'removed';
  const hasMeta = Boolean(statePill || priorityPill || metaText);
  // Awaiting reads in full ink; the support row's idle line (`previewMuted`) reads tertiary, never both.
  const previewTone = previewMuted
    ? 'text-text-tertiary'
    : awaiting
      ? 'text-text'
      : 'text-text-secondary';
  return (
    <a
      href={href}
      data-inbox-row
      data-awaiting={awaiting || undefined}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      className={cn(
        'flex min-h-18 items-start gap-3 border-b border-divider px-4 py-3 transition-colors hover:bg-bg-hover active:bg-bg-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand',
        active && 'bg-bg-active',
      )}
    >
      <span aria-hidden className="inline-flex shrink-0 self-start">
        {avatarSlot ?? <Avatar size="md" src={removed ? null : avatar} alt="" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          data-inbox-name
          className={cn(
            'truncate text-sm',
            removed ? 'font-normal text-text-tertiary' : 'font-bold text-text',
          )}
        >
          {name}
          {awaiting && awaitingSr ? <span className="sr-only">{awaitingSr}</span> : null}
        </span>
        {subjectLine ? (
          <span data-inbox-subject className="truncate text-sm font-normal text-text">
            {subjectLine}
          </span>
        ) : null}
        {previewLeading ? (
          <span
            data-inbox-preview
            className={cn('flex min-w-0 items-center gap-1 text-sm font-normal', previewTone)}
          >
            {previewLeading}
            <span data-inbox-preview-text className="min-w-0 truncate">
              {preview}
            </span>
          </span>
        ) : (
          <span data-inbox-preview className={cn('truncate text-sm font-normal', previewTone)}>
            {preview}
          </span>
        )}
        {hasMeta ? (
          <span data-inbox-meta className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {statePill}
            {priorityPill}
            {metaText ? (
              <span data-inbox-meta-text className="text-xs font-normal text-text-tertiary">
                {metaText}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span data-inbox-time className="text-xs font-normal tabular-nums text-text-tertiary">
          {time}
        </span>
        {state === 'blocked' ? (
          <StatusPill tone="neutral" data-inbox-blocked>
            {blockedLabel}
          </StatusPill>
        ) : unread ? (
          unread
        ) : awaiting ? (
          <span aria-hidden data-inbox-dot className="h-2 w-2 rounded-full bg-brand" />
        ) : null}
      </span>
    </a>
  );
}
