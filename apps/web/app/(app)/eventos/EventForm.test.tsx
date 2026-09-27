// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 06-04 — the event form (UI-D-212, sketch 006 surface 1), against the REAL `events.json` and
 * `media.json` catalogs, so a copy drift fails here. Stubbed: the four server actions, the router,
 * the toast and the upload hook. Real: the form, the shared `eventInputSchema`, the `@tria/ui`
 * primitives (`SegmentedControl`, `ConfirmDialog`, `Input`) and `EventCover`.
 *
 * Claims:
 *  1. an empty create form has its submit DISABLED, no inline error, Presencial selected, the
 *     gradient preview and the server-computed zone helper;
 *  2. the D-213 prefill: start 2026-10-12 23:00 gives end 2026-10-13 01:00 (past midnight); once the
 *     end is edited by hand, a later start change keeps the edited end;
 *  3. the XOR: a URL typed under Online and then abandoned for Presencial is NOT sent (the action
 *     receives no `meetingUrl` key), and Online sends no venue or address;
 *  4. inline errors are hidden before the first submit and shown after it, with the top alert card,
 *     and the action is not called for a body the schema refuses;
 *  5. the `X`: a dirty form opens the discard confirm ("Descartar evento?"), a clean one leaves;
 *  6. edit mode: the edit note, the bottom row per server flag, and `updateEventAction` on save.
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

const { catalogs, toast, push, refresh, create, update, cancel, reactivate } = await vi.hoisted(
  async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const read = (name: string) =>
      JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
    return {
      catalogs: {
        events: read('events').events as Record<string, unknown>,
        media: read('media').media as Record<string, unknown>,
      } as Record<string, Record<string, unknown>>,
      toast: { show: vi.fn(), dismiss: vi.fn() },
      push: vi.fn(),
      refresh: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      cancel: vi.fn(),
      reactivate: vi.fn(),
    };
  },
);

MotionGlobalConfig.skipAnimations = true;

const lookup = (namespace: string, key: string, values?: Record<string, unknown>) => {
  const raw = key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown>)?.[part],
      catalogs[namespace] ?? {},
    );
  return String(raw ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values?.[name] ?? ''),
  );
};

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    lookup(namespace, key, values),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

vi.mock('@tria/ui', async (orig) => ({
  ...(await orig<typeof import('@tria/ui')>()),
  useToast: () => toast,
}));

vi.mock('./actions', () => ({
  createEventAction: create,
  updateEventAction: update,
  cancelEventAction: cancel,
  reactivateEventAction: reactivate,
}));

vi.mock('@/components/media/useSignedUpload', () => ({
  useSignedUpload: () => ({
    state: 'idle',
    progress: 0,
    error: null,
    pick: vi.fn(),
    reject: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
  }),
}));

const { EventForm } = await import('./EventForm');

const ZONE = 'Horário Padrão de Brasília';
const EVENT_ID = '44444444-4444-4444-8444-4444444444e1';

const E = catalogs.events as {
  form: {
    titleCreate: string;
    close: string;
    submitCreate: string;
    editNote: string;
    cancel: string;
    cancelledLocked: string;
    when: { zone: string };
    errors: { save: string; endBeforeStart: string; nameRequired: string };
  };
  confirm: { discard: { titleCreate: string } };
  reactivate: { action: string };
  toasts: { created: string; saved: string };
};

const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const submitButton = () =>
  document.querySelector('[data-event-submit]') as HTMLButtonElement | null;
const alerts = () => document.querySelectorAll('[role="alert"]');
const type = (id: string, value: string) => fireEvent.change(field(id), { target: { value } });

function renderCreate() {
  return render(<EventForm mode="create" tenantName="TRIA Demo" zoneLabel={ZONE} />);
}

/** Fills everything the Presencial side needs, with the start at 2026-10-12 19:00. */
function fillInPerson() {
  type('event-title', 'Encontro anual');
  type('event-start-date', '2026-10-12');
  type('event-start-time', '19:00');
  type('event-venue', 'Auditório da sede');
  type('event-address', 'Rua das Flores, 100');
}

beforeEach(() => {
  for (const mock of [toast.show, push, refresh, create, update, cancel, reactivate]) {
    mock.mockReset();
  }
  create.mockResolvedValue({ ok: true, eventId: EVENT_ID });
  update.mockResolvedValue({ ok: true, eventId: EVENT_ID });
});

afterEach(() => cleanup());

