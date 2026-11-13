// @vitest-environment happy-dom
import type { EventDetail } from '@rede-social/module-events/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 10.1-14 (D-751, UI-D-757 a) — the manage card of the event detail: the "Acima do limite" pill under
 * the Participantes sub-line. The page is rendered from the RSC itself with its loaders and bootstrap mocked
 * and the REAL `events.json`; the client islands that have their own suites are stubbed, because only the
 * manage card is under test here.
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

const state = vi.hoisted(() => ({
  permissions: [] as string[],
  event: null as unknown,
}));

vi.mock('@/lib/bootstrap', () => ({
  requireBootstrap: async () => ({
    permissions: state.permissions,
    tenant: { id: 'tenant-1', timezone: 'America/Sao_Paulo', displayName: 'Rede Demo' },
    user: { id: 'user-1' },
  }),
}));

vi.mock('@/lib/events', () => ({
  loadEvent: vi.fn(async () => ({ status: 'ok', event: state.event })),
  loadEventPhotos: vi.fn(async () => null),
}));

vi.mock('@/lib/tenant-host', () => ({ primaryHostOrigin: async () => 'https://rede.test' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// Islands with their own suites: only the manage card matters here.
vi.mock('./EventActions', () => ({ EventActions: () => null }));
vi.mock('./EventPhotos', () => ({ EventPhotos: () => null }));
vi.mock('./EventLocationMap', () => ({ EventLocationMap: () => null }));
vi.mock('./EventSchedule', () => ({ EventSchedule: () => null }));
vi.mock('./EventRefresh', () => ({
  EventRefresh: ({ children }: { children: ReactElement }) => children,
}));
vi.mock('./DeleteEventControl', () => ({ DeleteEventControl: () => null }));
vi.mock('./ReactivateEventControl', () => ({ ReactivateEventControl: () => null }));

const { default: EventPage } = await import('./page');

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN = ['events.event.manage', 'events.attendance.read'];

const detail = (overrides: Partial<EventDetail> = {}): EventDetail =>
  ({
    id: EVENT_ID,
    title: 'Encontro anual',
    format: 'in_person',
    category: null,
    capacity: 50,
    venueName: 'Auditório da sede',
    address: null,
    coverAssetId: null,
    coverVariantWidths: [],
    startsAt: '2099-10-12T22:00:00.000000Z',
    endsAt: '2099-10-13T00:00:00.000000Z',
    status: 'active',
    viewerStatus: null,
    viewerCheckedInAt: null,
    confirmedCount: 10,
    presentCount: 0,
    description: 'Uma descrição.',
    viewerRespondedAt: null,
    paid: true,
    ...overrides,
  }) as EventDetail;

async function renderPage() {
  const element = (await EventPage({
    params: Promise.resolve({ eventId: EVENT_ID }),
  })) as ReactElement;
  return render(element);
}

const pill = () => document.querySelector('[data-event-manage-over-limit]');

beforeEach(() => {
  state.permissions = ADMIN;
  state.event = detail();
});
afterEach(cleanup);

describe('the manage card: "Acima do limite" (D-751, UI-D-757 a)', () => {
  it('1. a paid event past its limit shows the warning pill under the Participantes sub-line', async () => {
    state.event = detail({ confirmedCount: 51 });
    await renderPage();
    const element = pill() as HTMLElement;
    expect(element.textContent).toBe('Acima do limite');
    expect(element.className).toContain('bg-warning/10');
    expect(element.className).toContain('mt-1');
    const sub = document.querySelector('[data-event-manage-participants-sub]') as HTMLElement;
    expect(sub.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The same link as before: the pill sits inside the Participantes row.
    expect(element.closest('[data-event-manage-participants]')).not.toBeNull();
  });

  it('2. at the limit, under it, or with no limit there is no pill', async () => {
    for (const overrides of [
      { confirmedCount: 50 },
      { confirmedCount: 49 },
      { capacity: null, confirmedCount: 9999 },
    ]) {
      state.event = detail(overrides);
      const { unmount } = await renderPage();
      expect(pill(), JSON.stringify(overrides)).toBeNull();
      unmount();
    }
  });

  it('3. a free event has no pill, whatever the count', async () => {
    state.event = detail({ paid: false, confirmedCount: 51 });
    await renderPage();
    expect(pill()).toBeNull();
    cleanup();
    state.event = detail({ confirmedCount: 51 });
    delete (state.event as Partial<EventDetail>).paid;
    await renderPage();
    expect(pill()).toBeNull();
  });

  it('4. a member never sees the manage card, so never the pill', async () => {
    state.permissions = [];
    state.event = detail({ confirmedCount: 51 });
    await renderPage();
    expect(document.querySelector('[data-event-manage]')).toBeNull();
    expect(pill()).toBeNull();
    expect(screen.queryByText('Acima do limite')).toBeNull();
  });

  it('5. manage without the attendance read draws no Participantes row, so no pill', async () => {
    state.permissions = ['events.event.manage'];
    state.event = detail({ confirmedCount: 51 });
    await renderPage();
    expect(document.querySelector('[data-event-manage-participants]')).toBeNull();
    expect(pill()).toBeNull();
  });
});
