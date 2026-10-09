// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 2026-10-09 — the member's Instagram in the profile header (`/perfil`, `/membros/[id]`).
 *
 * Claims:
 *  1. the handle is ONE link under the name and before the e-mail, opening Instagram in a new tab,
 *     named by the host's accessible label;
 *  2. it is never a paragraph, so the screen's paragraphs stay the e-mail and the bio (the profile
 *     spec counts them);
 *  3. without a handle there is no link at all.
 *
 * Stubbed: `MediaImage` (a photo is not this file's subject). The web workspace has no jest-dom:
 * plain DOM assertions only.
 */

vi.mock('@/components/media/MediaImage', () => ({ MediaImage: () => null }));

const { ProfileHeader } = await import('./ProfileHeader');

const INSTAGRAM = {
  label: '@ana.souza',
  href: 'https://instagram.com/ana.souza',
  ariaLabel: 'Ver @ana.souza no Instagram',
};

afterEach(cleanup);

describe('ProfileHeader — the Instagram line (2026-10-09)', () => {
  it('1. one link under the name and before the e-mail, opening a new tab', () => {
    render(
      <ProfileHeader
        displayName="Ana Souza"
        avatarAssetId={null}
        bio="Corro aos domingos."
        email="ana@example.com"
        instagram={INSTAGRAM}
      />,
    );

    const link = screen.getByRole('link', { name: INSTAGRAM.ariaLabel });
    expect(link.getAttribute('href')).toBe(INSTAGRAM.href);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toBe('@ana.souza');
    expect(link.className).toContain('truncate');

    const name = screen.getByRole('heading', { name: 'Ana Souza' });
    const email = screen.getByText('ana@example.com');
    expect(name.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('2. never a paragraph: the paragraphs stay the e-mail and the bio', () => {
    const { container } = render(
      <ProfileHeader
        displayName="Ana Souza"
        avatarAssetId={null}
        bio="Corro aos domingos."
        email="ana@example.com"
        instagram={INSTAGRAM}
      />,
    );
    const link = screen.getByRole('link', { name: INSTAGRAM.ariaLabel });
    expect(link.closest('p')).toBeNull();
    expect(Array.from(container.querySelectorAll('p')).map((p) => p.textContent)).toEqual([
      'ana@example.com',
      'Corro aos domingos.',
    ]);
  });

  it('3. without a handle there is no link at all', () => {
    const { rerender } = render(
      <ProfileHeader displayName="Ana Souza" avatarAssetId={null} bio={null} />,
    );
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    rerender(
      <ProfileHeader displayName="Ana Souza" avatarAssetId={null} bio={null} instagram={null} />,
    );
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(document.querySelector('[data-profile-instagram]')).toBeNull();
  });
});
