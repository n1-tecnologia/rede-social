// @vitest-environment happy-dom

import { join } from 'node:path';
import { act, cleanup, renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { StaffCaseHeaderView } from '@/lib/chat-view';

/**
 * 12.4-15 (UI-D-826, UI-D-827, D-805, D-806, D-843, D-845; T-12.4-70, T-12.4-71, T-12.4-88): the hook over the
 * case server actions. It sends INTENT plus the state (and, for a take-over, the owner) the screen showed
 * and nothing else; it maps the closed answer to a toast and a re-read; it computes no transition. The
 * server action is a stub and every argument object is asserted with `toEqual`.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  toast: { show: vi.fn(), dismiss: vi.fn() },
}));

vi.mock('./actions', () => ({
  runCaseActionAction: (...args: unknown[]) => mocks.run(...args),
}));
vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => mocks.toast,
}));

const { useCaseActions } = await import('./useCaseActions');

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '44444444-4444-4444-8444-444444444444';

const STATE_VIEW = {
  open: { state: 'open', label: 'Aberto', tone: 'warning', glyph: 'CircleDot' },
  in_progress: { state: 'in_progress', label: 'Em atendimento', tone: 'brand', glyph: 'UserCheck' },
  resolved: { state: 'resolved', label: 'Resolvido', tone: 'success', glyph: 'CircleCheck' },
  closed: { state: 'closed', label: 'Fechado', tone: 'neutral', glyph: 'Lock' },
} as const;

const header = (
  state: keyof typeof STATE_VIEW,
  over: Partial<StaffCaseHeaderView> = {},
): StaffCaseHeaderView => ({
  viewer: 'staff',
  id: '33333333-3333-4333-8333-333333333333',
  number: 42,
  title: 'Chamado #42',
  state: STATE_VIEW[state],
  subject: 'Meu ingresso',
  subjectLine: '#42 · Meu ingresso',
  meta: 'Pagamento · Normal · Sem responsável',
  actions: ['take', 'resolve', 'close'],
  ownerUserId: null,
  ownerName: null,
  ownerIsViewer: false,
  ...over,
});

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(NextIntlClientProvider, { locale: 'pt-BR', messages }, children);

function setup(current: StaffCaseHeaderView) {
  const onHeader = vi.fn();
  const onStale = vi.fn();
  const hook = renderHook(
    () => useCaseActions({ conversationId: CONVERSATION_ID, header: current, onHeader, onStale }),
    { wrapper },
  );
  return { ...hook, onHeader, onStale };
}

beforeEach(() => {
  mocks.run.mockReset();
  mocks.toast.show.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('taking an unowned open case (the tracer)', () => {
  it('calls the action with the expected state alone and opens no dialog', async () => {
    const answered = header('in_progress', { ownerIsViewer: true, ownerUserId: OWNER_ID });
    mocks.run.mockResolvedValue({ ok: true, header: answered });
    const { result, onHeader } = setup(header('open'));

    await act(async () => {
      result.current.request('take');
    });

    expect(result.current.dialog).toBeNull();
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run.mock.calls[0]).toEqual([
      CONVERSATION_ID,
      { action: 'take', expectedState: 'open' },
    ]);
    expect(onHeader).toHaveBeenCalledWith(answered);
    expect(mocks.toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Chamado #42 assumido.',
    });
  });

  it('is pending while the server works and refuses a second tap', async () => {
    let release: (value: unknown) => void = () => {};
    mocks.run.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const { result } = setup(header('open'));

    act(() => {
      result.current.request('take');
    });
    expect(result.current.pending).toBe('take');
    act(() => {
      result.current.request('take');
    });
    expect(mocks.run).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ ok: false, error: 'failed' });
    });
    expect(result.current.pending).toBeNull();
  });
});

describe('the answer maps to a toast and a re-read, never to a local transition', () => {
  it('a stale answer toasts the stale text and calls the re-read', async () => {
    mocks.run.mockResolvedValue({ ok: false, error: 'stale' });
    const { result, onHeader, onStale } = setup(header('open'));
    await act(async () => {
      result.current.request('take');
    });
    expect(mocks.toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Este chamado mudou enquanto você olhava. A tela foi atualizada.',
    });
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onHeader).not.toHaveBeenCalled();
  });

  it.each(['closed', 'not_allowed'] as const)(
    'a %s refusal means the screen was out of date: stale toast and a re-read',
    async (error) => {
      mocks.run.mockResolvedValue({ ok: false, error });
      const { result, onStale } = setup(header('open'));
      await act(async () => {
        result.current.request('take');
      });
      expect(onStale).toHaveBeenCalledTimes(1);
      expect(mocks.toast.show.mock.calls[0]?.[0].message).toBe(
        'Este chamado mudou enquanto você olhava. A tela foi atualizada.',
      );
    },
  );

  it.each(['failed', 'invalid'] as const)(
    'a %s result toasts the failure text and keeps the state',
    async (error) => {
      mocks.run.mockResolvedValue({ ok: false, error });
      const { result, onHeader, onStale } = setup(header('open'));
      await act(async () => {
        result.current.request('take');
      });
      expect(mocks.toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Não foi possível concluir. Tente de novo.',
      });
      expect(onHeader).not.toHaveBeenCalled();
      expect(onStale).not.toHaveBeenCalled();
    },
  );

  it('a thrown action is the failure toast, not an unhandled rejection', async () => {
    mocks.run.mockRejectedValue(new Error('network'));
    const { result } = setup(header('open'));
    await act(async () => {
      result.current.request('take');
    });
    expect(mocks.toast.show.mock.calls[0]?.[0].message).toBe(
      'Não foi possível concluir. Tente de novo.',
    );
    expect(result.current.pending).toBeNull();
  });
});

describe('which actions ask first (UI-D-827, D-843)', () => {
  it.each(['resolve', 'close', 'reopen'] as const)(
    '%s always opens its dialog and sends nothing yet',
    (kind) => {
      const { result } = setup(
        header('in_progress', { ownerUserId: OWNER_ID, ownerName: 'Carla' }),
      );
      act(() => {
        result.current.request(kind);
      });
      expect(result.current.dialog?.kind).toBe(kind);
      expect(mocks.run).not.toHaveBeenCalled();
    },
  );

  it('a take-over of a live owner asks first, naming the owner', () => {
    const { result } = setup(
      header('in_progress', { ownerUserId: OWNER_ID, ownerName: 'Carla Souza' }),
    );
    act(() => {
      result.current.request('take');
    });
    expect(result.current.dialog).toMatchObject({ kind: 'take', ownerName: 'Carla Souza' });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('a take of a case whose owner left the staff takes at once and still sends the stored owner', async () => {
    mocks.run.mockResolvedValue({ ok: false, error: 'failed' });
    const { result } = setup(header('in_progress', { ownerUserId: OWNER_ID, ownerName: null }));
    await act(async () => {
      result.current.request('take');
    });
    expect(result.current.dialog).toBeNull();
    expect(mocks.run.mock.calls[0]).toEqual([
      CONVERSATION_ID,
      { action: 'take', expectedState: 'in_progress', expectedOwnerId: OWNER_ID },
    ]);
  });

  it('confirming a dialog sends the state the screen showed when it was opened, not a later one', async () => {
    mocks.run.mockResolvedValue({ ok: false, error: 'stale' });
    let current = header('open');
    const onHeader = vi.fn();
    const onStale = vi.fn();
    const { result, rerender } = renderHook(
      () => useCaseActions({ conversationId: CONVERSATION_ID, header: current, onHeader, onStale }),
      { wrapper },
    );
    act(() => {
      result.current.request('resolve');
    });
    // Another person took the case while the dialog was open: the screen re-read it.
    current = header('in_progress', { ownerUserId: OWNER_ID, ownerName: 'Carla' });
    rerender();
    await act(async () => {
      await result.current.confirm();
    });
    expect(mocks.run.mock.calls[0]).toEqual([
      CONVERSATION_ID,
      { action: 'resolve', expectedState: 'open' },
    ]);
  });

  it('a successful reopen, resolve and close each toast their own sentence', async () => {
    for (const [kind, text] of [
      ['resolve', 'Chamado #42 resolvido.'],
      ['close', 'Chamado #42 fechado.'],
      ['reopen', 'Chamado #42 reaberto.'],
    ] as const) {
      mocks.toast.show.mockReset();
      mocks.run.mockReset();
      mocks.run.mockResolvedValue({ ok: true, header: header('closed') });
      const { result, unmount } = setup(header('in_progress'));
      act(() => {
        result.current.request(kind);
      });
      await act(async () => {
        await result.current.confirm();
      });
      expect(mocks.toast.show).toHaveBeenCalledWith({ tone: 'success', message: text });
      expect(mocks.run.mock.calls[0]).toEqual([
        CONVERSATION_ID,
        { action: kind, expectedState: 'in_progress' },
      ]);
      unmount();
    }
  });
});
