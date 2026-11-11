// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * quick 260926-d8f — the manage screen's CREATE path and its refusal toasts (review WR-03).
 *
 * The API refuses a 51st highlight in a place with `{ highlight: 'full' }` and `createHighlightAction`
 * surfaces it as `code: 'full'`. Before WR-03 the manager mapped every refusal except `archived` to
 * the generic "Tente novamente" — a retry that can never succeed. The claims:
 *
 *  - M1: `full` toasts the PLACE-cap copy with `{limit}` = `STORY_HIGHLIGHT_MAX_PER_PLACE` (never the
 *    generic copy, never the item-cap copy), and the title step stays open with the title kept;
 *  - M2: `archived` toasts the archived copy;
 *  - M3: `generic` toasts the generic copy.
 *
 * The catalog is the REAL `stories.json` (the StoryViewerHost.test.tsx harness). What is stubbed:
 * the server actions, the toast, the router, the signed-upload hook and `motion/react`.
 */

const { catalog, toast, createHighlight, setCover, loadEdit, upload, readiness } = await vi.hoisted(
  async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const read = (name: string) =>
      JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
    return {
      catalog: read('stories').stories as Record<string, unknown>,
      toast: { show: vi.fn(), dismiss: vi.fn() },
      createHighlight: vi.fn(),
      setCover: vi.fn(),
      loadEdit: vi.fn(),
      /** The options the manager handed `useSignedUpload` — the test drives `onCompleted`. */
      upload: { options: null as null | { onCompleted: (asset: unknown) => Promise<void> } },
      readiness: { value: { phase: 'idle' } as { phase: string; issue?: null } },
    };
  },
);

const lookup = (key: string, values?: Record<string, unknown>) => {
  const raw = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog);
  return String(raw ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values?.[name] ?? `{${name}}`),
  );
};

/** `motion/react` replaced by plain elements — see StoryViewerHost.test.tsx for why. */
vi.mock('motion/react', async () => {
  const { createElement, forwardRef } = await import('react');
  const MOTION_ONLY = new Set([
    'initial',
    'animate',
    'exit',
    'transition',
    'variants',
    'drag',
    'dragConstraints',
    'dragElastic',
    'onDragEnd',
    'whileTap',
    'whileHover',
    'whileFocus',
    'layout',
    'layoutId',
    'axis',
    'values',
    'onReorder',
    'value',
    'dragListener',
    'dragControls',
    'as',
  ]);
  const proxy = new Proxy(
    {},
    {
      get: (_target, tag: string) =>
        forwardRef((props: Record<string, unknown>, ref: unknown) => {
          const plain: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(props)) {
            if (!MOTION_ONLY.has(key)) plain[key] = value;
          }
          return createElement(tag, { ...plain, ref });
        }),
    },
  );
  const reorderPart = (fallback: string) =>
    forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const plain: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        if (!MOTION_ONLY.has(key)) plain[key] = value;
      }
      return createElement((props.as as string) ?? fallback, { ...plain, ref });
    });
  return {
    motion: proxy,
    Reorder: { Group: reorderPart('ul'), Item: reorderPart('li') },
    AnimatePresence: ({ children }: { children?: unknown }) => children,
    useDragControls: () => ({ start: () => {} }),
    useReducedMotion: () => true,
  };
});

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

const translate = (key: string, values?: Record<string, unknown>) => lookup(key, values);
vi.mock('next-intl', () => ({ useTranslations: () => translate }));

const router = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

vi.mock('@/app/(app)/stories/highlight-actions', () => ({
  addStoryToHighlightAction: vi.fn(),
  createHighlightAction: createHighlight,
  deleteHighlightAction: vi.fn(),
  loadHighlightEditAction: loadEdit,
  removeStoryFromHighlightAction: vi.fn(),
  renameHighlightAction: vi.fn(),
  reorderHighlightsAction: vi.fn(),
  setHighlightCoverAction: setCover,
}));

vi.mock('@/app/(app)/stories/story-actions', () => ({
  loadMoreOwnStoriesAction: vi.fn(async () => ({ ok: true, items: [], nextCursor: null })),
}));

// The real hook reaches server actions → `lib/api` → `lib/env`; the manager reads only this shape.
vi.mock('@/components/media/useSignedUpload', () => ({
  useSignedUpload: (options: { onCompleted: (asset: unknown) => Promise<void> }) => {
    upload.options = options;
    return {
      state: 'idle',
      progress: 0,
      error: null,
      pick: vi.fn(),
      reject: vi.fn(),
      cancel: vi.fn(),
      reset: vi.fn(),
    };
  },
}));
vi.mock('@/components/media/useAssetReadiness', () => ({
  useAssetReadiness: (assetId: string | null) =>
    assetId === null ? { phase: 'idle' } : readiness.value,
}));

const { STORY_HIGHLIGHT_MAX_ITEMS, STORY_HIGHLIGHT_MAX_PER_PLACE } = await import(
  '@rede-social/module-stories/contracts'
);
const { HighlightManager } = await import('./HighlightManager');

