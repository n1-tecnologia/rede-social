'use client';

import { convTopic, REALTIME_EVENTS } from '@rede-social/contracts/realtime';
import { useRealtimeTopic } from '@rede-social/core/ui';
import { CHAT_PAGE_SIZE } from '@rede-social/module-chat/contracts';
import { ChatComposer, MessageList } from '@rede-social/module-chat/ui';
import { Avatar, Button, EmptyState } from '@rede-social/ui';
import { ArrowDown, MessageCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type SendDirectMessageResult, sendDirectMessage } from '@/app/(app)/conversas/actions';
import { cursorAfterOwnSend, cursorAfterPage, isReplayedSignal } from '@/lib/chat-cursor';
import {
  type ChatDayKeys,
  type ChatMessageView,
  type ComposerStateView,
  chatRuns,
  type DirectOtherView,
} from '@/lib/chat-view';

/**
 * The direct conversation's body (11-22, CHAT-06, D-720, UI-D-864) [designed]: the scroller and the composer
 * under the server-rendered `DirectThreadFrame`, inside the page's fixed-height column.
 *
 * It is built from the SHIPPED chat parts (`MessageList`, `ChatComposer`, `chat-cursor`, `chat-view`), copying the
 * structure of the support thread's pane and never extending it: a direct conversation has no case, no opener,
 * no greeting and no staff side, so a branch inside the 1257-line `ThreadPane` would only have been weight.
 *
 * - **Lazy start (D-720).** With no conversation yet (`/conversas/com/{membershipId}`) the scroller holds the
 *   contact's 80px avatar, "Escreva para {nome}" and one line of explanation, and the composer is enabled. The
 *   FIRST send creates the conversation: the view swaps IN PLACE to the thread holding the sent bubble, the
 *   address becomes `/conversas/{conversationId}` through a history `replace`, focus stays in the field, and NO
 *   confirmation row and NO toast appear (unlike the support case). A failed first send keeps the draft with the
 *   composer's own inline error.
 * - **Open at the bottom, before paint**, with the latest 50 messages; "Carregar mensagens anteriores" prepends
 *   the earlier page while keeping the first message where it was.
 * - **Live:** the pane joins `tenant:<t>:conv:<c>` once a conversation exists. A `chat.message` signal whose
 *   `seq` is above the catch-up cursor runs the catch-up; so do every (re)subscribe and every `visibilitychange`
 *   to visible (D-240). The catch-up fetches `afterSeq=cursor` through the BFF until a short page, ONE at a
 *   time, and merges by id in `seq` order, so a replayed or out-of-order signal never duplicates a bubble.
 *   The cursor is moved only by `lib/chat-cursor.ts`.
 * - **Auto-scroll** only when the reader was within 80px of the bottom; otherwise the pill counts what arrived.
 * - **Read:** after mount and after each append from the other side, while visible, the highest seq is POSTed to
 *   the BFF read route with `keepalive` (D-237). The page's server render records nothing.
 * - **Send:** an optimistic own bubble ("Enviando…") is appended, then the server action answers the FINISHED
 *   view (replacing the optimistic one, keyed by id) and, on the first message, the conversation id to join.
 *
 * Every string comes from the `chat` catalog; every time and day label is server-formatted (`chat-view.ts`), and
 * this component never reads the clock (UI-D-14). Every member string is a React text node (T-11-16).
 */

export interface DirectThreadPaneProps {
  tenantId: string;
  /** The contact, finished (name, avatar, membership id; a departed account has none of them). */
  other: DirectOtherView;
  /** `null` until the member's first message creates the conversation (lazy creation, D-720). */
  initialConversationId: string | null;
  initialViews: ChatMessageView[];
  initialHasOlder: boolean;
  initialKeys: ChatDayKeys;
  /** What the composer slot draws first (the pane re-reads it on every signal). */
  initialComposer: ComposerStateView;
  /** The server's own answer to "may the viewer block this person" (a member viewer, a live other, not blocked yet). */
  canBlock: boolean;
  /** The tenant's display name, for the report sheet's intro. */
  tenantName: string;
}

interface MessagesAnswer {
  items: ChatMessageView[];
  hasMore: boolean;
  todayKey: string;
  yesterdayKey: string;
}

