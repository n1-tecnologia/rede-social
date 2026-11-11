// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CommunityCard } from '../ui/CommunityCard';

/**
 * 10-13 (UI-D-708): the card's optional `byline` string in the counts row.
 *
 * The host passes the FINISHED string ("Criada por Helena"; the module ships no words). The row
 * reads the count (`shrink-0 tabular-nums`, so it never truncates), an `aria-hidden` middot and the
 * byline (`min-w-0 truncate`, so a long name truncates). The card stays ONE link, the name is plain
 * text inside it (OQ-2: a nested anchor would be invalid), and a card without a byline is exactly
 * what it always was.
 */

afterEach(cleanup);

function card(overrides: Record<string, unknown> = {}) {
  const props = {
    href: '/comunidades/c1',
    name: 'community-name',
    description: 'community-description',
    coverAssetId: null,
    coverVariantWidths: [],
    postCountLabel: '24-posts',
    coverAlt: 'cover-alt',
    ...overrides,
  };
  // biome-ignore lint/suspicious/noExplicitAny: the fixture spreads a partial prop bag on purpose
  return render(<CommunityCard {...(props as any)} />);
}

describe('CommunityCard byline (UI-D-708)', () => {
  it('1. the count never truncates and the byline does, in one row', () => {
    card({ byline: 'byline-text' });
    const link = screen.getByTestId('community-card');
    const count = within(link).getByText('24-posts');
    const byline = within(link).getByText('byline-text');
    expect(count.className).toContain('shrink-0');
    expect(count.className).toContain('tabular-nums');
    expect(count.className).not.toContain('truncate');
    expect(byline.className).toContain('min-w-0');
    expect(byline.className).toContain('truncate');
    // Same row: one parent holds the count and the byline.
    expect(count.parentElement).toBe(byline.parentElement);
  });

  it('2. the middot is decorative and sits between the count and the byline', () => {
    card({ byline: 'byline-text' });
    const link = screen.getByTestId('community-card');
    const dot = link.querySelector('[aria-hidden="true"]:not(svg)') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.textContent).toBe('·');
    const row = within(link).getByText('24-posts').parentElement as HTMLElement;
    const order = Array.from(row.children).map((node) => node.textContent);
    expect(order).toEqual(['24-posts', '·', 'byline-text']);
  });

  it('3. the card stays ONE link and the name in the byline is plain text', () => {
    card({ byline: 'byline-text' });
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('byline-text').closest('a')).toBe(screen.getByTestId('community-card'));
    expect(screen.getByText('byline-text').querySelector('a')).toBeNull();
  });

  it('4. without a byline the counts row is the shipped one (no middot)', () => {
    card();
    const link = screen.getByTestId('community-card');
    expect(within(link).getByText('24-posts')).toBeInTheDocument();
    expect(link.textContent).not.toContain('·');
  });

  it('5. the byline sits beside the status pill without displacing it', () => {
    card({ byline: 'byline-text', statusPill: <span data-testid="pill">Arquivada</span> });
    const link = screen.getByTestId('community-card');
    expect(within(link).getByTestId('pill')).toBeInTheDocument();
    expect(within(link).getByText('byline-text')).toBeInTheDocument();
  });
});
