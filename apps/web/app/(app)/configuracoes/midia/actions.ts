'use server';

import {
  MEDIA_ISSUES,
  type MediaAsset,
  type MediaIssue,
  type MediaPlayback,
  type MediaStatus,
  mediaListQuerySchema,
} from '@rede-social/contracts/media';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { getMediaAsset, getMediaAssets, getPlaybackTokens } from '@/lib/media';

/**
 * Server actions of the admin media library (MEDIA-03), in `membros/actions.ts`'s conventions: the
 * SAME Zod the API validates with runs BEFORE the request, a 401/403 becomes a navigation OUTSIDE
 * the try/catch (Next 16: `redirect()` throws), and every refusal is answered with a catalog KEY
 * rather than pt-BR copy (02-12) — the client component translates.
 *
 * The requests themselves go through `lib/media.ts`, the ONE place that builds the query string, so
 * the first page the server rendered and the "Carregar mais" button can never drift apart.
 */

const assetIdSchema = z.uuid();

export type LoadMoreAssetsResult =
  | { ok: true; items: MediaAsset[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

/**
 * One more page of the library, or a refresh of the first page when `cursor` is omitted (the 5 s
 * processing poll and the "Atualizar" button both take that path).
 *
 * The cursor is OPAQUE: it is forwarded exactly as the previous page returned it and is never
 * parsed, decoded or rebuilt here (T-03-34) — its encoding belongs to
 * `packages/core/server/paging.ts` and the API degrades a stale or tampered value to the first page
 * on its own.
 */
export async function loadMoreAssetsAction(cursor?: string): Promise<LoadMoreAssetsResult> {
  const query = mediaListQuerySchema.safeParse({
    kind: 'video',
    ...(cursor ? { cursor } : {}),
  });
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: LoadMoreAssetsResult = { ok: false, code: 'generic' };
  try {
    const page = await getMediaAssets({
      kind: query.data.kind,
      cursor: query.data.cursor,
      limit: query.data.limit,
    });
    result = { ok: true, items: page.items, nextCursor: page.nextCursor };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
    if (!refusal) console.error('media.load_more_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

export type PlaybackTokenResult =
  | { ok: true; playback: MediaPlayback }
  | { ok: false; code: 'notReady' | 'generic' };

/**
 * A freshly minted playback credential for ONE asset (D-44).
 *
 * The value crosses to the client for the single `<MuxPlayer>` instance that asked for it and is
 * never cached, stored in a cookie, put in the router cache or written to a log — the API answers
 * `no-store` for the same reason. A mid-session expiry re-enters here through the player's
 * "Tentar novamente", which mints a new one rather than reusing anything.
 *
 * A refusal answers a KEY: the player maps it to the generic message, so a raw status, a provider
 * string or an expiry sentence can never reach the screen (T-03-51).
 */
export async function fetchPlaybackTokenAction(assetId: string): Promise<PlaybackTokenResult> {
  const id = assetIdSchema.safeParse(assetId);
  if (!id.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: PlaybackTokenResult = { ok: false, code: 'generic' };
  try {
    result = { ok: true, playback: await getPlaybackTokens(id.data) };
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.status === 409) result = { ok: false, code: 'notReady' };
      else refusal = bootstrapRedirectPath(error);
    }
    if (!refusal && !(error instanceof ApiClientError && error.status === 409)) {
      console.error('media.playback_token_failed', { error: String(error) });
    }
  }

  if (refusal) redirect(refusal);
  return result;
}

export type AssetStatusResult =
  | { ok: true; status: MediaStatus; issue: MediaIssue | null }
  | { ok: false; code: 'notFound' | 'generic' };

const isMediaIssue = (value: string | null): value is MediaIssue =>
  value !== null && (MEDIA_ISSUES as readonly string[]).includes(value);

/**
 * The story composer's readiness poll (quick-260929-ka5): the current status of ONE asset the caller
 * uploaded (or, for an admin, any asset of the community), read every few seconds after a video is
 * handed to the provider until it is `ready`, `failed` or `rejected`.
 *
 * It runs on a timer, so it must NEVER revalidate or refresh anything — it only reads.
 *
 * Only the status and a CLOSED `MediaIssue` cross to the client: a provider's raw `failureReason`
 * string is dropped to `null` (T-03-51). A 404 is an expected poll outcome (the video was removed),
 * answered `notFound` without a log line; a session refusal becomes a navigation OUTSIDE the
 * try/catch (Next 16: `redirect()` throws); anything else is logged and answered `generic`.
 */
export async function fetchAssetStatusAction(assetId: string): Promise<AssetStatusResult> {
  const id = assetIdSchema.safeParse(assetId);
  if (!id.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: AssetStatusResult = { ok: false, code: 'generic' };
  try {
    const asset = await getMediaAsset(id.data);
    result = {
      ok: true,
      status: asset.status,
      issue: isMediaIssue(asset.failureReason) ? asset.failureReason : null,
    };
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      result = { ok: false, code: 'notFound' };
    } else {
      if (error instanceof ApiClientError) refusal = bootstrapRedirectPath(error);
      if (!refusal) console.error('media.asset_status_failed', { error: String(error) });
    }
  }

  if (refusal) redirect(refusal);
  return result;
}

export type RemoveAssetResult = { ok: true } | { ok: false; code: 'generic' };

/** `DELETE /v1/media/{assetId}` — a soft delete; the objects go with the 03-08 sweeper. */
export async function removeAssetAction(assetId: string): Promise<RemoveAssetResult> {
  const id = assetIdSchema.safeParse(assetId);
  if (!id.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: RemoveAssetResult = { ok: false, code: 'generic' };
  try {
    const res = await apiFetch(`/v1/media/${encodeURIComponent(id.data)}`, { method: 'DELETE' });
    if (res.ok) {
      result = { ok: true };
    } else if (res.status === 401 || res.status === 403) {
      refusal = bootstrapRedirectPath(new ApiClientError(res.status, 'HTTP_ERROR'));
      if (!refusal) console.error('media.remove_failed', { status: res.status });
    } else {
      console.error('media.remove_failed', { status: res.status });
    }
  } catch (error) {
    console.error('media.remove_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}
