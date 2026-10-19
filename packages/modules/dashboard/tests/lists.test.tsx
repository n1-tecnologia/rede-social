// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AttentionList } from '../ui/AttentionList';
import { BarList } from '../ui/BarList';
import { Collapsible } from '../ui/Collapsible';
import { ToneLabel } from '../ui/ToneLabel';

afterEach(cleanup);

const ICONS = {
  success: 'lucide-circle-check',
  warning: 'lucide-triangle-alert',
  danger: 'lucide-circle-alert',
  neutral: 'lucide-circle',
} as const;

describe('ToneLabel', () => {
  it.each(Object.entries(ICONS))('%s renders its icon next to the text', (tone, icon) => {
    const { container } = render(
      <ToneLabel tone={tone as keyof typeof ICONS}>text-sentinel</ToneLabel>,
    );
    expect(screen.getByText('text-sentinel')).toBeInTheDocument();
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass(icon);
    expect(svg).toHaveAttribute('aria-hidden');
  });
});

describe('AttentionList', () => {
  it('renders each item as tone label + title + detail, never colour alone', () => {
    const { container } = render(
      <AttentionList
        items={[
          { id: '1', tone: 'danger', tag: 'tag-1', title: 'title-1', detail: 'detail-1' },
          { id: '2', tone: 'warning', tag: 'tag-2', title: 'title-2' },
        ]}
      />,
    );
    for (const text of ['tag-1', 'title-1', 'detail-1', 'tag-2', 'title-2']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(container.querySelector('svg.lucide-circle-alert')).not.toBeNull();
    expect(container.querySelector('svg.lucide-triangle-alert')).not.toBeNull();
    expect(container.querySelector('a, button')).toBeNull();
  });
});

describe('Collapsible', () => {
  it('is a native details/summary, closed unless open', () => {
    const { container, rerender } = render(
      <Collapsible title="title-sentinel" summary="summary-sentinel">
        <p>body-sentinel</p>
      </Collapsible>,
    );
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(container.querySelector('summary')).toHaveTextContent('title-sentinelsummary-sentinel');
    rerender(
      <Collapsible title="t" open>
        <p>b</p>
      </Collapsible>,
    );
    expect(container.querySelector('details')).toHaveAttribute('open');
  });
});

describe('BarList floored rows (08.7-07, UI-D-470)', () => {
  const rows = [
    { id: 'a', label: 'row-a', value: 12, display: 'shown-12' },
    { id: 'b', label: 'row-b', floored: true as const, display: 'floor-sentinel', rate: 'rate-b' },
    { id: 'c', label: 'row-c', value: 7, display: 'shown-7', rate: 'rate-c' },
  ];

  function names(container: HTMLElement): string[] {
    return [...container.querySelectorAll('li')].map(
      (li) => li.querySelector('span')?.textContent ?? '',
    );
  }

  it.each([false, true])('sorts a floored row after every shown row (stacked %s)', (stacked) => {
    const { container } = render(<BarList rows={rows} stacked={stacked} />);
    expect(names(container)).toEqual(['row-a', 'row-c', 'row-b']);
  });

  it.each([false, true])(
    'draws a floored row as an empty track with the host floor text, no percent, no count-up (stacked %s)',
    (stacked) => {
      const { container } = render(<BarList rows={rows} stacked={stacked} />);
      const floored = container.querySelector<HTMLElement>('li[data-floored]');
      expect(floored).not.toBeNull();
      expect(container.querySelectorAll('li[data-floored]')).toHaveLength(1);
      expect(floored).toHaveTextContent('row-b');
      expect(floored).toHaveTextContent('floor-sentinel');
      expect(floored).not.toHaveTextContent('rate-b');
      expect(floored?.querySelector('[data-bar-fill]')).toBeNull();
      expect(floored?.querySelector('[data-countup]')).toBeNull();
      // The shown rows keep their fill, scaled to the largest SHOWN value.
      const fills = [...container.querySelectorAll<HTMLElement>('[data-bar-fill]')].map(
        (el) => el.style.width,
      );
      expect(fills).toHaveLength(2);
      expect(fills[0]).toBe('100%');
    },
  );
});
