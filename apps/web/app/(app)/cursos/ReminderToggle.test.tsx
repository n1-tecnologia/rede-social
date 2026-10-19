// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 08.6-11 — the live reminder toggle (UI-D-453, UI-D-459, D-444, D-422, E07), against the REAL
 * merged pt-BR catalogs through next-intl's own `createTranslator`, so a copy drift fails here.
 * Stubbed: the server action, the router and the toast. The web workspace has no jest-dom: plain DOM
 * assertions only.
 */

const { toast, push, refresh, setReminder } = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  push: vi.fn(),
  refresh: vi.fn(),
  setReminder: vi.fn(),
}));

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

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

vi.mock('./learn-actions', () => ({ setLiveReminderAction: setReminder }));

const { ReminderToggle } = await import('./ReminderToggle');

const LIVE = '77777777-7777-4777-8777-777777777777';
const TITLE = 'Tira-dúvidas de outubro';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function button(): HTMLButtonElement {
  return screen.getByTestId('reminder-toggle') as HTMLButtonElement;
}

function helper(): string {
  return screen.getByTestId('reminder-helper').textContent ?? '';
}

beforeEach(() => {
  toast.show.mockReset();
  push.mockReset();
  refresh.mockReset();
  setReminder.mockReset();
});

afterEach(() => cleanup());

describe('ReminderToggle (UI-D-453, D-444, E07)', () => {
  it('off: Bell, "Ativar lembrete", the constant aria-label, aria-pressed=false and the helper', () => {
    render(<ReminderToggle liveId={LIVE} liveTitle={TITLE} initialOn={false} preview={false} />);
    const b = button();
    expect(b.getAttribute('type')).toBe('button');
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect(b.getAttribute('aria-label')).toBe(`Lembrete da live ${TITLE}`);
    expect(b.textContent).toBe('Ativar lembrete');
    expect(b.disabled).toBe(false);
    expect(b.className).toContain('border-border-secondary');
    expect(b.className).not.toContain('bg-brand/10');
    expect(helper()).toBe('Avisamos você 15 minutos antes do início.');
  });

  it('on from the server: BellRing in brand, "Lembrete ativado", the brand tint, aria-pressed=true', () => {
    render(<ReminderToggle liveId={LIVE} liveTitle={TITLE} initialOn preview={false} />);
    const b = button();
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.textContent).toBe('Lembrete ativado');
    expect(b.className).toContain('bg-brand/10');
    expect(b.className).toContain('border-brand/30');
    expect(b.querySelector('svg.text-brand')).not.toBeNull();
    // The accessible name never changes with the state (aria-pressed carries it).
    expect(b.getAttribute('aria-label')).toBe(`Lembrete da live ${TITLE}`);
  });

  it('off → on flips at once with aria-busy, ignores a second tap until the answer, then toasts', async () => {
    const answer = deferred<{ ok: true; on: boolean }>();
    setReminder.mockReturnValueOnce(answer.promise);
    render(<ReminderToggle liveId={LIVE} liveTitle={TITLE} initialOn={false} preview={false} />);

    fireEvent.click(button());
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(button().textContent).toBe('Lembrete ativado');
    expect(button().getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button());
    expect(setReminder).toHaveBeenCalledTimes(1);
    expect(setReminder).toHaveBeenCalledWith(LIVE, true);

    await act(async () => {
      answer.resolve({ ok: true, on: true });
      await answer.promise;
    });
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(button().getAttribute('aria-busy')).toBeNull();
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Lembrete ativado. Avisamos você 15 minutos antes do início.',
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('on → off sends the DELETE side and toasts "Lembrete desativado."', async () => {
    setReminder.mockResolvedValueOnce({ ok: true, on: false });
    render(<ReminderToggle liveId={LIVE} liveTitle={TITLE} initialOn preview={false} />);
    await act(async () => {
      fireEvent.click(button());
    });
    expect(setReminder).toHaveBeenCalledWith(LIVE, false);
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: 'Lembrete desativado.' });
  });

  it('403 live_locked reverts, toasts "Esta live agora é exclusiva." and refreshes', async () => {
    setReminder.mockResolvedValueOnce({ ok: false, code: 'live_locked' });
    render(<ReminderToggle liveId={LIVE} liveTitle={TITLE} initialOn={false} preview={false} />);
    await act(async () => {
      fireEvent.click(button());
    });
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Esta live agora é exclusiva.',
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('409 reminder_closed reverts, toasts and refreshes; 404 gone navigates to the lives list', async () => {
    setReminder.mockResolvedValueOnce({ ok: false, code: 'reminder_closed' });
    render(<ReminderToggle liveId={LIVE} liveTitle={TITLE} initialOn={false} preview={false} />);
    await act(async () => {
      fireEvent.click(button());
    });
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(toast.show).toHaveBeenLastCalledWith({
      tone: 'error',
      message: 'Esta live já começou ou foi cancelada.',
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    setReminder.mockResolvedValueOnce({ ok: false, code: 'gone' });
    await act(async () => {
      fireEvent.click(button());
    });
    expect(toast.show).toHaveBeenLastCalledWith({
      tone: 'error',
      message: 'Esta live não está mais disponível.',
    });
    expect(push).toHaveBeenCalledWith('/area-membros?aba=lives');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a generic failure reverts and toasts the on / off failure; a thrown action too', async () => {
    setReminder.mockResolvedValueOnce({ ok: false, code: 'generic' });
    render(<ReminderToggle liveId={LIVE} liveTitle={TITLE} initialOn preview={false} />);
    await act(async () => {
      fireEvent.click(button());
    });
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(toast.show).toHaveBeenLastCalledWith({
      tone: 'error',
      message: 'Não foi possível desativar o lembrete. Tente novamente.',
    });

    cleanup();
    setReminder.mockRejectedValueOnce(new Error('network'));
    render(<ReminderToggle liveId={LIVE} liveTitle={TITLE} initialOn={false} preview={false} />);
    await act(async () => {
      fireEvent.click(button());
    });
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(button().getAttribute('aria-busy')).toBeNull();
    expect(toast.show).toHaveBeenLastCalledWith({
      tone: 'error',
      message: 'Não foi possível ativar o lembrete. Tente novamente.',
    });
  });
});

describe('ReminderToggle in the admin preview (UI-D-459, D-422, EP-68)', () => {
  it('is disabled and off with the hint in place of the helper, and a tap never calls the action', async () => {
    // Even if the server said "on" (it never does for an admin), the preview draws it off.
    render(<ReminderToggle liveId={LIVE} liveTitle={TITLE} initialOn preview />);
    const b = button();
    expect(b.disabled).toBe(true);
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect(b.textContent).toBe('Ativar lembrete');
    expect(b.className).toContain('disabled:opacity-50');
    expect(helper()).toBe('Os lembretes não funcionam no modo aluno.');
    await act(async () => {
      fireEvent.click(b);
    });
    expect(setReminder).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
  });
});
