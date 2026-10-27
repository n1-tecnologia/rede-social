// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.4-16 Task 2 (UI-D-555, UI-D-561, UI-D-562, CTK-37, T-09.4-56, T-09.4-58; E07) - "Substituir token", the
 * write-only sheet, and the busy state the card shows after a save. Real: the sheet, the shared
 * `ProjectTokenFields`, the how-to, the card around it and the REAL pt-BR catalog through next-intl's
 * translator (a missing key throws). The action, the toast and the router are spies.
 *
 * Claims: the fields open EMPTY every time; "Salvar token" waits for a token (a date alone does not
 * count); "Salvando…" locks the fields and the sheet; each of the seven refusals renders where it can be
 * fixed and keeps what was typed; a success closes, clears, toasts and refreshes now and once more after
 * 3 s while the pill row reads "Verificando…"; no value survives a close by ANY route or reaches a
 * toast, a log, a URL or the DOM text.
 */

// The sheet animates in and out; a cancelled spring rejects AFTER the run ends under happy-dom.
MotionGlobalConfig.skipAnimations = true;

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join: joinPath } = await import('node:path');
  return { messages: loadMessages(joinPath(process.cwd(), 'messages', 'pt-BR')) };
});

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({
        locale: 'pt-BR',
        messages: harness.messages,
        namespace,
        onError: (error) => {
          throw error;
        },
      }),
  };
});

const toast = { show: vi.fn(), dismiss: vi.fn() };
vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

const { ReplaceTokenSheet } = await import('./ReplaceTokenSheet');
const { TokenCard } = await import('./TokenCard');

const TENANT = '33333333-3333-4333-8333-333333333312';
const TODAY = '2026-10-27';
const TOKEN = `sbp_${'x'.repeat(60)}`;

type Result =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'token_invalid'
        | 'token_forbidden'
        | 'token_account_wide'
        | 'token_other_project'
        | 'token_expiry_invalid'
        | 'org_mismatch'
        | 'unavailable';
    };
const action =
  vi.fn<
    (tenantId: string, values: { token: string; tokenExpiresAt?: string }) => Promise<Result>
  >();

const TOKEN_LABEL = 'Token de acesso do projeto';
const DATE_LABEL = 'Vence em (opcional)';

function mount(onSaved?: () => void) {
  return render(
    <ReplaceTokenSheet tenantId={TENANT} today={TODAY} action={action} onSaved={onSaved} />,
  );
}

const openSheet = () => fireEvent.click(screen.getByRole('button', { name: 'Substituir token' }));
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const typeInto = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } });
const save = () => screen.getByRole('button', { name: /Salvar token|Salvando…/ });

const consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((method) =>
  vi.spyOn(console, method as 'log').mockImplementation(() => {}),
);

