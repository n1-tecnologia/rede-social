// @vitest-environment happy-dom
import { ToastProvider } from '@rede-social/ui';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.2-20 Task 2 (UI-D-541, D-535, T-09.2-93) - the Status tab's guard. While the move to a project of
 * its own is running, "Reativar tenant" is disabled with `aria-disabled` and a 12/400 tertiary note
 * says why; "Suspender tenant" and every other behaviour are untouched; `status.body` gains no new
 * sentence. The `moving: true` fixture stands in for the API fact, which plan 14 still answers false
 * until plan 23 gives the registry a real move state.
 */

const harness = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

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

const { StatusCard } = await import('./StatusCard');

MotionGlobalConfig.skipAnimations = true;

afterEach(cleanup);

const NOTE =
  'Este tenant está sendo movido para um projeto próprio. Ele é reativado ao fim da mudança.';

function renderCard(
  props: { status: 'active' | 'suspended'; moving: boolean },
  action = vi.fn(async () => ({ ok: true as const })),
) {
  render(
    <ToastProvider>
      <StatusCard tenantId="t1" tenantName="Ana Souza Mentoria" action={action} {...props} />
    </ToastProvider>,
  );
  return action;
}

describe('StatusCard - the move guard', () => {
  it('disables "Reativar tenant" with aria-disabled while the tenant is being moved', () => {
    renderCard({ status: 'suspended', moving: true });
    const button = screen.getByRole('button', { name: 'Reativar tenant' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows the note under the button, 12/400 tertiary with mt-2, and points the button at it', () => {
    renderCard({ status: 'suspended', moving: true });
    const note = screen.getByText(NOTE);
    expect(note.className).toContain('mt-2');
    expect(note.className).toContain('text-xs');
    expect(note.className).toContain('font-normal');
    expect(note.className).toContain('text-text-tertiary');
    const button = screen.getByRole('button', { name: 'Reativar tenant' });
    expect(button.getAttribute('aria-describedby')).toBe(note.id);
  });

  it('leaves "Reativar tenant" enabled and the note out when no move runs', () => {
    renderCard({ status: 'suspended', moving: false });
    const button = screen.getByRole('button', { name: 'Reativar tenant' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it('does not call the action when the disabled button is clicked', () => {
    const action = renderCard({ status: 'suspended', moving: true });
    fireEvent.click(screen.getByRole('button', { name: 'Reativar tenant' }));
    expect(action).not.toHaveBeenCalled();
  });

  it('still reactivates when no move runs', async () => {
    const action = renderCard({ status: 'suspended', moving: false });
    fireEvent.click(screen.getByRole('button', { name: 'Reativar tenant' }));
    await waitFor(() => expect(action).toHaveBeenCalledWith('t1', 'active'));
  });

  it('leaves "Suspender tenant" unchanged, with or without a move', () => {
    renderCard({ status: 'active', moving: true });
    const suspend = screen.getByRole('button', { name: 'Suspender tenant' }) as HTMLButtonElement;
    expect(suspend.disabled).toBe(false);
    expect(suspend.getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reativar tenant' })).toBeNull();
  });

  it('opens the confirmation for Suspender and sends the suspend through the action', async () => {
    const action = renderCard({ status: 'active', moving: false });
    fireEvent.click(screen.getByRole('button', { name: 'Suspender tenant' }));
    expect(screen.getByText('Suspender Ana Souza Mentoria?')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Suspender' }));
    await waitFor(() => expect(action).toHaveBeenCalledWith('t1', 'suspended'));
  });

  it('adds no sentence to the status body: it stays the shipped copy', () => {
    renderCard({ status: 'suspended', moving: true });
    expect(
      screen.getByText(
        'Membros não conseguem entrar enquanto o tenant estiver suspenso; o site continua resolvendo o domínio e mostra a mensagem de indisponibilidade.',
      ),
    ).not.toBeNull();
  });
});
