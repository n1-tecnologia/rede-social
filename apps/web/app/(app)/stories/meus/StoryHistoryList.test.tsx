// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryHistoryItemView } from '@/lib/story-view';

/**
 * 10-12 (UI-D-705, D-714, D-716): "Seus stories" for a member.
 *
 * The screen is the administrator's list, unchanged, plus a member mode (`member`): the row menu offers
 * "Destacar" only when the member owns an active community (`canHighlight`), "Ver story" and "Excluir
 * story" (danger) always; the delete confirmation carries the AUTHOR's copy (a story leaves Explorar
 * and every highlight it is in); the empty state speaks of Explorar; and "Destacar" opens the
 * checklist sheet in member mode: the visibility notice above the groups, the host's own empty state
 * with "Criar destaque", and the once-per-opening confirm on a switch-on. The words are the REAL
 * `stories.json`; the server actions are stubbed at their seam.
 */

const { catalog, toast, loadSheet, addToHighlight, removeFromHighlight, deleteStory, loadMore } =
  await vi.hoisted(async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    return {
      catalog: JSON.parse(
        readFileSync(join(process.cwd(), 'messages', 'pt-BR', 'stories.json'), 'utf8'),
      ).stories as Record<string, unknown>,
      toast: { show: vi.fn(), dismiss: vi.fn() },
      loadSheet: vi.fn(),
      addToHighlight: vi.fn(),
      removeFromHighlight: vi.fn(),
      deleteStory: vi.fn(),
      loadMore: vi.fn(),
    };
  });

MotionGlobalConfig.skipAnimations = true;

const lookup = (key: string, values?: Record<string, unknown>) => {
  const raw = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog);
  return String(raw ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values?.[name] ?? ''),
  );
};

vi.mock('next-intl', () => ({ useTranslations: () => lookup }));

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

vi.mock('@/app/(app)/stories/highlight-actions', () => ({
  loadHighlightSheetAction: loadSheet,
  addStoryToHighlightAction: addToHighlight,
  removeStoryFromHighlightAction: removeFromHighlight,
}));

vi.mock('@/app/(app)/stories/story-actions', () => ({
  deleteStoryAction: deleteStory,
  loadMoreOwnStoriesAction: loadMore,
}));

const { StoryHistoryList } = await import('./StoryHistoryList');

const STORY = '0d000000-0000-4000-8000-0000000000d1';
const COMMUNITY = '0c000000-0000-4000-8000-0000000000c1';
const HIGHLIGHT = '0000000a-1111-4111-8111-000000000001';

function row(overrides: Partial<StoryHistoryItemView> = {}): StoryHistoryItemView {
  return {
    id: STORY,
    date: '10 nov',
    thumbnailAssetId: '0b000000-0000-4000-8000-000000000001',
    thumbnailVariantWidths: [640],
    thumbnailAlt: 'Opções do story de 10 nov',
    caption: 'Meu story',
    captionMuted: false,
    meta: '10 nov · 0 curtidas · 0 comentários',
    actionLabel: 'Opções do story de 10 nov',
    viewHref: `/stories/${STORY}`,
    ...overrides,
  };
}

function list(props: { member?: { canHighlight: boolean }; items?: StoryHistoryItemView[] } = {}) {
  return render(
    <StoryHistoryList
      initialItems={props.items ?? [row()]}
      initialCursor={null}
      publishHref="/stories/publicar"
      {...(props.member ? { member: props.member } : {})}
    />,
  );
}

async function openMenu() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Opções do story de 10 nov' }));
  });
  return screen.getByRole('dialog', { name: 'Opções do story' });
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteStory.mockResolvedValue({ ok: true });
  addToHighlight.mockResolvedValue({ ok: true, highlightCount: 1 });
  removeFromHighlight.mockResolvedValue({ ok: true, highlightCount: 0 });
});
afterEach(cleanup);

