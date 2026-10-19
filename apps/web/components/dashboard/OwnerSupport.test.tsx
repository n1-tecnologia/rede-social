// @vitest-environment happy-dom
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OwnerSupportReady } from '@rede-social/module-dashboard/contracts';
import { cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { DashboardT } from './format';
import { OwnerAreaState } from './OwnerAreaState';
import { OwnerSupport, OwnerSupportView } from './OwnerSupport';
import { contentSnapshot } from './owner-content-test-data';

/**
 * The level-4 "Atendimento" area on the API answer (08.7-11, D-455, D-460, D-461, D-465, UI-D-474,
 * UI-D-476, UI-D-480, UI-D-481, INSIGHT-13, EP-42) and the REAL pt-BR catalog: the queue "na última
 * atualização" as a card linked to `/suporte`, the weekly first-response median with gaps for weeks
 * with no answered turn, conversations per week, the team with the staff names as stored, moderation
 * with its removal rate, and "Atendimentos por assunto" as an "Em breve" block. No sample value.
 */

const loaders = vi.hoisted(() => ({
  support: { status: 'error' } as Record<string, unknown>,
}));

vi.mock('@/lib/dashboard', () => ({
  getOwnerSupport: async () => loaders.support,
}));

const { messages } = await vi.hoisted(async () => {
  const { loadMessages: load } = await import('@/i18n/messages');
  const { join: joinPath } = await import('node:path');
  return { messages: load(joinPath(process.cwd(), 'messages', 'pt-BR')) };
});

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async () =>
      createTranslator({ locale: 'pt-BR', messages, namespace: 'dashboard' } as never),
  };
});

// A path join, not `new URL(…, import.meta.url)`: happy-dom replaces the global URL.
const catalogDir = join(dirname(fileURLToPath(import.meta.url)), '../../messages/pt-BR/');
const { createTranslator } = await import('next-intl');
const t = createTranslator({
  locale: 'pt-BR',
  messages: loadMessages(catalogDir) as Record<string, unknown>,
  namespace: 'dashboard',
} as never) as unknown as DashboardT;

afterEach(cleanup);

const TZ = 'America/Sao_Paulo';
const NOW = Date.parse('2026-10-18T15:00:00Z');
const STAFF_A = '11111111-1111-4111-8111-111111111111';
const STAFF_B = '22222222-2222-4222-8222-222222222222';

const READY: OwnerSupportReady = {
  state: 'ready',
  snapshot: contentSnapshot(NOW),
  awaiting: { count: 3, oldestHours: 26 },
  weeklyMedianMinutes: [null, 45, null, 30, 20, null, 60, 30],
  weeklyConversations: [1, 2, 0, 1, 3, 0, 4, 2],
  answeredByStaff: [
    { userId: STAFF_B, name: 'Bruno', conversations: 2 },
    { userId: STAFF_A, name: 'Ana  da Equipe', conversations: 5 },
  ],
  bySubject: { measured: false, reason: 'needs_support_subject' },
  moderation: { removedComments: 2, blocks: 1, unblocks: 0, comments30: 40 },
};

const EMPTY: OwnerSupportReady = {
  ...READY,
  awaiting: { count: 0, oldestHours: null },
  weeklyMedianMinutes: Array(8).fill(null),
  weeklyConversations: Array(8).fill(0),
  answeredByStaff: [],
  moderation: { removedComments: 0, blocks: 0, unblocks: 0, comments30: 0 },
};

function view(answer: OwnerSupportReady = READY) {
  return render(<OwnerSupportView t={t} answer={answer} />).container;
}

/** The section under the `h3` reading exactly `title`. */
function section(root: Element, title: string): Element {
  const heading = [...root.querySelectorAll('h3')].find((el) => el.textContent?.trim() === title);
  const found = heading?.closest('section');
  if (!found) throw new Error(`no section ${title}`);
  return found;
}

/** A collapsible's `<details>`, by its summary's exact bold title (closed details stay in the DOM). */
function details(root: Element, title: string): Element | undefined {
  return [...root.querySelectorAll('details')].find(
    (el) => el.querySelector('summary span.font-bold')?.textContent?.trim() === title,
  );
}

/** A KPI card's value text, by its label. */
function kpiValue(root: Element, label: string): string | undefined {
  const card = [...root.querySelectorAll('[data-kpi-card]')].find((el) =>
    el.textContent?.includes(label),
  );
  return card?.querySelector('span.tabular-nums [data-countup]')?.textContent?.trim();
}

