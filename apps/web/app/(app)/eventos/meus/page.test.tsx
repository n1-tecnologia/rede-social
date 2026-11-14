// @vitest-environment happy-dom

import type { EventSummary } from '@rede-social/module-events/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 10.2-14 (D-790, OPEN-20, UI-D-788, A-UI-15) - the `Meus eventos` card of an event the member is in:
 * for a PAID event the note is the live count `Faltam 12 d 4 h 13 min`, running through the check-in window
 * until the start and handing over to `Acontecendo agora`; a FREE event, and a paid one with no seed, keep
 * the shipped `Faltam N dias` / `É hoje!`. The page is the RSC itself over the REAL catalog; the request
 * instant is pinned and the loaders are stubbed.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async () =>
      createTranslator({ locale: 'pt-BR', messages, namespace: 'events' }),
  };
});

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const tr = actual.createTranslator({ locale: 'pt-BR', messages, namespace: 'events' });
  return { ...actual, useTranslations: () => tr };
});

const state = vi.hoisted(() => ({ upcoming: [] as unknown[] }));

vi.mock('@/lib/bootstrap', () => ({
  requireBootstrap: async () => ({
    permissions: [],
    tenant: { id: 'tenant-1', timezone: 'America/Sao_Paulo', displayName: 'Rede Demo' },
    user: { id: 'user-1' },
  }),
}));
vi.mock('@/lib/events', () => ({
  loadEventSections: vi.fn(async () => ({ upcoming: state.upcoming, past: [] })),
  loadEvent: vi.fn(async () => ({ status: 'error' })),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('./CertificateButton', () => ({ CertificateButton: () => null }));

const { default: MyEventsPage } = await import('./page');

const NOW = '2026-10-01T12:00:00.000Z';
const SEED = '2026-10-01T12:00:00.000000Z';
// 12 d 4 h 13 min after the seed: Tuesday 13 Oct, 13:13 in São Paulo.
const STARTS = '2026-10-13T16:13:00.000000Z';
const ENDS = '2026-10-13T18:13:00.000000Z';

const summary = (overrides: Partial<EventSummary> = {}): EventSummary => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Encontro anual',
  format: 'online',
  category: null,
  capacity: null,
  venueName: null,
  address: null,
  coverAssetId: null,
  coverVariantWidths: [],
  startsAt: STARTS,
  endsAt: ENDS,
  status: 'active',
  viewerStatus: 'going',
  viewerCheckedInAt: null,
  confirmedCount: 1,
  presentCount: 0,
  paid: true,
  serverNow: SEED,
  ...overrides,
});

async function renderPage() {
  return render((await MyEventsPage()) as ReactElement);
}
const note = () => within(screen.getByTestId('mine-registered-card'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse(NOW));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Meus eventos: the holder count (10.2-14)', () => {
  it('a paid event the member is in draws the live count, one role=timer', async () => {
    state.upcoming = [summary()];
    await renderPage();
    expect(note().getByTestId('live-countdown-text').textContent).toBe('Faltam 12 d 4 h 13 min');
    expect(note().getAllByRole('timer')).toHaveLength(1);
  });

  it('the count runs through the check-in window and stops being drawn at the start', async () => {
    vi.setSystemTime(Date.parse('2026-10-13T15:43:00.000Z'));
    state.upcoming = [summary({ serverNow: '2026-10-13T15:43:00.000000Z' })];
    await renderPage();
    expect(note().getByTestId('live-countdown-text').textContent).toBe('Faltam 30 min');
    cleanup();
    vi.setSystemTime(Date.parse('2026-10-13T16:13:00.000Z'));
    state.upcoming = [summary({ serverNow: '2026-10-13T16:13:00.000000Z' })];
    await renderPage();
    // From the start the view model draws the shipped line (the plain `Faltam` count is over): no timer.
    expect(screen.queryByTestId('live-countdown-text')).toBeNull();
    expect(screen.queryAllByRole('timer')).toHaveLength(0);
  });

  it('a free event keeps Faltam N dias, and É hoje! on the day, with no timer', async () => {
    state.upcoming = [summary({ paid: false })];
    await renderPage();
    expect(screen.getByTestId('mine-registered-card').textContent).toContain('Faltam 12 dias');
    expect(screen.queryAllByRole('timer')).toHaveLength(0);
    cleanup();
    vi.setSystemTime(Date.parse('2026-10-13T12:00:00.000Z'));
    state.upcoming = [summary({ paid: false, serverNow: '2026-10-13T12:00:00.000000Z' })];
    await renderPage();
    expect(screen.getByTestId('mine-registered-card').textContent).toContain('É hoje!');
    expect(screen.queryAllByRole('timer')).toHaveLength(0);
  });

  it('a paid event with no seed keeps the shipped line and draws no count', async () => {
    state.upcoming = [summary({ serverNow: undefined })];
    await renderPage();
    expect(screen.getByTestId('mine-registered-card').textContent).toContain('Faltam 12 dias');
    expect(screen.queryByTestId('live-countdown-text')).toBeNull();
    expect(screen.queryAllByRole('timer')).toHaveLength(0);
  });
});
