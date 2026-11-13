// @vitest-environment happy-dom

import { EVENT_SCHEDULE_MAX_ITEMS } from '@rede-social/module-events/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventFormTicket } from '@/lib/event-ticket';

/**
 * 06-04 — the event form (UI-D-212, sketch 006 surface 1), against the REAL `events.json` and
 * `media.json` catalogs, so a copy drift fails here. Stubbed: the four server actions, the router,
 * the toast, the upload hook and `fetch` (the CEP lookup's `/api/cep/{cep}`). Real: the form, the
 * shared `eventInputSchema`, `lib/event-address.ts`, `useCepLookup`, the `@rede-social/ui`
 * primitives (`SegmentedControl`, `ConfirmDialog`, `Input`) and `EventCover`.
 *
 * Claims:
 *  1. an empty create form has its submit DISABLED, no inline error, Presencial selected, the
 *     gradient preview and the server-computed zone helper; it declares `data-shell-hide="nav"`,
 *     the address is the CEP group (no free-text field), and the "Quando" rows give the date the
 *     free track beside an 8rem time (PDF item #11);
 *  2. the D-213 prefill: start 2026-10-12 23:00 gives end 2026-10-13 01:00 (past midnight); once the
 *     end is edited by hand, a later start change keeps the edited end;
 *  3. the XOR: a URL typed under Online and then abandoned for Presencial is NOT sent (the action
 *     receives no `meetingUrl` key), Online sends no venue or address, and Presencial sends the
 *     parts COMPOSED into the one `address` string (PDF item #10);
 *  4. inline errors are hidden before the first submit and shown after it, with the top alert card,
 *     and the action is not called for a body the schema refuses;
 *  5. the `X`: a dirty form opens the discard confirm ("Descartar evento?"), a clean one leaves;
 *  6. edit mode: the edit note, the bottom row per server flag, and `updateEventAction` on save; a
 *     legacy free-text address stays in its textarea and is sent unchanged;
 *  8-11, 14. the CEP (PDF item #10): the lookup fires once on the 8th digit and fills rua, bairro,
 *     cidade and UF but never número or complemento; a city-wide CEP keeps what was typed; an
 *     unknown CEP and a failed lookup say so and never block the save; the submit opens with CEP,
 *     rua, cidade and UF filled, and a 7-digit CEP or an unknown UF speaks after the first submit;
 *     a newer CEP aborts the pending lookup, so an old answer never overwrites a newer one;
 *  15-16. another CEP takes back what the previous lookup wrote and nobody changed (a city-wide or
 *     unknown answer never composes the old rua with the new cidade), and a digit typed into a full
 *     CEP is refused as a `maxLength` would refuse it, while a paste or a typed replacement of a
 *     selection goes through;
 *  12-13. edit mode with a composed address restores every part and is clean; a legacy address
 *     switches to parts with "Preencher pelo CEP" (dirty) and back with "Manter endereço anterior";
 *  17-18. a restored CEP is not looked up again until its digits change, and "Preencher pelo CEP"
 *     again after going back mid-lookup asks for the CEP the parts kept;
 *  22. 2026-10-20 (FRONT.pdf): edit mode's row ends with "Excluir evento" and "Em breve", a
 *     placeholder that is `aria-disabled`, describes why and does nothing (the API cannot delete
 *     an event yet); the create form has none.
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

const {
  catalogs,
  toast,
  push,
  replace,
  refresh,
  create,
  update,
  cancel,
  reactivate,
  remove,
  saveTicket,
  removeTicket,
} = await vi.hoisted(async () => {
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
    replace: vi.fn(),
    refresh: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    reactivate: vi.fn(),
    remove: vi.fn(),
    saveTicket: vi.fn(),
    removeTicket: vi.fn(),
  };
});

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

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace, refresh }) }));

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

vi.mock('./ticket-actions', () => ({
  saveEventTicketAction: saveTicket,
  removeEventTicketAction: removeTicket,
}));

vi.mock('./actions', () => ({
  createEventAction: create,
  updateEventAction: update,
  cancelEventAction: cancel,
  reactivateEventAction: reactivate,
  deleteEventAction: remove,
}));

/**
 * One stateful stand-in per `useSignedUpload` call, in the form's own order: the first is the
 * horizontal cover, the second the vertical poster (12.3-08, UI-D-693). `uploads.list[n]` lets a test
 * finish or hold an upload and reads what the form asked of it.
 */
type UploadStub = {
  pick: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  options: {
    onPicked?: (file: File) => void;
    onCompleted: (asset: { id: string; variants: { width: number }[] }) => void;
  };
  setState: (state: string) => void;
  setProgress: (percent: number) => void;
};
const uploads = vi.hoisted(() => ({ list: [] as UploadStub[] }));

vi.mock('@/components/media/useSignedUpload', async () => {
  const React = await import('react');
  return {
    useSignedUpload: (options: UploadStub['options']) => {
      const [state, setState] = React.useState('idle');
      const [progress, setProgress] = React.useState(0);
      const slot = React.useRef<number | null>(null);
      if (slot.current === null) slot.current = uploads.list.length;
      const own = React.useRef({
        pick: vi.fn(),
        reject: vi.fn(),
        cancel: vi.fn(),
        reset: vi.fn(),
      }).current;
      uploads.list[slot.current] = { ...own, options, setState, setProgress };
      return { state, progress, error: null, ...own };
    },
  };
});

const { EventForm } = await import('./EventForm');

const ZONE = 'Horário Padrão de Brasília';
const EVENT_ID = '44444444-4444-4444-8444-4444444444e1';

/** What `/api/cep/01310200` answers (the route's mapping of ViaCEP's 01310-200). */
const PAULISTA = {
  cep: '01310200',
  street: 'Avenida Paulista',
  district: 'Bela Vista',
  city: 'São Paulo',
  state: 'SP',
};
/** `fillInPerson`'s address, composed: no complemento, so three lines. */
const PAULISTA_ADDRESS = 'Avenida Paulista, 1578\nBela Vista, São Paulo - SP\nCEP 01310-200';
/** What `/api/cep/78175000` answers: a city-wide CEP, with no rua and no bairro. */
const POCONE = { cep: '78175000', street: '', district: '', city: 'Poconé', state: 'MT' };

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const E = catalogs.events as {
  form: {
    titleCreate: string;
    close: string;
    submitCreate: string;
    editNote: string;
    cancel: string;
    cancelledLocked: string;
    when: { zone: string };
    address: { label: string; legacyHint: string; useCep: string; keepLegacy: string };
    cep: { searching: string; found: string; generic: string; notFound: string; failed: string };
    category: { label: string; helper: string };
    capacity: { label: string; helper: string };
    errors: {
      save: string;
      endBeforeStart: string;
      nameRequired: string;
      cepInvalid: string;
      stateInvalid: string;
      capacityInvalid: string;
    };
  };
  confirm: {
    discard: { titleCreate: string; titleEdit: string };
    delete: { title: string; confirm: string };
  };
  reactivate: { action: string };
  delete: { action: string };
  toasts: { created: string; saved: string };
};

const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const submitButton = () =>
  document.querySelector('[data-event-submit]') as HTMLButtonElement | null;
const alerts = () => document.querySelectorAll('[role="alert"]');
const type = (id: string, value: string) => fireEvent.change(field(id), { target: { value } });
const cepStatus = () => document.querySelector('[data-event-cep-status]') as HTMLElement;
/** The `address` the first call of an action received (`arg`: the body's position). */
const sentAddress = (mock: typeof create, arg = 0) =>
  (mock.mock.calls[0]?.[arg] as Record<string, unknown> | undefined)?.address;

function renderCreate() {
  return render(<EventForm mode="create" tenantName="Rede Demo" zoneLabel={ZONE} />);
}

/** Title and start (2026-10-12 19:00) and the venue: everything but the address. */
function fillButAddress() {
  type('event-title', 'Encontro anual');
  type('event-start-date', '2026-10-12');
  type('event-start-time', '19:00');
  type('event-venue', 'Auditório da sede');
}

/** Fills everything the Presencial side needs: the CEP looked up (stubbed), then the número. */
async function fillInPerson() {
  fillButAddress();
  type('event-cep', '01310200');
  await waitFor(() => expect(field('event-city').value).toBe('São Paulo'));
  type('event-number', '1578');
}

