// @vitest-environment happy-dom

import type { CommunitySummary } from '@rede-social/module-communities/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 05.1-03 — the `/comunidades` list body under its two statuses (D-87, D-88, UI-D-50, UI-D-51), and
 * (2026-10-03) the manager's reorder mode on `Ativas`.
 *
 * The catalog is the REAL `communities.json`, so an assertion here fails when the pt-BR copy drifts
 * (the `StoryComposer.test.tsx` pattern). What is stubbed: the four server actions and the toast.
 * What is real: the list's four-state body, the region label, the per-card pill slot, the empty-state
 * split, the reorder mode's state machine and the module's `CommunityReorderList`.
 *
 * The four 05.1 claims worth a test are the four a later edit could quietly break:
 *
 *  1. **UI-D-51.** Zero ARCHIVED communities is its own empty state — named, honest, and with NO
 *     call to action: archiving happens on the edit form, so there is nothing to offer here.
 *  2. **D-87.** Zero ACTIVE communities keeps today's empty state WITH its "Criar comunidade" link,
 *     even though the title row now carries one too. Two routes to one form is accepted.
 *  3. **UI-D-50 / the region.** An archived row carries the neutral "Arquivada" pill, and the region
 *     says it is the archived list of this tenant.
 *  4. **Nothing leaks into Ativas.** An active row carries no pill and the region keeps today's label.
 *
 * The reorder claims (5-12): who is offered the mode at all; that it opens on the WHOLE active set
 * with focus on its heading; that every move button is named after its community; that "Cancelar"
 * writes nothing; that "Salvar ordem" sends the permutation and the list shows the server's answer;
 * that an unchanged draft sends nothing; that `order_stale` closes, says why and reloads; that any
 * other failure keeps the draft; and that a tenant past the bound is told so.
 */

const { catalog, toast, actions } = await vi.hoisted(async () => {
  // `vi.hoisted` runs BEFORE the imports it feeds, so `node:fs` is loaded here rather than above.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return {
    // `communities.json` plus the store's additions to the same namespace (`tags.exclusive` …),
    // merged key by key exactly as `loadMessages` does.
    catalog: (() => {
      const merge = (a: Record<string, unknown>, b: Record<string, unknown>) => {
        const out: Record<string, unknown> = { ...a };
        for (const [key, value] of Object.entries(b)) {
          const mine = out[key];
          out[key] =
            mine && typeof mine === 'object' && value && typeof value === 'object'
              ? merge(mine as Record<string, unknown>, value as Record<string, unknown>)
              : value;
        }
        return out;
      };
      return merge(read('communities').communities, read('communities.store').communities);
    })(),
    toast: { show: vi.fn(), dismiss: vi.fn() },
    actions: {
      loadMoreCommunitiesAction: vi.fn(),
      refreshCommunitiesAction: vi.fn(),
      loadOrderableCommunitiesAction: vi.fn(),
      reorderCommunitiesAction: vi.fn(),
    },
  };
});

// Nothing in the list animates by itself, but `@rede-social/ui` primitives may; a cancelled spring rejects
// after the run ends under happy-dom (the 05.1-04 lesson).
MotionGlobalConfig.skipAnimations = true;

const lookup = (key: string, values?: Record<string, unknown>) => {
  const raw = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog);
  return String(raw ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values?.[name] ?? ''),
  );
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => lookup(key, values),
}));

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

vi.mock('./actions', () => actions);

const { CommunitiesList } = await import('./CommunitiesList');

beforeEach(() => {
  toast.show.mockClear();
  for (const action of Object.values(actions)) action.mockReset();
});

afterEach(cleanup);

const C = catalog as {
  actions: { create: string };
  archived: { pill: string };
  empty: { title: string };
  emptyArchived: { title: string; body: string };
  list: { region: string; regionArchived: string };
  toasts: { reordered: string };
  reorder: {
    start: string;
    title: string;
    helper: string;
    moveUp: string;
    moveDown: string;
    save: string;
    cancel: string;
    errors: { load: string; tooMany: string; save: string; stale: string };
  };
};
const TENANT = 'Tenant Demo';

