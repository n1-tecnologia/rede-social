// @vitest-environment happy-dom
import type { MemberProfile } from '@rede-social/contracts/profiles';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09-10 (D-466, D-470, UI-D-503, EP-42..EP-44, E07): the directory's rows for a MEMBER viewer and for
 * the staff, against the REAL pt-BR catalogs. The claims:
 *
 *  - the staff keep today's single-link row: no button, no "Você";
 *  - a member's row is a link slot then a sibling Seguir / Seguindo button (DOM order), the caller's
 *    own row shows "Você" and NO button, and no row is conditioned on a role;
 *  - a row whose follow state has not arrived (or whose batch read failed) holds its `w-24` slot with
 *    no label that could be wrong;
 *  - "Carregar mais" merges the next page's follow states, so the new rows carry the right buttons.
 */

const { loadMore, toast } = vi.hoisted(() => ({
  loadMore: vi.fn(),
  toast: { show: vi.fn(), dismiss: vi.fn() },
}));

vi.mock('./actions', () => ({ loadMoreMembersAction: loadMore }));
vi.mock('@/components/social/follow-actions', () => ({
  followAction: vi.fn(),
  unfollowAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

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

const { MembersList } = await import('./MembersList');

const ME = '00000000-0000-4000-8000-000000000001';
const ANA = '00000000-0000-4000-8000-000000000002';
const BIA = '00000000-0000-4000-8000-000000000003';
const CAIO = '00000000-0000-4000-8000-000000000004';

function member(
  membershipId: string,
  displayName: string,
  bio: string | null = null,
): MemberProfile {
  return { membershipId, displayName, bio, avatarAssetId: null, avatarUrl: null } as MemberProfile;
}

const ITEMS = [
  member(ME, 'Eu Mesmo'),
  member(ANA, 'Ana Souza', 'Trago o café.'),
  member(BIA, 'Bia Lima'),
];

function renderList(props: Partial<React.ComponentProps<typeof MembersList>> = {}) {
  return render(
    <MembersList q="" initialItems={ITEMS} initialCursor={null} tenantName="Lab" {...props} />,
  );
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest('li') as HTMLElement;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('MembersList rows - the staff viewer', () => {
  it('M1: a staff row is one link with no button and no "Você"', () => {
    renderList();
    expect(screen.queryAllByRole('button', { name: /^Segui/ })).toHaveLength(0);
    expect(screen.queryByText('Você')).toBeNull();
    const row = rowOf('Ana Souza');
    expect(within(row).getAllByRole('link')).toHaveLength(1);
  });
});

describe('MembersList rows - the member viewer', () => {
  const follow = { viewerMembershipId: ME, initialFollowing: { [ANA]: false, [BIA]: true } };

  it("M2: others get Seguir / Seguindo; the caller's own row says Você and has no button", () => {
    renderList({ follow });
    expect(
      within(rowOf('Ana Souza')).getByRole('button', { name: 'Seguir Ana Souza' }).textContent,
    ).toBe('Seguir');
    expect(
      within(rowOf('Bia Lima')).getByRole('button', { name: /^Seguindo Bia Lima/ }).textContent,
    ).toBe('Seguindo');
    const own = rowOf('Eu Mesmo');
    expect(within(own).queryByRole('button')).toBeNull();
    expect(within(own).getByText('Você').className).toContain('text-text-tertiary');
  });

  it('M3: each row is the link then the button, as siblings (EP-44)', () => {
    renderList({ follow });
    const row = rowOf('Ana Souza');
    const link = within(row).getByRole('link');
    const button = within(row).getByRole('button');
    expect(link.getAttribute('href')).toBe(`/membros/${ANA}`);
    expect(link.contains(button)).toBe(false);
    expect(link.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('M4: a row with no state yet holds a w-24 slot and no button', () => {
    renderList({ follow: { viewerMembershipId: ME, initialFollowing: { [ANA]: false } } });
    const row = rowOf('Bia Lima');
    expect(within(row).queryByRole('button')).toBeNull();
    expect(row.querySelector('.w-24')).not.toBeNull();
    expect(within(row).queryByText('Seguir')).toBeNull();
    expect(within(row).queryByText('Seguindo')).toBeNull();
  });

  it('M5: a failed batch read (null) holds every slot, never a wrong label', () => {
    renderList({ follow: { viewerMembershipId: ME, initialFollowing: null } });
    expect(screen.queryAllByRole('button', { name: /^Segui/ })).toHaveLength(0);
    expect(screen.getByText('Ana Souza')).toBeTruthy();
  });

  it('M6: Carregar mais appends the page and merges ITS follow states', async () => {
    loadMore.mockResolvedValue({
      ok: true,
      items: [member(CAIO, 'Caio Reis')],
      nextCursor: null,
      following: { [CAIO]: true },
    });
    renderList({ follow, initialCursor: 'cursor-1' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    });
    expect(loadMore).toHaveBeenCalledWith('cursor-1', undefined);
    expect(
      within(rowOf('Caio Reis')).getByRole('button', { name: /^Seguindo Caio Reis/ }),
    ).toBeTruthy();
    // The first page keeps its rows and its states.
    expect(
      within(rowOf('Ana Souza')).getByRole('button', { name: 'Seguir Ana Souza' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  it('M7: a long name truncates inside the link and the button keeps its fixed width', () => {
    renderList({
      initialItems: [member(ANA, 'A'.repeat(80))],
      follow: { viewerMembershipId: ME, initialFollowing: { [ANA]: false } },
    });
    const row = screen.getByText('A'.repeat(80)).closest('li') as HTMLElement;
    expect(screen.getByText('A'.repeat(80)).className).toContain('truncate');
    const button = within(row).getByRole('button');
    expect(button.className).toContain('w-24');
    expect(button.className).toContain('shrink-0');
    expect(button.textContent).toBe('Seguir');
  });
});
