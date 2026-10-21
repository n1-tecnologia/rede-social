// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PaymentsSkeleton } from '../ui';

/**
 * 09.1-13 — the module's props-only skeleton (UI-D-528, UI-D-531, MOD-02). It carries no word at all
 * (a skeleton says nothing about the page it waits for), it is `aria-busy`, and its two variants draw
 * the geometry of the bodies they stand in for.
 */

afterEach(cleanup);

describe('PaymentsSkeleton', () => {
  it('is aria-busy and says nothing: no text node at all', () => {
    const { container } = render(<PaymentsSkeleton variant="setup" />);
    const root = screen.getByTestId('payments-skeleton');
    expect(root.getAttribute('aria-busy')).toBe('true');
    expect(container.textContent).toBe('');
  });

  it('draws the setup body: a field card, a three-row list card and the gate card with its switch block', () => {
    render(<PaymentsSkeleton variant="setup" frame={false} />);
    expect(screen.getByTestId('payments-skeleton-integration')).toBeTruthy();
    expect(screen.getAllByTestId('payments-skeleton-product-row')).toHaveLength(3);
    const gate = screen.getByTestId('payments-skeleton-gate');
    expect(gate.querySelector('[data-skeleton-switch]')).toBeTruthy();
  });

  it('draws the list body: 8 rows by default, or as many as asked', () => {
    const { rerender } = render(<PaymentsSkeleton variant="list" frame={false} />);
    expect(screen.getAllByTestId('payments-skeleton-row')).toHaveLength(8);
    rerender(<PaymentsSkeleton variant="list" frame={false} rows={3} />);
    expect(screen.getAllByTestId('payments-skeleton-row')).toHaveLength(3);
  });

  it('draws the page header bar and the three-tab row only inside the frame', () => {
    const { rerender } = render(<PaymentsSkeleton variant="setup" />);
    expect(screen.getByTestId('payments-skeleton-header')).toBeTruthy();
    expect(screen.getAllByTestId('payments-skeleton-tab')).toHaveLength(3);
    rerender(<PaymentsSkeleton variant="setup" frame={false} />);
    expect(screen.queryByTestId('payments-skeleton-header')).toBeNull();
    expect(screen.queryAllByTestId('payments-skeleton-tab')).toHaveLength(0);
  });

  it('writes no half-step spacing class (UI-SPEC: the inherited scale only)', () => {
    const { container } = render(<PaymentsSkeleton variant="setup" />);
    expect(container.innerHTML).not.toMatch(/\b(?:gap|p|m|px|py|mt|mb)-(?:0\.5|1\.5|2\.5|3\.5)\b/);
  });
});
