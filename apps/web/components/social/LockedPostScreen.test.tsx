// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09-11 (D-469, D-470, UI-D-499, UI-D-511): the "Siga para ver" host screen, against the REAL pt-BR
 * catalog through next-intl's own translator. Stubbed: the follow actions, the toast, the router and
 * the media image. The claims: the screen shows the author and ONE action and nothing of the post
 * (it is only handed the author), the avatar is a link to the profile with a decorative lock disc, a
 * successful follow marks the focus and refreshes the same URL exactly once, and while that refresh
 * is in flight the card is replaced by a card-shaped skeleton that is `aria-busy`.
 */

const { toast, follow, unfollow, refresh } = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  follow: vi.fn(),
  unfollow: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next-intl', async (orig) => {
  const actual = await orig<typeof import('next-intl')>();
  const { join } = await import('node:path');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

vi.mock('./follow-actions', () => ({ followAction: follow, unfollowAction: unfollow }));

vi.mock('@/components/media/MediaImage', () => ({
  MediaImage: ({ assetId, alt }: { assetId: string; alt: string }) => (
    <span role="img" data-asset-id={assetId} aria-label={alt} />
  ),
}));

/**
 * A router refresh that has not landed: a transition whose synchronous callback leaves `pending` true
 * (the real one stays pending until the server's answer commits). An async callback (the follow
 * toggle) settles as usual.
 */
vi.mock('react', async (orig) => {
  const actual = await orig<typeof import('react')>();
  return {
    ...actual,
    useTransition: () => {
      const [pending, setPending] = actual.useState(false);
      const start = (callback: () => unknown) => {
        setPending(true);
        const result = callback();
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          (result as Promise<unknown>).finally(() => setPending(false));
        }
      };
      return [pending, start] as const;
    },
  };
});

const { LockedPostScreen } = await import('./LockedPostScreen');
const { consumeFocusAfterFollow } = await import('./post-focus');

const MEMBERSHIP = '11111111-1111-4111-8111-111111111111';
const AVATAR = '44444444-4444-4444-8444-444444444444';
const POST = '55555555-5555-4555-8555-555555555555';

function renderScreen(
  author = {
    membershipId: MEMBERSHIP,
    displayName: 'Helena Küster',
    avatarAssetId: AVATAR as string | null,
  },
) {
  const name = author.displayName;
  return render(
    <LockedPostScreen
      author={author}
      postId={POST}
      title="Publicação"
      backHref="/inicio"
      backLabel="Voltar"
      heading={`Siga ${name} para ver`}
      body={`Esta publicação é só para quem segue ${name}. Ao seguir, ela abre aqui.`}
      profileLabel={`Ver perfil de ${name}`}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // The focus mark is module state: drop whatever an earlier case left.
  consumeFocusAfterFollow(POST);
});
afterEach(cleanup);

