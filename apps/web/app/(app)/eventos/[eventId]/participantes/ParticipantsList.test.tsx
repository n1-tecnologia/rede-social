// @vitest-environment happy-dom

import type { AttendanceSummary, Attendee } from '@rede-social/module-events/contracts';
import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import type { ComponentProps, ReactElement } from 'react';
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
  event: { status: 'ok', event: { capacity: 50 } } as unknown,
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
  loadEvent: vi.fn(async () => state.event),
}));

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => router,
}));

vi.mock('../../actions', () => ({
  loadMoreAttendanceAction: vi.fn(),
  refreshAttendanceAction: vi.fn(),
  regenerateCheckinCodeAction: vi.fn(),
  removeCourtesyAction: vi.fn(),
  grantCourtesyAction: vi.fn(),
  searchCourtesyMembersAction: vi.fn(),
  courtesyHoldersAction: vi.fn(),
}));

const { loadEvent } = await import('@/lib/events');
const { default: ParticipantsPage } = await import('./page');
const { ParticipantsList } = await import('./ParticipantsList');
const {
  courtesyHoldersAction,
  grantCourtesyAction,
  refreshAttendanceAction,
  removeCourtesyAction,
} = await import('../../actions');

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
  vi.mocked(removeCourtesyAction).mockReset();
  vi.mocked(grantCourtesyAction).mockReset();
  vi.mocked(courtesyHoldersAction).mockReset();
  vi.mocked(refreshAttendanceAction).mockReset();
  router.refresh.mockReset();
  vi.mocked(loadEvent).mockClear();
  state.event = { status: 'ok', event: { capacity: 50 } };
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

  it('6b. the toolbar door: a paid event and the manage permission draw it above the chips, nobody else', async () => {
    state.summary = { status: 'ok', summary: summary({ paid: true }) };
    const { unmount } = await renderPage();
    const door = screen.getByRole('button', { name: 'Liberar presença' });
    const nav = screen.getByRole('navigation', { name: 'Filtrar participantes' });
    expect(door.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    // Attendance read WITHOUT manage: the list, but no door.
    state.permissions = ['events.attendance.read'];
    const second = await renderPage();
    expect(screen.queryByRole('button', { name: 'Liberar presença' })).toBeNull();
    second.unmount();
    // A free event has neither door, even for the admin.
    state.permissions = ADMIN;
    state.summary = { status: 'ok', summary: summary() };
    await renderPage();
    expect(screen.queryByRole('button', { name: 'Liberar presença' })).toBeNull();
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

/** The list needs the app's toast host (the root layout mounts it in the real app). */
function renderList(props: Partial<ComponentProps<typeof ParticipantsList>> = {}) {
  return render(
    <ToastProvider>
      <ParticipantsList
        eventId={EVENT_ID}
        list="confirmed"
        initialItems={[]}
        initialCursor={null}
        {...props}
      />
    </ToastProvider>,
  );
}

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
    const { unmount } = renderList({ list: 'present', initialItems: items });
    expect(screen.getByTestId('walk-in-tag').textContent).toBe('Sem confirmação');
    unmount();
    renderList({ list: 'confirmed', initialItems: items });
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
    renderList({ list });
    const empty = screen.getByTestId('participants-empty');
    expect(empty.getAttribute('data-list')).toBe(list);
    expect(within(empty).getByText(title)).toBeTruthy();
    expect(within(empty).getByText(body)).toBeTruthy();
  });

  it('10. a removed member reads "Membro removido" in the tertiary 14/400 style, and the row still renders', () => {
    renderList({
      list: 'present',
      initialItems: [view(A1, { removed: true, name: t('participants.removed') })],
    });
    const row = screen.getByTestId('attendee-row');
    expect(row.getAttribute('data-removed')).toBe('true');
    const label = within(row).getByText('Membro removido');
    expect(label.className).toContain('text-text-tertiary');
    expect(row.querySelector('img')).toBeNull();
  });

  it('11. the region is labelled, and a first-load failure is the generic error card with a retry', () => {
    renderList({ initialError: true });
    expect(screen.getByRole('region', { name: 'Participantes do evento' })).toBeTruthy();
    expect(screen.getByText('Algo deu errado')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
  });
});