type ScrollIntent =
  | { kind: 'bottom' }
  | { kind: 'anchor'; height: number; top: number }
  | { kind: 'keep'; nearBottom: boolean };

const NEAR_BOTTOM_PX = 80;
/** The field's id, so a state change can hand the focus back to it (UI-D-865). */
export const DIRECT_COMPOSER_ID = 'direct-composer';

const settledOf = (views: readonly ChatMessageView[]) => views.filter((view) => !view.pending);

/** Merge `incoming` into `current` by id, settled views in `seq` order, pending ones last. */
function mergeViews(
  current: readonly ChatMessageView[],
  incoming: readonly ChatMessageView[],
  dropIds: readonly string[] = [],
): ChatMessageView[] {
  const byId = new Map<string, ChatMessageView>();
  for (const view of settledOf(current)) byId.set(view.id, view);
  for (const view of incoming) byId.set(view.id, view);
  const settled = [...byId.values()].sort((a, b) => a.seq - b.seq);
  const pending = current.filter((view) => view.pending && !dropIds.includes(view.id));
  return [...settled, ...pending];
}

async function fetchPage(conversationId: string, query: string): Promise<MessagesAnswer | null> {
  try {
    const res = await fetch(
      `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages?${query}`,
      { cache: 'no-store', credentials: 'same-origin', redirect: 'manual' },
    );
    if (!res.ok) return null;
    return (await res.json()) as MessagesAnswer;
  } catch {
    return null;
  }
}

/** The thread error card (UI-D-878): the shipped words and the one retry, which re-renders the page. */
export function DirectThreadError() {
  const t = useTranslations('chat');
  const router = useRouter();
  return (
    <div data-direct-thread-error className="flex min-h-0 flex-1 flex-col justify-center">
      <EmptyState
        icon={MessageCircle}
        title={t('thread.errors.load.title')}
        body={t('thread.errors.load.body')}
        action={
          <Button variant="outline" onClick={() => router.refresh()}>
            {t('thread.retry')}
          </Button>
        }
      />
    </div>
  );
}