describe('LockedPostScreen', () => {
  it('S1: shows the header, the heading, the body and one Seguir button - nothing of a post', () => {
    const { container } = renderScreen();
    expect(screen.getByRole('heading', { level: 1, name: 'Publicação' })).toBeTruthy();
    expect(screen.getByText('Siga Helena Küster para ver')).toBeTruthy();
    expect(
      screen.getByText(
        'Esta publicação é só para quem segue Helena Küster. Ao seguir, ela abre aqui.',
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Seguir Helena Küster' }).textContent).toBe('Seguir');
    expect(container.querySelector('[role="article"], [data-post-id], video, textarea')).toBeNull();
    expect(container.querySelector('[aria-busy]')).toBeNull();
  });

  it('S2: the avatar is a link to the profile named by the catalog, with the photo through MediaImage', () => {
    renderScreen();
    const link = screen.getByRole('link', { name: 'Ver perfil de Helena Küster' });
    expect(link.getAttribute('href')).toBe(`/membros/${MEMBERSHIP}`);
    expect(link.querySelector(`[data-asset-id="${AVATAR}"]`)).not.toBeNull();
  });

  it('S3: an author without a photo gets the neutral avatar, never a broken image', () => {
    renderScreen({ membershipId: MEMBERSHIP, displayName: 'Helena Küster', avatarAssetId: null });
    const link = screen.getByRole('link', { name: 'Ver perfil de Helena Küster' });
    expect(link.querySelector('[data-asset-id]')).toBeNull();
    expect(link.querySelector('svg')).not.toBeNull();
  });

  it('S4: the lock disc is decorative: aria-hidden, in the avatar corner', () => {
    renderScreen();
    const disc = screen
      .getByRole('link', { name: 'Ver perfil de Helena Küster' })
      .querySelector('[data-lock-disc]');
    expect(disc).not.toBeNull();
    expect(disc?.getAttribute('aria-hidden')).toBe('true');
  });

  it('S5: a successful follow marks the focus and refreshes the same URL exactly once', async () => {
    follow.mockResolvedValue({ ok: true, following: true, followerCount: 3 });
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir Helena Küster' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(follow).toHaveBeenCalledWith(MEMBERSHIP);
    expect(consumeFocusAfterFollow(POST)).toBe(true);
  });

  it('S6: while the refresh is in flight the card is replaced by a card-shaped aria-busy skeleton', async () => {
    follow.mockResolvedValue({ ok: true, following: true, followerCount: 3 });
    const { container } = renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir Helena Küster' }));
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Siga Helena Küster para ver')).toBeNull();
    const skeleton = container.querySelector('[aria-busy="true"]') as HTMLElement;
    // An 80px circle, a 14px bar at 45%, a 12px bar at 70% and a 44px rounded-xl block.
    expect(skeleton.querySelectorAll('.h-20.w-20.rounded-full')).toHaveLength(1);
    expect(skeleton.querySelectorAll('.h-3\\.5')).toHaveLength(1);
    expect(skeleton.querySelectorAll('.h-3:not(.h-3\\.5)')).toHaveLength(1);
    expect(skeleton.querySelectorAll('.h-11.rounded-xl')).toHaveLength(1);
  });

  // 09-11 Task 3 - the remaining states (UI E05) and the accessibility properties (UI-D-499).

  it('S7: a failed follow keeps the card and the button and raises the catalog error toast', async () => {
    follow.mockResolvedValue({ ok: false, code: 'generic' });
    const { container } = renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir Helena Küster' }));
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Não foi possível seguir agora. Tente novamente.',
      }),
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByText('Siga Helena Küster para ver')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Seguir Helena Küster' }).textContent).toBe('Seguir');
    // Nothing marked the focus either: a refresh that never happened must not steal it later.
    expect(consumeFocusAfterFollow(POST)).toBe(false);
  });

  it('S8: the skeleton keeps the page chrome and the card box: same wrapper, padding, gap and anchors', async () => {
    follow.mockResolvedValue({ ok: true, following: true, followerCount: 3 });
    const { container } = renderScreen();
    const wrapperBefore = container.querySelector('.px-4.pt-6');
    const cardBefore = container.querySelector('.flex.flex-col.items-center.gap-4.p-6');
    expect(wrapperBefore).not.toBeNull();
    expect(cardBefore).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir Helena Küster' }));
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
    // The header stays (only the card is swapped) and the wrapper is the same node.
    expect(screen.getByRole('heading', { level: 1, name: 'Publicação' })).toBeTruthy();
    expect(container.querySelector('.px-4.pt-6')).toBe(wrapperBefore);
    const skeleton = container.querySelector('[aria-busy="true"]') as HTMLElement;
    for (const token of ['flex', 'flex-col', 'items-center', 'gap-4', 'p-6']) {
      expect(skeleton.className).toContain(token);
    }
    // The real card's 44px button is the skeleton's 44px block, capped at the same 260px.
    expect(skeleton.querySelector('.h-11.max-w-\\[260px\\]')).not.toBeNull();
  });

  it('S9: an 80-grapheme name clamps to two lines and breaks, and the link keeps its accessible name', () => {
    const long = `${'Maria Eduarda '.repeat(6).trim()} Albuquerque de Vasconcellos Souza Nogueira`;
    expect(Array.from(long).length).toBeGreaterThanOrEqual(80);
    renderScreen({ membershipId: MEMBERSHIP, displayName: long, avatarAssetId: null });
    const heading = screen.getByText(`Siga ${long} para ver`);
    expect(heading.className).toContain('line-clamp-2');
    expect(heading.className).toContain('break-words');
    expect(screen.getByRole('link', { name: `Ver perfil de ${long}` })).toBeTruthy();
  });

  it('S10: the lock disc and its glyph are hidden from assistive technology', () => {
    renderScreen();
    const link = screen.getByRole('link', { name: 'Ver perfil de Helena Küster' });
    const disc = link.querySelector('[data-lock-disc]') as HTMLElement;
    expect(disc.getAttribute('aria-hidden')).toBe('true');
    const glyph = disc.querySelector('svg') as SVGElement;
    expect(glyph).not.toBeNull();
    expect(glyph.getAttribute('aria-hidden')).toBe('true');
    // The avatar link's name is the catalog string only; the disc adds no word to it.
    expect(link.textContent).toBe('');
  });

  it("S11: the follow button's accessible name contains its visible text (WCAG 2.5.3)", () => {
    renderScreen();
    const button = screen.getByRole('button', { name: /Helena Küster/ });
    expect(button.getAttribute('aria-label')?.includes(button.textContent ?? '\u0000')).toBe(true);
  });

  it('S12: the screen renders only the author: an extra caption in the props never reaches the DOM', () => {
    const forged = {
      membershipId: MEMBERSHIP,
      displayName: 'Helena Küster',
      avatarAssetId: null,
      caption: 'a legenda que nunca deveria chegar',
      likeCount: 41,
    } as unknown as Parameters<typeof renderScreen>[0];
    const { container } = renderScreen(forged);
    expect(container.textContent).not.toContain('a legenda que nunca deveria chegar');
    expect(container.textContent).not.toContain('41');
  });
});
