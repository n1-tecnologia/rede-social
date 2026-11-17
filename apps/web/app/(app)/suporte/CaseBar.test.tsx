// @vitest-environment happy-dom

import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { MemberCaseHeaderView } from '@/lib/chat-view';
import { CaseBar } from './CaseBar';

/**
 * 12.4-12 Task 1 (UI-D-818, UI-D-835; UC M01, M02; T-12.4-55): the member's case bar. It takes the
 * finished member header of plan 11 and draws number, state word and the subject label, never a
 * priority, an owner, a history row or a category. The real pt-BR catalog runs.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

afterEach(cleanup);

function header(over: Partial<MemberCaseHeaderView> = {}): MemberCaseHeaderView {
  return {
    viewer: 'member',
    id: '11111111-1111-4111-8111-111111111111',
    number: 42,
    title: 'Chamado #42',
    state: { state: 'open', label: 'Aberto', tone: 'warning', glyph: 'CircleDot' },
    subject: 'Meu ingresso não chegou',
    subjectLine: '#42 · Meu ingresso não chegou',
    ...over,
  };
}

function bar(props: Parameters<typeof CaseBar>[0]) {
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <CaseBar {...props} />
    </NextIntlClientProvider>,
  );
}

describe('CaseBar (UI-D-818)', () => {
  it('draws the number, the state pill word, the subject and the link to Meus chamados', () => {
    const { container } = bar({ header: header(), hasAnyCase: true });
    expect(screen.getByText('Chamado #42')).toBeTruthy();
    expect(screen.getByText('Aberto')).toBeTruthy();
    expect(screen.getByText('Meu ingresso não chegou')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Meus chamados' });
    expect(link.getAttribute('href')).toBe('/suporte/chamados');
    expect(container.querySelector('[data-case-bar]')).not.toBeNull();
  });

  it('draws row 2 from the server label for a case with no typed subject (D-839, CASE-11)', () => {
    bar({
      header: header({ subject: 'Oi, comprei o ingresso e não consigo entrar no…' }),
      hasAnyCase: true,
    });
    expect(screen.getByText('Oi, comprei o ingresso e não consigo entrar no…')).toBeTruthy();
  });

  it('keeps the subject on one truncated line', () => {
    bar({ header: header({ subject: 'x'.repeat(80) }), hasAnyCase: true });
    const row = screen.getByText('x'.repeat(80));
    expect(row.className).toContain('truncate');
  });

  it('reads the state of every state change from the header it is given', () => {
    const { rerender } = bar({ header: header(), hasAnyCase: true });
    rerender(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <CaseBar
          header={header({
            state: {
              state: 'in_progress',
              label: 'Em atendimento',
              tone: 'brand',
              glyph: 'UserCheck',
            },
          })}
          hasAnyCase
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Em atendimento')).toBeTruthy();
    expect(screen.queryByText('Aberto')).toBeNull();
  });

  it('draws no priority, owner, category, history or staff fact even when the input carries them (T-12.4-55)', () => {
    const hostile = {
      ...header(),
      priority: 'high',
      ownerName: 'Carla Souza',
      ownerUserId: '22222222-2222-4222-8222-222222222222',
      meta: 'Pagamento · Alta · Com Carla',
      category: 'payment',
      actions: ['resolve', 'close'],
      history: [{ kind: 'taken' }],
    } as unknown as MemberCaseHeaderView;
    const { container } = bar({ header: hostile, hasAnyCase: true });
    const text = container.textContent ?? '';
    for (const word of [
      'Alta',
      'Carla',
      'Souza',
      'Pagamento',
      'Resolver',
      'Fechar',
      'Prioridade',
    ]) {
      expect(text).not.toContain(word);
    }
  });

  it('shows only the link for a member with no active case but past cases (slim bar, no row 2)', () => {
    const { container } = bar({ header: null, hasAnyCase: true });
    expect(screen.getByRole('link', { name: 'Meus chamados' })).toBeTruthy();
    expect(container.querySelector('[data-case-bar]')).not.toBeNull();
    expect(screen.queryByText(/Chamado #/)).toBeNull();
    expect(container.querySelector('[data-case-subject]')).toBeNull();
  });

  it('draws no bar at all for a member with no case (no link either)', () => {
    const { container } = bar({ header: null, hasAnyCase: false });
    expect(container.querySelector('[data-case-bar]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Meus chamados' })).toBeNull();
  });

  it('exposes the number and the state as one reading unit', () => {
    bar({ header: header(), hasAnyCase: true });
    expect(screen.getByText('Chamado #42, Aberto').className).toContain('sr-only');
  });
});
