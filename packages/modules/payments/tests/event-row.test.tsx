// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EventRow, EventRowSkeleton, PaymentsSkeleton } from '../ui';

/**
 * 09.1-14 (UI-D-519, UI-D-520, UI-D-531, D-503, MOD-02) — the module's props-only Eventos row. It draws
 * ONLY finished strings and a slot: it has no way to draw a payload, a header or a signature, because it
 * is never given one (T-09.1-65). Plain DOM assertions only.
 */

afterEach(cleanup);

type Props = Parameters<typeof EventRow>[0];

function row(over: Partial<Props> = {}) {
  render(
    <ul>
      <EventRow
        state="applied"
        stateLabel="Aplicado"
        name="Compra aprovada"
        email="ana@exemplo.com.br"
        product="Assinatura mensal"
        received="recebido há 3 min"
        {...over}
      />
    </ul>,
  );
  return screen.getByRole('listitem');
}

describe('EventRow: the state in a glyph, a word and a colour (UI-D-519, UI-D-520)', () => {
  const CASES = [
    ['applied', 'Aplicado', 'text-success'],
    ['no_account', 'Sem conta', 'text-warning'],
    ['unknown_product', 'Produto desconhecido', 'text-warning'],
    ['ignored', 'Ignorado', 'text-text-secondary'],
  ] as const;

  it.each(CASES)('%s: the pill carries the word and the tone', (state, label, tone) => {
    row({ state, stateLabel: label });
    const pill = screen.getByText(label);
    expect(pill.className).toContain(tone);
    expect(pill.getAttribute('data-state')).toBe(state);
  });

  it('draws a different decorative glyph per state, aria-hidden, on the tertiary disc', () => {
    const glyphs = new Set<string>();
    for (const [state, label] of CASES) {
      const li = row({ state, stateLabel: label });
      const disc = li.querySelector('[data-event-glyph]') as HTMLElement;
      expect(disc.className).toContain('bg-bg-tertiary');
      expect(disc.className).toContain('h-10');
      expect(disc.className).toContain('w-10');
      const svg = disc.querySelector('svg') as SVGElement;
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      glyphs.add(svg.innerHTML);
      cleanup();
    }
    expect(glyphs.size).toBe(4);
  });

  it('paints only the applied glyph success; the other three are secondary text', () => {
    for (const [state, label] of CASES) {
      const li = row({ state, stateLabel: label });
      const svg = li.querySelector('[data-event-glyph] svg') as SVGElement;
      expect(svg.getAttribute('class')).toContain(
        state === 'applied' ? 'text-success' : 'text-text-secondary',
      );
      cleanup();
    }
  });
});

describe('EventRow: the text column (E07 populated, partial, overflow)', () => {
  it('prints name 14/700, e-mail, product and "recebido {when}" in that order', () => {
    const li = row();
    expect(li.textContent).toBe(
      'Compra aprovadaana@exemplo.com.brAssinatura mensalAplicadorecebido há 3 min',
    );
    expect(screen.getByText('Compra aprovada').className).toContain('font-bold');
    expect(screen.getByText('Compra aprovada').className).toContain('text-sm');
    expect(screen.getByText('recebido há 3 min').className).toContain('text-text-tertiary');
  });

  it('draws the effect line only when it is given, between the product and the pills', () => {
    const li = row({ effect: 'Acesso liberado' });
    const text = li.textContent ?? '';
    expect(text.indexOf('Assinatura mensal')).toBeLessThan(text.indexOf('Acesso liberado'));
    expect(text.indexOf('Acesso liberado')).toBeLessThan(text.indexOf('Aplicado'));
    cleanup();
    expect(row({ effect: null }).textContent).not.toContain('Acesso liberado');
    cleanup();
    expect(row({ effect: undefined }).textContent).not.toContain('Acesso liberado');
  });

  it('omits the product line when there is none (an ignored event with no product)', () => {
    const li = row({ product: null });
    expect(li.textContent).toBe('Compra aprovadaana@exemplo.com.brAplicadorecebido há 3 min');
  });

  it('truncates the e-mail and the product to one line each inside a min-w-0 column', () => {
    const longEmail = `${'a'.repeat(64)}@${'clinica-de-estetica-avancada'.repeat(3)}.com.br`;
    const longProduct = 'Curso de Harmonização Orofacial Avançada '.repeat(3).trim();
    row({ email: longEmail, product: longProduct });
    const email = screen.getByText(longEmail);
    const product = screen.getByText(longProduct);
    expect(email.className).toContain('truncate');
    expect(product.className).toContain('truncate');
    expect(email.parentElement?.className).toContain('min-w-0');
    expect(email.parentElement?.className).toContain('flex-1');
  });

  it('writes its text as plain React text, never markup', () => {
    const li = row({ email: '<img src=x onerror=alert(1)>', product: '<b>negrito</b>' });
    expect(li.querySelector('img')).toBeNull();
    expect(li.querySelector('b')).toBeNull();
  });
});