function community(overrides: Partial<CommunitySummary> = {}): CommunitySummary {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Avisos',
    slug: 'avisos',
    description: '',
    // Cover-less, so no media request is involved.
    coverAssetId: null,
    coverVariantWidths: [],
    postCount: 2,
    status: 'active',
    lastActivityAt: '2026-01-01T00:00:00.000000Z',
    kind: 'organization',
    createdBy: null,
    viewer: {
      isOwner: false,
      canPublish: false,
      canEdit: false,
      canCurate: false,
      actions: { like: true, comment: true, share: true, post: false, story: false },
    },
    ...overrides,
  };
}

function list(props: {
  status: 'active' | 'archived';
  items?: CommunitySummary[];
  canManage?: boolean;
  canCreate?: boolean;
  cursor?: string | null;
  storeTags?: Record<string, { coverBadge: boolean; archived: boolean }>;
}) {
  return render(
    <CommunitiesList
      initialItems={props.items ?? []}
      initialCursor={props.cursor ?? null}
      tenantName={TENANT}
      canManage={props.canManage ?? true}
      canCreate={props.canCreate}
      storeTags={props.storeTags}
      status={props.status}
    />,
  );
}

describe('CommunitiesList — the Ativas and Arquivadas bodies (05.1-03)', () => {
  it('1. an EMPTY archived list renders its own empty state, with no create link (UI-D-51)', () => {
    const { container } = list({ status: 'archived' });

    const empty = screen.getByTestId('communities-empty-archived');
    expect(within(empty).getByText(C.emptyArchived.title)).toBeTruthy();
    expect(within(empty).getByText(C.emptyArchived.body)).toBeTruthy();
    // Not the Ativas empty state, and no call to action at all.
    expect(screen.queryByText(C.empty.title)).toBeNull();
    expect(container.querySelector('a[href="/comunidades/nova"]')).toBeNull();
  });

  it('2. an EMPTY active list keeps today’s empty state WITH the create link (D-87)', () => {
    list({ status: 'active' });

    const empty = screen.getByTestId('communities-empty');
    expect(within(empty).getByText(C.empty.title)).toBeTruthy();
    const cta = within(empty).getByRole('link', { name: C.actions.create });
    expect(cta.getAttribute('href')).toBe('/comunidades/nova');
  });

  it('3. an archived row carries the Arquivada pill, and the region names the archived list', () => {
    list({ status: 'archived', items: [community({ status: 'archived' })] });

    const region = screen.getByRole('region', {
      name: C.list.regionArchived.replace('{tenant}', TENANT),
    });
    const card = within(region).getByTestId('community-card');
    expect(within(card).getByText(C.archived.pill)).toBeTruthy();
  });

  it('4. an active row carries NO pill, and the region keeps today’s label', () => {
    list({ status: 'active', items: [community()] });

    expect(
      screen.getByRole('region', { name: C.list.region.replace('{tenant}', TENANT) }),
    ).toBeTruthy();
    expect(screen.getByTestId('community-card')).toBeTruthy();
    expect(screen.queryByText(C.archived.pill)).toBeNull();
  });
});

/* ── 2026-10-03: the reorder mode ─────────────────────────────────────────────────────────────── */

