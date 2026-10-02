// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 08-07 (ADMIN-03, UI-D-280/281, E13/E14) — the Regras editor. The catalogs are the REAL `admin.json`
 * and `signup.json` (the DisplayNameCard.test pattern, with `{name}` interpolation); the router, the
 * toast and the server action are stubbed.
 *
 * Claims the e2e cannot force: the save is disabled for an empty or whitespace-only draft and for the
 * saved text pasted with CRLF and padding (the API's own normalisation); a server `tooLong` shows the
 * field error; a lost permission toasts it and refreshes (UI-D-284); a thrown action toasts the
 * failure and keeps the draft; the preview renders the draft through `RulesText` with the sign-up
 * sheet's title and "Fechar".
 */

// The sheet's springs never settle in happy-dom; skip them (the MemberAdminSheet.test precedent).
MotionGlobalConfig.skipAnimations = true;

const { catalogs, toast, router } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return {
    catalogs: { ...read('admin'), ...read('signup') } as Record<string, unknown>,
    toast: { show: vi.fn(), dismiss: vi.fn() },
    router: { push: vi.fn(), refresh: vi.fn() },
  };
});

const lookup = (ns: string, key: string, values: Record<string, unknown> = {}) => {
  const path = [...ns.split('.'), ...key.split('.')];
  const raw = path.reduce<unknown>(
    (node, part) => (node as Record<string, unknown>)?.[part],
    catalogs,
  );
  return String(raw ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
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

const { RulesEditor } = await import('./RulesEditor');

const SAVED = 'Regra um.\nRegra dois.\n\nSegundo parágrafo.';

function setup(action = vi.fn(), initialText = SAVED) {
  render(
    <RulesEditor
      tenantName="Rede Demo"
      initialText={initialText}
      initialVersion={3}
      action={action}
    />,
  );
  const field = screen.getByLabelText('Regras') as HTMLTextAreaElement;
  const save = () => screen.getByRole('button', { name: /Salvar regras|Salvando…/ });
  const preview = () => screen.getByRole('button', { name: 'Ver como os novos membros veem' });
  return { field, save, preview, action };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RulesEditor (E13)', () => {
  it('renders the intro, 12 rows, the cap, the counter, the helper and the version line', () => {
    const { field, save } = setup();
    expect(
      screen.getByText('Quem entrar em Rede Demo lê e aceita estas regras no cadastro.'),
    ).toBeTruthy();
    expect(field.getAttribute('rows')).toBe('12');
    expect(field.maxLength).toBe(10_000);
    expect(screen.getByText(`${SAVED.length}/10.000`)).toBeTruthy();
    expect(screen.getByText('Deixe uma linha em branco entre os parágrafos.')).toBeTruthy();
    expect(screen.getByText('Versão 3 em vigor')).toBeTruthy();
    expect((save() as HTMLButtonElement).disabled).toBe(true);
  });

  it('no rules yet: the placeholder shows and save and preview stay disabled until text exists', () => {
    const { field, save, preview } = setup(vi.fn(), '');
    expect(field.placeholder).toBe(
      'Ex.: Trate todos com respeito. Não publique propaganda sem autorização.',
    );
    for (const value of ['', '   \n\n  ']) {
      fireEvent.change(field, { target: { value } });
      expect((save() as HTMLButtonElement).disabled).toBe(true);
      expect((preview() as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.change(field, { target: { value: 'Primeira regra.' } });
    expect((save() as HTMLButtonElement).disabled).toBe(false);
    expect((preview() as HTMLButtonElement).disabled).toBe(false);
  });

  it('the saved text pasted with CRLF and padding keeps the save disabled (no empty bump)', () => {
    const { field, save, action } = setup();
    fireEvent.change(field, { target: { value: `\r\n  ${SAVED.replace(/\n/g, '\r\n')}  \r\n` } });
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    expect(action).not.toHaveBeenCalled();
  });

  it('pending reads "Salvando…"; success toasts, bumps the version line and refreshes', async () => {
    let resolve: (value: unknown) => void = () => {};
    const action = vi.fn(() => new Promise((r) => (resolve = r)));
    const { field, save } = setup(action);
    fireEvent.change(field, { target: { value: '  Regra nova.\r\n\r\nOutra.  ' } });
    fireEvent.click(save());
    expect(action).toHaveBeenCalledWith('Regra nova.\n\nOutra.');
    expect(
      ((await screen.findByRole('button', { name: 'Salvando…' })) as HTMLButtonElement).disabled,
    ).toBe(true);

    await act(async () =>
      resolve({ ok: true, rules: { rulesText: 'Regra nova.\n\nOutra.', rulesVersion: 4 } }),
    );
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Regras salvas. Valem para quem entrar a partir de agora.',
    });
    expect(screen.getByText('Versão 4 em vigor')).toBeTruthy();
    expect(router.refresh).toHaveBeenCalled();
    expect(
      (screen.getByRole('button', { name: 'Salvar regras' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('a server too_long shows "Use até 10.000 caracteres." under the field', async () => {
    const action = vi.fn(async () => ({ ok: false, code: 'tooLong' }));
    const { field, save } = setup(action);
    fireEvent.change(field, { target: { value: 'Texto que o servidor recusa.' } });
    await act(async () => fireEvent.click(save()));
    expect(screen.getByRole('alert').textContent).toBe('Use até 10.000 caracteres.');
    expect(field.value).toBe('Texto que o servidor recusa.');
  });

  it('a paste the field cuts at the cap shows the over-cap error', () => {
    const { field } = setup(vi.fn(), '');
    fireEvent.paste(field, {
      clipboardData: { getData: () => 'a'.repeat(10_001) },
    });
    fireEvent.change(field, { target: { value: 'a'.repeat(10_000) } });
    expect(screen.getByRole('alert').textContent).toBe('Use até 10.000 caracteres.');
    fireEvent.change(field, { target: { value: 'a'.repeat(9_000) } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failure (even a thrown action) toasts and keeps the draft', async () => {
    const action = vi.fn(async () => {
      throw new Error('network');
    });
    const { field, save } = setup(action);
    fireEvent.change(field, { target: { value: 'Rascunho que fica.' } });
    await act(async () => fireEvent.click(save()));
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível salvar as regras. Tente novamente.',
    });
    expect(field.value).toBe('Rascunho que fica.');
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('a lost permission toasts it and refreshes (UI-D-284)', async () => {
    const action = vi.fn(async () => ({ ok: false, code: 'forbidden' }));
    const { field, save } = setup(action);
    fireEvent.change(field, { target: { value: 'Sem permissão.' } });
    await act(async () => fireEvent.click(save()));
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Você não tem mais permissão para esta ação.',
    });
    expect(router.refresh).toHaveBeenCalled();
  });
});

describe('RulesEditor preview (E14)', () => {
  it('renders the current draft through RulesText with the sign-up sheet title and Fechar', async () => {
    const { field, preview } = setup();
    fireEvent.change(field, { target: { value: 'Lista:\n1. Um.\n2. Dois.\n\nFim do rascunho.' } });
    await act(async () => fireEvent.click(preview()));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Regras da comunidade Rede Demo');
    const paragraphs = Array.from(dialog.querySelectorAll('[data-rules-preview] p'));
    expect(paragraphs.map((p) => p.textContent)).toEqual([
      'Lista:\n1. Um.\n2. Dois.',
      'Fim do rascunho.',
    ]);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Fechar' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
