// @vitest-environment happy-dom
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EngagementBands } from '@rede-social/module-dashboard/fixtures';
import { tenantOwnerPanel } from '@rede-social/module-dashboard/fixtures';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { OwnerMembersView } from '@/lib/owner-band-scope';
import { BandMembers } from './BandMembers';
import type { DashboardT } from './format';

/**
 * The level-4 band bodies (quick 261012-qer) on the REAL pt-BR catalog: each member is a card
 * (B-1), a share that rounds to 0% reads "menos de 1%" with a visible bar (A-1), a band over 10
 * says the list is capped (A-3), and a 0-member band opens to one sentence (A-4). Drawn as the
 * member report's cards: the panels' surface that rises in, a whole-card link that lifts, the
 * numbers counting, no notes and no "exemplo" anywhere.
 */

afterEach(cleanup);

// A path join, not `new URL(…, import.meta.url)`: happy-dom replaces the global URL.
const catalogDir = join(dirname(fileURLToPath(import.meta.url)), '../../messages/pt-BR/');
const messages = loadMessages(catalogDir) as Record<string, unknown>;
const { createTranslator } = await import('next-intl');
const t = createTranslator({
  locale: 'pt-BR',
  messages,
  namespace: 'dashboard',
} as never) as unknown as DashboardT;

type BandView = Pick<OwnerMembersView, 'kind' | 'band' | 'itemId'>;

const MEMBER: BandView = { kind: 'member', band: null, itemId: null };
const COMMUNITIES: BandView = { kind: 'community', band: null, itemId: null };
const AREA = '/perfil?area=membros';

function eventosBands(): EngagementBands {
  const entry = tenantOwnerPanel.communityEngagement.find((row) => row.id === 'c-eventos');
  if (!entry) throw new Error('no c-eventos bands');
  return entry.bands;
}

function renderBands(bands: EngagementBands, view: BandView) {
  const { container } = render(<BandMembers t={t} bands={bands} view={view} />);
  return container;
}

/** A band's `<details>`, by its summary's exact bold title (closed details stay in the DOM). */
function band(container: HTMLElement, label: string): HTMLDetailsElement {
  const details = [...container.querySelectorAll('details')].find(
    (el) => el.querySelector('summary span.font-bold')?.textContent?.trim() === label,
  );
  if (!details) throw new Error(`no band ${label}`);
  return details;
}

function bar(details: HTMLDetailsElement): Element {
  const inner = details.querySelector('summary span[aria-hidden="true"] > span');
  if (!inner) throw new Error('no share bar');
  return inner;
}

function seeAll(details: HTMLDetailsElement): HTMLButtonElement | undefined {
  return [...details.querySelectorAll('button')].find((el) => el.textContent === 'Ver todos');
}

/** The elements whose whole text is exactly `text`. */
function exactly(root: Element, text: string): Element[] {
  return [...root.querySelectorAll('*')].filter((el) => el.textContent?.trim() === text);
}

function firstCard(container: HTMLElement): HTMLLIElement {
  const first = band(container, 'Novos').querySelector('li');
  if (!first) throw new Error('no member card');
  return first;
}

describe('B-1: each member is a card', () => {
  it('shows initials, the bold name and four labeled lines', () => {
    const first = firstCard(renderBands(tenantOwnerPanel.engagement, MEMBER));
    const text = first.textContent ?? '';
    for (const part of [
      'Luana Ferraz',
      'Membro desde: set. de 2026',
      'Última atividade: hoje às 22:40',
      'Comunidade que mais interage: Geral',
      'Tempo médio diário: 18 min',
    ]) {
      expect(text, part).toContain(part);
    }
    expect(text).not.toContain('exemplo');
    const avatar = first.querySelector('[aria-hidden="true"]');
    expect(avatar?.textContent).toBe('LF');
  });
});

