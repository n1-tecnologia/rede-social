'use client';

import { convTopic, REALTIME_EVENTS } from '@rede-social/contracts/realtime';
import { TenantLogo, useRealtimeTopic } from '@rede-social/core/ui';
import { CHAT_PAGE_SIZE } from '@rede-social/module-chat/contracts';
import { ChatComposer, MessageList } from '@rede-social/module-chat/ui';
import { Button, EmptyState, useToast } from '@rede-social/ui';
import { ArrowDown, Ban, MessageCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cursorAfterOwnSend, cursorAfterPage, isReplayedSignal } from '@/lib/chat-cursor';
import { type ChatDayKeys, type ChatMessageView, type ChatViewer, chatRuns } from '@/lib/chat-view';
import { type ReplyToConversationResult, sendSupportMessageAction } from './actions';

/**
 * The member's support thread pane (UI-D-261, D-240, CHAT-04) [designed]: the scroller and the
 * composer under the server-rendered `ThreadHeader`, inside the page's fixed-height column.
 *
 * - **Open at the bottom, before paint** (a layout effect on mount), with the latest 50 messages.
 * - **History:** "Carregar mensagens anteriores" fetches `beforeSeq` of the first message and prepends
 *   it while keeping the previously first message where it was (the scroll height delta is added back
 *   before paint). Focus stays on the button; a failure shows the inline line with retry.
 * - **Live:** the pane joins `tenant:<t>:conv:<c>` once a conversation exists. A `chat.message`
 *   signal whose `seq` is above the catch-up cursor runs the catch-up; so do every (re)subscribe and
 *   every `visibilitychange` to visible (D-240). The catch-up fetches `afterSeq=cursor` through the
 *   BFF until a short page, ONE at a time (a signal during a run schedules exactly one more), and
 *   merges by id in `seq` order, so a replayed or out-of-order signal never duplicates a bubble
 *   (T-07-64/65). The cursor is NOT the highest seq on screen: only a catch-up page moves it freely,
 *   and an own send moves it only when it is the very next seq; a send past a gap runs a catch-up
 *   instead (07 review C-CR-01, `lib/chat-cursor.ts`), so the other side's reply whose signal lands
 *   after the send's answer is never taken for a replay.
 * - **Auto-scroll** only when the viewer was within 80px of the bottom; otherwise the pill counts what
 *   arrived and scrolls to the end on tap (the messenger rule: never yank the reader away).
 * - **Read:** after mount and after each append from the other side, while visible, the highest seq is
 *   POSTed to the BFF read route with `keepalive` (D-237: that clears the member's dot). The page's
 *   server render records nothing.
 * - **Send:** an optimistic own bubble ("Enviando…") is appended and scrolled into view, then the
 *   server action answers the finished view (replacing the optimistic one, keyed by id) and, on the
 *   first message, the conversation id to join. A failure removes the bubble and answers `false`, so
 *   the composer restores the draft and shows its inline error (UI-D-260).
 *
 * **Staff view (07-10, UI-D-263):** the same pane with `viewer="staff"` and the staff reply injected as
 * `onSendAction`. A staff thread has no greeting (it exists only once the member wrote; a zero-message
 * thread reached by URL shows an empty log with the composer enabled), the optimistic bubble reads
 * "Você", and `readOnlyNotice` (a blocked or departed member) replaces the composer with the notice.
 * A reply racing a block answers `member_blocked` / `member_removed`: the draft is restored with the
 * notice as its inline error, the same sentence is toasted, and `router.refresh()` re-renders the page,
 * which then passes the notice and swaps the composer out.
 *
 * Every string comes from the `chat` catalog; every time and day label is server-formatted
 * (`chat-view.ts`), and this component never reads the clock (UI-D-14).
 */