/**
 * Phase 10.1-14 (UI-D-754, UI-D-756) — the origin marks and the courtesy removal. The rows are the
 * finished `AttendeeView`s the server builds (plan 08's view-model); the real catalog speaks.
 */
describe('ParticipantsList: the marks and the courtesy removal of a paid event', () => {
  const mark = (kind: string, tone: 'success' | 'neutral' | 'warning', label: string) => ({
    kind: kind as 'paid',
    tone,
    label,
  });
  const PAID = mark('paid', 'success', 'Pago');
  const COURTESY = mark('courtesy', 'neutral', 'Cortesia');
  const BEFORE = mark('beforeTicket', 'neutral', 'Anterior ao ingresso');
  const REFUNDED = mark('refunded', 'warning', 'Reembolsado');
  const OVER = mark('overLimit', 'warning', 'Acima do limite');

  const row = (id: string, overrides: Partial<AttendeeView> = {}): AttendeeView => ({
    id,
    name: `Pessoa ${id.slice(-1)}`,
    removed: false,
    avatarUrl: null,
    meta: 'Confirmou em sex., 2 de out.',
    walkIn: false,
    ...overrides,
  });

  const A3 = 'aaaaaaaa-0000-4000-8000-000000000003';
  const A4 = 'aaaaaaaa-0000-4000-8000-000000000004';

  const rowOf = (name: string) =>
    screen.getAllByTestId('attendee-row').find((el) => within(el).queryByText(name)) as HTMLElement;
  const pills = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('[data-mark]')).map((pill) => pill.textContent);

  it('11a. tracer: each presence shows its origin, a courtesy offers the removal and a paid one does not', async () => {
    renderList({
      canManage: true,
      initialItems: [
        row(A1, { marks: [PAID], action: null }),
        row(A2, { marks: [COURTESY], action: 'removeCourtesy' }),
        row(A3, { marks: [PAID, REFUNDED], action: null, meta: 'Check-in às 18:40' }),
        row(A4, { marks: [BEFORE], action: null }),
      ],
    });
    expect(pills(rowOf('Pessoa 1'))).toEqual(['Pago']);
    expect(pills(rowOf('Pessoa 2'))).toEqual(['Cortesia']);
    expect(pills(rowOf('Pessoa 3'))).toEqual(['Pago', 'Reembolsado']);
    expect(pills(rowOf('Pessoa 4'))).toEqual(['Anterior ao ingresso']);
    // Only the courtesy row has an action; a paid presence leaves by refund at the gateway (D-743).
    expect(screen.getAllByRole('button', { name: /Remover cortesia/ })).toHaveLength(1);
    expect(
      within(rowOf('Pessoa 2')).getByRole('button', { name: 'Remover cortesia de Pessoa 2' }),
    ).toBeTruthy();

    vi.mocked(removeCourtesyAction).mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: 'Remover cortesia de Pessoa 2' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Remover a cortesia de Pessoa 2?')).toBeTruthy();
    expect(
      within(dialog).getByText('A pessoa deixa de estar inscrita neste evento. Ninguém é avisado.'),
    ).toBeTruthy();
    // Nothing is sent, and the row stays, until the admin confirms.
    expect(removeCourtesyAction).not.toHaveBeenCalled();
    expect(screen.getByText('Pessoa 2')).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remover cortesia' }));
    });
    expect(removeCourtesyAction).toHaveBeenCalledTimes(1);
    expect(removeCourtesyAction).toHaveBeenCalledWith(EVENT_ID, A2);
    await waitFor(() => expect(screen.queryByText('Pessoa 2')).toBeNull());
    expect(screen.getByText('Pessoa 1')).toBeTruthy();
    expect(screen.getByText('Cortesia de Pessoa 2 removida.')).toBeTruthy();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('11b. every mark order: origin, then Reembolsado, then Acima do limite, in the host order', () => {
    renderList({
      list: 'present',
      initialItems: [
        row(A1, { marks: [COURTESY, REFUNDED, OVER], action: null }),
        row(A2, { marks: [PAID, OVER], action: null }),
      ],
    });
    expect(pills(rowOf('Pessoa 1'))).toEqual(['Cortesia', 'Reembolsado', 'Acima do limite']);
    expect(pills(rowOf('Pessoa 2'))).toEqual(['Pago', 'Acima do limite']);
    const tones = Array.from(rowOf('Pessoa 1').querySelectorAll('[data-mark]')).map(
      (el) => el.className,
    );
    expect(tones[0]).toContain('bg-bg-tertiary');
    expect(tones[1]).toContain('bg-warning/10');
    expect(tones[2]).toContain('bg-warning/10');
    // Colour is never the only signal: every pill is a word.
    expect(rowOf('Pessoa 1').querySelectorAll('[data-mark]')).toHaveLength(3);
  });

  it('11c. a free event: rows carry no marks, no action and the exact shipped markup', () => {
    renderList({ canManage: true, initialItems: [row(A1)] });
    const el = screen.getByTestId('attendee-row');
    expect(el.querySelector('[data-attendee-marks]')).toBeNull();
    expect(el.querySelector('[data-attendee-action]')).toBeNull();
    expect(el.className).toBe('flex min-h-14 items-center gap-3 border-b border-divider py-2');
    expect(screen.queryByRole('button', { name: /cortesia/i })).toBeNull();
  });

  it('11d. without the manage permission a courtesy row still shows its mark and no action', () => {
    renderList({
      canManage: false,
      initialItems: [row(A1, { marks: [COURTESY], action: 'removeCourtesy' })],
    });
    expect(pills(rowOf('Pessoa 1'))).toEqual(['Cortesia']);
    expect(screen.queryByRole('button', { name: /Remover cortesia/ })).toBeNull();
  });

  it('11e. "Manter cortesia" closes the dialog and sends nothing', async () => {
    renderList({
      canManage: true,
      initialItems: [row(A1, { marks: [COURTESY], action: 'removeCourtesy' })],
    });
    const trigger = screen.getByRole('button', { name: 'Remover cortesia de Pessoa 1' });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Manter cortesia' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(removeCourtesyAction).not.toHaveBeenCalled();
    expect(screen.getByText('Pessoa 1')).toBeTruthy();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ['locked', 'Esta pessoa já fez check-in e a inscrição não pode ser removida.', true],
    ['not_courtesy', 'Esta presença não é uma cortesia. A lista foi atualizada.', true],
    ['not_found', 'Esta cortesia já tinha sido removida. A lista foi atualizada.', true],
    ['generic', 'Algo deu errado. Tente novamente.', false],
  ] as const)(
    '11f. a refusal (%s) keeps the row, says why and %s',
    async (code, message, rereads) => {
      vi.mocked(removeCourtesyAction).mockResolvedValue({ ok: false, code });
      vi.mocked(refreshAttendanceAction).mockResolvedValue({
        ok: true,
        items: [row(A1, { marks: [PAID], action: null })],
        nextCursor: null,
      });
      renderList({
        canManage: true,
        initialItems: [row(A1, { marks: [COURTESY], action: 'removeCourtesy' })],
      });
      fireEvent.click(screen.getByRole('button', { name: 'Remover cortesia de Pessoa 1' }));
      const dialog = await screen.findByRole('dialog');
      await act(async () => {
        fireEvent.click(within(dialog).getByRole('button', { name: 'Remover cortesia' }));
      });
      expect(await screen.findByText(message)).toBeTruthy();
      // The row is still there; it changes only if the re-read says so (no optimistic move).
      expect(screen.getByText('Pessoa 1')).toBeTruthy();
      if (rereads) {
        await waitFor(() =>
          expect(refreshAttendanceAction).toHaveBeenCalledWith(EVENT_ID, 'confirmed'),
        );
        await waitFor(() => expect(pills(rowOf('Pessoa 1'))).toEqual(['Pago']));
        expect(router.refresh).toHaveBeenCalledTimes(1);
      } else {
        expect(refreshAttendanceAction).not.toHaveBeenCalled();
        expect(pills(rowOf('Pessoa 1'))).toEqual(['Cortesia']);
        expect(router.refresh).not.toHaveBeenCalled();
      }
    },
  );

  it('11g. a rejected action toasts the generic line and keeps the row', async () => {
    vi.mocked(removeCourtesyAction).mockRejectedValue(new Error('network'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderList({
      canManage: true,
      initialItems: [row(A1, { marks: [COURTESY], action: 'removeCourtesy' })],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remover cortesia de Pessoa 1' }));
    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remover cortesia' }));
    });
    expect(await screen.findByText('Algo deu errado. Tente novamente.')).toBeTruthy();
    expect(screen.getByText('Pessoa 1')).toBeTruthy();
    spy.mockRestore();
  });

  it('11h. focus stays inside the screen: a refusal returns to the row button, a success lands on the list', async () => {
    vi.mocked(removeCourtesyAction).mockResolvedValueOnce({ ok: false, code: 'generic' });
    renderList({
      canManage: true,
      initialItems: [
        row(A1, { marks: [COURTESY], action: 'removeCourtesy' }),
        row(A2, { marks: [COURTESY], action: 'removeCourtesy' }),
      ],
    });
    const first = screen.getByRole('button', { name: 'Remover cortesia de Pessoa 1' });
    first.focus();
    fireEvent.click(first);
    let dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remover cortesia' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(first);

    vi.mocked(removeCourtesyAction).mockResolvedValueOnce({ ok: true });
    const second = screen.getByRole('button', { name: 'Remover cortesia de Pessoa 2' });
    second.focus();
    fireEvent.click(second);
    dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remover cortesia' }));
    });
    await waitFor(() => expect(screen.queryByText('Pessoa 2')).toBeNull());
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(screen.getByRole('region', { name: 'Participantes do evento' })).toBe(
      document.activeElement,
    );
  });
});