describe('the queue at the last update (UI-D-476, UI-D-480, INSIGHT-21)', () => {
  it('is titled "Fila na última atualização", never "agora"', () => {
    const root = view();
    expect(section(root, 'Fila na última atualização')).toBeTruthy();
    expect(root.textContent).not.toMatch(/agora/i);
  });

  it('links "Aguardando resposta" to the support inbox with the verb "Responder no atendimento"', () => {
    const queue = section(view(), 'Fila na última atualização');
    const links = [...queue.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    const link = links[0];
    expect(link?.getAttribute('href')).toBe('/suporte');
    expect(link?.textContent).toContain('Aguardando resposta');
    expect(link?.textContent).toContain('Responder no atendimento');
    expect(kpiValue(queue, 'Aguardando resposta')).toBe('3');
    expect(kpiValue(queue, 'Espera mais antiga')).toBe('26 h');
  });
});

describe('the first response and the weekly conversations (planning decision 2, UI-D-481)', () => {
  it('shows the last week’s median with its change against the week before', () => {
    const first = section(view(), 'Tempo da 1ª resposta');
    expect(kpiValue(first, 'Mediana da semana')).toBe('0h30');
    const chip = first.querySelector('[title]');
    expect(chip?.getAttribute('title')).toBe('30 min em relação à semana anterior');
  });

  it('draws the median chart with gaps for the weeks with no answered turn, never 0', () => {
    const first = section(view(), 'Tempo da 1ª resposta');
    const line = first.querySelector('[data-series="current"]')?.getAttribute('d') ?? '';
    // [null, 45, null, 30, 20, null, 60, 30]: three runs of defined points.
    expect(line.match(/M/g)).toHaveLength(3);
  });

  it('shows no change when either of the last two weeks has no answered turn', () => {
    const answer = { ...READY, weeklyMedianMinutes: [null, 45, null, 30, 20, null, null, 30] };
    const first = section(view(answer), 'Tempo da 1ª resposta');
    expect(first.querySelector('[title]')).toBeNull();
  });

  it('lists the conversations per week in its closed block, the last four weeks summed', () => {
    const volume = details(view(), 'Atendimentos por semana');
    expect(volume?.querySelector('summary')?.textContent).toContain('9 nas últimas 4 semanas');
    expect(volume?.querySelectorAll('[data-series="current"]')).toHaveLength(1);
  });
});

describe('the team, the subjects and moderation (D-465, UI-D-474)', () => {
  it('lists the team most first with each name exactly as the API sent it', () => {
    const team = details(view(), 'Equipe');
    const labels = [...(team?.querySelectorAll('li') ?? [])].map(
      (row) => row.querySelector('span')?.textContent ?? '',
    );
    expect(labels).toEqual(['Ana  da Equipe', 'Bruno']);
    expect(team?.querySelector('summary')?.textContent).toContain(
      '7 conversas respondidas por 2 pessoas em 30 dias',
    );
  });

  it('shows "Atendimentos por assunto" as a dashed Em breve block, not expandable', () => {
    const root = view();
    expect(details(root, 'Atendimentos por assunto')).toBeUndefined();
    const block = [...root.querySelectorAll('[data-coming-soon-block]')].find((el) =>
      el.textContent?.includes('Atendimentos por assunto'),
    );
    expect(block?.textContent).toContain('Em breve');
    expect(block?.querySelector('svg')).toBeNull();
    expect(block?.closest('details')).toBeNull();
  });

  it('shows removed comments of the live ones, the removal rate, blocks and unblocks', () => {
    const moderation = details(view(), 'Moderação');
    if (!moderation) throw new Error('no Moderação');
    expect(kpiValue(moderation, 'Comentários removidos')).toBe('2');
    expect(moderation.textContent).toContain('de 40');
    expect(kpiValue(moderation, 'Taxa de remoção')).toBe('5,0%');
    expect(kpiValue(moderation, 'Bloqueios')).toBe('1');
    expect(kpiValue(moderation, 'Desbloqueios')).toBe('0');
    expect(moderation.querySelector('summary')?.textContent).toContain('taxa de remoção 5,0%');
  });
});

describe('an empty tenant (EP-42, UI-D-481)', () => {
  it('renders the two empty sentences and the 0 tiles', () => {
    const root = view(EMPTY);
    expect(root.textContent).toContain('Nenhuma conversa respondida nas últimas 8 semanas.');
    expect(root.textContent).toContain(
      'Nenhuma conversa respondida pela equipe nos últimos 30 dias.',
    );
    const queue = section(root, 'Fila na última atualização');
    expect(kpiValue(queue, 'Aguardando resposta')).toBe('0');
    const moderation = details(root, 'Moderação');
    if (!moderation) throw new Error('no Moderação');
    expect(kpiValue(moderation, 'Comentários removidos')).toBe('0');
    expect(kpiValue(moderation, 'Bloqueios')).toBe('0');
    expect(kpiValue(moderation, 'Desbloqueios')).toBe('0');
  });

  it('draws no median chart and no removal rate without data', () => {
    const root = view(EMPTY);
    const first = section(root, 'Tempo da 1ª resposta');
    expect(first.querySelector('[data-series="current"]')).toBeNull();
    const moderation = details(root, 'Moderação');
    expect(kpiValue(moderation as Element, 'Taxa de remoção')).toBeUndefined();
  });
});

describe('OwnerSupport reads GET /v1/dashboard/owner/support (D-460, UI-D-469, UI-D-479)', () => {
  it('renders nothing when the chat module is off (MODULE_DISABLED), Moderação included', async () => {
    loaders.support = { status: 'disabled' };
    expect(await OwnerSupport({ timeZone: TZ })).toBeNull();
  });

  it('shows the area error card on a failed read, and the preparing card before the first build', async () => {
    loaders.support = { status: 'error' };
    const error = (await OwnerSupport({ timeZone: TZ })) as ReactElement<{ kind: string }>;
    expect(error.type).toBe(OwnerAreaState);
    expect(error.props.kind).toBe('error');
    loaders.support = { status: 'ok', answer: { state: 'preparing' } };
    const preparing = (await OwnerSupport({ timeZone: TZ })) as ReactElement<{ kind: string }>;
    expect(preparing.type).toBe(OwnerAreaState);
    expect(preparing.props.kind).toBe('preparing');
  });

  it('puts the freshness line first, then the area on the answer', async () => {
    loaders.support = { status: 'ok', answer: READY };
    const { container } = render((await OwnerSupport({ timeZone: TZ })) as ReactElement);
    expect(container.firstElementChild?.hasAttribute('data-snapshot-freshness')).toBe(true);
    expect(section(container, 'Fila na última atualização')).toBeTruthy();
  });
});
