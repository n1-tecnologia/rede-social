// @vitest-environment happy-dom
import type { ModuleView } from '@rede-social/module-courses/contracts';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 12.3-08 — the module sheet's two real pickers (NOVF-03, OQ-1, UI-D-691), against the REAL merged
 * pt-BR catalogs through next-intl's own `createTranslator`. Stubbed: the server actions, the toast
 * and the upload hook (one stateful stand-in per `useSignedUpload` call, in the sheet's own order: the
 * first is the card image, the second the Topo). Real: the sheet, `CoverField`, the shipped
 * `BottomSheet` and inputs.
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

const { toast, create, update, remove } = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

MotionGlobalConfig.skipAnimations = true;

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

vi.mock('../curriculum-actions', () => ({
  createModuleAction: create,
  updateModuleAction: update,
  deleteModuleAction: remove,
}));

type UploadStub = {
  pick: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  options: { onCompleted: (asset: unknown) => void };
  setState: (state: string) => void;
  setProgress: (percent: number) => void;
};
const uploads = vi.hoisted(() => ({ list: [] as UploadStub[] }));

vi.mock('@/components/media/useSignedUpload', async () => {
  const React = await import('react');
  return {
    useSignedUpload: (options: UploadStub['options']) => {
      const [state, setState] = React.useState('idle');
      const [progress, setProgress] = React.useState(0);
      const slot = React.useRef<number | null>(null);
      if (slot.current === null) slot.current = uploads.list.length;
      const own = React.useRef({
        pick: vi.fn(),
        reject: vi.fn(),
        cancel: vi.fn(),
        reset: vi.fn(),
      }).current;
      uploads.list[slot.current] = { ...own, options, setState, setProgress };
      return { state, progress, error: null, ...own };
    },
  };
});

const { ModuleSheet } = await import('./ModuleSheet');

const COURSE = '11111111-1111-4111-8111-111111111111';
const MODULE = '22222222-2222-4222-8222-222222222222';
const CARD_ID = '66666666-6666-4666-8666-666666666666';
const TOP_ID = '77777777-7777-4777-8777-777777777777';
const NEW_CARD_ID = '99999999-9999-4999-8999-999999999999';
const NEW_TOP_ID = '88888888-8888-4888-8888-888888888888';

const STORED: ModuleView = {
  id: MODULE,
  title: 'Fundamentos',
  summary: '',
  position: 2,
  requiresPrevious: false,
  lessonCount: 0,
  durationSeconds: 0,
  lessons: [],
  coverAssetId: CARD_ID,
  topCoverAssetId: TOP_ID,
};

const noop = () => {};

function renderNew() {
  return render(
    <ModuleSheet
      open
      mode="new"
      courseId={COURSE}
      module={null}
      position={2}
      onClose={noop}
      onCreated={noop}
      onUpdated={noop}
      onRemoved={noop}
    />,
  );
}

function renderEdit(module: ModuleView = STORED) {
  return render(
    <ModuleSheet
      open
      mode="edit"
      courseId={COURSE}
      module={module}
      position={2}
      onClose={noop}
      onCreated={noop}
      onUpdated={noop}
      onRemoved={noop}
    />,
  );
}

const asset = (id: string) => ({ id, variants: [{ width: 640 }] });
const done = (slot: number, id: string) =>
  act(() => {
    uploads.list[slot]?.options.onCompleted(asset(id));
  });
const hold = (slot: number, state: string, progress = 0) =>
  act(() => {
    uploads.list[slot]?.setState(state);
    uploads.list[slot]?.setProgress(progress);
  });
const fileInput = (name: string) =>
  document.querySelector(`input[type="file"][aria-label="${name}"]`) as HTMLInputElement;
const submitButton = () => document.querySelector('button[type="submit"]') as HTMLButtonElement;
const titleInput = () => document.getElementById('module-title') as HTMLInputElement;
const topBlock = () => document.querySelector('[data-cover-block="page"]') as HTMLElement;
const cardRemove = () =>
  document.querySelector('[data-module-cover-remove]') as HTMLButtonElement | null;
const topRemove = () =>
  document.querySelector('[data-module-top-cover-remove]') as HTMLButtonElement | null;
const cardError = () => document.querySelector('[data-module-cover-error]');
const topError = () => document.querySelector('[data-module-top-cover-error]');

