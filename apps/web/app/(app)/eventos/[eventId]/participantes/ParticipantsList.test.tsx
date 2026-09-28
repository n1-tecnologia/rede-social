// @vitest-environment happy-dom

import type { AttendanceSummary, Attendee } from '@rede-social/module-events/contracts';
import { ToastProvider } from '@rede-social/ui';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendeeView } from '@/lib/events-view';

/**
 * 06-07 — the `Participantes` screen (UI-D-213, sketch 006 Surface 6, UI E11), rendered from the RSC
 * page itself (its loaders, bootstrap and navigation mocked) and from the client list alone.
 *
 * The catalog is the REAL `events.json` through next-intl's own translator, so "Confirmados · 1.204"
 * is the real pt-BR number format and a copy drift fails here. happy-dom has no layout engine, so the
 * E11 backstop (three four-digit chips at 320px scroll horizontally, no label clipped, the active chip
 * whole) is asserted on the classes that produce it and on the DOM; the visual half is the phone UAT.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  // Vitest runs from `apps/web` (the `EventsList.test.tsx` precedent).
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

MotionGlobalConfig.skipAnimations = true;

const { createTranslator } = await import('next-intl');
const t = createTranslator({ locale: 'pt-BR', messages, namespace: 'events' });

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const tr = actual.createTranslator({ locale: 'pt-BR', messages, namespace: 'events' });
  return { ...actual, useTranslations: () => tr };
});

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async () =>
      createTranslator({ locale: 'pt-BR', messages, namespace: 'events' }),
  };
});

const state = vi.hoisted(() => ({
  permissions: [] as string[],
  summary: null as unknown,
  page: null as unknown,
}));

vi.mock('@/lib/bootstrap', () => ({
  requireBootstrap: async () => ({
    permissions: state.permissions,
    tenant: { timezone: 'America/Sao_Paulo', displayName: 'Rede Demo' },
  }),
}));

vi.mock('@/lib/events', () => ({
  loadAttendanceSummary: vi.fn(async () => state.summary),
  loadAttendance: vi.fn(async () => state.page),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('../../actions', () => ({
  loadMoreAttendanceAction: vi.fn(),
  refreshAttendanceAction: vi.fn(),
  regenerateCheckinCodeAction: vi.fn(),
}));

const { default: ParticipantsPage } = await import('./page');
const { ParticipantsList } = await import('./ParticipantsList');

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN = ['events.event.manage', 'events.attendance.read', 'events.attendance.respond'];

const summary = (overrides: Partial<AttendanceSummary> = {}): AttendanceSummary => ({
  format: 'in_person',
  pendingConfirmedCount: 1204,
  presentCount: 18,
  notGoingCount: 3,
  confirmedCount: 1222,
  checkinCode: 'K7QM',
  ...overrides,
});

const attendee = (id: string, overrides: Partial<Attendee> = {}): Attendee => ({
  id,
  displayName: `Pessoa ${id.slice(-1)}`,
  avatarAssetId: null,
  avatarVariantWidths: [],
  removed: false,
  status: 'going',
  respondedAt: '2026-10-02T15:00:00.000000Z',
  checkedInAt: null,
  walkIn: false,
  ...overrides,
});

const A1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const A2 = 'aaaaaaaa-0000-4000-8000-000000000002';

async function renderPage(lista?: string) {
  const element = (await ParticipantsPage({
    params: Promise.resolve({ eventId: EVENT_ID }),
    searchParams: Promise.resolve(lista ? { lista } : {}),
  })) as ReactElement;
  return render(
    <div style={{ width: 320 }}>
      <ToastProvider>{element}</ToastProvider>
    </div>,
  );
}

beforeEach(() => {
  state.permissions = ADMIN;
  state.summary = { status: 'ok', summary: summary() };
  state.page = { items: [attendee(A1)], nextCursor: null };
});

afterEach(cleanup);

describe('the Participantes page (RSC)', () => {
  it('1. E11 backstop at 320px: three counted chips keep whitespace-nowrap inside an overflow-x-auto nav, and the active chip is whole', async () => {
    await renderPage('nao-vao');
    const nav = screen.getByRole('navigation', { name: 'Filtrar participantes' });
    for (const token of ['overflow-x-auto', 'scrollbar-none', 'flex', 'gap-2', 'px-4']) {
      expect(nav.className).toContain(token);
    }
    const chips = within(nav).getAllByRole('link');
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'Confirmados · 1.204',
      'Presentes · 18',
      'Não vão · 3',
    ]);
    for (const chip of chips) {
      for (const token of ['whitespace-nowrap', 'shrink-0', 'tabular-nums']) {
        expect(chip.className, `${chip.textContent} ${token}`).toContain(token);
      }
      // Never truncated: the label is the whole string, not an ellipsised one.
      expect(chip.className).not.toContain('truncate');
    }
    const active = chips.filter((chip) => chip.getAttribute('aria-current') === 'page');
    expect(active.map((chip) => chip.textContent)).toEqual(['Não vão · 3']);
    expect(active[0]?.getAttribute('href')).toBe(
      `/eventos/${EVENT_ID}/participantes?lista=nao-vao`,
    );
    expect(chips[0]?.getAttribute('href')).toBe(`/eventos/${EVENT_ID}/participantes`);
  });

  it('2. the code card comes first, spelled for screen readers, with "Gerar novo código" for the manager', async () => {
    await renderPage();
    const card = screen.getByTestId('checkin-code-card');
    expect(screen.getByTestId('checkin-code').textContent).toBe('K7QM');
    expect(screen.getByTestId('checkin-code-spelled').textContent).toBe('Código K, 7, Q, M');
    expect(within(card).getByRole('button', { name: 'Gerar novo código' })).toBeTruthy();
    // The card precedes the chip nav in document order.
    const nav = screen.getByRole('navigation', { name: 'Filtrar participantes' });
    expect(card.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('3. attendance read WITHOUT manage: the code, but no regenerate control', async () => {
    state.permissions = ['events.attendance.read'];
    await renderPage();
    expect(screen.getByTestId('checkin-code').textContent).toBe('K7QM');
    expect(screen.queryByRole('button', { name: 'Gerar novo código' })).toBeNull();
  });

  it('4. online: the online note in place of the code, and no regenerate control', async () => {
    state.summary = { status: 'ok', summary: summary({ format: 'online', checkinCode: null }) };
    await renderPage();
    expect(screen.getByTestId('checkin-code-card').getAttribute('data-kind')).toBe('online');
    expect(
      screen.getByText(
        'Em eventos online, o check-in é registrado quando o membro toca em Entrar.',
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId('checkin-code')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gerar novo código' })).toBeNull();
  });

  it('5. no events.attendance.read, or a missed event: notFound()', async () => {
    state.permissions = ['events.attendance.respond'];
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    state.permissions = ADMIN;
    state.summary = { status: 'not-found' };
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('6. a first page the API could not read keeps the code card and shows the list error', async () => {
    state.page = null;
    await renderPage();
    expect(screen.getByTestId('checkin-code')).toBeTruthy();
    expect(screen.getByText('Algo deu errado')).toBeTruthy();
  });

  it('7. rows are formatted on the server and are not links; Presentes tags the walk-in only', async () => {
    state.page = {
      items: [
        attendee(A1, {
          status: 'checked_in',
          checkedInAt: '2026-10-12T21:42:00.000000Z',
        }),
        attendee(A2, {
          status: 'walk_in',
          walkIn: true,
          respondedAt: null,
          checkedInAt: '2026-10-12T21:51:00.000000Z',
        }),
      ],
      nextCursor: null,
    };
    await renderPage('presentes');
    const rows = screen.getAllByTestId('attendee-row');
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.querySelector('a') === null)).toBe(true);
    expect(within(rows[0] as HTMLElement).queryByTestId('walk-in-tag')).toBeNull();
    expect(within(rows[1] as HTMLElement).getByTestId('walk-in-tag').textContent).toBe(
      'Sem confirmação',
    );
  });
});

describe('ParticipantsList (client)', () => {
  const view = (id: string, overrides: Partial<AttendeeView> = {}): AttendeeView => ({
    id,
    name: `Pessoa ${id.slice(-1)}`,
    removed: false,
    avatarUrl: null,
    meta: 'Confirmou em sex., 2 de out.',
    walkIn: false,
    ...overrides,
  });

  it('8. the walk-in tag appears ONLY in Presentes', () => {
    const items = [view(A1, { walkIn: true })];
    const { unmount } = render(
      <ParticipantsList
        eventId={EVENT_ID}
        list="present"
        initialItems={items}
        initialCursor={null}
      />,
    );
    expect(screen.getByTestId('walk-in-tag').textContent).toBe('Sem confirmação');
    unmount();
    render(
      <ParticipantsList
        eventId={EVENT_ID}
        list="confirmed"
        initialItems={items}
        initialCursor={null}
      />,
    );
    expect(screen.queryByTestId('walk-in-tag')).toBeNull();
  });

  it.each([
    ['confirmed', 'Ninguém confirmou ainda', 'Quem responder Vou aparece aqui até fazer check-in.'],
    [
      'present',
      'Nenhum check-in ainda',
      'Os check-ins feitos no local ou pelo Entrar aparecem aqui.',
    ],
    ['not_going', 'Ninguém recusou', 'Quem responder Não vou aparece aqui.'],
  ] as const)('9. %s has its own empty state', (list, title, body) => {
    render(
      <ParticipantsList eventId={EVENT_ID} list={list} initialItems={[]} initialCursor={null} />,
    );
    const empty = screen.getByTestId('participants-empty');
    expect(empty.getAttribute('data-list')).toBe(list);
    expect(within(empty).getByText(title)).toBeTruthy();
    expect(within(empty).getByText(body)).toBeTruthy();
  });

  it('10. a removed member reads "Membro removido" in the tertiary 14/400 style, and the row still renders', () => {
    render(
      <ParticipantsList
        eventId={EVENT_ID}
        list="present"
        initialItems={[view(A1, { removed: true, name: t('participants.removed') })]}
        initialCursor={null}
      />,
    );
    const row = screen.getByTestId('attendee-row');
    expect(row.getAttribute('data-removed')).toBe('true');
    const label = within(row).getByText('Membro removido');
    expect(label.className).toContain('text-text-tertiary');
    expect(row.querySelector('img')).toBeNull();
  });

  it('11. the region is labelled, and a first-load failure is the generic error card with a retry', () => {
    render(
      <ParticipantsList
        eventId={EVENT_ID}
        list="confirmed"
        initialItems={[]}
        initialCursor={null}
        initialError
      />,
    );
    expect(screen.getByRole('region', { name: 'Participantes do evento' })).toBeTruthy();
    expect(screen.getByText('Algo deu errado')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
  });
});
