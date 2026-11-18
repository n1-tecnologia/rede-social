import { cn, linkify } from '@rede-social/ui';
import { ShieldCheck } from 'lucide-react';
import { VoicePlayer, type VoicePlayerLabels } from './VoicePlayer';

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
 * - **A voice message** (Phase 12.5, D-846): the bubble has a SECOND branch beside `body`, `voice`, and the
 *   props are a type union so a bubble has either one and never both. The voice bubble is the same shell
 *   (radii, fills, `px-3 py-2`, sender label above, time under) at a fixed `w-70` capped by `max-w-[85%]`,
 *   carries no text (no `linkify`, no `whitespace-pre-wrap`) and is ONE `role="group"` named by the host's
 *   finished spoken phrase.
 *
 * Props-only: this component ships no words.
 */

export interface MessageBubbleLabel {
  firstName: string;
  /** Screen-reader suffix, e.g. ", da equipe". Empty for none. */
  srSuffix: string;
  icon: 'shield' | null;
}

/** The player's host-supplied kit: finished labels, the clock formatter and the speed functions. */
export interface MessageBubbleVoicePlayer {
  labels: VoicePlayerLabels;
  /** `m:ss` for a number of seconds. */
  formatClock: (seconds: number) => string;
  nextRate: (rate: number) => number;
  rateLabel: (rate: number) => string;
  onRateChange?: (label: string) => void;
}

/**
 * The recording a voice bubble draws (D-853). `src` is the same-origin media path the host built; there is
 * no file name, URL display, size or mime anywhere in it (UI-D-857).
 */
export interface MessageBubbleVoice {
  status: 'ready';
  src: string;
  /** The stored, server-checked length in seconds. */
  durationSeconds: number;
  /** The finished spoken phrase naming the group, e.g. "Mensagem de voz, 42 segundos". */
  spokenLabel: string;
  player: MessageBubbleVoicePlayer;
}

interface MessageBubbleBase {
  side: 'own' | 'other';
  label?: MessageBubbleLabel | null;
  /** `HH:mm`, already formatted in the tenant zone; omitted inside a run. */
  time?: string | null;
  /** An optimistic bubble: shows `pendingLabel` in the time slot. */
  pending?: boolean;
  pendingLabel?: string;
}

/** A text bubble. */
export interface MessageBubbleTextProps extends MessageBubbleBase {
  body: string;
  voice?: never;
}

/** A voice bubble. */
export interface MessageBubbleVoiceProps extends MessageBubbleBase {
  voice: MessageBubbleVoice;
  body?: never;
}

/** A bubble has either `body` or `voice`, never both (D-846). */
export type MessageBubbleProps = MessageBubbleTextProps | MessageBubbleVoiceProps;

const OWN_LINK_CLASS = 'underline text-on-brand';
const OTHER_LINK_CLASS = 'text-brand underline-offset-2 hover:underline';

export function MessageBubble({
  side,
  body,
  voice,
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
      {voice ? (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset brings legend and min-width quirks into a chat bubble; UI-D-855 prescribes role="group"
        <div
          role="group"
          aria-label={voice.spokenLabel}
          className={cn(
            'w-70 max-w-full px-3 py-2 text-sm font-normal leading-normal',
            own
              ? 'rounded-2xl rounded-br-md bg-brand text-on-brand'
              : 'rounded-2xl rounded-bl-md border border-border bg-bg-secondary text-text',
            pending && 'opacity-70',
          )}
        >
          <VoicePlayer
            src={voice.src}
            durationSeconds={voice.durationSeconds}
            own={own}
            labels={voice.player.labels}
            formatClock={voice.player.formatClock}
            nextRate={voice.player.nextRate}
            rateLabel={voice.player.rateLabel}
            onRateChange={voice.player.onRateChange}
          />
        </div>
      ) : (
        <div
          className={cn(
            'max-w-full whitespace-pre-wrap px-3 py-2 text-sm font-normal leading-normal [overflow-wrap:anywhere]',
            own
              ? 'rounded-2xl rounded-br-md bg-brand text-on-brand'
              : 'rounded-2xl rounded-bl-md border border-border bg-bg-secondary text-text',
            pending && 'opacity-70',
          )}
        >
          {linkify(body ?? '', { linkClassName: own ? OWN_LINK_CLASS : OTHER_LINK_CLASS })}
        </div>
      )}
      {footer ? (
        <span data-chat-time className="mt-1 px-1 text-xs font-normal text-text-tertiary">
          {footer}
        </span>
      ) : null}
    </div>
  );
}
