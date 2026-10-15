// @vitest-environment happy-dom
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { contentTabView } from '@/lib/owner-content-view';
import type { DashboardT } from './format';
import { OwnerContentOverview } from './OwnerContentOverview';
import { OwnerContentPostDetail } from './OwnerContentPostDetail';
import { OwnerContentTypes } from './OwnerContentTypes';

/**
 * Conteúdo drawn by the member report's rules (the user's request of 2026-10-15) on the REAL pt-BR
 * catalog: every number card has its icon beside its name, no "exemplo" and no explanatory note,
 * every block a rising surface, the cards that open something wholly links.
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
  // any: the untyped test translator stands in for the app's typed DashboardT (BandMembers.test).
} as never) as unknown as DashboardT;

/** The notes and tags the member's rules took out of Conteúdo. */
const GONE = [
  'exemplo',
  'Comentários sem resposta da equipe há mais de 24 horas.',
  'A faixa é a de hoje',
  'Em risco e Inativos',
  'pelo dia e horário em que foi publicada',
  'Ver todas as publicações',
  'no Início, nos últimos 30 dias',
  'interações ÷ alcance',
  'Associação',
  'Só totais',
  'Métricas próprias',
  'Ver publicações',
];

function expectNoNotes(root: Element) {
  const text = root.textContent ?? '';
  for (const phrase of GONE) expect(text, phrase).not.toContain(phrase);
}

/** Every number card leads with its icon tile, the name beside it. */
function expectIcons(root: Element) {
  const cards = root.querySelectorAll('[data-kpi-card]');
  expect(cards.length).toBeGreaterThan(0);
  for (const card of cards) expect(card.querySelector('span[aria-hidden] svg')).not.toBeNull();
}

describe('Conteúdo on the member report rules', () => {
  it('Visão geral: six linked numbers with icons and the trend card, no notes or tags', () => {
    const { container } = render(<OwnerContentOverview t={t} view={contentTabView('overview')} />);
    expectNoNotes(container);
    expectIcons(container);
    // The six numbers and the trend card.
    expect(container.querySelectorAll('[data-kpi-card]')).toHaveLength(7);
    for (const slug of [
      'publicacoes',
      'interacoes',
      'taxa',
      'membros',
      'visualizacoes',
      'alcance',
    ]) {
      const link = container.querySelector(`a#numero-${slug}`);
      expect(link?.getAttribute('href'), slug).toBe(`/perfil?area=conteudo&numero=${slug}`);
      expect(link?.querySelector('[data-kpi-card]')).not.toBeNull();
      expect(link?.textContent).toContain('Ver lista');
    }
    // The trend's chart sits inside its card, at the report's fixed height.
    const chart = container.querySelector('[data-kpi-card] svg[role="img"]');
    expect(chart?.getAttribute('height')).toBe('150');
    // 7 days × 4 slots, each a counting value.
    const cells = container.querySelectorAll('[data-heat-cell]');
    expect(cells).toHaveLength(28);
    for (const cell of cells) expect(cell.querySelector('[data-countup]')).not.toBeNull();
    // Every card list rises one card after the other.
    expect(container.querySelectorAll('[data-dash-stagger]').length).toBeGreaterThanOrEqual(3);
  });

  it('Por tipo: six kind cards, each wholly a link with its icon and three counting numbers', () => {
    const { container } = render(<OwnerContentTypes t={t} view={contentTabView('types')} />);
    expectNoNotes(container);
    const kinds = container.querySelectorAll('[id^="tipo-"]');
    expect(kinds).toHaveLength(6);
    for (const kind of kinds) {
      const link = kind.querySelector('a');
      expect(link?.getAttribute('href')).toContain('vista=tipos&tipo=');
      expect(link?.querySelector('.dash-reveal svg')).not.toBeNull();
      expect(link?.querySelectorAll('dd [data-countup]')).toHaveLength(3);
    }
  });

  it('an opened kind shows its numbers as icon cards and its publications', () => {
    const { container } = render(
      <OwnerContentTypes t={t} view={{ ...contentTabView('types'), kind: 'video' }} />,
    );
    expectNoNotes(container);
    expectIcons(container);
    expect(container.querySelectorAll('[data-kpi-card]')).toHaveLength(3);
    expect(container.querySelectorAll('[id^="post-"]').length).toBeGreaterThan(0);
  });

  it('a video detail: linked interaction cards, charts inside their cards, no notes or tags', () => {
    const { container } = render(
      <OwnerContentPostDetail t={t} view={{ ...contentTabView('posts'), postId: 'op-11' }} />,
    );
    expectNoNotes(container);
    expectIcons(container);
    for (const who of ['curtidas', 'comentarios', 'salvamentos', 'compartilhamentos']) {
      const link = container.querySelector(`a#quem-${who}`);
      expect(link?.getAttribute('href'), who).toContain(`post=op-11&quem=${who}`);
      expect(link?.querySelector('[data-kpi-card]')).not.toBeNull();
    }
    // Primeiras 48 horas and Retenção: each line chart inside its number's card, 150 px high.
    const charts = container.querySelectorAll('[data-kpi-card] svg[role="img"]');
    expect(charts).toHaveLength(2);
    for (const chart of charts) expect(chart.getAttribute('height')).toBe('150');
    // The comments card opens who commented.
    const comments = container.querySelector('#comentarios a');
    expect(comments?.getAttribute('href')).toContain('post=op-11&quem=comentarios');
  });

  it('a story detail has its taps as icon cards and no saves', () => {
    const { container } = render(
      <OwnerContentPostDetail
        t={t}
        view={{ ...contentTabView('types'), kind: 'story', postId: 'os-02' }}
      />,
    );
    expectNoNotes(container);
    expectIcons(container);
    expect(container.querySelector('a#quem-salvamentos')).toBeNull();
    expect(container.textContent).toContain('Toques no story');
  });
});