/**
 * Phase 10.1-14 (UI-D-755 door 2, A-UI-5) — the "Não vão" rows of a paid event carry "Liberar presença";
 * the toolbar door is drawn by the page. The row leaves the chip only from the server's answer.
 */
describe('ParticipantsList: Liberar presença on the Não vão chip', () => {
  const notGoing = (id: string, overrides: Partial<AttendeeView> = {}): AttendeeView => ({
    id,
    name: `Pessoa ${id.slice(-1)}`,
    removed: false,
    avatarUrl: null,
    meta: 'Respondeu em sex., 2 de out.',
    walkIn: false,
    marks: [],
    action: 'release',
    ...overrides,
  });
  const open = async (name: string) => {
    fireEvent.click(screen.getByRole('button', { name: `Liberar presença de ${name}` }));
    return screen.findByRole('dialog');
  };

  it('12a. every row of a paid event carries the outline action; the confirm names the person and sends nothing yet', async () => {
    renderList({
      list: 'not_going',
      canManage: true,
      initialItems: [notGoing(A1), notGoing(A2)],
    });
    const buttons = screen.getAllByRole('button', { name: /^Liberar presença de/ });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.textContent).toBe('Liberar presença');
    expect(buttons[0]?.className).toContain('border');
    // No marks on a Não vão row: it holds no presence to describe.
    expect(document.querySelector('[data-attendee-marks]')).toBeNull();
    const dialog = await open('Pessoa 1');
    expect(within(dialog).getByText('Liberar presença de Pessoa 1?')).toBeTruthy();
    expect(
      within(dialog).getByText(
        'A presença é confirmada agora, sem cobrança. Ela aparece como Cortesia.',
      ),
    ).toBeTruthy();
    expect(grantCourtesyAction).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Não liberar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(grantCourtesyAction).not.toHaveBeenCalled();
    expect(screen.getByText('Pessoa 1')).toBeTruthy();
  });

  it('12b. granted: the request carries the attendanceId, the row leaves ONLY after the answer, counts refresh', async () => {
    let resolve: (value: { status: 'granted' }) => void = () => {};
    vi.mocked(grantCourtesyAction).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderList({
      list: 'not_going',
      canManage: true,
      initialItems: [notGoing(A1), notGoing(A2)],
    });
    const dialog = await open('Pessoa 1');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Liberar presença' }));
    });
    expect(grantCourtesyAction).toHaveBeenCalledTimes(1);
    expect(grantCourtesyAction).toHaveBeenCalledWith(EVENT_ID, { attendanceId: A1 });
    // Pending: the row is still on screen, untouched.
    expect(screen.getByText('Pessoa 1')).toBeTruthy();
    expect(router.refresh).not.toHaveBeenCalled();
    await act(async () => {
      resolve({ status: 'granted' });
    });
    await waitFor(() => expect(screen.queryByText('Pessoa 1')).toBeNull());
    expect(screen.getByText('Pessoa 2')).toBeTruthy();
    expect(screen.getByText('Presença de Pessoa 1 liberada.')).toBeTruthy();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['event_ended', 'Este evento já terminou.'],
    ['event_cancelled', 'Este evento foi cancelado.'],
    ['event_not_paid', 'Algo deu errado. Tente novamente.'],
    ['generic', 'Algo deu errado. Tente novamente.'],
  ] as const)(
    '12c. a refusal (%s) toasts its sentence and the row stays',
    async (status, message) => {
      vi.mocked(grantCourtesyAction).mockResolvedValue({ status });
      renderList({ list: 'not_going', canManage: true, initialItems: [notGoing(A1)] });
      const dialog = await open('Pessoa 1');
      await act(async () => {
        fireEvent.click(within(dialog).getByRole('button', { name: 'Liberar presença' }));
      });
      expect(await screen.findByText(message)).toBeTruthy();
      expect(screen.getByText('Pessoa 1')).toBeTruthy();
      expect(router.refresh).not.toHaveBeenCalled();
      expect(refreshAttendanceAction).not.toHaveBeenCalled();
    },
  );

  it('12d. already_in: the info sentence names the person and the row leaves this chip', async () => {
    vi.mocked(grantCourtesyAction).mockResolvedValue({ status: 'already_in' });
    renderList({ list: 'not_going', canManage: true, initialItems: [notGoing(A1)] });
    const dialog = await open('Pessoa 1');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Liberar presença' }));
    });
    expect(await screen.findByText('Pessoa 1 já está inscrito neste evento.')).toBeTruthy();
    await waitFor(() => expect(screen.queryAllByTestId('attendee-row')).toHaveLength(0));
  });

  it('12e. not_found re-reads the chip instead of guessing', async () => {
    vi.mocked(grantCourtesyAction).mockResolvedValue({ status: 'not_found' });
    vi.mocked(refreshAttendanceAction).mockResolvedValue({
      ok: true,
      items: [],
      nextCursor: null,
    });
    renderList({ list: 'not_going', canManage: true, initialItems: [notGoing(A1)] });
    const dialog = await open('Pessoa 1');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Liberar presença' }));
    });
    await waitFor(() =>
      expect(refreshAttendanceAction).toHaveBeenCalledWith(EVENT_ID, 'not_going'),
    );
    await waitFor(() => expect(screen.queryByText('Pessoa 1')).toBeNull());
  });

  it('12f. a viewer without the manage permission, and a free event, see no door', () => {
    const { unmount } = renderList({
      list: 'not_going',
      canManage: false,
      initialItems: [notGoing(A1)],
    });
    expect(screen.queryByRole('button', { name: /Liberar presença/ })).toBeNull();
    unmount();
    // A free event's row has no `action` key at all, whoever looks.
    const free: AttendeeView = { ...notGoing(A1) };
    delete free.action;
    delete free.marks;
    renderList({ list: 'not_going', canManage: true, initialItems: [free] });
    expect(screen.queryByRole('button', { name: /Liberar presença/ })).toBeNull();
  });
});

