// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CommunityCover } from '../ui/CommunityCover';
import { CommunityHeader } from '../ui/CommunityHeader';

/**
 * UI-D-35 / UI-D-43 — the community page's two presentational pieces, asserted as observable
 * contract rather than as pixels.
 *
 * `CommunityCover` is ONE component with TWO geometries and TWO branches, and the asymmetry between
 * them is the whole of UI-D-35: on the list CARD the name is always overlaid on the cover, so the
 * cover-less fallback has to carry it; on the PAGE the name always renders BELOW the cover, so the
 * fallback there carries no text at all. A single component with a `geometry` prop is what stops the
 * two drifting — and what stops the page's fallback doubling the name.
 *
 * `CommunityHeader` is UI-D-43 minus D-67's three drops: no overlapping avatar, no human credit
 * line and no verification badge. A community belongs to the organisation and D-52 already puts a
 * face on every post inside it, so a byline on the container would invent an authorship claim the
 * product does not make.
 *
 * Both ship NO words (PWA-03) and resolve no route (MOD-02): every string and every href is a prop,
 * sentinel ASCII here so a copy change cannot turn this file red.
 */

afterEach(cleanup);

const LADDER = [640, 1080, 1600] as const;
const ASSET = 'a1111111-1111-4111-8111-111111111111';

function cover(overrides: Record<string, unknown> = {}) {
  const props = {
    geometry: 'card' as const,
    coverAssetId: ASSET,
    coverVariantWidths: LADDER,
    coverAlt: 'cover-alt',
    ...overrides,
  };
  // biome-ignore lint/suspicious/noExplicitAny: the fixture spreads a partial prop bag on purpose
  return render(<CommunityCover {...(props as any)} />);
}

function header(overrides: Record<string, unknown> = {}) {
  const props = {
    name: 'community-name',
    description: 'community-description',
    backHref: '/comunidades',
    backLabel: 'back-label',
    coverAssetId: null,
    coverVariantWidths: [],
    coverAlt: 'cover-alt',
    ...overrides,
  };
  // biome-ignore lint/suspicious/noExplicitAny: the fixture spreads a partial prop bag on purpose
  return render(<CommunityHeader {...(props as any)} />);
}

