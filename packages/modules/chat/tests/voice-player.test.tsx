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

/** One mounted bubble, its element prepared, with the handles every state test needs. */
function mount(over: Partial<Extract<MessageBubbleProps, { voice: unknown }>> = {}) {
  const view = render(<MessageBubble {...bubble(over)} />);
  const audio = audios()[0] as HTMLMediaElement;
  return {
    ...view,
    audio,
    disc: (name: string) => screen.getByRole('button', { name }),
    range: () => screen.getByRole('slider') as HTMLInputElement,
    speed: () => screen.getByRole('button', { name: /^speed-sentinel/ }),
    /** Tap play and let the sound arrive. */
    startPlaying() {
      fireEvent.click(screen.getByRole('button', { name: 'play-sentinel' }));
      fireEvent.playing(audio);
    },
    at(seconds: number) {
      audio.currentTime = seconds;
      fireEvent.timeUpdate(audio);
    },
    fail(code: number | undefined) {
      Object.defineProperty(audio, 'error', {
        value: code === undefined ? null : { code },
        configurable: true,
      });
      fireEvent.error(audio);
    },
  };
}

describe('VoicePlayer, loading, ended and the one-at-a-time rule (UI-D-849, VOICE-21)', () => {
  it('cancels a loading tap back to idle and ignores a late playing', () => {
    const m = mount();
    fireEvent.click(m.disc('play-sentinel'));
    expect(m.disc('loading-sentinel')).toHaveAttribute('aria-busy', 'true');
    expect(m.range()).toBeDisabled();
    pauseCalls.length = 0;
    fireEvent.click(m.disc('loading-sentinel'));
    expect(pauseCalls).toContain(m.audio);
    expect(m.disc('play-sentinel')).not.toHaveAttribute('aria-busy');
    fireEvent.playing(m.audio);
    expect(screen.queryByRole('button', { name: 'pause-sentinel' })).toBeNull();
    expect(m.disc('play-sentinel')).toBeInTheDocument();
  });

  it('turns 15 seconds without sound into the error state', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const m = mount();
      fireEvent.click(m.disc('play-sentinel'));
      act(() => {
        vi.advanceTimersByTime(14_000);
      });
      expect(m.disc('loading-sentinel')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1_500);
      });
      expect(m.disc('retry-sentinel')).toBeInTheDocument();
      expect(screen.getByText('error-sentence-sentinel')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not run the timeout once sound arrives', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const m = mount();
      fireEvent.click(m.disc('play-sentinel'));
      fireEvent.playing(m.audio);
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(m.disc('pause-sentinel')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns to idle visuals when a message ends, resets the clock and starts nothing else', () => {
    render(
      <>
        <MessageBubble {...bubble()} />
        <MessageBubble {...bubble({ side: 'own' })} />
      </>,
    );
    const [a, b] = audios() as [HTMLMediaElement, HTMLMediaElement];
    fireEvent.click(screen.getAllByRole('button', { name: 'play-sentinel' })[0] as HTMLElement);
    fireEvent.playing(a);
    a.currentTime = 42;
    fireEvent.timeUpdate(a);
    expect(screen.getByText('0:42 / 0:42')).toBeInTheDocument();
    const playsBefore = playOrder.length;
    fireEvent.ended(a);
    expect(a.currentTime).toBe(0);
    expect(playOrder).toHaveLength(playsBefore);
    expect(b.hasAttribute('src')).toBe(false);
    expect(screen.getAllByRole('button', { name: 'play-sentinel' })).toHaveLength(2);
    expect(screen.getAllByText('0:42')).toHaveLength(2);
    expect((screen.getAllByRole('slider')[0] as HTMLInputElement).value).toBe('0');
  });

  it('treats a rejected play as the error state, but an interrupted one (AbortError) as nothing', async () => {
    const aborted = mount();
    playResult = () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await act(async () => {
      fireEvent.click(aborted.disc('play-sentinel'));
    });
    expect(aborted.disc('loading-sentinel')).toBeInTheDocument();
    cleanup();

    const refused = mount();
    playResult = () =>
      Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    await act(async () => {
      fireEvent.click(refused.disc('play-sentinel'));
    });
    expect(refused.disc('retry-sentinel')).toBeInTheDocument();
  });
});

