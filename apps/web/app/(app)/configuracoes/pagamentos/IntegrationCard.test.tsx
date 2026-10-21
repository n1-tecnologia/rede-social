// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-13 — the Integração card (UI-D-514, T-09.1-60), against the REAL merged pt-BR catalog through
 * next-intl's own `createTranslator`. Stubbed: the server action, the router and the toast. Real: the
 * card, the shipped `Input`, `Button`, `IconButton`, `StatusPill`, `Card` and `SectionTitle`.
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

const { toast, refresh, save } = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  refresh: vi.fn(),
  save: vi.fn(),
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

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

vi.mock('./actions', () => ({ saveIntegrationAction: save }));

const { IntegrationCard } = await import('./IntegrationCard');

const URL_SHORT = 'https://api.example.test/v1/webhooks/kiwify/abc123';
const URL_LONG = `https://api.example.test/v1/webhooks/kiwify/${'a'.repeat(150)}`;
const SECRET = 'tok_live_9f8e7d6c5b4a';

function view(patch: Record<string, unknown> = {}) {
  return {
    provider: 'kiwify',
    gatewayName: 'Kiwify',
    connected: false,
    webhookUrl: URL_SHORT,
    lastEvent: 'Nenhum evento recebido ainda.',
    showEventsLink: false,
    eventsHref: '/configuracoes/pagamentos?aba=eventos',
    ...patch,
  };
}

function renderCard(patch: Record<string, unknown> = {}) {
  return render(<IntegrationCard view={view(patch)} />);
}

const tokenField = () => document.getElementById('payments-webhook-token') as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: /Salvar integração|Salvando/ });

function type(value: string) {
  fireEvent.change(tokenField(), { target: { value } });
}

beforeEach(() => {
  toast.show.mockReset();
  refresh.mockReset();
  save.mockReset();
});
afterEach(cleanup);

