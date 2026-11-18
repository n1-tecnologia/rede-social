'use client';

import { cn } from '@rede-social/ui';
import { LoaderCircle, Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useId, useReducer, useRef, useState } from 'react';
import { playbackController } from './voice-playback-controller';

/**
 * The voice player of a bubble (D-853, D-854, UI-D-848..UI-D-851): a play disc, a native range as the bar,
 * the time line and the speed pill, in one row.
 *
 * - **Nothing loads until a tap** (VOICE-19, T-12.5-53). The bubble draws from the stored duration; the audio
 *   element has `preload="none"` and NO `src`. The first tap assigns the host-supplied same-origin path and
 *   calls `play()` in the SAME synchronous handler (WebKit wants `play()` inside the gesture; nothing is
 *   awaited first).
 * - **The bar's maximum is the stored duration**, never the element's own `duration` (a browser recording can
 *   report none or an infinite one), and nothing here asks the element what it can decode: a refusal arrives
 *   as the element's `error` event or a rejected `play()`.
 * - **One at a time** through `playbackController`: starting any player pauses every other and each keeps its
 *   position; no autoplay, no mini-player, no Media Session handler.
 * - **No receipts** (D-855): there is no callback for "played" and nothing is stored by playing.
 *
 * Props-only: every word, number, formatter and the media path arrive from the host. Under the speed pill,
 * the thumb and the fill there is NO transition: they move with the audio clock, which is progress, not
 * decoration.
 */

export interface VoicePlayerLabels {
  /** Name of the disc while it can start the message. */
  play: string;
  /** Name of the disc while the message plays. */
  pause: string;
  /** Name of the disc while it waits for sound (a tap cancels). */
  loading: string;
  /** Name of the disc in the error state (a tap fetches a fresh link). */
  retry: string;
  /** Name of the bar. */
  seek: string;
  /** The time-line sentence of the error state. */
  error: string;
  /** The time-line sentence of the unsupported state. */
  unsupported: string;
  /** Name of the speed pill for a finished rate label, e.g. "Velocidade de reprodução: 1,5x". */
  speed: (rate: string) => string;
  /** `aria-valuetext` of the bar, e.g. "0:12 de 0:42". */
  seekValue: (current: string, total: string) => string;
}

export interface VoicePlayerProps {
  /** The same-origin media path the host built; assigned to the element on the first tap and never before. */
  src: string;
  /** The stored, server-checked length in seconds: draws the bubble and bounds the bar. */
  durationSeconds: number;
  /** The bubble's side: `own` sits on the brand fill, `other` on the neutral surface. */
  own: boolean;
  labels: VoicePlayerLabels;
  /** `m:ss` for a number of seconds. */
  formatClock: (seconds: number) => string;
  /** The speed after `rate` (1, 1.5, 2 and back to 1). */
  nextRate: (rate: number) => number;
  /** The finished label of a speed, "1,5x". */
  rateLabel: (rate: number) => string;
  /** Called with the new speed label after each tap on the pill; the thread's polite region speaks it. */
  onRateChange?: (label: string) => void;
  /** Disables every control (a host that cannot play right now). */
  disabled?: boolean;
}

type Phase = 'idle' | 'loading' | 'playing' | 'paused';

interface PlayerState {
  phase: Phase;
  /** Seconds, the element's clock (or the remembered position of an idle seek). */
  position: number;
}

type PlayerEvent =
  | { type: 'loading' }
  | { type: 'playing' }
  | { type: 'paused' }
  | { type: 'cancel' }
  | { type: 'ended' }
  | { type: 'time'; seconds: number };

const INITIAL: PlayerState = { phase: 'idle', position: 0 };

function reducer(state: PlayerState, event: PlayerEvent): PlayerState {
  switch (event.type) {
    case 'loading':
      return state.phase === 'idle' || state.phase === 'paused'
        ? { ...state, phase: 'loading' }
        : state;
    case 'playing':
      // A late `playing` after a cancel (phase idle) changes nothing.
      return state.phase === 'loading' || state.phase === 'paused' || state.phase === 'playing'
        ? { ...state, phase: 'playing' }
        : state;
    case 'paused':
      return state.phase === 'playing' ? { ...state, phase: 'paused' } : state;
    case 'cancel':
      return state.phase === 'loading' ? { ...state, phase: 'idle' } : state;
    case 'ended':
      return { phase: 'idle', position: 0 };
    case 'time':
      return state.phase === 'idle' ? state : { ...state, position: event.seconds };
  }
}

const LOADING_TIMEOUT_MS = 15_000;

