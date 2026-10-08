// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CommunityCard } from '../ui/CommunityCard';
import { CommunityCover } from '../ui/CommunityCover';

/**
 * UI-D-372 (08.2-09): the card's optional `coverBadge` slot — the store's "Exclusiva" pill on the
 * list card's cover.
 *
 * The badge sits `absolute top-3 left-3 z-10` inside the cover box on BOTH branches (photo and
 * gradient), inside the card's single anchor, so its text is read with the link and adds no focus
 * stop. Nothing else about the card changes: no grayscale, no extra veil, the same name,
 * description and count. `CommunityCover` passes it through for the `card` geometry only.
 */

afterEach(cleanup);

const ASSET = 'a1111111-1111-4111-8111-111111111111';

function card(overrides: Record<string, unknown> = {}) {
  const props = {
    href: '/comunidades/c1',
    name: 'community-name',
    description: 'community-description',
    coverAssetId: ASSET,
    coverVariantWidths: [640, 1080],
    postCountLabel: '24-posts',
    coverAlt: 'cover-alt',
    ...overrides,
  };
  // biome-ignore lint/suspicious/noExplicitAny: the fixture spreads a partial prop bag on purpose
  return render(<CommunityCard {...(props as any)} />);
}

const BADGE = <span data-testid="badge-node">badge-text</span>;

describe('CommunityCard coverBadge (UI-D-372)', () => {
  it('1. photo branch: the badge renders inside the cover box and inside the single link', () => {
    card({ coverBadge: BADGE });
    const link = screen.getByTestId('community-card');
    const box = within(link).getByTestId('community-cover-image');
    const slot = within(box).getByTestId('community-cover-badge');
    expect(slot.className).toContain('absolute');
    expect(slot.className).toContain('top-3');
    expect(slot.className).toContain('left-3');
    expect(slot.className).toContain('z-10');
    expect(within(slot).getByText('badge-text')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('2. gradient branch: the badge renders inside the fallback box and inside the link', () => {
    card({ coverBadge: BADGE, coverAssetId: null });
    const link = screen.getByTestId('community-card');
    const box = within(link).getByTestId('community-cover-fallback');
    expect(within(box).getByTestId('community-cover-badge')).toBeInTheDocument();
    expect(within(box).getByText('badge-text')).toBeInTheDocument();
  });

  it('3. the card keeps its content and adds no grayscale or extra veil', () => {
    card({ coverBadge: BADGE });
    expect(screen.getByText('community-name')).toBeInTheDocument();
    expect(screen.getByText('community-description')).toBeInTheDocument();
    expect(screen.getByText('24-posts')).toBeInTheDocument();
    const box = screen.getByTestId('community-cover-image');
    expect(box.innerHTML).not.toContain('grayscale');
    // One veil only: the shipped card veil.
    expect(box.querySelectorAll('[aria-hidden="true"]').length).toBe(1);
  });

  it('4. without a badge the card renders exactly as before (no badge slot)', () => {
    card();
    expect(screen.queryByTestId('community-cover-badge')).toBeNull();
  });

  it('5. the status pill and the badge are independent slots', () => {
    card({ coverBadge: BADGE, statusPill: <span>pill-text</span> });
    const box = screen.getByTestId('community-cover-image');
    expect(within(box).queryByText('pill-text')).toBeNull();
    expect(screen.getByText('pill-text')).toBeInTheDocument();
  });

  it('6. CommunityCover ignores the badge on the page geometry', () => {
    render(
      <CommunityCover
        geometry="page"
        coverAssetId={ASSET}
        coverVariantWidths={[640]}
        coverAlt="cover-alt"
        coverBadge={BADGE}
      />,
    );
    expect(screen.queryByTestId('community-cover-badge')).toBeNull();
    expect(screen.queryByText('badge-text')).toBeNull();
  });
});
