// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.2-19 Task 3 (UI-D-538, D-539, DBT-40, UI-D-545, UI-D-548, E06, PR-4a) - the Credenciais card and the
 * replace sheet. Real: both components, the shared `ProjectAccessFields` and the REAL pt-BR catalog
 * through next-intl's translator (a missing key throws). The action and the toast are spies.
 *
 * Claims: held / not held with the missing note and the button always available; the sheet's title,
 * intro and three empty password fields; the footer disabled for empty and whitespace-only input and
 * enabled for any one field; "Salvando…" with locked fields; a refusal keeps the sheet open with the
 * alert and the typed values; a success closes, toasts, refreshes and clears; closing clears; no value
 * rendered back, stored, put in a cookie or logged.
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

const { CredentialsCard } = await import('./CredentialsCard');

const TENANT = '33333333-3333-4333-8333-333333333312';
const SECRET = 'S3nha-MUITO-secreta-9f8e7d6c5b4a';
const KEY = `sb_secret_${'x'.repeat(200)}`;

const action =
  vi.fn<
    (
      tenantId: string,
      values: Record<string, string>,
    ) => Promise<{ ok: true } | { ok: false; error: 'access' | 'generic' }>
  >();

function mount(props: { held?: boolean; updatedWhen?: string | null } = {}) {
  return render(
    <CredentialsCard
      tenantId={TENANT}
      held={props.held ?? true}
      updatedWhen={props.updatedWhen === undefined ? 'há 2 d' : props.updatedWhen}
      replaceAction={action as never}
    />,
  );
}

const openSheet = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Substituir credenciais' }));
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const PASSWORD = 'Senha do banco (usuário postgres)';
const SERVICE = 'Chave de serviço (service_role)';
const PUBLISHABLE = 'Chave publicável';
const typeInto = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } });
const save = () => screen.getByRole('button', { name: /Salvar credenciais|Salvando…/ });

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
afterEach(cleanup);