describe('VoicePlayer, error and unsupported (UI-D-849, V21, V22)', () => {
  it.each([2, 3])('shows the error state for MediaError code %i and keeps the thumb', (code) => {
    const m = mount();
    m.startPlaying();
    m.at(12);
    m.fail(code);
    expect(m.disc('retry-sentinel').querySelector('svg')).not.toBeNull();
    expect(screen.getByText('error-sentence-sentinel')).toBeInTheDocument();
    expect(screen.queryByText('0:12 / 0:42')).toBeNull();
    expect(m.range().value).toBe('12');
    expect(m.range()).toBeDisabled();
    expect(m.speed()).toBeDisabled();
  });

  it('retries with a fresh link (a cache-buster on the same path) and resumes from the same position', () => {
    const m = mount();
    m.startPlaying();
    m.at(12);
    m.fail(2);
    expect(m.audio.getAttribute('src')).toBe(SRC);
    fireEvent.click(m.disc('retry-sentinel'));
    const fresh = m.audio.getAttribute('src') ?? '';
    expect(fresh).not.toBe(SRC);
    expect(fresh.startsWith(`${SRC}?`)).toBe(true);
    expect(playOrder.at(-1)?.src).toBe(fresh);
    // The position is applied on loadedmetadata, as the new file's clock starts at zero.
    m.audio.currentTime = 0;
    fireEvent.loadedMetadata(m.audio);
    expect(m.audio.currentTime).toBe(12);
    fireEvent.playing(m.audio);
    expect(m.disc('pause-sentinel')).toBeInTheDocument();
    // A second failure and retry changes the URL again.
    m.fail(3);
    fireEvent.click(m.disc('retry-sentinel'));
    expect(m.audio.getAttribute('src')).not.toBe(fresh);
  });

  it('shows an inert unsupported state for MediaError code 4', () => {
    const m = mount();
    fireEvent.click(m.disc('play-sentinel'));
    m.fail(4);
    expect(screen.getByText('unsupported-sentence-sentinel')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /play-sentinel|retry-sentinel|loading-sentinel/ }),
    ).toBeNull();
    expect(m.range()).toBeDisabled();
    expect(m.speed()).toBeDisabled();
    const playsBefore = playOrder.length;
    fireEvent.click(m.speed());
    expect(playOrder).toHaveLength(playsBefore);
  });
});

describe('VoicePlayer, a refused link after a good play (T-12.5-57)', () => {
  it('reads a code 4 after the file already played as the link, which a tap can fix', () => {
    const m = mount();
    m.startPlaying();
    m.at(12);
    m.fail(4);
    expect(m.disc('retry-sentinel')).toBeInTheDocument();
    expect(screen.getByText('error-sentence-sentinel')).toBeInTheDocument();
    expect(screen.queryByText('unsupported-sentence-sentinel')).toBeNull();
  });
});

describe('VoicePlayer, seeking and the keyboard (D-853, UI-D-849, V23)', () => {
  it('remembers a seek made while idle and applies it when the file loads', () => {
    const m = mount();
    fireEvent.change(m.range(), { target: { value: '20' } });
    expect(screen.getByText('0:20 / 0:42')).toBeInTheDocument();
    expect(m.audio.hasAttribute('src')).toBe(false);
    expect(m.audio.currentTime).toBe(0);
    fireEvent.click(m.disc('play-sentinel'));
    expect(m.audio.getAttribute('src')).toBe(SRC);
    fireEvent.loadedMetadata(m.audio);
    expect(m.audio.currentTime).toBe(20);
  });

  it('updates the time line live while dragging, keeps playing and commits on release', () => {
    const m = mount();
    m.startPlaying();
    m.at(12);
    fireEvent.pointerDown(m.range());
    fireEvent.change(m.range(), { target: { value: '30' } });
    expect(screen.getByText('0:30 / 0:42')).toBeInTheDocument();
    expect(m.audio.currentTime).toBe(12);
    expect(m.disc('pause-sentinel')).toBeInTheDocument();
    // A clock tick during the drag does not fight the thumb.
    m.at(13);
    expect(screen.getByText('0:30 / 0:42')).toBeInTheDocument();
    fireEvent.pointerUp(m.range());
    expect(m.audio.currentTime).toBe(30);
    expect(m.disc('pause-sentinel')).toBeInTheDocument();
    expect(screen.getByText('0:30 / 0:42')).toBeInTheDocument();
  });

  it('moves 5 seconds on the arrows, 15 on the page keys, to the ends on Home and End, clamped', () => {
    const m = mount();
    m.startPlaying();
    m.at(12);
    const press = (key: string) => fireEvent.keyDown(m.range(), { key });
    press('ArrowRight');
    expect(m.audio.currentTime).toBe(17);
    press('ArrowLeft');
    expect(m.audio.currentTime).toBe(12);
    press('PageUp');
    expect(m.audio.currentTime).toBe(27);
    press('PageDown');
    expect(m.audio.currentTime).toBe(12);
    press('End');
    expect(m.audio.currentTime).toBe(42);
    press('ArrowRight');
    expect(m.audio.currentTime).toBe(42);
    press('Home');
    expect(m.audio.currentTime).toBe(0);
    press('ArrowLeft');
    expect(m.audio.currentTime).toBe(0);
  });

  it('bounds the bar by the stored duration even when the element reports an infinite one', () => {
    const m = mount();
    m.startPlaying();
    Object.defineProperty(m.audio, 'duration', { value: Infinity, configurable: true });
    fireEvent.durationChange(m.audio);
    fireEvent.loadedMetadata(m.audio);
    expect(m.range().max).toBe('42');
    fireEvent.keyDown(m.range(), { key: 'End' });
    expect(m.audio.currentTime).toBe(42);
  });

  it('names the range and gives it the host aria-valuetext', () => {
    const m = mount();
    m.startPlaying();
    m.at(12);
    expect(m.range()).toHaveAccessibleName('seek-sentinel');
    expect(m.range()).toHaveAttribute('aria-valuetext', 'value-0:12-of-0:42');
  });

  it('keeps the disc a native button, so Space and Enter play and pause', () => {
    const m = mount();
    const disc = m.disc('play-sentinel');
    expect(disc.tagName).toBe('BUTTON');
    expect(disc).toHaveAttribute('type', 'button');
    fireEvent.click(disc);
    fireEvent.playing(m.audio);
    fireEvent.click(m.disc('pause-sentinel'));
    expect(pauseCalls).toContain(m.audio);
    fireEvent.pause(m.audio);
    expect(m.disc('play-sentinel')).toBeInTheDocument();
  });
});

