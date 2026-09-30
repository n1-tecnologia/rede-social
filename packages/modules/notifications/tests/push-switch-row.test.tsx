// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type PushRowState, PushSwitchRow } from '../ui/PushSwitchRow';

/**
 * UI-D-256 as observable contract (sketch 007 surface 4). The row ships NO words: every string is a
 * sentinel prop, so a copy change cannot turn this file red.
 */

afterEach(cleanup);

const TENANT_30 = 'Associação de Moradores do Sul';

const subLines = {
  unsupported: 'unsupported-sentinel',
  'ios-install': 'ios-sentinel',
  off: 'off-sentinel',
  on: 'on-sentinel',
  denied: `denied-sentinel ${TENANT_30} denied-tail-sentinel`,
} as const;

function row(
  state: PushRowState,
  extra: { busy?: boolean; onToggle?: (next: boolean) => void } = {},
) {
  return render(
    <PushSwitchRow
      state={state}
      label="label-sentinel"
      subLines={subLines}
      switchLabel="switch-sentinel"
      busy={extra.busy}
      onToggle={extra.onToggle ?? vi.fn()}
    />,
  );
}

describe('PushSwitchRow (UI-D-256)', () => {
  it.each([
    ['checking', '', false, true],
    ['unsupported', 'unsupported-sentinel', false, true],
    ['ios-install', 'ios-sentinel', false, false],
    ['off', 'off-sentinel', false, false],
    ['on', 'on-sentinel', true, false],
    ['denied', subLines.denied, false, true],
  ] as const)('%s: sub-line, checked and disabled', (state, line, checked, disabled) => {
    const { container } = row(state);
    const toggle = screen.getByRole('switch', { name: 'switch-sentinel' });
    expect(toggle).toHaveAttribute('aria-checked', String(checked));
    if (disabled) expect(toggle).toBeDisabled();
    else expect(toggle).toBeEnabled();
    const sub = container.querySelector('[data-push-subline]');
    expect(sub?.textContent).toBe(line);
    expect(screen.getByText('label-sentinel')).toBeInTheDocument();
  });

  it('checking reserves the sub-line height so the row never jumps after mount', () => {
    const { container } = row('checking');
    expect(container.querySelector('[data-push-subline]')).toHaveClass('min-h-[18px]', 'mt-1');
  });

  it('a tap on off asks for on; a tap on on asks for off; ios-install still reports the tap', () => {
    const onToggle = vi.fn();
    row('off', { onToggle });
    fireEvent.click(screen.getByRole('switch'));
    cleanup();
    row('on', { onToggle });
    fireEvent.click(screen.getByRole('switch'));
    cleanup();
    row('ios-install', { onToggle });
    fireEvent.click(screen.getByRole('switch'));
    expect(onToggle.mock.calls).toEqual([[true], [false], [true]]);
  });

  it('busy is announced and ignores taps', () => {
    const onToggle = vi.fn();
    row('on', { busy: true, onToggle });
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('E06 overflow (unit half): at 320px a 30-character tenant wraps while the 44×24 switch stays', () => {
    expect(TENANT_30).toHaveLength(30);
    const { container } = render(
      <div style={{ width: 320 }}>
        <PushSwitchRow
          state="denied"
          label="label-sentinel"
          subLines={subLines}
          switchLabel="switch-sentinel"
          onToggle={vi.fn()}
        />
      </div>,
    );
    const rowEl = container.querySelector('[data-push-row="denied"]');
    expect(rowEl).toHaveClass('flex', 'items-center', 'gap-3');
    const column = rowEl?.children[1];
    expect(column).toHaveClass('min-w-0', 'flex-1');
    const sub = container.querySelector('[data-push-subline]');
    expect(sub?.textContent).toContain(TENANT_30);
    expect(sub?.className).not.toMatch(/truncate|line-clamp|whitespace-nowrap/);
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveClass('shrink-0', 'h-6', 'w-11');
    expect(rowEl?.lastElementChild).toBe(toggle);
  });
});
