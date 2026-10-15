// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Heart } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import { KpiCard, KpiGrid } from '../ui/KpiCard';

/**
 * The KPI card as an observable contract. It ships NO words (PWA-03): every string is a prop,
 * sentinel ASCII here so a copy change cannot turn this file red.
 */

afterEach(cleanup);

describe('KpiCard', () => {
  it('renders the label, value, unit, delta, sentiment and note it is given', () => {
    const { container } = render(
      <KpiCard
        label="label-sentinel"
        value="42"
        unit="unit-sentinel"
        delta={{ text: 'delta-sentinel', direction: 'up', tone: 'success', sentiment: 'good-word' }}
        note="note-sentinel"
      />,
    );
    for (const text of [
      'label-sentinel',
      '42',
      'unit-sentinel',
      'delta-sentinel',
      'note-sentinel',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByText('good-word')).toHaveClass('sr-only');
    expect(screen.getByText('delta-sentinel').parentElement).toHaveClass('text-success');
    expect(container.querySelector('svg.lucide-arrow-up')).not.toBeNull();
  });

  it('draws a down arrow for down and a dash for flat', () => {
    const { container, rerender } = render(
      <KpiCard label="l" value="1" delta={{ text: 'd', direction: 'down', tone: 'danger' }} />,
    );
    expect(container.querySelector('svg.lucide-arrow-down')).not.toBeNull();
    rerender(
      <KpiCard label="l" value="1" delta={{ text: 'd', direction: 'flat', tone: 'neutral' }} />,
    );
    expect(container.querySelector('svg.lucide-minus')).not.toBeNull();
    expect(container.querySelector('svg.lucide-arrow-up, svg.lucide-arrow-down')).toBeNull();
  });

  it('renders no text of its own', () => {
    const { container } = render(<KpiCard label="L" value="V" />);
    expect(container.textContent).toBe('LV');
  });

  it('the missing variant is dashed and muted', () => {
    const { container } = render(
      <KpiCard label="L" value="missing-sentinel" note="why" variant="missing" />,
    );
    expect(container.firstElementChild).toHaveClass('border-dashed');
    expect(screen.getByText('missing-sentinel')).toHaveClass('text-text-tertiary');
  });

  it('renders the badge at the end of the top row, with the label', () => {
    render(<KpiCard label="label-sentinel" value="value-sentinel" badge="badge-sentinel" />);
    const badge = screen.getByText('badge-sentinel');
    expect(badge.parentElement).toContainElement(screen.getByText('label-sentinel'));
    expect(badge.parentElement).not.toContainElement(screen.getByText('value-sentinel'));
  });

  it('with the bare amount, shows a compact chip and keeps the sentence for the tooltip and readers', () => {
    render(
      <KpiCard
        label="L"
        value="V"
        delta={{
          text: 'sentence-sentinel',
          amount: 'amount-sentinel',
          direction: 'up',
          tone: 'danger',
        }}
      />,
    );
    const amount = screen.getByText('amount-sentinel');
    expect(amount).toHaveAttribute('aria-hidden');
    const chip = amount.parentElement;
    expect(chip).toHaveClass('text-danger');
    expect(chip).toHaveAttribute('title', 'sentence-sentinel');
    expect(screen.getByText('sentence-sentinel')).toHaveClass('sr-only');
  });

  it('with an icon, the label sits beside it in the top row', () => {
    const { container } = render(
      <KpiCard label="label-sentinel" value="V" icon={Heart} badge="badge-sentinel" />,
    );
    const row = container.querySelector('svg.lucide-heart')?.closest('div');
    expect(row).toContainElement(screen.getByText('label-sentinel'));
    expect(row).toContainElement(screen.getByText('badge-sentinel'));
    expect(row?.parentElement).toBe(container.firstElementChild);
  });

  it('counts a written value up (CountUp), never a missing one', () => {
    const { container, rerender } = render(<KpiCard label="L" value="42" />);
    expect(container.querySelector('[data-countup]')).toHaveTextContent('42');
    rerender(<KpiCard label="L" value="none-sentinel" variant="missing" />);
    expect(container.querySelector('[data-countup]')).toBeNull();
  });

  it('a linked card names its link verb for screen readers', () => {
    render(<KpiCard label="L" value="V" linked="verb-sentinel" />);
    expect(screen.getByText('verb-sentinel')).toHaveClass('sr-only');
  });

  it('a note stays within two lines, the whole note in its tooltip', () => {
    render(<KpiCard label="L" value="V" note="note-sentinel" />);
    const note = screen.getByText('note-sentinel');
    expect(note).toHaveClass('line-clamp-2');
    expect(note).toHaveAttribute('title', 'note-sentinel');
  });

  it('renders the chart slot', () => {
    render(<KpiCard label="L" value="V" chart={<span>chart-sentinel</span>} />);
    expect(screen.getByText('chart-sentinel')).toBeInTheDocument();
  });

  it('renders the footer last, after the note and the chart', () => {
    const { container } = render(
      <KpiCard
        label="L"
        value="V"
        note="note-sentinel"
        chart={<span>chart-sentinel</span>}
        footer={<span>footer-sentinel</span>}
      />,
    );
    const footer = screen.getByText('footer-sentinel');
    expect(container.firstElementChild?.lastElementChild).toContainElement(footer);
    const note = screen.getByText('note-sentinel');
    expect(note.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('without a footer, adds nothing after the note', () => {
    const { container } = render(<KpiCard label="L" value="V" note="note-sentinel" />);
    const card = container.firstElementChild;
    expect(card?.children).toHaveLength(3);
    expect(card?.lastElementChild).toBe(screen.getByText('note-sentinel'));
  });
});

describe('KpiGrid', () => {
  it('is a wrapping grid, never a horizontal scroller', () => {
    const { container } = render(
      <KpiGrid>
        <span>a</span>
      </KpiGrid>,
    );
    const grid = container.firstElementChild;
    expect(grid).toHaveClass('grid');
    expect(grid?.className).not.toMatch(/overflow-x|flex-nowrap/);
  });

  it('staggers its cards entrance', () => {
    const { container } = render(
      <KpiGrid>
        <span>a</span>
      </KpiGrid>,
    );
    expect(container.firstElementChild).toHaveAttribute('data-dash-stagger');
  });
});
