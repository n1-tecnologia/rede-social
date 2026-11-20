// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { MessageBubbleVoice } from '../ui/index';
import { MessageList, type MessageListItem } from '../ui/index';

/**
 * UI-D-259 as observable contract. The list ships NO words: every string below is a sentinel, so a
 * copy change cannot turn this file red.
 */

afterEach(cleanup);

const items: MessageListItem[] = [
  { kind: 'day', key: 'day-2026-09-29', label: 'day-yesterday-sentinel' },
  {
    kind: 'message',
    key: 'm1',
    side: 'other',
    body: 'Oi! Como posso ajudar? https://exemplo.com/ajuda',
    label: { firstName: 'Carla', srSuffix: ', team-sentinel', icon: 'shield' },
    time: '14:02',
  },
  { kind: 'day', key: 'day-2026-09-30', label: 'day-today-sentinel' },
  { kind: 'message', key: 'm2', side: 'own', body: 'Quero trocar\nmeu e-mail', time: null },
  {
    kind: 'message',
    key: 'm3',
    side: 'own',
    body: '<b>x</b> https://exemplo.com/eu',
    time: '14:05',
  },
  {
    kind: 'message',
    key: 'm4',
    side: 'own',
    body: 'Enviando agora',
    pending: true,
    pendingLabel: 'pending-sentinel',
  },
];

describe('MessageList (UI-D-259)', () => {
  it('is a polite log named by the host, with items in the order given', () => {
    render(<MessageList label="log-sentinel" items={items} />);
    const log = screen.getByRole('log', { name: 'log-sentinel' });
    expect(log.tagName).toBe('OL');
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(log).toHaveAttribute('aria-relevant', 'additions');
    const rows = within(log).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'day-yesterday-sentinel',
      'Carla, team-sentinelOi! Como posso ajudar? https://exemplo.com/ajuda14:02',
      'day-today-sentinel',
      'Quero trocar\nmeu e-mail',
      '<b>x</b> https://exemplo.com/eu14:05',
      'Enviando agorapending-sentinel',
    ]);
  });

  it('labels only the bubbles given a label, above the bubble, with the shield and sr suffix', () => {
    const { container } = render(<MessageList label="log" items={items} />);
    const senders = container.querySelectorAll('[data-chat-sender]');
    expect(senders).toHaveLength(1);
    const sender = senders[0] as HTMLElement;
    expect(sender.querySelector('svg')).not.toBeNull();
    expect(sender.querySelector('.sr-only')?.textContent).toBe(', team-sentinel');
    // Above the bubble: the label precedes the bubble body inside the same message column.
    const column = sender.parentElement as HTMLElement;
    expect(column.firstElementChild).toBe(sender);
    expect(column).toHaveAttribute('data-chat-bubble', 'other');
  });

  it('puts own bubbles right on the brand fill and other bubbles left on the surface', () => {
    const { container } = render(<MessageList label="log" items={items} />);
    const own = container.querySelector('[data-chat-bubble="own"]') as HTMLElement;
    const other = container.querySelector('[data-chat-bubble="other"]') as HTMLElement;
    expect(own.className).toContain('self-end');
    expect(own.className).toContain('max-w-[85%]');
    expect(own.innerHTML).toContain('bg-brand text-on-brand');
    expect(other.className).toContain('self-start');
    expect(other.innerHTML).toContain('bg-bg-secondary');
    expect(other.innerHTML).toContain('whitespace-pre-wrap');
  });

  it('turns URLs into anchors with the rel set and side-aware ink', () => {
    const { container } = render(<MessageList label="log" items={items} />);
    const anchors = [...container.querySelectorAll('a')];
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual([
      'https://exemplo.com/ajuda',
      'https://exemplo.com/eu',
    ]);
    for (const anchor of anchors) {
      expect(anchor).toHaveAttribute('rel', 'noopener noreferrer nofollow');
      expect(anchor).toHaveAttribute('target', '_blank');
    }
    expect(anchors[0]?.className).toContain('text-brand');
    expect(anchors[1]?.className).toBe('underline text-on-brand');
  });

  it('keeps HTML in a body as literal text', () => {
    const { container } = render(<MessageList label="log" items={items} />);
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>x</b>');
  });

  it('shows the time only where given, and the pending label on an optimistic bubble', () => {
    const { container } = render(<MessageList label="log" items={items} />);
    const times = [...container.querySelectorAll('[data-chat-time]')].map(
      (node) => node.textContent,
    );
    expect(times).toEqual(['14:02', '14:05', 'pending-sentinel']);
    expect(container.querySelector('[data-pending]')).not.toBeNull();
  });
});