describe('EventForm — create', () => {
  it('1. starts empty: submit disabled, no error, Presencial pressed, gradient preview, the zone helper', () => {
    renderCreate();
    expect(submitButton()?.disabled).toBe(true);
    expect(submitButton()?.textContent).toContain(E.form.submitCreate);
    expect(alerts()).toHaveLength(0);
    const presencial = screen.getByRole('button', { name: /Presencial/ });
    expect(presencial.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Online/ }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(document.querySelector('[data-testid="event-cover-fallback"]')).not.toBeNull();
    expect(document.querySelector('[data-event-zone]')?.textContent).toBe(
      E.form.when.zone.replace('{zone}', ZONE),
    );
    // Native wall-clock inputs, five-minute steps on the times.
    expect(field('event-start-date').type).toBe('date');
    expect(field('event-start-time').type).toBe('time');
    expect(field('event-start-time').getAttribute('step')).toBe('300');
  });

  it('2. the end prefills to start + 2 h past midnight, and stops once the end is edited', () => {
    renderCreate();
    type('event-start-date', '2026-10-12');
    type('event-start-time', '23:00');
    expect(field('event-end-date').value).toBe('2026-10-13');
    expect(field('event-end-time').value).toBe('01:00');

    // The admin edits the end by hand; a later start change leaves it alone.
    type('event-end-time', '02:30');
    type('event-start-time', '20:00');
    expect(field('event-end-date').value).toBe('2026-10-13');
    expect(field('event-end-time').value).toBe('02:30');
  });

  it('3. a format switch submits ONLY the visible side', async () => {
    renderCreate();
    fillInPerson();
    // Type a URL under Online, then go back to Presencial.
    fireEvent.click(screen.getByRole('button', { name: /Online/ }));
    type('event-url', 'https://meet.example.test/sala');
    fireEvent.click(screen.getByRole('button', { name: /Presencial/ }));
    // The in-person values were kept in memory while hidden.
    expect(field('event-venue').value).toBe('Auditório da sede');

    expect(submitButton()?.disabled).toBe(false);
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const sent = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.format).toBe('in_person');
    expect(sent.venueName).toBe('Auditório da sede');
    expect(sent).not.toHaveProperty('meetingUrl');
    expect(JSON.stringify(sent)).not.toContain('meet.example.test');
    expect(sent.start).toEqual({ date: '2026-10-12', time: '19:00' });
    expect(sent.end).toEqual({ date: '2026-10-12', time: '21:00' });
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/eventos/${EVENT_ID}`));
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: E.toasts.created });

    // …and the other way: Online sends the URL and no venue or address.
    cleanup();
    create.mockClear();
    renderCreate();
    fillInPerson();
    fireEvent.click(screen.getByRole('button', { name: /Online/ }));
    type('event-url', 'https://meet.example.test/sala');
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const online = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(online.format).toBe('online');
    expect(online.meetingUrl).toBe('https://meet.example.test/sala');
    expect(online).not.toHaveProperty('venueName');
    expect(online).not.toHaveProperty('address');
  });

  it('4. inline errors are hidden before the first submit and shown after it', async () => {
    renderCreate();
    fillInPerson();
    // End before start: every field is filled, so the submit is enabled.
    type('event-end-time', '18:00');
    expect(alerts()).toHaveLength(0);
    expect(document.body.textContent).not.toContain(E.form.errors.endBeforeStart);

    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() =>
      expect(document.querySelector('[data-event-end-error]')?.textContent).toBe(
        E.form.errors.endBeforeStart,
      ),
    );
    expect(document.querySelector('[data-event-form-error]')?.textContent).toBe(E.form.errors.save);
    expect(field('event-end-time').getAttribute('aria-invalid')).toBe('true');
    expect(create).not.toHaveBeenCalled();

    // Fixing the end clears its message as the admin types.
    type('event-end-time', '21:00');
    expect(document.querySelector('[data-event-end-error]')).toBeNull();
  });

  it('5. the X on a dirty form opens the discard confirm; on a clean one it leaves', async () => {
    renderCreate();
    fireEvent.click(screen.getByRole('button', { name: E.form.close }));
    expect(push).toHaveBeenCalledWith('/eventos');
    expect(document.body.textContent).not.toContain(E.confirm.discard.titleCreate);

    push.mockClear();
    type('event-title', 'Rascunho');
    fireEvent.click(screen.getByRole('button', { name: E.form.close }));
    await waitFor(() => expect(document.body.textContent).toContain(E.confirm.discard.titleCreate));
    expect(push).not.toHaveBeenCalled();
  });
});

describe('EventForm — edit', () => {
  const initial = {
    title: 'Encontro anual',
    description: '',
    coverAssetId: null,
    coverVariantWidths: [],
    format: 'in_person' as const,
    venueName: 'Auditório da sede',
    address: 'Rua das Flores, 100',
    meetingUrl: '',
    start: { date: '2026-10-12', time: '19:00' },
    end: { date: '2026-10-12', time: '21:00' },
  };

  function renderEdit(flags: {
    canCancel?: boolean;
    canReactivate?: boolean;
    cancelledLocked?: boolean;
  }) {
    return render(
      <EventForm
        mode="edit"
        eventId={EVENT_ID}
        initial={initial}
        tenantName="TRIA Demo"
        zoneLabel={ZONE}
        {...flags}
      />,
    );
  }

  it('6. arrives filled with the note and the cancel row; a start change never overwrites the stored end', async () => {
    renderEdit({ canCancel: true });
    expect(field('event-start-time').value).toBe('19:00');
    expect(field('event-end-time').value).toBe('21:00');
    expect(document.body.textContent).toContain(E.form.editNote);
    expect(document.querySelector('[data-event-cancel]')?.textContent).toContain(E.form.cancel);
    expect(document.querySelector('[data-event-reactivate]')).toBeNull();

    type('event-start-time', '18:00');
    expect(field('event-end-time').value).toBe('21:00');

    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[0]).toBe(EVENT_ID);
    expect(create).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: E.toasts.saved }),
    );
  });

  it('7. a cancelled event shows Reativar before its start, and the locked note after it', () => {
    renderEdit({ canReactivate: true });
    expect(document.querySelector('[data-event-reactivate]')?.textContent).toBe(
      E.reactivate.action,
    );
    expect(document.querySelector('[data-event-cancel]')).toBeNull();
    cleanup();

    renderEdit({ cancelledLocked: true });
    expect(document.querySelector('[data-event-cancelled-locked]')?.textContent).toBe(
      E.form.cancelledLocked,
    );
    expect(document.querySelector('[data-event-reactivate]')).toBeNull();
  });
});
