'use client';

import { RealtimeClient } from '@supabase/realtime-js';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { createTokenSource, tokenFetcher } from './token-source';

/**
 * The ONE browser Realtime client per window (07-03, RESEARCH Pattern 4 and 5; CLAUDE.md's single
 * sanctioned browser-to-Supabase path). It is SUBSCRIBE-ONLY: a signal says "something changed", and
 * every count and row is then fetched through the BFF and the API. The database backs that up: there
 * is no INSERT policy on `realtime.messages`, so a browser `send` reaches nobody (T-07-16).
 *
 * - **Private joins only.** Every channel is opened with `config: { private: true }`, so the join is
 *   authorised by `app.realtime_topic_allowed` against the member's own JWT (T-07-14, T-07-17).
 * - **Token from memory.** The `accessToken` callback is the cached token source over `tokenUrl`
 *   (`GET /api/realtime/token`); realtime-js calls it on every heartbeat, the source fetches only near
 *   expiry (T-07-18).
 * - **Multiplexed.** One client, one channel per topic, any number of listeners per channel: the
 *   counters provider and an open `/notificacoes` share the same two joins.
 * - **Hidden-tab hygiene.** After the document has been hidden for {@link HIDDEN_DISCONNECT_MS} the
 *   channels are dropped and the socket disconnected, so peak connections track foreground windows on
 *   the Free plan's 200 (T-07-19). On visible every active topic is re-joined, and each listener's
 *   `onSubscribed` runs again: that is the D-240 catch-up, not replay.
 * - **Unmount disconnects.** Logout and the blocked flow leave the `(app)` segment, which unmounts
 *   this provider; its cleanup disconnects, and no module-level client outlives it.
 *
 * The provider takes the Supabase URL, the publishable key and the token URL as props: the kernel
 * never reads env. `clientFactory` exists for tests (a fake client); production uses realtime-js.
 */

/** Hidden this long, the window lets go of its socket. */
export const HIDDEN_DISCONNECT_MS = 60_000;

/** A broadcast as realtime-js hands it to a listener. */
export interface BroadcastMessage {
  event: string;
  payload?: unknown;
}

/** The slice of a realtime-js channel the provider uses (a fake implements just this). */
export interface RealtimeChannelLike {
  on(
    type: 'broadcast',
    filter: { event: string },
    callback: (message: BroadcastMessage) => void,
  ): RealtimeChannelLike;
  subscribe(callback?: (status: string, error?: Error) => void): RealtimeChannelLike;
}

/** The slice of a realtime-js client the provider uses. */
export interface RealtimeClientLike {
  channel(topic: string, options: { config: { private: boolean } }): RealtimeChannelLike;
  removeChannel(channel: RealtimeChannelLike): Promise<unknown>;
  disconnect(): Promise<unknown> | undefined;
  /** No argument: resolve the `accessToken` callback now and hold its value for the next join. */
  setAuth?(token?: string | null): Promise<unknown>;
}

export interface RealtimeClientOptionsLike {
  params: { apikey: string };
  accessToken: () => Promise<string | null>;
}

export type RealtimeClientFactory = (
  endpoint: string,
  options: RealtimeClientOptionsLike,
) => RealtimeClientLike;

const defaultFactory: RealtimeClientFactory = (endpoint, options) =>
  new RealtimeClient(endpoint, options) as unknown as RealtimeClientLike;

/** Called for every broadcast whose event the listener asked for. */
export type SignalHandler = (event: string, payload: unknown) => void;

export interface RealtimeApi {
  /**
   * Listen to `events` on `topic` (joined privately, shared with every other listener of the same
   * topic). `onSubscribed` runs on the first join and on EVERY re-join. Returns `leave`.
   */
  join(
    topic: string,
    events: ReadonlyArray<string>,
    onSignal: SignalHandler,
    onSubscribed?: () => void,
  ): () => void;
}

const RealtimeContext = createContext<RealtimeApi | null>(null);

/** The window's Realtime API, or `null` outside a provider (the platform shell, tests). */
export function useRealtime(): RealtimeApi | null {
  return useContext(RealtimeContext);
}

interface Listener {
  events: ReadonlyArray<string>;
  onSignal: SignalHandler;
  onSubscribed?: () => void;
}

interface Entry {
  channel: RealtimeChannelLike | null;
  /** An open is waiting for the token; bumping `generation` cancels it. */
  opening: boolean;
  generation: number;
  /** `true` once the current channel reported `SUBSCRIBED` (reset on every open and close). */
  joined: boolean;
  listeners: Set<Listener>;
}

/** Opens `topic`'s private channel and fans every broadcast out to the entry's listeners. */
function attach(client: RealtimeClientLike, topic: string, entry: Entry): void {
  entry.channel = client
    .channel(topic, { config: { private: true } })
    .on('broadcast', { event: '*' }, (message) => {
      for (const listener of entry.listeners) {
        if (listener.events.includes(message.event)) {
          listener.onSignal(message.event, message.payload);
        }
      }
    })
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') {
        entry.joined = false;
        return;
      }
      entry.joined = true;
      for (const listener of entry.listeners) listener.onSubscribed?.();
    });
}

export interface RealtimeProviderProps {
  /** `NEXT_PUBLIC_SUPABASE_URL` (the host passes it; the kernel reads no env). */
  supabaseUrl: string;
  /** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. */
  publishableKey: string;
  /** The BFF token route, `/api/realtime/token` in the web app. */
  tokenUrl: string;
  /** Tests only: builds the client (defaults to realtime-js's `RealtimeClient`). */
  clientFactory?: RealtimeClientFactory;
  children: ReactNode;
}

