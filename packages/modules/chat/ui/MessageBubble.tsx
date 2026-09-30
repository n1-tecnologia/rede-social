import { cn, linkify } from '@rede-social/ui';
import { ShieldCheck } from 'lucide-react';

/**
 * One chat message: the prototype's bubble pair (UI-D-259) minus the ticket extras.
 *
 * - **Sides.** `own` sits right on the tenant colour (`bg-brand text-on-brand`, accent nt-2); `other`
 *   sits left on the secondary surface. The viewer's side is decided by the host (`chat-view.ts`): a
 *   member's own messages, or every team message for staff.
 * - **The body is plain text** (D-225, T-07-60): React text with `whitespace-pre-wrap`, so line breaks
 *   survive and nothing is ever parsed as HTML or markdown. Links come only from the ONE shared
 *   linkifier, with side-aware ink (`underline text-on-brand` on the brand fill, brand ink elsewhere).
 *   `[overflow-wrap:anywhere]` with `max-w-[85%]` wraps a 300-character unbroken URL inside the bubble.
 * - **The sender label sits ABOVE the bubble, neutral** (sketch 007 delta a): 12/700 secondary, the
 *   `ShieldCheck` mark when the host asks for it, and a screen-reader suffix. No small text ever sits
 *   on a tenant colour, and nothing about the agent beyond a first name is shown (D-222).
 * - **The time sits under the bubble**, only on the last bubble of a run (the host decides), or the
 *   pending label while an optimistic send is in flight.
 *
 * Props-only: this component ships no words.
 */

export interface MessageBubbleLabel {
  firstName: string;
  /** Screen-reader suffix, e.g. ", da equipe". Empty for none. */
  srSuffix: string;
  icon: 'shield' | null;
}

export interface MessageBubbleProps {
  side: 'own' | 'other';
  body: string;
  label?: MessageBubbleLabel | null;
  /** `HH:mm`, already formatted in the tenant zone; omitted inside a run. */
  time?: string | null;
  /** An optimistic bubble: shows `pendingLabel` in the time slot. */
  pending?: boolean;
  pendingLabel?: string;
}

const OWN_LINK_CLASS = 'underline text-on-brand';
const OTHER_LINK_CLASS = 'text-brand underline-offset-2 hover:underline';

export function MessageBubble({
  side,
  body,
  label = null,
  time = null,
  pending = false,
  pendingLabel = '',
}: MessageBubbleProps) {
  const own = side === 'own';
  const footer = pending ? pendingLabel : time;

  return (
    <div
      data-chat-bubble={side}
      data-pending={pending || undefined}
      className={cn(
        'flex max-w-[85%] min-w-0 flex-col',
        own ? 'self-end items-end' : 'self-start items-start',
      )}
    >
      {label ? (
        <span
          data-chat-sender
          className="mb-1 inline-flex items-center gap-1 px-1 text-xs font-bold text-text-secondary"
        >
          {label.icon === 'shield' ? <ShieldCheck size={12} aria-hidden /> : null}
          {label.firstName}
          {label.srSuffix ? <span className="sr-only">{label.srSuffix}</span> : null}
        </span>
      ) : null}
      <div
        className={cn(
          'max-w-full whitespace-pre-wrap px-3 py-2 text-sm font-normal leading-normal [overflow-wrap:anywhere]',
          own
            ? 'rounded-2xl rounded-br-md bg-brand text-on-brand'
            : 'rounded-2xl rounded-bl-md border border-border bg-bg-secondary text-text',
          pending && 'opacity-70',
        )}
      >
        {linkify(body, { linkClassName: own ? OWN_LINK_CLASS : OTHER_LINK_CLASS })}
      </div>
      {footer ? (
        <span data-chat-time className="mt-1 px-1 text-xs font-normal text-text-tertiary">
          {footer}
        </span>
      ) : null}
    </div>
  );
}
