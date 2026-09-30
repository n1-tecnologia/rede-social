import { type RealtimeChannel, RealtimeClient } from '@supabase/realtime-js';
import { expect } from 'vitest';
import { adminSql, SEED_PASSWORD, signInAs } from './setup';

/**
 * Live Realtime helpers for `realtime.test.ts` (07-03): a REAL `RealtimeClient` (realtime-js 2.116.0,
 * Node 24's global `WebSocket`) against the local stack's Realtime service, authorised by the SAME
 * definer policy a browser meets. Nothing here is mocked: a join is evaluated by
 * `app.realtime_topic_allowed` with the user's own GoTrue JWT.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the live Realtime tests`);
  return value;
}

export type JoinStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';

export interface Received {
  event: string;
  payload: Record<string, unknown>;
}

export interface Joined {
  topic: string;
  channel: RealtimeChannel;
  /** The first terminal status the join reported (or `TIMED_OUT` after {@link JOIN_SETTLE_MS}). */
  status: JoinStatus;
  /** Every broadcast this channel received, in arrival order. */
  received: Received[];
}

export interface Connected {
  client: RealtimeClient;
  token: string;
}

/** Every client built here, so `disconnectAll` can close them in `afterEach`. */
const open = new Set<RealtimeClient>();

/**
 * Signs `email` in through GoTrue (`signInAs`) and builds a Realtime client that presents that user's
 * access token on every join (the same shape `RealtimeProvider` builds in the browser).
 */
export async function connectAs(email: string): Promise<Connected> {
  const token = await signInAs(email, SEED_PASSWORD);
  const client = new RealtimeClient(`${required('SUPABASE_URL')}/realtime/v1`, {
    params: { apikey: required('SUPABASE_PUBLISHABLE_KEY') },
    accessToken: async () => token,
  });
  // realtime-js resolves the callback asynchronously on connect, but a first `subscribe()` builds its
  // join payload synchronously: without this the join carries only the publishable key and a private
  // topic is refused. `RealtimeProvider` does the same before its first join.
  await client.setAuth();
  open.add(client);
  return { client, token };
}

/** Disconnects every client `connectAs` built (call in `afterEach`). */
export async function disconnectAll(): Promise<void> {
  const clients = [...open];
  open.clear();
  await Promise.all(
    clients.map(async (client) => {
      await client.removeAllChannels().catch(() => undefined);
      await client.disconnect().catch(() => undefined);
    }),
  );
}

/**
 * How long a join may take to settle. The local Realtime service answers a REFUSED private join with
 * its `Unauthorized` reply about 5 s after the `phx_join` (observed in 07-03), so a 5 s window would
 * race it and report `TIMED_OUT`; 8 s lets the refusal land as `CHANNEL_ERROR`.
 */
export const JOIN_SETTLE_MS = 8_000;

/**
 * Joins `topic` (private by default, as every production join is) with a catch-all broadcast
 * listener attached BEFORE the subscribe, and resolves with the first terminal status within
 * {@link JOIN_SETTLE_MS}.
 */
export function joinTopic(
  client: RealtimeClient,
  topic: string,
  options: { private?: boolean } = {},
): Promise<Joined> {
  const received: Received[] = [];
  const channel = client
    .channel(topic, { config: { private: options.private ?? true } })
    .on('broadcast', { event: '*' }, (message: { event: string; payload?: unknown }) => {
      received.push({
        event: message.event,
        payload: (message.payload ?? {}) as Record<string, unknown>,
      });
    });

  return new Promise<Joined>((resolve) => {
    let settled = false;
    const done = (status: JoinStatus) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ topic, channel, status, received });
    };
    const timer = setTimeout(() => done('TIMED_OUT'), JOIN_SETTLE_MS);
    channel.subscribe((status) => done(status as JoinStatus));
  });
}

/** Resolves with the first broadcast named `event` on `joined` within `ms`, or `null`. */
export async function waitForBroadcast(
  joined: Joined,
  event: string,
  ms: number,
): Promise<Received | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const hit = joined.received.find((message) => message.event === event);
    if (hit) return hit;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** A refused join: `CHANNEL_ERROR` (the policy said no) or `TIMED_OUT` — never `SUBSCRIBED`. */
export function expectNotSubscribed(joined: Joined): void {
  expect(joined.status, `join of ${joined.topic}`).not.toBe('SUBSCRIBED');
  expect(['CHANNEL_ERROR', 'TIMED_OUT'], `join of ${joined.topic}`).toContain(joined.status);
}

/**
 * Publishes ONE signal the only way production does: `app.realtime_signal` (the definer) inside a
 * transaction whose claims carry `tenantId`, committed. The migration role stands in for the worker's
 * tenant lane; the function itself prefixes `tenant:<claim>:`.
 */
export async function signal(
  tenantId: string,
  suffix: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await adminSql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ tenant_id: tenantId })}, true)`;
    await tx`select app.realtime_signal(${suffix}, ${event}, ${tx.json(payload as never)})`;
  });
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
