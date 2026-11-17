// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CaseCardView } from '@/lib/chat-view';
import { CaseCard } from './CaseCard';

/**
 * 12.4-13 Task 2 (UI-D-821; UC M13, M14; T-12.4-63): one "Meus chamados" card. It takes the finished
 * `caseCardView` of plan 11 (every word already from the catalog) and draws ONE anchor to the case: the
 * number line with the state pill, the clamped subject, the prefixed one-line preview and the category and
 * time row. A closed card is never faded, and every string is React text.
 */

afterEach(cleanup);

function card(over: Partial<CaseCardView> = {}): CaseCardView {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    href: '/suporte/11111111-1111-4111-8111-111111111111',
    number: 42,
    title: 'Chamado #42',
    state: { state: 'open', label: 'Aberto', tone: 'warning', glyph: 'CircleDot' },
    subject: 'Meu ingresso não chegou',
    hasSubject: true,
    preview: 'Equipe: Já estamos vendo isso',
    category: 'Pagamento',
    time: 'Ontem',
    closed: false,
    ...over,
  };
}

describe('CaseCard (UI-D-821)', () => {
  it('is ONE anchor to the case holding the number, the pill, the subject, the preview and the meta row', () => {
    const { container } = render(<CaseCard card={card()} />);
    const anchors = container.querySelectorAll('a');
    expect(anchors).toHaveLength(1);
    const anchor = anchors[0] as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('/suporte/11111111-1111-4111-8111-111111111111');
    expect(anchor.textContent).toContain('Chamado #42');
    expect(anchor.textContent).toContain('Aberto');
    expect(anchor.textContent).toContain('Meu ingresso não chegou');
    expect(anchor.textContent).toContain('Equipe: Já estamos vendo isso');
    expect(anchor.textContent).toContain('Pagamento');
    expect(anchor.textContent).toContain('·');
    expect(anchor.textContent).toContain('Ontem');
  });

  it('draws the number in the tertiary 12/700 style and the pill beside it on row 1', () => {
    const { container } = render(<CaseCard card={card()} />);
    const number = screen.getByText('Chamado #42');
    expect(number.className).toContain('text-xs');
    expect(number.className).toContain('font-bold');
    expect(number.className).toContain('text-text-tertiary');
    const row = number.parentElement as HTMLElement;
    expect(row.textContent).toContain('Aberto');
    expect(row.className).toContain('justify-between');
    expect(container.querySelector('[data-case-pill] svg')).not.toBeNull();
  });

  it('a subject is bold and clamped to two lines; a label with no stored subject is regular weight', () => {
    const { rerender } = render(<CaseCard card={card()} />);
    const subject = screen.getByText('Meu ingresso não chegou');
    expect(subject.className).toContain('font-bold');
    expect(subject.className).toContain('line-clamp-2');

    rerender(<CaseCard card={card({ hasSubject: false, subject: 'Oi, tudo bem?' })} />);
    const label = screen.getByText('Oi, tudo bem?');
    expect(label.className).toContain('font-normal');
    expect(label.className).not.toContain('font-bold');
    expect(label.className).toContain('line-clamp-2');
  });

  it('the preview is one truncated line, and is absent for a case with no message', () => {
    const { container, rerender } = render(<CaseCard card={card()} />);
    expect(screen.getByText('Equipe: Já estamos vendo isso').className).toContain('truncate');

    rerender(<CaseCard card={card({ preview: '' })} />);
    expect(container.querySelector('[data-case-preview]')).toBeNull();
  });

  it('a Fechado card is not faded: no fade class, a neutral pill and the secondary subject colour', () => {
    const { container } = render(
      <CaseCard
        card={card({
          closed: true,
          state: { state: 'closed', label: 'Fechado', tone: 'neutral', glyph: 'Lock' },
        })}
      />,
    );
    expect(container.innerHTML).not.toMatch(/opac/);
    const subject = screen.getByText('Meu ingresso não chegou');
    expect(subject.className).toContain('text-text-secondary');
    expect(subject.className).not.toContain('text-text ');
    expect(screen.getByText('Fechado').closest('[data-case-pill]')?.className).toContain(
      'bg-bg-tertiary',
    );
  });

  it('an open card keeps the primary subject colour', () => {
    render(<CaseCard card={card()} />);
    expect(screen.getByText('Meu ingresso não chegou').className).toContain('text-text');
    expect(screen.getByText('Meu ingresso não chegou').className).not.toContain(
      'text-text-secondary',
    );
  });

  it('T-12.4-63: a subject, preview or category with angle brackets is text, never markup', () => {
    const { container } = render(
      <CaseCard
        card={card({
          subject: '<img src=x onerror=alert(1)>',
          preview: 'Você: <script>alert(1)</script>',
          category: '<b>x</b>',
        })}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('shows no priority, owner or staff name: it reads named fields of the card only', () => {
    const hostile = {
      ...card(),
      priority: 'high',
      owner: 'HOSTILE-OWNER',
      ownerName: 'HOSTILE-NAME',
    } as unknown as CaseCardView;
    const { container } = render(<CaseCard card={hostile} />);
    expect(container.textContent).not.toMatch(/HOSTILE|high/);
  });

  it('lets the title and the pill stay on row 1 while a long subject clamps below them', () => {
    const { container } = render(
      <CaseCard card={card({ subject: 'palavra '.repeat(80), hasSubject: true })} />,
    );
    const row = container.querySelector('[data-case-row-1]') as HTMLElement;
    expect(row.className).toContain('flex');
    expect(row.className).not.toContain('flex-wrap');
    expect(row.textContent).toContain('Chamado #42');
    expect(row.textContent).toContain('Aberto');
    expect(row.textContent).not.toContain('palavra');
  });
});