export function DirectThreadPane({
  tenantId,
  other,
  initialConversationId,
  initialViews,
  initialHasOlder,
  initialKeys,
  initialComposer,
}: DirectThreadPaneProps) {
  const t = useTranslations('chat');
  const router = useRouter();
  const [sendError, setSendError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [views, setViews] = useState<ChatMessageView[]>(initialViews);
  const [keys, setKeys] = useState<ChatDayKeys>(initialKeys);
  const [hasOlder, setHasOlder] = useState(initialHasOlder);
  const [olderState, setOlderState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [newCount, setNewCount] = useState(0);
  const [composer] = useState<ComposerStateView>(initialComposer);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const intentRef = useRef<ScrollIntent | null>({ kind: 'bottom' });
  const conversationRef = useRef(conversationId);
  conversationRef.current = conversationId;
  /** The catch-up cursor (C-CR-01): every live message up to it is held. Moved by `chat-cursor.ts` only. */
  const cursorRef = useRef(
    cursorAfterPage(
      0,
      initialViews.map((view) => view.seq),
    ),
  );
  const viewsRef = useRef(views);
  viewsRef.current = views;
  const readSeqRef = useRef(0);
  const pendingIdRef = useRef(0);
  const catchUpRef = useRef<{ running: boolean; again: boolean }>({ running: false, again: false });

  const nearBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
  }, []);

  // Open at the bottom and apply every later scroll intent BEFORE paint.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the intent is applied after each views change.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const intent = intentRef.current;
    intentRef.current = null;
    if (!el || !intent) return;
    if (intent.kind === 'bottom' || (intent.kind === 'keep' && intent.nearBottom)) {
      el.scrollTop = el.scrollHeight;
    } else if (intent.kind === 'anchor') {
      el.scrollTop = el.scrollHeight - intent.height + intent.top;
    }
  }, [views]);

  /** D-237: while visible, tell the API how far the viewer has read (never twice for one seq). */
  const markRead = useCallback(() => {
    const id = conversationRef.current;
    const seq = cursorRef.current;
    if (!id || seq <= readSeqRef.current) return;
    if (document.visibilityState !== 'visible') return;
    readSeqRef.current = seq;
    void fetch(`/api/chat/conversations/${encodeURIComponent(id)}/read`, {
      method: 'POST',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seq }),
    })
      .then((res) => {
        // A 4xx/5xx resolves the fetch: it failed all the same (07 review C-WR-04).
        if (!res.ok) throw new Error(String(res.status));
      })
      .catch(() => {
        // A failed mark is retried by the next append or refocus: the dot simply stays.
        readSeqRef.current = Math.min(readSeqRef.current, seq - 1);
      });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount only; later reads follow appends.
  useEffect(() => {
    markRead();
  }, []);

  /** D-240: fetch everything after the cursor, one run at a time, until a short page. */
  const catchUp = useCallback(async () => {
    const state = catchUpRef.current;
    if (state.running) {
      state.again = true;
      return;
    }
    state.running = true;
    try {
      do {
        state.again = false;
        for (;;) {
          const id = conversationRef.current;
          if (!id) return;
          const answer = await fetchPage(id, `afterSeq=${cursorRef.current}`);
          if (conversationRef.current !== id) break;
          if (!answer) break;
          setKeys({ todayKey: answer.todayKey, yesterdayKey: answer.yesterdayKey });
          cursorRef.current = cursorAfterPage(
            cursorRef.current,
            answer.items.map((item) => item.seq),
          );
          // Dedupe by id, never by a moving max: an own send may already show a later seq (C-CR-01).
          const known = new Set(settledOf(viewsRef.current).map((view) => view.id));
          const fresh = answer.items.filter((item) => !known.has(item.id));
          // UI-D-858: a recording whose sender left comes back carrying its flag; replaced in place by id.
          const gone = answer.items.filter((item) => known.has(item.id) && item.voice?.deleted);
          if (gone.length > 0) setViews((current) => mergeViews(current, gone));
          if (fresh.length > 0) {
            const stick = nearBottom();
            const fromOther = fresh.filter((item) => item.side === 'other').length;
            intentRef.current = { kind: 'keep', nearBottom: stick };
            setViews((current) => mergeViews(current, fresh));
            if (!stick && fromOther > 0) setNewCount((count) => count + fromOther);
            if (fromOther > 0) markRead();
          }
          if (!answer.hasMore || answer.items.length < CHAT_PAGE_SIZE) break;
        }
      } while (state.again);
    } finally {
      state.running = false;
    }
  }, [nearBottom, markRead]);

  const onSignal = useCallback(
    (_event: string, payload: unknown) => {
      const seq = (payload as { seq?: unknown } | null)?.seq;
      // Ids-only signal: a seq at or below the cursor is a replay, nothing to fetch (T-07-64).
      if (isReplayedSignal(cursorRef.current, seq)) return;
      void catchUp();
    },
    [catchUp],
  );

  useRealtimeTopic(
    conversationId ? convTopic(tenantId, conversationId) : null,
    [REALTIME_EVENTS.chatMessage],
    onSignal,
    {
      onSubscribed: () => {
        void catchUp();
      },
    },
  );

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void catchUp();
      markRead();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [catchUp, markRead]);

  const loadOlder = async () => {
    const id = conversationRef.current;
    const first = settledOf(views)[0];
    if (!id || !first || olderState === 'loading') return;
    setOlderState('loading');
    const answer = await fetchPage(id, `beforeSeq=${first.seq}`);
    if (!answer) {
      setOlderState('error');
      return;
    }
    const el = scrollerRef.current;
    intentRef.current = el ? { kind: 'anchor', height: el.scrollHeight, top: el.scrollTop } : null;
    setKeys({ todayKey: answer.todayKey, yesterdayKey: answer.yesterdayKey });
    setViews((current) => mergeViews(current, answer.items));
    setHasOlder(answer.hasMore);
    setOlderState('idle');
  };

  /**
   * The success tail of a send: the server's view replaces the optimistic one by id, and the FIRST message hands
   * the pane the conversation it created (D-720): the topic is joined, and the address becomes
   * `/conversas/{conversationId}` through a history `replace` (no navigation, no refetch, the field keeps focus).
   */
  const adoptSent = (result: Extract<SendDirectMessageResult, { ok: true }>, tempId: string) => {
    const { view, conversationId: created } = result;
    if (!conversationRef.current) {
      conversationRef.current = created;
      setConversationId(created);
      window.history.replaceState(null, '', `/conversas/${encodeURIComponent(created)}`);
    }
    intentRef.current = { kind: 'bottom' };
    // C-CR-01: the own seq moves the cursor only when nothing can be missing before it; past a gap
    // (the other side wrote meanwhile and its signal has not landed yet) the catch-up fills it.
    const next = cursorAfterOwnSend(cursorRef.current, view.seq);
    cursorRef.current = next.cursor;
    setViews((current) => mergeViews(current, [view], [tempId]));
    setNewCount(0);
    if (next.catchUp) void catchUp();
  };

  const onSend = async (body: string): Promise<boolean> => {
    const toId = other.membershipId;
    if (!toId) return false;
    pendingIdRef.current += 1;
    const tempId = `pending-${pendingIdRef.current}`;
    const optimistic: ChatMessageView = {
      id: tempId,
      seq: 0,
      side: 'own',
      authorKey: 'member',
      body,
      label: null,
      time: '',
      dayKey: keys.todayKey,
      createdAtMs: 0,
      pending: true,
    };
    intentRef.current = { kind: 'bottom' };
    setViews((current) => [...current, optimistic]);

    let result: SendDirectMessageResult | null = null;
    try {
      result = await sendDirectMessage(toId, body);
    } catch {
      result = null;
    }
    if (!result?.ok) {
      setViews((current) => current.filter((view) => view.id !== tempId));
      setSendError(null);
      // The conversation or the person is gone: the page re-renders into the not-found screen, never a message
      // that says why.
      if (result?.error === 'not_found') router.refresh();
      return false;
    }
    adoptSent(result, tempId);
    return true;
  };

  const toBottom = () => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setNewCount(0);
  };

  const items = useMemo(
    () =>
      chatRuns(views, keys, {
        today: t('day.today'),
        yesterday: t('day.yesterday'),
        pending: t('composer.sending'),
      }),
    [views, keys, t],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollerRef}
        data-chat-scroller
        onScroll={() => {
          if (newCount > 0 && nearBottom()) setNewCount(0);
        }}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
      >
        {hasOlder && conversationId ? (
          <div className="flex min-h-11 flex-col items-center justify-center gap-1 px-4 pt-3">
            {olderState === 'error' ? (
              <p data-chat-older-error className="text-center text-sm font-normal text-danger">
                {t('thread.errors.older')}
              </p>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              data-chat-older
              aria-busy={olderState === 'loading' || undefined}
              onClick={() => void loadOlder()}
            >
              {olderState === 'error' ? t('thread.retry') : t('thread.older')}
            </Button>
          </div>
        ) : null}

        {views.length === 0 ? (
          <div
            data-direct-empty
            className="flex min-h-full flex-col items-center justify-center gap-2 p-6 text-center"
          >
            <Avatar size="xl" src={other.avatar} alt="" />
            <h2 className="line-clamp-2 max-w-full break-words text-base font-bold text-text">
              {t('direct.empty.title', { nome: other.name })}
            </h2>
            <p className="max-w-[260px] text-sm font-normal text-text-secondary">
              {t('direct.empty.body')}
            </p>
          </div>
        ) : (
          <MessageList label={t('thread.label')} items={items} />
        )}
      </div>

      <div className="relative shrink-0">
        {newCount > 0 ? (
          <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2">
            <Button variant="secondary" size="sm" data-chat-new-pill onClick={toBottom}>
              <ArrowDown aria-hidden size={16} />
              {t('thread.newMessages', { count: newCount })}
            </Button>
          </div>
        ) : null}
        {composer.state === 'open' ? (
          <ChatComposer
            id={DIRECT_COMPOSER_ID}
            label={t('composer.label')}
            placeholder={t('direct.composer.placeholder')}
            sendLabel={t('composer.send')}
            // pt-BR grouping ("1.800") to match the catalog's literal "2.000".
            counterTemplate={(count) =>
              t('composer.counter', { count: count.toLocaleString('pt-BR') })
            }
            errorText={sendError ?? t('composer.errors.failed')}
            onSend={onSend}
          />
        ) : null}
      </div>
    </div>
  );
}
