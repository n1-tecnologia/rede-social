'use client';

import { cn, Textarea } from '@rede-social/ui';
import { Info, LoaderCircle, Mic, MicOff, Send, Trash2 } from 'lucide-react';
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  useVoiceRecorder,
  type VoiceProblem,
  type VoiceRecorderEvent,
  type VoiceTake,
} from './useVoiceRecorder';

/**
 * The thread composer (UI-D-260): the prototype's reply bar with the V2 extras removed (sketch 007
 * delta b). One field and one send button, nothing else.
 *
 * - **The field is 16px** (`text-base`), the iOS zoom guard, in the shipped `Textarea` look. It starts
 *   at one row and grows with its content up to 120px (five 24px lines), then scrolls inside, so a long
 *   draft never pushes the thread off a phone screen with the keyboard up.
 * - **`maxLength` 2000** (D-225) is native, and a counter appears from 1,800 characters, turning
 *   danger at the cap. It counts what the field counts (UTF-16 units), which is never more than the
 *   code points the API counts, so a draft the counter accepts is never refused for length.
 * - **Keys:** on a fine pointer, Enter sends and Shift+Enter adds a line; on touch, Enter adds a line
 *   and only the button sends (a phone keyboard's return key is for new lines). The pointer is asked
 *   at key time, so nothing about the device is read during render.
 * - **Send:** the trimmed draft is handed to `onSend` and the field is cleared at once, so the host
 *   can show its optimistic bubble. A `false` answer (or a rejection) puts the draft BACK in the field
 *   and shows the inline error, which the next keystroke clears (the shipped `CommentInput` rule): a
 *   network blip never costs the member what they wrote. Focus stays in the field.
 *
 * - **Voice (12.5-13, opt-in):** a host that passes the `voice` bundle gets the shared microphone slot: ONE
 *   button owns the send slot and is the microphone while the field is empty after `trim()`, the usual send
 *   while it has text, and the recording's send while a voice message is being recorded (the same element, so
 *   focus is kept). A host that passes no bundle gets exactly the composer above.
 *
 * Props-only: this component ships no words.
 */

/**
 * The finished strings and the hand-off of the voice recorder (UI-D-856): every word, every `m:ss` and every
 * spoken sentence arrives here from the host's catalog, never from this package.
 */
export interface ChatComposerVoice {
  /** Name of the microphone, e.g. "Gravar mensagem de voz". */
  micLabel: string;
  /** Name of the slot while the permission prompt is open. */
  micRequestingLabel: string;
  /** The live word in the pill, e.g. "Gravando". */
  recordingLabel: string;
  /** Name of the elapsed counter. */
  timerLabel: string;
  /** Name of the trash button. */
  discardLabel: string;
  /** Name of the recording's send button (the host picks the opener's longer name when the opener shows). */
  sendLabel: string;
  /** The pill's word after the 5:00 stop. */
  limitWord: string;
  /** The pill's word after an interruption. */
  interruptedWord: string;
  notices: { warning: string; limit: string; interrupted: string; tooShort: string };
  problems: { blocked: string; missing: string; busy: string; failed: string };
  /** What the polite status region speaks. */
  live: { started: string; minute: (count: number) => string; discarded: string };
  /** Builds `m:ss` from whole seconds. */
  formatClock: (seconds: number) => string;
  /**
   * Hands the host the finished take. The composer is idle the moment the tap lands, so the answer is not
   * awaited for state: the host owns the optimistic bubble, the retry and every refusal (UI-D-846, UI-D-847).
   */
  onSendVoice: (take: VoiceTake) => Promise<boolean>;
  /** Called when a recording starts so every playing voice message pauses (A-UI-9). */
  onRecordingStart?: () => void;
  /** Defaults: 300, 1 and 270 seconds. */
  maxSeconds?: number;
  minSeconds?: number;
  warnAtSeconds?: number;
}

export interface ChatComposerProps {
  /** Field id (label, counter and error agree on it). */
  id?: string;
  /** Accessible name of the field, e.g. "Mensagem". */
  label: string;
  placeholder: string;
  /** Accessible name of the send button, e.g. "Enviar mensagem". */
  sendLabel: string;
  /** Builds the counter text from the current length, e.g. `1.900/2.000`. */
  counterTemplate: (count: number) => string;
  /** The inline error shown after a refused send. */
  errorText: string;
  /** The whole composer is inert (loading skeleton, unavailable thread). */
  disabled?: boolean;
  /**
   * Resolves `true` when the message was accepted and `false` when it was not; the composer then
   * restores the draft. A rejection is treated as `false`.
   */
  onSend: (body: string) => Promise<boolean>;
  /** Opt-in voice messages (12.5-13). Absent: the composer is the text composer it always was. */
  voice?: ChatComposerVoice;
}

