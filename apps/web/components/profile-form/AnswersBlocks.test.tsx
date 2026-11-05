// @vitest-environment happy-dom

import { join } from 'node:path';
import type { PublicAnswers, StaffAnswers } from '@rede-social/contracts/profile-form';
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { options, uuid } from '@/lib/profile-form/test-fixtures';

/**
 * 12-14 Task 3 (D-593, UI-D-592, UI-D-593; PFORM-18, PFORM-19; T-12-32): the public block, the staff block
 * and the block that picks between them, against the REAL pt-BR catalog. The reader is stubbed (it has its
 * own test); each case hands the blocks the payload it names.
 */

const mocks = vi.hoisted(() => ({ loadMemberAnswers: vi.fn() }));
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('@/lib/profile-form/profile-reads', () => ({
  loadMemberAnswers: (...args: unknown[]) => mocks.loadMemberAnswers(...args),
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

const { PublicAnswersBlock } = await import('./PublicAnswersBlock');
const { StaffAnswersBlock } = await import('./StaffAnswersBlock');
const { MemberAnswersData, MemberAnswersBlock, MemberAnswersSkeleton } = await import(
  './MemberAnswersBlock'
);

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );

type PublicRow = PublicAnswers['answers'][number];
type StaffRow = StaffAnswers['answers'][number];

const publicRow = (n: number, overrides: Partial<PublicRow> = {}): PublicRow => ({
  questionId: uuid(n),
  title: `Pergunta ${n}`,
  type: 'short_text',
  options: [],
  value: `Resposta ${n}`,
  ...overrides,
});

const staffRow = (n: number, overrides: Partial<StaffRow> = {}): StaffRow => ({
  questionId: uuid(n),
  title: `Pergunta ${n}`,
  type: 'short_text',
  options: [],
  value: `Resposta ${n}`,
  showOnProfile: false,
  position: n,
  archivedAt: null,
  answered: true,
  required: false,
  condition: null,
  ...overrides,
});

beforeEach(() => {
  mocks.loadMemberAnswers.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(cleanup);

describe('PublicAnswersBlock (UI-D-592)', () => {
  it('shows "Sobre {name}" and a description list with the term, then the rendered answer', async () => {
    const choices = options('Liderança', 'Vendas');
    const ui = await PublicAnswersBlock({
      name: 'Carla Menezes',
      answers: [
        publicRow(1, { title: 'Qual é o seu cargo?', value: 'Gerente de produto' }),
        publicRow(2, {
          title: 'Quais temas?',
          type: 'multiple_choice',
          options: choices,
          value: { optionIds: choices.map((c) => c.id), otherText: 'Mentoria' },
        }),
        publicRow(3, { title: 'Sua nota', type: 'rating', value: 4 }),
      ],
    });
    const { container } = wrap(ui);
    expect(screen.getByRole('heading', { level: 2, name: 'Sobre Carla Menezes' })).toBeTruthy();
    const terms = [...container.querySelectorAll('dl > div > dt')].map((el) => el.textContent);
    expect(terms).toEqual(['Qual é o seu cargo?', 'Quais temas?', 'Sua nota']);
    const descriptions = [...container.querySelectorAll('dl > div > dd')].map(
      (el) => el.textContent,
    );
    expect(descriptions[0]).toBe('Gerente de produto');
    expect(descriptions[1]).toBe('Liderança, Vendas, Outro: Mentoria');
    expect(descriptions[2]).toBe('4 de 5');
  });

  it('renders one row as the same description list', async () => {
    const ui = await PublicAnswersBlock({ name: 'Carla', answers: [publicRow(1)] });
    const { container } = wrap(ui);
    expect(container.querySelectorAll('dl > div')).toHaveLength(1);
  });

  it('renders nothing at all with no row: no heading, no empty state', async () => {
    const ui = await PublicAnswersBlock({ name: 'Carla', answers: [] });
    expect(ui).toBeNull();
    const { container } = wrap(ui);
    expect(container.innerHTML).toBe('');
  });

  it('skips a row whose stored shape does not fit its type, and is absent if none is left', async () => {
    const ui = await PublicAnswersBlock({
      name: 'Carla',
      answers: [publicRow(1, { type: 'number', value: 'texto' })],
    });
    expect(ui).toBeNull();
  });

  it('turns only a validated http(s) Link answer into an anchor, with the exact attributes', async () => {
    const ui = await PublicAnswersBlock({
      name: 'Carla',
      answers: [
        publicRow(1, {
          type: 'link',
          title: 'Instagram',
          value: 'https://instagram.com/carla.menezes',
        }),
        publicRow(2, { type: 'link', title: 'Outro', value: 'javascript:alert(1)' }),
        publicRow(3, { type: 'email', title: 'E-mail', value: 'carla@exemplo.com' }),
        publicRow(4, {
          title: 'Texto',
          value: '<a href="https://evil.example">clique</a>',
        }),
      ],
    });
    const { container } = wrap(ui);
    const anchors = container.querySelectorAll('a');
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute('href')).toBe('https://instagram.com/carla.menezes');
    expect(anchors[0]?.getAttribute('target')).toBe('_blank');
    expect(anchors[0]?.getAttribute('rel')).toBe('noopener noreferrer nofollow ugc');
    expect(container.textContent).toContain('javascript:alert(1)');
    expect(container.textContent).toContain('<a href="https://evil.example">clique</a>');
  });

  it('wraps a 1000-character answer and a very long address inside the card', async () => {
    const long = `${'x'.repeat(1000)}`;
    const url = `https://exemplo.com.br/${'a'.repeat(300)}`;
    const ui = await PublicAnswersBlock({
      name: 'Carla',
      answers: [
        publicRow(1, { type: 'long_text', value: long }),
        publicRow(2, { type: 'link', value: url }),
      ],
    });
    const { container } = wrap(ui);
    for (const el of container.querySelectorAll('dd span, dd a')) {
      expect(el.className).toMatch(/break-words|wrap-anywhere/);
    }
    expect(container.querySelector('dt')?.className).toContain('break-words');
  });
});

describe('StaffAnswersBlock (UI-D-593)', () => {
  it('shows active rows first, then the sub-heading, then archived rows with the pills', async () => {
    const ui = await StaffAnswersBlock({
      answers: [
        staffRow(1, { title: 'Cargo', showOnProfile: true }),
        staffRow(2, { title: 'Como conheceu', value: 'Indicação' }),
        staffRow(3, { title: 'Nascimento', type: 'date', value: null, answered: false }),
        staffRow(4, { title: 'Renda', type: 'number', value: 4500, archivedAt: '2026-10-01' }),
        staffRow(5, {
          title: 'Signo',
          showOnProfile: true,
          value: 'Leão',
          archivedAt: '2026-09-01',
        }),
      ],
    });
    const { container } = wrap(ui);
    expect(screen.getByRole('heading', { level: 2, name: 'Respostas do formulário' })).toBeTruthy();

    const order = [...container.querySelectorAll('[data-member-answers="staff"] > div > *')].map(
      (el) =>
        el.tagName === 'H3'
          ? `H3:${el.textContent}`
          : (el.querySelector('span span')?.textContent ?? ''),
    );
    expect(order).toEqual([
      'Cargo',
      'Como conheceu',
      'Nascimento',
      'H3:Perguntas arquivadas',
      'Renda',
      'Signo',
    ]);

    // the pills
    const cargo = container.querySelectorAll('[data-member-answers="staff"] > div > div')[0];
    expect(within(cargo as HTMLElement).getByText('Público no perfil')).toBeTruthy();
    expect(within(cargo as HTMLElement).queryByText('Arquivada')).toBeNull();
    expect(screen.getAllByText('Arquivada')).toHaveLength(2);
    expect(screen.getAllByText('Público no perfil')).toHaveLength(2);
    // unanswered reads "Sem resposta"
    expect(screen.getByText('Sem resposta')).toBeTruthy();
    // the number is shown the pt-BR way
    expect(screen.getByText('4.500')).toBeTruthy();
  });

  it('has no sub-heading without an archived question', async () => {
    const ui = await StaffAnswersBlock({
      answers: [staffRow(1), staffRow(2, { value: null, answered: false })],
    });
    wrap(ui);
    expect(screen.queryByText('Perguntas arquivadas')).toBeNull();
    expect(screen.getByText('Sem resposta')).toBeTruthy();
  });

  it('shows the one sentence for a member who answered nothing', async () => {
    const ui = await StaffAnswersBlock({
      answers: [
        staffRow(1, { value: null, answered: false }),
        staffRow(2, { value: null, answered: false, required: true }),
      ],
    });
    const { container } = wrap(ui);
    expect(screen.getByText('Esta pessoa ainda não respondeu o formulário.')).toBeTruthy();
    expect(screen.queryByText('Sem resposta')).toBeNull();
    expect(container.querySelectorAll('[data-member-answers="staff"] .p-4')).toHaveLength(1);
  });

  it('shows the sentence with no question at all', async () => {
    const ui = await StaffAnswersBlock({ answers: [] });
    wrap(ui);
    expect(screen.getByText('Esta pessoa ainda não respondeu o formulário.')).toBeTruthy();
  });

  it('keeps a 1000-character answer with its paragraph breaks through the shared mapper', async () => {
    const text = `${'p'.repeat(500)}\n\n${'q'.repeat(500)}`;
    const ui = await StaffAnswersBlock({
      answers: [staffRow(1, { type: 'long_text', value: text })],
    });
    const { container } = wrap(ui);
    const answer = container.querySelector('.whitespace-pre-line');
    expect(answer?.textContent).toBe(text);
  });
});

describe('MemberAnswersData: the viewer picks the block, a failure is a small row', () => {
  const props = {
    membershipId: 'm-1',
    name: 'Carla Menezes',
    retryHref: '/membros/m-1',
  };

  it('gives a member viewer the public block', async () => {
    mocks.loadMemberAnswers.mockResolvedValue({
      status: 'ok',
      payload: { kind: 'member', answers: [publicRow(1)] },
    });
    wrap(await MemberAnswersData({ ...props, role: 'member' }));
    expect(screen.getByText('Sobre Carla Menezes')).toBeTruthy();
    expect(mocks.loadMemberAnswers).toHaveBeenCalledWith('m-1');
  });

  it('gives admin and support the staff block', async () => {
    for (const role of ['admin_tenant', 'support_tenant']) {
      mocks.loadMemberAnswers.mockResolvedValue({
        status: 'ok',
        payload: { kind: 'staff', answers: [staffRow(1)] },
      });
      const { unmount } = wrap(await MemberAnswersData({ ...props, role }));
      expect(screen.getByText('Respostas do formulário'), role).toBeTruthy();
      unmount();
    }
  });

  it('never renders a payload of the other kind (a mix-up does not fall through)', async () => {
    mocks.loadMemberAnswers.mockResolvedValue({
      status: 'ok',
      payload: { kind: 'staff', answers: [staffRow(1)] },
    });
    expect(await MemberAnswersData({ ...props, role: 'member' })).toBeNull();
    mocks.loadMemberAnswers.mockResolvedValue({
      status: 'ok',
      payload: { kind: 'member', answers: [publicRow(1)] },
    });
    expect(await MemberAnswersData({ ...props, role: 'admin_tenant' })).toBeNull();
  });

  it('is no block at all when the API answers its bare 404', async () => {
    mocks.loadMemberAnswers.mockResolvedValue({ status: 'absent' });
    const { container } = wrap(await MemberAnswersData({ ...props, role: 'member' }));
    expect(container.innerHTML).toBe('');
  });

  it('shows only a small error row with a retry to the same URL on a failed read', async () => {
    mocks.loadMemberAnswers.mockResolvedValue({ status: 'error' });
    const { container } = wrap(await MemberAnswersData({ ...props, role: 'member' }));
    expect(screen.getByText('Não foi possível carregar as respostas agora.')).toBeTruthy();
    const retry = screen.getByRole('link', { name: 'Tentar novamente' });
    expect(retry.getAttribute('href')).toBe('/membros/m-1');
    expect(container.querySelector('dl')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('MemberAnswersBlock', () => {
  it('makes no request and renders nothing for a role that is neither member nor staff', () => {
    const element = MemberAnswersBlock({
      membershipId: 'm-1',
      name: 'Carla',
      role: 'super_admin',
      retryHref: '/membros/m-1',
    });
    expect(element).toBeNull();
    expect(mocks.loadMemberAnswers).not.toHaveBeenCalled();
  });

  it('has a three-row busy skeleton as its fallback, with no spinner', () => {
    const { container } = render(<MemberAnswersSkeleton />);
    expect(container.querySelector('[aria-busy]')).not.toBeNull();
    expect(container.querySelectorAll('.p-4')).toHaveLength(3);
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
});
