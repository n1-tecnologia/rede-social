// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MessageBubble,
  type MessageBubbleProps,
  type MessageBubbleVoice,
  type MessageBubbleVoicePlayer,
  type VoicePlayerProps,
} from '../ui/index';

/**
 * 12.5-14 task 3 as observable contract: the shared bubble's voice branch, on both sides, with its
 * pending, failed and deleted variants. Sentinel strings only. Colours and sizes are asserted as the
 * class tokens UI-D-848 names; the visual proof (320 and 390 px, the Amarelo preset, dark theme) is in the
 * ledger, not here.
 */

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const player: MessageBubbleVoicePlayer = {
  labels: {
    play: 'play-sentinel',
    pause: 'pause-sentinel',
    loading: 'loading-sentinel',
    retry: 'retry-sentinel',
    seek: 'seek-sentinel',
    error: 'error-sentence-sentinel',
    unsupported: 'unsupported-sentence-sentinel',
    speed: (rate) => `speed-sentinel-${rate}`,
    seekValue: (current, total) => `value-${current}-of-${total}`,
  },
  formatClock: clock,
  nextRate: (rate) => (rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1),
  rateLabel: (rate) => `rate-${rate}`,
};

const shared = { durationSeconds: 42, spokenLabel: 'group-sentinel', player };

function ready(): MessageBubbleVoice {
  return { status: 'ready', src: '/v1/media/abc/original', ...shared };
}

function voiceBubble(
  voice: MessageBubbleVoice,
  over: Partial<{
    side: 'own' | 'other';
    time: string | null;
    pending: boolean;
    pendingLabel: string;
  }> = {},
): MessageBubbleProps {
  return { side: 'other', voice, ...over };
}

function bubbleEl(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-chat-bubble]') as HTMLElement;
}

