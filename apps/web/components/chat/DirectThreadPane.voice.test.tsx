// @vitest-environment happy-dom

import { join } from 'node:path';
import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { ChatMessageView, ComposerStateView, DirectOtherView } from '@/lib/chat-view';
import type { DirectThreadPaneProps } from './DirectThreadPane';

/**
 * 11-22 Task 3 (CHAT-06, D-734, D-722, UI-D-846, UI-D-847, UI-D-865): a direct conversation records and sends
 * voice with the SAME composer, bubble and player as the support chat. The recorder is FAKED (the doubles the
 * support voice tests use: happy-dom has no `MediaRecorder` or `mediaDevices`); the media actions and the send
 * action are mocks, and the real `voiceSendDeps` and `runVoiceSend` run on top of them. There is no real
 * microphone and no real media: a decode and a seek are Igor's proofs.
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
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(() => Promise.resolve(stream)) },
    configurable: true,
    writable: true,
  });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
}

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

MotionGlobalConfig.skipAnimations = true;

const mocks = vi.hoisted(() => ({
  sendText: vi.fn(),
  sendVoice: vi.fn(),
  start: vi.fn(),
  complete: vi.fn(),
  put: vi.fn(),
  refresh: vi.fn(),
  realtime: vi.fn(),
}));

vi.mock('@/app/(app)/conversas/actions', () => ({
  sendDirectMessage: (...args: unknown[]) => mocks.sendText(...args),
  sendDirectVoice: (...args: unknown[]) => mocks.sendVoice(...args),
}));
vi.mock('@/components/feed/safety-actions', () => ({
  unblockMember: vi.fn(),
  reportContent: vi.fn(),
  blockMember: vi.fn(),
}));
vi.mock('@/app/(app)/perfil/actions', () => ({
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

const { DirectThreadPane } = await import('./DirectThreadPane');
// Loaded once here so the pane's lazy import of the wiring is a cache hit when the first take runs.
await import('@/app/(app)/suporte/voice-deps');

const TENANT_ID = '99999999-9999-4999-8999-999999999999';
const CONVERSATION = '0c000000-0000-4000-8000-0000000000c1';
const OTHER_ID = '0e000000-0000-4000-8000-0000000000e1';

const carla: DirectOtherView = {
  membershipId: OTHER_ID,
  name: 'Carla Nunes',
  avatar: null,
  removed: false,
  profileHref: `/membros/${OTHER_ID}`,
};

const OPEN: ComposerStateView = { state: 'open', strip: null };

const voiceView = (id: string, seq: number, side: 'own' | 'other' = 'own'): ChatMessageView => ({
  id,
  seq,
  side,
  authorKey: side === 'own' ? 'member' : 'member:other',
  body: '',
  label: null,
  time: '10:00',
  dayKey: '2026-11-19',
  createdAtMs: Date.parse('2026-11-19T10:00:00Z') + seq,
  voice: {
    mediaId: `asset-${seq}`,
    durationSeconds: 3,
    durationLabel: '0:03',
    spokenLabel: '3 segundos',
  },
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

let nowMs = 0;
let startCount = 0;

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  startCount = 0;
  nowMs = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  installRecording();
  mocks.start.mockImplementation(async () => upload(++startCount));
  mocks.put.mockImplementation(async () => ({ ok: true }));
  mocks.complete.mockImplementation(async () => ({ ok: true }));
  window.history.replaceState(null, '', `/conversas/com/${OTHER_ID}`);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/messages?')) {
        return Response.json({
          items: [],
          hasMore: false,
          todayKey: '2026-11-19',
          yesterdayKey: '2026-11-18',
        });
      }
      return new Response(null, { status: 204 });
    }),
  );
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, 'mediaDevices');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPane(over: Partial<DirectThreadPaneProps> = {}) {
  const props: DirectThreadPaneProps = {
    tenantId: TENANT_ID,
    tenantName: 'Rede Demo',
    other: carla,
    initialConversationId: null,
    initialViews: [],
    initialHasOlder: false,
    initialKeys: { todayKey: '2026-11-19', yesterdayKey: '2026-11-18' },
    initialComposer: OPEN,
    canBlock: true,
    ...over,
  };
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <ToastProvider>
        <DirectThreadPane {...props} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const mic = () => screen.queryByRole('button', { name: 'Gravar mensagem de voz' });
const toasts = () => [...document.querySelectorAll('[role="status"].fixed')];

/** Tap the microphone, let the fake recorder run `seconds`, and tap the recording's send. */
async function recordAndSend(seconds = 3) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Gravar mensagem de voz' }));
  });
  await settle();
  nowMs += seconds * 1000;
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem de voz' }));
  });
  await settle();
}

const pendingBubbles = () => [...document.querySelectorAll('[data-chat-bubble][data-pending]')];

const history = [
  { ...voiceView('33333333-3333-4333-8333-333333333331', 1, 'other') },
] satisfies ChatMessageView[];

