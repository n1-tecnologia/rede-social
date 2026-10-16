// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { Pencil, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 2026-10-12 — the own-profile hero of `/perfil` (`ProfileHero`, `ProfileHeroAction`,
 * `ProfileHeroSkeleton`).
 *
 * Claims:
 *  1. the icon links sit inside the brand band and come FIRST in the DOM, before the avatar, so the
 *     focus order is the reading order;
 *  2. the name is an `h2` that wraps (never `truncate`), with the administrator mark after it;
 *  3. the Instagram handle is ONE link opening a new tab, never inside a paragraph;
 *  4. the hero's paragraphs are exactly the e-mail and the bio, and no bio means no paragraph;
 *  5. without a photo the avatar is the neutral icon named after the person; with one, the photo
 *     is requested for the 96px seat (`w320` over the avatar ladder, eager);
 *  6. there is no `<header>` (the profile spec asserts `main header` is absent);
 *  7. the skeleton keeps the band and the seat, and is not a hero;
 *  8. `phone` drops the desktop band (the platform preview draws a phone in a desktop window).
 *
 * Stubbed: `MediaImage` as a marker echoing what it was asked for (the request is the subject, not
 * the bitmap) and `next/link` as a plain anchor. The web workspace has no jest-dom: plain DOM
 * assertions only.
 */

vi.mock('@/components/media/MediaImage', async () => {
  const { createElement } = await import('react');
  return {
    MediaImage: (props: {
      sizes: string;
      baseWidth?: number;
      eager?: boolean;
      alt: string;
      widths: readonly number[];
    }) =>
      createElement('span', {
        'data-media-image': props.alt,
        'data-sizes': props.sizes,
        'data-base-width': String(props.baseWidth),
        'data-eager': String(props.eager),
        'data-widths': props.widths.join(','),
      }),
  };
});

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      createElement('a', { href, ...rest }, children),
  };
});

const { PROFILE_HERO_ACTION, ProfileHero, ProfileHeroAction, ProfileHeroSkeleton } = await import(
  './ProfileHero'
);

const INSTAGRAM = {
  label: '@ana.souza',
  href: 'https://instagram.com/ana.souza',
  ariaLabel: 'Ver @ana.souza no Instagram',
};

const ACTIONS = (
  <>
    <ProfileHeroAction href="/perfil/editar" label="Editar perfil" icon={Pencil} />
    <ProfileHeroAction href="/configuracoes" label="Configurações" icon={Settings} />
  </>
);

const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;

function heroOf(container: HTMLElement): HTMLElement {
  const hero = container.querySelector<HTMLElement>('[data-profile-hero]');
  if (!hero) throw new Error('no [data-profile-hero]');
  return hero;
}

afterEach(cleanup);

