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

const { loadMore, toast, followAction, refresh } = vi.hoisted(() => ({
  loadMore: vi.fn(),
  toast: { show: vi.fn(), dismiss: vi.fn() },
  followAction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('./actions', () => ({ loadMoreMembersAction: loadMore }));
vi.mock('@/components/social/follow-actions', () => ({
  followAction,
  unfollowAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh }) }));

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

/**
 * 11-23 (D-720, D-722, D-724, UI-D-868, A-UI-10): the message control of the member's row, driven by the
 * finished facts of the follow-state read and the viewer's `chat.direct`, never by a role.
 */
describe('MembersList rows - the message control (11-23)', () => {
  const OPEN = { canFollow: true, canMessage: true, blockedByViewer: false };
  const CLOSED = { canFollow: false, canMessage: false, blockedByViewer: false };
  const follow = {
    viewerMembershipId: ME,
    canChat: true,
    initialFollowing: { [ANA]: false, [BIA]: true },
    initialFacts: { [ANA]: OPEN, [BIA]: CLOSED },
  };

  it('R1 (the path): a 44px round outline control sits left of Seguir, a link to the conversation entry', () => {
    renderList({ follow });
    const row = rowOf('Ana Souza');
    const message = within(row).getByRole('link', { name: 'Enviar mensagem para Ana Souza' });
    expect(message.getAttribute('href')).toBe(`/conversas/com/${ANA}`);
    expect(message.className).toContain('size-11');
    expect(message.className).toContain('rounded-full');
    expect(message.className).toContain('border');
    expect(message.querySelector('svg')).not.toBeNull();
    const button = within(row).getByRole('button', { name: 'Seguir Ana Souza' });
    expect(message.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The two controls share one non-shrinking cluster after the name link.
    const cluster = message.parentElement as HTMLElement;
    expect(cluster).toBe(button.parentElement);
    expect(cluster.className).toContain('flex');
    expect(cluster.className).toContain('shrink-0');
    expect(cluster.className).toContain('items-center');
    expect(cluster.className).toContain('gap-2');
    // The shipped link keeps its room and truncates (A-UI-10).
    const nameLink = within(row)
      .getAllByRole('link')
      .find((link) => link.getAttribute('href') === `/membros/${ANA}`) as HTMLElement;
    expect(nameLink.className).toContain('min-w-0');
    expect(nameLink.className).toContain('flex-1');
  });

  it('R2: the control is ABSENT, not disabled, on the own row and on a pair with a block, and the row keeps its link', () => {
    renderList({ follow });
    const own = rowOf('Eu Mesmo');
    expect(within(own).queryByRole('link', { name: /Enviar mensagem/ })).toBeNull();
    expect(within(own).getByText('Você')).toBeTruthy();

    const blocked = rowOf('Bia Lima');
    expect(within(blocked).queryByRole('link', { name: /Enviar mensagem/ })).toBeNull();
    expect(within(blocked).queryByRole('button')).toBeNull();
    expect(
      within(blocked)
        .getByRole('link', { name: /Bia Lima/ })
        .getAttribute('href'),
    ).toBe(`/membros/${BIA}`);
    expect(blocked.textContent).toBe('Bia Lima');
  });

  it('R3: a viewer without chat.direct keeps the shipped row (Seguir only)', () => {
    renderList({ follow: { ...follow, canChat: false } });
    expect(screen.queryAllByRole('link', { name: /Enviar mensagem/ })).toHaveLength(0);
    expect(
      within(rowOf('Ana Souza')).getByRole('button', { name: 'Seguir Ana Souza' }),
    ).toBeTruthy();
  });

  it('R4 (empty): missing facts or a failed read render the shipped rows with their slots', () => {
    renderList({ follow: { ...follow, initialFacts: null } });
    expect(screen.queryAllByRole('link', { name: /Enviar mensagem/ })).toHaveLength(0);
    expect(
      within(rowOf('Ana Souza')).getByRole('button', { name: 'Seguir Ana Souza' }),
    ).toBeTruthy();
    cleanup();
    renderList({ follow: { ...follow, initialFacts: {}, initialFollowing: { [ANA]: false } } });
    expect(screen.queryAllByRole('link', { name: /Enviar mensagem/ })).toHaveLength(0);
    expect(rowOf('Bia Lima').querySelector('.w-24')).not.toBeNull();
  });

  it('R5 (an old API): an entry without the keys still offers the control to a chat.direct viewer', () => {
    renderList({ follow: { ...follow, initialFacts: { [ANA]: {} } } });
    expect(
      within(rowOf('Ana Souza')).getByRole('link', { name: 'Enviar mensagem para Ana Souza' }),
    ).toBeTruthy();
  });

  it('R6: a row facts say cannot message drops the link and keeps Seguir', () => {
    renderList({
      follow: { ...follow, initialFacts: { [ANA]: { canFollow: true, canMessage: false } } },
    });
    const row = rowOf('Ana Souza');
    expect(within(row).queryByRole('link', { name: /Enviar mensagem/ })).toBeNull();
    expect(within(row).getByRole('button', { name: 'Seguir Ana Souza' })).toBeTruthy();
  });

  it('R7: Carregar mais merges the next page facts, so its rows carry the control', async () => {
    loadMore.mockResolvedValue({
      ok: true,
      items: [member(CAIO, 'Caio Reis')],
      nextCursor: null,
      following: { [CAIO]: false },
      facts: { [CAIO]: OPEN },
    });
    renderList({ follow, initialCursor: 'cursor-1' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    });
    expect(
      within(rowOf('Caio Reis')).getByRole('link', { name: 'Enviar mensagem para Caio Reis' }),
    ).toBeTruthy();
    expect(
      within(rowOf('Ana Souza')).getByRole('link', { name: 'Enviar mensagem para Ana Souza' }),
    ).toBeTruthy();
  });

  it('R8 (a refused follow): the button reverts, the shipped toast shows and the route refreshes', async () => {
    followAction.mockResolvedValue({ ok: false, code: 'generic' });
    renderList({ follow });
    await act(async () => {
      fireEvent.click(within(rowOf('Ana Souza')).getByRole('button', { name: 'Seguir Ana Souza' }));
    });
    expect(
      within(rowOf('Ana Souza')).getByRole('button', { name: 'Seguir Ana Souza' }).textContent,
    ).toBe('Seguir');
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível seguir agora. Tente novamente.',
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('R9: the re-read after a refresh drops the controls of a pair that became blocked', () => {
    const view = renderList({ follow });
    expect(screen.getAllByRole('link', { name: /Enviar mensagem/ })).toHaveLength(1);
    const next = [...ITEMS];
    view.rerender(
      <MembersList
        q=""
        initialItems={next}
        initialCursor={null}
        tenantName="Lab"
        follow={{ ...follow, initialFacts: { [ANA]: CLOSED, [BIA]: CLOSED } }}
      />,
    );
    expect(screen.queryAllByRole('link', { name: /Enviar mensagem/ })).toHaveLength(0);
    expect(within(rowOf('Ana Souza')).queryByRole('button')).toBeNull();
  });
});
