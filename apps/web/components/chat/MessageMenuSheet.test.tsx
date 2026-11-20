// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageMenuSheet, MessageMenuTrigger } from './MessageMenuSheet';

/**
 * 11-22 Task 3 (MODER-05, D-733, D-859, UI-D-870, A-UI-6): the message menu. The words are SENTINELS here (the
 * component ships none; the real catalog is exercised through the pane): what is under test is the structure,
 * the rows that exist and the ones that never do, the sizes of the gutter trigger and the focus rules.
 */

MotionGlobalConfig.skipAnimations = true;

afterEach(cleanup);

function Host({ withBlock = true }: { withBlock?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <MessageMenuTrigger label="trigger-sentinel" onOpen={() => setOpen(true)} />
      <MessageMenuSheet
        open={open}
        onClose={() => setOpen(false)}
        title="title-sentinel"
        report={{ label: 'report-sentinel', onSelect: vi.fn() }}
        block={withBlock ? { label: 'block-sentinel', onSelect: vi.fn() } : null}
      />
    </>
  );
}

describe('MessageMenuTrigger (UI-D-870, A-UI-6)', () => {
  it('is one native button named by the host, always visible, 44px tall and 40px wide, 44 from 390px', () => {
    render(<MessageMenuTrigger label="trigger-sentinel" onOpen={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'trigger-sentinel' });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.className).toContain('h-11');
    expect(button.className).toContain('w-10');
    expect(button.className).toContain('min-[390px]:w-11');
    expect(button.className).toContain('text-text-tertiary');
    // Visible at all times: nothing reveals it on hover only (a phone has no hover).
    expect(button.className).not.toMatch(/opacity-0|invisible|hidden|group-hover/);
    // Ellipsis at 16px.
    expect(button.querySelector('svg')?.getAttribute('width')).toBe('16');
  });

  it('opens on a tap', () => {
    const onOpen = vi.fn();
    render(<MessageMenuTrigger label="trigger-sentinel" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'trigger-sentinel' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('MessageMenuSheet (UI-D-870, D-859)', () => {
  it('lists Denunciar and Bloquear under the title, and NO copy, reply, forward or delete row', async () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'trigger-sentinel' }));
    const dialog = await screen.findByRole('dialog', { name: 'title-sentinel' });
    const rows = [...dialog.querySelectorAll('button')].map((b) => b.textContent);
    expect(rows).toEqual(['report-sentinel', 'block-sentinel']);
  });

  it('draws no Bloquear row when the host passes none (already blocked, removed, staff)', async () => {
    render(<Host withBlock={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'trigger-sentinel' }));
    const dialog = await screen.findByRole('dialog', { name: 'title-sentinel' });
    expect([...dialog.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'report-sentinel',
    ]);
  });

  it('puts focus on the first row, and returns it to the trigger when closed with Escape', async () => {
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'trigger-sentinel' });
    trigger.focus();
    fireEvent.click(trigger);
    const first = await screen.findByRole('button', { name: 'report-sentinel' });
    await waitFor(() => expect(document.activeElement).toBe(first));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('a row calls its own handler once, and a long name keeps its complete accessible name', async () => {
    const onBlock = vi.fn();
    const longLabel = `Bloquear ${'Albuquerque '.repeat(12).trim()}`;
    render(
      <MessageMenuSheet
        open
        onClose={vi.fn()}
        title="title-sentinel"
        report={{ label: 'report-sentinel', onSelect: vi.fn() }}
        block={{ label: longLabel, onSelect: onBlock }}
      />,
    );
    const row = await screen.findByRole('button', { name: longLabel });
    expect(row.querySelector('span')?.className).toContain('truncate');
    fireEvent.click(row);
    expect(onBlock).toHaveBeenCalledTimes(1);
  });
});
