// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OwnerEvents } from './OwnerEvents';

/**
 * The level-4 "Eventos" area on the REAL pt-BR catalog (quick 261013-p31): the next events are the
 * bands' event cards, and the numbers of the area stay the ones it had.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  // Vitest runs from `apps/web` (the `ParticipantsList.test.tsx` precedent).
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async () =>
      createTranslator({ locale: 'pt-BR', messages, namespace: 'dashboard' } as never),
  };
});

afterEach(cleanup);

async function renderArea() {
  const { container } = render(await OwnerEvents());
  return container;
}

function exactly(root: Element, text: string): Element[] {
  return [...root.querySelectorAll('*')].filter((el) => el.textContent?.trim() === text);
}

/** The section under the `h3` reading exactly `title`. */
function section(root: Element, title: string): Element {
  const heading = [...root.querySelectorAll('h3')].find((el) => el.textContent?.trim() === title);
  const found = heading?.closest('section');
  if (!found) throw new Error(`no section ${title}`);
  return found;
}

/** The dd next to a card's dt `label`. */
function cell(root: Element, label: string): string | undefined {
  const term = [...root.querySelectorAll('dt')].find((el) => el.textContent?.trim() === label);
  return term?.nextElementSibling?.textContent?.trim();
}

describe('D-01/D-02 (quick 261013-p31): Próximos eventos são cartões de evento', () => {
  it('shows each next event as a cover card with Inscritos | Vagas | Receita', async () => {
    const upcoming = section(await renderArea(), 'Próximos eventos');
    const items = [...upcoming.querySelectorAll('li')];
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(
        item.querySelectorAll('[data-testid="event-cover-fallback"][data-geometry="hero"]'),
      ).toHaveLength(1);
    }
    expect(items.map((item) => item.querySelector('.text-xl')?.textContent?.trim())).toEqual([
      'Live de dúvidas',
      'Encontro mensal',
      'Imersão presencial',
    ]);
    for (const [i, pill] of ['Online', 'Presencial', 'Presencial'].entries()) {
      const item = items[i];
      if (!item) throw new Error(`no card ${i}`);
      expect(exactly(item, pill).length, String(i)).toBeGreaterThan(0);
    }
    for (const [i, when] of ['15/10, 20h', '17/10, 19h', '24/10, 9h'].entries()) {
      const item = items[i];
      if (!item) throw new Error(`no card ${i}`);
      const line = exactly(item, when)[0];
      expect(line?.classList.contains('text-text-secondary'), String(i)).toBe(true);
    }
    const [u2, u1, u3] = items;
    if (!u1 || !u2 || !u3) throw new Error('missing cards');
    expect(cell(u1, 'Inscritos')).toBe('92');
    expect(cell(u1, 'Vagas')).toBe('8');
    expect(cell(u1, 'Receita')).toMatch(/^R\$\s?5,5\s?mil$/);
    expect(cell(u2, 'Inscritos')).toBe('64');
    expect(cell(u2, 'Vagas')).toBe('Sem limite');
    expect(cell(u2, 'Receita')).toBe('Gratuito');
    expect(cell(u3, 'Inscritos')).toBe('40');
    expect(cell(u3, 'Vagas')).toBe('Lotado');
    expect(cell(u3, 'Receita')).toMatch(/^R\$\s?14\s?mil$/);
  });

  it('promises no navigation and tags no receita as an example', async () => {
    const upcoming = section(await renderArea(), 'Próximos eventos');
    expect(upcoming.querySelectorAll('table')).toHaveLength(0);
    expect(upcoming.querySelectorAll('a')).toHaveLength(0);
    expect(upcoming.querySelectorAll('.hover\\:bg-card-hover')).toHaveLength(0);
    expect(upcoming.textContent).not.toContain('exemplo');
  });

  it('rises the cards one after the other, each one panel surface', async () => {
    const upcoming = section(await renderArea(), 'Próximos eventos');
    const list = upcoming.querySelector('ul');
    expect(list?.hasAttribute('data-dash-stagger')).toBe(true);
    for (const item of upcoming.querySelectorAll('li')) {
      expect(item.querySelectorAll('.dash-reveal')).toHaveLength(1);
    }
  });
});

/** The KPI card whose label reads exactly `label`. */
function kpi(root: Element, label: string): Element {
  const found = [...root.querySelectorAll('[data-kpi-card]')].find((card) =>
    exactly(card, label).some((el) => el.tagName === 'SPAN'),
  );
  if (!found) throw new Error(`no card ${label}`);
  return found;
}

