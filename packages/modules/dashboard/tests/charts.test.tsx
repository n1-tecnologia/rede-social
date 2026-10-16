// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BarList, type BarRow } from '../ui/BarList';
import { LineChart } from '../ui/LineChart';
import { barPercent } from '../ui/scale';

/** Charts drawn to scale, in token colours, with no words of their own (sentinel strings). */

afterEach(cleanup);

function fillWidths(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-bar-fill]')].map(
    (el) => el.style.width,
  );
}

describe('BarList', () => {
  const rows = [
    { id: 'a', label: 'row-a', value: 5230, display: 'shown-a', highlight: true },
    { id: 'b', label: 'row-b', value: 410, display: 'shown-b' },
  ];

  it('fills each bar to value / largest value', () => {
    const { container } = render(<BarList rows={rows} />);
    expect(fillWidths(container)).toEqual(['100%', `${barPercent(410, 5230)}%`]);
  });

  it('uses the caller max when given', () => {
    const { container } = render(
      <BarList rows={rows.map((r) => ({ ...r, value: 50 }))} max={100} />,
    );
    expect(fillWidths(container)).toEqual(['50%', '50%']);
  });

  it('prints the caller value label and the optional rate', () => {
    render(
      <BarList rows={[{ id: 'a', label: 'L', value: 1, display: 'D', rate: 'rate-sentinel' }]} />,
    );
    expect(screen.getByText('D')).toBeInTheDocument();
    expect(screen.getByText('rate-sentinel')).toBeInTheDocument();
  });

  it('paints the highlighted bar in the brand token', () => {
    const { container } = render(<BarList rows={rows} />);
    const [first, second] = container.querySelectorAll('[data-bar-fill]');
    expect(first).toHaveClass('bg-brand');
    expect(second).not.toHaveClass('bg-brand');
  });

  it("renders a leading node before each row's label, keeping the bars to scale", () => {
    const led = rows.map((row) => ({
      ...row,
      leading: <span data-testid={`lead-${row.id}`} />,
      rate: `rate-${row.id}`,
    }));
    const { container } = render(<BarList rows={led} />);
    const items = [...container.querySelectorAll('li')];
    expect(items).toHaveLength(2);
    expect(items[0]?.firstElementChild).toBe(screen.getByTestId('lead-a'));
    expect(items[1]?.firstElementChild).toBe(screen.getByTestId('lead-b'));
    expect(fillWidths(container)).toEqual(['100%', `${barPercent(410, 5230)}%`]);
    expect(screen.getByText('shown-a')).toBeInTheDocument();
    expect(screen.getByText('rate-a')).toBeInTheDocument();
  });

  it('puts a row anchor on its li in both layouts, and no id without one (quick 261014-ia8 F-1)', () => {
    const anchored: BarRow[] = [
      { id: 'a', label: 'row-a', value: 5230, display: 'shown-a', anchor: 'anchor-a' },
      { id: 'b', label: 'row-b', value: 410, display: 'shown-b' },
    ];
    const grid = render(<BarList rows={anchored} />);
    let items = [...grid.container.querySelectorAll('li')];
    expect(items[0]?.id).toBe('anchor-a');
    expect(items[0]).toHaveClass('scroll-mt-20');
    expect(items[1]?.hasAttribute('id')).toBe(false);
    cleanup();
    const led = render(<BarList rows={anchored.map((row) => ({ ...row, leading: <span /> }))} />);
    items = [...led.container.querySelectorAll('li')];
    expect(items[0]?.id).toBe('anchor-a');
    expect(items[0]).toHaveClass('scroll-mt-20');
    expect(items[1]?.hasAttribute('id')).toBe(false);
  });

  it('stacks value and rate over a full-width bar when asked, without leading (quick 261014-ia8 F-6)', () => {
    const grid = 'grid-cols-[minmax(min-content,2fr)_minmax(0,3fr)_auto]';
    const rated = rows.map((row) => ({ ...row, rate: `rate-${row.id}` }));
    const { container } = render(<BarList rows={rated} stacked />);
    expect(container.querySelector('ul')).not.toHaveClass(grid);
    const items = [...container.querySelectorAll('li')];
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.querySelectorAll('[data-bar-fill]')).toHaveLength(1);
      const rate = [...item.querySelectorAll('span')].find((el) =>
        el.textContent?.startsWith('rate-'),
      );
      expect(rate).toHaveClass('block');
    }
    expect(fillWidths(container)).toEqual(['100%', `${barPercent(410, 5230)}%`]);
  });

  it("keeps today's grid without leading", () => {
    const grid = 'grid-cols-[minmax(min-content,2fr)_minmax(0,3fr)_auto]';
    const plain = render(<BarList rows={rows} />);
    expect(plain.container.querySelector('ul')).toHaveClass(grid);
    cleanup();
    const led = render(<BarList rows={rows.map((row) => ({ ...row, leading: <span /> }))} />);
    expect(led.container.querySelector('ul')).not.toHaveClass(grid);
  });
});