describe('StoryHistoryList — a member’s "Seus stories" (10-12, UI-D-705)', () => {
  it('H1. the member empty state speaks of Explorar and offers "Publicar story"; the administrator keeps the Início wording', () => {
    list({ member: { canHighlight: false }, items: [] });
    expect(screen.getByText('Nenhum story ainda')).toBeTruthy();
    expect(
      screen.getByText('Publique seu primeiro story para ele aparecer em Explorar.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Publicar story' }).getAttribute('href')).toBe(
      '/stories/publicar',
    );
    cleanup();
    list({ items: [] });
    expect(
      screen.getByText('Publique seu primeiro story para ele aparecer no topo do início.'),
    ).toBeTruthy();
  });

  it('H2. the row menu: "Destacar" only with an owned community, "Ver story" and "Excluir story" (danger, last) always', async () => {
    list({ member: { canHighlight: false } });
    let sheet = await openMenu();
    expect(within(sheet).queryByRole('button', { name: 'Destacar' })).toBeNull();
    expect(within(sheet).getByRole('link', { name: 'Ver story' }).getAttribute('href')).toBe(
      `/stories/${STORY}`,
    );
    expect(within(sheet).getByRole('button', { name: 'Excluir story' }).className).toContain(
      'text-danger',
    );
    cleanup();

    list({ member: { canHighlight: true } });
    sheet = await openMenu();
    expect(within(sheet).getByRole('button', { name: 'Destacar' })).toBeTruthy();
  });

  it('H3. a member deletes with the AUTHOR’s copy; the administrator keeps the history’s', async () => {
    list({ member: { canHighlight: false } });
    const sheet = await openMenu();
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Excluir story' }));
    });
    const confirm = screen.getByRole('dialog', { name: 'Excluir story?' });
    expect(confirm.textContent).toContain('Ele sai de Explorar e de todos os destaques onde está.');
    expect(within(confirm).getByRole('button', { name: 'Manter story' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Excluir story' }));
    });
    expect(deleteStory).toHaveBeenCalledWith(STORY);
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Story excluído.' });
    cleanup();

    list();
    const adminSheet = await openMenu();
    await act(async () => {
      fireEvent.click(within(adminSheet).getByRole('button', { name: 'Excluir story' }));
    });
    expect(screen.getByRole('dialog', { name: 'Excluir story?' }).textContent).toContain(
      'Ele sai do início e de todos os destaques onde está.',
    );
  });

  it('H4. "Destacar" opens the checklist in member mode: the notice above the groups, and the first switch-on asks before it writes', async () => {
    loadSheet.mockResolvedValue({
      ok: true,
      places: [
        {
          key: COMMUNITY,
          label: 'Minha comunidade',
          communityId: COMMUNITY,
          rows: [{ id: HIGHLIGHT, title: 'Bastidores', cover: null }],
        },
      ],
      selectedIds: [],
    });
    list({ member: { canHighlight: true } });
    const menu = await openMenu();
    await act(async () => {
      fireEvent.click(within(menu).getByRole('button', { name: 'Destacar' }));
    });
    const sheet = await screen.findByRole('dialog', { name: 'Destacar story' });
    expect(
      within(sheet).getByText('Todos os membros verão este story na comunidade.'),
    ).toBeTruthy();
    expect(
      within(sheet).getByText('Um story em um destaque continua visível depois das 24 h.'),
    ).toBeTruthy();

    fireEvent.click(
      within(sheet).getByRole('switch', { name: 'Destacar em Bastidores, Minha comunidade' }),
    );
    const confirm = await screen.findByRole('dialog', {
      name: 'Mostrar este story na comunidade?',
    });
    expect(addToHighlight).not.toHaveBeenCalled();
    expect(within(confirm).getByRole('button', { name: 'Não mostrar' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Mostrar na comunidade' }));
    });
    await waitFor(() =>
      expect(addToHighlight).toHaveBeenCalledWith(STORY, HIGHLIGHT, {
        communityId: COMMUNITY,
        revalidate: true,
      }),
    );
  });

  it('H5. a member with no highlight sees "Nenhum destaque ainda." and "Criar destaque" to the manage route the read named', async () => {
    loadSheet.mockResolvedValue({
      ok: true,
      places: [],
      selectedIds: [],
      createHref: `/comunidades/${COMMUNITY}/destaques`,
    });
    list({ member: { canHighlight: true } });
    const menu = await openMenu();
    await act(async () => {
      fireEvent.click(within(menu).getByRole('button', { name: 'Destacar' }));
    });
    const sheet = await screen.findByRole('dialog', { name: 'Destacar story' });
    expect(within(sheet).getByText('Nenhum destaque ainda.')).toBeTruthy();
    expect(within(sheet).getByRole('link', { name: 'Criar destaque' }).getAttribute('href')).toBe(
      `/comunidades/${COMMUNITY}/destaques`,
    );
  });
});