describe('EventRow: the action slot (E07 overflow, E07 long-text)', () => {
  it("draws the caller's action as a sibling of the text column that never shrinks", () => {
    const li = row({
      state: 'no_account',
      stateLabel: 'Sem conta',
      action: <button type="button">Liberar manualmente</button>,
    });
    const action = screen.getByRole('button', { name: 'Liberar manualmente' });
    const slot = action.parentElement as HTMLElement;
    expect(slot.parentElement).toBe(li);
    expect(slot.className).toContain('shrink-0');
    expect(slot.previousElementSibling?.className).toContain('min-w-0');
  });

  it('puts the action under the text column below 360px so the e-mail keeps its width (F-4)', () => {
    row({ action: <button type="button">Liberar manualmente</button> });
    const slot = screen.getByRole('button').parentElement as HTMLElement;
    expect(slot.className).toContain('max-[359px]:basis-full');
    expect(slot.className).toContain('max-[359px]:pl-13');
    expect(slot.parentElement?.className).toContain('flex-wrap');
  });

  it('draws no slot at all when there is no action', () => {
    const li = row();
    expect(li.children).toHaveLength(2);
  });
});

describe('EventRow: the row itself', () => {
  it('is the 72px row with the shipped rhythm and no half-step spacing of its own', () => {
    const li = row({ action: <button type="button">x</button> });
    expect(li.className).toContain('min-h-18');
    expect(li.className).toContain('px-4');
    expect(li.className).toContain('py-3');
    const own = [li, ...Array.from(li.querySelectorAll('*'))]
      .filter((el) => !el.closest('[data-state]'))
      .map((el) => el.getAttribute('class') ?? '')
      .join(' ');
    expect(own).not.toMatch(/(gap|p|m|px|py|mt|mb)-(0\.5|1\.5|2\.5|3\.5)/);
  });

  it('never renders anything beyond the strings it was given (no payload, signature or header)', () => {
    const li = row();
    expect(li.textContent).not.toMatch(/payload|signature|header|token/i);
  });
});

describe('EventRowSkeleton and the events skeleton (UI-D-528)', () => {
  it('draws the requested count in the row geometry, aria-busy, with no word', () => {
    const { container } = render(<EventRowSkeleton count={8} />);
    expect((container.firstElementChild as HTMLElement).getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('[data-event-skeleton-row]')).toHaveLength(8);
    expect(container.textContent).toBe('');
  });

  it('PaymentsSkeleton draws the frame and 8 event rows for the events variant', () => {
    const { container } = render(<PaymentsSkeleton variant="events" />);
    expect(container.querySelectorAll('[data-event-skeleton-row]')).toHaveLength(8);
    expect(container.querySelectorAll('[data-testid="payments-skeleton-tab"]')).toHaveLength(3);
    expect(container.textContent).toBe('');
  });
});
