// @vitest-environment happy-dom

import { join } from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { MyAnswerRow } from '@/lib/profile-form/profile-reads';

/**
 * 12-14 Task 1 (D-584, UI-D-590, UI-D-591; PFORM-20): "Minhas respostas" against the REAL merged pt-BR
 * catalog. The reader is stubbed (it has its own test), so each case hands the section the rows it names.
 */

const mocks = vi.hoisted(() => ({ loadMyAnswers: vi.fn() }));
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('@/lib/profile-form/profile-reads', () => ({
  loadMyAnswers: (...args: unknown[]) => mocks.loadMyAnswers(...args),
}));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { MyAnswersSection, MyAnswersSkeleton } = await import('./MyAnswersSection');

const row = (n: number, overrides: Partial<MyAnswerRow> = {}): MyAnswerRow => ({
  questionId: `q${n}`,
  title: `Pergunta ${n}`,
  view: { kind: 'text', text: `Resposta ${n}` },
  isPublic: false,
  ...overrides,
});

async function show() {
  const ui = await MyAnswersSection({ tenantName: 'Ana Mentoria' });
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  mocks.loadMyAnswers.mockReset();
});
afterEach(cleanup);

describe('MyAnswersSection: rows', () => {
  it('shows the title, the rendered answer and the public caption only on public rows', async () => {
    mocks.loadMyAnswers.mockResolvedValue({
      status: 'ok',
      rows: [row(1, { isPublic: true }), row(2)],
    });
    const { container } = await show();
    expect(screen.getByRole('heading', { level: 2, name: 'Minhas respostas' })).toBeTruthy();
    expect(screen.getByText('Pergunta 1')).toBeTruthy();
    expect(screen.getByText('Resposta 2')).toBeTruthy();
    const captions = container.querySelectorAll('[data-public-caption]');
    expect(captions).toHaveLength(1);
    expect(captions[0]?.textContent).toBe('Visível no seu perfil');
    expect(captions[0]?.querySelector('svg')?.getAttribute('width')).toBe('14');
    expect(container.querySelector('[data-answer-row="q1"] [data-public-caption]')).not.toBeNull();
    expect(container.querySelector('[data-answer-row="q2"] [data-public-caption]')).toBeNull();
  });

  it('reads "Sem resposta" for an unanswered optional question, in the tertiary ink', async () => {
    mocks.loadMyAnswers.mockResolvedValue({
      status: 'ok',
      rows: [row(1), row(2, { view: null })],
    });
    await show();
    const none = screen.getByText('Sem resposta');
    expect(none.className).toContain('text-text-tertiary');
  });

  it('keeps the admin order', async () => {
    mocks.loadMyAnswers.mockResolvedValue({
      status: 'ok',
      rows: [row(3), row(1), row(2)],
    });
    const { container } = await show();
    const ids = [...container.querySelectorAll('[data-answer-row]')].map((el) =>
      el.getAttribute('data-answer-row'),
    );
    expect(ids).toEqual(['q3', 'q1', 'q2']);
  });

  it('wraps a long answer and keeps its line breaks (the shared renderer)', async () => {
    const long = `${'a'.repeat(1000)}\nsegunda linha`;
    mocks.loadMyAnswers.mockResolvedValue({
      status: 'ok',
      rows: [row(1, { view: { kind: 'text', text: long } })],
    });
    const { container } = await show();
    const answer = container.querySelector('[data-answer-row="q1"] .whitespace-pre-line');
    expect(answer?.textContent).toBe(long);
    expect(answer?.className).toContain('break-words');
  });
});

describe('MyAnswersSection: the Editar link', () => {
  it('goes to the completion screen and returns to /perfil, with its own accessible name', async () => {
    mocks.loadMyAnswers.mockResolvedValue({ status: 'ok', rows: [row(1)] });
    await show();
    const edit = screen.getByRole('link', { name: 'Editar minhas respostas' });
    expect(edit.getAttribute('href')).toBe('/completar-perfil?next=%2Fperfil');
    expect(edit.textContent).toContain('Editar');
  });
});

describe('MyAnswersSection: collapse above four rows', () => {
  it('shows all four rows with no details at four', async () => {
    mocks.loadMyAnswers.mockResolvedValue({
      status: 'ok',
      rows: [row(1), row(2), row(3), row(4)],
    });
    const { container } = await show();
    expect(container.querySelector('details')).toBeNull();
    expect(screen.queryByText(/Ver todas/)).toBeNull();
    expect(container.querySelectorAll('[data-answer-row]')).toHaveLength(4);
  });

  it('shows no details for one row', async () => {
    mocks.loadMyAnswers.mockResolvedValue({ status: 'ok', rows: [row(1)] });
    const { container } = await show();
    expect(container.querySelector('details')).toBeNull();
  });

  it('keeps the first four visible and the rest behind "Ver todas (6)" / "Mostrar menos"', async () => {
    mocks.loadMyAnswers.mockResolvedValue({
      status: 'ok',
      rows: [1, 2, 3, 4, 5, 6].map((n) => row(n)),
    });
    const { container } = await show();
    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(within(details).getByText('Ver todas (6)')).toBeTruthy();
    expect(within(details).getByText('Mostrar menos')).toBeTruthy();
    const inside = [...details.querySelectorAll('[data-answer-row]')].map((el) =>
      el.getAttribute('data-answer-row'),
    );
    expect(inside).toEqual(['q5', 'q6']);
    // the first four are outside the details
    const outside = [...container.querySelectorAll('[data-answer-row]')]
      .filter((el) => !details.contains(el))
      .map((el) => el.getAttribute('data-answer-row'));
    expect(outside).toEqual(['q1', 'q2', 'q3', 'q4']);
  });
});