describe('MessageList with voice messages (12.5-14, UI-D-851)', () => {
  const voice = (spokenLabel: string): MessageBubbleVoice => ({
    status: 'ready',
    src: '/v1/media/abc/original',
    durationSeconds: 42,
    spokenLabel,
    player: {
      labels: {
        play: 'play-sentinel',
        pause: 'pause-sentinel',
        loading: 'loading-sentinel',
        retry: 'retry-sentinel',
        seek: 'seek-sentinel',
        error: 'error-sentinel',
        unsupported: 'unsupported-sentinel',
        speed: (rate) => `speed-${rate}`,
        seekValue: (current, total) => `${current}-${total}`,
      },
      formatClock: (seconds) =>
        `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
      nextRate: () => 1,
      rateLabel: () => 'rate',
    },
  });

  it('mixes text and voice in one log, each voice message its own group, in the order given', () => {
    const mixed: MessageListItem[] = [
      { kind: 'message', key: 'v1', side: 'other', voice: voice('group-one-sentinel'), time: null },
      { kind: 'message', key: 't1', side: 'own', body: 'texto', time: null },
      {
        kind: 'message',
        key: 'v2',
        side: 'own',
        voice: voice('group-two-sentinel'),
        time: '14:05',
      },
    ];
    const { container } = render(<MessageList label="log" items={mixed} />);
    const log = screen.getByRole('log');
    expect(within(log).getAllByRole('listitem')).toHaveLength(3);
    expect(
      within(log)
        .getAllByRole('group')
        .map((g) => g.getAttribute('aria-label')),
    ).toEqual(['group-one-sentinel', 'group-two-sentinel']);
    // A text message in the same run still carries its body.
    expect(container.querySelector('[data-chat-message="t1"]')?.textContent).toBe('texto');
  });

  it('never autoplays an arriving voice message and requests no media on render', () => {
    const original = HTMLMediaElement.prototype.play;
    let plays = 0;
    HTMLMediaElement.prototype.play = function play() {
      plays += 1;
      return Promise.resolve();
    };
    try {
      const first: MessageListItem[] = [
        { kind: 'message', key: 'v1', side: 'other', voice: voice('group-one-sentinel') },
      ];
      const { container, rerender } = render(<MessageList label="log" items={first} />);
      rerender(
        <MessageList
          label="log"
          items={[
            ...first,
            { kind: 'message', key: 'v2', side: 'other', voice: voice('group-two-sentinel') },
          ]}
        />,
      );
      expect(plays).toBe(0);
      for (const audio of container.querySelectorAll('audio')) {
        expect(audio.hasAttribute('src')).toBe(false);
      }
    } finally {
      HTMLMediaElement.prototype.play = original;
    }
  });
});

describe('MessageList per-message menu slot (11-22, D-733, UI-D-870)', () => {
  const withMenu: MessageListItem[] = [
    { kind: 'day', key: 'day-1', label: 'day-sentinel' },
    {
      kind: 'message',
      key: 'in1',
      side: 'other',
      body: 'incoming-sentinel',
      time: '10:00',
      menu: <button type="button">menu-in1-sentinel</button>,
    },
    {
      kind: 'message',
      key: 'out1',
      side: 'own',
      body: 'outgoing-sentinel',
      time: '10:01',
      menu: <button type="button">menu-out1-sentinel</button>,
    },
    { kind: 'message', key: 'in2', side: 'other', body: 'no-menu-sentinel', time: '10:02' },
  ];

  it("draws the node in the gutter beside an INCOMING bubble only, never beside the viewer's own", () => {
    const { container } = render(<MessageList label="log" items={withMenu} />);
    expect(screen.getByText('menu-in1-sentinel')).toBeTruthy();
    expect(screen.queryByText('menu-out1-sentinel')).toBeNull();
    expect(container.querySelectorAll('[data-chat-gutter]')).toHaveLength(1);
  });

  it('the row is flex items-center gap-1 with the bubble first, and the bubble keeps max-w-[85%]', () => {
    const { container } = render(<MessageList label="log" items={withMenu} />);
    const gutter = container.querySelector('[data-chat-gutter]') as HTMLElement;
    expect(gutter.className).toContain('flex');
    expect(gutter.className).toContain('items-center');
    expect(gutter.className).toContain('gap-1');
    expect(gutter.className).toContain('min-w-0');
    expect(gutter.firstElementChild).toHaveAttribute('data-chat-bubble', 'other');
    expect(gutter.firstElementChild?.className).toContain('max-w-[85%]');
    expect(within(gutter).getByText('menu-in1-sentinel')).toBe(gutter.lastElementChild);
  });

  it('an item with no menu renders exactly as before: the bubble is the only child of its row', () => {
    const { container } = render(<MessageList label="log" items={withMenu} />);
    const plain = container.querySelector('[data-chat-message="in2"]') as HTMLElement;
    expect(plain.children).toHaveLength(1);
    expect(plain.firstElementChild).toHaveAttribute('data-chat-bubble', 'other');
    expect(plain.querySelector('[data-chat-gutter]')).toBeNull();
  });

  it("keeps the host's node out of the bubble and keeps the shipped text bubble unchanged", () => {
    const { container } = render(<MessageList label="log" items={withMenu} />);
    const bubble = container.querySelector('[data-chat-message="in1"] [data-chat-bubble]');
    expect(bubble?.textContent).toBe('incoming-sentinel10:00');
  });
});
