// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09-17 (WR-04, UI-D-501, FOLLOW-05): the profile's counts block, against the REAL pt-BR catalog
 * through next-intl's own translator. Stubbed: the two server actions and the toast. The claims: the
 * follower count follows the SERVER value (a refresh that changes it prints the new number), a
 * follower count the control's answer set survives a rerender with the SAME server value, only a
 * CHANGED server value replaces it (EP-78), zero prints "0" (EP-79), and `own` mode is two links and
 * no control.
 */

const { toast, follow, unfollow } = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  follow: vi.fn(),
  unfollow: vi.fn(),
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

vi.mock('./follow-actions', () => ({ followAction: follow, unfollowAction: unfollow }));

const { SocialCountsBlock } = await import('./SocialCountsBlock');

const ID = '11111111-1111-4111-8111-111111111111';

type Props = React.ComponentProps<typeof SocialCountsBlock>;

const block = (over: Partial<Props> = {}) => (
  <SocialCountsBlock
    mode="member"
    membershipId={ID}
    name="Marcos"
    followerCount={10}
    followingCount={4}
    viewerFollows={false}
    {...over}
  />
);

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('SocialCountsBlock', () => {
  it('C1: the counts print in the pt-BR format, compact from 10 000', () => {
    render(block({ followerCount: 1234, followingCount: 12_345 }));
    expect(screen.getByText(/1\.234/)).toBeTruthy();
    expect(screen.getByText(/12\s?mil/)).toBeTruthy();
  });

  it('C2: a rerender with a new followerCount prints the new number (WR-04)', () => {
    const view = render(block({ followerCount: 10 }));
    expect(screen.getByText('10')).toBeTruthy();
    view.rerender(block({ followerCount: 15 }));
    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.queryByText('10')).toBeNull();
  });

  it("C3 (EP-78): the control's answer is printed, kept by a same-value rerender, replaced by a changed one", async () => {
    follow.mockResolvedValue({ ok: true, following: true, followerCount: 11 });
    const view = render(block({ followerCount: 10 }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(screen.getByText('11')).toBeTruthy();

    view.rerender(block({ followerCount: 10 }));
    expect(screen.getByText('11')).toBeTruthy();

    view.rerender(block({ followerCount: 12 }));
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.queryByText('11')).toBeNull();
  });

  it('C4 (EP-79): a follower count of 0 prints "0" with the plural "Seguidores"', () => {
    render(block({ followerCount: 0, followingCount: 0 }));
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.getByText('Seguidores')).toBeTruthy();
  });

  it('C5: the viewerFollows prop resyncs the control below it', () => {
    const view = render(block({ viewerFollows: false }));
    expect(screen.getByRole('button').textContent).toBe('Seguir');
    view.rerender(block({ viewerFollows: true }));
    expect(screen.getByRole('button').textContent).toBe('Seguindo');
  });

  it('C6: own mode renders the two link cells and no control', () => {
    render(block({ mode: 'own', followerCount: 1, followingCount: 4 }));
    expect(screen.queryByRole('button')).toBeNull();
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/perfil/seguidores',
      '/perfil/seguindo',
    ]);
  });
});
