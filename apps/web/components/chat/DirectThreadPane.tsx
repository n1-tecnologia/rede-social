'use client';

import { convTopic, REALTIME_EVENTS } from '@rede-social/contracts/realtime';
import { useRealtimeTopic } from '@rede-social/core/ui';
import { CHAT_PAGE_SIZE } from '@rede-social/module-chat/contracts';
import {
  ChatComposer,
  type ChatComposerVoice,
  type MessageBubbleVoice,
  MessageList,
  pauseAllVoice,
  type VoiceTake as RecordedTake,
} from '@rede-social/module-chat/ui';
import { Avatar, Button, EmptyState, useToast } from '@rede-social/ui';
import { ArrowDown, MessageCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type SendDirectMessageResult,
  type SendDirectVoiceResult,
  sendDirectMessage,
  sendDirectVoice,
} from '@/app/(app)/conversas/actions';
import {
  type BlockTarget,
  ReportAndBlock,
  type ReportTarget,
} from '@/components/feed/ReportAndBlock';
import { blockMember, reportContent, unblockMember } from '@/components/feed/safety-actions';
import { cursorAfterOwnSend, cursorAfterPage, isReplayedSignal } from '@/lib/chat-cursor';
import {
  type ChatDayKeys,
  type ChatMessageView,
  type ComposerStateView,
  type ComposerStripView,
  chatRuns,
  composerStateView,
  type DirectOtherView,
  formatVoiceDuration,
  nextPlaybackRate,
  playbackRateLabel,
  spokenVoiceDuration,
} from '@/lib/chat-view';
import {
  runVoiceSend,
  type VoiceFailureKind,
  type VoiceResume,
  type VoiceSendError,
} from '@/lib/voice-send';
import { ComposerStateStrip } from './ComposerStateStrip';
import { MessageMenuSheet, type MessageMenuTarget, MessageMenuTrigger } from './MessageMenuSheet';

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
 * - **The composer slot (UI-D-865, D-722, D-723): exactly one of four states.** `open` is the shipped composer;
 *   `closed` (the other side blocked this member) replaces the composer AND its microphone with the ONE sentence;
 *   `blocker` (this member blocked) is the strip with a one-tap "Desbloquear"; `removed` is the read-only strip.
 *   The state is read with the thread and RE-READ on every conversation signal, (re)subscribe and
 *   `visibilitychange`, and a live change toasts nothing, announces only the strip's own `role="status"` and
 *   moves neither the scroll nor the focus. The pane never computes a state: it draws the server's.
 * - **A refused send is silent and neutral (D-722).** When the server refuses with `closed` (the state reached
 *   mid-session) the optimistic bubble is REMOVED, the shipped toast says the one sentence and the strip appears;
 *   nothing on screen, in an accessible name or in a log names a block or the blocker. With the conversation gone
 *   (the administrator's block) the shipped mid-session handling runs: the generic toast and `router.refresh()`.
 *
 * - **Voice (D-734, Phase 12.5).** The composer carries the SAME opt-in voice props the support thread passes, built
 *   from the shipped `voice-deps` and `voice-send` helpers: up to 5 minutes, one take in flight at a time, the
 *   bubble and the player the support chat draws, no new recorder and no new player. The send goes to
 *   `POST /v1/chat/direct/voice-messages`; only the two participants can play the recording (the API's gate).
 *   The first recording of a pair creates the conversation exactly as the first text does.
 * - **The message menu (D-733, UI-D-870).** Each message of the OTHER member carries a gutter trigger (the viewer's
 *   own carry none) that opens "Opções da mensagem": "Denunciar mensagem" and, only when the server's `canBlock`
 *   allows it, "Bloquear {nome}". The report sheet and the block dialog are the report-and-block component's
 *   (subject `direct_message`, the author's membership id). A block made here swaps the composer for the blocker's
 *   strip by re-reading the state.
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

/**
 * One recording the pane holds in memory only (UI-D-847, A-UI-10): the bytes, the asset a failed attempt left
 * ready to send again, and where the take stands. Never stored, never named in a URL, a log or a toast.
 */
/** What a stored voice send answers. */
type VoiceSentOk = Extract<SendDirectVoiceResult, { ok: true }>;

interface VoiceRecord {
  take: { blob: Blob; durationSeconds: number };
  resume?: VoiceResume;
  state: 'queued' | 'running' | 'failed';
  failure?: 'retriable' | 'permanent';
}

/** The composer slot as the server last described it, with the server's own answer to "may the viewer block". */
interface DetailState {
  composer: ComposerStateView;
  canBlock: boolean;
}

type DetailRead = { kind: 'ok'; detail: DetailState } | { kind: 'gone' } | { kind: 'failed' };

const STRIP_STATES = ['closed', 'blocker', 'removed'] as const;
const STRIP_GLYPHS = ['Lock', 'Ban'] as const;

const isText = (value: unknown): value is string => typeof value === 'string';

/**
 * The finished composer facts of `GET /api/chat/direct/{id}`, rebuilt from NAMED fields (the support pane's rule):
 * anything that is not exactly the finished shape (an unknown state, a strip that does not match its state, a
 * blocker strip with no button) is `null`, so the screen keeps what it shows rather than drawing a guess.
 */
function parseDetail(body: unknown): DetailState | null {
  if (!body || typeof body !== 'object') return null;
  const { state, strip, canBlock } = body as Record<string, unknown>;
  if (typeof canBlock !== 'boolean') return null;
  if (state === 'open')
    return strip === null ? { composer: { state, strip: null }, canBlock } : null;
  if (!STRIP_STATES.some((known) => known === state) || !strip || typeof strip !== 'object') {
    return null;
  }
  const raw = strip as Record<string, unknown>;
  const glyph = STRIP_GLYPHS.find((known) => known === raw.glyph);
  if (raw.kind !== state || !glyph || !isText(raw.text) || !isText(raw.label)) return null;
  let unblock: ComposerStripView['unblock'] = null;
  if (raw.unblock !== null) {
    const u = raw.unblock as Record<string, unknown> | undefined;
    if (!u || !isText(u.label) || !isText(u.pendingLabel) || !isText(u.toast)) return null;
    unblock = { label: u.label, pendingLabel: u.pendingLabel, toast: u.toast };
  }
  if ((state === 'blocker') !== (unblock !== null)) return null;
  const kind = state as 'closed' | 'blocker' | 'removed';
  return {
    composer: {
      state: kind,
      strip: { kind, glyph, role: 'status', text: raw.text, label: raw.label, unblock },
    },
    canBlock,
  };
}

/** `GET /api/chat/direct/{id}`: 404 is the conversation being gone for this reader, never a reason. */
async function fetchDetail(conversationId: string): Promise<DetailRead> {
  try {
    const res = await fetch(`/api/chat/direct/${encodeURIComponent(conversationId)}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'manual',
    });
    if (res.status === 404) return { kind: 'gone' };
    if (!res.ok) return { kind: 'failed' };
    const detail = parseDetail(await res.json());
    return detail ? { kind: 'ok', detail } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

const sameDetail = (a: DetailState, b: DetailState) =>
  a.canBlock === b.canBlock &&
  a.composer.state === b.composer.state &&
  a.composer.strip?.text === b.composer.strip?.text;

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
  canBlock,
  tenantName,
}: DirectThreadPaneProps) {
  const t = useTranslations('chat');
  const tf = useTranslations('feed');
  const router = useRouter();
  const { show } = useToast();
  const [sendError, setSendError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [views, setViews] = useState<ChatMessageView[]>(initialViews);
  const [keys, setKeys] = useState<ChatDayKeys>(initialKeys);
  const [hasOlder, setHasOlder] = useState(initialHasOlder);
  const [olderState, setOlderState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [newCount, setNewCount] = useState(0);
  const [detail, setDetail] = useState<DetailState>({ composer: initialComposer, canBlock });
  const [unblocking, setUnblocking] = useState(false);
  const { composer } = detail;
  /** UI-D-870: the message whose menu is open, the report sheet's subject and the block dialog's person. */
  const [menu, setMenu] = useState<MessageMenuTarget | null>(null);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [block, setBlock] = useState<BlockTarget | null>(null);
  /** 12.5 (UI-D-850): what the polite region speaks after a speed change; re-keyed so a repeat is spoken. */
  const [rateNote, setRateNote] = useState({ count: 0, text: '' });

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
  /** The composer state re-read, coalesced the same way: one in flight, one queued. */
  const detailReadRef = useRef<{ running: boolean; again: boolean }>({
    running: false,
    again: false,
  });
  /** The takes of this pane, keyed by the optimistic id. In memory only; they die with the pane. */
  const voiceTakesRef = useRef(new Map<string, VoiceRecord>());
  /** The tap-order queue, ONE take in flight at a time (VOICE-23). */
  const voiceChainRef = useRef<Promise<void>>(Promise.resolve());
  /** Always the latest render's runner, so a queued take reads fresh props when its turn comes. */
  const voiceRunRef = useRef<(tempId: string) => Promise<void>>(async () => {});
  const aliveRef = useRef(true);
  /** Set by an unblock: the field takes the focus once the open composer is drawn (UI-D-865). */
  const focusFieldRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    const takes = voiceTakesRef.current;
    return () => {
      // Leaving the screen loses every take and starts no further send (UI-D-847, A-UI-10): `runVoiceSend` reads
      // `alive()` as its `cancelled` hook. A request already on the wire is not aborted, and an asset a cancelled
      // take already uploaded and completed stays unsent for the 24 hour orphan sweep (D-856).
      aliveRef.current = false;
      takes.clear();
    };
  }, []);

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

  /**
   * UI-D-865: re-read the composer state, one at a time (a request during a run schedules exactly one more). A
   * failed read keeps the screen as it is; a 404 means the conversation is gone for this reader (the
   * administrator's block, a removal that hid it), so the page re-renders into the not-found screen. Nothing
   * toasts and neither the scroll nor the focus moves for a live change.
   */
  const refreshDetail = useCallback(async () => {
    const state = detailReadRef.current;
    if (state.running) {
      state.again = true;
      return;
    }
    state.running = true;
    try {
      do {
        state.again = false;
        const id = conversationRef.current;
        if (!id) break;
        const read = await fetchDetail(id);
        if (conversationRef.current !== id) {
          state.again = true;
          continue;
        }
        if (read.kind === 'gone') router.refresh();
        else if (read.kind === 'ok') {
          setDetail((current) => (sameDetail(current, read.detail) ? current : read.detail));
        }
      } while (state.again);
    } finally {
      state.running = false;
    }
  }, [router]);

  const onSignal = useCallback(
    (_event: string, payload: unknown) => {
      // A signal says "something changed": the composer state is re-read for every one of them.
      void refreshDetail();
      const seq = (payload as { seq?: unknown } | null)?.seq;
      // Ids-only signal: a seq at or below the cursor is a replay, nothing to fetch (T-07-64).
      if (isReplayedSignal(cursorRef.current, seq)) return;
      void catchUp();
    },
    [catchUp, refreshDetail],
  );

  useRealtimeTopic(
    conversationId ? convTopic(tenantId, conversationId) : null,
    [REALTIME_EVENTS.chatMessage],
    onSignal,
    {
      onSubscribed: () => {
        void catchUp();
        void refreshDetail();
      },
    },
  );

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void catchUp();
      void refreshDetail();
      markRead();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [catchUp, refreshDetail, markRead]);

  // After an unblock the open composer takes the focus (UI-D-865); nothing else ever moves it.
  useEffect(() => {
    if (!focusFieldRef.current || composer.state !== 'open') return;
    focusFieldRef.current = false;
    document.getElementById(DIRECT_COMPOSER_ID)?.focus();
  }, [composer.state]);

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
  const adoptSent = (
    result: Extract<SendDirectMessageResult | SendDirectVoiceResult, { ok: true }>,
    tempId: string,
  ) => {
    const { view, conversationId: created } = result;
    const first = !conversationRef.current;
    if (first) {
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
    // The thread exists now: the server's own answer to "may I block" and the composer state come with it.
    if (first) void refreshDetail();
  };

  /**
   * D-722: the state this member did not know about. The bubble is already gone, the shipped toast says the ONE
   * neutral sentence and the strip appears; nothing says who or why. The server's own read follows.
   */
  const refusedAsClosed = () => {
    show({ tone: 'error', message: t('direct.closed') });
    setDetail((current) => ({
      ...current,
      composer: composerStateView('closed', { removed: false, displayName: other.name }, t),
    }));
    void refreshDetail();
  };

  /** The conversation or the person is gone: the shipped mid-session handling, which lands on the not-found screen. */
  const refusedAsGone = () => {
    show({ tone: 'error', message: tf('errors.generic') });
    router.refresh();
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
      const refusal = result && !result.ok ? result.error : 'failed';
      if (refusal === 'closed') refusedAsClosed();
      else if (refusal === 'not_found') refusedAsGone();
      return false;
    }
    adoptSent(result, tempId);
    return true;
  };

  /** UI-D-865: one tap, no confirmation; the strip swaps for what the server now says, and the field takes focus. */
  const onUnblock = async () => {
    const membershipId = other.membershipId;
    if (!membershipId || unblocking) return;
    const toast = detail.composer.strip?.unblock?.toast ?? '';
    setUnblocking(true);
    let ok = false;
    try {
      ok = (await unblockMember(membershipId)).ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      // A failure keeps the strip and fires the shipped generic error toast.
      setUnblocking(false);
      show({ tone: 'error', message: tf('errors.generic') });
      return;
    }
    const id = conversationRef.current;
    const read: DetailRead = id ? await fetchDetail(id) : { kind: 'failed' };
    if (read.kind === 'gone') {
      setUnblocking(false);
      router.refresh();
      return;
    }
    // The unblock stands even when the re-read fails: the field opens and the server decides the next send.
    const next: DetailState =
      read.kind === 'ok'
        ? read.detail
        : {
            canBlock: true,
            composer: composerStateView('open', { removed: false, displayName: other.name }, t),
          };
    focusFieldRef.current = next.composer.state === 'open';
    setDetail(next);
    setUnblocking(false);
    show({ tone: 'success', message: toast });
  };

  /* ── Voice messages (D-734, UI-D-846, UI-D-847): the support thread's machinery over the direct send ──── */

  /** Change one view in place (a progress step, a failure, a retry). A view that is gone is left alone. */
  const patchView = useCallback((id: string, patch: Partial<ChatMessageView>) => {
    setViews((current) => current.map((view) => (view.id === id ? { ...view, ...patch } : view)));
  }, []);

  const runVoice = async (tempId: string) => {
    const record = voiceTakesRef.current.get(tempId);
    // Unmounted, discarded or cleared by a refusal while it waited its turn: nothing more is started.
    if (!aliveRef.current || !record) return;
    record.state = 'running';
    patchView(tempId, { voiceUpload: { percent: null }, voiceFailed: undefined });

    const toId = other.membershipId;
    const sendAction = (
      mediaId: string,
    ): Promise<VoiceSentOk | { ok: false; error: VoiceSendError }> =>
      toId
        ? sendDirectVoice(toId, mediaId)
        : Promise.resolve({ ok: false, error: 'not_found' } as const);

    const alive = () => aliveRef.current && voiceTakesRef.current.get(tempId) === record;
    // Loaded at the first recording, not with the pane: the wiring pulls in the media server actions, which a
    // thread that never records has no use for.
    const { voiceSendDeps } = await import('@/app/(app)/suporte/voice-deps');
    if (!alive()) return;
    const outcome = await runVoiceSend(
      // Leaving the screen starts no further stage or send: `alive()` is false after an unmount, a discard and a
      // refusal that cleared the queue, and runVoiceSend reads it before every step.
      { ...voiceSendDeps<VoiceSentOk>(sendAction), cancelled: () => !alive() },
      record.take,
      {
        onProgress: (progress) => {
          if (!alive()) return;
          // The finishing step has no percent: the footer reads the plain pending label again.
          patchView(tempId, {
            voiceUpload: {
              percent: progress.phase === 'uploading' ? Math.round(progress.percent) : null,
            },
          });
        },
      },
      record.resume,
    );
    if (!alive()) return;

    if (outcome.ok) {
      voiceTakesRef.current.delete(tempId);
      adoptSent(outcome.sent, tempId);
      return;
    }
    failVoice(tempId, record, outcome.kind, outcome.resume);
  };
  voiceRunRef.current = runVoice;

  /** What each way a take can end does to the list (UI-D-847, D-722, D-862). */
  const failVoice = (
    tempId: string,
    record: VoiceRecord,
    kind: VoiceFailureKind,
    resume: VoiceResume | undefined,
  ) => {
    if (kind === 'retriable' || kind === 'permanent') {
      // The bubble stays with the take in memory; a permanent refusal offers only "Descartar".
      record.state = 'failed';
      record.failure = kind;
      record.resume = resume;
      patchView(tempId, { voiceFailed: kind, voiceUpload: undefined });
      return;
    }
    voiceTakesRef.current.delete(tempId);
    if (kind === 'not_found') {
      setViews((current) => current.filter((view) => view.id !== tempId));
      refusedAsGone();
      return;
    }
    // `closed` (and the staff words, which a direct send never produces): nothing to restore. This bubble and
    // every take still waiting are discarded, the ONE neutral sentence is toasted and the strip appears.
    voiceTakesRef.current.clear();
    setViews((current) => current.filter((view) => !(view.pending && view.voice !== undefined)));
    refusedAsClosed();
  };

  /** Queue a take behind the ones before it: ONE in flight at a time, in the order they were tapped. */
  const enqueueVoice = useCallback((tempId: string) => {
    voiceChainRef.current = voiceChainRef.current
      .then(() => voiceRunRef.current(tempId))
      .catch(() => {});
  }, []);

  /** The composer's hand-off (UI-D-846): the bubble appears at once and the composer is idle again. */
  const onSendVoice = async (take: RecordedTake): Promise<boolean> => {
    pendingIdRef.current += 1;
    const tempId = `pending-${pendingIdRef.current}`;
    const seconds = Math.round(take.seconds);
    const optimistic: ChatMessageView = {
      id: tempId,
      seq: 0,
      side: 'own',
      authorKey: 'member',
      body: '',
      label: null,
      time: '',
      dayKey: keys.todayKey,
      createdAtMs: 0,
      pending: true,
      voice: {
        mediaId: '',
        durationSeconds: seconds,
        durationLabel: formatVoiceDuration(seconds),
        spokenLabel: spokenVoiceDuration(seconds, t),
      },
      voiceUpload: { percent: null },
    };
    // The recorder hands a base type in `mime`; the blob keeps the recorder's own (with parameters).
    const blob =
      take.blob.type === take.mime ? take.blob : new Blob([take.blob], { type: take.mime });
    voiceTakesRef.current.set(tempId, {
      take: { blob, durationSeconds: seconds },
      state: 'queued',
    });
    intentRef.current = { kind: 'bottom' };
    setViews((current) => [...current, optimistic]);
    enqueueVoice(tempId);
    return true;
  };

  const retryVoice = useCallback(
    (tempId: string) => {
      const record = voiceTakesRef.current.get(tempId);
      if (record?.state !== 'failed' || record.failure !== 'retriable') return;
      record.state = 'queued';
      patchView(tempId, { voiceFailed: undefined, voiceUpload: { percent: null } });
      enqueueVoice(tempId);
    },
    [patchView, enqueueVoice],
  );

  const discardVoice = useCallback((tempId: string) => {
    voiceTakesRef.current.delete(tempId);
    setViews((current) => current.filter((view) => view.id !== tempId));
  }, []);

  const announceRate = useCallback(
    (label: string) => {
      setRateNote((before) => ({
        count: before.count + 1,
        text: t('voice.live.rate', { rate: label }),
      }));
    },
    [t],
  );

  /** The finished bubble props of a view with a recording (UI-D-846..848, UI-D-858). */
  const voiceFor = useCallback(
    (view: ChatMessageView): MessageBubbleVoice | undefined => {
      const recording = view.voice;
      if (!recording) return undefined;
      if (recording.deleted) return { status: 'deleted', text: t('voice.deleted') };
      const shared = {
        durationSeconds: recording.durationSeconds,
        spokenLabel: t('voice.group', { spoken: recording.spokenLabel }),
        player: {
          labels: {
            play: t('voice.player.play'),
            pause: t('voice.player.pause'),
            loading: t('voice.player.loading'),
            retry: t('thread.retry'),
            seek: t('voice.player.seek'),
            error: t('voice.player.error'),
            unsupported: t('voice.player.unsupported'),
            speed: (rate: string) => t('voice.player.speed', { rate }),
            seekValue: (current: string, total: string) =>
              t('voice.player.seekValue', { current, total }),
          },
          formatClock: formatVoiceDuration,
          nextRate: (rate: number) => nextPlaybackRate(rate),
          rateLabel: (rate: number) => playbackRateLabel(rate, t),
          onRateChange: announceRate,
        },
      };
      if (view.voiceFailed) {
        const retriable = view.voiceFailed === 'retriable';
        return {
          status: 'failed',
          ...shared,
          failure: {
            text: retriable ? t('voice.failed.retriable') : t('voice.failed.permanent'),
            retriable,
            retryLabel: t('thread.retry'),
            discardLabel: t('voice.failed.discard'),
            onRetry: () => retryVoice(view.id),
            onDiscard: () => discardVoice(view.id),
          },
        };
      }
      if (view.pending) {
        return {
          status: 'pending',
          ...shared,
          progress: { percent: view.voiceUpload?.percent ?? null, label: t('voice.upload.label') },
        };
      }
      return { status: 'ready', ...shared, src: `/v1/media/${recording.mediaId}/original` };
    },
    [t, announceRate, retryVoice, discardVoice],
  );

  // The microphone only where the composer renders: a strip replaces the composer, so there is no bundle and no
  // microphone there (UI-D-865 state 2).
  const voiceBundle: ChatComposerVoice = {
    micLabel: t('voice.mic.label'),
    micRequestingLabel: t('voice.mic.requesting'),
    recordingLabel: t('voice.recording.status'),
    timerLabel: t('voice.recording.timer'),
    discardLabel: t('voice.recording.discard'),
    sendLabel: t('voice.recording.send'),
    limitWord: t('voice.recording.limitWord'),
    interruptedWord: t('voice.recording.interruptedWord'),
    notices: {
      warning: t('voice.notice.warning'),
      limit: t('voice.notice.limit'),
      interrupted: t('voice.notice.interrupted'),
      tooShort: t('voice.notice.tooShort'),
    },
    problems: {
      blocked: t('voice.problem.blocked'),
      missing: t('voice.problem.missing'),
      busy: t('voice.problem.busy'),
      failed: t('voice.problem.failed'),
    },
    live: {
      started: t('voice.live.started'),
      minute: (count: number) => t('voice.live.minute', { count }),
      discarded: t('voice.live.discarded'),
    },
    formatClock: formatVoiceDuration,
    onSendVoice,
    // A recording pauses every playing voice message, so the speaker never feeds the microphone (A-UI-9).
    onRecordingStart: pauseAllVoice,
  };

  /* ── The message menu (D-733, UI-D-870) ─────────────────────────────────────────────────────────────── */

  /** "Bloquear {nome}" is the server's call (`canBlock`), and never for a person who left (nobody to block). */
  const blockPerson = detail.canBlock && !other.removed ? other.membershipId : null;

  /** A block made from the menu: the strip must follow at once, so the composer state is re-read after it. */
  const blockAndRefresh: typeof blockMember = async (membershipId) => {
    const answer = await blockMember(membershipId);
    if (answer.ok) void refreshDetail();
    return answer;
  };

  const toBottom = () => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setNewCount(0);
  };

  const items = useMemo(() => {
    const runs = chatRuns(
      views,
      keys,
      {
        today: t('day.today'),
        yesterday: t('day.yesterday'),
        pending: t('composer.sending'),
        voiceProgress: (percent) => t('voice.upload.progress', { percent }),
      },
      voiceFor,
    );
    // UI-D-870: each SETTLED message of the other member carries the gutter trigger; the viewer's own never do.
    const byId = new Map(views.map((view) => [view.id, view]));
    return runs.map((item) => {
      if (item.kind !== 'message' || item.side !== 'other') return item;
      const view = byId.get(item.key);
      if (!view || view.pending) return item;
      return {
        ...item,
        menu: (
          <MessageMenuTrigger
            label={t('direct.menu.trigger')}
            onOpen={() => setMenu({ messageId: view.id, voice: view.voice !== undefined })}
          />
        ),
      };
    });
  }, [views, keys, t, voiceFor]);

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
        {composer.state !== 'open' ? (
          composer.strip ? (
            <ComposerStateStrip
              strip={composer.strip}
              onUnblock={() => void onUnblock()}
              pending={unblocking}
            />
          ) : null
        ) : (
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
            voice={voiceBundle}
          />
        )}
      </div>
      <MessageMenuSheet
        open={menu !== null}
        onClose={() => setMenu(null)}
        title={t('direct.menu.title')}
        report={{
          label: t('direct.menu.report'),
          onSelect: () => {
            if (menu) {
              setReport({
                subjectType: 'direct_message',
                subjectId: menu.messageId,
                voice: menu.voice,
              });
            }
            setMenu(null);
          },
        }}
        block={
          blockPerson
            ? {
                label: t('direct.menu.block', { nome: other.name }),
                onSelect: () => {
                  setBlock({ membershipId: blockPerson, name: other.name });
                  setMenu(null);
                },
              }
            : null
        }
      />
      <ReportAndBlock
        report={report}
        onReportClose={() => setReport(null)}
        tenantName={tenantName}
        reportAction={reportContent}
        block={block}
        onBlockClose={() => setBlock(null)}
        blockAction={blockAndRefresh}
        socialOn
      />
      {/* UI-D-850: the polite region the speed pills speak through; the speed itself is never stored. */}
      <div data-chat-rate-status role="status" aria-live="polite" className="sr-only">
        <span key={rateNote.count}>{rateNote.text}</span>
      </div>
    </div>
  );
}