describe('voice in a direct conversation (D-734)', () => {
  it('the open composer offers the microphone in the send slot with the shipped placeholder', () => {
    renderPane();
    expect(mic()).not.toBeNull();
    expect((screen.getByLabelText('Mensagem') as HTMLTextAreaElement).placeholder).toBe(
      'Escreva uma mensagem',
    );
  });

  it('a take: pending bubble at once, the action gets the asset and the person, then the server view replaces it', async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.sendVoice.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPane({ initialConversationId: CONVERSATION, initialViews: history });

    await recordAndSend();
    expect(pendingBubbles()).toHaveLength(1);
    expect(pendingBubbles()[0]?.getAttribute('data-chat-bubble')).toBe('own');
    expect(screen.getByRole('progressbar')).toBeTruthy();
    // The microphone is free again while the take goes up (A-UI-19).
    expect((mic() as HTMLButtonElement).disabled).toBe(false);

    await waitFor(() => expect(mocks.sendVoice).toHaveBeenCalledTimes(1));
    expect(mocks.sendVoice).toHaveBeenCalledWith(OTHER_ID, 'asset-1');
    await act(async () => {
      resolve({
        ok: true,
        conversationId: CONVERSATION,
        created: false,
        view: voiceView('77777777-7777-4777-8777-777777777777', 2, 'own'),
      });
    });
    await waitFor(() => expect(pendingBubbles()).toHaveLength(0));
    expect(screen.getAllByRole('group', { name: 'Mensagem de voz, 3 segundos' })).toHaveLength(2);
    expect(toasts()).toHaveLength(0);
  });

  it('the FIRST recording of a pair creates the conversation in place, with no toast', async () => {
    mocks.sendVoice.mockResolvedValue({
      ok: true,
      conversationId: CONVERSATION,
      created: true,
      view: voiceView('77777777-7777-4777-8777-777777777777', 1, 'own'),
    });
    const { container } = renderPane();
    await recordAndSend();
    await waitFor(() => expect(window.location.pathname).toBe(`/conversas/${CONVERSATION}`));
    expect(container.querySelector('[data-direct-empty]')).toBeNull();
    expect(screen.getByRole('group', { name: 'Mensagem de voz, 3 segundos' })).toBeTruthy();
    expect(toasts()).toHaveLength(0);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('a take answered "closed" is discarded like a text: the neutral toast, the strip, no microphone', async () => {
    mocks.sendVoice.mockResolvedValue({ ok: false, error: 'closed' });
    const { container } = renderPane({
      initialConversationId: CONVERSATION,
      initialViews: history,
    });
    await recordAndSend();

    await waitFor(() =>
      expect(container.querySelector('[data-composer-strip="closed"]')).not.toBeNull(),
    );
    expect(pendingBubbles()).toHaveLength(0);
    // Only the other member's recording remains; the take left no bubble and nothing to restore.
    expect(screen.getAllByRole('group', { name: 'Mensagem de voz, 3 segundos' })).toHaveLength(1);
    expect(screen.getAllByText('Esta conversa não aceita novas mensagens.').length).toBe(2);
    expect(mic()).toBeNull();
    expect(screen.queryByLabelText('Mensagem')).toBeNull();
    // Nothing on screen names a block.
    expect(document.body.textContent?.toLowerCase()).not.toContain('bloque');
  });

  it('a take answered "not_found" (the conversation is gone) toasts the generic sentence and refreshes the page', async () => {
    mocks.sendVoice.mockResolvedValue({ ok: false, error: 'not_found' });
    renderPane({ initialConversationId: CONVERSATION, initialViews: history });
    await recordAndSend();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Algo deu errado. Tente novamente.')).toBeTruthy();
    expect(pendingBubbles()).toHaveLength(0);
  });

  it('a permanent refusal keeps the bubble with only "Descartar", and discarding removes it', async () => {
    mocks.sendVoice.mockResolvedValue({ ok: false, error: 'invalid' });
    renderPane({ initialConversationId: CONVERSATION, initialViews: history });
    await recordAndSend();
    const discard = await screen.findByRole('button', { name: 'Descartar' });
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
    fireEvent.click(discard);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Descartar' })).toBeNull());
    expect(mocks.sendVoice).toHaveBeenCalledTimes(1);
  });

  it('a retriable failure offers "Tentar novamente" and sends the same take again', async () => {
    mocks.sendVoice.mockResolvedValueOnce({ ok: false, error: 'retriable' }).mockResolvedValueOnce({
      ok: true,
      conversationId: CONVERSATION,
      created: false,
      view: voiceView('77777777-7777-4777-8777-777777777777', 2, 'own'),
    });
    renderPane({ initialConversationId: CONVERSATION, initialViews: history });
    await recordAndSend();
    const retry = await screen.findByRole('button', { name: 'Tentar novamente' });
    await act(async () => {
      fireEvent.click(retry);
    });
    await waitFor(() => expect(mocks.sendVoice).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(pendingBubbles()).toHaveLength(0));
    // One asset, uploaded once: a retry resends the stored one.
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
});
