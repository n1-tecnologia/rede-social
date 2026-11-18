// @vitest-environment happy-dom

import { join } from 'node:path';
import { REALTIME_EVENTS } from '@rede-social/contracts/realtime';
import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { ChatMessageView, MemberCaseHeaderView, StaffCaseHeaderView } from '@/lib/chat-view';
import type { ThreadPaneProps } from './ThreadPane';

/**
 * 12.5-15 (VOICE-09, VOICE-12, VOICE-23, VOICE-31, VOICE-32; D-847, D-861, D-862, UI-D-845..847, UI-D-850,
 * UI-D-852, UI-D-858): the thread host of a recording, over the REAL composer, bubble and player with the
 * recorder FAKED (the doubles of plan 13). The four server actions behind the send are mocks; the real
 * `voiceSendDeps` and `runVoiceSend` run on top of them. Realtime is a recorder, the catalog is the real
 * pt-BR one. There is no real microphone and no real media: a decode, a seek and a call are Igor's proofs.
 */

/**
 * The recorder doubles of plan 13 (`packages/modules/chat/tests/voice-fakes.ts`), reduced to what the host
 * needs: happy-dom has no `MediaRecorder` or `mediaDevices`, and a cross-package test import is a boundary
 * violation, so the same shapes live here. The track counts its `stop()` calls: that is how the tests prove
 * the microphone is released.
 */
class FakeTrack extends EventTarget {
  kind = 'audio';
  readyState: 'live' | 'ended' = 'live';
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
}

class FakeRecorder extends EventTarget {
  static isTypeSupported(type: string): boolean {
    return type === 'audio/webm;codecs=opus';
  }
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  constructor(readonly stream: unknown) {
    super();
  }
  start() {
    this.state = 'recording';
    queueMicrotask(() => this.dispatchEvent(new Event('start')));
  }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.dispatchEvent(
      Object.assign(new Event('dataavailable'), {
        data: new Blob([new Uint8Array(512)], { type: this.mimeType }),
      }),
    );
    this.dispatchEvent(new Event('stop'));
  }
}

function installRecording() {
  const track = new FakeTrack();
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const getUserMedia = vi.fn(() => Promise.resolve(stream));
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
    writable: true,
  });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  return { getUserMedia, track };
}

function uninstallRecording() {
  Reflect.deleteProperty(navigator, 'mediaDevices');
  vi.unstubAllGlobals();
}

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

MotionGlobalConfig.skipAnimations = true;

const mocks = vi.hoisted(() => ({
  sendText: vi.fn(),
  sendVoice: vi.fn(),
  staffText: vi.fn(),
  staffVoice: vi.fn(),
  start: vi.fn(),
  complete: vi.fn(),
  put: vi.fn(),
  refresh: vi.fn(),
  realtime: vi.fn(),
}));

vi.mock('./actions', () => ({
  sendSupportMessageAction: (...args: unknown[]) => mocks.sendText(...args),
  sendSupportVoiceAction: (...args: unknown[]) => mocks.sendVoice(...args),
}));
vi.mock('../perfil/actions', () => ({
  startMediaUploadAction: (...args: unknown[]) => mocks.start(...args),
  completeMediaUploadAction: (...args: unknown[]) => mocks.complete(...args),
}));
vi.mock('@/lib/upload', () => ({
  uploadBytes: (...args: unknown[]) => mocks.put(...args),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));
vi.mock('@rede-social/core/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/core/ui')>()),
  useRealtimeTopic: (...args: unknown[]) => mocks.realtime(...args),
}));

const { ThreadPane } = await import('./ThreadPane');
// Loaded once here so the pane's lazy import of the wiring is a cache hit when the first take runs.
await import('./voice-deps');

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const NEW_ID = '44444444-4444-4444-8444-444444444444';
const CASE_RECORD = '33333333-3333-4333-8333-333333333333';
const TENANT_ID = '99999999-9999-4999-8999-999999999999';

type CaseState = 'open' | 'in_progress' | 'resolved' | 'closed';

const STATE_VIEW: Record<CaseState, MemberCaseHeaderView['state']> = {
  open: { state: 'open', label: 'Aberto', tone: 'warning', glyph: 'CircleDot' },
  in_progress: { state: 'in_progress', label: 'Em atendimento', tone: 'brand', glyph: 'UserCheck' },
  resolved: { state: 'resolved', label: 'Resolvido', tone: 'success', glyph: 'CircleCheck' },
  closed: { state: 'closed', label: 'Fechado', tone: 'neutral', glyph: 'Lock' },
};

