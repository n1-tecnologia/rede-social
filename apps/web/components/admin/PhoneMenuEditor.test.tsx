// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 12.3-16 (D-697, D-698, UI-D-686, UI-D-694) — Configurações › Menu do app saves through the API.
 * The catalog is the REAL `admin.json`; the router, the toast and the two server actions are stubbed.
 *
 * Claims: a changed draft calls the save action with the three lists (the hidden one holding only the
 * items the shell knows) while the pending label shows and the button stays; success toasts "Menu
 * salvo." and refreshes; a draft equal to the shell's own menu calls the clear action instead and
 * "Restaurar o padrão" only fills the draft; a rule refusal and a generic failure show their sentence in
 * the footer row and keep the draft; a draft that breaks a rule is stopped by the contract's own
 * check, without a call; the scope line names who sees the menu and no switch per role or language is
 * offered.
 */

const { admin, toast, router } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const catalog = JSON.parse(
    readFileSync(join(process.cwd(), 'messages', 'pt-BR', 'admin.json'), 'utf8'),
  );
  return {
    admin: catalog.admin as Record<string, unknown>,
    toast: { show: vi.fn(), dismiss: vi.fn() },
    router: { push: vi.fn(), refresh: vi.fn() },
  };
});

const lookup = (ns: string, key: string, values?: Record<string, unknown>) => {
  const path = [...ns.split('.').slice(1), ...key.split('.')];
  const raw = path.reduce<unknown>(
    (node, part) => (node as Record<string, unknown>)?.[part],
    admin,
  );
  return String(raw ?? key).replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ''));
};

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) =>
    lookup(ns, key, values),
}));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

const { PhoneMenuEditor } = await import('./PhoneMenuEditor');

const ITEMS = [
  { key: 'home', label: 'Início', icon: 'home' },
  { key: 'communities', label: 'Comunidades', icon: 'users' },
  { key: 'events', label: 'Eventos', icon: 'calendar' },
  { key: 'profile', label: 'Perfil', icon: 'user' },
  { key: 'store', label: 'Loja', icon: 'shopping-bag' },
];
const FIXED = [{ key: 'notifications', label: 'Notificações', icon: 'bell' }];
const BRAND = { displayName: 'Rede Demo', logoUrl: null };
const DEFAULTS = { bar: ['home', 'communities', 'events', 'profile'], top: [] as string[] };

const SAVE = 'Salvar';
const RULES = 'O menu não segue as regras. Atualize a página e tente de novo.';
const GENERIC = 'Não foi possível salvar o menu. Tente de novo.';

type Result = { ok: true } | { ok: false; code: 'rules' | 'generic' };

function setup(
  options: {
    initial?: { bar: string[]; top: string[] };
    onSave?: (menu: unknown) => Promise<Result>;
    onClear?: () => Promise<Result>;
  } = {},
) {
  const onSave = vi.fn(options.onSave ?? (async () => ({ ok: true }) as Result));
  const onClear = vi.fn(options.onClear ?? (async () => ({ ok: true }) as Result));
  render(
    <PhoneMenuEditor
      items={ITEMS}
      fixed={FIXED}
      initial={options.initial ?? DEFAULTS}
      defaults={DEFAULTS}
      brand={BRAND}
      onSave={onSave}
      onClear={onClear}
    />,
  );
  return { onSave, onClear };
}

