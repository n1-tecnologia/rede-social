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

const { catalog, toast, createHighlight } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return {
    catalog: read('stories').stories as Record<string, unknown>,
    toast: { show: vi.fn(), dismiss: vi.fn() },
    createHighlight: vi.fn(),
  };
});

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
  return {
    motion: proxy,
    AnimatePresence: ({ children }: { children?: unknown }) => children,
    useReducedMotion: () => true,
  };
});

vi.mock('@tria/ui', async (orig) => ({
  ...(await orig<typeof import('@tria/ui')>()),
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
  loadHighlightEditAction: vi.fn(async () => ({ ok: false })),
  removeStoryFromHighlightAction: vi.fn(),
  renameHighlightAction: vi.fn(),
  reorderHighlightsAction: vi.fn(),
  setHighlightCoverAction: vi.fn(),
}));

vi.mock('@/app/(app)/stories/story-actions', () => ({
  loadMoreOwnStoriesAction: vi.fn(async () => ({ ok: true, items: [], nextCursor: null })),
}));

// The real hook reaches server actions → `lib/api` → `lib/env`; the manager reads only this shape.
vi.mock('@/components/media/useSignedUpload', () => ({
  useSignedUpload: () => ({
    state: 'idle',
    progress: 0,
    error: null,
    pick: vi.fn(),
    reject: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
  }),
}));

const { STORY_HIGHLIGHT_MAX_ITEMS, STORY_HIGHLIGHT_MAX_PER_PLACE } = await import(
  '@tria/module-stories/contracts'
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
