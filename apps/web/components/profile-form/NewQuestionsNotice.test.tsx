// @vitest-environment happy-dom

import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

/**
 * 12-14 Task 2 (D-586, UI-D-589; PFORM-16 web half): the "Há perguntas novas" notice against the REAL
 * catalog. The server action and the toast are stubbed; the optimistic hide, the restore on failure, the
 * singular and plural copy and the exact "Responder" target are asserted.
 */

const mocks = vi.hoisted(() => ({ dismiss: vi.fn(), show: vi.fn() }));
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('@/app/(app)/perfil/profile-form-actions', () => ({
  dismissNoticeAction: () => mocks.dismiss(),
}));
vi.mock('@rede-social/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/ui')>()),
  useToast: () => ({ show: mocks.show, dismiss: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { NewQuestionsNotice } = await import('./NewQuestionsNotice');

function show(count = 2) {
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <NewQuestionsNotice tenantName="Ana Mentoria" count={count} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  mocks.dismiss.mockReset();
  mocks.show.mockReset();
});
afterEach(cleanup);

describe('NewQuestionsNotice: copy and shape', () => {
  it('shows the title, the plural line, "Responder" to the exact target and "Agora não"', () => {
    const { container } = show(2);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Há perguntas novas no seu perfil' }),
    ).toBeTruthy();
    expect(screen.getByText('Ana Mentoria acrescentou 2 perguntas opcionais.')).toBeTruthy();
    const answer = screen.getByRole('link', { name: 'Responder' });
    expect(answer.getAttribute('href')).toBe('/completar-perfil?next=%2Fperfil');
    expect(screen.getByRole('button', { name: 'Agora não' })).toBeTruthy();
    // a neutral disc, not brand ink
    const disc = container.querySelector('[aria-hidden="true"].rounded-full');
    expect(disc?.className).toContain('bg-bg-tertiary');
    expect(disc?.className).toContain('text-text-secondary');
    expect(disc?.className).not.toContain('text-brand');
  });

  it('uses the singular for one question', () => {
    show(1);
    expect(screen.getByText('Ana Mentoria acrescentou 1 pergunta opcional.')).toBeTruthy();
  });

  it('renders the tenant name as text, never markup', () => {
    const { container } = render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <NewQuestionsNotice tenantName="<b>Ana</b>" count={1} />
      </NextIntlClientProvider>,
    );
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>Ana</b> acrescentou 1 pergunta opcional.');
  });
});

describe('NewQuestionsNotice: "Agora não"', () => {
  it('hides the notice at once, before the server answers, and calls the action once', async () => {
    let release: (value: { ok: boolean }) => void = () => {};
    mocks.dismiss.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { container } = show();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    });
    // optimistic: gone while the write is still pending
    expect(container.querySelector('[data-new-questions-notice]')).toBeNull();
    expect(mocks.dismiss).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ ok: true });
    });
    expect(container.querySelector('[data-new-questions-notice]')).toBeNull();
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it('restores the notice and toasts when the write fails', async () => {
    mocks.dismiss.mockResolvedValue({ ok: false });
    const { container } = show();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    });
    expect(container.querySelector('[data-new-questions-notice]')).not.toBeNull();
    expect(mocks.show).toHaveBeenCalledTimes(1);
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível dispensar o aviso agora. Tente de novo.',
    });
  });

  it('restores the notice and toasts when the action throws', async () => {
    mocks.dismiss.mockRejectedValue(new Error('network'));
    const { container } = show();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    });
    expect(container.querySelector('[data-new-questions-notice]')).not.toBeNull();
    expect(mocks.show).toHaveBeenCalledTimes(1);
  });
});
