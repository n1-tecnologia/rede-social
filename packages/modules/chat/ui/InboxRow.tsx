import { Avatar, cn, StatusPill } from '@rede-social/ui';

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
 * Overflow: the name and the preview `truncate` inside a `min-w-0 flex-1` column; the trailing column
 * is `shrink-0`, so a 60-character name never pushes the time out. The preview is React text, one
 * line, with no linkifier and no HTML sink (T-07-70).
 *
 * A plain `<a>`, not `next/link`: a module package does not depend on the web framework (MOD-02). The
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
  /** The screen-reader suffix appended to the name when awaiting. */
  awaitingSr: string;
  state: InboxRowState;
  /** The neutral pill text for a blocked member. */
  blockedLabel: string;
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
}: InboxRowProps) {
  const removed = state === 'removed';
  return (
    <a
      href={href}
      data-inbox-row
      data-awaiting={awaiting || undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-18 items-center gap-3 border-b border-divider px-4 py-3 transition-colors hover:bg-bg-hover active:bg-bg-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand',
        active && 'bg-bg-active',
      )}
    >
      <span aria-hidden className="inline-flex shrink-0">
        <Avatar size="md" src={removed ? null : avatar} alt="" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          data-inbox-name
          className={cn(
            'truncate text-sm',
            removed ? 'font-normal text-text-tertiary' : 'font-bold text-text',
          )}
        >
          {name}
          {awaiting ? <span className="sr-only">{awaitingSr}</span> : null}
        </span>
        <span
          data-inbox-preview
          className={cn(
            'truncate text-sm font-normal',
            awaiting ? 'text-text' : 'text-text-secondary',
          )}
        >
          {preview}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span data-inbox-time className="text-xs font-normal tabular-nums text-text-tertiary">
          {time}
        </span>
        {state === 'blocked' ? (
          <StatusPill tone="neutral" data-inbox-blocked>
            {blockedLabel}
          </StatusPill>
        ) : awaiting ? (
          <span aria-hidden data-inbox-dot className="h-2 w-2 rounded-full bg-brand" />
        ) : null}
      </span>
    </a>
  );
}