describe('the member report look (2026-10-15): icon, label and number, no notes', () => {
  it('puts who got a seat and who came beside the waiting list, out of their totals', async () => {
    const waiting = section(await renderArea(), 'Lista de espera');
    const cards = [...waiting.querySelectorAll('[data-kpi-card]')];
    expect(cards).toHaveLength(2);
    for (const card of cards) expect(card.querySelector('svg')).not.toBeNull();
    for (const [label, value, unit] of [
      ['Conseguiram vaga', '15', 'de 67'],
      ['Foram ao evento', '10', 'de 13'],
    ] as const) {
      const card = kpi(waiting, label);
      expect(card.querySelector('[data-countup]')?.textContent, label).toBe(value);
      expect(exactly(card, unit).length, label).toBeGreaterThan(0);
    }
  });

  it('drops the sentences around the numbers', async () => {
    const text = (await renderArea()).textContent ?? '';
    for (const sentence of [
      'pessoas entraram na espera',
      'quando alguém desistiu',
      'que conseguiram vaga em eventos',
      'Encontro set.: 100 vagas',
      'Presenças ÷ inscritos',
      'teve o maior comparecimento',
      'Cada presença conta',
      'valores de exemplo',
    ]) {
      expect(text, sentence).not.toContain(sentence);
    }
  });
});

/** A collapsible's `<details>`, by its summary's exact bold title (closed details stay in the DOM). */
function details(root: Element, title: string): Element {
  const found = [...root.querySelectorAll('details')].find(
    (el) => el.querySelector('summary span.font-bold')?.textContent?.trim() === title,
  );
  if (!found) throw new Error(`no details ${title}`);
  return found;
}

/** Each bar row must carry exactly one decorative 16:10 cover thumbnail; returns the rows. */
function thumbedRows(list: Element, count: number): HTMLLIElement[] {
  const thumbs = [...list.querySelectorAll('[data-event-thumb]')];
  expect(thumbs).toHaveLength(count);
  for (const thumb of thumbs) {
    expect(thumb.getAttribute('aria-hidden')).toBe('true');
    for (const name of ['aspect-[16/10]', 'h-14', 'rounded-lg']) {
      expect(thumb.classList.contains(name), name).toBe(true);
    }
    expect(
      thumb.querySelectorAll('[data-testid="event-cover-fallback"][data-geometry="hero"]'),
    ).toHaveLength(1);
  }
  const items = [...list.querySelectorAll('li')];
  expect(items).toHaveLength(count);
  for (const item of items) expect(item.querySelectorAll('[data-event-thumb]')).toHaveLength(1);
  return items;
}

describe('D-01/D-03 (quick 261013-p31): miniatura nas listas de comparação', () => {
  it('puts a cover thumbnail on each Lista de espera bar, most waited first', async () => {
    const items = thumbedRows(section(await renderArea(), 'Lista de espera'), 3);
    const expected: [string, string, string][] = [
      ['Encontro set.', '38 na espera', '100 vagas'],
      ['Imersão presencial', '17 na espera', '40 vagas'],
      ['Workshop', '12 na espera', '50 vagas'],
    ];
    for (const [i, [name, waiting, capacity]] of expected.entries()) {
      const text = items[i]?.textContent ?? '';
      expect(text, String(i)).toContain(name);
      expect(text, String(i)).toContain(waiting);
      expect(text, String(i)).toContain(capacity);
    }
  });

  it('anchors each Lista de espera row by its event (quick 261014-ia8 F-1)', async () => {
    const items = [...section(await renderArea(), 'Lista de espera').querySelectorAll('li')];
    expect(items.map((item) => item.id)).toEqual(['espera-e1', 'espera-u3', 'espera-e3']);
    expect(items[1]?.textContent).toContain('17 na espera');
  });

  it('puts a cover thumbnail on each Comparecimento por evento bar', async () => {
    const items = thumbedRows(details(await renderArea(), 'Comparecimento por evento'), 4);
    const expected: [string, string][] = [
      ['Encontro set.', '82%'],
      ['Live de dúvidas', '58%'],
      ['Workshop', '64%'],
      ['Aula aberta', '49%'],
    ];
    for (const [i, [name, percent]] of expected.entries()) {
      const text = items[i]?.textContent ?? '';
      expect(text, String(i)).toContain(name);
      expect(text, String(i)).toContain(percent);
    }
    expect(items[0]?.textContent).toContain('82 de 100');
  });

  it('leaves the lists that name no event without thumbnails', async () => {
    const container = await renderArea();
    for (const title of ['Presencial × online', 'Quem vai aos eventos']) {
      expect(details(container, title).querySelectorAll('[data-event-thumb]'), title).toHaveLength(
        0,
      );
    }
  });
});

describe('D-04 (quick 261013-p31): the area keeps its numbers', () => {
  it('has no "exemplo" pill (user decision, 2026-10-12) and the same summaries', async () => {
    const container = await renderArea();
    expect(exactly(container, 'exemplo')).toHaveLength(0);
    expect(container.textContent).toContain('comparecimento 64%');
    expect(container.textContent).toContain('presencial 76% · online 56%');
  });
});
