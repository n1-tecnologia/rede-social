// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StoriesStrip, type StoryCircleItem } from '../ui/StoriesStrip';
import { StoryCircle } from '../ui/StoryCircle';

/**
 * D-78 / D-79 / UI-D-26 / UI-D-27 / UI-D-28 — the strip and its circle, asserted as observable
 * contract rather than as pixels.
 *
 * The three claims worth a test are the three that a later edit could quietly break:
 *
 *  1. **UI-D-26's all-or-nothing empty.** A member with no active story must get NO DOM node — not
 *     an empty state, not a reserved height, not a zero-height row. The `/inicio` column has to
 *     close up, and "renders nothing" is a fact about the container, so only the container can
 *     assert it. An admin gets the own-circle ALONE, because it is the only publish door (D-80).
 *  2. **D-78's one-circle-per-story.** N stories and the publish permission is N+1 circles, in the
 *     server's order, with no grouping by publisher — with V1's single publisher, grouping would
 *     collapse the row to one circle forever and read as a bug.
 *  3. **UI-D-14's no-clock-in-render.** The label is a STRING the host already formatted; the
 *     component must never derive it. A sentinel string is what proves it is passed through.
 *
 * Both components ship NO words (PWA-03) and resolve no route (MOD-02): every string and every href
 * is a prop, sentinel ASCII here so a copy change cannot turn this file red.
 */

afterEach(cleanup);

const LADDER = [640, 1080] as const;

function story(n: number): StoryCircleItem {
  return {
    id: `s${n}`,
    label: `label-${n}`,
    actionLabel: `open-${n}`,
    assetId: `0000000${n}-1111-4111-8111-111111111111`,
    variantWidths: LADDER,
  };
}

const OWN = {
  href: '/stories/publicar',
  label: 'own-label',
  actionLabel: 'own-action',
  avatarUrl: null,
};

function strip(overrides: Partial<React.ComponentProps<typeof StoriesStrip>> = {}) {
  return render(
    <StoriesStrip items={[]} ringVariant="brand" regionLabel="strip-region" {...overrides} />,
  );
}

describe('StoriesStrip — the /inicio home slot (UI-D-25..UI-D-28, D-78)', () => {
  it('1. zero stories and NO publish permission renders no DOM node at all (UI-D-26)', () => {
    const { container } = strip({ items: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('2. zero stories WITH the publish permission renders exactly one circle — the own-circle', () => {
    strip({ items: [], own: OWN });
    const row = screen.getByRole('list', { name: 'strip-region' });
    expect(within(row).getAllByRole('listitem')).toHaveLength(1);
    expect(within(row).getByRole('link', { name: 'own-action' })).toHaveAttribute(
      'href',
      '/stories/publicar',
    );
  });

  it('3. N stories plus the permission is N+1 circles, own-circle FIRST, newest-first order kept', () => {
    strip({ items: [story(1), story(2), story(3)], own: OWN });
    const items = within(screen.getByRole('list', { name: 'strip-region' })).getAllByRole(
      'listitem',
    );
    expect(items).toHaveLength(4);
    expect(items.map((item) => item.textContent)).toEqual([
      'own-label',
      'label-1',
      'label-2',
      'label-3',
    ]);
  });

  it('4. loading draws three skeleton circles and no listitem, so the feed below does not shift', () => {
    const { container } = strip({ items: [], loading: true });
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="story-circle-skeleton"]')).toHaveLength(3);
  });

  it('5. the row contains its own horizontal overscroll so a swipe never triggers back', () => {
    const { container } = strip({ items: [story(1)] });
    expect(container.querySelector('[data-testid="stories-strip"]')?.className).toContain(
      'overscroll-x-contain',
    );
  });
});

describe('StoryCircle — 64x64, three variants, one geometry (UI-D-27, UI-D-28)', () => {
  it('6. the label is the host string, verbatim and truncated — never derived from a clock', () => {
    render(<StoryCircle variant="brand" label="ha 2 h" actionLabel="open" assetId={null} />);
    const label = screen.getByText('ha 2 h');
    expect(label.className).toContain('truncate');
    expect(label.className).toContain('max-w-16');
  });

  it('7. a circle with no onOpen is inert; with one it is a button carrying the action label', () => {
    const { rerender } = render(
      <StoryCircle variant="brand" label="l" actionLabel="open-me" assetId={null} />,
    );
    expect(screen.queryByRole('button')).toBeNull();

    rerender(
      <StoryCircle
        variant="brand"
        label="l"
        actionLabel="open-me"
        assetId={null}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'open-me' })).toBeInTheDocument();
  });

  it('8. the own variant is an anchor (never a button) and wears the Plus badge', () => {
    const { container } = render(
      <StoryCircle
        variant="own"
        label="own-label"
        actionLabel="own-action"
        href="/stories/publicar"
        avatarUrl={null}
      />,
    );
    expect(screen.getByRole('link', { name: 'own-action' })).toHaveAttribute(
      'href',
      '/stories/publicar',
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('[data-testid="story-own-badge"]')).not.toBeNull();
  });
});