const AVISOS = community({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Avisos' });
const EVENTOS = community({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Eventos' });
const PROJETOS = community({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Projetos' });
/** Not on the first page the server rendered: only the reorder read brings it in. */
const MUTIRAO = community({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Mutirao' });
/** No name is a substring of another, so a card's text identifies its community. */
const NAMES = [AVISOS.name, EVENTOS.name, PROJETOS.name, MUTIRAO.name];

const moveUp = (name: string) => C.reorder.moveUp.replace('{community}', name);
const moveDown = (name: string) => C.reorder.moveDown.replace('{community}', name);

/** The web workspace has no jest-dom: plain DOM reads (the `EventForm.test.tsx` note). */
const isDisabled = (name: string) =>
  (screen.getByRole('button', { name }) as HTMLButtonElement).disabled;

const cardNames = () =>
  screen
    .queryAllByTestId('community-card')
    .map((card) => NAMES.find((name) => card.textContent?.includes(name)) ?? '?');

const rowNames = () =>
  within(screen.getByRole('list', { name: C.reorder.title }))
    .getAllByRole('listitem')
    .map((row) => row.textContent ?? '');

const toggle = () => screen.queryByRole('button', { name: C.reorder.start });
const reorderList = () => screen.queryByRole('list', { name: C.reorder.title });

/** Opens the mode on `set` (the WHOLE active set the read answers). */
async function openReorder(set: CommunitySummary[]) {
  actions.loadOrderableCommunitiesAction.mockResolvedValue({ ok: true, items: set });
  await act(async () => {
    fireEvent.click(toggle() as HTMLElement);
  });
  await screen.findByRole('list', { name: C.reorder.title });
}

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: C.reorder.save }));
  });
}

describe('CommunitiesList — the manager’s reorder mode on Ativas (2026-10-03)', () => {
  it('5. offered to a manager on Ativas with two or more communities — and to nobody else', () => {
    // A member: today's markup, no control.
    const member = list({ status: 'active', items: [AVISOS, EVENTOS], canManage: false });
    expect(toggle()).toBeNull();
    member.unmount();

    // Arquivadas: the order belongs to the active list.
    const archived = list({
      status: 'archived',
      items: [
        community({ ...AVISOS, status: 'archived' }),
        community({ ...EVENTOS, status: 'archived' }),
      ],
    });
    expect(toggle()).toBeNull();
    archived.unmount();

    // One community has no order to choose.
    const single = list({ status: 'active', items: [AVISOS] });
    expect(toggle()).toBeNull();
    single.unmount();

    list({ status: 'active', items: [AVISOS, EVENTOS] });
    expect(toggle()).not.toBeNull();
    // Offering it changes nothing else: the cards are today's, in the server's order.
    expect(cardNames()).toEqual(['Avisos', 'Eventos']);
    expect(actions.loadOrderableCommunitiesAction).not.toHaveBeenCalled();
  });

  it('6. opening reads the WHOLE active set, focuses the heading and names every move after its community', async () => {
    list({ status: 'active', items: [AVISOS, EVENTOS, PROJETOS], cursor: 'next-page' });

    await openReorder([AVISOS, EVENTOS, PROJETOS, MUTIRAO]);

    expect(actions.loadOrderableCommunitiesAction).toHaveBeenCalledTimes(1);
    // The fourth community was never on screen: the mode orders the set, not the page.
    expect(rowNames()).toEqual(['Avisos', 'Eventos', 'Projetos', 'Mutirao']);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: C.reorder.title, level: 2 }),
      ),
    );
    const describedBy = reorderList()?.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe(C.reorder.helper);
    // Disabled at the ends, reachable everywhere else.
    expect(isDisabled(moveUp('Avisos'))).toBe(true);
    expect(isDisabled(moveDown('Avisos'))).toBe(false);
    expect(isDisabled(moveUp('Mutirao'))).toBe(false);
    expect(isDisabled(moveDown('Mutirao'))).toBe(true);
    // The cards, and the toggle itself, are gone while the mode is open…
    expect(cardNames()).toEqual([]);
    expect(toggle()).toBeNull();
    // …inside the same region: it is the same list.
    expect(
      screen.getByRole('region', { name: C.list.region.replace('{tenant}', TENANT) }),
    ).toBeTruthy();
  });

  it('7. Cancelar writes nothing, puts the cards back in their order and returns focus to Reordenar', async () => {
    list({ status: 'active', items: [AVISOS, EVENTOS] });
    await openReorder([AVISOS, EVENTOS]);

    fireEvent.click(screen.getByRole('button', { name: moveDown('Avisos') }));
    expect(rowNames()).toEqual(['Eventos', 'Avisos']);
    fireEvent.click(screen.getByRole('button', { name: C.reorder.cancel }));

    expect(actions.reorderCommunitiesAction).not.toHaveBeenCalled();
    expect(reorderList()).toBeNull();
    expect(cardNames()).toEqual(['Avisos', 'Eventos']);
    await waitFor(() => expect(document.activeElement).toBe(toggle()));
  });

  it('8. Salvar ordem sends the permutation; the list shows the server’s answer and a toast confirms', async () => {
    list({ status: 'active', items: [AVISOS, EVENTOS, PROJETOS] });
    await openReorder([AVISOS, EVENTOS, PROJETOS]);
    actions.reorderCommunitiesAction.mockResolvedValue({
      ok: true,
      items: [PROJETOS, AVISOS, EVENTOS],
      nextCursor: null,
    });

    fireEvent.click(screen.getByRole('button', { name: moveUp('Projetos') }));
    fireEvent.click(screen.getByRole('button', { name: moveUp('Projetos') }));
    expect(rowNames()).toEqual(['Projetos', 'Avisos', 'Eventos']);
    await save();

    await waitFor(() => expect(cardNames()).toEqual(['Projetos', 'Avisos', 'Eventos']));
    expect(actions.reorderCommunitiesAction).toHaveBeenCalledWith([
      PROJETOS.id,
      AVISOS.id,
      EVENTOS.id,
    ]);
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: C.toasts.reordered });
    await waitFor(() => expect(document.activeElement).toBe(toggle()));
  });

  it('9. an unchanged draft saves NOTHING — the mode simply closes', async () => {
    list({ status: 'active', items: [AVISOS, EVENTOS] });
    await openReorder([AVISOS, EVENTOS]);

    // Down and back up: the draft equals the order the mode opened on.
    fireEvent.click(screen.getByRole('button', { name: moveDown('Avisos') }));
    fireEvent.click(screen.getByRole('button', { name: moveUp('Avisos') }));
    await save();

    expect(actions.reorderCommunitiesAction).not.toHaveBeenCalled();
    expect(reorderList()).toBeNull();
    expect(cardNames()).toEqual(['Avisos', 'Eventos']);
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('10. order_stale closes the mode, says why and RELOADS the list from the server', async () => {
    list({ status: 'active', items: [AVISOS, EVENTOS] });
    await openReorder([AVISOS, EVENTOS]);
    actions.reorderCommunitiesAction.mockResolvedValue({ ok: false, code: 'order_stale' });
    // Meanwhile somebody created "Mutirao": the reload shows the set the server really holds.
    actions.refreshCommunitiesAction.mockResolvedValue({
      ok: true,
      items: [MUTIRAO, AVISOS, EVENTOS],
      nextCursor: null,
    });

    fireEvent.click(screen.getByRole('button', { name: moveDown('Avisos') }));
    await save();

    await waitFor(() => expect(cardNames()).toEqual(['Mutirao', 'Avisos', 'Eventos']));
    expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: C.reorder.errors.stale });
    expect(actions.refreshCommunitiesAction).toHaveBeenCalledWith('active');
    expect(reorderList()).toBeNull();
  });

  it('11. any other failure KEEPS the draft and the mode, so Salvar ordem can be tried again', async () => {
    list({ status: 'active', items: [AVISOS, EVENTOS] });
    await openReorder([AVISOS, EVENTOS]);
    actions.reorderCommunitiesAction.mockResolvedValue({ ok: false, code: 'generic' });

    fireEvent.click(screen.getByRole('button', { name: moveDown('Avisos') }));
    await save();

    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: C.reorder.errors.save }),
    );
    expect(rowNames()).toEqual(['Eventos', 'Avisos']);
    expect(actions.refreshCommunitiesAction).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: C.reorder.save })),
    );
  });

  it('12. a tenant past the bound is told so, and a failed read says it could not load — no mode either way', async () => {
    list({ status: 'active', items: [AVISOS, EVENTOS] });

    actions.loadOrderableCommunitiesAction.mockResolvedValueOnce({ ok: false, code: 'too_many' });
    await act(async () => {
      fireEvent.click(toggle() as HTMLElement);
    });
    await waitFor(() =>
      expect(toast.show).toHaveBeenLastCalledWith({
        tone: 'error',
        message: C.reorder.errors.tooMany.replace('{limit}', '200'),
      }),
    );
    expect(reorderList()).toBeNull();

    actions.loadOrderableCommunitiesAction.mockResolvedValueOnce({ ok: false, code: 'generic' });
    await act(async () => {
      fireEvent.click(toggle() as HTMLElement);
    });
    await waitFor(() =>
      expect(toast.show).toHaveBeenLastCalledWith({
        tone: 'error',
        message: C.reorder.errors.load,
      }),
    );
    expect(reorderList()).toBeNull();
    expect(cardNames()).toEqual(['Avisos', 'Eventos']);
  });
});