function manager() {
  return render(
    <HighlightManager
      place={{ communityId: null }}
      placeLabel="Início"
      initialItems={[]}
      archived={false}
      editTarget={null}
      publishHref="/stories/publicar"
    />,
  );
}

/** Opens "Novo destaque", types `title` and submits the title step. Returns the sheet. */
async function submitTitle(title: string): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: lookup('highlights.manage.create') }));
  });
  const sheet = screen.getByRole('dialog', { name: lookup('highlights.create.title') });
  fireEvent.change(within(sheet).getByLabelText(lookup('highlights.create.label')), {
    target: { value: title },
  });
  await act(async () => {
    fireEvent.click(
      within(sheet).getByRole('button', { name: lookup('highlights.create.submit') }),
    );
  });
  return sheet;
}

beforeEach(() => {
  vi.clearAllMocks();
  loadEdit.mockResolvedValue({ ok: false });
  readiness.value = { phase: 'idle' };
});
afterEach(cleanup);

describe('HighlightManager — the create refusals speak their own words (WR-03)', () => {
  it('M1. a place-cap `full` toasts the placeFull copy with the contract limit, and the title step stays open', async () => {
    createHighlight.mockResolvedValueOnce({ ok: false, code: 'full' });
    manager();
    const sheet = await submitTitle('Bastidores');

    expect(createHighlight).toHaveBeenCalledWith({ communityId: null }, 'Bastidores');
    const placeFull = lookup('highlights.errors.placeFull', {
      limit: STORY_HIGHLIGHT_MAX_PER_PLACE,
    });
    expect(toast.show).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: placeFull });
    expect(placeFull).toContain(String(STORY_HIGHLIGHT_MAX_PER_PLACE));
    expect(placeFull).not.toBe(lookup('highlights.errors.generic'));
    expect(placeFull).not.toBe(
      lookup('highlights.errors.full', { limit: STORY_HIGHLIGHT_MAX_ITEMS }),
    );

    // The step stays open with the title kept, so the admin can go delete one and come back.
    expect(sheet.isConnected).toBe(true);
    expect(
      (within(sheet).getByLabelText(lookup('highlights.create.label')) as HTMLInputElement).value,
    ).toBe('Bastidores');
  });

  it('M2. `archived` toasts the archived copy', async () => {
    createHighlight.mockResolvedValueOnce({ ok: false, code: 'archived' });
    manager();
    await submitTitle('Bastidores');
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: lookup('highlights.errors.archived'),
    });
  });

  it('M3. `generic` toasts the generic copy', async () => {
    createHighlight.mockResolvedValueOnce({ ok: false, code: 'generic' });
    manager();
    await submitTitle('Bastidores');
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: lookup('highlights.errors.generic'),
    });
  });
});

const HIGHLIGHT = {
  id: '11111111-1111-4111-8111-111111111111',
  communityId: null,
  title: 'Bastidores',
  meta: '2 stories',
  cover: null,
  coverChosen: false,
  itemCount: 2,
  editLabel: 'Editar Bastidores',
};
const ASSET_ID = '22222222-2222-4222-8222-222222222222';

/** The manager with one highlight whose edit sheet is open (`?editar=`). */
async function managerEditing() {
  loadEdit.mockResolvedValue({ ok: true, highlight: HIGHLIGHT, items: [] });
  const view = render(
    <HighlightManager
      place={{ communityId: null }}
      placeLabel="Início"
      initialItems={[HIGHLIGHT]}
      archived={false}
      editTarget={HIGHLIGHT.id}
      publishHref="/stories/publicar"
    />,
  );
  await act(async () => {});
  return view;
}

describe('HighlightManager — an uploaded cover waits until the asset is ready', () => {
  it('C1. a `processing` upload is written only once the readiness poll answers ready', async () => {
    setCover.mockResolvedValue({ ok: true, highlight: { ...HIGHLIGHT, coverChosen: true } });
    readiness.value = { phase: 'waiting' };
    const view = await managerEditing();

    await act(async () => {
      await upload.options?.onCompleted({ id: ASSET_ID, status: 'processing' });
    });
    expect(setCover).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();

    readiness.value = { phase: 'ready' };
    view.rerender(
      <HighlightManager
        place={{ communityId: null }}
        placeLabel="Início"
        initialItems={[HIGHLIGHT]}
        archived={false}
        editTarget={HIGHLIGHT.id}
        publishHref="/stories/publicar"
      />,
    );
    await act(async () => {});
    expect(setCover).toHaveBeenCalledTimes(1);
    expect(setCover).toHaveBeenCalledWith(
      HIGHLIGHT.id,
      { assetId: ASSET_ID },
      { communityId: null },
    );
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: lookup('highlights.toasts.coverChanged'),
    });
  });

  it('C2. an upload already `ready` is written straight away', async () => {
    setCover.mockResolvedValue({ ok: true, highlight: { ...HIGHLIGHT, coverChosen: true } });
    await managerEditing();
    await act(async () => {
      await upload.options?.onCompleted({ id: ASSET_ID, status: 'ready' });
    });
    expect(setCover).toHaveBeenCalledWith(
      HIGHLIGHT.id,
      { assetId: ASSET_ID },
      { communityId: null },
    );
  });

  it('C3. an asset that fails processing toasts the generic copy and writes nothing', async () => {
    readiness.value = { phase: 'failed', issue: null };
    await managerEditing();
    await act(async () => {
      await upload.options?.onCompleted({ id: ASSET_ID, status: 'processing' });
    });
    expect(setCover).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: lookup('highlights.errors.generic'),
    });
  });
});