export function RealtimeProvider({
  supabaseUrl,
  publishableKey,
  tokenUrl,
  clientFactory,
  children,
}: RealtimeProviderProps) {
  const clientRef = useRef<RealtimeClientLike | null>(null);
  /** Resolves once the client holds the member's token (see `authorise`). */
  const authReady = useRef<Promise<void>>(Promise.resolve());
  const entries = useRef(new Map<string, Entry>());
  /**
   * A topic's channel still LEAVING (07 review A-WR-05). `removeChannel` only drops the channel from the
   * client once the leave completes; until then `client.channel(topic)` hands back that same leaving
   * channel, whose `subscribe()` is a silent no-op, and the topic would stay dead after the leave. So
   * an open of the same topic waits for the removal first.
   */
  const removing = useRef(new Map<string, Promise<void>>());
  const suspended = useRef(false);
  const config = useRef({ supabaseUrl, publishableKey, tokenUrl, clientFactory });
  config.current = { supabaseUrl, publishableKey, tokenUrl, clientFactory };

  /**
   * realtime-js resolves the `accessToken` callback asynchronously on connect, but a `subscribe()` on a
   * fresh socket builds its join payload SYNCHRONOUSLY from whatever token it already holds. Without
   * this step the first private join goes out with only the publishable key and the policy refuses it
   * (observed live against the local stack in 07-03). So the token is resolved first — on creation and
   * again after a hidden-tab disconnect, when the held token may have expired — and every open waits.
   */
  const authorise = useCallback((client: RealtimeClientLike) => {
    authReady.current = Promise.resolve(client.setAuth?.())
      .then(() => undefined)
      .catch(() => undefined);
  }, []);

  /** The lazily created client; one per mounted provider, never module-level. */
  const getClient = useCallback((): RealtimeClientLike => {
    if (clientRef.current) return clientRef.current;
    const { supabaseUrl: url, publishableKey: apikey, tokenUrl: tokens } = config.current;
    const factory = config.current.clientFactory ?? defaultFactory;
    const client = factory(`${url.replace(/\/$/, '')}/realtime/v1`, {
      params: { apikey },
      accessToken: createTokenSource(tokenFetcher(tokens)),
    });
    clientRef.current = client;
    authorise(client);
    return client;
  }, [authorise]);

  const open = useCallback(
    (topic: string, entry: Entry) => {
      const client = getClient();
      const generation = ++entry.generation;
      entry.opening = true;
      entry.joined = false;
      void Promise.all([authReady.current, removing.current.get(topic)]).then(() => {
        if (entry.generation !== generation || clientRef.current !== client) return;
        entry.opening = false;
        if (entry.listeners.size === 0 || suspended.current) return;
        attach(client, topic, entry);
      });
    },
    [getClient],
  );

  const close = useCallback((topic: string, entry: Entry) => {
    const channel = entry.channel;
    entry.generation++;
    entry.opening = false;
    entry.channel = null;
    entry.joined = false;
    if (!channel || !clientRef.current) return;
    const done: Promise<void> = clientRef.current.removeChannel(channel).then(
      () => undefined,
      () => undefined,
    );
    removing.current.set(topic, done);
    void done.then(() => {
      if (removing.current.get(topic) === done) removing.current.delete(topic);
    });
  }, []);

  const join = useCallback<RealtimeApi['join']>(
    (topic, events, onSignal, onSubscribed) => {
      let entry = entries.current.get(topic);
      if (!entry) {
        entry = {
          channel: null,
          opening: false,
          generation: 0,
          joined: false,
          listeners: new Set(),
        };
        entries.current.set(topic, entry);
      }
      const listener: Listener = { events, onSignal, onSubscribed };
      entry.listeners.add(listener);
      if (!entry.channel && !entry.opening && !suspended.current) open(topic, entry);
      // A listener added to an already-joined topic missed that join: it catches up on its own.
      else if (entry.joined) onSubscribed?.();

      const current = entry;
      return () => {
        current.listeners.delete(listener);
        if (current.listeners.size > 0) return;
        close(topic, current);
        if (entries.current.get(topic) === current) entries.current.delete(topic);
      };
    },
    [open, close],
  );

  // Hidden-tab hygiene and unmount.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const suspend = () => {
      timer = null;
      if (suspended.current) return;
      suspended.current = true;
      for (const [topic, entry] of entries.current) close(topic, entry);
      void Promise.resolve(clientRef.current?.disconnect()).catch(() => {});
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (!timer && !suspended.current) timer = setTimeout(suspend, HIDDEN_DISCONNECT_MS);
        return;
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!suspended.current) return;
      suspended.current = false;
      if (clientRef.current) authorise(clientRef.current);
      for (const [topic, entry] of entries.current) {
        if (!entry.channel && !entry.opening && entry.listeners.size > 0) open(topic, entry);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    if (document.visibilityState === 'hidden') onVisibility();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer) clearTimeout(timer);
      for (const entry of entries.current.values()) {
        entry.generation++;
        entry.opening = false;
        entry.channel = null;
      }
      entries.current.clear();
      removing.current.clear();
      suspended.current = false;
      const client = clientRef.current;
      clientRef.current = null;
      if (client) void Promise.resolve(client.disconnect()).catch(() => {});
    };
  }, [open, close, authorise]);

  const api = useMemo<RealtimeApi>(() => ({ join }), [join]);
  return <RealtimeContext.Provider value={api}>{children}</RealtimeContext.Provider>;
}
