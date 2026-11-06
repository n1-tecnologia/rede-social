// @vitest-environment happy-dom

import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { EraseAnswersDialog, type EraseAnswersDialogProps } from './EraseAnswersDialog';

/**
 * 12.1-15 Task 1 (D-624, D-626, D-636; UI-D-656; PFORM-36; T-12.1-11, T-12.1-12): the warning before answers
 * are deleted, against the REAL pt-BR catalog. The dialog holds titles and counts only.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

function open(props: Partial<EraseAnswersDialogProps> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <EraseAnswersDialog
        open
        kind="advance"
        titles={['Nome da clínica']}
        onConfirm={onConfirm}
        onClose={onClose}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { ...view, onConfirm, onClose };
}

afterEach(cleanup);

describe('EraseAnswersDialog: the copy of UI-D-656', () => {
  it('opens as a danger dialog titled "Apagar respostas que deixaram de valer?" with the hint', () => {
    open();
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Apagar respostas que deixaram de valer?' }),
    ).toBeTruthy();
    expect(
      within(dialog).getByText('Se você voltar atrás, vai precisar responder de novo.'),
    ).toBeTruthy();
    const hint = within(dialog).getByText('Se você voltar atrás, vai precisar responder de novo.');
    expect(hint.className).toContain('text-xs');
    expect(hint.className).toContain('text-text-tertiary');
    // Danger tone: the confirm label and the icon wear the destructive colour.
    expect(screen.getByRole('button', { name: 'Apagar e continuar' }).className).toContain(
      'text-danger',
    );
    expect(dialog.querySelector('span.bg-danger\\/10')).not.toBeNull();
  });

  it('the body is the singular for one closed question and the plural for many (zero-one-many)', () => {
    const { unmount } = open({ titles: ['Nome da clínica'] });
    expect(
      screen.getByText(
        'Você mudou uma resposta e a pergunta abaixo deixou de se aplicar. A sua resposta a ela será apagada.',
      ),
    ).toBeTruthy();
    unmount();
    open({ titles: ['A', 'B', 'C'] });
    expect(
      screen.getByText(
        'Você mudou uma resposta e 3 perguntas abaixo deixaram de se aplicar. As suas respostas a elas serão apagadas.',
      ),
    ).toBeTruthy();
  });

  it('the confirm label follows the button that opened it: continue on Avançar, save on Concluir and Salvar', () => {
    const { unmount } = open({ kind: 'advance' });
    expect(screen.getByRole('button', { name: 'Apagar e continuar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apagar e salvar' })).toBeNull();
    unmount();
    open({ kind: 'save' });
    expect(screen.getByRole('button', { name: 'Apagar e salvar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apagar e continuar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Rever respostas' })).toBeTruthy();
  });

  it('while the confirmed save runs the confirm button reads "Salvando…" (FA-UI-1)', () => {
    open({ pending: true });
    expect(screen.getByRole('button', { name: 'Salvando…' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apagar e continuar' })).toBeNull();
  });
});

describe('EraseAnswersDialog: the list of titles (E7 populated, overflow, long-text)', () => {
  it('lists the titles as a plain list named for assistive technology, and nothing else', () => {
    open({ titles: ['Nome da clínica', 'Quantas pessoas trabalham aí?'] });
    const list = screen.getByRole('list', { name: 'Perguntas que serão apagadas' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Nome da clínica', 'Quantas pessoas trabalham aí?']);
  });

  it('shows five titles and then "e mais N perguntas" (overflow)', () => {
    const titles = Array.from({ length: 7 }, (_, n) => `Pergunta ${n + 1}`);
    open({ titles });
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Pergunta 1',
      'Pergunta 2',
      'Pergunta 3',
      'Pergunta 4',
      'Pergunta 5',
      'e mais 2 perguntas',
    ]);
    expect(screen.queryByText('Pergunta 6')).toBeNull();
    // The body counts all seven, not the five shown.
    expect(screen.getByText(/Você mudou uma resposta e 7 perguntas abaixo/)).toBeTruthy();
  });

  it('reads "e mais 1 pergunta" in the singular and shows no overflow line at exactly five', () => {
    const six = Array.from({ length: 6 }, (_, n) => `P${n + 1}`);
    const { unmount } = open({ titles: six });
    expect(screen.getByText('e mais 1 pergunta')).toBeTruthy();
    unmount();
    open({ titles: six.slice(0, 5) });
    expect(screen.queryByText(/e mais/)).toBeNull();
  });

  it('keeps the body in the capped scrolling region and wraps 120-character titles (320px, jsdom half)', () => {
    const long = 'Pergunta com um título muito longo '.repeat(4).slice(0, 120);
    const { container } = open({ titles: [long, long, long, long, long, long, long] });
    const region = document.querySelector('[data-confirm-body-scroll]') as HTMLElement;
    expect(region).not.toBeNull();
    expect(region.className).toContain('max-h-60');
    expect(region.className).toContain('overflow-y-auto');
    // The title and both buttons sit outside the scrolling region.
    expect(region.contains(screen.getByRole('heading'))).toBe(false);
    expect(region.contains(screen.getByRole('button', { name: 'Rever respostas' }))).toBe(false);
    for (const item of within(screen.getByRole('list')).getAllByRole('listitem').slice(0, 5)) {
      expect(item.className).toContain('wrap-anywhere');
    }
    expect(screen.getByRole('list').className).toContain('break-words');
    expect(container).toBeTruthy();
  });

  it('lists the titles of a whole tree flat: no nested list, no group and no branch vocabulary (12.2-14, UI-D-680)', () => {
    open({
      titles: ['A clínica tem equipe?', 'Quantos profissionais?', 'Tem sócio?', 'Nome do sócio'],
    });
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelectorAll('ul')).toHaveLength(1);
    expect(dialog.querySelectorAll('ul ul')).toHaveLength(0);
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(4);
    expect(dialog.textContent).not.toMatch(/ramo|grupo|bloco/i);
  });

  it('draws a hostile title as text, never as markup (T-12.1-12)', () => {
    open({ titles: ['<img src=x onerror=alert(1)>'] });
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('EraseAnswersDialog: the two buttons', () => {
  it('"Rever respostas" closes and never confirms', () => {
    const { onConfirm, onClose } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Rever respostas' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('the confirm button runs the confirmed action', async () => {
    const { onConfirm } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Apagar e continuar' }));
    await Promise.resolve();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