const memberHeader = (
  state: CaseState,
  over: Partial<MemberCaseHeaderView> = {},
): MemberCaseHeaderView => ({
  viewer: 'member',
  id: CASE_ID,
  number: 42,
  title: 'Chamado #42',
  state: STATE_VIEW[state],
  subject: 'Meu ingresso',
  subjectLine: '#42 · Meu ingresso',
  ...over,
});

const ACTIONS: Record<CaseState, StaffCaseHeaderView['actions']> = {
  open: ['take', 'assign', 'resolve', 'close', 'edit'],
  in_progress: ['assign', 'resolve', 'close', 'edit'],
  resolved: ['reopen', 'close', 'edit'],
  closed: [],
};

const staffHeader = (state: CaseState): StaffCaseHeaderView => ({
  viewer: 'staff',
  id: CASE_RECORD,
  number: 42,
  title: 'Chamado #42',
  state: STATE_VIEW[state],
  subject: 'Meu ingresso',
  subjectLine: '#42 · Meu ingresso',
  meta: 'Pagamento · Normal · Sem responsável',
  actions: ACTIONS[state],
  ownerUserId: null,
  ownerName: null,
  ownerIsViewer: false,
  category: 'payment',
  priority: 'normal',
  typedSubject: 'Meu ingresso',
  openedAt: '2026-11-17T14:02:00.000Z',
});

const textView = (id: string, seq: number, body: string, side: 'own' | 'other' = 'own') =>
  ({
    id,
    seq,
    side,
    authorKey: 'member',
    body,
    label: null,
    time: '10:00',
    dayKey: '2026-11-17',
    createdAtMs: Date.parse('2026-11-17T10:00:00Z') + seq,
  }) satisfies ChatMessageView;

const voiceView = (
  id: string,
  seq: number,
  mediaId: string,
  over: Partial<ChatMessageView> = {},
): ChatMessageView => ({
  ...textView(id, seq, ''),
  voice: { mediaId, durationSeconds: 3, durationLabel: '0:03', spokenLabel: '3 segundos' },
  ...over,
});

const upload = (n: number) => ({
  ok: true as const,
  upload: {
    assetId: `asset-${n}`,
    provider: 'supabase',
    signedUrl: 'https://signed.invalid/u',
    token: 't',
    path: 'p',
    resumableThresholdBytes: 6_291_456,
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const fetchMock = vi.fn();
let memberHeaderAnswer: () => Response = () =>
  Response.json({ viewer: 'member', header: memberHeader('open') });
let staffHeaderAnswer: () => Response = () =>
  Response.json({ viewer: 'staff', header: staffHeader('open') });

let rec: ReturnType<typeof installRecording>;
let nowMs = 0;
let startCount = 0;

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  startCount = 0;
  nowMs = 0;
  // The recorder measures its own length with `performance.now`; the test moves it by hand.
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  rec = installRecording();
  mocks.start.mockImplementation(async () => upload(++startCount));
  mocks.put.mockImplementation(async () => ({ ok: true }));
  mocks.complete.mockImplementation(async () => ({ ok: true }));
  memberHeaderAnswer = () => Response.json({ viewer: 'member', header: memberHeader('open') });
  staffHeaderAnswer = () => Response.json({ viewer: 'staff', header: staffHeader('open') });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes('/messages?')) {
      return Response.json({
        items: [],
        hasMore: false,
        todayKey: '2026-11-17',
        yesterdayKey: '2026-11-16',
      });
    }
    if (u.endsWith('/read')) return new Response(null, { status: 204 });
    if (u.includes(CASE_RECORD)) return staffHeaderAnswer();
    return memberHeaderAnswer();
  });
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