describe('CredentialsCard', () => {
  it('says the access is held: Lock, the sentence, the success pill and when it was replaced', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Credenciais' })).toBeTruthy();
    expect(
      screen.getByText('Guardadas com segurança. O sistema não mostra nem devolve estes valores.'),
    ).toBeTruthy();
    expect(screen.getByText('Guardadas').className).toContain('success');
    expect(screen.getByText('Atualizadas há 2 d.')).toBeTruthy();
    const lock = document.querySelector('svg.lucide-lock') as SVGElement;
    expect(lock.getAttribute('aria-hidden')).toBe('true');
    expect(lock.getAttribute('width')).toBe('18');
    expect(screen.queryByText(/ainda não foram guardados/)).toBeNull();
  });

  it('says nothing is held: the warning pill and the missing note, and the button stays available (E06 empty)', () => {
    mount({ held: false, updatedWhen: null });
    expect(screen.getByText('Não informadas').className).toContain('warning');
    expect(
      screen.getByText(
        'Os dados de acesso ao projeto ainda não foram guardados. Termine a preparação ou use Substituir credenciais.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/^Guardadas com segurança/)).toBeNull();
    expect(screen.queryByText(/^Atualizadas/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Substituir credenciais' })).toBeTruthy();
  });

  it('offers "Substituir credenciais" as the outline sm button in both states', () => {
    for (const held of [true, false]) {
      mount({ held });
      const button = screen.getByRole('button', { name: 'Substituir credenciais' });
      expect(button.className).toContain('border-border-secondary');
      expect(button.className).toContain('h-9');
      cleanup();
    }
  });

  it('opens a sheet with the title, the intro and three EMPTY password fields, and no wizard info row', () => {
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
    openSheet();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Substituir credenciais' })).toBeTruthy();
    expect(
      screen.getByText(
        'Use quando a senha ou as chaves do projeto mudarem no Supabase. Cole só o que mudou.',
      ),
    ).toBeTruthy();
    for (const label of [PASSWORD, SERVICE, PUBLISHABLE]) {
      const input = field(label);
      expect(input.type).toBe('password');
      expect(input.value).toBe('');
      expect(input.hasAttribute('name')).toBe(false);
      expect(input.hasAttribute('data-1p-ignore')).toBe(true);
    }
    expect(screen.queryByText(/Não conseguimos obter o acesso/)).toBeNull();
  });

  it('keeps "Salvar credenciais" disabled for empty and whitespace-only input (E06 partial)', () => {
    mount();
    openSheet();
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    typeInto(PASSWORD, '   ');
    typeInto(SERVICE, '\t');
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(save().closest('form') as HTMLFormElement);
    expect(action).not.toHaveBeenCalled();
  });

  it.each([PASSWORD, SERVICE, PUBLISHABLE])(
    'enables the footer for a single filled field (%s)',
    (label) => {
      mount();
      openSheet();
      typeInto(label, 'x');
      expect((save() as HTMLButtonElement).disabled).toBe(false);
    },
  );

  it('sends only the non-empty, trimmed values to the action, once', async () => {
    mount();
    openSheet();
    typeInto(SERVICE, `  ${KEY}\n`);
    fireEvent.click(save());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledWith(TENANT, { serviceKey: KEY });
  });

  it('shows "Salvando…" with aria-busy and locked fields until the answer (E06 loading)', async () => {
    let release: (value: { ok: true }) => void = () => {};
    action.mockReturnValue(new Promise((resolve) => (release = resolve)));
    mount();
    openSheet();
    typeInto(PASSWORD, SECRET);
    fireEvent.click(save());
    const busy = await screen.findByRole('button', { name: 'Salvando…' });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    for (const label of [PASSWORD, SERVICE, PUBLISHABLE]) expect(field(label).disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    release({ ok: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the sheet open on a refusal, with the alert and the typed values, and replaces nothing (E06 error)', async () => {
    action.mockResolvedValue({ ok: false, error: 'access' });
    mount();
    openSheet();
    typeInto(PASSWORD, SECRET);
    fireEvent.click(save());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Não foi possível entrar no projeto com estes dados. Nada foi alterado.',
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(field(PASSWORD).value).toBe(SECRET);
    expect(toast.show).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    expect((save() as HTMLButtonElement).disabled).toBe(false);
    typeInto(PASSWORD, `${SECRET}!`);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('closes, toasts "Credenciais atualizadas." and refreshes on success, then reopens EMPTY', async () => {
    mount();
    openSheet();
    typeInto(PASSWORD, SECRET);
    typeInto(PUBLISHABLE, KEY);
    fireEvent.click(save());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Credenciais atualizadas.',
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    openSheet();
    for (const label of [PASSWORD, SERVICE, PUBLISHABLE]) expect(field(label).value).toBe('');
  });

  it('clears what was typed when the sheet is closed without saving', async () => {
    mount();
    openSheet();
    typeInto(SERVICE, KEY);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(action).not.toHaveBeenCalled();
    openSheet();
    expect(field(SERVICE).value).toBe('');
  });

  it('toasts the generic error and keeps the sheet open when the save fails for another reason', async () => {
    action.mockResolvedValue({ ok: false, error: 'generic' });
    mount();
    openSheet();
    typeInto(PASSWORD, SECRET);
    fireEvent.click(save());
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Algo deu errado. Tente novamente.',
      }),
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    action.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(save());
    await waitFor(() => expect(toast.show).toHaveBeenCalledTimes(2));
  });

  it('lets a long key scroll inside its input instead of wrapping it', () => {
    mount();
    openSheet();
    typeInto(SERVICE, KEY);
    const input = field(SERVICE);
    expect(input.value).toBe(KEY);
    expect(input.tagName).toBe('INPUT');
    expect(input.className).not.toMatch(/break-|whitespace-normal|wrap/);
  });

  it('never renders a typed value back as text, before or after a save', async () => {
    const { container } = mount();
    openSheet();
    typeInto(PASSWORD, SECRET);
    typeInto(SERVICE, KEY);
    expect(container.textContent).not.toContain(SECRET);
    expect(container.textContent).not.toContain(KEY);
    fireEvent.click(save());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(container.textContent).not.toContain(SECRET);
    expect(container.textContent).not.toContain(KEY);
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it('writes no value to sessionStorage, localStorage, a cookie, the URL or any console call (PR-4a)', async () => {
    mount();
    openSheet();
    typeInto(PASSWORD, SECRET);
    typeInto(SERVICE, KEY);
    action.mockResolvedValueOnce({ ok: false, error: 'access' });
    fireEvent.click(save());
    await screen.findByRole('alert');
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
    });
    expect(dump).not.toContain(SECRET);
    expect(dump).not.toContain('sb_secret_');
    expect(sessionStorage.length).toBe(0);
  });

  it('keeps the storage, cookie and HTML-injection APIs out of the card and the sheet (T-09.2-90, T-09.2-91)', () => {
    for (const file of ['CredentialsCard.tsx', 'ReplaceCredentialsSheet.tsx']) {
      // The doc comments name these APIs to say they are NOT used; only the code is scanned.
      const code = readFileSync(join(__dirname, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(
        /sessionStorage|localStorage|document\.cookie|dangerouslySetInnerHTML/,
      );
    }
  });
});
