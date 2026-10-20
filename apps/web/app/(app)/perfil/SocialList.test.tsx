// @vitest-environment happy-dom
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { SocialListItem } from '@rede-social/module-social/contracts';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09-10 Task 3 (D-468, UI-D-502, EP-42..EP-44, PR-6, E07): the private "Seguidores" and "Seguindo"
 * lists, against the REAL pt-BR catalogs. The claims:
 *
 *  - the states: the two empty cards with their copy (Seguindo carries "Encontrar pessoas"), one row
 *    renders alone without "Carregar mais", 25 rows page on with it, a failed next page keeps the rows
 *    and offers the inline retry, a failed first read is the generic card;
 *  - a row is the person link then a sibling button; the button shows the caller's own state toward
 *    that person; a row with no bio keeps `min-h-14`; a long name truncates inside the link and the
 *    `w-24` button keeps its width;
 *  - in "Seguindo" a tap unfollows and the row STAYS, the button flipping to "Seguir" (the undo in one
 *    tap; the row leaves on the next load);
 *  - D-468: no route under `apps/web/app` takes another member's id for a list (a guard over the file
 *    tree), and the list actions take no id;
 *  - PR-6: the profile, `/perfil` and the lists render no post list, no "Minhas publicações" entry and
 *    no "Mensagem" button.
 */

const { loadMoreFollowers, loadMoreFollowing, unfollow, toast, refresh } = vi.hoisted(() => ({
  loadMoreFollowers: vi.fn(),
  loadMoreFollowing: vi.fn(),
  unfollow: vi.fn(),
  toast: { show: vi.fn(), dismiss: vi.fn() },
  refresh: vi.fn(),
}));

vi.mock('./social-list-actions', () => ({
  loadMoreFollowersAction: loadMoreFollowers,
  loadMoreFollowingAction: loadMoreFollowing,
}));
vi.mock('@/components/social/follow-actions', () => ({
  followAction: vi.fn(),
  unfollowAction: unfollow,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace: vi.fn() }) }));