describe('ProfileHero (2026-10-12)', () => {
  it('1. the icon links sit inside the band, first in the DOM, before the avatar', () => {
    const { container } = render(
      <ProfileHero
        displayName="Ana Souza"
        avatarAssetId={null}
        bio="Corro aos domingos."
        email="ana@example.com"
        instagram={INSTAGRAM}
        actions={ACTIONS}
      />,
    );
    const band = heroOf(container).firstElementChild as HTMLElement;
    expect(band.className).toContain('bg-(image:--brand-gradient)');

    const edit = screen.getByRole('link', { name: 'Editar perfil' });
    const settings = screen.getByRole('link', { name: 'Configurações' });
    expect(band.contains(edit)).toBe(true);
    expect(band.contains(settings)).toBe(true);
    for (const action of [edit, settings]) {
      expect(action.hasAttribute('data-profile-action')).toBe(true);
      expect(action.className).toBe(PROFILE_HERO_ACTION);
      expect(action.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
    expect(edit.getAttribute('href')).toBe('/perfil/editar');
    expect(settings.getAttribute('href')).toBe('/configuracoes');

    const avatar = screen.getByRole('img', { name: 'Ana Souza' });
    expect(settings.compareDocumentPosition(avatar) & FOLLOWING).toBeTruthy();
    // The focus order: the two corner icons, then the Instagram link.
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/perfil/editar',
      '/configuracoes',
      INSTAGRAM.href,
    ]);
  });

  it('2. the name is an h2 that wraps, with the administrator mark after it', () => {
    render(
      <ProfileHero
        displayName="Ana Souza"
        avatarAssetId={null}
        bio={null}
        adminLabel="Administrador"
        adminIcon="star"
      />,
    );
    const name = screen.getByRole('heading', { level: 2, name: 'Ana Souza' });
    expect(name.hasAttribute('data-profile-name')).toBe(true);
    expect(name.className).not.toContain('truncate');
    expect(name.className).toContain('break-words');
    expect(name.className).toContain('text-2xl');

    const badge = screen.getByRole('img', { name: 'Administrador' });
    expect(badge.getAttribute('data-admin-badge')).toBe('star');
    expect(name.compareDocumentPosition(badge) & FOLLOWING).toBeTruthy();
  });

  it('3. one Instagram link, opening a new tab, never inside a paragraph', () => {
    render(
      <ProfileHero
        displayName="Ana Souza"
        avatarAssetId={null}
        bio="Corro aos domingos."
        email="ana@example.com"
        instagram={INSTAGRAM}
      />,
    );
    const link = screen.getByRole('link', { name: INSTAGRAM.ariaLabel });
    expect(document.querySelectorAll('[data-profile-instagram]')).toHaveLength(1);
    expect(link.getAttribute('href')).toBe(INSTAGRAM.href);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toBe('@ana.souza');
    expect(link.className).toContain('truncate');
    // 2026-10-13: the identity is centred on the band, the link as wide as its text.
    expect(link.parentElement?.className).toContain('items-center');
    expect(link.parentElement?.className).toContain('text-center');
    expect(link.closest('p')).toBeNull();

    const name = screen.getByRole('heading', { name: 'Ana Souza' });
    expect(name.compareDocumentPosition(link) & FOLLOWING).toBeTruthy();
    expect(
      link.compareDocumentPosition(screen.getByText('ana@example.com')) & FOLLOWING,
    ).toBeTruthy();
  });

  it('4. the paragraphs are exactly the e-mail and the bio; no bio, no paragraph', () => {
    const props = { displayName: 'Ana Souza', avatarAssetId: null, instagram: INSTAGRAM };
    const paragraphs = (container: HTMLElement) =>
      Array.from(heroOf(container).querySelectorAll('p')).map((p) => p.textContent);

    const { container, rerender } = render(
      <ProfileHero {...props} email="ana@example.com" bio="Corro aos domingos." />,
    );
    expect(paragraphs(container)).toEqual(['ana@example.com', 'Corro aos domingos.']);
    const bio = screen.getByText('Corro aos domingos.');
    expect(bio.className).toContain('max-w-md');
    expect(bio.className).toContain('break-words');

    rerender(<ProfileHero {...props} email="ana@example.com" bio={null} />);
    expect(paragraphs(container)).toEqual(['ana@example.com']);
    rerender(<ProfileHero {...props} email="ana@example.com" bio="   " />);
    expect(paragraphs(container)).toEqual(['ana@example.com']);
    rerender(<ProfileHero {...props} bio={null} />);
    expect(paragraphs(container)).toEqual([]);
  });

  it('5. the avatar: the person-named icon without a photo, the 96px request with one', () => {
    const { container, rerender } = render(
      <ProfileHero displayName="Ana Souza" avatarAssetId={null} bio={null} />,
    );
    const icon = screen.getByRole('img', { name: 'Ana Souza' });
    expect(icon.className).toContain('h-24');
    expect(icon.className).toContain('w-24');
    expect(container.querySelector('[data-media-image]')).toBeNull();
    // The seat cuts the circle out of the band and paints above it.
    const seat = icon.parentElement as HTMLElement;
    for (const token of ['relative', '-mt-12', 'ring-4', 'ring-bg', 'rounded-full']) {
      expect(seat.className.split(' ')).toContain(token);
    }

    rerender(<ProfileHero displayName="Ana Souza" avatarAssetId="asset-1" bio={null} />);
    const photo = container.querySelector('[data-media-image]');
    expect(photo?.getAttribute('data-media-image')).toBe('Ana Souza');
    expect(photo?.getAttribute('data-sizes')).toBe('96px');
    expect(photo?.getAttribute('data-base-width')).toBe('320');
    expect(photo?.getAttribute('data-eager')).toBe('true');
    expect(photo?.getAttribute('data-widths')).toBe('128,320');
  });

  it('6. no header element: the root is the data-profile-hero div', () => {
    const { container } = render(
      <ProfileHero
        displayName="Ana Souza"
        avatarAssetId={null}
        bio="Corro aos domingos."
        email="ana@example.com"
        instagram={INSTAGRAM}
        actions={ACTIONS}
      />,
    );
    expect(container.querySelector('header')).toBeNull();
    expect(heroOf(container).tagName).toBe('DIV');
  });

  it('7. the skeleton keeps the band and the seat, and is not a hero', () => {
    const { container } = render(<ProfileHeroSkeleton />);
    expect(container.querySelector('[data-profile-hero]')).toBeNull();
    const root = screen.getByTestId('profile-hero-skeleton');
    expect(root.getAttribute('aria-busy')).toBe('true');
    const band = root.firstElementChild as HTMLElement;
    expect(band.className).toContain('h-28');
    expect(band.className).toContain('md:h-36');
    expect(band.className).toContain('bg-(image:--brand-gradient)');
    const seat = band.nextElementSibling as HTMLElement;
    expect(seat.className).toContain('-mt-12');
    expect(seat.firstElementChild?.className).toContain('h-24');
  });

  it('8. `phone` keeps the phone band whatever the window (the platform preview’s device)', () => {
    const props = { displayName: 'Ana Souza', avatarAssetId: null, bio: null } as const;
    const responsive = render(<ProfileHero {...props} />);
    const desktopBand = heroOf(responsive.container).firstElementChild as HTMLElement;
    expect(desktopBand.className).toContain('md:h-36');
    expect(desktopBand.className).toContain('md:rounded-2xl');
    cleanup();

    const phone = render(<ProfileHero {...props} phone />);
    const phoneBand = heroOf(phone.container).firstElementChild as HTMLElement;
    expect(phoneBand.className).toContain('h-28');
    expect(phoneBand.className).toContain('bg-(image:--brand-gradient)');
    expect(phoneBand.className).not.toContain('md:');
  });
});
