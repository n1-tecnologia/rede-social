import { Button, cn, linkify } from '@rede-social/ui';
import { CircleAlert, RotateCw, ShieldCheck, Trash2 } from 'lucide-react';
import { VoicePlayer, VoicePlayerGhost, type VoicePlayerLabels } from './VoicePlayer';

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
 *   finished spoken phrase. Its variants (UI-D-846, UI-D-847, UI-D-858): `ready` plays; `pending` keeps the
 *   player's geometry at `opacity-70` with a determinate progress bar and the host's progress text in the
 *   footer; `failed` loses the dimming, shows the danger line and the retry and discard buttons; `deleted`
 *   keeps place, side and time and reads the host's sentence, with no player and no media request.
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

/** What every voice bubble that has a recording to show carries. */
interface MessageBubbleVoiceShared {
  /** The stored, server-checked length in seconds (the recorder's own count only until the server answers). */
  durationSeconds: number;
  /** The finished spoken phrase naming the group, e.g. "Mensagem de voz, 42 segundos". */
  spokenLabel: string;
  player: MessageBubbleVoicePlayer;
}

/** The recording is stored and plays. `src` is the same-origin media path the host built (UI-D-857). */
export interface MessageBubbleVoiceReady extends MessageBubbleVoiceShared {
  status: 'ready';
  src: string;
}

/**
 * The recording is still going up (UI-D-846): the disc is disabled and the bar is a determinate progress
 * bar. The footer text ("Enviando… 62%") is the bubble's `pendingLabel`, which the host finishes.
 */
export interface MessageBubbleVoicePending extends MessageBubbleVoiceShared {
  status: 'pending';
  /** `percent` null until the first byte moves (an empty bar); `label` names the progress bar. */
  progress: { percent: number | null; label: string };
}

/** The send failed (UI-D-847): the bubble stays for a retry, or only for a discard when it cannot succeed. */
export interface MessageBubbleVoiceFailed extends MessageBubbleVoiceShared {
  status: 'failed';
  failure: {
    /** The host's one sentence, in danger ink under the bubble. */
    text: string;
    /** False for a permanent refusal: only "Descartar" shows. */
    retriable: boolean;
    retryLabel: string;
    discardLabel: string;
    onRetry?: () => void;
    onDiscard?: () => void;
  };
}

/** The sender's account is gone (UI-D-858): the host's sentence in muted ink, nothing to play. */
export interface MessageBubbleVoiceDeleted {
  status: 'deleted';
  text: string;
}

/** The recording a voice bubble draws (D-853). There is no file name, size or mime anywhere in it. */
export type MessageBubbleVoice =
  | MessageBubbleVoiceReady
  | MessageBubbleVoicePending
  | MessageBubbleVoiceFailed
  | MessageBubbleVoiceDeleted;

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
  // A pending voice upload is an optimistic bubble whether or not the host also set `pending`.
  const inFlight = pending || voice?.status === 'pending';
  const failed = voice?.status === 'failed' ? voice.failure : null;
  const footer = inFlight ? pendingLabel : time;

  return (
    <div
      data-chat-bubble={side}
      data-pending={inFlight || undefined}
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
      {voice?.status === 'deleted' ? (
        <div
          data-chat-voice-deleted
          className={cn(
            'max-w-full border border-border bg-bg-secondary px-3 py-2 text-sm font-normal leading-normal text-text-secondary',
            own ? 'rounded-2xl rounded-br-md' : 'rounded-2xl rounded-bl-md',
          )}
        >
          {voice.text}
        </div>
      ) : voice ? (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset brings legend and min-width quirks into a chat bubble; UI-D-855 prescribes role="group"
        <div
          role="group"
          aria-label={voice.spokenLabel}
          className={cn(
            'w-70 max-w-full px-3 py-2 text-sm font-normal leading-normal',
            own
              ? 'rounded-2xl rounded-br-md bg-brand text-on-brand'
              : 'rounded-2xl rounded-bl-md border border-border bg-bg-secondary text-text',
            inFlight && 'opacity-70',
          )}
        >
          {voice.status === 'ready' ? (
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
          ) : (
            <VoicePlayerGhost
              durationSeconds={voice.durationSeconds}
              own={own}
              labels={voice.player.labels}
              formatClock={voice.player.formatClock}
              rateLabel={voice.player.rateLabel}
              progress={voice.status === 'pending' ? voice.progress : undefined}
            />
          )}
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
      {failed ? (
        <>
          <span
            data-chat-failure
            role="alert"
            className="mt-1 inline-flex items-center gap-1 px-1 text-sm font-normal text-danger"
          >
            <CircleAlert size={14} aria-hidden />
            {failed.text}
          </span>
          <div className={cn('mt-1 flex flex-wrap gap-2', own ? 'justify-end' : 'justify-start')}>
            {failed.retriable ? (
              <Button
                variant="ghost"
                size="sm"
                hitArea
                className="text-text-secondary"
                onClick={failed.onRetry}
              >
                <RotateCw size={16} aria-hidden />
                {failed.retryLabel}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              hitArea
              className="text-text-secondary"
              onClick={failed.onDiscard}
            >
              <Trash2 size={16} aria-hidden />
              {failed.discardLabel}
            </Button>
          </div>
        </>
      ) : footer ? (
        <span data-chat-time className="mt-1 px-1 text-xs font-normal text-text-tertiary">
          {footer}
        </span>
      ) : null}
    </div>
  );
}
