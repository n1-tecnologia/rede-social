// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomePromoView } from '@/lib/courses-home-view';

/**
 * 12.3-14 (D-699, UI-D-686, UI-D-688) — the administrator's pencil on Início's store promotion, now
 * kept by the API for every member. The invitation is the one the SERVER built for the saved
 * product (`view`); the sheet (the shipped `BottomSheet`) keeps a DRAFT over "Mais recente da loja"
 * and every product as a named radiogroup until Save: Save is pending and the sheet cannot be
 * closed while the call is in flight; success closes, toasts and refreshes the route; a refusal keeps
 * the sheet and the draft with one alert line above Save; a stale answer refreshes and re-seeds the
 * draft. The server action is a stub; the sheet, the body and the real pt-BR catalog are real. The
 * web workspace has no jest-dom: plain DOM assertions only.
 */

const { refresh, toast, setPromo } = vi.hoisted(() => ({
  refresh: vi.fn(),
  toast: { show: vi.fn() },
  setPromo: vi.fn(),
}));

MotionGlobalConfig.skipAnimations = true;

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));
vi.mock('../loja/actions', () => ({ setStorePromoAction: setPromo }));

const { HomePromoChoice } = await import('./HomePromoChoice');
type HomePromoOption = import('./HomePromoChoice').HomePromoOption;

const NEW = '11111111-1111-4111-8111-111111111111';
const OLD = '22222222-2222-4222-8222-222222222222';

const VIEW: HomePromoView = {
  kind: 'product',
  images: [],
  eyebrow: 'Destaque da loja',
  title: 'Formação X',
  body: 'Disponível agora na loja de Escola Demo.',
  chips: ['R$ 97,00'],
  cta: { href: `/loja/${NEW}`, label: 'Conhecer agora' },
};

const OPTIONS: HomePromoOption[] = [
  { id: NEW, name: 'Formação X', price: 'R$ 97,00', thumb: <span data-thumb={NEW} /> },
  { id: OLD, name: 'Mentoria Y', price: 'Grátis', thumb: <span data-thumb={OLD} /> },
];

const LABELS = {
  open: 'Escolher o destaque da loja',
  title: 'Destaque da loja',
  helper: 'Escolha o produto que aparece neste espaço do Início.',
  scope: 'Todos os membros veem este produto no Início.',
  latest: 'Mais recente da loja',
  latestLine: 'Padrão · Formação X',
  save: 'Salvar',
  saving: 'Salvando…',
  cancel: 'Cancelar',
  saved: 'Destaque da loja salvo.',
  errors: {
    promo_invalid: 'Esse produto não está mais à venda. Atualizamos a lista; escolha de novo.',
    generic: 'Não foi possível salvar o destaque. Tente de novo.',
  },
};

function tree(
  over: { view?: HomePromoView; options?: HomePromoOption[]; initialChoice?: string | null } = {},
) {
  return (
    <HomePromoChoice
      view={over.view ?? VIEW}
      options={over.options ?? OPTIONS}
      initialChoice={over.initialChoice ?? null}
      labels={LABELS}
    />
  );
}

function draw(initialChoice: string | null = null) {
  return render(tree({ initialChoice }));
}

/** A promise the test settles by hand, to hold a save "in flight". */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const title = () => document.getElementById('courses-home-promo-title')?.textContent;
const cta = () => screen.getByTestId('courses-home-promo-cta').getAttribute('href');
const pencil = () => screen.getByTestId('courses-home-promo-edit');
const saveButton = () => screen.getByTestId('courses-home-promo-save') as HTMLButtonElement;
const cancelButton = () => screen.getByText('Cancelar').closest('button') as HTMLButtonElement;
const checkedIds = () =>
  [...document.querySelectorAll('[data-promo-option]')]
    .filter((node) => node.getAttribute('aria-checked') === 'true')
    .map((node) => node.getAttribute('data-promo-option'));