export function VoicePlayer({
  src,
  durationSeconds,
  own,
  labels,
  formatClock,
  nextRate,
  rateLabel,
  onRateChange,
  disabled = false,
}: VoicePlayerProps) {
  const id = useId();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const [rate, setRate] = useState(1);
  const phaseRef = useRef<Phase>('idle');
  const rateRef = useRef(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  phaseRef.current = state.phase;
  rateRef.current = rate;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  /** Leave the loading state without sound: pause the element and forget the attempt. */
  const cancel = useCallback(() => {
    attemptRef.current += 1;
    clearTimer();
    audioRef.current?.pause();
    dispatch({ type: 'cancel' });
  }, [clearTimer]);

  // The controller's way to quiet this player: a playing one pauses (and keeps its place), a loading one
  // goes back to idle, anything else has nothing to do.
  useEffect(() => {
    const release = playbackController.register(id, () => {
      if (phaseRef.current === 'loading') cancel();
      else if (phaseRef.current === 'playing') audioRef.current?.pause();
    });
    return () => {
      release();
      clearTimer();
      audioRef.current?.pause();
    };
  }, [id, cancel, clearTimer]);

  function start() {
    const audio = audioRef.current;
    if (!audio) return;
    playbackController.activate(id);
    // The first tap hands the element its source, and `play()` follows in the SAME synchronous handler.
    if (!audio.hasAttribute('src')) audio.src = src;
    audio.defaultPlaybackRate = rateRef.current;
    audio.playbackRate = rateRef.current;
    attemptRef.current += 1;
    const promise = audio.play() as Promise<void> | undefined;
    dispatch({ type: 'loading' });
    clearTimer();
    timerRef.current = setTimeout(() => cancel(), LOADING_TIMEOUT_MS);
    promise?.catch(() => {});
  }

  function onDisc() {
    const audio = audioRef.current;
    if (!audio || disabled) return;
    if (state.phase === 'loading') cancel();
    else if (state.phase === 'playing') audio.pause();
    else start();
  }

  const total = Math.max(0, Math.round(durationSeconds));
  const shown = Math.min(Math.max(Math.floor(state.position), 0), total);
  const ratio = total > 0 ? shown / total : 0;
  const started = state.phase !== 'idle' || state.position > 0;
  const timeLine = started ? `${formatClock(shown)} / ${formatClock(total)}` : formatClock(total);
  const loading = state.phase === 'loading';
  const playing = state.phase === 'playing';

  const discName = loading ? labels.loading : playing ? labels.pause : labels.play;
  const rateText = rateLabel(rate);

  return (
    <div className="flex items-center gap-2">
      {/* A voice message has no transcript by decision (D-855), so there is no caption track to offer. */}
      {/* biome-ignore lint/a11y/useMediaCaption: no transcript exists for a voice message (D-855, UI-D-857) */}
      <audio
        ref={audioRef}
        preload="none"
        onPlaying={() => {
          clearTimer();
          dispatch({ type: 'playing' });
        }}
        onPause={() => dispatch({ type: 'paused' })}
        onEnded={() => {
          clearTimer();
          const audio = audioRef.current;
          if (audio) audio.currentTime = 0;
          dispatch({ type: 'ended' });
        }}
        onTimeUpdate={(event) =>
          dispatch({ type: 'time', seconds: event.currentTarget.currentTime })
        }
      />
      <button
        type="button"
        aria-label={discName}
        aria-busy={loading || undefined}
        disabled={disabled}
        onClick={onDisc}
        className={cn(
          'relative grid h-10 w-10 shrink-0 place-items-center rounded-full after:absolute after:-inset-0.5',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
          own
            ? 'bg-on-brand text-brand focus-visible:ring-on-brand focus-visible:ring-offset-brand'
            : 'bg-button bg-(image:--button-image) text-on-button focus-visible:ring-brand focus-visible:ring-offset-bg-secondary',
        )}
      >
        {loading ? (
          <>
            <LoaderCircle
              size={20}
              aria-hidden
              className="hidden motion-safe:block motion-safe:animate-spin"
            />
            <Play size={20} aria-hidden className="fill-current opacity-50 motion-safe:hidden" />
          </>
        ) : playing ? (
          <Pause size={20} aria-hidden className="fill-current" />
        ) : (
          <Play size={20} aria-hidden className="fill-current" />
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="relative h-4">
          <input
            type="range"
            min={0}
            max={total}
            step={1}
            value={shown}
            aria-label={labels.seek}
            aria-valuetext={labels.seekValue(formatClock(shown), formatClock(total))}
            disabled={disabled || loading}
            onChange={() => {}}
            className="peer absolute inset-x-0 top-1/2 z-10 m-0 h-11 w-full -translate-y-1/2 cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-default"
          />
          <div
            aria-hidden
            className={cn(
              'absolute inset-x-0 top-1/2 -mt-0.5 h-1 overflow-hidden rounded-full',
              own ? 'bg-on-brand/30' : 'bg-bg-tertiary',
              (disabled || loading) && 'opacity-50',
            )}
          >
            <div
              className={cn('h-full rounded-full', own ? 'bg-on-brand' : 'bg-text')}
              style={{ width: `calc(8px + ${ratio} * (100% - 16px))` }}
            />
          </div>
          <div
            aria-hidden
            className={cn(
              'absolute top-0 h-4 w-4 rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2',
              own
                ? 'bg-on-brand peer-focus-visible:ring-on-brand peer-focus-visible:ring-offset-brand'
                : 'bg-text peer-focus-visible:ring-brand peer-focus-visible:ring-offset-bg-secondary',
              (disabled || loading) && 'opacity-50',
            )}
            style={{ left: `calc(${ratio} * (100% - 16px))` }}
          />
        </div>
        <span
          className={cn(
            'min-w-0 truncate text-sm font-normal leading-5 tabular-nums',
            own ? 'text-on-brand' : 'text-text-secondary',
          )}
        >
          {timeLine}
        </span>
      </div>
      <button
        type="button"
        aria-label={labels.speed(rateText)}
        disabled={disabled || loading}
        onClick={() => {
          const next = nextRate(rate);
          setRate(next);
          const audio = audioRef.current;
          if (audio) {
            audio.defaultPlaybackRate = next;
            audio.playbackRate = next;
          }
          onRateChange?.(rateLabel(next));
        }}
        className={cn(
          'relative grid h-8 w-10 shrink-0 place-items-center rounded-full text-sm font-bold leading-none tabular-nums whitespace-nowrap after:absolute after:-inset-x-0.5 after:-inset-y-1.5',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
          own
            ? 'bg-on-brand/20 text-on-brand focus-visible:ring-on-brand focus-visible:ring-offset-brand'
            : 'bg-bg-tertiary text-text-secondary focus-visible:ring-brand focus-visible:ring-offset-bg-secondary',
        )}
      >
        {rateText}
      </button>
    </div>
  );
}
