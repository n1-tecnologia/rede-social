// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CalendarDays } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import { ActionCard } from '../ui/ActionCard';
import { CohortHeatmap } from '../ui/CohortHeatmap';
import { HEAT_BUCKETS } from '../ui/scale';

afterEach(cleanup);

describe('CohortHeatmap', () => {
  function heatmap() {
    return render(
      <CohortHeatmap
        caption="caption-sentinel"
        corner=""
        columns={['c0', 'c1', 'c2']}
        rows={[
          { label: 'r1', values: [100, 58, 41] },
          { label: 'r2', values: [100, 41, null] },
        ]}
        formatValue={(v) => `p${v}`}
      />,
    );
  }

  it('is a table named by its caption, with the column and row headers', () => {
    heatmap();
    expect(screen.getByRole('table', { name: 'caption-sentinel' })).toBeInTheDocument();
    for (const header of ['c0', 'c1', 'c2']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    expect(screen.getByRole('rowheader', { name: 'r1' })).toBeInTheDocument();
  });

  it('prints every value, so the colour is never the only signal', () => {
    heatmap();
    for (const text of ['p100', 'p58', 'p41'])
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
  });

  it('paints each cell with a bucket class, the strongest in the on-brand ink, and leaves empty cohorts empty', () => {
    const { container } = heatmap();
    const cells = [...container.querySelectorAll('td')];
    expect(cells).toHaveLength(6);
    expect(cells[0]).toHaveClass('text-on-brand');
    expect(cells[5]?.textContent).toBe('');
    for (const cell of cells.slice(0, 5)) {
      expect(HEAT_BUCKETS.some((bucket) => cell.className.includes(bucket))).toBe(true);
    }
  });
});

describe('ActionCard', () => {
  it('renders icon, title, detail, pill and action slot, and no words of its own', () => {
    const { container } = render(
      <ActionCard
        icon={CalendarDays}
        title="title-sentinel"
        detail="detail-sentinel"
        pill={{ tone: 'warning', text: 'pill-sentinel' }}
        action={<button type="button">action-sentinel</button>}
      />,
    );
    expect(container.textContent).toBe('title-sentineldetail-sentinelpill-sentinelaction-sentinel');
    expect(container.querySelector('svg.lucide-calendar-days')).toHaveAttribute('aria-hidden');
    expect(container.querySelector('svg.lucide-triangle-alert')).not.toBeNull();
  });

  it('shows the unread dot with the caller label', () => {
    const { container } = render(
      <ActionCard icon={CalendarDays} title="t" detail="d" unreadLabel="unread-sentinel" />,
    );
    expect(screen.getByText('unread-sentinel')).toHaveClass('sr-only');
    expect(container.querySelector('[data-unread-dot]')).not.toBeNull();
  });

  it('has no unread dot by default', () => {
    const { container } = render(<ActionCard icon={CalendarDays} title="t" detail="d" />);
    expect(container.querySelector('[data-unread-dot]')).toBeNull();
  });
});