describe('LineChart', () => {
  const series = [310, 330, 425, 380];
  const previous = [280, 290, 300, 355];

  function chart(withPrevious: boolean) {
    return render(
      <LineChart
        series={series}
        {...(withPrevious ? { previous } : {})}
        xLabels={['x1', '', '', 'x4']}
        yStep={50}
        formatValue={(n) => `v${n}`}
        ariaLabel="chart-sentinel"
      />,
    );
  }

  it('is an image with the caller label', () => {
    chart(false);
    expect(screen.getByRole('img', { name: 'chart-sentinel' })).toBeInTheDocument();
  });

  it('shares ONE y-scale across both series (ticks from the union, floored/ceiled to the step)', () => {
    const { container } = chart(true);
    const ticks = [...container.querySelectorAll('[data-tick]')].map((t) => t.textContent);
    expect(ticks).toEqual(['v250', 'v350', 'v450']);
  });

  it('draws the previous period dashed in the tertiary token, the current one in brand', () => {
    const { container } = chart(true);
    const prev = container.querySelector('[data-series="previous"]');
    const cur = container.querySelector('[data-series="current"]');
    expect(prev).toHaveAttribute('stroke-dasharray');
    expect(prev).toHaveClass('text-text-tertiary');
    expect(cur).toHaveClass('text-brand');
    expect(cur).not.toHaveAttribute('stroke-dasharray');
    expect(container.querySelector('[data-series="area"]')).toHaveClass('text-brand');
    expect(container.querySelector('[data-last-point]')).toHaveClass('text-brand');
  });

  it('has no previous path without a previous series, and prints only the x labels given', () => {
    const { container } = chart(false);
    expect(container.querySelector('[data-series="previous"]')).toBeNull();
    const xs = [...container.querySelectorAll('[data-x-label]')].map((t) => t.textContent);
    expect(xs).toEqual(['x1', 'x4']);
  });

  describe('the last x label, anchored at the end (quick 261013-uoi C-2)', () => {
    function labels(count: number, at: Record<number, string>) {
      const { container } = render(
        <LineChart
          series={Array.from({ length: count }, (_, i) => 10 + i)}
          xLabels={Array.from({ length: count }, (_, i) => at[i] ?? '')}
          yStep={5}
          formatValue={(n) => `v${n}`}
          ariaLabel="chart-sentinel"
        />,
      );
      return [...container.querySelectorAll('[data-x-label]')].map((el) => ({
        text: el.textContent,
        anchor: el.getAttribute('text-anchor'),
      }));
    }

    it('drops the label before it when the two would touch', () => {
      const months = ['nov', 'dez', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set'];
      const at: Record<number, string> = { 11: 'out' };
      for (const [i, month] of months.entries()) if (i % 2 === 0) at[i] = month;
      const xs = labels(12, at);
      expect(xs.map((x) => x.text)).toEqual(['nov', 'jan', 'mar', 'mai', 'jul', 'out']);
      expect(xs.at(-1)).toEqual({ text: 'out', anchor: 'end' });
    });

    it('keeps every label when there is room', () => {
      expect(labels(12, { 3: 'S4', 7: 'S8', 11: 'S12' }).map((x) => x.text)).toEqual([
        'S4',
        'S8',
        'S12',
      ]);
      expect(labels(11, { 0: '0:00', 5: '0:20', 10: '0:41' }).map((x) => x.text)).toEqual([
        '0:00',
        '0:20',
        '0:41',
      ]);
    });
  });

  it('ships no words: every text node comes from the caller', () => {
    const { container } = chart(true);
    const texts = [...container.querySelectorAll('text')].map((t) => t.textContent ?? '');
    for (const text of texts) expect(text).toMatch(/^(v\d+|x\d)$/);
  });

  it('keeps its height in pixels and stretches only the plot, so text and the dot never distort', () => {
    const { container } = render(
      <LineChart
        series={series}
        xLabels={['x1', '', '', 'x4']}
        yStep={50}
        formatValue={(n) => `v${n}`}
        ariaLabel="chart-sentinel"
        height={150}
      />,
    );
    const root = screen.getByRole('img', { name: 'chart-sentinel' });
    expect(root).toHaveAttribute('height', '150');
    expect(root).toHaveAttribute('width', '100%');
    expect(root).not.toHaveAttribute('viewBox');
    const plot = root.querySelector('svg');
    expect(plot).toHaveAttribute('preserveAspectRatio', 'none');
    expect(plot?.querySelector('[data-series="current"]')).toHaveAttribute(
      'vector-effect',
      'non-scaling-stroke',
    );
    // Text and the last dot are drawn outside the stretched plot, in the chart's own pixels.
    expect(plot?.querySelector('text, circle')).toBeNull();
    const xs = [...container.querySelectorAll('[data-x-label]')].map((t) => t.getAttribute('x'));
    for (const x of xs) expect(x).toMatch(/%$/);
  });
});
