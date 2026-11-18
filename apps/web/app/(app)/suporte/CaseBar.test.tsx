// @vitest-environment happy-dom

import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { MemberCaseHeaderView } from '@/lib/chat-view';
import { caseHeaderView } from '@/lib/chat-view';
import { CaseBar, ClosedStrip, ResolvedStrip } from './CaseBar';

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

/**
 * 12.4-12 Task 2 (UI-D-820, UI-D-833; UC M06, M08, M09): the strips and the live region.
 */
const stateOf = (
  state: 'open' | 'in_progress' | 'resolved' | 'closed',
): MemberCaseHeaderView['state'] => {
  const words = {
    open: ['Aberto', 'warning', 'CircleDot'],
    in_progress: ['Em atendimento', 'brand', 'UserCheck'],
    resolved: ['Resolvido', 'success', 'CircleCheck'],
    closed: ['Fechado', 'neutral', 'Lock'],
  } as const;
  const [label, tone, glyph] = words[state];
  return { state, label, tone, glyph };
};

const wrap = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="pt-BR" messages={messages}>
    {node}
  </NextIntlClientProvider>
);

const live = (container: HTMLElement) => container.querySelector('[aria-live="polite"]');

describe('the Resolvido and Fechado strips (UI-D-820c, UI-D-820e, UI-D-833)', () => {
  it('draws the non-dismissible resolved notice as a status', () => {
    render(wrap(<ResolvedStrip />));
    const strip = screen.getByRole('status');
    expect(strip.textContent).toBe(
      'Este chamado foi marcado como resolvido. Se ainda precisar de ajuda, responda aqui e ele volta a ser atendido.',
    );
    expect(strip.querySelector('button')).toBeNull();
  });

  it('draws the closed notice as a status with Novo chamado pointing at /suporte', () => {
    render(wrap(<ClosedStrip />));
    const strip = screen.getByRole('status');
    expect(strip.textContent).toContain(
      'Este chamado foi fechado. Para falar com a equipe de novo, abra um novo chamado.',
    );
    expect(screen.getByRole('link', { name: 'Novo chamado' }).getAttribute('href')).toBe(
      '/suporte',
    );
  });

  it('makes Novo chamado full width below 360px', () => {
    render(wrap(<ClosedStrip />));
    expect(screen.getByRole('link', { name: 'Novo chamado' }).className).toContain(
      'max-[359px]:w-full',
    );
  });
});

describe('the polite live region (UI-D-830, UI-D-833; UC M09)', () => {
  it('is one persistent visually hidden polite region, empty on first render, never assertive', () => {
    const { container } = render(wrap(<CaseBar header={header()} hasAnyCase />));
    const regions = container.querySelectorAll('[aria-live]');
    expect(regions).toHaveLength(1);
    expect(regions[0]?.getAttribute('aria-live')).toBe('polite');
    expect(regions[0]?.className).toContain('sr-only');
    expect(regions[0]?.textContent).toBe('');
  });

  it('keeps the region when there is no case at all', () => {
    const { container } = render(wrap(<CaseBar header={null} hasAnyCase={false} />));
    expect(live(container)).not.toBeNull();
    expect(container.querySelector('[data-case-bar]')).toBeNull();
  });

  it('speaks the resolved sentence only when the state changes to resolved after mount', () => {
    const { container, rerender } = render(wrap(<CaseBar header={header()} hasAnyCase />));
    expect(live(container)?.textContent).toBe('');
    rerender(wrap(<CaseBar header={header({ state: stateOf('resolved') })} hasAnyCase />));
    expect(live(container)?.textContent).toBe('Seu chamado #42 foi resolvido.');
  });

  it('speaks the closed sentence, and the reopened one when a resolved case goes back to Aberto', () => {
    const { container, rerender } = render(
      wrap(<CaseBar header={header({ state: stateOf('resolved') })} hasAnyCase />),
    );
    expect(live(container)?.textContent).toBe('');
    rerender(wrap(<CaseBar header={header({ state: stateOf('open') })} hasAnyCase />));
    expect(live(container)?.textContent).toBe('Seu chamado #42 foi reaberto.');
    rerender(wrap(<CaseBar header={header({ state: stateOf('closed') })} hasAnyCase />));
    expect(live(container)?.textContent).toBe('Seu chamado #42 foi fechado.');
  });

  it('says nothing for a change that is not resolved, closed or reopened (Aberto to Em atendimento)', () => {
    const { container, rerender } = render(wrap(<CaseBar header={header()} hasAnyCase />));
    rerender(wrap(<CaseBar header={header({ state: stateOf('in_progress') })} hasAnyCase />));
    expect(live(container)?.textContent).toBe('');
  });

  it('says nothing when a first case swaps in, or for another case', () => {
    const { container, rerender } = render(wrap(<CaseBar header={null} hasAnyCase={false} />));
    rerender(wrap(<CaseBar header={header({ state: stateOf('resolved') })} hasAnyCase />));
    expect(live(container)?.textContent).toBe('');
    rerender(
      wrap(
        <CaseBar
          header={header({ id: '33333333-3333-4333-8333-333333333333', state: stateOf('closed') })}
          hasAnyCase
        />,
      ),
    );
    expect(live(container)?.textContent).toBe('');
  });

  it('moves no focus on a live change', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const { rerender } = render(wrap(<CaseBar header={header()} hasAnyCase />));
    input.focus();
    rerender(wrap(<CaseBar header={header({ state: stateOf('closed') })} hasAnyCase />));
    expect(document.activeElement).toBe(input);
    input.remove();
  });
});

/**
 * 12.5-16 (D-861, VOICE-30, A-UI-1): a case opened by voice with no typed subject carries the server's finished
 * label "Mensagem de voz" (no duration). Built here through the REAL view functions and the REAL catalog.
 */
const voiceT = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'chat',
}) as unknown as Parameters<typeof caseHeaderView>[1]['t'];
const voiceCase = {
  id: '33333333-3333-4333-8333-333333333333',
  number: 42,
  state: 'open',
  subject: null,
  subjectLabel: 'Mensagem de voz',
  category: 'payment',
  openedAt: '2026-11-17T14:02:00.000Z',
} as const;

describe('12.5-16 the case label of a case opened by voice (D-861, A-UI-1)', () => {
  it('the member bar draws row 2 as "Mensagem de voz" with no duration, from the real header view', () => {
    const view = caseHeaderView(voiceCase as never, { viewer: 'member', t: voiceT });
    expect(view.subjectLine).toBe('#42 · Mensagem de voz');
    const { container } = bar({ header: view as MemberCaseHeaderView, hasAnyCase: true });
    const row2 = container.querySelector('[data-case-subject]') as HTMLElement;
    expect(row2.textContent).toBe('Mensagem de voz');
    expect(container.textContent).not.toMatch(/\d:\d\d/);
  });
});
