'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * The tenant's live staff, names only (UI-D-823, UI-D-827, sketch 023 outcome 7) [client-safe].
 *
 * ONE list shared by every consumer mounted at the same time: the "Responsável" sheet of the inbox filters
 * and the "Atribuir" sheet of the staff bar read the same single fetch of `GET /api/chat/staff`, so opening
 * both never reads the roster twice. It is read ON DEMAND (`load()`, when a sheet opens or a chip needs a
 * name), shows `loading` while it runs, `error` when it fails (the sheets draw the inline line
 * "Não foi possível carregar a equipe." with a retry) and is forgotten when the last consumer unmounts, so
 * a team change is never hidden behind a stale list for the whole session.
 *
 * Only the user id and the name are kept (T-12.4-65): whatever else the answer carried is dropped here, so
 * no email, role or phone can reach a render.
 */

export interface RosterMember {
  userId: string;
  name: string;
}

export type RosterStatus = 'idle' | 'loading' | 'ready' | 'error';

interface RosterSnapshot {
  status: RosterStatus;
  items: RosterMember[];
}

const IDLE: RosterSnapshot = { status: 'idle', items: [] };

let snapshot: RosterSnapshot = IDLE;
let consumers = 0;
/** Bumped by every read and by the reset: an answer that is not the latest one is dropped. */
let generation = 0;
const listeners = new Set<() => void>();

function publish(next: RosterSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Names only: a row without a string id and a string name is dropped. */
function namesOnly(body: unknown): RosterMember[] {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const members: RosterMember[] = [];
  for (const item of items) {
    const { userId, name } = (item ?? {}) as { userId?: unknown; name?: unknown };
    if (typeof userId === 'string' && userId !== '' && typeof name === 'string') {
      members.push({ userId, name });
    }
  }
  return members;
}

async function readRoster() {
  const mine = ++generation;
  publish({ status: 'loading', items: [] });
  let next: RosterSnapshot;
  try {
    const res = await fetch('/api/chat/staff', {
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'manual',
    });
    next = res.ok
      ? { status: 'ready', items: namesOnly(await res.json()) }
      : { status: 'error', items: [] };
  } catch {
    next = { status: 'error', items: [] };
  }
  if (mine === generation) publish(next);
}

function subscribe(listener: () => void) {
  consumers += 1;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    consumers -= 1;
    if (consumers === 0) {
      generation += 1;
      snapshot = IDLE;
    }
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => IDLE;

export function useStaffRoster() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  /** Reads the roster the first time it is needed; a read already running or done is not repeated. */
  const load = useCallback(() => {
    if (snapshot.status === 'idle') void readRoster();
  }, []);
  /** Reads it again after a failure. */
  const retry = useCallback(() => {
    void readRoster();
  }, []);
  return { status: state.status, items: state.items, load, retry };
}
