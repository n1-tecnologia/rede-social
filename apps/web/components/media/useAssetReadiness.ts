'use client';

import type { MediaIssue } from '@rede-social/contracts/media';
import { useEffect, useState } from 'react';
import {
  type AssetStatusResult,
  fetchAssetStatusAction,
} from '@/app/(app)/configuracoes/midia/actions';

/**
 * The readiness of ONE uploaded asset, polled until it settles (quick-260929-ka5).
 *
 * Why it exists: after a story video is handed to the provider, the asset lives server-side as
 * `pending` and reaches `ready` when the provider's webhook lands and the worker flips it. On
 * 2026-09-29 the composer never re-read it, so "Processando o vídeo…" stayed on screen forever even
 * though the asset was `ready` within 5 s — the admin waited instead of publishing. This hook is the
 * re-read.
 *
 * Schedule: the first read is `READINESS_FIRST_DELAY_MS` after the id appears, then each wait is
 * `READINESS_BACKOFF` times the last, capped at `READINESS_MAX_DELAY_MS` (2 s, 3 s, 4.5 s, 6.75 s,
 * 10 s, 10 s…). It is a `setTimeout` chain, never `setInterval`: a new read starts only after the
 * previous answer arrived, so reads never overlap. It stops on `ready`, on `failed`/`rejected`, when
 * the asset disappears (404), on unmount and when the id changes.
 *
 * A `generic` answer (or a thrown read) keeps polling on the backoff: it is transient, and the
 * composer stays usable meanwhile because publishing is allowed while the video is still waiting.
 *
 * Stale-id guard: the stored answer carries the id it was read for, and the hook only returns it
 * while that id is still the current one. A late answer for a previous id can therefore never be
 * read as the current one's, and no synchronous reset is needed when the id changes.
 */

export const READINESS_FIRST_DELAY_MS = 2_000;
export const READINESS_BACKOFF = 1.5;
export const READINESS_MAX_DELAY_MS = 10_000;

export type AssetReadiness =
  | { phase: 'idle' }
  | { phase: 'waiting' }
  | { phase: 'ready' }
  | { phase: 'failed'; issue: MediaIssue | null };

const IDLE: AssetReadiness = { phase: 'idle' };
const WAITING: AssetReadiness = { phase: 'waiting' };
const READY: AssetReadiness = { phase: 'ready' };

/** The terminal readiness an answer settles to, or `null` when polling must go on. */
function settledBy(answer: AssetStatusResult): AssetReadiness | null {
  if (!answer.ok) return answer.code === 'notFound' ? { phase: 'failed', issue: null } : null;
  switch (answer.status) {
    case 'ready':
      return READY;
    case 'failed':
    case 'rejected':
    case 'deleted':
      return { phase: 'failed', issue: answer.issue };
    default:
      return null;
  }
}

export function useAssetReadiness(assetId: string | null): AssetReadiness {
  const [stored, setStored] = useState<{ id: string; value: AssetReadiness } | null>(null);

  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = READINESS_FIRST_DELAY_MS;

    const tick = async (): Promise<void> => {
      let answer: AssetStatusResult;
      try {
        answer = await fetchAssetStatusAction(assetId);
      } catch {
        answer = { ok: false, code: 'generic' };
      }
      if (cancelled) return;

      const settled = settledBy(answer);
      if (settled) {
        setStored({ id: assetId, value: settled });
        return;
      }
      delay = Math.min(delay * READINESS_BACKOFF, READINESS_MAX_DELAY_MS);
      timer = setTimeout(() => void tick(), delay);
    };

    timer = setTimeout(() => void tick(), delay);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [assetId]);

  if (!assetId) return IDLE;
  if (stored && stored.id === assetId) return stored.value;
  return WAITING;
}