async function submit() {
  await act(async () => {
    fireEvent.submit(submitButton().closest('form') as HTMLFormElement);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  uploads.list.length = 0;
});
afterEach(cleanup);

describe('ModuleSheet — two real pickers (NOVF-03, OQ-1, UI-D-691)', () => {
  it('1. a card image and a Topo are two uploads: create sends two different ids', async () => {
    create.mockResolvedValue({ ok: true, module: STORED });
    renderNew();
    expect(uploads.list).toHaveLength(2);
    fireEvent.change(titleInput(), { target: { value: 'Fundamentos' } });
    await done(0, CARD_ID);
    await done(1, TOP_ID);
    await submit();
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(COURSE, {
      title: 'Fundamentos',
      summary: '',
      requiresPrevious: false,
      coverAssetId: CARD_ID,
      topCoverAssetId: TOP_ID,
    });
  });

  it('2. a create with a card image and no Topo sends topCoverAssetId null, never the card id; with neither, both null', async () => {
    create.mockResolvedValue({ ok: true, module: STORED });
    renderNew();
    fireEvent.change(titleInput(), { target: { value: 'Só o cartão' } });
    await done(0, CARD_ID);
    await submit();
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[1]).toMatchObject({
      coverAssetId: CARD_ID,
      topCoverAssetId: null,
    });
    cleanup();
    uploads.list.length = 0;
    create.mockClear();

    renderNew();
    fireEvent.change(titleInput(), { target: { value: 'Sem imagens' } });
    await submit();
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[1]).toMatchObject({
      coverAssetId: null,
      topCoverAssetId: null,
    });
  });

  it('3. both blocks are real pickers: each has its own input, hooks and the module helper strings', () => {
    renderNew();
    expect(fileInput('Adicionar capa')).toBeTruthy();
    expect(fileInput('Adicionar imagem do topo')).toBeTruthy();
    expect(document.querySelector('[data-module-cover-preview]')).not.toBeNull();
    expect(document.querySelector('[data-module-top-cover-preview]')).not.toBeNull();
    expect(
      document.body.textContent?.includes('Opcional. Sem capa, o módulo usa a do curso.'),
    ).toBe(true);
    expect(
      within(topBlock()).getByText(
        'Opcional. Sem imagem própria, o topo usa a imagem do cartão do módulo e, sem ela, a capa do curso.',
      ),
    ).toBeTruthy();
    // Nothing picked yet: no remove control on either block.
    expect(cardRemove()).toBeNull();
    expect(topRemove()).toBeNull();
  });

  it('4. the edit sheet opens with the stored images and sends only what changed: removing the Topo sends topCoverAssetId null and leaves the card alone', async () => {
    update.mockResolvedValue({ ok: true, module: STORED });
    renderEdit();
    expect(cardRemove()).not.toBeNull();
    expect(topRemove()).not.toBeNull();
    expect(fileInput('Trocar capa')).toBeTruthy();
    expect(fileInput('Trocar imagem do topo')).toBeTruthy();
    // Nothing changed yet: no save.
    expect(submitButton().disabled).toBe(true);

    fireEvent.click(topRemove() as HTMLButtonElement);
    expect(topRemove()).toBeNull();
    expect(cardRemove()).not.toBeNull();
    expect(submitButton().disabled).toBe(false);
    await submit();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(COURSE, MODULE, { topCoverAssetId: null });
  });

  it('5. replacing the card image on edit patches coverAssetId alone; removing it patches null', async () => {
    update.mockResolvedValue({ ok: true, module: STORED });
    renderEdit();
    await done(0, NEW_CARD_ID);
    await submit();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(COURSE, MODULE, { coverAssetId: NEW_CARD_ID });
    cleanup();
    uploads.list.length = 0;
    update.mockClear();

    renderEdit();
    fireEvent.click(cardRemove() as HTMLButtonElement);
    await submit();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(COURSE, MODULE, { coverAssetId: null });
  });

  it('6. each block has its own progress and Cancelar; Save is disabled while EITHER upload is in flight', async () => {
    renderEdit();
    fireEvent.change(titleInput(), { target: { value: 'Outro título' } });
    expect(submitButton().disabled).toBe(false);

    await hold(1, 'progress', 40);
    expect(submitButton().disabled).toBe(true);
    expect(within(topBlock()).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
    expect(document.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
    fireEvent.click(within(topBlock()).getByRole('button', { name: 'Cancelar envio' }));
    expect(uploads.list[1]?.cancel).toHaveBeenCalledTimes(1);
    expect(uploads.list[0]?.cancel).not.toHaveBeenCalled();

    await hold(1, 'idle');
    expect(submitButton().disabled).toBe(false);
    await hold(0, 'preparing');
    expect(submitButton().disabled).toBe(true);
    await hold(0, 'idle');
    expect(submitButton().disabled).toBe(false);
  });

  it('7. cover_invalid shows its sentence under the card block only; top_cover_invalid under the Topo block only; nothing toasts', async () => {
    update.mockResolvedValue({ ok: false, code: 'cover_invalid' });
    renderEdit();
    await done(0, NEW_CARD_ID);
    await submit();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(cardError()?.textContent).toBe('Não foi possível usar esta imagem. Escolha outra.');
    expect(cardError()?.getAttribute('role')).toBe('alert');
    expect(topError()).toBeNull();
    expect(toast.show).not.toHaveBeenCalled();
    cleanup();
    uploads.list.length = 0;
    update.mockClear();

    update.mockResolvedValue({ ok: false, code: 'top_cover_invalid' });
    renderEdit();
    await done(1, NEW_TOP_ID);
    await submit();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(topError()?.textContent).toBe(
      'Não foi possível usar esta imagem no topo. Escolha outra.',
    );
    expect(topError()?.getAttribute('role')).toBe('alert');
    expect(cardError()).toBeNull();
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('8. a paste lands in the card block; the inputs and a drop feed their own block', () => {
    renderNew();
    const file = new File(['x'], 'foto.png', { type: 'image/png' });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { files: [file] } });
    document.dispatchEvent(paste);
    expect(uploads.list[0]?.pick).toHaveBeenCalledWith(file);
    expect(uploads.list[1]?.pick).not.toHaveBeenCalled();

    const topFile = new File(['y'], 'topo.png', { type: 'image/png' });
    fireEvent.change(fileInput('Adicionar imagem do topo'), { target: { files: [topFile] } });
    expect(uploads.list[1]?.pick).toHaveBeenCalledWith(topFile);
    expect(uploads.list[0]?.pick).toHaveBeenCalledTimes(1);
  });
});
