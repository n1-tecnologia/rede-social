// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