afterEach(() => {
  cleanup();
  uninstallRecording();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPane(over: Partial<ThreadPaneProps> = {}) {
  const props: ThreadPaneProps = {
    tenantId: TENANT_ID,
    tenantName: 'Rede Demo',
    logoUrl: null,
    initialConversationId: null,
    initialViews: [],
    initialHasOlder: false,
    initialKeys: { todayKey: '2026-11-17', yesterdayKey: '2026-11-16' },
    initialError: false,
    initialCase: null,
    hasAnyCase: false,
    ...over,
  };
  const tree = (p: ThreadPaneProps) => (
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <ToastProvider>
        <ThreadPane {...p} />
      </ToastProvider>
    </NextIntlClientProvider>
  );
  const view = render(tree(props));
  return {
    ...view,
    rerenderWith: (next: Partial<ThreadPaneProps>) => view.rerender(tree({ ...props, ...next })),
  };
}

/** A member in a conversation that already has an open case (no opener). */
const inCase = (over: Partial<ThreadPaneProps> = {}) =>
  renderPane({
    initialConversationId: CASE_ID,
    initialViews: [textView('22222222-2222-4222-8222-222222222222', 1, 'Oi, preciso de ajuda')],
    initialCase: memberHeader('open'),
    hasAnyCase: true,
    ...over,
  });

function renderStaff(state: CaseState = 'open', over: Partial<ThreadPaneProps> = {}) {
  return renderPane({
    viewer: 'staff',
    initialConversationId: CASE_RECORD,
    initialViews: [
      textView('66666666-6666-4666-8666-666666666666', 1, 'Meu ingresso não chegou', 'other'),
    ],
    initialStaffCase: staffHeader(state),
    onSendAction: (...args: [string, string]) => mocks.staffText(...args),
    onSendVoiceAction: (...args: [string, string]) => mocks.staffVoice(...args),
    raceNotices: { member_blocked: 'Marina está bloqueado.', member_removed: 'Marina saiu.' },
    ...over,
  });
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const mic = () => screen.queryByRole('button', { name: 'Gravar mensagem de voz' });

/** Tap the microphone, let the fake recorder run `seconds`, and tap the recording's send. */
async function recordAndSend(seconds = 3, sendName = 'Enviar mensagem de voz') {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Gravar mensagem de voz' }));
  });
  await settle();
  nowMs += seconds * 1000;
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: sendName }));
  });
  await settle();
}

const bubbles = () => [...document.querySelectorAll('[data-chat-message]')];
const pendingBubbles = () => [...document.querySelectorAll('[data-chat-bubble][data-pending]')];
const footerOf = (el: Element) => el.querySelector('[data-chat-time]')?.textContent ?? '';

const sent = (id: string, seq: number, mediaId: string, extra: Record<string, unknown> = {}) => ({
  ok: true as const,
  conversationId: CASE_ID,
  view: voiceView(id, seq, mediaId),
  ...extra,
});

const opened = {
  case: { id: CASE_ID, number: 42, state: 'open' as const, opened: true, reopened: false },
};

describe('voice host tracer', () => {
  it('a member with no case records a first voice message: the bubble is pending at once, then the server view and the case bar replace it', async () => {
    const gate = deferred<ReturnType<typeof sent>>();
    mocks.sendVoice.mockReturnValue(gate.promise);
    memberHeaderAnswer = () =>
      Response.json({
        viewer: 'member',
        header: memberHeader('open', { subject: 'Mensagem de voz' }),
      });
    const { container } = renderPane();

    fireEvent.click(screen.getByRole('button', { name: 'Pagamento' }));
    fireEvent.change(screen.getByLabelText('Assunto (opcional)'), {
      target: { value: 'Meu ingresso' },
    });
    // While the opener shows, the recording's send carries the opener's longer name (UI-D-852).
    await recordAndSend(3, 'Abrir chamado com a mensagem de voz');

    // The own, pending voice bubble is in the list at once, with the take's length and the shipped footer.
    expect(pendingBubbles()).toHaveLength(1);
    const pending = pendingBubbles()[0] as Element;
    expect(pending.getAttribute('data-chat-bubble')).toBe('own');
    expect(screen.getByRole('group', { name: 'Mensagem de voz, 3 segundos' })).toBeTruthy();
    expect(footerOf(pending)).toBe('Enviando…');
    expect(screen.getByRole('progressbar')).toBeTruthy();
    // The composer is idle and the microphone is available again (A-UI-19).
    expect((mic() as HTMLButtonElement).disabled).toBe(false);
    // The opener stays until the server answers.
    expect(screen.getByRole('group', { name: 'Sobre o que é?' })).toBeTruthy();

    await waitFor(() => expect(mocks.sendVoice).toHaveBeenCalledTimes(1));
    // The action got the asset and the opener's category and typed subject, exactly as the text path sends them.
    expect(mocks.sendVoice).toHaveBeenCalledWith('asset-1', 'payment', 'Meu ingresso');

    await act(async () => {
      gate.resolve(sent('77777777-7777-4777-8777-777777777777', 1, 'asset-1', opened));
    });

    await waitFor(() => expect(pendingBubbles()).toHaveLength(0));
    expect(bubbles()).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Mensagem de voz, 3 segundos' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Sobre o que é?' })).toBeNull();
    expect(container.querySelector('[data-case-bar]')).not.toBeNull();
    expect(screen.getAllByText('Chamado #42').length).toBeGreaterThan(0);
    expect(screen.getByText('Chamado #42 aberto.')).toBeTruthy();
    // The recording's send goes back to its usual name for every later message.
    expect(mic()).not.toBeNull();
  });

  it('plays the stored message from the media route and holds no storage, URL or file name of the take', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    mocks.sendVoice.mockResolvedValue(sent('77777777-7777-4777-8777-777777777777', 2, 'asset-1'));
    const { container } = inCase();
    await recordAndSend();
    await waitFor(() => expect(pendingBubbles()).toHaveLength(0));
    expect(storage).not.toHaveBeenCalled();
    // Nothing is requested for the message until its first tap (the player assigns `src` on the tap).
    expect(container.querySelector('audio')?.getAttribute('src')).toBeNull();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('asset-1');
  });
});