async function openPicker() {
  fireEvent.click(pencil());
  const dialog = await screen.findByRole('dialog');
  return { dialog, radios: within(dialog).getAllByRole('radio') };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('HomePromoChoice', () => {
  it('draws the invitation the server built, with the pencil that opens a dialog', () => {
    draw();
    expect(title()).toBe('Formação X');
    expect(cta()).toBe(`/loja/${NEW}`);
    expect(pencil().getAttribute('aria-label')).toBe('Escolher o destaque da loja');
    expect(pencil().getAttribute('aria-haspopup')).toBe('dialog');
    expect(pencil().getAttribute('aria-expanded')).toBe('false');
  });

  it('draws the saved promotion from the first render (no flash of the newest)', () => {
    render(
      tree({
        initialChoice: OLD,
        view: {
          ...VIEW,
          title: 'Mentoria Y',
          chips: ['Grátis'],
          cta: { href: `/loja/${OLD}`, label: 'Conhecer agora' },
        },
      }),
    );
    expect(title()).toBe('Mentoria Y');
    expect(cta()).toBe(`/loja/${OLD}`);
    expect(screen.getByText('Grátis')).toBeTruthy();
  });

  it('lists "Mais recente da loja" first then every product, the saved one marked, with who sees it', async () => {
    draw(OLD);
    const { dialog, radios } = await openPicker();
    expect(within(dialog).getByRole('radiogroup').getAttribute('aria-label')).toBe(
      'Destaque da loja',
    );
    expect(dialog.textContent).toContain('Todos os membros veem este produto no Início.');
    expect(dialog.textContent).not.toContain('neste aparelho');
    expect(radios.map((radio) => radio.getAttribute('data-promo-option'))).toEqual([
      'latest',
      NEW,
      OLD,
    ]);
    expect(checkedIds()).toEqual([OLD]);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, -1, 0]);
    expect(radios[0]?.textContent).toContain('Padrão · Formação X');
  });

  it('with no saved promotion "Mais recente da loja" is the marked one', async () => {
    draw(null);
    await openPicker();
    expect(checkedIds()).toEqual(['latest']);
  });

  it('with no active product the sheet lists only "Mais recente da loja" and Save stays reachable', async () => {
    render(tree({ options: [] }));
    const { radios } = await openPicker();
    expect(radios.map((radio) => radio.getAttribute('data-promo-option'))).toEqual(['latest']);
    expect(saveButton().disabled).toBe(false);
  });

  it('a pick changes only the draft: nothing is sent and the invitation stays until the page re-reads', async () => {
    draw();
    const { radios } = await openPicker();
    fireEvent.click(radios[2] as HTMLElement);
    expect(setPromo).not.toHaveBeenCalled();
    expect(checkedIds()).toEqual([OLD]);
    expect(title()).toBe('Formação X');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Save sends the chosen product id, or null for "Mais recente da loja"', async () => {
    setPromo.mockResolvedValue({ ok: true });
    draw();
    let { radios } = await openPicker();
    fireEvent.click(radios[2] as HTMLElement);
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(setPromo).toHaveBeenLastCalledWith(OLD);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    cleanup();
    draw(OLD);
    ({ radios } = await openPicker());
    fireEvent.click(radios[0] as HTMLElement);
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(setPromo).toHaveBeenLastCalledWith(null);
  });

  it('pending: "Salvando…", Save disabled, the sheet cannot be closed; then success closes, toasts and refreshes', async () => {
    const call = deferred<{ ok: true }>();
    setPromo.mockReturnValue(call.promise);
    draw();
    const { radios } = await openPicker();
    fireEvent.click(radios[2] as HTMLElement);
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(saveButton().textContent).toContain('Salvando…');
    expect(saveButton().disabled).toBe(true);
    expect(cancelButton().disabled).toBe(true);
    expect(radios.every((radio) => (radio as HTMLButtonElement).disabled)).toBe(true);
    // Escape and the backdrop do nothing while the call is in flight.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeNull();
    await act(async () => {
      call.resolve({ ok: true });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Destaque da loja salvo.',
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a refusal keeps the sheet and the draft, with one alert line above Save', async () => {
    setPromo.mockResolvedValue({ ok: false, code: 'generic' });
    draw();
    const { radios } = await openPicker();
    fireEvent.click(radios[2] as HTMLElement);
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent).toBe('Não foi possível salvar o destaque. Tente de novo.');
    expect(checkedIds()).toEqual([OLD]);
    expect(saveButton().disabled).toBe(false);
    expect(toast.show).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a thrown call is the generic sentence', async () => {
    setPromo.mockRejectedValue(new Error('network'));
    draw();
    await openPicker();
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(screen.getByRole('alert').textContent).toBe(
      'Não foi possível salvar o destaque. Tente de novo.',
    );
  });

  it('a stale answer refreshes and re-seeds the draft from the refreshed list', async () => {
    setPromo.mockResolvedValue({ ok: false, code: 'promo_invalid' });
    const { rerender } = draw();
    const { radios } = await openPicker();
    fireEvent.click(radios[2] as HTMLElement);
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toBe(
      'Esse produto não está mais à venda. Atualizamos a lista; escolha de novo.',
    );
    // The page re-reads: the product is gone from the store, the newest is the promotion again.
    rerender(tree({ options: [OPTIONS[0] as HomePromoOption], initialChoice: null }));
    expect(checkedIds()).toEqual(['latest']);
    // The line stays: the admin must know why the list changed.
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('opens on what is saved every time; a cancelled edit leaves nothing behind', async () => {
    draw(OLD);
    const { radios } = await openPicker();
    fireEvent.click(radios[1] as HTMLElement);
    expect(checkedIds()).toEqual([NEW]);
    fireEvent.click(cancelButton());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await openPicker();
    expect(checkedIds()).toEqual([OLD]);
    expect(setPromo).not.toHaveBeenCalled();
  });

  it('the arrows walk the options without picking', async () => {
    draw();
    const { radios } = await openPicker();
    act(() => (radios[0] as HTMLElement).focus());
    fireEvent.keyDown(radios[0] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(radios[1]);
    fireEvent.keyDown(radios[1] as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(radios[2]);
    fireEvent.keyDown(radios[2] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(radios[0]);
    expect(checkedIds()).toEqual(['latest']);
  });
});

describe('the catalog words of the sheet', () => {
  it('say who sees the promotion and confirm the save, with no device note left', async () => {
    const { createTranslator } = await import('next-intl');
    const { join } = await import('node:path');
    const { loadMessages } = await import('@/i18n/messages');
    const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
    const t = createTranslator({ locale: 'pt-BR', messages }) as unknown as (key: string) => string;
    expect(t('courses.member.home.promo.edit.scope')).toBe(LABELS.scope);
    expect(t('courses.member.home.promo.edit.saved')).toBe(LABELS.saved);
    expect(t('courses.member.home.promo.edit.errors.promo_invalid')).toBe(
      LABELS.errors.promo_invalid,
    );
    expect(t('courses.member.home.promo.edit.errors.generic')).toBe(LABELS.errors.generic);
    const edit = (
      messages as unknown as {
        courses: { member: { home: { promo: { edit: Record<string, unknown> } } } };
      }
    ).courses.member.home.promo.edit;
    expect(edit).not.toHaveProperty('device');
  });
});