describe('MyAnswersSection: absence, empty and error', () => {
  it('renders nothing when there is no active question', async () => {
    mocks.loadMyAnswers.mockResolvedValue({ status: 'empty' });
    const { container } = await show();
    expect(container.innerHTML).toBe('');
  });

  it('shows the shipped empty card when nothing is answered, with the tenant and the way to answer', async () => {
    mocks.loadMyAnswers.mockResolvedValue({
      status: 'ok',
      rows: [row(1, { view: null }), row(2, { view: null })],
    });
    const { container } = await show();
    expect(container.querySelector('[data-profile-empty]')).not.toBeNull();
    expect(screen.getByText('Você ainda não respondeu')).toBeTruthy();
    expect(
      screen.getByText('Responda as perguntas de Ana Mentoria para completar seu perfil.'),
    ).toBeTruthy();
    const action = screen.getByRole('link', { name: 'Responder' });
    expect(action.getAttribute('href')).toBe('/completar-perfil?next=%2Fperfil');
    expect(container.querySelector('[data-answer-row]')).toBeNull();
  });

  it('shows the error card with a retry that reloads /perfil#respostas, and no rows', async () => {
    mocks.loadMyAnswers.mockResolvedValue({ status: 'error' });
    const { container } = await show();
    expect(container.querySelector('[data-profile-empty]')).not.toBeNull();
    expect(screen.getByText('Algo deu errado')).toBeTruthy();
    expect(screen.getByText('Não foi possível carregar suas respostas agora.')).toBeTruthy();
    const retry = screen.getByRole('link', { name: 'Tentar novamente' });
    expect(retry.getAttribute('href')).toBe('/perfil#respostas');
    expect(container.querySelector('[data-answer-row]')).toBeNull();
  });
});

describe('MyAnswersSection: a question that does not apply is omitted (D-634, UI-D-659; E9)', () => {
  it('omits a hidden conditional row, keeps a matching one, and the card stays flat in the form order', async () => {
    mocks.loadMyAnswers.mockResolvedValue({
      status: 'ok',
      rows: [row(1), row(2, { view: null, hidden: true }), row(3, { hidden: false }), row(4)],
    });
    const { container } = await show();
    expect(
      [...container.querySelectorAll('[data-answer-row]')].map((el) =>
        el.getAttribute('data-answer-row'),
      ),
    ).toEqual(['q1', 'q3', 'q4']);
    // Never "Sem resposta" for a question the member never sees.
    expect(screen.queryByText('Sem resposta')).toBeNull();
    // Flat: one card of divided rows, no step headings and no sub-headings.
    expect(container.querySelectorAll('h3')).toHaveLength(0);
    expect(container.querySelectorAll('.divide-y')).toHaveLength(1);
  });

  it('the "Ver todas" count and the threshold count only the rows shown', async () => {
    // Seven rows, two hidden: five shown, so the collapse still opens, and says 5, not 7.
    mocks.loadMyAnswers.mockResolvedValue({
      status: 'ok',
      rows: [
        row(1),
        row(2, { hidden: true, view: null }),
        row(3),
        row(4),
        row(5, { hidden: true, view: null }),
        row(6),
        row(7),
      ],
    });
    const { container } = await show();
    const details = container.querySelector('details') as HTMLElement;
    expect(within(details).getByText('Ver todas (5)')).toBeTruthy();
    expect(screen.queryByText('Ver todas (7)')).toBeNull();
    expect(container.querySelectorAll('[data-answer-row]')).toHaveLength(5);
  });

  it('with the omitted rows the list falls under the threshold: four shown, no collapse', async () => {
    mocks.loadMyAnswers.mockResolvedValue({
      status: 'ok',
      rows: [row(1), row(2, { hidden: true, view: null }), row(3), row(4), row(5)],
    });
    const { container } = await show();
    expect(container.querySelector('details')).toBeNull();
    expect(screen.queryByText(/Ver todas/)).toBeNull();
    expect(container.querySelectorAll('[data-answer-row]')).toHaveLength(4);
  });

  it('E9 empty: when every remaining row is unanswered or omitted the Phase 12 empty state shows, never an empty card', async () => {
    mocks.loadMyAnswers.mockResolvedValue({
      status: 'ok',
      rows: [row(1, { hidden: true, view: null }), row(2, { hidden: true, view: null })],
    });
    const { container } = await show();
    expect(screen.getByText('Você ainda não respondeu')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Responder' }).getAttribute('href')).toBe(
      '/completar-perfil?next=%2Fperfil',
    );
    expect(container.querySelector('[data-answer-row]')).toBeNull();
    expect(container.querySelector('details')).toBeNull();
  });
});

describe('MyAnswersSkeleton', () => {
  it('is three rows, busy, with no spinner', () => {
    const { container } = render(<MyAnswersSkeleton />);
    expect(container.querySelector('[aria-busy]')).not.toBeNull();
    expect(container.querySelectorAll('.p-4')).toHaveLength(3);
    expect(container.querySelector('[role="status"], .animate-spin')).toBeNull();
  });
});
