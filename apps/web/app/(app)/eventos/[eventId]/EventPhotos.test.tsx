// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 2026-10-03 — the detail page's "Fotos" island, against the REAL `events.json` catalog formatted by
 * next-intl's own translator (so the ICU plurals of the toasts are proved too). Stubbed: the three
 * photo actions, the asset readiness read, the upload hook and the toast. Real: the island, the
 * module's `EventPhotoGrid` / `EventPhotoViewer` and the `@rede-social/ui` `ConfirmDialog`.
 *
 * Claims:
 *  1. a member sees the grid, one named button per photo, and no add or remove control;
 *  2. the empty state speaks to the member and to the manager; an unreadable first page retries;
 *  3. a tap opens the viewer at that photo, with the counter, and Escape closes it;
 *  4. "Ver mais fotos" appends the next page without duplicates, and a failure says so;
 *  5. a manager's remove is confirmed, calls the action, drops the tile and toasts;
 *  6. a manager's "Adicionar fotos" uploads each file in order, waits for each asset to be READY,
 *     adds it, puts the photos at the top, and closes the batch with ONE toast (failures counted);
 *  7. a server re-render with the same photos keeps what the island loaded; new photos re-seed it.
 */

const { catalog, toast, actions, readiness, upload } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  return {
    catalog: JSON.parse(
      readFileSync(join(process.cwd(), 'messages', 'pt-BR', 'events.json'), 'utf8'),
    ) as { events: Record<string, unknown> },
    toast: { show: vi.fn(), dismiss: vi.fn() },
    actions: { load: vi.fn(), add: vi.fn(), remove: vi.fn() },
    readiness: vi.fn(),
    upload: {
      onCompleted: null as null | ((asset: { id: string }) => void | Promise<void>),
      picked: [] as string[],
    },
  };
});

MotionGlobalConfig.skipAnimations = true;

vi.mock('next-intl', async () => {
  const actual = await vi.importActual<typeof import('next-intl')>('next-intl');
  return {
    useTranslations: (namespace: string) =>
      actual.createTranslator({ locale: 'pt-BR', messages: catalog, namespace } as never),
  };
});

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

vi.mock('../actions', () => ({
  loadEventPhotosAction: actions.load,
  addEventPhotoAction: actions.add,
  removeEventPhotoAction: actions.remove,
}));

vi.mock('@/app/(app)/configuracoes/midia/actions', () => ({ fetchAssetStatusAction: readiness }));

/** The upload hook, reduced to its contract: `pick` completes with an asset named after the file. */
vi.mock('@/components/media/useSignedUpload', () => ({
  useSignedUpload: (options: { onCompleted: (asset: { id: string }) => void | Promise<void> }) => {
    upload.onCompleted = options.onCompleted;
    return {
      state: 'idle',
      progress: 0,
      error: null,
      pick: async (file: File) => {
        upload.picked.push(file.name);
        await options.onCompleted({ id: `asset-${file.name}` });
      },
      reject: vi.fn(),
      cancel: vi.fn(),
      reset: vi.fn(),
    };
  },
}));

const { EventPhotos, PHOTO_READY_FIRST_DELAY_MS } = await import('./EventPhotos');

const EVENT_ID = '44444444-4444-4444-8444-4444444444e1';
const photo = (n: number) => ({
  id: `0e000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
  mediaAssetId: `0f000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
  variantWidths: [320, 640, 1080, 1600],
});

const E = catalog.events as {
  photos: {
    title: string;
    add: string;
    more: string;
    empty: { title: string; body: string; bodyManager: string };
    errors: { load: string; loadMore: string; remove: string };
  };
  confirm: { removePhoto: { title: string; confirm: string } };
  toasts: { photoRemoved: string };
  errors: { retry: string };
};

function renderPhotos(props: Partial<Parameters<typeof EventPhotos>[0]> = {}) {
  return render(
    <EventPhotos
      eventId={EVENT_ID}
      eventTitle="Encontro anual"
      canManage={false}
      initialItems={[photo(1), photo(2)]}
      initialCursor={null}
      {...props}
    />,
  );
}

