// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { CommunityCard, type CommunityCardProps } from '../ui/CommunityCard';
import { CommunityCover } from '../ui/CommunityCover';

/**
 * 2026-10-12 — the compact community card (`variant="tile"`) of the `/perfil` "Comunidades" rail,
 * and the `tile` cover geometry under it.
 *
 * Claims:
 *  1. the tile's cover is the 16:9 box, inside the card's ONE link (same `data-testid`);
 *  2. its image asks for the 256px slot (`sizes="256px"`), while the list card keeps the full-bleed
 *     `sizes` — a phone must not fetch the 1600px rung for a 256px card;
 *  3. the tile shows the name and the counts row, and NO description;
 *  4. without a cover, the tile's gradient still carries the name (UI-D-35) and the badge;
 *  5. the `list` variant (the default) renders exactly as before.
 *
 * happy-dom reports every image as failed after mount, so the `<img>` attributes are read from the
 * server render (the first paint a phone gets). Sentinel ASCII only: the module ships no words.
 */

afterEach(cleanup);

const ASSET = 'a1111111-1111-4111-8111-111111111111';
const LADDER = [640, 1080, 1600] as const;
const FULL_BLEED = '(min-width: 680px) 680px, 100vw';

const BASE: CommunityCardProps = {
  href: '/comunidades/c1',
  name: 'community-name',
  description: 'community-description',
  coverAssetId: ASSET,
  coverVariantWidths: LADDER,
  postCountLabel: '24-posts',
  coverAlt: 'cover-alt',
};

/** The `<img>` of a server-rendered card, parsed back into a DOM. */
function serverImage(props: CommunityCardProps): HTMLImageElement | null {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<CommunityCard {...props} />);
  return host.querySelector('img');
}

describe('CommunityCard variant="tile" (2026-10-12)', () => {
  it('1. the cover is the 16:9 tile box, inside the single link', () => {
    render(<CommunityCard {...BASE} variant="tile" />);
    const link = screen.getByTestId('community-card');
    const box = within(link).getByTestId('community-cover-image');
    expect(box.getAttribute('data-geometry')).toBe('tile');
    expect(box.className).toContain('aspect-[16/9]');
    expect(box.className).not.toContain('aspect-[16/7]');
    // The photograph keeps the card's veil: the name sits on the image.
    expect(box.innerHTML).toContain('from-black/85');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(link).toHaveAttribute('href', '/comunidades/c1');
  });

  it('2. the image asks for the 256px slot; the list keeps the full-bleed sizes', () => {
    const tile = serverImage({ ...BASE, variant: 'tile' });
    expect(tile).not.toBeNull();
    expect(tile?.getAttribute('sizes')).toBe('256px');
    expect(tile?.getAttribute('srcset')).toContain('w640 640w');

    const list = serverImage(BASE);
    expect(list?.getAttribute('sizes')).toBe(FULL_BLEED);
  });

  it('3. the name and the counts row, and no description', () => {
    render(<CommunityCard {...BASE} variant="tile" />);
    const name = screen.getByText('community-name');
    expect(name.tagName).toBe('P');
    // `p.font-bold` is the hook the tenant's title font reaches (globals.css).
    expect(name).toHaveClass('font-bold', 'line-clamp-2', 'text-white');
    expect(screen.queryByText('community-description')).toBeNull();
    expect(screen.getByText('24-posts')).toBeInTheDocument();
  });

  it('4. without a cover, the gradient carries the name in the brand ink, and the badge', () => {
    render(
      <CommunityCard
        {...BASE}
        variant="tile"
        coverAssetId={null}
        coverVariantWidths={[]}
        coverBadge={<span>badge-text</span>}
      />,
    );
    const box = screen.getByTestId('community-cover-fallback');
    expect(box.getAttribute('data-geometry')).toBe('tile');
    expect(box.className).toContain('aspect-[16/9]');
    const name = within(box).getByText('community-name');
    expect(name.parentElement?.getAttribute('style')).toContain('var(--brand-on-primary)');
    expect(within(box).getByTestId('community-cover-badge')).toHaveTextContent('badge-text');
    expect(screen.queryByText('community-description')).toBeNull();
  });

  it('5. the list variant is the default and renders exactly as before', () => {
    expect(renderToStaticMarkup(<CommunityCard {...BASE} variant="list" />)).toBe(
      renderToStaticMarkup(<CommunityCard {...BASE} />),
    );

    render(<CommunityCard {...BASE} />);
    const box = screen.getByTestId('community-cover-image');
    expect(box.getAttribute('data-geometry')).toBe('card');
    expect(box.className).toContain('aspect-[16/7]');
    expect(screen.getByText('community-name')).toHaveClass('truncate', 'text-base', 'font-bold');
    expect(screen.getByText('community-description')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('6. the tile geometry on the cover alone: the 16:9 box, the fallback text and the badge', () => {
    render(
      <CommunityCover
        geometry="tile"
        coverAssetId={null}
        coverVariantWidths={[]}
        coverAlt="cover-alt"
        fallbackOverlay={<span>fallback-node</span>}
        coverBadge={<span>badge-text</span>}
      />,
    );
    const box = screen.getByTestId('community-cover-fallback');
    expect(box.className).toContain('aspect-[16/9]');
    expect(screen.getByText('fallback-node')).toBeInTheDocument();
    expect(screen.getByText('badge-text')).toBeInTheDocument();
  });
});