describe('R-1 (quick 261012-ri4): the card as the user drew it', () => {
  it('has a 48 px avatar, a large bold name and legible lines', () => {
    const first = firstCard(renderBands(tenantOwnerPanel.engagement, MEMBER));
    const avatar = first.querySelector('[aria-hidden="true"]');
    expect(avatar?.classList.contains('size-12')).toBe(true);
    const [name] = exactly(first, 'Luana Ferraz');
    expect(name?.classList.contains('text-lg')).toBe(true);
    expect(name?.classList.contains('font-bold')).toBe(true);
    const terms = [...first.querySelectorAll('dt')];
    const values = [...first.querySelectorAll('dd')];
    expect(terms).toHaveLength(4);
    expect(values).toHaveLength(4);
    for (const dt of terms) {
      expect(dt.classList.contains('text-text-secondary'), dt.textContent ?? '').toBe(true);
      expect(dt.parentElement?.classList.contains('text-sm'), dt.textContent ?? '').toBe(true);
    }
    for (const dd of values) {
      expect(dd.classList.contains('text-text'), dd.textContent ?? '').toBe(true);
    }
  });
});

describe('R-3 (quick 261012-ri4): the card shows that it opens', () => {
  it('ends with one hidden arrow, and the link keeps the member name', () => {
    const first = firstCard(renderBands(tenantOwnerPanel.engagement, MEMBER));
    const link = first.querySelector('a');
    expect(link?.textContent).toContain('Luana Ferraz');
    const icons = link ? [...link.querySelectorAll('svg')] : [];
    expect(icons).toHaveLength(1);
    expect(icons[0]?.getAttribute('aria-hidden')).toBe('true');
    const column = exactly(first, 'Luana Ferraz')[0]?.parentElement;
    expect(column, 'text column').toBeDefined();
    if (column && icons[0]) {
      expect(
        column.compareDocumentPosition(icons[0]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });
});

describe('R-2 (quick 261012-ri4): no "exemplo" on a list (user decision, 2026-10-12)', () => {
  it('heads an opened band with no example line and no pill', () => {
    const novos = band(renderBands(tenantOwnerPanel.engagement, MEMBER), 'Novos');
    expect(novos.textContent).not.toContain('exemplo');
    expect(novos.textContent).not.toContain('valores de exemplo');
  });
});

describe('the member report card rules', () => {
  it('draws each member card on the rising surface inside a lifting whole-card link', () => {
    const first = firstCard(renderBands(tenantOwnerPanel.engagement, MEMBER));
    const link = first.querySelector('a');
    expect(link?.classList.contains('group/link')).toBe(true);
    const surface = link?.firstElementChild;
    expect(surface?.classList.contains('dash-reveal'), 'RISE').toBe(true);
    expect(surface?.classList.contains('rounded-2xl'), 'SURFACE').toBe(true);
    expect(surface?.className, 'LIFT').toContain('group-hover/link:-translate-y-0.5');
  });

  it('lays the member cards on a staggered grid that uses the width', () => {
    const list = band(renderBands(tenantOwnerPanel.engagement, MEMBER), 'Em risco').querySelector(
      'ul',
    );
    expect(list?.hasAttribute('data-dash-stagger')).toBe(true);
    expect(list?.className).toContain('@4xl:grid-cols-2');
    expect(list?.className).toContain('@min-[100rem]:grid-cols-3');
  });

  it('counts the card numbers up (CountUp) and widens the summary bar on the web', () => {
    const container = renderBands(tenantOwnerPanel.engagement, {
      kind: 'community',
      band: 'engaged',
      itemId: null,
    });
    const engaged = band(container, 'Engajados');
    const [vip] = engaged.querySelectorAll('li');
    if (!vip) throw new Error('no VIP card');
    const values = [...vip.querySelectorAll('dd')];
    expect(values.length).toBe(4);
    for (const dd of values)
      expect(dd.querySelector('[data-countup]'), dd.textContent ?? '').not.toBeNull();
    expect(bar(engaged).parentElement?.className).toContain('@4xl:w-40');
  });
});

describe('A-1: a share that rounds to 0% with members', () => {
  it('reads "menos de 1%" and keeps a visible bar', () => {
    const container = renderBands(eventosBands(), COMMUNITIES);
    const superfans = band(container, 'Superfãs');
    expect(superfans.querySelector('summary')?.textContent).toContain('3 · menos de 1%');
    expect(band(container, 'Novos').querySelector('summary')?.textContent).toContain('96 · 8%');
    expect(bar(superfans).classList.contains('min-w-1.5')).toBe(true);
  });
});

describe('A-3: a band over 10 says the list is capped', () => {
  it('heads the list with the cap and ends with a disabled Ver todos', () => {
    const container = renderBands(tenantOwnerPanel.engagement, MEMBER);
    const atRisk = band(container, 'Em risco');
    const hint = [...atRisk.querySelectorAll('p')].find(
      (el) => el.textContent === 'Os 10 com atividade mais recente',
    );
    const list = atRisk.querySelector('ul');
    expect(hint, 'cap hint').toBeDefined();
    expect(list, 'list').not.toBeNull();
    if (hint && list) {
      expect(hint.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(atRisk.textContent).toContain('e mais 158 membros');
    expect(seeAll(atRisk)?.disabled).toBe(true);
  });

  it('says nothing of a cap when the band fits', () => {
    const container = renderBands(tenantOwnerPanel.engagement, {
      kind: 'community',
      band: 'superfan',
      itemId: 'c-eventos',
    });
    const superfans = band(container, 'Superfãs');
    expect(superfans.querySelectorAll('li')).toHaveLength(3);
    expect(superfans.textContent).not.toContain('Os 10 com atividade mais recente');
    // "Comunidade que mais interage" holds "mais" too: only "e mais <n>" is the overflow line.
    expect(superfans.textContent).not.toMatch(/e mais \d/);
    expect(seeAll(superfans)).toBeUndefined();
  });
});

describe('A-4: a band with no members', () => {
  it('opens to one sentence, with no list, cap or button, and no bar', () => {
    const { engagement } = tenantOwnerPanel;
    const empty: EngagementBands = {
      ...engagement,
      counts: { ...engagement.counts, at_risk: 0 },
    };
    const container = renderBands(empty, MEMBER);
    const atRisk = band(container, 'Em risco');
    expect(atRisk.querySelector('summary')?.textContent).toContain('0 · 0%');
    expect(bar(atRisk).classList.contains('min-w-1.5')).toBe(false);
    const body = atRisk.querySelector('summary + div');
    expect(body?.textContent).toBe('Nenhum membro nesta faixa.');
    expect(atRisk.querySelectorAll('li')).toHaveLength(0);
    expect(atRisk.querySelectorAll('button')).toHaveLength(0);
    expect(atRisk.textContent).not.toContain('exemplo');
  });
});

/** The dd next to a card's dt `label`. */
function cell(root: Element, label: string): string | undefined {
  const term = [...root.querySelectorAll('dt')].find((el) => el.textContent?.trim() === label);
  return term?.nextElementSibling?.textContent?.trim();
}

describe('D-02/D-03 (quick 261012-tru): a band opened in Por comunidade lists community cards', () => {
  const container = () =>
    renderBands(tenantOwnerPanel.engagement, { kind: 'community', band: 'engaged', itemId: null });

  it('shows the four communities, each a linked card with a 16:7 cover and its band count', () => {
    const engaged = band(container(), 'Engajados');
    const items = [...engaged.querySelectorAll('li')];
    expect(items).toHaveLength(4);
    const slugs = ['vip', 'geral', 'iniciantes', 'eventos'];
    for (const [i, count] of [61, 150, 38, 22].entries()) {
      const item = items[i];
      if (!item) throw new Error(`no card ${i}`);
      expect(item.querySelectorAll('[data-geometry="card"]'), String(i)).toHaveLength(1);
      expect(exactly(item, `${count} nesta faixa`).length, String(i)).toBeGreaterThan(0);
      expect(item.querySelector('a')?.getAttribute('href')).toBe(
        `${AREA}&recorte=comunidade&comunidade=${slugs[i]}&faixa=engajados#faixas`,
      );
    }
  });

  it('draws the VIP card as designed: name, description and four columns, no note', () => {
    const [vip] = band(container(), 'Engajados').querySelectorAll('li');
    if (!vip) throw new Error('no VIP card');
    const [name] = exactly(vip, 'Comunidade VIP');
    expect(name?.classList.contains('text-xl')).toBe(true);
    expect(name?.classList.contains('font-bold')).toBe(true);
    expect(cell(vip, 'Membros')).toBe('186');
    expect(cell(vip, 'Ativos na semana')).toBe('104');
    expect(cell(vip, 'Publicações no mês')).toBe('22');
    expect(cell(vip, 'Interações no mês')).toBe('1.650');
    expect(vip.textContent).not.toContain('Interações: comentários e curtidas');
    expect(vip.textContent).toContain('Aulas, lives e materiais exclusivos para quem é VIP.');
  });
});

describe('D-02/D-04 (quick 261012-tru): a band opened in Por evento lists event cards', () => {
  it('shows the seven events with a 16:10 cover and no revenue example line', () => {
    const engaged = band(
      renderBands(tenantOwnerPanel.engagement, { kind: 'event', band: 'engaged', itemId: null }),
      'Engajados',
    );
    expect(engaged.querySelectorAll('li')).toHaveLength(7);
    expect(engaged.querySelectorAll('[data-geometry="hero"]')).toHaveLength(7);
    expect(exactly(engaged, 'exemplo')).toHaveLength(0);
    expect(engaged.textContent).not.toContain('valores de exemplo');
    const u1 = [...engaged.querySelectorAll('li')].find((item) =>
      item.textContent?.includes('Encontro mensal'),
    );
    if (!u1) throw new Error('no u1 card');
    expect(u1.textContent).toContain('Presencial');
    expect(cell(u1, 'Data')).toBe('17/10');
    expect(cell(u1, 'Duração')).toBe('3h00');
    expect(cell(u1, 'Receita')).toMatch(/^R\$\s?5,5\s?mil$/);
    expect(exactly(u1, '34 nesta faixa').length).toBeGreaterThan(0);
  });

  it('leaves a card with nobody in the band unlinked', () => {
    const inactive = band(
      renderBands(tenantOwnerPanel.engagement, { kind: 'event', band: 'inactive', itemId: null }),
      'Inativos',
    );
    const items = [...inactive.querySelectorAll('li')];
    expect(items).toHaveLength(7);
    for (const item of items) expect(exactly(item, '0 nesta faixa').length).toBeGreaterThan(0);
    expect(inactive.querySelectorAll('a')).toHaveLength(0);
  });
});

describe('D-05 (quick 261012-tru): an opened community lists its members in the band', () => {
  it('goes back to the cards, shows the unlinked card, then the members', () => {
    const engaged = band(
      renderBands(tenantOwnerPanel.engagement, {
        kind: 'community',
        band: 'engaged',
        itemId: 'c-vip',
      }),
      'Engajados',
    );
    const back = [...engaged.querySelectorAll('a')].find(
      (el) => el.textContent?.trim() === 'Voltar às comunidades',
    );
    expect(back?.getAttribute('href')).toBe(`${AREA}&recorte=comunidade&faixa=engajados#faixas`);
    const covers = [...engaged.querySelectorAll('[data-geometry="card"]')];
    expect(covers).toHaveLength(1);
    expect(covers[0]?.closest('a')).toBeNull();
    expect(engaged.querySelectorAll('li')).toHaveLength(10);
    expect(engaged.textContent).toContain('e mais 51 membros');
    expect(engaged.textContent).toContain('Engajados em Comunidade VIP');
  });
});