describe('VoicePlayer, the speed pill (D-854, V27)', () => {
  it('cycles 1x, 1,5x, 2x per player, applies at once, reports the label and names itself by the value', () => {
    const onRateChange = vi.fn();
    const m = mount({ voice: voice({ player: { ...voice().player, onRateChange } }) });
    expect(m.speed()).toHaveAccessibleName('speed-sentinel-rate-1');
    fireEvent.click(m.speed());
    expect(m.speed()).toHaveAccessibleName('speed-sentinel-rate-1.5');
    expect(m.audio.playbackRate).toBe(1.5);
    expect(onRateChange).toHaveBeenLastCalledWith('rate-1.5');
    fireEvent.click(m.speed());
    expect(m.audio.playbackRate).toBe(2);
    fireEvent.click(m.speed());
    expect(m.audio.playbackRate).toBe(1);
    expect(onRateChange).toHaveBeenCalledTimes(3);
  });

  it('carries the speed into the first play and resets to 1x on remount', () => {
    const first = mount();
    fireEvent.click(first.speed());
    fireEvent.click(first.disc('play-sentinel'));
    expect(first.audio.playbackRate).toBe(1.5);
    first.unmount();
    const second = mount();
    expect(second.speed()).toHaveAccessibleName('speed-sentinel-rate-1');
  });

  it('is enabled when idle, playing and paused, and disabled while loading', () => {
    const m = mount();
    expect(m.speed()).toBeEnabled();
    fireEvent.click(m.disc('play-sentinel'));
    expect(m.speed()).toBeDisabled();
    fireEvent.playing(m.audio);
    expect(m.speed()).toBeEnabled();
    fireEvent.pause(m.audio);
    expect(m.speed()).toBeEnabled();
  });
});

describe('VoicePlayer, release and motion (UI-D-855, T-12.5-57)', () => {
  it('pauses and releases a playing player when it unmounts', () => {
    render(
      <>
        <MessageBubble {...bubble()} />
        <MessageBubble {...bubble({ side: 'own' })} />
      </>,
    );
    const [a, b] = audios() as [HTMLMediaElement, HTMLMediaElement];
    fireEvent.click(screen.getAllByRole('button', { name: 'play-sentinel' })[0] as HTMLElement);
    fireEvent.playing(a);
    cleanup();
    expect(pauseCalls).toContain(a);
    pauseCalls.length = 0;
    // The controller forgot both: nothing is paused any more.
    act(() => pauseAllVoice());
    expect(pauseCalls).not.toContain(a);
    expect(pauseCalls).not.toContain(b);
  });

  it('moves the thumb and fill with no transition, and spins only under motion-safe', () => {
    const m = mount();
    fireEvent.click(m.disc('play-sentinel'));
    const html = m.container.innerHTML;
    expect(html).not.toMatch(/transition/);
    expect(html).toContain('motion-safe:animate-spin');
    expect(html).not.toMatch(/(^|[\s"])animate-spin/);
  });

  it('shows no file name, URL, mime or receipt wording', () => {
    const m = mount();
    m.startPlaying();
    const text = m.container.textContent ?? '';
    expect(text).not.toContain('/v1/media');
    expect(text).not.toMatch(/audio\/|\.mp4|\.m4a|\.webm/);
  });
});