/**
 * 10-14 Task 3 (UI-D-713, UI-D-705): the creator of a member community curates their highlights. The
 * "Adicionar stories" list is the member's OWN history (the same pager), its helper adds that every
 * member will read the story in the community, and switching a story ON asks once per opening of the
 * picker (the confirm of plan 12); switching OFF and the organization's manager are untouched.
 */
describe('HighlightManager — the member creator’s "Adicionar stories" (10-14)', () => {
  const STORY_A = {
    id: '33333333-3333-4333-8333-333333333331',
    date: '12 nov',
    thumbnailAssetId: ASSET_ID,
    thumbnailVariantWidths: [],
    thumbnailAlt: '',
    caption: 'Primeiro',
    captionMuted: false,
    meta: '',
  };
  const STORY_B = { ...STORY_A, id: '33333333-3333-4333-8333-333333333332', date: '13 nov' };
  const MEMBER_HELPER =
    'Todos os membros verão este story na comunidade. Stories expirados também podem entrar em um destaque.';
  const CONFIRM_TITLE = 'Mostrar este story na comunidade?';

  async function openPicker(member: boolean) {
    const actions = await import('@/app/(app)/stories/highlight-actions');
    const stories = await import('@/app/(app)/stories/story-actions');
    vi.mocked(stories.loadMoreOwnStoriesAction).mockResolvedValue({
      ok: true,
      items: [STORY_A, STORY_B],
      nextCursor: null,
    } as never);
    vi.mocked(actions.addStoryToHighlightAction).mockResolvedValue({
      ok: true,
      highlightCount: 1,
    });
    loadEdit.mockResolvedValue({ ok: true, highlight: HIGHLIGHT, items: [] });
    render(
      <HighlightManager
        place={{ communityId: '44444444-4444-4444-8444-444444444444' }}
        placeLabel="Clube"
        initialItems={[HIGHLIGHT]}
        archived={false}
        editTarget={HIGHLIGHT.id}
        publishHref="/stories/publicar"
        member={member}
      />,
    );
    await act(async () => {});
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: lookup('highlights.edit.addStories') }));
    });
    return actions;
  }

  const rowSwitch = (story: { date: string }) =>
    screen.getByRole('switch', {
      name: lookup('highlights.picker.row', { date: story.date }),
    });

  it('H1. the member helper names the whole community; the organization keeps the shipped one', async () => {
    await openPicker(true);
    expect(screen.getByText(MEMBER_HELPER)).toBeTruthy();
    cleanup();

    await openPicker(false);
    expect(screen.queryByText(MEMBER_HELPER)).toBeNull();
    expect(screen.getByText(lookup('highlights.picker.helper'))).toBeTruthy();
  });

  it('H2. the first switch-on of an opening asks, writes only after the confirm, and the second writes at once', async () => {
    const actions = await openPicker(true);

    await act(async () => {
      fireEvent.click(rowSwitch(STORY_A));
    });
    expect(screen.getByRole('dialog', { name: CONFIRM_TITLE })).toBeTruthy();
    expect(actions.addStoryToHighlightAction).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mostrar na comunidade' }));
    });
    expect(actions.addStoryToHighlightAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(rowSwitch(STORY_B));
    });
    expect(screen.queryByRole('dialog', { name: CONFIRM_TITLE })).toBeNull();
    expect(actions.addStoryToHighlightAction).toHaveBeenCalledTimes(2);
  });

  it('H3. "Não mostrar" writes nothing and the switch stays off', async () => {
    const actions = await openPicker(true);

    await act(async () => {
      fireEvent.click(rowSwitch(STORY_A));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Não mostrar' }));
    });

    expect(actions.addStoryToHighlightAction).not.toHaveBeenCalled();
    expect(rowSwitch(STORY_A).getAttribute('aria-checked')).toBe('false');
  });

  it('H4. the organization’s manager switches a story on at once, with no confirmation', async () => {
    const actions = await openPicker(false);

    await act(async () => {
      fireEvent.click(rowSwitch(STORY_A));
    });
    expect(screen.queryByRole('dialog', { name: CONFIRM_TITLE })).toBeNull();
    expect(actions.addStoryToHighlightAction).toHaveBeenCalledTimes(1);
  });
});
