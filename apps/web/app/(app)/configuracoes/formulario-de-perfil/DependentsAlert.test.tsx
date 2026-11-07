// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { uuid } from '@/lib/profile-form/test-fixtures';
import { DependentsAlert, type DependentsAlertKind } from './DependentsAlert';

/**
 * 12.1-17 Task 2 (D-632, UI-D-651, T-12.1-12): the ONE refusal component, against the REAL catalog. Asserted:
 * the title of each of the four refusals, the hint of the first three and of the option case, the alert role
 * and geometry, the list named for a screen reader, up to five titles then "e mais N" (singular and plural),
 * `break-words` on titles, no raw HTML sink, and that an empty list renders nothing.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

const dependents = (count: number) =>
  Array.from({ length: count }, (_, at) => ({
    id: uuid(9400 + at),
    title: `Dependente ${at + 1}`,
  }));

function show(kind: DependentsAlertKind, list: ReturnType<typeof dependents>, label?: string) {
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <DependentsAlert kind={kind} dependents={list} label={label} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe('DependentsAlert: the four refusals (UI-D-651)', () => {
  const HINT = 'Remova a condição destas perguntas, ou arquive-as, e tente de novo:';
  const cases: [DependentsAlertKind, string][] = [
    ['archive', 'Esta pergunta abre outras e não pode ser arquivada agora.'],
    ['delete', 'Esta pergunta abre outras e não pode ser excluída agora.'],
    ['type', 'Esta pergunta abre outras e não pode mudar de tipo agora.'],
  ];

  for (const [kind, title] of cases) {
    it(`${kind}: the title, the hint and the list of the dependents`, () => {
      show(kind, dependents(3));
      const alert = screen.getByRole('alert');
      expect(within(alert).getByText(title)).toBeTruthy();
      expect(within(alert).getByText(HINT)).toBeTruthy();
      const list = within(alert).getByRole('list', { name: 'Perguntas que dependem desta' });
      expect(
        within(list)
          .getAllByRole('listitem')
          .map((li) => li.textContent),
      ).toEqual(['Dependente 1', 'Dependente 2', 'Dependente 3']);
    });
  }

  it('option: names the option and has its own hint', () => {
    show('option', dependents(2), 'Tenho uma clínica');
    const alert = screen.getByRole('alert');
    expect(
      within(alert).getByText(
        'A opção “Tenho uma clínica” abre outras perguntas e não pode ser removida agora.',
      ),
    ).toBeTruthy();
    expect(
      within(alert).getByText(
        'Tire esta opção da condição destas perguntas, ou remova a condição delas, e tente de novo:',
      ),
    ).toBeTruthy();
  });
});

describe('DependentsAlert: geometry and the long list (UI-D-651)', () => {
  it('uses the sheet-alert geometry, a 14/700 title and a 12/400 hint', () => {
    show('archive', dependents(1));
    const alert = screen.getByRole('alert');
    for (const klass of [
      'rounded-xl',
      'border',
      'border-danger/40',
      'bg-danger/5',
      'p-4',
      'text-sm',
      'text-danger',
    ]) {
      expect(alert.className).toContain(klass);
    }
    const title = screen.getByText('Esta pergunta abre outras e não pode ser arquivada agora.');
    expect(title.className).toContain('text-sm');
    expect(title.className).toContain('font-bold');
    const hint = screen.getByText(/^Remova a condição destas perguntas/);
    expect(hint.className).toContain('text-xs');
    expect(hint.className).toContain('font-normal');
  });

  it('lists up to five titles and says "e mais 2 perguntas" for seven', () => {
    show('archive', dependents(7));
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('e mais 2 perguntas')).toBeTruthy();
    expect(screen.queryByText('Dependente 6')).toBeNull();
  });

  it('says "e mais 1 pergunta" in the singular for six, and nothing for exactly five', () => {
    const { unmount } = show('delete', dependents(6));
    expect(screen.getByText('e mais 1 pergunta')).toBeTruthy();
    unmount();
    show('delete', dependents(5));
    expect(screen.queryByText(/^e mais/)).toBeNull();
    expect(screen.queryByText(/e mais 0/)).toBeNull();
  });

  it('lets a very long title wrap and never renders the markup of a title (T-12.1-12)', () => {
    const hostile = '<img src=x onerror="alert(1)"> ' + 'palavra'.repeat(30);
    show('archive', [{ id: uuid(9500), title: hostile }]);
    const item = screen.getByRole('listitem');
    expect(item.className).toContain('break-words');
    expect(item.textContent).toBe(hostile);
    expect(item.querySelector('img')).toBeNull();
  });

  it('renders nothing for an empty list: a refusal always names a dependent', () => {
    const { container } = show('archive', []);
    expect(container.firstChild).toBeNull();
  });

  it('has exactly one alert role and no raw HTML sink in its source', () => {
    const source = readFileSync(join(__dirname, 'DependentsAlert.tsx'), 'utf8');
    expect(source.match(/role="alert"/g)).toHaveLength(1);
    expect(source).not.toContain('dangerouslySetInnerHTML');
  });
});

describe('DependentsAlert: "Arquivar ramo" refused over openers of branches with answers (12.2-17, UI-D-672)', () => {
  it('names what cannot be done, what to do first, and lists the opener titles', () => {
    show('archiveBranch', dependents(2));
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('data-dependents-alert')).toBe('archiveBranch');
    expect(within(alert).getByText('Este ramo não pode ser arquivado agora.')).toBeTruthy();
    expect(
      within(alert).getByText(
        'Estas perguntas abrem ramos que já têm respostas. Desfaça esses ramos e tente de novo:',
      ),
    ).toBeTruthy();
    expect(
      within(alert)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Dependente 1', 'Dependente 2']);
  });

  it('keeps the geometry of the other refusals and lists five titles, then "e mais 1 pergunta"', () => {
    show('archiveBranch', dependents(6));
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('rounded-xl');
    expect(alert.className).toContain('p-4');
    expect(within(alert).getAllByRole('listitem')).toHaveLength(5);
    expect(within(alert).getByText('e mais 1 pergunta')).toBeTruthy();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('renders nothing for an empty list and a hostile title as text', () => {
    const { container, unmount } = show('archiveBranch', []);
    expect(container.innerHTML).toBe('');
    unmount();
    cleanup();
    show('archiveBranch', [{ id: uuid(9499), title: '<img src=x onerror=alert(1)>' }]);
    expect(screen.getByRole('alert').querySelector('img')).toBeNull();
  });

  it('has no half-step spacing class in its source', () => {
    const source = readFileSync(join(__dirname, 'DependentsAlert.tsx'), 'utf8');
    expect(source).not.toMatch(/(^|[^a-z])(gap|p|m|px|py|mt|mb|ml|mr)-(0\.5|1\.5|2\.5|3\.5)/);
  });
});