export const CHAT_COMPOSER_MAX_LENGTH = 2000;
export const CHAT_COMPOSER_COUNTER_FROM = 1800;

function finePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches === true;
}

/** The sentence a problem earns: four microphone sentences plus the too-short discard (UI-D-842, UI-D-845). */
function problemSentence(voice: ChatComposerVoice, problem: VoiceProblem): string {
  return problem === 'tooShort' ? voice.notices.tooShort : voice.problems[problem];
}

/** What the polite status region says for each recorder event (UI-D-855, A-UI-17). */
function spokenSentence(voice: ChatComposerVoice, event: VoiceRecorderEvent): string {
  switch (event.type) {
    case 'started':
      return voice.live.started;
    case 'minute':
      return voice.live.minute(event.count);
    case 'warning':
      return voice.notices.warning;
    case 'limit':
      return voice.notices.limit;
    case 'interrupted':
      return voice.notices.interrupted;
    case 'discarded':
      return voice.live.discarded;
    case 'problem':
      return problemSentence(voice, event.problem);
  }
}

export function ChatComposer({
  id = 'chat-composer-field',
  label,
  placeholder,
  sendLabel,
  counterTemplate,
  errorText,
  disabled = false,
  onSend,
  voice,
}: ChatComposerProps) {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const slotRef = useRef<HTMLButtonElement>(null);
  const voiceOn = voice !== undefined;
  // The polite status region: one persistent node, its content replaced (and re-keyed so an identical sentence
  // is spoken again). Visible notice lines carry no live role of their own.
  const [live, setLive] = useState({ count: 0, text: '' });
  const recorder = useVoiceRecorder({
    active: voiceOn && !disabled,
    maxSeconds: voice?.maxSeconds,
    minSeconds: voice?.minSeconds,
    warnAtSeconds: voice?.warnAtSeconds,
    onRecordingStart: voice?.onRecordingStart,
    onEvent: (event) => {
      if (voice)
        setLive((before) => ({ count: before.count + 1, text: spokenSentence(voice, event) }));
    },
  });
  const phase = recorder.state.phase;

  // After any ending (send, trash, a refusal, too short) focus lands on the microphone (UI-D-843). The
  // button is the same element all along, so this only matters when it had lost focus.
  const previousPhase = useRef(phase);
  useEffect(() => {
    const before = previousPhase.current;
    previousPhase.current = phase;
    if (before !== 'idle' && phase === 'idle') slotRef.current?.focus();
  }, [phase]);

  // Auto-grow: measure from `auto` so the field also shrinks when lines are deleted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the measurement must rerun when the text changes.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 120)}px`;
  }, [value]);

  const trimmed = value.trim();
  const { problem, stopReason, warned } = recorder.state;
  const noticeText = !voice
    ? null
    : problem
      ? problemSentence(voice, problem)
      : phase === 'stopped'
        ? stopReason === 'limit'
          ? voice.notices.limit
          : voice.notices.interrupted
        : phase === 'recording' && warned
          ? voice.notices.warning
          : null;
  const recording = voiceOn && (phase === 'recording' || phase === 'stopped');
  const requesting = voiceOn && phase === 'requesting';
  const slotMode: 'mic' | 'recording' | 'text' = recording
    ? 'recording'
    : voiceOn && recorder.supported && trimmed === ''
      ? 'mic'
      : 'text';
  const canSend = !disabled && !pending && trimmed.length > 0;
  const length = value.length;
  const showCounter = length >= CHAT_COMPOSER_COUNTER_FROM;
  const atCap = length >= CHAT_COMPOSER_MAX_LENGTH;

  const send = async () => {
    if (!canSend) return;
    const draft = value;
    setValue('');
    setFailed(false);
    setPending(true);
    fieldRef.current?.focus();
    let accepted = false;
    try {
      accepted = await onSend(trimmed);
    } catch {
      accepted = false;
    }
    setPending(false);
    if (!accepted) {
      // The field stays editable while the send is in flight: put the failed draft back IN FRONT of
      // whatever was typed meanwhile, never over it (07 review B-WR-05).
      setValue((current) => (current.trim() === '' ? draft : `${draft}\n${current}`));
      setFailed(true);
    }
    fieldRef.current?.focus();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  const sendVoice = async () => {
    const take = await recorder.send();
    if (take && voice) {
      // The composer is already idle: the host owns the bubble and every refusal, so a rejection is its own.
      void Promise.resolve(voice.onSendVoice(take)).catch(() => {});
    }
  };

  const onSlotClick = () => {
    if (slotMode === 'mic') void recorder.start();
    else if (slotMode === 'recording') void sendVoice();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    if (!finePointer()) return;
    event.preventDefault();
    void send();
  };

  return (
    <div data-chat-composer className="border-t border-border bg-bg-secondary px-4 py-2">
      {failed ? (
        <p data-chat-send-error role="alert" className="pb-2 text-sm font-normal text-danger">
          {errorText}
        </p>
      ) : null}
      {showCounter ? (
        <p
          data-chat-counter
          aria-live="off"
          className={cn(
            'pb-1 text-right text-xs font-normal tabular-nums',
            atCap ? 'text-danger' : 'text-text-tertiary',
          )}
        >
          {counterTemplate(length)}
        </p>
      ) : null}
      {noticeText && voice ? (
        <p
          data-chat-voice-notice
          className="flex items-start gap-2 pb-2 text-sm font-normal text-text-secondary"
        >
          {problem && problem !== 'tooShort' ? (
            <MicOff size={16} aria-hidden className="mt-0.5 shrink-0 text-text-tertiary" />
          ) : (
            <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-text-tertiary" />
          )}
          <span className="min-w-0">{noticeText}</span>
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        {recording && voice ? (
          <button
            type="button"
            data-chat-voice-discard
            aria-label={voice.discardLabel}
            onClick={recorder.discard}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-bg-secondary text-text-secondary transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <Trash2 size={20} aria-hidden />
          </button>
        ) : null}
        <Textarea
          ref={fieldRef}
          id={id}
          rows={1}
          value={value}
          disabled={disabled}
          hidden={recording}
          maxLength={CHAT_COMPOSER_MAX_LENGTH}
          aria-label={label}
          placeholder={placeholder}
          onChange={(event) => {
            setValue(event.target.value);
            if (failed) setFailed(false);
            if (problem) recorder.clearProblem();
          }}
          onKeyDown={onKeyDown}
          containerClassName={cn('min-w-0 flex-1 gap-0', recording && 'hidden')}
          className="max-h-30 overflow-y-auto rounded-2xl px-4 py-2"
        />
        {recording && voice ? (
          <div
            data-chat-voice-pill
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-border bg-bg-secondary px-4"
          >
            {phase === 'recording' ? (
              <span
                data-chat-voice-dot
                aria-hidden
                className="size-2 shrink-0 rounded-full bg-danger motion-safe:animate-pulse"
              />
            ) : null}
            <span className="truncate text-sm font-normal text-text-secondary">
              {phase === 'recording'
                ? voice.recordingLabel
                : recorder.state.stopReason === 'limit'
                  ? voice.limitWord
                  : voice.interruptedWord}
            </span>
            <span
              role="timer"
              aria-live="off"
              aria-label={voice.timerLabel}
              className="ml-auto shrink-0 text-sm font-bold tabular-nums text-text"
            >
              {voice.formatClock(recorder.state.elapsedSeconds)}
            </span>
          </div>
        ) : null}
        <button
          ref={slotRef}
          type={slotMode === 'text' ? 'submit' : 'button'}
          data-chat-send
          data-chat-voice-slot={voiceOn ? slotMode : undefined}
          aria-label={
            voice && slotMode === 'mic'
              ? requesting
                ? voice.micRequestingLabel
                : voice.micLabel
              : voice && slotMode === 'recording'
                ? voice.sendLabel
                : sendLabel
          }
          aria-busy={requesting || undefined}
          disabled={slotMode === 'text' ? !canSend : slotMode === 'mic' ? disabled : false}
          onClick={slotMode === 'text' ? undefined : onSlotClick}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-button bg-(image:--button-image) text-on-button transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50"
        >
          {slotMode === 'mic' ? (
            requesting ? (
              <>
                <LoaderCircle
                  size={20}
                  aria-hidden
                  className="hidden motion-safe:block motion-safe:animate-spin"
                />
                <Mic size={20} aria-hidden className="opacity-50 motion-safe:hidden" />
              </>
            ) : (
              <Mic size={20} aria-hidden />
            )
          ) : (
            <Send size={20} aria-hidden />
          )}
        </button>
      </form>
      {voice ? (
        <div data-chat-voice-status role="status" aria-live="polite" className="sr-only">
          <span key={live.count}>{live.text}</span>
        </div>
      ) : null}
    </div>
  );
}