export interface ThreadPaneProps {
  tenantId: string;
  tenantName: string;
  logoUrl: string | null;
  /** `null` until the member's first message creates the conversation (lazy creation, D-220). */
  initialConversationId: string | null;
  initialViews: ChatMessageView[];
  initialHasOlder: boolean;
  initialKeys: ChatDayKeys;
  /** The server could not load the thread: the error state, no composer. */
  initialError: boolean;
  /** Who reads: the member in their own thread (default) or staff in the inbox thread (07-10). */
  viewer?: ChatViewer;
  /** 07-10: the staff reply (a server action). Without it the pane sends as the member. */
  onSendAction?: (conversationId: string, body: string) => Promise<ReplyToConversationResult>;
  /** 07-10 (UI-D-263): a blocked or departed member's thread is read-only; the notice replaces the composer. */
  readOnlyNotice?: string | null;
  /** 07-10: the notices a reply racing a block or a departure toasts (the 409 answers). */
  raceNotices?: { member_blocked: string; member_removed: string };
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

/**
 * The empty greeting (UI-D-258, sketch 007 surface 6) [designed]: centred in the pane, the tenant
 * logo at `home` size when there is one (omitted when absent or broken), the title and the body. The
 * composer under it is enabled: the first message creates the conversation and replaces this.
 */
function SupportGreeting({
  logoUrl,
  tenantName,
  title,
  body,
}: {
  logoUrl: string | null;
  tenantName: string;
  title: string;
  body: string;
}) {
  return (
    <div
      data-chat-greeting
      className="flex min-h-full flex-col items-center justify-center gap-3 px-8 py-12 text-center"
    >
      {logoUrl ? (
        <TenantLogo logoUrl={logoUrl} displayName={tenantName} size="home" hideOnError />
      ) : null}
      <h2 className="text-base font-bold leading-tight text-text">{title}</h2>
      <p className="text-sm font-normal text-text-secondary">{body}</p>
    </div>
  );
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

export function ThreadPane({
  tenantId,
  tenantName,
  logoUrl,
  initialConversationId,
  initialViews,
  initialHasOlder,
  initialKeys,
  initialError,
  viewer = 'member',
  onSendAction,
  readOnlyNotice = null,
  raceNotices,
}: ThreadPaneProps) {
  const t = useTranslations('chat');
  const router = useRouter();
  const { show } = useToast();
  /** The composer's inline error: the generic failure, or a race notice until the refresh lands. */
  const [sendError, setSendError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [views, setViews] = useState<ChatMessageView[]>(initialViews);
  const [keys, setKeys] = useState<ChatDayKeys>(initialKeys);
  const [hasOlder, setHasOlder] = useState(initialHasOlder);
  const [olderState, setOlderState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [newCount, setNewCount] = useState(0);

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
    }).catch(() => {
      // A failed mark is retried by the next append or refocus: the dot simply stays.
      readSeqRef.current = Math.min(readSeqRef.current, seq - 1);
    });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount only; later reads follow appends.
  useEffect(() => {
    markRead();
  }, []);

  /** D-240: fetch everything after `lastSeq`, one run at a time, until a short page. */
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
          if (!answer) break;
          setKeys({ todayKey: answer.todayKey, yesterdayKey: answer.yesterdayKey });
          cursorRef.current = cursorAfterPage(
            cursorRef.current,
            answer.items.map((item) => item.seq),
          );
          // Dedupe by id, never by a moving max: an own send may already show a later seq (C-CR-01).
          const known = new Set(settledOf(viewsRef.current).map((view) => view.id));
          const fresh = answer.items.filter((item) => !known.has(item.id));
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
    { onSubscribed: () => void catchUp() },
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

  const onSend = async (body: string): Promise<boolean> => {
    pendingIdRef.current += 1;
    const tempId = `pending-${pendingIdRef.current}`;
    const staff = viewer === 'staff';
    const optimistic: ChatMessageView = {
      id: tempId,
      seq: 0,
      side: 'own',
      authorKey: staff ? 'staff:you' : 'member',
      body,
      label: staff ? { firstName: t('sender.you'), srSuffix: '', icon: null } : null,
      time: '',
      dayKey: keys.todayKey,
      createdAtMs: 0,
      pending: true,
    };
    intentRef.current = { kind: 'bottom' };
    setViews((current) => [...current, optimistic]);

    let result: ReplyToConversationResult | null = null;
    try {
      const id = conversationRef.current;
      if (onSendAction) result = id ? await onSendAction(id, body) : null;
      else result = await sendSupportMessageAction(body);
    } catch {
      result = null;
    }
    if (!result?.ok) {
      setViews((current) => current.filter((view) => view.id !== tempId));
      const race =
        result && (result.error === 'member_blocked' || result.error === 'member_removed')
          ? (raceNotices?.[result.error] ?? null)
          : null;
      if (race) {
        // UI-D-263: the draft comes back with the notice, the toast says why, and the refreshed page
        // swaps the composer for the read-only notice.
        setSendError(race);
        show({ tone: 'error', message: race });
        router.refresh();
      } else {
        setSendError(null);
      }
      return false;
    }
    const { view, conversationId: created } = result;
    if (!conversationRef.current) {
      conversationRef.current = created;
      setConversationId(created);
    }
    intentRef.current = { kind: 'bottom' };
    // C-CR-01: the own seq moves the cursor only when nothing can be missing before it; past a gap
    // (the other side wrote meanwhile and its signal has not landed yet) the catch-up fills it.
    const next = cursorAfterOwnSend(cursorRef.current, view.seq);
    cursorRef.current = next.cursor;
    setViews((current) => mergeViews(current, [view], [tempId]));
    setNewCount(0);
    if (next.catchUp) void catchUp();
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

  if (initialError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-center">
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

        {views.length === 0 && viewer === 'member' ? (
          <SupportGreeting
            logoUrl={logoUrl}
            tenantName={tenantName}
            title={t('member.empty.title', { tenant: tenantName })}
            body={t('member.empty.body')}
          />
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
        {readOnlyNotice ? (
          <div
            data-chat-readonly
            className="flex items-center gap-3 border-t border-border bg-bg-secondary px-4 py-3"
          >
            <Ban aria-hidden size={20} className="shrink-0 text-text-tertiary" />
            <p className="text-sm font-normal text-text-secondary">{readOnlyNotice}</p>
          </div>
        ) : (
          <ChatComposer
            label={t('composer.label')}
            placeholder={t('composer.placeholder')}
            sendLabel={t('composer.send')}
            // pt-BR grouping ("1.800") to match the catalog's literal "2.000".
            counterTemplate={(count) =>
              t('composer.counter', { count: count.toLocaleString('pt-BR') })
            }
            errorText={sendError ?? t('composer.errors.failed')}
            onSend={onSend}
          />
        )}
      </div>
    </div>
  );
}