/**
 * Phase 10.1-14 (UI-D-757 b, D-758) — the over-limit notice above the chips and the reworded Confirmados
 * body of a paid event. The server flags the state (`summary.overLimit`); the numbers come from the event.
 */
describe('Participantes: the Acima do limite notice and the paid empty body', () => {
  const notice = () => document.querySelector('[data-over-limit-notice]') as HTMLElement | null;

  it('13a. one over the limit: the notice sits above the chips with CircleAlert and both plural branches', async () => {
    state.summary = {
      status: 'ok',
      summary: summary({ paid: true, overLimit: true, confirmedCount: 51 }),
    };
    await renderPage();
    const element = notice() as HTMLElement;
    expect(element.textContent).toBe(
      '51 confirmados para 50 vagas. Pagamentos aprovados depois de lotar confirmam mesmo assim.',
    );
    for (const token of ['flex', 'items-start', 'gap-2', 'rounded-xl', 'bg-warning/10', 'p-4']) {
      expect(element.className).toContain(token);
    }
    expect(element.querySelector('svg')).not.toBeNull();
    // Static text at load: no live region.
    expect(element.getAttribute('role')).toBeNull();
    expect(element.closest('[aria-live]')).toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Filtrar participantes' });
    expect(element.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(loadEvent).toHaveBeenCalledTimes(1);
  });

  it('13b. at the limit the notice is absent, and the event is not even read', async () => {
    state.summary = {
      status: 'ok',
      summary: summary({ paid: true, overLimit: false, confirmedCount: 50 }),
    };
    await renderPage();
    expect(notice()).toBeNull();
    expect(loadEvent).not.toHaveBeenCalled();
  });

  it('13c. a flag that disagrees with the numbers draws nothing; so do a null limit and an unreadable event', async () => {
    state.summary = {
      status: 'ok',
      summary: summary({ paid: true, overLimit: true, confirmedCount: 50 }),
    };
    const first = await renderPage();
    expect(notice()).toBeNull();
    first.unmount();
    state.summary = {
      status: 'ok',
      summary: summary({ paid: true, overLimit: true, confirmedCount: 51 }),
    };
    state.event = { status: 'ok', event: { capacity: null } };
    const second = await renderPage();
    expect(notice()).toBeNull();
    second.unmount();
    state.event = { status: 'error' };
    await renderPage();
    expect(notice()).toBeNull();
  });

  it.each([
    [2, 1, '2 confirmados para 1 vaga.'],
    [52, 50, '52 confirmados para 50 vagas.'],
  ])('13d. %i confirmed for %i spots reads "%s"', async (confirmedCount, capacity, start) => {
    state.summary = {
      status: 'ok',
      summary: summary({ paid: true, overLimit: true, confirmedCount }),
    };
    state.event = { status: 'ok', event: { capacity } };
    await renderPage();
    expect((notice() as HTMLElement).textContent?.startsWith(start)).toBe(true);
  });

  it('13e. a free event shows no notice and no toolbar door', async () => {
    state.summary = { status: 'ok', summary: summary({ confirmedCount: 51 }) };
    await renderPage();
    expect(notice()).toBeNull();
    expect(loadEvent).not.toHaveBeenCalled();
  });

  it('13f. the Confirmados empty body names the ticket and the courtesy ONLY for a paid event', () => {
    const { unmount } = renderList({ paid: true });
    expect(
      within(screen.getByTestId('participants-empty')).getByText(
        'Quem pagar o ingresso ou receber uma cortesia aparece aqui até fazer check-in.',
      ),
    ).toBeTruthy();
    unmount();
    renderList({ paid: false });
    expect(
      within(screen.getByTestId('participants-empty')).getByText(
        'Quem responder Vou aparece aqui até fazer check-in.',
      ),
    ).toBeTruthy();
  });

  it('13g. the paid reword touches Confirmados alone: Presentes and Não vão keep the shipped body', () => {
    const { unmount } = renderList({ list: 'present', paid: true });
    expect(
      screen.getByText('Os check-ins feitos no local ou pelo Entrar aparecem aqui.'),
    ).toBeTruthy();
    unmount();
    renderList({ list: 'not_going', paid: true });
    expect(screen.getByText('Quem responder Não vou aparece aqui.')).toBeTruthy();
  });
});