describe('IntegrationCard: not connected (E02 empty)', () => {
  it('shows the neutral pill, an empty password field and the save button disabled', () => {
    renderCard();
    expect(screen.getByText('Não conectado')).toBeTruthy();
    expect(screen.queryByText('Conectado')).toBeNull();
    expect(screen.getByText('Kiwify')).toBeTruthy();

    const field = tokenField();
    expect(field.type).toBe('password');
    expect(field.value).toBe('');
    expect(field.getAttribute('placeholder')).toBe('Cole o token do Kiwify');
    expect(
      screen.getByText('O token fica guardado com segurança e não pode ser lido depois.'),
    ).toBeTruthy();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables the save button as soon as the field holds something', () => {
    renderCard();
    type(SECRET);
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
    type('');
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('IntegrationCard: the token is write-only on screen (E02 interaction, T-09.1-60)', () => {
  it('is a password field that no password manager or spellchecker touches, with no name or reveal', () => {
    renderCard();
    const field = tokenField();
    expect(field.type).toBe('password');
    expect(field.getAttribute('autocomplete')).toBe('off');
    expect(field.getAttribute('spellcheck')).toBe('false');
    expect(field.hasAttribute('data-1p-ignore')).toBe(true);
    expect(field.hasAttribute('name')).toBe(false);
    // No show/hide control: the only buttons are the copy button and the save button.
    const names = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toEqual(['Copiar URL do webhook', 'Salvar integração']);
  });

  it('never pre-fills the field, connected or not, and holds no token anywhere in the DOM', () => {
    renderCard({ connected: true });
    expect(tokenField().value).toBe('');
    expect(tokenField().getAttribute('placeholder')).toBe(
      'Token salvo. Cole outro para substituir.',
    );
    expect(screen.getByText('Conectado')).toBeTruthy();
    for (const input of Array.from(document.querySelectorAll('input'))) {
      if (input.id !== 'payments-webhook-url') expect(input.value).toBe('');
    }
  });
});

describe('IntegrationCard: saving (E02 loading, error)', () => {
  it('shows "Salvando…" with aria-busy while the write runs, then clears the field and flips the pill', async () => {
    let finish: (value: { ok: true }) => void = () => {};
    save.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderCard();
    type(SECRET);
    fireEvent.click(saveButton());

    await waitFor(() => expect(saveButton().getAttribute('aria-busy')).toBe('true'));
    expect(saveButton().textContent).toContain('Salvando…');
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(SECRET);

    await act(async () => {
      finish({ ok: true });
    });
    await waitFor(() => expect(screen.getByText('Conectado')).toBeTruthy());
    expect(screen.queryByText('Não conectado')).toBeNull();
    expect(tokenField().value).toBe('');
    expect(tokenField().getAttribute('placeholder')).toBe(
      'Token salvo. Cole outro para substituir.',
    );
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Integração salva.' });
    // The secret left the DOM with the field: no attribute, text or value holds it.
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows "Cole o token do webhook." on submit of an empty token and calls nothing', async () => {
    renderCard();
    type('   ');
    fireEvent.submit(tokenField().closest('form') as HTMLFormElement);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Cole o token do webhook.');
    expect(tokenField().getAttribute('aria-invalid')).toBe('true');
    expect(save).not.toHaveBeenCalled();

    // The next edit clears the error.
    type('x');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the same field error when the empty field is left (F-3), without enabling the button', () => {
    renderCard();
    fireEvent.focus(tokenField());
    fireEvent.blur(tokenField());
    expect(screen.getByRole('alert').textContent).toBe('Cole o token do webhook.');
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('maps the server refusing an empty token to the same field error', async () => {
    save.mockResolvedValue({ ok: false, code: 'token_required' });
    renderCard();
    type(SECRET);
    fireEvent.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toBe('Cole o token do webhook.');
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('toasts the failure and keeps the typed token when the write fails', async () => {
    save.mockResolvedValue({ ok: false, code: 'generic' });
    renderCard();
    type(SECRET);
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Não foi possível salvar a integração. Tente novamente.',
      }),
    );
    expect(tokenField().value).toBe(SECRET);
    expect(screen.getByText('Não conectado')).toBeTruthy();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
    expect(saveButton().getAttribute('aria-busy')).toBeNull();
  });

  it('toasts the shipped forbidden line and refreshes into notFound() when the permission was lost', async () => {
    save.mockResolvedValue({ ok: false, code: 'forbidden' });
    renderCard();
    type(SECRET);
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Você não tem mais permissão para esta ação.',
      }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('IntegrationCard: the webhook URL (E02 long-text backstop)', () => {
  it('is a read-only field, selectable, with the copy button outside the scrolling element', () => {
    renderCard({ webhookUrl: URL_LONG });
    const url = document.getElementById('payments-webhook-url') as HTMLInputElement;
    expect(url.readOnly).toBe(true);
    expect(url.value).toBe(URL_LONG);
    expect(url.className).toContain('select-all');
    expect(screen.getByText('URL do webhook').getAttribute('for')).toBe('payments-webhook-url');
    const copy = screen.getByRole('button', { name: 'Copiar URL do webhook' });
    expect(url.contains(copy)).toBe(false);
    expect(copy.className).toContain('min-w-[44px]');
    expect(
      screen.getByText(
        'No Kiwify, crie um webhook com esta URL e marque compra aprovada, reembolso, chargeback e os eventos de assinatura.',
      ),
    ).toBeTruthy();
  });

  it('copies the URL and toasts "URL copiada."', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar URL do webhook' }));
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'URL copiada.' }),
    );
    expect(writeText).toHaveBeenCalledWith(URL_SHORT);
  });
});

describe('IntegrationCard: the last event (E02 partial)', () => {
  it('shows "Nenhum evento recebido ainda." and no "Ver eventos" link without an event', () => {
    renderCard({ connected: true });
    expect(screen.getByText('Nenhum evento recebido ainda.')).toBeTruthy();
    expect(screen.queryByText('Ver eventos')).toBeNull();
  });

  it('shows the finished line and the link to the Eventos tab with an event', () => {
    renderCard({
      connected: true,
      lastEvent: 'Último evento recebido há 3 min.',
      showEventsLink: true,
    });
    expect(screen.getByText('Último evento recebido há 3 min.')).toBeTruthy();
    const link = screen.getByText('Ver eventos').closest('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/configuracoes/pagamentos?aba=eventos');
  });
});