/* ── 10-13: the member's entry and the byline (UI-D-706, UI-D-708) ────────────────────────────── */

const HELENA = {
  membershipId: '99999999-9999-4999-8999-999999999999',
  displayName: 'Helena',
  avatarAssetId: null,
};
const MEMBER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const memberCommunity = (overrides: Partial<CommunitySummary> = {}) =>
  community({
    id: MEMBER_ID,
    name: 'Horta em casa',
    kind: 'member',
    createdBy: HELENA,
    ...overrides,
  });

describe('CommunitiesList — a member finds and creates communities (10-13)', () => {
  it('11. a member with the control available gets the outline create action in the empty list', () => {
    list({ status: 'active', canManage: false, canCreate: true });

    const empty = screen.getByTestId('communities-empty');
    expect(within(empty).getByText(C.empty.title)).toBeTruthy();
    // The member body is unchanged; the action is the admin's own link.
    expect(within(empty).getByText(`As comunidades de ${TENANT} vão aparecer aqui.`)).toBeTruthy();
    const cta = within(empty).getByRole('link', { name: C.actions.create });
    expect(cta.getAttribute('href')).toBe('/comunidades/nova');
  });

  it('12. a member without the control keeps the empty list with no action', () => {
    const { container } = list({ status: 'active', canManage: false, canCreate: false });

    expect(screen.getByText(C.empty.title)).toBeTruthy();
    expect(container.querySelector('a[href="/comunidades/nova"]')).toBeNull();
  });

  it('13. member cards follow the organization ones with the byline, no divider and no heading', () => {
    const { container } = list({
      status: 'active',
      canManage: false,
      canCreate: true,
      items: [AVISOS, EVENTOS, memberCommunity()],
    });

    // The server's order is shown as served (organization first, then member).
    expect(cardNames()).toEqual(['Avisos', 'Eventos', '?']);
    const cards = screen.getAllByTestId('community-card');
    expect(cards[2]?.textContent).toContain('Horta em casa');
    // The byline is a finished string from the host catalog, on the member card only.
    expect(within(cards[2] as HTMLElement).getByText('Criada por Helena')).toBeTruthy();
    expect(screen.getAllByText(/Criada por/)).toHaveLength(1);
    expect(cards[0]?.textContent).not.toContain('Criada por');
    // D-712: the UI never segregates them.
    expect(screen.queryByText(/De membros/i)).toBeNull();
    expect(container.querySelector('hr, [role="separator"]')).toBeNull();
    expect(container.querySelectorAll('h2, h3')).toHaveLength(0);
  });

  it('14. a member never sees "Reordenar", even with several organization communities', () => {
    list({
      status: 'active',
      canManage: false,
      canCreate: true,
      items: [AVISOS, EVENTOS, memberCommunity()],
    });
    expect(toggle()).toBeNull();
  });

  it('15. the byline name is plain text: the card stays one link', () => {
    list({ status: 'active', canManage: false, items: [memberCommunity()] });
    const card = screen.getByTestId('community-card');
    expect(card.querySelectorAll('a')).toHaveLength(0);
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});

/* ── 10-13 Task 3: the organization-only reorder list and the card edge cases (UI-D-708) ─────── */

describe('CommunitiesList — reorder lists ORGANIZATION communities only (UI-D-708)', () => {
  it('16. "Reordenar" counts organization communities only: one is nothing to order', () => {
    list({
      status: 'active',
      items: [AVISOS, memberCommunity(), memberCommunity({ id: MUTIRAO.id })],
    });
    expect(toggle()).toBeNull();
  });

  it('17. two organization communities offer it, whatever follows them', () => {
    list({ status: 'active', items: [AVISOS, EVENTOS, memberCommunity()] });
    expect(toggle()).not.toBeNull();
  });

  it('18. a member community is never in the draft, and the save sends organization ids only', async () => {
    const member = memberCommunity();
    list({ status: 'active', items: [AVISOS, EVENTOS, member] });

    // Even if the read handed a member row back, the draft does not hold it.
    await openReorder([AVISOS, EVENTOS, member]);
    expect(rowNames()).toEqual(['Avisos', 'Eventos']);

    actions.reorderCommunitiesAction.mockResolvedValue({
      ok: true,
      items: [EVENTOS, AVISOS, member],
      nextCursor: null,
    });
    fireEvent.click(screen.getByRole('button', { name: moveDown('Avisos') }));
    await save();

    expect(actions.reorderCommunitiesAction).toHaveBeenCalledWith([EVENTOS.id, AVISOS.id]);
    await waitFor(() => expect(cardNames()).toEqual(['Eventos', 'Avisos', '?']));
  });

  it('19. member cards stay on screen, unchanged and outside the draggable list, while ordering', async () => {
    list({ status: 'active', items: [AVISOS, EVENTOS, memberCommunity()] });
    await openReorder([AVISOS, EVENTOS]);

    const cards = screen.getAllByTestId('community-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.textContent).toContain('Horta em casa');
    expect(within(cards[0] as HTMLElement).getByText('Criada por Helena')).toBeTruthy();
    expect(within(reorderList() as HTMLElement).queryByText('Horta em casa')).toBeNull();
  });
});

describe('CommunitiesList — the card edge cases (UI-D-708, E08)', () => {
  it('20. the archived list carries the byline beside the Arquivada pill', () => {
    list({
      status: 'archived',
      canManage: false,
      items: [memberCommunity({ status: 'archived' })],
    });
    const card = screen.getByTestId('community-card');
    expect(within(card).getByText('Criada por Helena')).toBeTruthy();
    expect(within(card).getByText(C.archived.pill)).toBeTruthy();
  });

  it('21. a store tag never lands on a member card, even if the map names it', () => {
    list({
      status: 'active',
      canManage: false,
      items: [memberCommunity()],
      storeTags: { [MEMBER_ID]: { coverBadge: true, archived: true } },
    });
    expect(screen.queryByText('Exclusiva')).toBeNull();
    expect(screen.queryByText('Produto arquivado')).toBeNull();
  });

  it('22. an organization card with a store tag keeps it (the rule is not widened)', () => {
    list({
      status: 'active',
      items: [AVISOS],
      storeTags: { [AVISOS.id]: { coverBadge: true, archived: false } },
    });
    expect(screen.getByText('Exclusiva')).toBeTruthy();
  });

  it('23. a long display name truncates in the byline while the count stays whole', () => {
    const name = 'Maria da Conceição Aparecida de Albuquerque e Vasconcelos Figueiredo Neto';
    list({
      status: 'active',
      canManage: false,
      items: [memberCommunity({ createdBy: { ...HELENA, displayName: name } })],
    });
    const byline = screen.getByText(`Criada por ${name}`);
    expect(byline.className).toContain('truncate');
    const count = byline.parentElement?.firstElementChild as HTMLElement;
    expect(count.className).toContain('shrink-0');
    expect(count.className).not.toContain('truncate');
  });
});