beforeEach(() => {
  for (const mock of [
    toast.show,
    push,
    replace,
    refresh,
    create,
    update,
    cancel,
    reactivate,
    remove,
    saveTicket,
    removeTicket,
  ]) {
    mock.mockReset();
  }
  uploads.list.length = 0;
  create.mockResolvedValue({ ok: true, eventId: EVENT_ID });
  update.mockResolvedValue({ ok: true, eventId: EVENT_ID });
  saveTicket.mockResolvedValue({ ok: true, recurring: false });
  removeTicket.mockResolvedValue({ ok: true });
  fetchMock.mockReset().mockImplementation(async () => json(PAULISTA));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

    // A task screen: the shell hides the BottomNav while this form is mounted.
    expect(document.querySelector('form')?.getAttribute('data-shell-hide')).toBe('nav');
    // PDF item #11: the date takes the free track beside an 8rem time, stacked below 360px, and
    // the temporal inputs carry the Input primitive's iOS guard.
    for (const id of ['event-start-date', 'event-end-date']) {
      const row = field(id).closest('.grid') as HTMLElement;
      expect(row.className).toContain('grid-cols-1');
      expect(row.className).toContain('min-[360px]:grid-cols-[minmax(0,1fr)_8rem]');
    }
    for (const id of ['event-start-date', 'event-start-time', 'event-end-date', 'event-end-time']) {
      expect(field(id).className).toContain('appearance-none');
    }

    // PDF item #10: create mode is always the CEP group, never the free-text field.
    const group = screen.getByRole('group', { name: E.form.address.label });
    expect(group.getAttribute('data-event-address')).toBe('structured');
    expect(document.getElementById('event-address')).toBeNull();
    expect(field('event-cep').getAttribute('inputmode')).toBe('numeric');
    for (const id of [
      'event-cep',
      'event-street',
      'event-number',
      'event-complement',
      'event-district',
      'event-city',
      'event-state',
    ]) {
      expect(field(id).getAttribute('autocomplete')).toBe('off');
    }
    expect(cepStatus().getAttribute('aria-live')).toBe('polite');
    expect(cepStatus().textContent).toBe('');
    expect(document.querySelector('[data-event-address-keep-legacy]')).toBeNull();
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

  it('3. a format switch submits ONLY the visible side, the address composed from its parts', async () => {
    renderCreate();
    await fillInPerson();
    // Type a URL under Online, then go back to Presencial.
    fireEvent.click(screen.getByRole('button', { name: /Online/ }));
    type('event-url', 'https://meet.example.test/sala');
    fireEvent.click(screen.getByRole('button', { name: /Presencial/ }));
    // The in-person values were kept in memory while hidden, the address parts included.
    expect(field('event-venue').value).toBe('Auditório da sede');
    expect(field('event-cep').value).toBe('01310-200');
    expect(field('event-number').value).toBe('1578');

    expect(submitButton()?.disabled).toBe(false);
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const sent = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.format).toBe('in_person');
    expect(sent.venueName).toBe('Auditório da sede');
    expect(sent.address).toBe(PAULISTA_ADDRESS);
    expect(sent).not.toHaveProperty('meetingUrl');
    expect(JSON.stringify(sent)).not.toContain('meet.example.test');
    expect(sent.start).toEqual({ date: '2026-10-12', time: '19:00' });
    expect(sent.end).toEqual({ date: '2026-10-12', time: '21:00' });
    // 2026-10-09: the new event takes the form's place (lib/form-exit.ts), never a push on it.
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/eventos/${EVENT_ID}`));
    expect(push).not.toHaveBeenCalled();
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: E.toasts.created });

    // …and the other way: Online sends the URL and no venue or address.
    cleanup();
    create.mockClear();
    renderCreate();
    await fillInPerson();
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
    await fillInPerson();
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

    // A typed CEP alone is a change too.
    cleanup();
    renderCreate();
    type('event-cep', '0131');
    fireEvent.click(screen.getByRole('button', { name: E.form.close }));
    await waitFor(() => expect(document.body.textContent).toContain(E.confirm.discard.titleCreate));
    expect(push).not.toHaveBeenCalled();
  });

  it('8. the CEP: one lookup on the 8th digit fills rua, bairro, cidade and UF, never número or complemento', async () => {
    renderCreate();
    type('event-number', '1578');
    type('event-complement', 'Sala 12');
    type('event-street', 'digitada antes');
    field('event-cep').focus();
    type('event-cep', '0131020');
    // Seven digits: no lookup, no status, and the hyphen already drawn.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(field('event-cep').value).toBe('01310-20');

    type('event-cep', '01310-200');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/cep/01310200');
    expect(cepStatus().textContent).toBe(E.form.cep.searching);
    await waitFor(() => expect(cepStatus().getAttribute('data-event-cep-status')).toBe('found'));
    expect(cepStatus().textContent).toBe(E.form.cep.found);
    expect(cepStatus().className).not.toContain('text-danger');
    expect(field('event-street').value).toBe('Avenida Paulista');
    expect(field('event-district').value).toBe('Bela Vista');
    expect(field('event-city').value).toBe('São Paulo');
    expect(field('event-state').value).toBe('SP');
    expect(field('event-number').value).toBe('1578');
    expect(field('event-complement').value).toBe('Sala 12');
    // Still in the CEP field when the answer came: focus moves on to the número.
    expect(document.activeElement?.id).toBe('event-number');

    // A 9th digit is dropped by the field, and the same CEP never fires twice.
    type('event-cep', '01310-2009');
    expect(field('event-cep').value).toBe('01310-200');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('9. a city-wide CEP keeps the rua and bairro the admin typed and asks for them', async () => {
    fetchMock.mockImplementation(async () =>
      json({ cep: '78175000', street: '', district: '', city: 'Poconé', state: 'MT' }),
    );
    renderCreate();
    type('event-street', 'Rua Coronel Pinto');
    type('event-district', 'Centro');
    type('event-cep', '78175000');
    await waitFor(() => expect(cepStatus().getAttribute('data-event-cep-status')).toBe('generic'));
    expect(cepStatus().textContent).toBe(E.form.cep.generic);
    expect(field('event-street').value).toBe('Rua Coronel Pinto');
    expect(field('event-district').value).toBe('Centro');
    expect(field('event-city').value).toBe('Poconé');
    expect(field('event-state').value).toBe('MT');
  });

  it('10. an unknown CEP and a failed lookup say so, and the address typed by hand still saves', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 404 }));
    renderCreate();
    fillButAddress();
    type('event-cep', '99999999');
    await waitFor(() =>
      expect(cepStatus().getAttribute('data-event-cep-status')).toBe('not_found'),
    );
    expect(cepStatus().textContent).toBe(E.form.cep.notFound);
    expect(cepStatus().className).toContain('text-danger');

    // A shorter CEP clears the line; a lookup that cannot answer says so.
    type('event-cep', '9999999');
    expect(cepStatus().textContent).toBe('');
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    type('event-cep', '99999998');
    await waitFor(() => expect(cepStatus().getAttribute('data-event-cep-status')).toBe('failed'));
    expect(cepStatus().textContent).toBe(E.form.cep.failed);
    expect(cepStatus().className).toContain('text-danger');

    // The submit opens with CEP, rua, cidade and UF filled; número and bairro are optional.
    expect(submitButton()?.disabled).toBe(true);
    type('event-street', 'Rua das Flores');
    expect(submitButton()?.disabled).toBe(true);
    type('event-city', 'Bom Jesus');
    expect(submitButton()?.disabled).toBe(true);
    type('event-state', 'pi');
    expect(field('event-state').value).toBe('PI');
    expect(submitButton()?.disabled).toBe(false);

    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(sentAddress(create)).toBe('Rua das Flores, s/n\nBom Jesus - PI\nCEP 99999-998');
  });

  it('11. a 7-digit CEP and an unknown UF open the submit but speak after it', async () => {
    renderCreate();
    await fillInPerson();
    type('event-cep', '0131020');
    type('event-state', 'XX');
    expect(alerts()).toHaveLength(0);
    expect(submitButton()?.disabled).toBe(false);

    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() =>
      expect(document.getElementById('event-cep-error')?.textContent).toBe(
        E.form.errors.cepInvalid,
      ),
    );
    expect(document.getElementById('event-state-error')?.textContent).toBe(
      E.form.errors.stateInvalid,
    );
    expect(field('event-state').getAttribute('aria-invalid')).toBe('true');
    expect(field('event-state').getAttribute('aria-describedby')).toBe('event-state-error');
    expect(document.querySelector('[data-event-form-error]')?.textContent).toBe(E.form.errors.save);
    expect(create).not.toHaveBeenCalled();

    // Fixing both clears both as the admin types.
    type('event-cep', '01310200');
    type('event-state', 'SP');
    expect(document.getElementById('event-cep-error')).toBeNull();
    expect(document.getElementById('event-state-error')).toBeNull();
  });

  it('14. a newer CEP aborts the pending lookup, so a slow answer for the old one never lands', async () => {
    let firstSignal: AbortSignal | null = null;
    // The first lookup hangs until its request is aborted, like a slow network.
    fetchMock.mockImplementationOnce(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          firstSignal = init?.signal ?? null;
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    renderCreate();
    type('event-cep', '78175000');
    expect(cepStatus().getAttribute('data-event-cep-status')).toBe('loading');

    type('event-cep', '01310200');
    expect((firstSignal as AbortSignal | null)?.aborted).toBe(true);
    await waitFor(() => expect(cepStatus().getAttribute('data-event-cep-status')).toBe('found'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/cep/01310200');
    expect(field('event-city').value).toBe('São Paulo');
  });

  it('15. another CEP takes back what the previous lookup wrote, never what the admin typed', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/cep/78175000') return json(POCONE);
      if (url === '/api/cep/99999999') return new Response(null, { status: 404 });
      return json(PAULISTA);
    });
    renderCreate();
    fillButAddress();
    type('event-cep', '01310200');
    await waitFor(() => expect(field('event-street').value).toBe('Avenida Paulista'));

    // A city-wide CEP: the rua and bairro were the old CEP's, so they go the moment it is typed,
    // and no address mixing the two places can be saved.
    type('event-cep', '78175000');
    expect(field('event-street').value).toBe('');
    expect(field('event-district').value).toBe('');
    await waitFor(() => expect(cepStatus().getAttribute('data-event-cep-status')).toBe('generic'));
    expect(field('event-street').value).toBe('');
    expect(field('event-district').value).toBe('');
    expect(field('event-city').value).toBe('Poconé');
    expect(field('event-state').value).toBe('MT');
    expect(submitButton()?.disabled).toBe(true);

    // A rua the admin changed after the lookup is theirs: it survives the next CEP.
    type('event-cep', '01310200');
    await waitFor(() => expect(field('event-street').value).toBe('Avenida Paulista'));
    type('event-street', 'Alameda Santos');
    type('event-cep', '78175000');
    await waitFor(() => expect(cepStatus().getAttribute('data-event-cep-status')).toBe('generic'));
    expect(field('event-street').value).toBe('Alameda Santos');
    expect(field('event-district').value).toBe('');
    expect(submitButton()?.disabled).toBe(false);

    // An unknown CEP takes back the cidade and UF the city-wide lookup wrote, too.
    type('event-cep', '99999999');
    await waitFor(() =>
      expect(cepStatus().getAttribute('data-event-cep-status')).toBe('not_found'),
    );
    expect(field('event-city').value).toBe('');
    expect(field('event-state').value).toBe('');
    expect(field('event-street').value).toBe('Alameda Santos');
  });

  it('16. a digit typed into a full CEP is refused, as a maxLength would; a paste goes through', async () => {
    renderCreate();
    type('event-cep', '01310200');
    await waitFor(() => expect(cepStatus().getAttribute('data-event-cep-status')).toBe('found'));
    const cep = field('event-cep');
    /** One native edit: the value the browser left, the caret after it, and what was inserted. */
    const edit = (value: string, caret: number, inputType: string, data: string) =>
      fireEvent.input(cep, {
        target: { value, selectionStart: caret, selectionEnd: caret },
        inputType,
        data,
      });

    // "9" typed in front of 01310-200 would read 90131-020 (the first 8 digits), and inside it
    // 01391-020: both refused, the caret back where it was, and nothing asked.
    edit('901310-200', 1, 'insertText', '9');
    expect(cep.value).toBe('01310-200');
    expect(cep.selectionStart).toBe(0);
    edit('013910-200', 4, 'insertText', '9');
    expect(cep.value).toBe('01310-200');
    expect(cep.selectionStart).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(field('event-street').value).toBe('Avenida Paulista');

    // A paste in front goes through as before: the first 8 digits are the CEP, asked at once.
    edit('04538-13301310-200', 9, 'insertFromPaste', '04538-133');
    expect(cep.value).toBe('04538-133');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/cep/04538133');
    await waitFor(() => expect(cepStatus().getAttribute('data-event-cep-status')).toBe('found'));

    // So does a typed replacement of a selection (the hyphen selected, a digit typed over it).
    edit('045389133', 6, 'insertText', '9');
    expect(cep.value).toBe('04538-913');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/cep/04538913');
    await waitFor(() => expect(cepStatus().getAttribute('data-event-cep-status')).toBe('found'));
  });

  it('19. the same CEP typed back keeps its own answer; what the admin types after a failed lookup stays', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/cep/99999999') return new Response(null, { status: 404 });
      return json(PAULISTA);
    });
    renderCreate();
    fillButAddress();
    type('event-cep', '01310200');
    await waitFor(() => expect(field('event-street').value).toBe('Avenida Paulista'));

    // A digit deleted and typed back is the SAME CEP: its answer is not taken back, not even when
    // the new lookup fails.
    type('event-cep', '0131020');
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    type('event-cep', '01310200');
    await waitFor(() => expect(cepStatus().getAttribute('data-event-cep-status')).toBe('failed'));
    expect(field('event-street').value).toBe('Avenida Paulista');
    expect(field('event-district').value).toBe('Bela Vista');
    expect(field('event-city').value).toBe('São Paulo');
    expect(field('event-state').value).toBe('SP');

    // Another CEP takes the Paulista back. Its lookup fails, and what the admin then types is
    // theirs, even when it equals what the old lookup had written: the next CEP keeps it.
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    type('event-cep', '99999998');
    expect(field('event-city').value).toBe('');
    await waitFor(() => expect(cepStatus().getAttribute('data-event-cep-status')).toBe('failed'));
    type('event-city', 'São Paulo');
    type('event-state', 'SP');
    type('event-cep', '99999999');
    await waitFor(() =>
      expect(cepStatus().getAttribute('data-event-cep-status')).toBe('not_found'),
    );
    expect(field('event-city').value).toBe('São Paulo');
    expect(field('event-state').value).toBe('SP');
  });
});

describe('EventForm — category and capacity (2026-10-03)', () => {
  it('19. both are optional: the category is capped at 40, the limit keeps digits only, and both are sent', async () => {
    renderCreate();
    expect(field('event-category').getAttribute('maxlength')).toBe('40');
    expect(document.querySelector('label[for="event-category"]')?.textContent).toBe(
      E.form.category.label,
    );
    expect(document.body.textContent).toContain(E.form.category.helper);
    const capacity = field('event-capacity');
    expect(document.querySelector('label[for="event-capacity"]')?.textContent).toBe(
      E.form.capacity.label,
    );
    expect(capacity.getAttribute('inputmode')).toBe('numeric');
    expect(capacity.getAttribute('maxlength')).toBe('6');
    expect(capacity.getAttribute('aria-describedby')).toBe('event-capacity-helper');
    expect(document.getElementById('event-capacity-helper')?.textContent).toBe(
      E.form.capacity.helper,
    );
    // Neither is required: the submit opens without them (claim 1's rule).
    await fillInPerson();
    expect(submitButton()?.disabled).toBe(false);

    // Whatever is typed or pasted, only the digits stay, at most six.
    type('event-capacity', '1a2.5');
    expect(capacity.value).toBe('125');
    type('event-capacity', '12345678');
    expect(capacity.value).toBe('123456');
    type('event-capacity', '125');
    type('event-category', '  Workshop ');

    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const sent = create.mock.calls[0]?.[0] as Record<string, unknown>;
    // The action receives the schema's parse: the category trimmed, the limit a number.
    expect(sent.category).toBe('Workshop');
    expect(sent.capacity).toBe(125);
  });

  it('20. an empty limit is sent as null; 0 or more than 100.000 speaks after the submit and sends nothing', async () => {
    renderCreate();
    await fillInPerson();
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const plain = create.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(plain?.capacity).toBeNull();
    // An online event carries both too.
    cleanup();
    create.mockClear();
    renderCreate();
    await fillInPerson();
    fireEvent.click(screen.getByRole('button', { name: /Online/ }));
    type('event-url', 'https://meet.example.test/sala');
    type('event-capacity', '80');
    type('event-category', 'Live');
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      format: 'online',
      capacity: 80,
      category: 'Live',
    });

    for (const bad of ['0', '100001']) {
      cleanup();
      create.mockClear();
      renderCreate();
      await fillInPerson();
      type('event-capacity', bad);
      expect(alerts()).toHaveLength(0);
      fireEvent.submit(document.querySelector('form') as HTMLFormElement);
      await waitFor(() =>
        expect(document.getElementById('event-capacity-error')?.textContent).toBe(
          E.form.errors.capacityInvalid,
        ),
      );
      expect(field('event-capacity').getAttribute('aria-invalid')).toBe('true');
      expect(field('event-capacity').getAttribute('aria-describedby')).toBe(
        'event-capacity-error event-capacity-helper',
      );
      expect(create).not.toHaveBeenCalled();
      // Fixing it clears the message as the admin types.
      type('event-capacity', '30');
      expect(document.getElementById('event-capacity-error')).toBeNull();
    }
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

  function renderEdit(
    flags: {
      canCancel?: boolean;
      canReactivate?: boolean;
      cancelledLocked?: boolean;
    },
    address = initial.address,
  ) {
    return render(
      <EventForm
        mode="edit"
        eventId={EVENT_ID}
        initial={{ ...initial, address }}
        tenantName="Rede Demo"
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

    // A legacy free-text address (the seed's): today's textarea, the hint and the switch.
    expect(field('event-address').value).toBe('Rua das Flores, 100');
    expect(document.querySelector('[data-event-address="legacy"]')?.textContent).toContain(
      E.form.address.legacyHint,
    );
    expect(document.querySelector('[data-event-address-use-cep]')?.textContent).toBe(
      E.form.address.useCep,
    );
    expect(document.getElementById('event-cep')).toBeNull();

    type('event-start-time', '18:00');
    expect(field('event-end-time').value).toBe('21:00');

    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[0]).toBe(EVENT_ID);
    // Untouched, the legacy text is sent exactly as it arrived.
    expect(sentAddress(update, 1)).toBe('Rua das Flores, 100');
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

  it('22. the row ends with the live "Excluir evento"; creating has none', async () => {
    remove.mockResolvedValue({ ok: true, eventId: EVENT_ID });
    renderEdit({ canCancel: true });
    const control = document.querySelector('[data-delete-control="event"]') as HTMLElement;
    const button = within(control).getByRole('button', { name: E.delete.action });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(control.textContent).not.toContain('Em breve');
    expect(screen.queryByRole('dialog')).toBeNull();

    // The tap only opens the explained confirmation; the confirm deletes and lands on the list.
    fireEvent.click(button);
    expect(screen.getByRole('dialog').textContent).toContain(E.confirm.delete.title);
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: E.confirm.delete.confirm }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/eventos'));
    expect(remove).toHaveBeenCalledWith(EVENT_ID);
    expect(update).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    cleanup();

    // An event already over has no status control, and still the delete control.
    renderEdit({});
    expect(document.querySelector('[data-event-cancel]')).toBeNull();
    expect(document.querySelector('[data-delete-control="event"]')).not.toBeNull();
    cleanup();

    renderCreate();
    expect(document.querySelector('[data-delete-control]')).toBeNull();
  });

  it('22b. with unsaved edits the confirmed delete lands on the list and the discard guard never opens', async () => {
    remove.mockResolvedValue({ ok: true, eventId: EVENT_ID });
    renderEdit({ canCancel: true });
    fireEvent.change(field('event-title'), { target: { value: 'Outro nome, ainda sem salvar' } });

    fireEvent.click(
      within(document.querySelector('[data-delete-control="event"]') as HTMLElement).getByRole(
        'button',
        { name: E.delete.action },
      ),
    );
    // Only the delete confirmation is open, never the form's own discard one.
    expect(screen.queryByText(E.confirm.discard.titleEdit)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: E.confirm.delete.confirm }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/eventos'));
    expect(screen.queryByText(E.confirm.discard.titleEdit)).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('12. a composed address comes back as its parts, clean, and saves the same string', async () => {
    const stored =
      'Avenida Paulista, 1578\nSala 12, bloco B\nBela Vista, São Paulo - SP\nCEP 01310-200';
    renderEdit({ canCancel: true }, stored);
    expect(document.getElementById('event-address')).toBeNull();
    expect(field('event-cep').value).toBe('01310-200');
    expect(field('event-street').value).toBe('Avenida Paulista');
    expect(field('event-number').value).toBe('1578');
    expect(field('event-complement').value).toBe('Sala 12, bloco B');
    expect(field('event-district').value).toBe('Bela Vista');
    expect(field('event-city').value).toBe('São Paulo');
    expect(field('event-state').value).toBe('SP');
    // Restored parts are never looked up again, and arrive with no way back to a legacy text.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('[data-event-address-keep-legacy]')).toBeNull();

    // Untouched, it is not dirty: the X leaves at once.
    fireEvent.click(screen.getByRole('button', { name: E.form.close }));
    expect(push).toHaveBeenCalledWith(`/eventos/${EVENT_ID}`);

    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(sentAddress(update, 1)).toBe(stored);
  });

  it('13. a legacy address switches to parts from its own CEP, and back to the text untouched', async () => {
    const legacy = 'Av. Paulista, 1578 - Bela Vista, São Paulo - SP, 01310-200';
    renderEdit({ canCancel: true }, legacy);
    fireEvent.click(screen.getByRole('button', { name: E.form.address.useCep }));

    // The CEP found in the text is prefilled and looked up at once; focus lands on the CEP group.
    expect(field('event-cep').value).toBe('01310-200');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/cep/01310200');
    await waitFor(() => expect(field('event-street').value).toBe('Avenida Paulista'));
    expect(field('event-number').value).toBe('');
    expect(document.getElementById('event-address')).toBeNull();

    // Back to the text: the same string, and the form is clean again (the X leaves at once).
    fireEvent.click(screen.getByRole('button', { name: E.form.address.keepLegacy }));
    expect(field('event-address').value).toBe(legacy);
    expect(document.activeElement?.getAttribute('data-event-address-use-cep')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: E.form.close }));
    expect(push).toHaveBeenCalledWith(`/eventos/${EVENT_ID}`);

    // The switch itself is a change: the X asks first.
    cleanup();
    push.mockClear();
    renderEdit({ canCancel: true }, legacy);
    fireEvent.click(screen.getByRole('button', { name: E.form.address.useCep }));
    fireEvent.click(screen.getByRole('button', { name: E.form.close }));
    await waitFor(() => expect(document.body.textContent).toContain(E.confirm.discard.titleEdit));
    expect(push).not.toHaveBeenCalled();
  });

  it('17. a restored CEP is not looked up again until its digits change', async () => {
    const stored =
      'Av. Paulista (entrada pela Al. Santos), 1578\nBela Vista, São Paulo - SP\nCEP 01310-200';
    renderEdit({ canCancel: true }, stored);
    // A 9th digit the field drops and the same CEP pasted again carry the same digits: no change,
    // so no lookup overwrites the rua the admin wrote, and the form stays clean.
    type('event-cep', '01310-2009');
    type('event-cep', 'CEP 01310-200');
    expect(field('event-cep').value).toBe('01310-200');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(field('event-street').value).toBe('Av. Paulista (entrada pela Al. Santos)');
    fireEvent.click(screen.getByRole('button', { name: E.form.close }));
    expect(push).toHaveBeenCalledWith(`/eventos/${EVENT_ID}`);

    // Deleting a digit and typing it back asks again, on purpose, and the answer fills the parts.
    type('event-cep', '01310-20');
    expect(fetchMock).not.toHaveBeenCalled();
    type('event-cep', '01310-200');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(field('event-street').value).toBe('Avenida Paulista'));
    expect(field('event-number').value).toBe('1578');
  });

  it('18. "Preencher pelo CEP" again, after going back before the answer, asks for the kept CEP', async () => {
    let firstSignal: AbortSignal | null = null;
    // The first lookup hangs until its request is aborted, like a slow network.
    fetchMock.mockImplementationOnce(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          firstSignal = init?.signal ?? null;
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    renderEdit({ canCancel: true }, 'Av. Paulista, 1578 - Bela Vista, São Paulo - SP, 01310-200');
    fireEvent.click(screen.getByRole('button', { name: E.form.address.useCep }));
    expect(cepStatus().getAttribute('data-event-cep-status')).toBe('loading');
    type('event-number', '1578');
    // Back to the text before the answer: the lookup is aborted.
    fireEvent.click(screen.getByRole('button', { name: E.form.address.keepLegacy }));
    expect((firstSignal as AbortSignal | null)?.aborted).toBe(true);

    // Again: the CEP the parts kept is asked at once (a número never holds the lookup back).
    fireEvent.click(screen.getByRole('button', { name: E.form.address.useCep }));
    expect(field('event-cep').value).toBe('01310-200');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/cep/01310200');
    await waitFor(() => expect(cepStatus().getAttribute('data-event-cep-status')).toBe('found'));
    expect(field('event-street').value).toBe('Avenida Paulista');
    expect(field('event-number').value).toBe('1578');
  });

  it('21. 2026-10-03: the stored category and limit come back, clean, and a cleared limit is sent as null', async () => {
    render(
      <EventForm
        mode="edit"
        eventId={EVENT_ID}
        initial={{ ...initial, category: 'Imersão presencial', capacity: 40 }}
        tenantName="Rede Demo"
        zoneLabel={ZONE}
        canCancel
      />,
    );
    expect(field('event-category').value).toBe('Imersão presencial');
    expect(field('event-capacity').value).toBe('40');
    // Untouched, it is not dirty: the X leaves at once.
    fireEvent.click(screen.getByRole('button', { name: E.form.close }));
    expect(push).toHaveBeenCalledWith(`/eventos/${EVENT_ID}`);

    // Clearing the limit is a change (the X asks first), and it is SENT as null: the PUT is a
    // whole-event replacement, so the stored limit goes.
    push.mockClear();
    type('event-capacity', '');
    fireEvent.click(screen.getByRole('button', { name: E.form.close }));
    await waitFor(() => expect(document.body.textContent).toContain(E.confirm.discard.titleEdit));
    expect(push).not.toHaveBeenCalled();
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const sent = update.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(sent.capacity).toBeNull();
    expect(sent.category).toBe('Imersão presencial');
  });

  it('18b. the CEP asked again is the one the admin typed, never the one in the old text', async () => {
    // Every lookup hangs until it is aborted, like a slow network.
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    renderEdit({ canCancel: true }, 'Av. Paulista, 1578 - Bela Vista, São Paulo - SP, 01310-200');
    fireEvent.click(screen.getByRole('button', { name: E.form.address.useCep }));
    // The admin corrects the CEP the text carried before any answer, then goes back to the text.
    type('event-cep', '04538133');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/cep/04538133');
    fireEvent.click(screen.getByRole('button', { name: E.form.address.keepLegacy }));

    fireEvent.click(screen.getByRole('button', { name: E.form.address.useCep }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/cep/04538133');
    expect(field('event-cep').value).toBe('04538-133');
  });
});

describe('EventForm — the cover shows as soon as it is uploaded (2026-10-06)', () => {
  it('shows the picked file while the server still derives the ladder, and the gradient once removed', () => {
    const made: string[] = [];
    const revoked: string[] = [];
    const originals = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    const setStatic = (name: 'createObjectURL' | 'revokeObjectURL', value: unknown) =>
      Object.defineProperty(URL, name, { configurable: true, writable: true, value });
    setStatic('createObjectURL', () => {
      const url = `blob:capa-${made.length + 1}`;
      made.push(url);
      return url;
    });
    setStatic('revokeObjectURL', (url: string) => revoked.push(url));
    renderCreate();
    expect(document.querySelector('[data-testid="event-cover-fallback"]')).not.toBeNull();

    // `complete` answers an image still `processing`: no variant yet.
    act(() => {
      uploads.list[0]?.options.onPicked?.(new File(['jpg'], 'capa.jpg', { type: 'image/jpeg' }));
      uploads.list[0]?.options.onCompleted({
        id: '0c000000-0000-4000-8000-0000000000c1',
        variants: [],
      });
    });
    const shown = document.querySelector<HTMLImageElement>(
      '[data-event-cover-preview] img[data-cover-local-preview]',
    );
    expect(shown?.getAttribute('src')).toBe('blob:capa-1');
    expect(document.querySelector('[data-testid="event-cover-image"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: lookup('events', 'form.cover.remove') }));
    expect(document.querySelector('[data-cover-local-preview]')).toBeNull();
    expect(document.querySelector('[data-testid="event-cover-fallback"]')).not.toBeNull();

    cleanup();
    expect(revoked).toContain('blob:capa-1');
    setStatic('createObjectURL', originals.create);
    setStatic('revokeObjectURL', originals.revoke);
  });
});

describe('EventForm — the vertical poster as a real, independent upload (NOVF-04, UI-D-693)', () => {
  const POSTER = '0b000000-0000-4000-8000-0000000000b1';
  const NEW_POSTER = '0b000000-0000-4000-8000-0000000000b2';
  const COVER = '0c000000-0000-4000-8000-0000000000c1';
  const asset = (id: string) => ({ id, variants: [{ width: 640 }] });
  const done = (slot: number, id: string) =>
    act(() => {
      uploads.list[slot]?.options.onCompleted(asset(id));
    });
  const hold = (slot: number, state: string, progress = 0) =>
    act(() => {
      uploads.list[slot]?.setState(state);
      uploads.list[slot]?.setProgress(progress);
    });
  const posterField = () => document.querySelector('[data-event-poster-field]') as HTMLElement;
  const posterError = () => document.querySelector('[data-event-poster-error]');
  const posterRemove = () =>
    screen.queryByRole('button', { name: lookup('events', 'form.cover.posterRemove') });
  const submitForm = async () => {
    await act(async () => {
      fireEvent.submit(document.querySelector('[data-event-form]') as HTMLFormElement);
    });
  };
  const sentBody = (mock: typeof update, arg = 0) =>
    mock.mock.calls[0]?.[arg] as Record<string, unknown>;

  const stored = {
    title: 'Encontro anual',
    description: '',
    coverAssetId: null,
    coverVariantWidths: [],
    format: 'online' as const,
    venueName: '',
    address: '',
    meetingUrl: 'https://meet.example.com/x',
    start: { date: '2026-10-12', time: '19:00' },
    end: { date: '2026-10-12', time: '21:00' },
  };
  const renderEditWith = (initial: Record<string, unknown> = {}) =>
    render(
      <EventForm
        mode="edit"
        eventId={EVENT_ID}
        initial={{ ...stored, ...initial }}
        tenantName="Rede Demo"
        zoneLabel={ZONE}
      />,
    );

  it('1. the poster is a second upload of its own: a poster and a cover are two different ids in the save', async () => {
    renderCreate();
    expect(uploads.list).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Online/ }));
    type('event-title', 'Encontro anual');
    type('event-start-date', '2026-10-12');
    type('event-start-time', '19:00');
    type('event-url', 'https://meet.example.com/x');
    await done(0, COVER);
    await done(1, POSTER);
    await submitForm();
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(sentBody(create)).toMatchObject({ coverAssetId: COVER, posterAssetId: POSTER });
  });

  it('2. every save sends the poster key: null for a poster never set, never omitted', async () => {
    renderCreate();
    fireEvent.click(screen.getByRole('button', { name: /Online/ }));
    type('event-title', 'Sem pôster');
    type('event-start-date', '2026-10-12');
    type('event-start-time', '19:00');
    type('event-url', 'https://meet.example.com/x');
    await submitForm();
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect('posterAssetId' in sentBody(create)).toBe(true);
    expect(sentBody(create).posterAssetId).toBeNull();
  });

  it('3. an edit that changes something else re-sends the stored poster id (a PUT replaces the whole event)', async () => {
    renderEditWith({ posterAssetId: POSTER, posterVariantWidths: [640] });
    type('event-title', 'Outro nome');
    await submitForm();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[0]).toBe(EVENT_ID);
    expect(sentBody(update, 1).posterAssetId).toBe(POSTER);
  });

  it('4. removing the stored poster sends null, and a poster-only edit is a real change', async () => {
    renderEditWith({ posterAssetId: POSTER, posterVariantWidths: [640] });
    fireEvent.click(posterRemove() as HTMLElement);
    expect(posterRemove()).toBeNull();
    // Leaving now asks first: the poster alone made the form dirty.
    fireEvent.click(screen.getByRole('button', { name: E.form.close }));
    expect(screen.getByRole('dialog', { name: E.confirm.discard.titleEdit })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar editando' }));
    await submitForm();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(sentBody(update, 1).posterAssetId).toBeNull();
  });

  it('5. the stored poster opens in its own frame and the add or change label follows it', () => {
    renderEditWith({ posterAssetId: POSTER, posterVariantWidths: [640] });
    expect(posterRemove()).not.toBeNull();
    expect(
      screen.getAllByRole('button', { name: lookup('events', 'form.cover.posterChange') }).length,
    ).toBeGreaterThan(0);
    cleanup();
    renderEditWith();
    expect(posterRemove()).toBeNull();
    expect(
      screen.getAllByRole('button', { name: lookup('events', 'form.cover.posterAdd') }).length,
    ).toBeGreaterThan(0);
  });

  it('6. the poster has its own progress and Cancelar; Save is disabled while EITHER image uploads', async () => {
    renderEditWith();
    type('event-title', 'Outro nome');
    expect(submitButton()?.disabled).toBe(false);

    await hold(1, 'progress', 40);
    expect(submitButton()?.disabled).toBe(true);
    const bar = within(posterField()).getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    // Only the poster block draws a bar.
    expect(document.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
    fireEvent.click(within(posterField()).getByRole('button', { name: lookup('media', 'cancel') }));
    expect(uploads.list[1]?.cancel).toHaveBeenCalledTimes(1);
    expect(uploads.list[0]?.cancel).not.toHaveBeenCalled();

    await hold(1, 'idle');
    expect(submitButton()?.disabled).toBe(false);
    await hold(0, 'preparing');
    expect(submitButton()?.disabled).toBe(true);
    await hold(0, 'idle');
    expect(submitButton()?.disabled).toBe(false);
  });

  it('7. poster_invalid shows its own sentence under the poster block only, keeps the draft and the top card stays quiet', async () => {
    update.mockResolvedValue({ ok: false, code: 'poster_invalid' });
    renderEditWith();
    await done(1, NEW_POSTER);
    await submitForm();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(posterError()?.textContent).toBe(
      'Não foi possível usar esta imagem como capa vertical. Escolha outra.',
    );
    expect(posterError()?.getAttribute('role')).toBe('alert');
    expect(within(posterField()).getByText(/capa vertical\. Escolha outra/)).toBeTruthy();
    // The cover's own refusal line is a different one.
    expect(alerts()).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('8. the poster helper names the fallbacks and the tenant', () => {
    renderEditWith();
    expect(posterField().textContent).toContain(
      'Opcional. Sem capa vertical, a lista usa a capa horizontal ou as cores de Rede Demo.',
    );
  });

  it('9. a poster picked while a cover is set stays independent: the horizontal cover id is untouched', async () => {
    renderEditWith({ coverAssetId: COVER, coverVariantWidths: [640] });
    await done(1, NEW_POSTER);
    type('event-title', 'Outro nome');
    await submitForm();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(sentBody(update, 1)).toMatchObject({ coverAssetId: COVER, posterAssetId: NEW_POSTER });
  });

  it('10. the pick goes through the poster upload machine: its input, a drop on the frame', () => {
    renderEditWith();
    const file = new File(['x'], 'p.jpg', { type: 'image/jpeg' });
    fireEvent.change(posterField().querySelector('[data-event-poster-input]') as HTMLElement, {
      target: { files: [file] },
    });
    expect(uploads.list[1]?.pick).toHaveBeenCalledWith(file);
    expect(uploads.list[0]?.pick).not.toHaveBeenCalled();
    const dropped = new File(['y'], 'q.jpg', { type: 'image/jpeg' });
    fireEvent.drop(posterField().querySelector('[data-event-poster-preview]') as HTMLElement, {
      dataTransfer: { files: [dropped] },
    });
    expect(uploads.list[1]?.pick).toHaveBeenLastCalledWith(dropped);
    expect(uploads.list[0]?.pick).not.toHaveBeenCalled();
  });
});

describe('EventForm — step 2, the "Informações úteis" (2026-10-06)', () => {
  const extrasList = (id: string) =>
    document.querySelector(`[data-extras-list="${id}"]`) as HTMLElement;
  const step = (n: 1 | 2) => document.querySelector(`[data-event-step="${n}"]`) as HTMLElement;

  it('step 2 stores its block at the end of the description; the header saves from either step', async () => {
    renderCreate();
    await fillInPerson();
    type('event-description', 'Dois dias de imersão.');
    expect(step(2).hasAttribute('hidden')).toBe(true);

    fireEvent.click(document.querySelector('[data-event-step-next]') as HTMLElement);
    expect(step(1).hasAttribute('hidden')).toBe(true);
    expect(step(2).hasAttribute('hidden')).toBe(false);

    type('event-dress-code', 'Casual + scrub');
    // "Adicionar" and Enter both add; a repeated item is ignored.
    type('event-included', 'Coffee break');
    fireEvent.click(extrasList('event-included').querySelector('button') as HTMLElement);
    type('event-included', 'Material de apoio');
    fireEvent.keyDown(field('event-included'), { key: 'Enter' });
    type('event-included', 'Coffee break');
    fireEvent.keyDown(field('event-included'), { key: 'Enter' });
    type('event-bring', 'Documento com foto');
    fireEvent.keyDown(field('event-bring'), { key: 'Enter' });
    fireEvent.click(
      screen.getByRole('switch', { name: lookup('events', 'form.extras.certificate.label') }),
    );
    type('event-certificate-hours', '16');

    expect(submitButton()?.disabled).toBe(false);
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const sent = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.description).toBe(
      [
        'Dois dias de imersão.',
        '',
        'Informações úteis',
        'Traje: Casual + scrub',
        'Incluso no ingresso: Coffee break · Material de apoio',
        'O que levar: Documento com foto',
        'Certificado: 16 horas',
      ].join('\n'),
    );
  });

  it('a chip leaves with its own remove control; an empty step 2 stores the text alone', async () => {
    renderCreate();
    await fillInPerson();
    type('event-description', 'Só o texto.');
    fireEvent.click(document.querySelector('[data-event-step-next]') as HTMLElement);
    type('event-bring', 'Notebook');
    fireEvent.keyDown(field('event-bring'), { key: 'Enter' });
    fireEvent.click(
      screen.getByRole('button', {
        name: lookup('events', 'form.extras.remove', { item: 'Notebook' }),
      }),
    );
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const sent = create.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(sent?.description).toBe('Só o texto.');
  });

  describe('the "Cronograma" (2026-10-06, its own field since 2026-10-07)', () => {
    const editor = () => document.querySelector('[data-schedule-editor]') as HTMLElement;
    const addButton = () => editor().querySelector('[data-schedule-add]') as HTMLButtonElement;
    const moments = () =>
      [...editor().querySelectorAll('[data-schedule-item]')].map((item) => item.textContent);
    const next = () =>
      fireEvent.click(document.querySelector('[data-event-step-next]') as HTMLElement);

    /** The old storage format: the programme as text in the description, as a literal. */
    const LEGACY =
      'Texto.\n\nInformações úteis\nProgramação\n19:00 · Credenciamento\n20:00 · Painel';

    const editForm = (initial: Record<string, unknown> = {}) =>
      render(
        <EventForm
          mode="edit"
          eventId={EVENT_ID}
          initial={{
            title: 'Encontro anual',
            description: 'Texto.',
            coverAssetId: null,
            coverVariantWidths: [],
            format: 'in_person',
            venueName: 'Auditório da sede',
            address: 'Rua das Flores, 100',
            meetingUrl: '',
            start: { date: '2026-10-12', time: '19:00' },
            end: { date: '2026-10-12', time: '21:00' },
            ...initial,
          }}
          tenantName="Rede Demo"
          zoneLabel={ZONE}
        />,
      );

    const removeMoment = (time: string, what: string) =>
      fireEvent.click(
        screen.getByRole('button', {
          name: lookup('events', 'form.extras.schedule.remove', { time, what }),
          hidden: true,
        }),
      );

    it('a one-day event: no day field; the time and the text add a moment, sorted, sent as its own field', async () => {
      renderCreate();
      await fillInPerson();
      type('event-description', 'Encontro.');
      next();
      expect(editor().querySelector('[role="combobox"]')).toBeNull();
      // Nothing to add until both the time and the text are there.
      expect(addButton().disabled).toBe(true);
      type('event-schedule-time', '20:00');
      expect(addButton().disabled).toBe(true);
      type('event-schedule-what', 'Painel com convidados');
      expect(addButton().disabled).toBe(false);
      fireEvent.click(addButton());
      // The fields empty out for the next moment; Enter in the text adds too.
      expect(field('event-schedule-what').value).toBe('');
      type('event-schedule-time', '19:00');
      type('event-schedule-what', 'Credenciamento');
      fireEvent.keyDown(field('event-schedule-what'), { key: 'Enter' });
      // The same moment twice is kept once.
      type('event-schedule-time', '19:00');
      type('event-schedule-what', 'Credenciamento');
      fireEvent.click(addButton());
      expect(moments()).toEqual(['19:00Credenciamento', '20:00Painel com convidados']);

      fireEvent.submit(document.querySelector('form') as HTMLFormElement);
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      const sent = create.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(sent.schedule).toEqual([
        { day: 1, time: '19:00', title: 'Credenciamento' },
        { day: 1, time: '20:00', title: 'Painel com convidados' },
      ]);
      // The description carries the text alone: no heading, no programme lines.
      expect(sent.description).toBe('Encontro.');
    });

    it('a form with only a schedule sends the plain description', async () => {
      renderCreate();
      await fillInPerson();
      next();
      type('event-schedule-time', '19:00');
      type('event-schedule-what', 'Credenciamento');
      fireEvent.click(addButton());
      fireEvent.submit(document.querySelector('form') as HTMLFormElement);
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      const sent = create.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(sent.schedule).toEqual([{ day: 1, time: '19:00', title: 'Credenciamento' }]);
      expect(sent.description).toBe('');
    });

    it('an event with no schedule sends a payload with NO schedule key at all', async () => {
      renderCreate();
      await fillInPerson();
      type('event-description', 'Encontro.');
      fireEvent.submit(document.querySelector('form') as HTMLFormElement);
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      const sent = create.mock.calls[0]?.[0] as Record<string, unknown>;
      expect('schedule' in sent).toBe(false);
    });

    it('an event over several days asks for the day, each with its date, and keeps the day numbers', async () => {
      renderCreate();
      await fillInPerson();
      type('event-end-date', '2026-10-13');
      type('event-end-time', '18:00');
      next();
      const day = editor().querySelector('[role="combobox"]') as HTMLElement;
      expect(day).not.toBeNull();
      fireEvent.click(day);
      const options = screen.getAllByRole('option');
      expect(options.map((option) => option.textContent?.slice(0, 8))).toEqual([
        'Dia 1 · ',
        'Dia 2 · ',
      ]);
      fireEvent.click(screen.getByRole('option', { name: /^Dia 2/ }));
      type('event-schedule-time', '09:00');
      type('event-schedule-what', 'Abertura do segundo dia');
      fireEvent.click(addButton());
      fireEvent.click(day);
      fireEvent.click(screen.getByRole('option', { name: /^Dia 1/ }));
      type('event-schedule-time', '19:00');
      type('event-schedule-what', 'Credenciamento');
      fireEvent.click(addButton());
      // Grouped by day, day 1 first.
      expect(moments()).toEqual(['19:00Credenciamento', '09:00Abertura do segundo dia']);

      fireEvent.submit(document.querySelector('form') as HTMLFormElement);
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      const sent = create.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(sent.schedule).toEqual([
        { day: 1, time: '19:00', title: 'Credenciamento' },
        { day: 2, time: '09:00', title: 'Abertura do segundo dia' },
      ]);
      expect(sent.description).toBe('');
    });

    it('edit: the programme from the API comes back as its moments; untouched, the form is clean', () => {
      editForm({
        schedule: [
          { day: 1, time: '19:00', title: 'Credenciamento' },
          { day: 1, time: '20:00', title: 'Painel' },
        ],
      });
      expect(moments()).toEqual(['19:00Credenciamento', '20:00Painel']);
      // Unchanged, the form is clean: the X leaves without asking.
      fireEvent.click(screen.getByRole('button', { name: lookup('events', 'form.close') }));
      expect(push).toHaveBeenCalledWith(`/eventos/${EVENT_ID}`);
    });

    it('edit: removing a moment saves the remaining ones as `schedule` and the description alone', async () => {
      editForm({
        schedule: [
          { day: 1, time: '19:00', title: 'Credenciamento' },
          { day: 1, time: '20:00', title: 'Painel' },
        ],
      });
      removeMoment('20:00', 'Painel');
      expect(moments()).toEqual(['19:00Credenciamento']);
      fireEvent.submit(document.querySelector('form') as HTMLFormElement);
      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      const sent = update.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(sent.schedule).toEqual([{ day: 1, time: '19:00', title: 'Credenciamento' }]);
      expect(sent.description).toBe('Texto.');
    });

    it('edit: removing the last moment sends NO schedule key (the PUT then clears the stored value)', async () => {
      editForm({ schedule: [{ day: 1, time: '19:00', title: 'Credenciamento' }] });
      removeMoment('19:00', 'Credenciamento');
      fireEvent.submit(document.querySelector('form') as HTMLFormElement);
      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      const sent = update.mock.calls[0]?.[1] as Record<string, unknown>;
      expect('schedule' in sent).toBe(false);
    });

    it('LEGACY edit: the old text schedule seeds the moments, the description shows the text alone, and it is clean', () => {
      editForm({ description: LEGACY });
      expect((document.getElementById('event-description') as HTMLTextAreaElement).value).toBe(
        'Texto.',
      );
      expect(moments()).toEqual(['19:00Credenciamento', '20:00Painel']);
      // An untouched legacy event is clean: moving the schedule is not an edit.
      fireEvent.click(screen.getByRole('button', { name: lookup('events', 'form.close') }));
      expect(push).toHaveBeenCalledWith(`/eventos/${EVENT_ID}`);
    });

    it('LEGACY edit: a title-only change moves the schedule into `schedule` and drops the programme lines', async () => {
      editForm({ description: LEGACY });
      type('event-title', 'Encontro anual 2026');
      fireEvent.submit(document.querySelector('form') as HTMLFormElement);
      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      const sent = update.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(sent.title).toBe('Encontro anual 2026');
      expect(sent.schedule).toEqual([
        { day: 1, time: '19:00', title: 'Credenciamento' },
        { day: 1, time: '20:00', title: 'Painel' },
      ]);
      expect(sent.description).toBe('Texto.');
    });

    it('the stored field wins over a legacy block when both are present', () => {
      editForm({
        description: LEGACY,
        schedule: [{ day: 1, time: '08:00', title: 'Do campo novo' }],
      });
      expect(moments()).toEqual(['08:00Do campo novo']);
    });

    it('the schedule no longer consumes the description limit: 30 moments and 3,990 characters submit', async () => {
      const schedule = Array.from({ length: 30 }, (_, i) => ({
        day: 1,
        time: `${String(8 + Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}`,
        title: `Momento número ${i + 1} do cronograma`,
      }));
      editForm({ description: 'x'.repeat(3990), schedule });
      type('event-title', 'Encontro anual 2026');
      fireEvent.submit(document.querySelector('form') as HTMLFormElement);
      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      const sent = update.mock.calls[0]?.[1] as Record<string, unknown>;
      expect((sent.description as string).length).toBe(3990);
      expect(sent.schedule).toHaveLength(30);
    });

    /** `count` DISTINCT moments over 25 days, eight a day, in order (the cap is 200, 09.3-01). */
    const distinctMoments = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        day: Math.floor(i / 8) + 1,
        time: `${String(8 + (i % 8)).padStart(2, '0')}:00`,
        title: `Momento número ${i + 1}`,
      }));
    const limitLine = () =>
      lookup('events', 'form.extras.schedule.limit', { max: EVENT_SCHEDULE_MAX_ITEMS });

    it('at the limit: 200 moments are all listed, the counter line says 200, the add controls are disabled and 200 submit', async () => {
      expect(EVENT_SCHEDULE_MAX_ITEMS).toBe(200);
      const schedule = distinctMoments(EVENT_SCHEDULE_MAX_ITEMS);
      editForm({ schedule });
      expect(moments()).toHaveLength(200);
      expect(moments()[0]).toBe('08:00Momento número 1');
      expect(moments()[199]).toBe('15:00Momento número 200');
      // The line is the catalog's, with the number the contract owns.
      expect(limitLine()).toContain('200');
      expect(editor().textContent).toContain(limitLine());
      expect(field('event-schedule-time').disabled).toBe(true);
      expect(field('event-schedule-what').disabled).toBe(true);
      expect(addButton().disabled).toBe(true);
      // Overflow: the list grows with the page, it is never an inner scroller.
      const list = editor().querySelector('[data-schedule-list]') as HTMLElement;
      expect(list.className).not.toMatch(/overflow|max-h/);

      type('event-title', 'Encontro anual 2026');
      fireEvent.submit(document.querySelector('form') as HTMLFormElement);
      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      const sent = update.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(sent.schedule).toHaveLength(200);
    });

    it('one below the limit: 199 moments keep the controls enabled, one more makes 200 and disables them again', () => {
      editForm({ schedule: distinctMoments(EVENT_SCHEDULE_MAX_ITEMS - 1) });
      expect(moments()).toHaveLength(199);
      expect(editor().textContent).not.toContain(limitLine());
      expect(field('event-schedule-time').disabled).toBe(false);
      expect(field('event-schedule-what').disabled).toBe(false);
      type('event-schedule-time', '23:30');
      type('event-schedule-what', 'Último momento');
      expect(addButton().disabled).toBe(false);
      fireEvent.click(addButton());
      expect(moments()).toHaveLength(200);
      expect(editor().textContent).toContain(limitLine());
      expect(field('event-schedule-time').disabled).toBe(true);
      expect(field('event-schedule-what').disabled).toBe(true);
      expect(addButton().disabled).toBe(true);
    });
  });

  it('edit: the stored block is split back; the description field shows the text alone', () => {
    render(
      <EventForm
        mode="edit"
        eventId={EVENT_ID}
        initial={{
          title: 'Encontro anual',
          description: 'Texto.\n\nInformações úteis\nTraje: Esporte fino\nCertificado: sim',
          coverAssetId: null,
          coverVariantWidths: [],
          format: 'in_person',
          venueName: 'Auditório da sede',
          address: 'Rua das Flores, 100',
          meetingUrl: '',
          start: { date: '2026-10-12', time: '19:00' },
          end: { date: '2026-10-12', time: '21:00' },
        }}
        tenantName="Rede Demo"
        zoneLabel={ZONE}
      />,
    );
    expect((document.getElementById('event-description') as HTMLTextAreaElement).value).toBe(
      'Texto.',
    );
    expect(field('event-dress-code').value).toBe('Esporte fino');
    expect(
      screen
        // Step 2 is hidden until its tab is chosen: still mounted, so its state is there.
        .getByRole('switch', {
          name: lookup('events', 'form.extras.certificate.label'),
          hidden: true,
        })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });
});

/**
 * Phase 10.1-11 (TICK-02 to TICK-05, D-744 to D-748, D-755, D-757, UI-D-741 to UI-D-743) — the event
 * form's Ingresso section and the two-step save. The two ticket actions are stubbed; the section, the
 * state machine (`ticketSectionState`) and the shared `eventInputSchema` are real, against the real
 * `events.json`.
 *
 * Claims:
 *  - tracer: switch on + id + https link + price "80,00" sends `ticketPriceCents: 8000` in the event
 *    save and then calls the product action ONCE with the created event id; switch off sends `null`
 *    and calls nothing; a host without the `ticket` prop sends no price key and draws no section;
 *  - the state props: the gateway word (display name or the neutral fallback), the locked section
 *    with a price that still saves, module off, a linked product with the gateway down (its stored
 *    values go unchanged and call nothing), the D-748 note and the D-747 off line;
 *  - the sequence: errors after the first submit only and nothing is saved while they stand, a price-only
 *    edit calls no mapping endpoint, a create is NEVER repeated when the second write fails, the typed
 *    values stay, the offending field speaks (`gateway_product_taken` with the gateway word), anything
 *    else is the toast, a stale tab hitting the lock re-reads the section as locked, errors clear on the
 *    next edit of their field, and the subscription hint keeps the form open.
 */
describe('EventForm — the Ingresso section (Phase 10.1-11)', () => {
  const GATEWAY = 'Gateway Exemplo';
  const PAIR = { externalProductId: 'PRD-48213', checkoutUrl: 'https://pay.example/ingresso' };
  const TICKET: EventFormTicket = {
    moduleOn: true,
    gatewayConnected: true,
    canManagePayments: true,
    gatewayName: GATEWAY,
    saved: null,
    soldCount: 0,
    hasConfirmed: false,
  };
  const SAVED: EventFormTicket = { ...TICKET, saved: PAIR };
  const T = (key: string, values?: Record<string, unknown>) =>
    lookup('events', `form.ticket.${key}`, values);

  const stored = {
    title: 'Encontro anual',
    description: '',
    coverAssetId: null,
    coverVariantWidths: [],
    format: 'online' as const,
    venueName: '',
    address: '',
    meetingUrl: 'https://meet.example.com/x',
    start: { date: '2026-10-12', time: '19:00' },
    end: { date: '2026-10-12', time: '21:00' },
  };

  const renderCreateWith = (ticket: EventFormTicket | undefined) =>
    render(<EventForm mode="create" tenantName="Rede Demo" zoneLabel={ZONE} ticket={ticket} />);

  const renderEditWith = (ticket: EventFormTicket | undefined, initial = {}) =>
    render(
      <EventForm
        mode="edit"
        eventId={EVENT_ID}
        initial={{ ...stored, ...initial }}
        tenantName="Rede Demo"
        zoneLabel={ZONE}
        ticket={ticket}
      />,
    );

  /** The smallest valid create: Online, a name, a start and a meeting link. */
  function fillOnline() {
    fireEvent.click(screen.getByRole('button', { name: /Online/ }));
    type('event-title', 'Encontro anual');
    type('event-start-date', '2026-10-12');
    type('event-start-time', '19:00');
    type('event-url', 'https://meet.example.com/x');
  }

  const submitForm = async () => {
    await act(async () => {
      fireEvent.submit(document.querySelector('[data-event-form]') as HTMLFormElement);
    });
  };
  const sw = () => document.querySelector('[data-ticket-switch]') as HTMLButtonElement;
  const section = () => document.querySelector('[data-event-ticket]') as HTMLElement | null;
  const state = () => section()?.getAttribute('data-ticket-state');
  const toggleOn = () => fireEvent.click(sw());
  const fillPair = (id = PAIR.externalProductId, link = PAIR.checkoutUrl) => {
    type('event-gateway-id', id);
    type('event-checkout-url', link);
  };
  const sent = (mock: typeof create, call = 0) =>
    mock.mock.calls[call]?.[mock === update ? 1 : 0] as Record<string, unknown>;
  const errorsText = () =>
    [...(section()?.querySelectorAll('[role="alert"]') ?? [])].map((node) => node.textContent);

  describe('the tracer: the admin creates a paid event', () => {
    it('sends the price with the event and links the product once, with the created event id', async () => {
      renderCreateWith(TICKET);
      fillOnline();
      toggleOn();
      fillPair('  PRD-48213 ', ` ${PAIR.checkoutUrl} `);
      type('event-ticket-price', '80,00');
      await submitForm();

      expect(create).toHaveBeenCalledTimes(1);
      expect(sent(create).ticketPriceCents).toBe(8000);
      expect(saveTicket).toHaveBeenCalledTimes(1);
      expect(saveTicket).toHaveBeenCalledWith(EVENT_ID, {
        externalProductId: PAIR.externalProductId,
        checkoutUrl: PAIR.checkoutUrl,
      });
      // The product is the SECOND write: after the event save, before the landing.
      expect(create.mock.invocationCallOrder[0]).toBeLessThan(
        saveTicket.mock.invocationCallOrder[0] as number,
      );
      expect(saveTicket.mock.invocationCallOrder[0]).toBeLessThan(
        replace.mock.invocationCallOrder[0] as number,
      );
      expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: E.toasts.created });
    });

    it('with the switch off the event is saved exactly as today: price null, no product call', async () => {
      renderCreateWith(TICKET);
      fillOnline();
      expect(section()?.querySelector('[data-ticket-fields]')).toBeNull();
      await submitForm();
      expect(sent(create).ticketPriceCents).toBeNull();
      expect(saveTicket).not.toHaveBeenCalled();
      expect(removeTicket).not.toHaveBeenCalled();
    });

    it('a price left empty is valid and sends null with the product still linked', async () => {
      renderCreateWith(TICKET);
      fillOnline();
      toggleOn();
      fillPair();
      await submitForm();
      expect(sent(create).ticketPriceCents).toBeNull();
      expect(saveTicket).toHaveBeenCalledTimes(1);
    });

    it('a host that predates the section draws none and sends no price key at all', async () => {
      renderCreateWith(undefined);
      fillOnline();
      expect(section()).toBeNull();
      await submitForm();
      expect(create).toHaveBeenCalledTimes(1);
      expect('ticketPriceCents' in sent(create)).toBe(false);
      expect(saveTicket).not.toHaveBeenCalled();
    });

    it('the price echoes as 80,00 on blur and the fields are disabled while the submit runs', async () => {
      renderCreateWith(TICKET);
      fillOnline();
      toggleOn();
      type('event-ticket-price', '80');
      fireEvent.blur(field('event-ticket-price'));
      expect(field('event-ticket-price').value).toBe('80,00');

      let release: (value: unknown) => void = () => {};
      create.mockReturnValue(new Promise((resolve) => (release = resolve)));
      fillPair();
      await submitForm();
      expect(field('event-gateway-id').disabled).toBe(true);
      expect(field('event-checkout-url').disabled).toBe(true);
      expect(field('event-ticket-price').disabled).toBe(true);
      expect(sw().disabled).toBe(true);
      await act(async () => release({ ok: true, eventId: EVENT_ID }));
    });
  });

  describe('the section reads the server facts (UI-D-742)', () => {
    it('names the gateway with the display name the server passed', () => {
      renderCreateWith(TICKET);
      expect(section()?.textContent).toContain(T('helper', { gateway: GATEWAY }));
      toggleOn();
      expect(document.querySelector('label[for="event-gateway-id"]')?.textContent).toBe(
        T('idLabel', { gateway: GATEWAY }),
      );
    });

    it('falls back to the neutral word when the server has no display name (A-11-GATEWAY)', () => {
      renderCreateWith({ ...TICKET, gatewayName: null });
      const fallback = T('gatewayFallback');
      expect(section()?.textContent).toContain(T('helper', { gateway: fallback }));
      expect(section()?.textContent).not.toMatch(/kiwify/i);
    });

    it('module off with nothing linked: the switch is disabled and the event saves with price null', async () => {
      renderCreateWith({ ...TICKET, moduleOn: false, gatewayConnected: false });
      expect(state()).toBe('moduleOff');
      expect(sw().disabled).toBe(true);
      fillOnline();
      await submitForm();
      expect(sent(create).ticketPriceCents).toBeNull();
      expect(saveTicket).not.toHaveBeenCalled();
    });

    it('module on, gateway not connected: the note, with the link only for payments.manage', () => {
      renderCreateWith({ ...TICKET, gatewayConnected: false });
      expect(state()).toBe('notConnected');
      expect(section()?.querySelector('a')?.getAttribute('href')).toBe('/configuracoes/pagamentos');
      cleanup();
      renderCreateWith({ ...TICKET, gatewayConnected: false, canManagePayments: false });
      expect(section()?.querySelector('a')).toBeNull();
    });

    it('edit, product saved: opens on, filled, clean, with the stored price', () => {
      renderEditWith({ ...SAVED }, { ticketPriceCents: 8000 });
      expect(state()).toBe('free');
      expect(sw().getAttribute('aria-checked')).toBe('true');
      expect(field('event-gateway-id').value).toBe(PAIR.externalProductId);
      expect(field('event-checkout-url').value).toBe(PAIR.checkoutUrl);
      expect(field('event-ticket-price').value).toBe('80,00');
      expect(submitButton()?.disabled).toBe(false);
      // Untouched: the X leaves without asking.
      fireEvent.click(screen.getByRole('button', { name: E.form.close }));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('edit, locked by a sale: id and link disabled, the price still saves and calls no mapping endpoint', async () => {
      renderEditWith({ ...SAVED, soldCount: 3 }, { ticketPriceCents: 8000 });
      expect(state()).toBe('locked');
      expect(field('event-gateway-id').disabled).toBe(true);
      expect(field('event-checkout-url').disabled).toBe(true);
      expect(field('event-ticket-price').disabled).toBe(false);
      expect(sw().disabled).toBe(true);
      type('event-ticket-price', '95,50');
      await submitForm();
      expect(update).toHaveBeenCalledTimes(1);
      expect(sent(update, 0).ticketPriceCents).toBe(9550);
      expect(saveTicket).not.toHaveBeenCalled();
      expect(removeTicket).not.toHaveBeenCalled();
    });

    it('edit, a price-only change sends the event save and no mapping request', async () => {
      renderEditWith({ ...SAVED }, { ticketPriceCents: 8000 });
      type('event-ticket-price', '90,00');
      await submitForm();
      expect(update).toHaveBeenCalledTimes(1);
      expect(sent(update, 0).ticketPriceCents).toBe(9000);
      expect(saveTicket).not.toHaveBeenCalled();
      expect(removeTicket).not.toHaveBeenCalled();
    });

    it('edit, linked but the gateway is down: stored values disabled, saved unchanged, no mapping call', async () => {
      renderEditWith({ ...SAVED, gatewayConnected: false }, { ticketPriceCents: 8000 });
      expect(state()).toBe('linkedUnavailable');
      expect(sw().getAttribute('aria-checked')).toBe('true');
      expect(sw().disabled).toBe(true);
      expect(field('event-gateway-id').disabled).toBe(true);
      type('event-title', 'Encontro anual 2');
      await submitForm();
      expect(update).toHaveBeenCalledTimes(1);
      expect(sent(update, 0).ticketPriceCents).toBe(8000);
      expect(saveTicket).not.toHaveBeenCalled();
      expect(removeTicket).not.toHaveBeenCalled();
    });

    it('edit with confirmed presences and the product not saved: the D-748 note, gone once saved', () => {
      renderEditWith({ ...TICKET, hasConfirmed: true });
      expect(section()?.querySelector('[data-ticket-existing-note]')).toBeNull();
      toggleOn();
      expect(section()?.querySelector('[data-ticket-existing-note]')?.textContent).toBe(
        T('existingNote'),
      );
      cleanup();
      renderEditWith({ ...SAVED, hasConfirmed: true });
      expect(section()?.querySelector('[data-ticket-existing-note]')).toBeNull();
    });

    it('create never shows the existing-presences note', () => {
      renderCreateWith({ ...TICKET, hasConfirmed: true });
      toggleOn();
      expect(section()?.querySelector('[data-ticket-existing-note]')).toBeNull();
    });

    it('switching a saved, unsold product off shows the effect line and removes it on save only', async () => {
      renderEditWith({ ...SAVED }, { ticketPriceCents: 8000 });
      toggleOn();
      expect(section()?.querySelector('[data-ticket-off-note]')?.textContent).toBe(T('offEffect'));
      await submitForm();
      expect(update).toHaveBeenCalledTimes(1);
      expect(sent(update, 0).ticketPriceCents).toBeNull();
      expect(removeTicket).toHaveBeenCalledTimes(1);
      expect(removeTicket).toHaveBeenCalledWith(EVENT_ID);
      expect(saveTicket).not.toHaveBeenCalled();
    });

    it('an event with no product and the switch left off never calls the remove action', async () => {
      renderEditWith({ ...TICKET });
      type('event-title', 'Encontro anual 2');
      await submitForm();
      expect(removeTicket).not.toHaveBeenCalled();
      expect(saveTicket).not.toHaveBeenCalled();
    });

    it('edit with a changed pair relinks it through the save action', async () => {
      renderEditWith({ ...SAVED });
      type('event-checkout-url', 'https://pay.example/outro');
      await submitForm();
      expect(saveTicket).toHaveBeenCalledWith(EVENT_ID, {
        externalProductId: PAIR.externalProductId,
        checkoutUrl: 'https://pay.example/outro',
      });
    });
  });

  describe('errors, retries and refusals (UI-D-743)', () => {
    it('keeps its errors quiet until the first submit, then speaks per field and saves nothing', async () => {
      renderCreateWith(TICKET);
      fillOnline();
      toggleOn();
      type('event-ticket-price', 'abc');
      expect(errorsText()).toEqual([]);
      expect(submitButton()?.disabled).toBe(false);

      await submitForm();
      expect(errorsText()).toEqual([
        T('errors.idRequired'),
        T('errors.linkRequired'),
        T('errors.priceInvalid'),
      ]);
      expect(create).not.toHaveBeenCalled();
      expect(saveTicket).not.toHaveBeenCalled();
      expect(document.querySelector('[data-event-form-error]')?.textContent).toBe(
        E.form.errors.save,
      );
    });

    it('a link that is not https says so, and so does a bare word', async () => {
      renderCreateWith(TICKET);
      fillOnline();
      toggleOn();
      fillPair('PRD-1', 'http://pay.example/x');
      await submitForm();
      expect(errorsText()).toEqual([T('errors.linkInvalid')]);
      type('event-checkout-url', 'pay.example/x');
      expect(errorsText()).toEqual([T('errors.linkInvalid')]);
      type('event-checkout-url', 'https://pay.example/x');
      expect(errorsText()).toEqual([]);
      expect(create).not.toHaveBeenCalled();
    });

    it('an id without a link and a link without an id are two distinct outcomes', async () => {
      renderCreateWith(TICKET);
      fillOnline();
      toggleOn();
      type('event-gateway-id', 'PRD-1');
      await submitForm();
      expect(errorsText()).toEqual([T('errors.linkRequired')]);
      type('event-gateway-id', '');
      type('event-checkout-url', PAIR.checkoutUrl);
      expect(errorsText()).toEqual([T('errors.idRequired')]);
    });

    it('a failed second write keeps the event saved and the typed values, and the offending field speaks', async () => {
      saveTicket.mockResolvedValue({ ok: false, issue: 'id_taken' });
      renderCreateWith(TICKET);
      fillOnline();
      toggleOn();
      fillPair();
      type('event-ticket-price', '80,00');
      await submitForm();

      expect(create).toHaveBeenCalledTimes(1);
      expect(errorsText()).toEqual([T('errors.taken', { gateway: GATEWAY })]);
      expect(field('event-gateway-id').value).toBe(PAIR.externalProductId);
      expect(field('event-checkout-url').value).toBe(PAIR.checkoutUrl);
      expect(field('event-ticket-price').value).toBe('80,00');
      // The form stays: no landing, no "created" toast.
      expect(replace).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
      expect(toast.show).not.toHaveBeenCalled();
    });

    it('never repeats the create: the next save updates the event it created and retries the product', async () => {
      saveTicket.mockResolvedValueOnce({ ok: false, issue: 'id_taken' });
      renderCreateWith(TICKET);
      fillOnline();
      toggleOn();
      fillPair();
      await submitForm();
      expect(create).toHaveBeenCalledTimes(1);

      type('event-gateway-id', 'PRD-99999');
      await submitForm();
      expect(create).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledTimes(1);
      expect(update.mock.calls[0]?.[0]).toBe(EVENT_ID);
      expect(saveTicket).toHaveBeenCalledTimes(2);
      expect(saveTicket).toHaveBeenLastCalledWith(EVENT_ID, {
        externalProductId: 'PRD-99999',
        checkoutUrl: PAIR.checkoutUrl,
      });
      expect(errorsText()).toEqual([]);
      expect(replace).toHaveBeenCalledTimes(1);
      expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: E.toasts.created });
    });

    it('a pair the server already holds is not sent again on the retry', async () => {
      saveTicket.mockResolvedValueOnce({ ok: true, recurring: true });
      renderCreateWith(TICKET);
      fillOnline();
      toggleOn();
      fillPair();
      await submitForm();
      expect(saveTicket).toHaveBeenCalledTimes(1);
      await submitForm();
      expect(saveTicket).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['id_required', 'id', 'errors.idRequired'],
      ['link_required', 'link', 'errors.linkRequired'],
      ['link_invalid', 'link', 'errors.linkInvalid'],
    ] as const)('the server issue %s lands under the %s field', async (issue, _field, key) => {
      saveTicket.mockResolvedValue({ ok: false, issue });
      renderCreateWith(TICKET);
      fillOnline();
      toggleOn();
      fillPair();
      await submitForm();
      expect(errorsText()).toEqual([T(key)]);
    });

    it('any other failure is the toast, with the event saved and the values in place', async () => {
      saveTicket.mockResolvedValue({ ok: false, issue: 'generic' });
      renderCreateWith(TICKET);
      fillOnline();
      toggleOn();
      fillPair();
      await submitForm();
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: T('errors.save') });
      expect(errorsText()).toEqual([]);
      expect(field('event-gateway-id').value).toBe(PAIR.externalProductId);
      expect(replace).not.toHaveBeenCalled();
    });

    it('an action that throws is the same toast', async () => {
      saveTicket.mockRejectedValue(new Error('boom'));
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      renderCreateWith(TICKET);
      fillOnline();
      toggleOn();
      fillPair();
      await submitForm();
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: T('errors.save') });
      expect(JSON.stringify(logged.mock.calls)).not.toContain(PAIR.checkoutUrl);
      logged.mockRestore();
    });

    it('an error clears on the next edit of its own field, and only that one', async () => {
      saveTicket.mockResolvedValue({ ok: false, issue: 'id_taken' });
      renderCreateWith(TICKET);
      fillOnline();
      toggleOn();
      fillPair();
      await submitForm();
      expect(errorsText()).toHaveLength(1);
      type('event-checkout-url', 'https://pay.example/otro');
      expect(errorsText()).toHaveLength(1);
      type('event-gateway-id', 'PRD-2');
      expect(errorsText()).toEqual([]);
    });

    it('a stale tab hitting the lock shows the alert row and re-reads the section as locked', async () => {
      saveTicket.mockResolvedValue({ ok: false, issue: 'locked', soldCount: 4 });
      renderEditWith({ ...SAVED });
      type('event-checkout-url', 'https://pay.example/otro');
      await submitForm();

      expect(section()?.querySelector('[data-ticket-section-error]')?.textContent).toBe(
        T('errors.locked'),
      );
      expect(state()).toBe('locked');
      expect(sw().getAttribute('aria-checked')).toBe('true');
      expect(sw().disabled).toBe(true);
      expect(field('event-gateway-id').disabled).toBe(true);
      expect(field('event-ticket-price').disabled).toBe(false);
      // What the server holds is shown again, not what was typed over it.
      expect(field('event-checkout-url').value).toBe(PAIR.checkoutUrl);
      expect(push).not.toHaveBeenCalled();
    });

    it('a locked answer with no readable count still reads as locked (at least one sale)', async () => {
      saveTicket.mockResolvedValue({ ok: false, issue: 'locked' });
      renderEditWith({ ...SAVED });
      type('event-gateway-id', 'PRD-1');
      await submitForm();
      expect(state()).toBe('locked');
    });

    it('the lock also answers a removal: the switch comes back on', async () => {
      removeTicket.mockResolvedValue({ ok: false, issue: 'locked', soldCount: 2 });
      renderEditWith({ ...SAVED });
      toggleOn();
      expect(sw().getAttribute('aria-checked')).toBe('false');
      await submitForm();
      expect(state()).toBe('locked');
      expect(sw().getAttribute('aria-checked')).toBe('true');
    });

    it('the subscription hint of the save answer keeps the form open with the warning (A-UI-10)', async () => {
      saveTicket.mockResolvedValue({ ok: true, recurring: true });
      renderCreateWith(TICKET);
      fillOnline();
      toggleOn();
      fillPair();
      expect(section()?.querySelector('[data-ticket-recurring]')).toBeNull();
      await submitForm();
      expect(section()?.querySelector('[data-ticket-recurring]')?.textContent).toBe(T('recurring'));
      expect(state()).toBe('recurring');
      expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: E.toasts.created });
      expect(replace).not.toHaveBeenCalled();
      // The warning blocks nothing: the fields stay editable.
      expect(field('event-gateway-id').disabled).toBe(false);
    });

    it('with no hint the form lands on the new event', async () => {
      renderCreateWith(TICKET);
      fillOnline();
      toggleOn();
      fillPair();
      await submitForm();
      expect(section()?.querySelector('[data-ticket-recurring]')).toBeNull();
      expect(replace).toHaveBeenCalledTimes(1);
    });
  });
});