function tokens(el: Element | null): string[] {
  return (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

describe('voice bubble, both sides (UI-D-848)', () => {
  it('draws the own side on the brand fill with on-brand ink on every control', () => {
    const { container } = render(<MessageBubble {...voiceBubble(ready(), { side: 'own' })} />);
    const group = screen.getByRole('group', { name: 'group-sentinel' });
    expect(tokens(group)).toEqual(
      expect.arrayContaining([
        'w-70',
        'max-w-full',
        'px-3',
        'py-2',
        'rounded-2xl',
        'rounded-br-md',
        'bg-brand',
        'text-on-brand',
      ]),
    );
    expect(tokens(bubbleEl(container))).toEqual(
      expect.arrayContaining(['max-w-[85%]', 'self-end']),
    );
    const disc = screen.getByRole('button', { name: 'play-sentinel' });
    expect(tokens(disc)).toEqual(
      expect.arrayContaining(['bg-on-brand', 'text-brand', 'h-10', 'w-10']),
    );
    const pill = screen.getByRole('button', { name: /^speed-sentinel/ });
    expect(tokens(pill)).toEqual(
      expect.arrayContaining(['bg-on-brand/20', 'text-on-brand', 'h-8', 'w-10']),
    );
    const html = container.innerHTML;
    expect(html).toContain('bg-on-brand/30');
    const thumb = container.querySelector('div[aria-hidden].rounded-full.h-4');
    expect(tokens(thumb)).toContain('bg-on-brand');
    expect(screen.getByText('0:42')).toHaveClass('text-on-brand', 'text-sm', 'tabular-nums');
    expect(html).not.toContain('bg-bg-tertiary');
  });

  it('draws the other side on the neutral surface with neutral ink and no brand-coloured text or fill', () => {
    const { container } = render(<MessageBubble {...voiceBubble(ready())} />);
    const group = screen.getByRole('group', { name: 'group-sentinel' });
    expect(tokens(group)).toEqual(
      expect.arrayContaining([
        'rounded-bl-md',
        'bg-bg-secondary',
        'border',
        'border-border',
        'text-text',
      ]),
    );
    expect(tokens(bubbleEl(container))).toContain('self-start');
    const disc = screen.getByRole('button', { name: 'play-sentinel' });
    expect(tokens(disc)).toEqual(expect.arrayContaining(['bg-button', 'text-on-button']));
    const pill = screen.getByRole('button', { name: /^speed-sentinel/ });
    expect(tokens(pill)).toEqual(expect.arrayContaining(['bg-bg-tertiary', 'text-text-secondary']));
    const thumb = container.querySelector('div[aria-hidden].rounded-full.h-4');
    expect(tokens(thumb)).toContain('bg-text');
    expect(screen.getByText('0:42')).toHaveClass('text-text-secondary');
    const every = [...container.querySelectorAll('[class]')].flatMap((el) => tokens(el));
    for (const forbidden of [
      'text-brand',
      'bg-brand',
      'bg-on-brand',
      'text-on-brand',
      'border-brand',
    ]) {
      expect(every).not.toContain(forbidden);
    }
  });

  it('is one group with no text machinery: no wrap class, no link, no body', () => {
    const { container } = render(
      <MessageBubble {...voiceBubble(ready(), { side: 'own', time: '14:02' })} />,
    );
    expect(screen.getAllByRole('group')).toHaveLength(1);
    expect(container.innerHTML).not.toContain('whitespace-pre-wrap');
    expect(container.innerHTML).not.toContain('overflow-wrap');
    expect(container.querySelector('a')).toBeNull();
    expect(container.innerHTML).not.toContain('dangerouslySetInnerHTML');
    // The time of day stays under the bubble at 12px, outside the group.
    const time = container.querySelector('[data-chat-time]') as HTMLElement;
    expect(time).toHaveTextContent('14:02');
    expect(time).toHaveClass('text-xs');
    expect(screen.getByRole('group').contains(time)).toBe(false);
  });

  it('keeps every text inside the player at 14px and names the controls from props', () => {
    const { container } = render(<MessageBubble {...voiceBubble(ready())} />);
    const group = screen.getByRole('group');
    expect(tokens(group)).toContain('text-sm');
    expect(group.innerHTML).not.toMatch(/text-xs/);
    expect(screen.getByRole('slider', { name: 'seek-sentinel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'speed-sentinel-rate-1' })).toBeInTheDocument();
    expect(container.querySelector('audio')).not.toBeNull();
  });

  it('keeps a text bubble byte-identical in its classes and markup', () => {
    const { container } = render(<MessageBubble side="own" body="oi" time="14:02" />);
    const inner = container.querySelector('[data-chat-bubble] > div') as HTMLElement;
    expect(inner.getAttribute('class')).toBe(
      'max-w-full whitespace-pre-wrap px-3 py-2 text-sm font-normal leading-normal [overflow-wrap:anywhere] rounded-2xl rounded-br-md bg-brand text-on-brand',
    );
    expect(container.querySelector('audio')).toBeNull();
    expect(container.querySelector('[role="group"]')).toBeNull();
  });
});

describe('pending upload (UI-D-846, V11)', () => {
  it('keeps the geometry dimmed, with a disabled disc, a determinate bar and the host progress text', () => {
    const voice: MessageBubbleVoice = {
      status: 'pending',
      progress: { percent: 62, label: 'upload-name-sentinel' },
      ...shared,
    };
    const { container } = render(
      <MessageBubble
        {...voiceBubble(voice, { side: 'own', pending: true, pendingLabel: 'sending-62-sentinel' })}
      />,
    );
    expect(tokens(screen.getByRole('group'))).toContain('opacity-70');
    expect(container.querySelector('[data-pending]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'play-sentinel' })).toBeDisabled();
    const bar = screen.getByRole('progressbar', { name: 'upload-name-sentinel' });
    expect(bar).toHaveAttribute('aria-valuenow', '62');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByRole('button', { name: /^speed-sentinel/ })).toBeDisabled();
    expect(container.querySelector('[data-chat-time]')).toHaveTextContent('sending-62-sentinel');
    expect(screen.getByText('0:42')).toBeInTheDocument();
    expect(container.querySelector('audio')).toBeNull();
  });

  it('shows the shipped pending label and an indeterminate bar while the percent is unknown', () => {
    const voice: MessageBubbleVoice = {
      status: 'pending',
      progress: { percent: null, label: 'upload-name-sentinel' },
      ...shared,
    };
    const { container } = render(
      <MessageBubble
        {...voiceBubble(voice, { side: 'own', pending: true, pendingLabel: 'pending-sentinel' })}
      />,
    );
    const bar = screen.getByRole('progressbar', { name: 'upload-name-sentinel' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(container.querySelector('[data-chat-time]')).toHaveTextContent('pending-sentinel');
  });

  it('is pending even when the host forgot the pending flag', () => {
    const voice: MessageBubbleVoice = {
      status: 'pending',
      progress: { percent: 5, label: 'upload-name-sentinel' },
      ...shared,
    };
    const { container } = render(
      <MessageBubble {...voiceBubble(voice, { side: 'own', pendingLabel: 'pending-sentinel' })} />,
    );
    expect(container.querySelector('[data-pending]')).not.toBeNull();
    expect(tokens(screen.getByRole('group'))).toContain('opacity-70');
  });
});

describe('failed send (UI-D-847, V14, V15)', () => {
  function failed(retriable: boolean, onRetry = vi.fn(), onDiscard = vi.fn()): MessageBubbleVoice {
    return {
      status: 'failed',
      failure: {
        text: 'failed-sentence-sentinel',
        retriable,
        retryLabel: 'retry-action-sentinel',
        discardLabel: 'discard-action-sentinel',
        onRetry,
        onDiscard,
      },
      ...shared,
    };
  }

  it('stays undimmed with the danger line and two ghost buttons that call the host', () => {
    const onRetry = vi.fn();
    const onDiscard = vi.fn();
    const { container } = render(
      <MessageBubble {...voiceBubble(failed(true, onRetry, onDiscard), { side: 'own' })} />,
    );
    expect(tokens(screen.getByRole('group'))).not.toContain('opacity-70');
    expect(container.querySelector('[data-pending]')).toBeNull();
    const line = screen.getByRole('alert');
    expect(line).toHaveTextContent('failed-sentence-sentinel');
    expect(line).toHaveClass('text-danger', 'text-sm');
    expect(line.querySelector('svg')).not.toBeNull();
    const retry = screen.getByRole('button', { name: 'retry-action-sentinel' });
    const discard = screen.getByRole('button', { name: 'discard-action-sentinel' });
    expect(tokens(retry)).toEqual(expect.arrayContaining(['text-text-secondary', 'after:h-11']));
    expect(tokens(discard)).toEqual(expect.arrayContaining(['text-text-secondary', 'after:h-11']));
    expect(retry.querySelector('svg')).not.toBeNull();
    fireEvent.click(retry);
    fireEvent.click(discard);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    // The buttons sit under the bubble, right-aligned on the own side, and wrap when the font needs it.
    const row = retry.parentElement as HTMLElement;
    expect(row).toHaveClass('flex-wrap', 'justify-end');
    // Disc, bar and speed pill are all disabled, the bar is empty and no audio exists.
    expect(screen.getByRole('button', { name: 'play-sentinel' })).toBeDisabled();
    const range = screen.getByRole('slider') as HTMLInputElement;
    expect(range).toBeDisabled();
    expect(range.value).toBe('0');
    expect(screen.getByRole('button', { name: /^speed-sentinel/ })).toBeDisabled();
    expect(container.querySelector('audio')).toBeNull();
  });

  it('offers only the discard for a permanent refusal', () => {
    render(<MessageBubble {...voiceBubble(failed(false), { side: 'own' })} />);
    expect(screen.queryByRole('button', { name: 'retry-action-sentinel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'discard-action-sentinel' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('failed-sentence-sentinel');
  });
});

describe('deleted recording (UI-D-858, VOICE-37, V55)', () => {
  it('reads only the host sentence: no player, no duration, nothing focusable, no media', () => {
    const voice: MessageBubbleVoice = { status: 'deleted', text: 'deleted-sentence-sentinel' };
    const { container } = render(
      <MessageBubble {...voiceBubble(voice, { side: 'other', time: '14:02' })} />,
    );
    expect(screen.getByText('deleted-sentence-sentinel')).toHaveClass(
      'text-sm',
      'text-text-secondary',
    );
    expect(container.querySelector('audio')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByRole('group')).toBeNull();
    expect(container.querySelector('[tabindex]')).toBeNull();
    expect(container.textContent).not.toContain('0:42');
    // It keeps its side and its time.
    expect(tokens(bubbleEl(container))).toContain('self-start');
    expect(container.querySelector('[data-chat-time]')).toHaveTextContent('14:02');
    // No media request was made by rendering.
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
});

describe('what the bubble never does (D-855, UI-D-857, T-12.5-54..56)', () => {
  it('has no prop for a played or listened mark, and is a type error to pass body with voice', () => {
    // Compile-time proofs: a `@ts-expect-error` that stops being an error fails `tsc`.
    const both = { side: 'own' as const, body: 'oi', voice: ready() };
    // @ts-expect-error a bubble has body or voice, never both (D-846)
    const rejected: MessageBubbleProps = both;
    void rejected;
    const noReceipt: 'onPlayed' extends keyof VoicePlayerProps ? never : true = true;
    expect(noReceipt).toBe(true);
    expect(Object.keys(player)).not.toContain('onPlayed');
  });

  it('renders no URL, file name or mime, and never an inner-HTML escape hatch', () => {
    const { container } = render(<MessageBubble {...voiceBubble(ready())} />);
    const text = container.textContent ?? '';
    expect(text).not.toContain('/v1/media');
    expect(text).not.toMatch(/\.m4a|\.mp4|\.webm|audio\//);
    // The source is only ever an attribute assigned on a tap.
    expect(container.querySelector('audio')?.hasAttribute('src')).toBe(false);
    expect(within(container).queryByText(/abc/)).toBeNull();
  });
});