beforeEach(() => {
  for (const mock of [toast.show, actions.load, actions.add, actions.remove, readiness]) {
    mock.mockReset();
  }
  upload.onCompleted = null;
  upload.picked = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('EventPhotos — viewing (every member)', () => {
  it('1. a member sees the grid under "Fotos", one named button per photo, and no add or remove control', () => {
    renderPhotos();
    expect(screen.getByRole('region', { name: E.photos.title })).toBeTruthy();
    expect(screen.getAllByTestId('event-photo')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Abrir foto 1 de 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir foto 2 de 2' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: E.photos.add })).toBeNull();
    expect(document.querySelector('[data-event-photos-input]')).toBeNull();
    expect(screen.queryAllByTestId('event-photo-remove')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: E.photos.more })).toBeNull();
  });

  it('2. the empty state speaks to the member and to the manager; an unreadable first page retries', async () => {
    renderPhotos({ initialItems: [] });
    expect(screen.getByTestId('event-photos-empty').textContent).toContain(E.photos.empty.title);
    expect(screen.getByTestId('event-photos-empty').textContent).toContain(E.photos.empty.body);
    cleanup();

    renderPhotos({ initialItems: [], canManage: true });
    expect(screen.getByTestId('event-photos-empty').textContent).toContain(
      E.photos.empty.bodyManager,
    );
    expect(screen.getByRole('button', { name: E.photos.add })).toBeTruthy();
    cleanup();

    actions.load.mockResolvedValue({ ok: true, items: [photo(3)], nextCursor: null });
    renderPhotos({ initialItems: [], initialError: true });
    expect(screen.getByTestId('event-photos-error').textContent).toContain(E.photos.errors.load);
    fireEvent.click(screen.getByRole('button', { name: E.errors.retry }));
    await waitFor(() => expect(screen.getAllByTestId('event-photo')).toHaveLength(1));
    expect(actions.load).toHaveBeenCalledWith(EVENT_ID);
  });

  it('3. a tap opens the viewer at that photo, with the counter; Escape closes it', async () => {
    renderPhotos();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir foto 2 de 2' }));
    const dialog = screen.getByRole('dialog', { name: 'Fotos do evento Encontro anual' });
    expect(screen.getByTestId('event-photo-counter').textContent).toBe('2 de 2');
    expect(screen.getByRole('button', { name: 'Próxima foto' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Foto anterior' }));
    expect(screen.getByTestId('event-photo-counter').textContent).toBe('1 de 2');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('4. "Ver mais fotos" appends the next page with no duplicate; a failure says so and keeps the grid', async () => {
    actions.load.mockResolvedValueOnce({
      ok: true,
      items: [photo(2), photo(3)],
      nextCursor: null,
    });
    renderPhotos({ initialCursor: 'cursor-1' });
    fireEvent.click(screen.getByRole('button', { name: E.photos.more }));
    await waitFor(() => expect(screen.getAllByTestId('event-photo')).toHaveLength(3));
    expect(actions.load).toHaveBeenCalledWith(EVENT_ID, 'cursor-1');
    expect(screen.queryByRole('button', { name: E.photos.more })).toBeNull();
    cleanup();

    actions.load.mockResolvedValueOnce({ ok: false, code: 'generic' });
    renderPhotos({ initialCursor: 'cursor-1' });
    fireEvent.click(screen.getByRole('button', { name: E.photos.more }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(E.photos.errors.loadMore),
    );
    expect(screen.getAllByTestId('event-photo')).toHaveLength(2);
  });
});

describe('EventPhotos — managing (events.event.manage)', () => {
  it('5. a remove is confirmed, calls the action with the photo id, drops the tile and toasts', async () => {
    actions.remove.mockResolvedValue({ ok: true });
    renderPhotos({ canManage: true });
    fireEvent.click(screen.getByRole('button', { name: 'Remover foto 1' }));
    expect(screen.getByRole('dialog').textContent).toContain(E.confirm.removePhoto.title);
    expect(actions.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: E.confirm.removePhoto.confirm }));
    await waitFor(() => expect(screen.getAllByTestId('event-photo')).toHaveLength(1));
    expect(actions.remove).toHaveBeenCalledWith(EVENT_ID, photo(1).id);
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: E.toasts.photoRemoved });
    cleanup();

    // A failed removal keeps the tile and says so.
    toast.show.mockReset();
    actions.remove.mockResolvedValue({ ok: false, code: 'generic' });
    renderPhotos({ canManage: true });
    fireEvent.click(screen.getByRole('button', { name: 'Remover foto 2' }));
    fireEvent.click(screen.getByRole('button', { name: E.confirm.removePhoto.confirm }));
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: E.photos.errors.remove }),
    );
    expect(screen.getAllByTestId('event-photo')).toHaveLength(2);
  });

  it('6. "Adicionar fotos": each upload in order, waited until READY, added, put on top, ONE toast', async () => {
    vi.useFakeTimers();
    // a.jpg is ready at the second read; b.jpg failed its derivation.
    readiness.mockImplementation(async (assetId: string) =>
      assetId === 'asset-b.jpg'
        ? { ok: true, status: 'failed', issue: null }
        : readiness.mock.calls.filter(([id]) => id === assetId).length > 1
          ? { ok: true, status: 'ready', issue: null }
          : { ok: true, status: 'processing', issue: null },
    );
    actions.add.mockImplementation(async (_eventId: string, assetId: string) => ({
      ok: true,
      photo: photo(assetId === 'asset-a.jpg' ? 9 : 10),
    }));
    renderPhotos({ canManage: true });

    const input = document.querySelector('[data-event-photos-input]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain('image/jpeg');
    const files = ['a.jpg', 'b.jpg'].map((name) => new File([name], name, { type: 'image/jpeg' }));
    await act(async () => {
      fireEvent.change(input, { target: { files } });
    });
    expect(upload.picked).toEqual(['a.jpg', 'b.jpg']);
    // While the batch runs, the add control is busy and the progress line speaks.
    expect(screen.getByRole('button', { name: E.photos.add })).toHaveProperty('disabled', true);
    expect(document.querySelector('[data-event-photos-progress]')).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PHOTO_READY_FIRST_DELAY_MS * 4);
    });

    // Only the READY asset was added, at the top of the grid; the failed one never reached the API.
    expect(actions.add).toHaveBeenCalledTimes(1);
    expect(actions.add).toHaveBeenCalledWith(EVENT_ID, 'asset-a.jpg');
    const tiles = screen.getAllByTestId('event-photo');
    expect(tiles).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Abrir foto 1 de 3' })).toBeTruthy();
    // ONE toast closes the batch: the failure, counted.
    expect(toast.show).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível adicionar 1 foto. Tente novamente.',
    });
    expect(screen.getByRole('button', { name: E.photos.add })).toHaveProperty('disabled', false);
  });

  it('6b. a batch that all lands toasts how many were added, in the plural', async () => {
    vi.useFakeTimers();
    readiness.mockResolvedValue({ ok: true, status: 'ready', issue: null });
    let next = 20;
    actions.add.mockImplementation(async () => {
      next += 1;
      return { ok: true, photo: { ...photo(next) } };
    });
    renderPhotos({ canManage: true, initialItems: [] });
    const input = document.querySelector('[data-event-photos-input]') as HTMLInputElement;
    const files = ['a.jpg', 'b.jpg', 'c.jpg'].map(
      (name) => new File([name], name, { type: 'image/jpeg' }),
    );
    await act(async () => {
      fireEvent.change(input, { target: { files } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PHOTO_READY_FIRST_DELAY_MS * 2);
    });
    expect(actions.add).toHaveBeenCalledTimes(3);
    expect(screen.getAllByTestId('event-photo')).toHaveLength(3);
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: '3 fotos adicionadas.' });
  });
});

describe('EventPhotos — the server seed', () => {
  it('7. the same photos again keep what was loaded; new ones from the server re-seed the island', async () => {
    actions.load.mockResolvedValueOnce({ ok: true, items: [photo(3)], nextCursor: null });
    const { rerender } = renderPhotos({ initialCursor: 'cursor-1' });
    fireEvent.click(screen.getByRole('button', { name: E.photos.more }));
    await waitFor(() => expect(screen.getAllByTestId('event-photo')).toHaveLength(3));

    const props = {
      eventId: EVENT_ID,
      eventTitle: 'Encontro anual',
      canManage: false,
    };
    // A refresh that brings the SAME first page back (a new array, same ids) changes nothing.
    rerender(
      <EventPhotos {...props} initialItems={[photo(1), photo(2)]} initialCursor="cursor-1" />,
    );
    expect(screen.getAllByTestId('event-photo')).toHaveLength(3);
    // A first page that changed (a photo added elsewhere) is the server's truth.
    rerender(
      <EventPhotos
        {...props}
        initialItems={[photo(5), photo(1), photo(2)]}
        initialCursor="cursor-1"
      />,
    );
    expect(screen.getAllByTestId('event-photo')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Abrir foto 1 de 3' })).toBeTruthy();
  });
});
