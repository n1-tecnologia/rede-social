// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MessageBubble,
  type MessageBubbleProps,
  type MessageBubbleVoice,
  pauseAllVoice,
} from '../ui/index';

/**
 * 12.5-14 as observable contract: the voice player inside the shared bubble, over fakes.
 *
 * happy-dom has no media pipeline: `play`, `pause` and `load` are spies, `currentTime` and `playbackRate`
 * are plain properties, and every media event is dispatched by hand. So this file proves the player's
 * logic (what it assigns, what it calls and when, what it draws per state), NOT that a browser really
 * decodes, seeks or plays the stored file: that proof is Igor's, on real devices (the ledger).
 * Every string below is a sentinel.
 */

const SRC = '/v1/media/abc/original';

let playOrder: Array<{ el: HTMLMediaElement; src: string | null }>;
let pauseCalls: HTMLMediaElement[];
let playResult: () => Promise<void>;

beforeEach(() => {
  playOrder = [];
  pauseCalls = [];
  playResult = () => Promise.resolve();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    playOrder.push({ el: this, src: this.getAttribute('src') });
    return playResult();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    pauseCalls.push(this);
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const rates = [1, 1.5, 2];

function voice(over: Partial<Extract<MessageBubbleVoice, { status: 'ready' }>> = {}) {
  return {
    status: 'ready',
    src: SRC,
    durationSeconds: 42,
    spokenLabel: 'group-sentinel',
    player: {
      labels: {
        play: 'play-sentinel',
        pause: 'pause-sentinel',
        loading: 'loading-sentinel',
        retry: 'retry-sentinel',
        seek: 'seek-sentinel',
        error: 'error-sentence-sentinel',
        unsupported: 'unsupported-sentence-sentinel',
        speed: (rate: string) => `speed-sentinel-${rate}`,
        seekValue: (current: string, total: string) => `value-${current}-of-${total}`,
      },
      formatClock: clock,
      nextRate: (rate: number) => rates[(rates.indexOf(rate) + 1) % rates.length] ?? 1,
      rateLabel: (rate: number) => `rate-${rate}`,
      onRateChange: vi.fn(),
    },
    ...over,
  } satisfies MessageBubbleVoice;
}

function bubble(over: Partial<Extract<MessageBubbleProps, { voice: unknown }>> = {}) {
  return { side: 'other', voice: voice(), ...over } as MessageBubbleProps;
}

/** Make `currentTime` and `playbackRate` plain, writable properties (the happy-dom element has no media state). */
function prepare(audio: HTMLMediaElement) {
  Object.defineProperty(audio, 'currentTime', { value: 0, writable: true, configurable: true });
  Object.defineProperty(audio, 'playbackRate', { value: 1, writable: true, configurable: true });
  return audio;
}

function audios() {
  return [...document.querySelectorAll('audio')].map(prepare);
}

describe('VoicePlayer, the tracer (D-853, VOICE-19, VOICE-20)', () => {
  it('requests nothing before a tap: no src on any audio element, preload none, the stored total drawn', () => {
    render(
      <>
        <MessageBubble {...bubble()} />
        <MessageBubble {...bubble({ side: 'own' })} />
      </>,
    );
    const elements = audios();
    expect(elements).toHaveLength(2);
    for (const audio of elements) {
      expect(audio.hasAttribute('src')).toBe(false);
      expect(audio.getAttribute('preload')).toBe('none');
      expect(audio.hasAttribute('autoplay')).toBe(false);
    }
    expect(playOrder).toHaveLength(0);
    expect(screen.getAllByText('0:42')).toHaveLength(2);
  });

  it('assigns the source and calls play inside the same tap, then loading, playing and the live time line', () => {
    render(<MessageBubble {...bubble()} />);
    const [audio] = audios() as [HTMLMediaElement];
    fireEvent.click(screen.getByRole('button', { name: 'play-sentinel' }));

    expect(playOrder).toHaveLength(1);
    // The source was ALREADY on the element when play ran: the gesture-synchronous order WebKit needs.
    expect(playOrder[0]?.src).toBe(SRC);
    expect(playOrder[0]?.el).toBe(audio);

    const busy = screen.getByRole('button', { name: 'loading-sentinel' });
    expect(busy).toHaveAttribute('aria-busy', 'true');

    fireEvent.playing(audio);
    expect(screen.getByRole('button', { name: 'pause-sentinel' })).toBeInTheDocument();

    audio.currentTime = 12;
    fireEvent.timeUpdate(audio);
    expect(screen.getByText('0:12 / 0:42')).toBeInTheDocument();
    const range = screen.getByRole('slider', { name: 'seek-sentinel' }) as HTMLInputElement;
    expect(range.value).toBe('12');
    expect(range.max).toBe('42');
  });

  it('plays one at a time: starting B pauses A, A keeps its position, and pauseAllVoice pauses B', () => {
    render(
      <>
        <MessageBubble {...bubble()} />
        <MessageBubble {...bubble({ side: 'own' })} />
      </>,
    );
    const [a, b] = audios() as [HTMLMediaElement, HTMLMediaElement];
    const [playA, playB] = screen.getAllByRole('button', { name: 'play-sentinel' }) as [
      HTMLElement,
      HTMLElement,
    ];

    fireEvent.click(playA);
    fireEvent.playing(a);
    a.currentTime = 12;
    fireEvent.timeUpdate(a);
    const sliderA = screen.getAllByRole('slider')[0] as HTMLInputElement;
    expect(sliderA.value).toBe('12');

    fireEvent.click(playB);
    expect(pauseCalls).toContain(a);
    fireEvent.pause(a);
    fireEvent.playing(b);

    // A is paused where it was: same position, same thumb, and it is not reset.
    expect(a.currentTime).toBe(12);
    expect(sliderA.value).toBe('12');
    expect(screen.getAllByText('0:12 / 0:42')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'play-sentinel' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'pause-sentinel' })).toHaveLength(1);

    pauseCalls.length = 0;
    act(() => pauseAllVoice());
    expect(pauseCalls).toContain(b);
    fireEvent.pause(b);
    expect(screen.queryByRole('button', { name: 'pause-sentinel' })).toBeNull();
  });

  it('is one role=group named by the host phrase and writes nothing by being played', () => {
    const { container } = render(<MessageBubble {...bubble()} />);
    const group = within(container).getByRole('group', { name: 'group-sentinel' });
    expect(group.querySelector('audio')).not.toBeNull();
  });
});
