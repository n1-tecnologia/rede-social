// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09-10 (D-467, D-468, FOLLOW-04, UI-D-501, UI-D-511, T-09-36): the profile's social block, against
 * the REAL pt-BR catalog. The claims: nothing renders and NOTHING IS READ unless the viewer holds
 * `social.participate`; a staff or off-module target renders nothing; a failed read shows the inline
 * error with a retry link to the same URL (never a bare staff look); a read that worked prints the
 * counts as plain cells on another member's page and as links on `/perfil`; the DOM order is counts
 * then button (EP-44); a zero count reads "Seguidores" and one reads "Seguidor" (E06); and the
 * profile carries no post list, no "Minhas publicações", no "Mensagem" (PR-6).
 */

const { getSocialProfile, toast } = vi.hoisted(() => ({
  getSocialProfile: vi.fn(),
  toast: { show: vi.fn(), dismiss: vi.fn() },
}));

vi.mock('@/lib/social', () => ({ getSocialProfile }));
vi.mock('./follow-actions', () => ({ followAction: vi.fn(), unfollowAction: vi.fn() }));

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

vi.mock('next-intl/server', async () => {
  const actual = await vi.importActual<typeof import('next-intl')>('next-intl');
  const { join } = await import('node:path');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
  return {
    getTranslations: async (namespace?: string) =>
      actual.createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

const { SocialCountsSkeleton, SocialProfileBlock, SocialProfileData } = await import(
  './SocialProfileBlock'
);

const ID = '11111111-1111-4111-8111-111111111111';
const BASE = { membershipId: ID, name: 'Marcos', retryHref: `/membros/${ID}` };

function profile(
  over: Partial<{
    followerCount: number;
    followingCount: number;
    viewerFollows: boolean;
    self: boolean;
  }> = {},
) {
  return {
    status: 'ok' as const,
    data: {
      membershipId: ID,
      followerCount: 3,
      followingCount: 2,
      viewerFollows: false,
      self: false,
      ...over,
    },
  };
}

async function renderData(props: Partial<React.ComponentProps<typeof SocialProfileData>> = {}) {
  const element = (await SocialProfileData({ ...BASE, ...props })) as ReactElement | null;
  return render(<div>{element}</div>);
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('SocialProfileBlock - the gate', () => {
  it('B1: a viewer without social.participate gets nothing and no request is made', () => {
    expect(
      SocialProfileBlock({ ...BASE, permissions: ['feed.post.create', 'moderation.manage'] }),
    ).toBeNull();
    expect(getSocialProfile).not.toHaveBeenCalled();
  });

  it('B2: a participating viewer gets the streamed block (the read happens inside Suspense)', () => {
    const block = SocialProfileBlock({ ...BASE, permissions: ['social.participate'] });
    expect(block).not.toBeNull();
  });
});

describe('SocialProfileData - the states', () => {
  it('B3: not-eligible (a staff target, social off) renders nothing', async () => {
    getSocialProfile.mockResolvedValue({ status: 'not-eligible' });
    const { container } = await renderData();
    expect(container.textContent).toBe('');
  });

  it('B4: a failed read keeps the base profile and shows the inline error with a retry link', async () => {
    getSocialProfile.mockResolvedValue({ status: 'error' });
    await renderData();
    expect(screen.getByText('Não foi possível carregar os seguidores.')).toBeTruthy();
    const retry = screen.getByRole('link', { name: 'Tentar novamente' });
    expect(retry.getAttribute('href')).toBe(`/membros/${ID}`);
    expect(retry.className).toContain('border-border-secondary');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('B5: the caller themself on a member page renders nothing', async () => {
    getSocialProfile.mockResolvedValue(profile({ self: true }));
    const { container } = await renderData();
    expect(container.textContent).toBe('');
  });

  it('B6: the skeleton is two cells, busy, and never prints a 0', () => {
    const { container } = render(<SocialCountsSkeleton />);
    expect(container.firstElementChild?.getAttribute('aria-busy')).toBe('true');
    expect(container.firstElementChild?.children).toHaveLength(2);
    expect(container.textContent).toBe('');
  });
});

describe('SocialProfileData - another member', () => {
  it('B7: plain count cells, then the full-width Seguir button (header, counts, button order)', async () => {
    getSocialProfile.mockResolvedValue(profile());
    const { container } = await renderData();

    expect(screen.queryAllByRole('link')).toHaveLength(0);
    const text = container.textContent ?? '';
    expect(text.indexOf('3')).toBeLessThan(text.indexOf('Seguidores'));
    const button = screen.getByRole('button', { name: 'Seguir Marcos' });
    expect(button.textContent).toBe('Seguir');
    expect(button.className).toContain('w-full');
    expect(button.className).toContain('md:max-w-[400px]');
    // The counts precede the action in the DOM, so keyboard focus meets the numbers' block first.
    const counts = container.querySelector('.grid') as HTMLElement;
    expect(counts.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('B8: a person the viewer already follows opens as Seguindo', async () => {
    getSocialProfile.mockResolvedValue(profile({ viewerFollows: true }));
    await renderData();
    expect(screen.getByRole('button', { name: /^Seguindo Marcos/ }).textContent).toBe('Seguindo');
  });

  it.each([
    [0, 'Seguidores'],
    [1, 'Seguidor'],
    [2, 'Seguidores'],
  ])('B9: %s follower(s) read "%s" with a tabular numeral', async (count, label) => {
    getSocialProfile.mockResolvedValue(profile({ followerCount: count, followingCount: 7 }));
    await renderData();
    expect(screen.getByText(label)).toBeTruthy();
    const number = screen.getByText(String(count));
    expect(number.className).toContain('tabular-nums');
  });

  it('B10: 10 000 and up use compact notation, below it the full number', async () => {
    getSocialProfile.mockResolvedValue(profile({ followerCount: 12_345, followingCount: 9_999 }));
    await renderData();
    expect(screen.getByText(/12\s?mil/)).toBeTruthy();
    expect(screen.getByText(/9\.999/)).toBeTruthy();
  });

  it('B11 (PR-6): the profile block holds no post list, no personal feed entry, no Mensagem', async () => {
    getSocialProfile.mockResolvedValue(profile());
    const { container } = await renderData();
    const text = container.textContent ?? '';
    for (const forbidden of ['Minhas publicações', 'Publicações', 'Mensagem']) {
      expect(text).not.toContain(forbidden);
    }
    expect(container.querySelector('[role="article"]')).toBeNull();
  });
});

describe('SocialProfileData - the own profile (D-468)', () => {
  it('B12: the two cells are links to the PRIVATE lists, spoken in full, with no follow button', async () => {
    getSocialProfile.mockResolvedValue(
      profile({ self: true, followerCount: 1, followingCount: 4 }),
    );
    await renderData({ mode: 'own', retryHref: '/perfil' });

    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/perfil/seguidores',
      '/perfil/seguindo',
    ]);
    expect(links[0]?.getAttribute('aria-label')).toBe('1 seguidor, ver lista');
    expect(links[1]?.getAttribute('aria-label')).toBe('4 seguindo, ver lista');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('B13: zero followers is spoken as "0 seguidores"', async () => {
    getSocialProfile.mockResolvedValue(profile({ self: true, followerCount: 0 }));
    await renderData({ mode: 'own', retryHref: '/perfil' });
    expect(screen.getAllByRole('link')[0]?.getAttribute('aria-label')).toBe(
      '0 seguidores, ver lista',
    );
  });

  it('B14: a read that does not say self on /perfil renders nothing', async () => {
    getSocialProfile.mockResolvedValue(profile({ self: false }));
    const { container } = await renderData({ mode: 'own', retryHref: '/perfil' });
    expect(container.textContent).toBe('');
  });
});