vi.mock('next-intl', async (orig) => {
  const actual = await orig<typeof import('next-intl')>();
  const { join: joinPath } = await import('node:path');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages(joinPath(process.cwd(), 'messages', 'pt-BR'));
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

const { SocialList } = await import('./SocialList');

function person(index: number, over: Partial<SocialListItem> = {}): SocialListItem {
  const hex = index.toString(16).padStart(12, '0');
  return {
    membershipId: `00000000-0000-4000-8000-${hex}`,
    displayName: `Pessoa ${String(index).padStart(2, '0')}`,
    bio: index % 2 === 0 ? `Bio ${index}.` : null,
    avatarAssetId: null,
    viewerFollows: false,
    ...over,
  };
}

function people(count: number, over: Partial<SocialListItem> = {}): SocialListItem[] {
  return Array.from({ length: count }, (_, index) => person(index + 1, over));
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest('li') as HTMLElement;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('SocialList - the empty states (E07 empty, zero-one-many)', () => {
  it('L1: Seguidores empty reads "Ninguém segue você ainda" with no action', () => {
    render(<SocialList kind="followers" initialItems={[]} initialCursor={null} />);
    expect(screen.getByText('Ninguém segue você ainda')).toBeTruthy();
    expect(screen.getByText('Quando alguém seguir você, aparece aqui.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('L2: Seguindo empty reads "Você não segue ninguém" with the Encontrar pessoas action to /membros', () => {
    render(<SocialList kind="following" initialItems={[]} initialCursor={null} />);
    expect(screen.getByText('Você não segue ninguém')).toBeTruthy();
    expect(
      screen.getByText('Encontre pessoas para ver o que elas publicam em Explorar.'),
    ).toBeTruthy();
    const cta = screen.getByRole('link', { name: 'Encontrar pessoas' });
    expect(cta.getAttribute('href')).toBe('/membros');
    expect(cta.className).toContain('border-border-secondary');
  });
});

describe('SocialList - rows, paging and errors', () => {
  it('L3: one row renders alone, with no "Carregar mais"', () => {
    render(<SocialList kind="followers" initialItems={people(1)} initialCursor={null} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  it('L4: 25 rows with a cursor show "Carregar mais"; clicking appends the next page and drops it at the end', async () => {
    loadMoreFollowers.mockResolvedValue({
      ok: true,
      items: [person(26), person(27)],
      nextCursor: null,
    });
    render(<SocialList kind="followers" initialItems={people(25)} initialCursor="cursor-1" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(25);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    });
    expect(loadMoreFollowers).toHaveBeenCalledWith('cursor-1');
    expect(loadMoreFollowing).not.toHaveBeenCalled();
    expect(screen.getAllByRole('listitem')).toHaveLength(27);
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
    // The rows already on screen kept their order.
    const names = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(names[0]).toContain('Pessoa 01');
    expect(names[26]).toContain('Pessoa 27');
  });

  it('L5: Seguindo pages through its own action', async () => {
    loadMoreFollowing.mockResolvedValue({ ok: true, items: [person(26)], nextCursor: null });
    render(
      <SocialList
        kind="following"
        initialItems={people(25, { viewerFollows: true })}
        initialCursor="cursor-2"
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    });
    expect(loadMoreFollowing).toHaveBeenCalledWith('cursor-2');
    expect(loadMoreFollowers).not.toHaveBeenCalled();
  });

  it('L6: a failed next page keeps the rows and shows the generic card with a retry', async () => {
    loadMoreFollowers.mockResolvedValue({ ok: false, code: 'generic' });
    render(<SocialList kind="followers" initialItems={people(3)} initialCursor="cursor-1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    });
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Algo deu errado. Tente novamente.')).toBeTruthy();

    loadMoreFollowers.mockResolvedValue({ ok: true, items: [person(4)], nextCursor: null });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    });
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByText('Algo deu errado. Tente novamente.')).toBeNull();
  });

  it('L7: a failed first read is the generic card, never the empty copy', () => {
    render(<SocialList kind="followers" initialItems={[]} initialCursor={null} initialError />);
    expect(screen.getByText('Algo deu errado')).toBeTruthy();
    expect(screen.queryByText('Ninguém segue você ainda')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(refresh).toHaveBeenCalled();
  });
});

describe('SocialList - the row (EP-44, E07 partial, overflow, long-text)', () => {
  it("L8: the row is the person link then the button; Seguidores shows the caller's own state", () => {
    render(
      <SocialList
        kind="followers"
        initialItems={[person(1, { viewerFollows: true }), person(2)]}
        initialCursor={null}
      />,
    );
    const first = rowOf('Pessoa 01');
    expect(within(first).getByRole('button', { name: /^Seguindo Pessoa 01/ }).textContent).toBe(
      'Seguindo',
    );
    const second = rowOf('Pessoa 02');
    expect(within(second).getByRole('button', { name: 'Seguir Pessoa 02' }).textContent).toBe(
      'Seguir',
    );
    const link = within(second).getByRole('link');
    expect(link.getAttribute('href')).toBe(`/membros/${person(2).membershipId}`);
    expect(
      link.compareDocumentPosition(within(second).getByRole('button')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('L9: a row with no bio keeps min-h-14; a long name truncates and the w-24 button keeps its width', () => {
    const long = 'N'.repeat(90);
    render(
      <SocialList
        kind="followers"
        initialItems={[person(1, { displayName: long, bio: null })]}
        initialCursor={null}
      />,
    );
    const row = rowOf(long);
    expect((row.firstElementChild as HTMLElement).className).toContain('min-h-14');
    expect(screen.getByText(long).className).toContain('truncate');
    const button = within(row).getByRole('button');
    expect(button.className).toContain('w-24');
    expect(button.className).toContain('shrink-0');
  });

  it('L10: in Seguindo every row starts as Seguindo and a tap unfollows while the row STAYS', async () => {
    unfollow.mockResolvedValue({ ok: true, following: false, followerCount: 0 });
    render(
      <SocialList
        kind="following"
        initialItems={people(2, { viewerFollows: true })}
        initialCursor={null}
      />,
    );
    const row = rowOf('Pessoa 01');
    const button = within(row).getByRole('button', { name: /^Seguindo Pessoa 01/ });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(unfollow).toHaveBeenCalledWith(person(1).membershipId);
    // The row is still there; the same button now offers to follow again (an undo in one tap).
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(
      within(rowOf('Pessoa 01')).getByRole('button', { name: 'Seguir Pessoa 01' }),
    ).toBeTruthy();
    expect(toast.show).not.toHaveBeenCalled();
  });
});

describe('SocialList - PR-6: no personal feed', () => {
  it('L11: the lists carry no post list, no Minhas publicações and no Mensagem', () => {
    const { container } = render(
      <SocialList kind="followers" initialItems={people(3)} initialCursor={null} />,
    );
    const text = container.textContent ?? '';
    for (const forbidden of ['Minhas publicações', 'Publicações', 'Mensagem']) {
      expect(text).not.toContain(forbidden);
    }
    expect(container.querySelector('[role="article"]')).toBeNull();
  });
});

/** The files of `apps/web/app`, as paths relative to it, `/`-separated. */
function appFiles(dir = join(process.cwd(), 'app')): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...appFiles(full));
    else out.push(relative(join(process.cwd(), 'app'), full).split(sep).join('/'));
  }
  return out;
}

describe("D-468 guard - no route takes another member's id for a list", () => {
  const LIST_SEGMENTS = new Set(['seguidores', 'seguindo', 'followers', 'following']);

  it('G1: the two list routes exist exactly once each, under /perfil, and nowhere else', () => {
    const pages = appFiles().filter((file) => {
      const segments = file.split('/');
      return segments.some((segment) => LIST_SEGMENTS.has(segment)) && /page\.tsx?$/.test(file);
    });
    expect(pages.sort()).toEqual([
      '(app)/perfil/seguidores/page.tsx',
      '(app)/perfil/seguindo/page.tsx',
    ]);
  });

  it('G2: no dynamic segment appears anywhere on the path to a followers or following route', () => {
    const offending = appFiles().filter((file) => {
      const segments = file.split('/');
      const index = segments.findIndex((segment) => LIST_SEGMENTS.has(segment));
      if (index === -1) return false;
      return segments.some((segment) => /^\[.*\]$/.test(segment));
    });
    expect(offending).toEqual([]);
  });
});

describe('PR-6 guard - the profile screens import no post list', () => {
  const SCREENS = [
    '(app)/perfil/page.tsx',
    '(app)/perfil/SocialList.tsx',
    '(app)/perfil/seguidores/page.tsx',
    '(app)/perfil/seguindo/page.tsx',
    '(app)/membros/[membershipId]/page.tsx',
    '../components/social/SocialProfileBlock.tsx',
    '../components/social/SocialCountsBlock.tsx',
  ];

  it.each(SCREENS)('G3: %s imports no PostCard, FeedList, FeedSurface or feed read', (file) => {
    // Comments are documentation, not behaviour: strip them so a docblock may NAME what is forbidden.
    const source = readFileSync(join(process.cwd(), 'app', file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['PostCard', 'FeedList', 'FeedSurface', 'loadFeed', 'getFeed']) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).not.toContain('Minhas publicações');
  });
});