beforeEach(() => {
  action.mockReset();
  action.mockResolvedValue({ ok: true });
  toast.show.mockReset();
  router.refresh.mockReset();
  for (const spy of consoleSpies) spy.mockClear();
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ReplaceTokenSheet', () => {
  it('offers "Substituir token" as the outline sm button', () => {
    mount();
    const button = screen.getByRole('button', { name: 'Substituir token' });
    expect(button.className).toContain('border-border-secondary');
    expect(button.className).toContain('h-9');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a sheet with the title, the intro, an EMPTY token, an empty date and the closed how-to', () => {
    mount();
    openSheet();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Substituir token' })).toBeTruthy();
    expect(
      screen.getByText(
        'Use quando o token venceu, foi revogado ou está perto de vencer. O token antigo deixa de ser usado.',
      ),
    ).toBeTruthy();
    const token = field(TOKEN_LABEL);
    expect(token.type).toBe('password');
    expect(token.value).toBe('');
    expect(token.hasAttribute('name')).toBe(false);
    expect(token.hasAttribute('data-1p-ignore')).toBe(true);
    expect(field(DATE_LABEL).value).toBe('');
    const details = document.querySelector('details[data-token-howto]') as HTMLDetailsElement;
    expect(details.hasAttribute('open')).toBe(false);
    expect(screen.getByRole('button', { name: 'Salvar token' })).toBeTruthy();
  });

  it('bounds the date field with the server date: from tomorrow to one year', () => {
    mount();
    openSheet();
    expect(field(DATE_LABEL).min).toBe('2026-10-28');
    expect(field(DATE_LABEL).max).toBe('2027-10-27');
  });

  it('keeps "Salvar token" disabled until the token is filled; a date alone does not count (E07 empty)', () => {
    mount();
    openSheet();
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    typeInto(DATE_LABEL, '2027-03-05');
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    typeInto(TOKEN_LABEL, '   ');
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(save().closest('form') as HTMLFormElement);
    expect(action).not.toHaveBeenCalled();
    typeInto(TOKEN_LABEL, 'x');
    expect((save() as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the trimmed token alone, once: a token alone is a complete submission (E07 partial)', async () => {
    mount();
    openSheet();
    typeInto(TOKEN_LABEL, `  ${TOKEN}\n`);
    fireEvent.click(save());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledWith(TENANT, { token: TOKEN });
  });

  it('sends the typed date with the token', async () => {
    mount();
    openSheet();
    typeInto(TOKEN_LABEL, TOKEN);
    typeInto(DATE_LABEL, '2027-03-05');
    fireEvent.click(save());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledWith(TENANT, { token: TOKEN, tokenExpiresAt: '2027-03-05' });
  });

  it('has no confirmation dialog: the server validates before replacing anything (UI-D-555)', async () => {
    mount();
    openSheet();
    typeInto(TOKEN_LABEL, TOKEN);
    fireEvent.click(save());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });

  it('shows "Salvando…" with aria-busy and locked fields, and cannot be closed while saving (E07 loading)', async () => {
    let release: (value: Result) => void = () => {};
    action.mockReturnValue(new Promise((resolve) => (release = resolve)));
    mount();
    openSheet();
    typeInto(TOKEN_LABEL, TOKEN);
    fireEvent.click(save());
    const busy = await screen.findByRole('button', { name: 'Salvando…' });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(field(TOKEN_LABEL).disabled).toBe(true);
    expect(field(DATE_LABEL).disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    release({ ok: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it.each([
    [
      'token_invalid',
      'O Supabase não aceitou este token. Ele pode estar errado, vencido ou apagado. Crie outro e cole de novo.',
    ],
    [
      'token_forbidden',
      'Este token não tem as permissões necessárias para este projeto. Confira se ele é deste projeto e se tem as permissões do passo a passo.',
    ],
    ['token_other_project', 'Este token é de outro projeto. Crie um token só para este projeto.'],
    [
      'token_account_wide',
      'Este token vale para a conta inteira. Crie um token limitado a este projeto.',
    ],
  ] as const)(
    'renders %s under the token field and changes nothing else (E07 error)',
    async (error, sentence) => {
      action.mockResolvedValue({ ok: false, error });
      mount();
      openSheet();
      typeInto(TOKEN_LABEL, TOKEN);
      fireEvent.click(save());
      const alert = await screen.findByText(sentence);
      expect(alert.closest('[role="alert"]') ?? alert).toBeTruthy();
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(field(TOKEN_LABEL).value).toBe(TOKEN);
      expect(field(TOKEN_LABEL).getAttribute('aria-invalid')).toBe('true');
      expect(field(DATE_LABEL).getAttribute('aria-invalid')).not.toBe('true');
      expect(
        screen.queryByText(
          'Não foi possível salvar o token agora. Nada foi alterado. Tente de novo.',
        ),
      ).toBeNull();
      expect(toast.show).not.toHaveBeenCalled();
      expect(router.refresh).not.toHaveBeenCalled();
      expect((save() as HTMLButtonElement).disabled).toBe(false);
      typeInto(TOKEN_LABEL, `${TOKEN}!`);
      expect(screen.queryByText(sentence)).toBeNull();
    },
  );

  it('renders token_expiry_invalid under the date, not under the token', async () => {
    action.mockResolvedValue({ ok: false, error: 'token_expiry_invalid' });
    mount();
    openSheet();
    typeInto(TOKEN_LABEL, TOKEN);
    typeInto(DATE_LABEL, '2027-03-05');
    fireEvent.click(save());
    await screen.findByText('Informe uma data futura, em até 1 ano.');
    expect(field(DATE_LABEL).getAttribute('aria-invalid')).toBe('true');
    expect(field(TOKEN_LABEL).getAttribute('aria-invalid')).not.toBe('true');
    expect(field(TOKEN_LABEL).value).toBe(TOKEN);
    expect(field(DATE_LABEL).value).toBe('2027-03-05');
  });

  it('renders org_mismatch as a sheet-level alert with the danger block and keeps the sheet open', async () => {
    action.mockResolvedValue({ ok: false, error: 'org_mismatch' });
    mount();
    openSheet();
    typeInto(TOKEN_LABEL, TOKEN);
    fireEvent.click(save());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'O projeto está em outra organização do Supabase, diferente da registrada. Nada foi alterado.',
    );
    for (const cls of [
      'rounded-xl',
      'border-danger/40',
      'bg-danger/5',
      'p-4',
      'text-sm',
      'text-danger',
    ]) {
      expect(alert.className).toContain(cls);
    }
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(field(TOKEN_LABEL).value).toBe(TOKEN);
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('renders `unavailable` as the transport alert, and a thrown action the same way', async () => {
    action.mockResolvedValueOnce({ ok: false, error: 'unavailable' });
    mount();
    openSheet();
    typeInto(TOKEN_LABEL, TOKEN);
    fireEvent.click(save());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Não foi possível salvar o token agora. Nada foi alterado. Tente de novo.',
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    action.mockRejectedValueOnce(new Error(`boom ${TOKEN}`));
    fireEvent.click(save());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Não foi possível salvar o token agora. Nada foi alterado. Tente de novo.',
    );
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it('closes, clears, toasts "Token atualizado." and refreshes on success, then reopens EMPTY', async () => {
    const onSaved = vi.fn();
    mount(onSaved);
    openSheet();
    typeInto(TOKEN_LABEL, TOKEN);
    typeInto(DATE_LABEL, '2027-03-05');
    fireEvent.click(save());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Token atualizado.' });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
    openSheet();
    expect(field(TOKEN_LABEL).value).toBe('');
    expect(field(DATE_LABEL).value).toBe('');
  });

  it.each([
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    [
      'the backdrop',
      () =>
        fireEvent.click(document.querySelector('div.absolute.inset-0.bg-black\\/60') as Element),
    ],
  ])('clears the token and the date from state when closed by %s', async (_route, close) => {
    mount();
    openSheet();
    typeInto(TOKEN_LABEL, TOKEN);
    typeInto(DATE_LABEL, '2027-03-05');
    close();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(action).not.toHaveBeenCalled();
    openSheet();
    expect(field(TOKEN_LABEL).value).toBe('');
    expect(field(DATE_LABEL).value).toBe('');
  });

  it('clears a refused attempt too when the sheet is closed afterwards', async () => {
    action.mockResolvedValue({ ok: false, error: 'token_invalid' });
    mount();
    openSheet();
    typeInto(TOKEN_LABEL, TOKEN);
    fireEvent.click(save());
    await screen.findByText(/não aceitou este token/);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    openSheet();
    expect(field(TOKEN_LABEL).value).toBe('');
    expect(screen.queryByText(/não aceitou este token/)).toBeNull();
  });

  it('lets a long token scroll inside its input instead of wrapping it (E07 long-text)', () => {
    mount();
    openSheet();
    typeInto(TOKEN_LABEL, `sbp_${'y'.repeat(3000)}`);
    const input = field(TOKEN_LABEL);
    expect(input.value).toHaveLength(3004);
    expect(input.tagName).toBe('INPUT');
    expect(input.className).not.toMatch(/break-|whitespace-normal|wrap/);
  });

  it('never renders a typed value back as text, and writes it to no storage, cookie, URL, toast or log', async () => {
    const { container } = mount();
    openSheet();
    typeInto(TOKEN_LABEL, TOKEN);
    expect(container.textContent).not.toContain(TOKEN);
    expect(document.body.textContent).not.toContain(TOKEN);
    action.mockResolvedValueOnce({ ok: false, error: 'token_invalid' });
    fireEvent.click(save());
    await screen.findByText(/não aceitou este token/);
    action.mockResolvedValueOnce({ ok: true });
    fireEvent.click(save());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const dump = JSON.stringify({
      session: { ...sessionStorage },
      local: { ...localStorage },
      cookie: document.cookie,
      url: window.location.href,
      toasts: toast.show.mock.calls,
      logs: consoleSpies.map((spy) => spy.mock.calls),
      text: document.body.textContent,
    });
    expect(dump).not.toContain(TOKEN);
    expect(dump).not.toContain('sbp_');
    expect(sessionStorage.length).toBe(0);
  });

  it('keeps the storage, cookie and HTML-injection APIs out of the sheet and the actions island (T-09.4-56)', () => {
    for (const file of ['ReplaceTokenSheet.tsx', 'TokenCardActions.tsx']) {
      // The doc comments name these APIs to say they are NOT used; only the code is scanned.
      const code = readFileSync(join(__dirname, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(
        /sessionStorage|localStorage|document\.cookie|dangerouslySetInnerHTML|ConfirmDialog/,
      );
    }
  });
});

describe('TokenCardActions - the busy state after a save (UI-D-562)', () => {
  function card() {
    return render(
      <TokenCard
        tenantId={TENANT}
        token={{ state: 'expired', expiresAt: '2026-10-20', checkedAt: '2026-10-27T10:00:00.000Z' }}
        today={TODAY}
        verifiedWhen="há 3 min"
        replaceAction={action}
      />,
    );
  }
  const statusRow = () => document.querySelector('[data-token-status]') as HTMLElement;

  it('offers "Substituir token" inside the card, after the notice and before the how-to', () => {
    const { container } = card();
    const button = screen.getByRole('button', { name: 'Substituir token' });
    const notice = container.querySelector('[data-notice]') as HTMLElement;
    const howto = container.querySelector('details[data-token-howto]') as HTMLElement;
    expect(notice.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition(howto) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is not busy before any save', () => {
    card();
    expect(statusRow().getAttribute('aria-busy')).not.toBe('true');
    expect(screen.getByText('Verificado há 3 min.')).toBeTruthy();
  });

  it('refreshes now and once more after 3000 ms, reading "Verificando…" in between', async () => {
    vi.useFakeTimers();
    card();
    openSheet();
    typeInto(TOKEN_LABEL, TOKEN);
    await act(async () => {
      fireEvent.click(save());
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(statusRow().getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('Verificando…')).toBeTruthy();
    expect(screen.queryByText('Verificado há 3 min.')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(statusRow().getAttribute('aria-busy')).toBe('true');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(router.refresh).toHaveBeenCalledTimes(2);
    expect(statusRow().getAttribute('aria-busy')).not.toBe('true');
    expect(screen.getByText('Verificado há 3 min.')).toBeTruthy();
    expect(screen.queryByText('Verificando…')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  it('keeps the last state on screen when the second refresh fails, and stops being busy', async () => {
    vi.useFakeTimers();
    card();
    openSheet();
    typeInto(TOKEN_LABEL, TOKEN);
    await act(async () => {
      fireEvent.click(save());
      await vi.advanceTimersByTimeAsync(0);
    });
    router.refresh.mockImplementationOnce(() => {
      throw new Error('offline');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTestId('token-pill').textContent).toBe('Vencido');
    expect(statusRow().getAttribute('aria-busy')).not.toBe('true');
    expect(screen.getByText('Verificado há 3 min.')).toBeTruthy();
  });

  it('cancels the second refresh when the card unmounts', async () => {
    vi.useFakeTimers();
    const { unmount } = card();
    openSheet();
    typeInto(TOKEN_LABEL, TOKEN);
    await act(async () => {
      fireEvent.click(save());
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not start the busy state or the timer when the save is refused', async () => {
    vi.useFakeTimers();
    action.mockResolvedValue({ ok: false, error: 'token_invalid' });
    card();
    openSheet();
    typeInto(TOKEN_LABEL, TOKEN);
    await act(async () => {
      fireEvent.click(save());
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(statusRow().getAttribute('aria-busy')).not.toBe('true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
