// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PostHeader } from '../ui/PostHeader';

/**
 * D-71 / UI-D-36 — the "em {Comunidade}" segment of the card's meta row, asserted as OBSERVABLE
 * contract rather than as markup.
 *
 * Four rules, and each one is a sentence the row either keeps or breaks:
 *
 *  1. **A community post says where it came from, and links there.** Criterion 1 of the phase mixes
 *     two sources into one list; an unlabelled post misrepresents its origin to the member reading
 *     it, and the label is also the only discovery path from the feed into a community.
 *  2. **A tenant-wide post renders the `<time>` ALONE** — no middot, no empty node, no dangling
 *     separator. That is UI-D-21's meta-row rule restated: a segment that has nothing to say is
 *     absent, never blank.
 *  3. **The segment is SUPPRESSIBLE**, because on the community's own page it would restate the
 *     page the reader is standing on (UI-D-36).
 *  4. **The module ships no words and builds no route.** Every string and the href arrive as props;
 *     `scripts/check-ui-literals.sh` catches the same rule from the other side.
 *
 * Sentinel ASCII strings throughout, exactly as `post-media.test.tsx` uses them: a pt-BR literal
 * appearing in the component is not this file's job to catch.
 */

afterEach(cleanup);

const BASE = {
  displayName: 'Ana Admin',
  profileHref: '/membros/m1',
  avatarUrl: null,
  createdAtIso: '2026-09-23T12:00:00.000Z',
  createdAtRelative: 'relative-time',
  createdAtAbsolute: 'absolute-time',
};

const COMMUNITY = {
  label: 'in-community-label',
  href: '/comunidades/c1',
  ariaLabel: 'community-aria-label',
};

describe('PostHeader — the D-71 community segment (UI-D-36)', () => {
  it('1. renders the time, a middot and the community link when a community is supplied', () => {
    render(<PostHeader {...BASE} community={COMMUNITY} />);

    const link = screen.getByRole('link', { name: COMMUNITY.ariaLabel });
    expect(link).toHaveAttribute('href', '/comunidades/c1');
    expect(link).toHaveTextContent('in-community-label');
    // The host built the route; the module assembled neither a path nor a word.
    expect(link.textContent).not.toContain('/comunidades');

    // The middot is decoration between two real strings, so it is hidden from the a11y tree.
    const middot = document.querySelector('[data-post-community-sep]');
    expect(middot).not.toBeNull();
    expect(middot).toHaveAttribute('aria-hidden');
  });

  it('2. the community name is the only part that truncates — the time never does', () => {
    render(<PostHeader {...BASE} community={COMMUNITY} />);

    const link = screen.getByRole('link', { name: COMMUNITY.ariaLabel });
    expect(link.className).toContain('truncate');
    expect(link.className).toContain('min-w-0');
    // UI-D-36: 12/700 SECONDARY, deliberately not brand — the author's own name link is not brand
    // either, and a brand community link in the same card would claim the community outranks the
    // person who wrote the post.
    expect(link.className).toContain('text-text-secondary');
    expect(link.className).not.toContain('text-brand');

    const time = document.querySelector('time');
    expect(time?.className).toContain('shrink-0');
  });

  it('3. a tenant-wide post renders the time ALONE — no middot, no empty node', () => {
    render(<PostHeader {...BASE} community={null} />);

    expect(screen.queryByRole('link', { name: COMMUNITY.ariaLabel })).toBeNull();
    expect(document.querySelector('[data-post-community-sep]')).toBeNull();
    expect(screen.getByText('relative-time')).toBeInTheDocument();
  });

  it('4. suppressCommunity renders the time alone even when a community IS supplied', () => {
    render(<PostHeader {...BASE} community={COMMUNITY} suppressCommunity />);

    expect(screen.queryByRole('link', { name: COMMUNITY.ariaLabel })).toBeNull();
    expect(document.querySelector('[data-post-community-sep]')).toBeNull();
    // The author's own link is untouched by the suppression — only the community segment goes.
    expect(screen.getByRole('link', { name: 'Ana Admin' })).toBeInTheDocument();
  });
});

describe('PostHeader — the administrator mark (2026-10-06)', () => {
  it('draws the crown after the name, named by the host label', () => {
    render(<PostHeader {...BASE} adminLabel="admin-badge" />);
    const crown = screen.getByRole('img', { name: 'admin-badge' });
    expect(crown).toHaveAttribute('data-admin-badge', 'crown');
    // The name stays the link, untouched by the mark beside it.
    expect(screen.getByRole('link', { name: 'Ana Admin' })).toBeInTheDocument();
  });

  it('draws the icon the administrator picked, under the same name', () => {
    render(<PostHeader {...BASE} adminLabel="admin-badge" adminIcon="star" />);
    expect(screen.getByRole('img', { name: 'admin-badge' })).toHaveAttribute(
      'data-admin-badge',
      'star',
    );
  });

  it('draws no mark without the label, even with an icon', () => {
    render(<PostHeader {...BASE} adminIcon="star" />);
    expect(document.querySelector('[data-admin-badge]')).toBeNull();
  });
});

describe('PostHeader — the author’s Instagram line (2026-10-09)', () => {
  const HANDLE = {
    label: 'handle-label',
    href: 'https://instagram.example/handle',
    ariaLabel: 'handle-aria-label',
  };

  it('renders the host’s handle as its own link between the name and the time, in a new tab', () => {
    render(<PostHeader {...BASE} handle={HANDLE} />);

    const link = screen.getByRole('link', { name: 'handle-aria-label' });
    expect(link).toHaveAttribute('href', 'https://instagram.example/handle');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('data-post-handle');
    expect(link).toHaveTextContent('handle-label');
    for (const cls of ['text-xs', 'text-text-tertiary', 'truncate', 'focus-visible:ring-2']) {
      expect(link.className).toContain(cls);
    }

    // Name, then the handle, then the time: the line sits between the two rows.
    const name = screen.getByRole('link', { name: 'Ana Admin' });
    const time = document.querySelector('time') as HTMLElement;
    expect(name.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Its own line: not inside the name's row, not inside the time's.
    expect(name.parentElement?.contains(link)).toBe(false);
    expect(time.parentElement?.contains(link)).toBe(false);
  });

  it('absent or null renders no line at all, and the name stays the only link', () => {
    const { rerender } = render(<PostHeader {...BASE} />);
    expect(document.querySelector('[data-post-handle]')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);

    rerender(<PostHeader {...BASE} handle={null} />);
    expect(document.querySelector('[data-post-handle]')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});