const place = (key: string, where: 'bar' | 'top' | 'hidden') => {
  const row = document.querySelector(`[data-menu-row="${key}"]`) as HTMLElement;
  fireEvent.click(row.querySelector(`[data-menu-place="${where}"]`) as HTMLButtonElement);
};
const saveButton = () => screen.getByTestId('menu-save') as HTMLButtonElement;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PhoneMenuEditor saving through the API (UI-D-694)', () => {
  it('a changed draft calls the save action with the three lists; the clear action is not called', async () => {
    const { onSave, onClear } = setup();
    expect(saveButton().disabled).toBe(true);
    place('events', 'top');
    place('store', 'hidden');
    expect(saveButton().disabled).toBe(false);
    await act(async () => fireEvent.click(saveButton()));
    // The hidden list holds the known items the draft leaves out of both bars: Loja only.
    expect(onSave).toHaveBeenCalledWith({
      bar: ['home', 'communities', 'profile'],
      top: ['events'],
      hidden: ['store'],
    });
    expect(onClear).not.toHaveBeenCalled();
  });

  it('pending reads "Salvando…" in the same button, which stays; success toasts "Menu salvo." and refreshes', async () => {
    let resolve: (value: Result) => void = () => {};
    const { onSave } = setup({ onSave: () => new Promise<Result>((r) => (resolve = r)) });
    place('events', 'top');
    fireEvent.click(saveButton());
    expect(onSave).toHaveBeenCalledTimes(1);
    const pending = await screen.findByTestId('menu-save');
    expect(pending).toBe(saveButton());
    expect(pending.textContent).toContain('Salvando…');
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('menu-restore') as HTMLButtonElement).disabled).toBe(true);

    await act(async () => resolve({ ok: true }));
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Menu salvo.' });
    expect(router.refresh).toHaveBeenCalled();
    expect(saveButton().textContent).toContain(SAVE);
    // What was saved is now the baseline: nothing left to save.
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('"Restaurar o padrão" only fills the draft; saving the shell\'s own menu clears the saved layout', async () => {
    const { onSave, onClear } = setup({
      initial: { bar: ['communities', 'home', 'events', 'profile'], top: ['store'] },
    });
    expect((screen.getByTestId('menu-restore') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('menu-restore'));
    expect(onClear).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(false);
    expect((screen.getByTestId('menu-restore') as HTMLButtonElement).disabled).toBe(true);

    await act(async () => fireEvent.click(saveButton()));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Menu salvo.' });
    expect(router.refresh).toHaveBeenCalled();
  });

  it('a rule refusal shows its sentence in the footer row and keeps the draft', async () => {
    setup({ onSave: async () => ({ ok: false, code: 'rules' }) });
    place('events', 'top');
    await act(async () => fireEvent.click(saveButton()));
    expect(screen.getByRole('alert').textContent).toBe(RULES);
    expect(toast.show).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    const row = document.querySelector('[data-menu-row="events"]') as HTMLElement;
    expect(within(row).getByRole('button', { name: 'Topo' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(saveButton().disabled).toBe(false);
  });

  it('a generic failure, a thrown call included, shows the generic sentence and keeps the draft', async () => {
    setup({
      onSave: async () => {
        throw new Error('network');
      },
    });
    place('events', 'top');
    await act(async () => fireEvent.click(saveButton()));
    expect(screen.getByRole('alert').textContent).toBe(GENERIC);
    const row = document.querySelector('[data-menu-row="events"]') as HTMLElement;
    expect(within(row).getByRole('button', { name: 'Topo' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it("a draft that breaks a rule is stopped by the contract's check, without a call", async () => {
    // A layout without Início in the bar (stale data): the editor's own buttons never allow it, the
    // shared pre-check still refuses it.
    const { onSave, onClear } = setup({
      initial: { bar: ['communities', 'events', 'profile'], top: [] },
    });
    place('events', 'top');
    await act(async () => fireEvent.click(saveButton()));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(RULES);
  });

  it('keeps the shipped hints: Início cannot leave the bar, Perfil cannot go to the top', () => {
    setup();
    const homeRow = document.querySelector('[data-menu-row="home"]') as HTMLElement;
    const homeTop = homeRow.querySelector('[data-menu-place="top"]') as HTMLButtonElement;
    expect(homeTop.disabled).toBe(true);
    expect(homeTop.title).toBe('Início fica sempre na barra.');
    const profileRow = document.querySelector('[data-menu-row="profile"]') as HTMLElement;
    const profileTop = profileRow.querySelector('[data-menu-place="top"]') as HTMLButtonElement;
    expect(profileTop.disabled).toBe(true);
    expect(profileTop.title).toBe('O Perfil também abre pela foto no topo.');
  });

  it('says who sees the menu, above the footer row, and offers no per-role or per-language switch (D-698)', () => {
    setup();
    const scope = screen.getByText('Vale só no celular. Todos os membros veem este menu.');
    expect(scope.className).toContain('text-xs');
    expect(scope.className).toContain('text-text-tertiary');
    expect(document.body.textContent).not.toContain('neste aparelho');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    // The scope line comes before the buttons of the footer row.
    const restore = screen.getByTestId('menu-restore');
    expect(scope.compareDocumentPosition(restore) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