describe('voice send queue and failures', () => {
  it('posts the takes one at a time in tap order, the second reading "Enviando…" with no percent, the microphone free meanwhile', async () => {
    const first = deferred<ReturnType<typeof sent>>();
    mocks.sendVoice.mockReturnValueOnce(first.promise);
    mocks.sendVoice.mockResolvedValueOnce(
      sent('88888888-8888-4888-8888-888888888888', 3, 'asset-2'),
    );
    inCase();

    await recordAndSend();
    await waitFor(() => expect(mocks.sendVoice).toHaveBeenCalledTimes(1));
    // The microphone is enabled while the first upload is still in flight (A-UI-19).
    expect((mic() as HTMLButtonElement).disabled).toBe(false);
    await recordAndSend();

    expect(pendingBubbles()).toHaveLength(2);
    expect(footerOf(pendingBubbles()[1] as Element)).toBe('Enviando…');
    // The second take has not started: ONE start, ONE send, until the first settles.
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.sendVoice).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve(sent('77777777-7777-4777-8777-777777777777', 2, 'asset-1'));
    });
    await waitFor(() => expect(mocks.sendVoice).toHaveBeenCalledTimes(2));
    expect(mocks.start).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(pendingBubbles()).toHaveLength(0));
    // The server order of the two final bubbles is the tap order.
    const order = bubbles().map((el) => el.getAttribute('data-chat-message'));
    expect(order.slice(1)).toEqual([
      '77777777-7777-4777-8777-777777777777',
      '88888888-8888-4888-8888-888888888888',
    ]);
    expect(mocks.sendVoice.mock.calls.map((call) => call[0])).toEqual(['asset-1', 'asset-2']);
  });

  it('shows the percent while bytes move (0, 40, 100) and the plain label during the finishing step', async () => {
    const transfer = deferred<{ ok: true }>();
    const finish = deferred<ReturnType<typeof sent>>();
    let progress: (percent: number) => void = () => {};
    mocks.put.mockImplementation(
      async (_target: unknown, _file: unknown, opts: { onProgress?: (p: number) => void }) => {
        progress = opts.onProgress ?? (() => {});
        return transfer.promise;
      },
    );
    mocks.sendVoice.mockReturnValue(finish.promise);
    inCase();
    await recordAndSend();
    await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));

    const footer = () => footerOf(pendingBubbles()[0] as Element);
    await act(async () => progress(0));
    expect(footer()).toBe('Enviando… 0%');
    await act(async () => progress(40));
    expect(footer()).toBe('Enviando… 40%');
    await act(async () => progress(100));
    expect(footer()).toBe('Enviando… 100%');
    // One pending bubble the whole time, never two.
    expect(pendingBubbles()).toHaveLength(1);

    await act(async () => transfer.resolve({ ok: true }));
    await waitFor(() => expect(mocks.sendVoice).toHaveBeenCalledTimes(1));
    expect(footer()).toBe('Enviando…');
    expect(pendingBubbles()).toHaveLength(1);
    await act(async () => {
      finish.resolve(sent('77777777-7777-4777-8777-777777777777', 2, 'asset-1'));
    });
    await waitFor(() => expect(pendingBubbles()).toHaveLength(0));
  });

  it('posts a text sent meanwhile at once, and the list ends in seq order', async () => {
    const gate = deferred<ReturnType<typeof sent>>();
    mocks.sendVoice.mockReturnValue(gate.promise);
    mocks.sendText.mockResolvedValue({
      ok: true,
      conversationId: CASE_ID,
      view: textView('99999999-9999-4999-8999-999999999999', 3, 'Aguardo'),
    });
    inCase();
    await recordAndSend();
    await waitFor(() => expect(mocks.sendVoice).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'Aguardo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
    // The text did not wait for the voice message.
    await waitFor(() => expect(mocks.sendText).toHaveBeenCalledTimes(1));
    expect(mocks.sendText).toHaveBeenCalledWith('Aguardo');
    await waitFor(() => expect(screen.getByText('Aguardo')).toBeTruthy());

    await act(async () => {
      gate.resolve(sent('77777777-7777-4777-8777-777777777777', 2, 'asset-1'));
    });
    await waitFor(() => expect(pendingBubbles()).toHaveLength(0));
    expect(bubbles().map((el) => el.getAttribute('data-chat-message'))).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '77777777-7777-4777-8777-777777777777',
      '99999999-9999-4999-8999-999999999999',
    ]);
  });

  it('keeps a retriable failure with its retry and discard, and a retry re-sends the SAME asset with no upload', async () => {
    mocks.sendVoice
      .mockResolvedValueOnce({ ok: false, error: 'retriable' })
      .mockResolvedValueOnce(sent('77777777-7777-4777-8777-777777777777', 2, 'asset-1'));
    inCase();
    await recordAndSend();

    await waitFor(() => expect(screen.getByText('Não foi possível enviar.')).toBeTruthy());
    // Stays in the list, no longer dimmed or in flight, with the pair of buttons.
    expect(bubbles()).toHaveLength(2);
    expect(pendingBubbles()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    });
    await waitFor(() => expect(pendingBubbles()).toHaveLength(0));
    await waitFor(() => expect(screen.queryByText('Não foi possível enviar.')).toBeNull());
    // One message: the three upload stages ran ONCE, the send ran twice for the same asset.
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect(mocks.sendVoice.mock.calls.map((call) => call[0])).toEqual(['asset-1', 'asset-1']);
    expect(bubbles()).toHaveLength(2);
  });

  it('a transfer that never finished is uploaded again on retry (there is no asset to resume)', async () => {
    mocks.put.mockResolvedValueOnce({ ok: false, reason: 'transfer' });
    mocks.sendVoice.mockResolvedValue(sent('77777777-7777-4777-8777-777777777777', 2, 'asset-2'));
    inCase();
    await recordAndSend();
    await waitFor(() => expect(screen.getByText('Não foi possível enviar.')).toBeTruthy());
    expect(mocks.sendVoice).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    });
    await waitFor(() => expect(mocks.sendVoice).toHaveBeenCalledTimes(1));
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.sendVoice).toHaveBeenCalledWith('asset-2');
  });

  it('discards a failed take: the bubble and the take are gone and nothing is sent', async () => {
    mocks.sendVoice.mockResolvedValue({ ok: false, error: 'retriable' });
    inCase();
    await recordAndSend();
    await waitFor(() => expect(screen.getByText('Não foi possível enviar.')).toBeTruthy());
    const sends = mocks.sendVoice.mock.calls.length;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    });
    expect(bubbles()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
    await settle();
    expect(mocks.sendVoice).toHaveBeenCalledTimes(sends);
  });

  it.each([
    [
      'the send refuses the asset (invalid)',
      () => mocks.sendVoice.mockResolvedValue({ ok: false, error: 'invalid' }),
    ],
    [
      'the storage quota is full',
      () => mocks.start.mockResolvedValue({ ok: false, code: 'quota_exceeded' }),
    ],
    [
      'the recording is over the limit',
      () => mocks.complete.mockResolvedValue({ ok: false, code: 'duration_too_long' }),
    ],
  ])(
    'a permanent refusal (%s) shows one sentence with no number and only "Descartar"',
    async (_name, arrange) => {
      arrange();
      inCase();
      await recordAndSend();

      const sentence = 'Não foi possível enviar esta mensagem de voz. Escreva sua mensagem.';
      await waitFor(() => expect(screen.getByText(sentence)).toBeTruthy());
      expect(screen.getByRole('button', { name: 'Descartar' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
      expect(sentence).not.toMatch(/\d|quota|\bMB\b|limite/i);
      expect(pendingBubbles()).toHaveLength(0);
    },
  );

  it.each([
    ['member_blocked', 'Você não pode enviar mensagens neste chat.'],
    ['member_removed', 'Você não pode enviar mensagens neste chat.'],
  ])(
    'a member refused with %s loses this bubble AND every queued one, sees the notice, refreshes once and gets the read-only strip',
    async (kind, notice) => {
      const first = deferred<{ ok: false; error: string }>();
      mocks.sendVoice.mockReturnValueOnce(first.promise);
      inCase();
      await recordAndSend();
      await waitFor(() => expect(mocks.sendVoice).toHaveBeenCalledTimes(1));
      await recordAndSend();
      expect(pendingBubbles()).toHaveLength(2);

      await act(async () => {
        first.resolve({ ok: false, error: kind });
      });
      await waitFor(() => expect(pendingBubbles()).toHaveLength(0));
      expect(bubbles()).toHaveLength(1);
      // The second take never started.
      expect(mocks.start).toHaveBeenCalledTimes(1);
      expect(mocks.sendVoice).toHaveBeenCalledTimes(1);
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
      // The toast and the strip both read Igor's sentence, and the strip replaces the composer and the microphone.
      expect(screen.getAllByText(notice).length).toBeGreaterThanOrEqual(2);
      expect(document.querySelector('[data-chat-readonly]')?.textContent).toBe(notice);
      expect(screen.queryByLabelText('Mensagem')).toBeNull();
      expect(mic()).toBeNull();
    },
  );

  it('the team is told the shipped notice of the page when a reply races a block', async () => {
    mocks.staffVoice.mockResolvedValue({ ok: false, error: 'member_blocked' });
    renderStaff('in_progress');
    await recordAndSend();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Marina está bloqueado.')).toBeTruthy();
    expect(pendingBubbles()).toHaveLength(0);
    expect(bubbles()).toHaveLength(1);
  });

  it.each(['closed', 'not_found'])('a %s answer removes the bubble and refreshes', async (kind) => {
    mocks.sendVoice.mockResolvedValue({ ok: false, error: kind });
    inCase();
    await recordAndSend();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(bubbles()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('starts nothing more and sets no state once the pane is gone', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = deferred<ReturnType<typeof sent>>();
    mocks.sendVoice.mockReturnValueOnce(first.promise);
    const { unmount } = inCase();
    await recordAndSend();
    await waitFor(() => expect(mocks.sendVoice).toHaveBeenCalledTimes(1));
    await recordAndSend();

    unmount();
    await act(async () => {
      first.resolve(sent('77777777-7777-4777-8777-777777777777', 2, 'asset-1'));
    });
    await settle();
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.sendVoice).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('voice case flows and strips', () => {
  const reopened = {
    case: { id: CASE_ID, number: 42, state: 'open' as const, opened: false, reopened: true },
  };

  it('a voice reply to a Resolvido case reopens it: pill back to Aberto, strip gone, the toast of 12.4', async () => {
    mocks.sendVoice.mockResolvedValue(
      sent('77777777-7777-4777-8777-777777777777', 2, 'asset-1', reopened),
    );
    inCase({ initialCase: memberHeader('resolved') });
    expect(screen.getByText('Resolvido')).toBeTruthy();
    expect(document.querySelector('[data-case-resolved]')).not.toBeNull();

    await recordAndSend();
    await waitFor(() => expect(screen.getByText('Chamado #42 reaberto.')).toBeTruthy());
    expect(screen.getByText('Aberto')).toBeTruthy();
    expect(document.querySelector('[data-case-resolved]')).toBeNull();
    expect(screen.getAllByText('Chamado #42 reaberto.')).toHaveLength(1);
    // A reply to an existing case carries no opener pair.
    expect(mocks.sendVoice).toHaveBeenCalledWith('asset-1');
  });

  it('a send answered for a NEW case after a closed one switches the pane to it, the voice message first', async () => {
    const newHeader = memberHeader('open', {
      id: NEW_ID,
      number: 43,
      title: 'Chamado #43',
      subjectLine: '#43 · Mensagem de voz',
    });
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/messages?')) {
        return Response.json({
          items: [],
          hasMore: false,
          todayKey: '2026-11-17',
          yesterdayKey: '2026-11-16',
        });
      }
      if (u.endsWith('/read')) return new Response(null, { status: 204 });
      if (u === `/api/chat/conversations/${NEW_ID}`) {
        return Response.json({ viewer: 'member', header: newHeader });
      }
      return Response.json({ viewer: 'member', header: memberHeader('closed') });
    });
    mocks.sendVoice.mockResolvedValue({
      ok: true,
      conversationId: NEW_ID,
      view: voiceView('77777777-7777-4777-8777-777777777777', 1, 'asset-1'),
      case: { id: NEW_ID, number: 43, state: 'open', opened: true, reopened: false },
    });
    inCase({ initialCase: memberHeader('in_progress') });

    await recordAndSend();
    await waitFor(() => expect(screen.getByText('Chamado #43')).toBeTruthy());
    expect(screen.queryByText('Oi, preciso de ajuda')).toBeNull();
    expect(bubbles()).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Mensagem de voz, 3 segundos' })).toBeTruthy();
    expect(document.querySelector('[data-case-closed]')).toBeNull();
  });

  it('keeps the opener chip and subject after a FAILED first voice send, and the bar starts as the typed subject', async () => {
    mocks.sendVoice
      .mockResolvedValueOnce({ ok: false, error: 'retriable' })
      .mockResolvedValueOnce(sent('77777777-7777-4777-8777-777777777777', 1, 'asset-1', opened));
    const { container } = renderPane();
    fireEvent.click(screen.getByRole('button', { name: 'Conta' }));
    fireEvent.change(screen.getByLabelText('Assunto (opcional)'), {
      target: { value: 'Minha senha' },
    });
    await recordAndSend(3, 'Abrir chamado com a mensagem de voz');
    await waitFor(() => expect(screen.getByText('Não foi possível enviar.')).toBeTruthy());

    // The opener is exactly as the member left it and no case bar was drawn.
    expect(screen.getByRole('button', { name: 'Conta' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Assunto (opcional)') as HTMLInputElement).value).toBe(
      'Minha senha',
    );
    expect(container.querySelector('[data-case-bar]')).toBeNull();
    expect(mocks.sendVoice).toHaveBeenCalledWith('asset-1', 'account', 'Minha senha');

    // The opener stays usable and the retry still carries the chip and the subject.
    fireEvent.click(screen.getByRole('button', { name: 'Pagamento' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    });
    await waitFor(() => expect(container.querySelector('[data-case-bar]')).not.toBeNull());
    expect(mocks.sendVoice).toHaveBeenLastCalledWith('asset-1', 'payment', 'Minha senha');
  });

  it('with no typed subject the bar starts as the finished label "Mensagem de voz"', async () => {
    mocks.sendVoice.mockResolvedValue(
      sent('77777777-7777-4777-8777-777777777777', 1, 'asset-1', opened),
    );
    // The re-read of the header never lands in this test: the bar keeps what the send gave it.
    memberHeaderAnswer = () => new Response(null, { status: 500 });
    const { container } = renderPane();
    await recordAndSend(3, 'Abrir chamado com a mensagem de voz');
    await waitFor(() => expect(container.querySelector('[data-case-bar]')).not.toBeNull());
    expect(container.querySelector('[data-case-bar]')?.textContent).toContain('Mensagem de voz');
    expect(mocks.sendVoice).toHaveBeenCalledWith('asset-1', 'other', undefined);
  });

  it('a staff voice reply to an unowned Aberto case sends through the staff action, labels the bubble "Você", re-reads the header and keeps the hint', async () => {
    mocks.staffVoice.mockResolvedValue({
      ok: true,
      conversationId: CASE_RECORD,
      view: voiceView('77777777-7777-4777-8777-777777777777', 2, 'asset-1', {
        authorKey: 'staff:you',
        label: { firstName: 'Você', srSuffix: '', icon: null },
      }),
    });
    renderStaff('open');
    expect(screen.getByText('Ao responder, você assume este chamado.')).toBeTruthy();
    const before = fetchMock.mock.calls.filter(([url]) => String(url).includes(CASE_RECORD)).length;

    await recordAndSend();
    // The optimistic bubble is the team's own, labelled "Você".
    expect(document.querySelector('[data-chat-sender]')?.textContent).toBe('Você');
    await waitFor(() => expect(mocks.staffVoice).toHaveBeenCalledTimes(1));
    expect(mocks.staffVoice).toHaveBeenCalledWith(CASE_RECORD, 'asset-1');
    await waitFor(() => expect(pendingBubbles()).toHaveLength(0));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).includes(CASE_RECORD)).length,
      ).toBeGreaterThan(before),
    );
    expect(screen.getByText('Ao responder, você assume este chamado.')).toBeTruthy();
    expect(mocks.staffText).not.toHaveBeenCalled();
  });

  it('a staff voice reply on Resolvido does not reopen it, and the hint is not drawn', async () => {
    staffHeaderAnswer = () => Response.json({ viewer: 'staff', header: staffHeader('resolved') });
    mocks.staffVoice.mockResolvedValue({
      ok: true,
      conversationId: CASE_RECORD,
      view: voiceView('77777777-7777-4777-8777-777777777777', 2, 'asset-1'),
    });
    renderStaff('resolved');
    expect(screen.queryByText('Ao responder, você assume este chamado.')).toBeNull();
    await recordAndSend();
    await waitFor(() => expect(mocks.staffVoice).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(pendingBubbles()).toHaveLength(0));
    expect(screen.getAllByText('Resolvido').length).toBeGreaterThan(0);
    expect(screen.queryByText('Aberto')).toBeNull();
  });

  it('mounts the microphone only where the composer renders and a voice action exists', () => {
    const { unmount } = renderStaff('in_progress', { onSendVoiceAction: undefined });
    expect(mic()).toBeNull();
    unmount();
    renderStaff('closed');
    // Fechado: the strip is the only message, so there is no composer and no microphone.
    expect(mic()).toBeNull();
    expect(screen.queryByLabelText('Mensagem')).toBeNull();
  });

  it('discards a recording in progress, with the microphone released, when the case closes live', async () => {
    inCase();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Gravar mensagem de voz' }));
    });
    await settle();
    expect(screen.getByRole('button', { name: 'Enviar mensagem de voz' })).toBeTruthy();
    expect(rec.track.stop).not.toHaveBeenCalled();

    memberHeaderAnswer = () => Response.json({ viewer: 'member', header: memberHeader('closed') });
    const call = mocks.realtime.mock.calls.at(-1) as unknown[];
    await act(async () => {
      (call[2] as (event: string, payload: unknown) => void)(REALTIME_EVENTS.chatCase, {
        id: CASE_ID,
        conversationId: CASE_ID,
      });
    });
    await waitFor(() => expect(document.querySelector('[data-case-closed]')).not.toBeNull());

    expect(rec.track.stop).toHaveBeenCalled();
    // The strip is the only message: no recording send, no microphone, nothing was sent.
    expect(screen.queryByRole('button', { name: 'Enviar mensagem de voz' })).toBeNull();
    expect(mic()).toBeNull();
    expect(mocks.sendVoice).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('discards a recording in progress when the member is blocked or removed (the strip arrives)', async () => {
    const { rerenderWith } = inCase();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Gravar mensagem de voz' }));
    });
    await settle();
    expect(rec.track.stop).not.toHaveBeenCalled();

    rerenderWith({ readOnlyNotice: 'Marina está bloqueado.' });
    expect(rec.track.stop).toHaveBeenCalled();
    expect(screen.getByText('Marina está bloqueado.')).toBeTruthy();
    expect(mic()).toBeNull();
    expect(mocks.sendVoice).not.toHaveBeenCalled();
  });

  it('pauses a playing voice message when a recording starts', async () => {
    const pauses: HTMLMediaElement[] = [];
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      pauses.push(this);
    });
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    inCase({
      initialViews: [
        voiceView('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, 'm-1', { side: 'other' }),
        voiceView('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 2, 'm-2', { side: 'other' }),
      ],
    });
    const audio = document.querySelector('audio') as HTMLMediaElement;
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Tocar mensagem de voz' })[0] as HTMLElement,
    );
    fireEvent.playing(audio);
    expect(audio.getAttribute('src')).toBe('/v1/media/m-1/original');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Gravar mensagem de voz' }));
    });
    expect(pauses).toContain(audio);
  });

  it('draws a deleted recording as its sentence with no player, and a catch-up that brings the flag flips a bubble in place', async () => {
    const live = voiceView('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, 'm-1', { side: 'other' });
    inCase({ initialViews: [live] });
    expect(document.querySelectorAll('audio')).toHaveLength(1);
    expect(screen.queryByText('Mensagem de voz apagada')).toBeNull();

    const gone = {
      ...live,
      voice: { ...(live.voice as NonNullable<typeof live.voice>), deleted: true as const },
    };
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/messages?')) {
        return Response.json({
          items: [gone],
          hasMore: false,
          todayKey: '2026-11-17',
          yesterdayKey: '2026-11-16',
        });
      }
      if (u.endsWith('/read')) return new Response(null, { status: 204 });
      return Response.json({ viewer: 'member', header: memberHeader('open') });
    });
    const call = mocks.realtime.mock.calls.at(-1) as unknown[];
    await act(async () => {
      (call[2] as (event: string, payload: unknown) => void)(REALTIME_EVENTS.chatMessage, {
        seq: 2,
      });
    });
    await waitFor(() => expect(screen.getByText('Mensagem de voz apagada')).toBeTruthy());
    expect(document.querySelectorAll('audio')).toHaveLength(0);
    expect(bubbles()).toHaveLength(1);
  });

  it('speaks the chosen speed through the polite region ("Velocidade 1,5x.")', async () => {
    inCase({
      initialViews: [
        voiceView('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, 'm-1', { side: 'other' }),
      ],
    });
    const region = document.querySelector('[data-chat-rate-status]') as HTMLElement;
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Velocidade de reprodução/ }));
    });
    expect(region.textContent).toBe('Velocidade 1,5x.');
    // Never stored.
    expect(Object.keys(localStorage)).toHaveLength(0);
  });
});