describe('CommunityCover — one component, two geometries, two branches (UI-D-35)', () => {
  it('1. a cover asset takes the IMAGE branch, at the card geometry, with the host overlay on top', () => {
    cover({ overlay: <span>overlay-node</span> });

    const box = screen.getByTestId('community-cover-image');
    expect(box).toBeInTheDocument();
    expect(box.getAttribute('data-geometry')).toBe('card');
    expect(box.className).toContain('aspect-[16/7]');
    // The BRANCH, deliberately not a loaded bitmap (the 05-01 lesson, restated at unit scale):
    // `MediaImage`'s documented contract is that an object it cannot fetch degrades to the neutral
    // `bg-bg-tertiary` box, and under happy-dom NOTHING fetches — so an `alt` assertion here would
    // be measuring the test environment rather than the component. The veil is the photograph
    // branch's own mark, and it is what the gradient branch must never carry.
    expect(within(box).getByTestId('community-cover-media')).toBeInTheDocument();
    expect(box.innerHTML).toContain('from-black/85');
    expect(screen.getByText('overlay-node')).toBeInTheDocument();
    expect(screen.queryByTestId('community-cover-fallback')).toBeNull();
  });

  it('2. a NULL cover takes the gradient branch and, on the card, carries the host fallback overlay', () => {
    cover({
      coverAssetId: null,
      coverVariantWidths: [],
      fallbackOverlay: <span>fallback-node</span>,
    });

    const box = screen.getByTestId('community-cover-fallback');
    expect(box).toBeInTheDocument();
    expect(box.getAttribute('data-geometry')).toBe('card');
    expect(box.className).toContain('aspect-[16/7]');
    // D-69: the brand gradient itself, as a runtime tenant variable — never `bg-bg-tertiary`.
    expect(box.getAttribute('style')).toContain('var(--brand-gradient)');
    // UI-D-35: the persisted contrast ink, never a raw white on a tenant hex nobody has seen.
    const overlay = screen.getByText('fallback-node').parentElement;
    expect(overlay?.getAttribute('style')).toContain('var(--brand-on-primary)');
    // …and NO black scrim: the gradient already carries its own contrast.
    expect(box.innerHTML).not.toContain('from-black');
    expect(box.querySelector('img')).toBeNull();
  });

  it('3. the PAGE geometry is h-36 and its gradient fallback carries NO text at all', () => {
    cover({
      geometry: 'page',
      coverAssetId: null,
      coverVariantWidths: [],
      fallbackOverlay: <span>fallback-node</span>,
    });

    const box = screen.getByTestId('community-cover-fallback');
    expect(box.getAttribute('data-geometry')).toBe('page');
    expect(box.className).toContain('h-36');
    expect(box.className).not.toContain('aspect-[16/7]');
    // The page's name always renders BELOW the cover, so a fallback that carried it would double it.
    expect(screen.queryByText('fallback-node')).toBeNull();
  });

  it('4. the box keeps its height on every branch, and the free slot renders inside it', () => {
    const { unmount } = cover({ geometry: 'page', children: <span>slot-node</span> });
    const image = screen.getByTestId('community-cover-image');
    expect(image.className).toContain('h-36');
    expect(screen.getByText('slot-node')).toBeInTheDocument();
    unmount();

    // Loading and failed both degrade INSIDE the same box (the Phase 3 CLS rule): a cover that
    // cannot be rendered differs from a cover-less community in ink only, never in layout.
    cover({
      geometry: 'page',
      coverAssetId: null,
      coverVariantWidths: [],
      children: <span>slot-node</span>,
    });
    const fallback = screen.getByTestId('community-cover-fallback');
    expect(fallback.className).toContain('h-36');
    expect(screen.getByText('slot-node')).toBeInTheDocument();
  });
});

describe('CommunityHeader — UI-D-43 without D-67’s owner block', () => {
  it('5. renders the cover, the back control, the name and the description — and nothing else', () => {
    header();

    expect(screen.getByRole('heading', { name: 'community-name' })).toBeInTheDocument();
    expect(screen.getByText('community-description')).toBeInTheDocument();

    const back = screen.getByRole('link', { name: 'back-label' });
    expect(back).toHaveAttribute('href', '/comunidades');
    // UI-D-07: 44×44, the prototype's 36px normalised.
    expect(back.className).toContain('min-h-[44px]');
    expect(back.className).toContain('min-w-[44px]');

    // D-67: no avatar, no credit line, no badge. The container has no human byline at all, so there
    // is no second image and no second name in the header.
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('6. the name and the description both WRAP — the name is the page’s anchor and must not clip', () => {
    header();

    const name = screen.getByRole('heading', { name: 'community-name' });
    expect(name.className).not.toContain('truncate');
    expect(name.className).not.toContain('line-clamp');
    expect(name.className).toContain('tracking-[-0.02em]');

    const description = screen.getByText('community-description');
    expect(description.className).not.toContain('truncate');
    expect(description.className).not.toContain('line-clamp');
  });

  it('7. the status pill sits beside the name and the note under the description — both optional', () => {
    const { unmount } = header();
    expect(screen.queryByText('pill-node')).toBeNull();
    expect(screen.queryByText('note-node')).toBeNull();
    unmount();

    header({ statusPill: <span>pill-node</span>, note: <span>note-node</span> });
    expect(screen.getByText('pill-node')).toBeInTheDocument();
    expect(screen.getByText('note-node')).toBeInTheDocument();
  });

  it('8. an empty description closes the header up — no reserved height, no placeholder line', () => {
    header({ description: '' });

    expect(screen.getByRole('heading', { name: 'community-name' })).toBeInTheDocument();
    expect(screen.queryByTestId('community-description')).toBeNull();
  });
});
