import { withTenantTx } from '@tria/core/db/tenant-tx';
import type { RequestContext } from '@tria/core/server/auth/context';
import { moduleLogger } from '@tria/core/server/logging';
import type { JobDefinition } from '@tria/core/server/modules/manifest';
import { sql } from 'drizzle-orm';
import ogs from 'open-graph-scraper';
// undici's OWN fetch, NOT the global. The global `fetch` is Node's BUNDLED undici, a different
// instance that would not recognise our Agent as a dispatcher — the oEmbed call would go out
// completely unguarded while still looking guarded. `tests/unfurl-guard.test.ts` turns exactly this
// "one undici instance, not two" assumption into an assertion.
import { fetch } from 'undici';
import { z } from 'zod';
import {
  FEED_UNFURL_QUEUE,
  type FeedUnfurlJob,
  type LinkPreviewFailureReason,
  type LinkPreviewProvider,
} from '../../contracts/index';
import { assertAllowedUrl, BlockedTargetError, guardedAgent } from './guard';

const log = moduleLogger('module-feed');

/**
 * `feed.unfurl-link` (MEDIA-04) — the ONE place in this product that opens an outbound HTTP
 * connection to a host an untrusted caption named.
 *
 * It runs in the WORKER, never in a request. The roadmap says "unfurled server-side at create
 * time"; `createPost` satisfies that by validating the URL and creating the cache row inside the
 * post's own transaction, and the bytes are fetched here. A synchronous fetch would put an
 * attacker-named remote host's latency and failure modes inside a Cloud Run request and inside the
 * admin's publish tap. The visible consequence is UI-D-11: there is no pending card, just the bare
 * auto-linked URL until the row actually resolves.
 *
 * **THE HANDLER NEVER THROWS** (the `media/derive-job.ts` posture). A refusal, a timeout, an
 * unreachable host or a page with no metadata all write a TERMINAL `status: 'failed'` with a short
 * machine `failure_reason` and return — a preview is never left `'pending'` forever, so the card
 * has something definite to not-draw and a poison URL cannot loop.
 *
 * **`payload.tenantId` is DATA, not authority** (T-07-03). The write below re-enters the tenant lane
 * with a synthetic context built from the payload, exactly as `markProcessed` does, so
 * `feed_link_previews_tenant_isolation` — not the payload — decides what may be written: a forged
 * payload updates zero rows rather than another tenant's preview.
 *
 * **Logging is SHAPE ONLY** (T-04-36): the tenant id, the preview id, the outcome and the elapsed
 * milliseconds. The URL's query string and the fetched page body never reach a log line — a
 * tracking URL is member content and a page body is somebody else's.
 *
 * **Deliberately NOT built: copying the remote thumbnail into Storage.**
 * `feed_link_previews.image_asset_id` exists for exactly that and stays NULL in V1. The card
 * therefore renders body-only when a target has only a remote image, rather than hot-linking a
 * third-party host into a tenant's branded page — which would leak every member's IP and
 * `Referer` to that host on every feed render. The null is a decision, not an omission; filling it
 * is a download-and-derive job in the same shape as `kernel.media-derive-variants`.
 */

/** One Agent per PROCESS, pooled. Building one per job would discard the connection pool each time. */
const agent = guardedAgent();

/** Seconds, not milliseconds — the scraper turns this into `AbortSignal.timeout(n * 1000)`. */
const SCRAPER_TIMEOUT_SECONDS = 5;

/** What a successful unfurl yields, before it is written. */
export interface UnfurlResult {
  title: string | null;
  description: string | null;
  siteName: string | null;
  provider: LinkPreviewProvider | null;
  providerVideoId: string | null;
}

/** The oEmbed endpoints, reached THROUGH THE SAME GUARDED AGENT as any other target. */
const OEMBED = {
  youtube: 'https://www.youtube.com/oembed',
  vimeo: 'https://vimeo.com/api/oembed.json',
} as const;

/**
 * Which provider, if any, owns this host. Suffix-matched against the registrable domain rather than
 * `includes`, so `youtube.com.evil.test` is NOT YouTube.
 */
export function providerFor(url: URL): LinkPreviewProvider | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) {
    return 'youtube';
  }
  if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) return 'vimeo';
  return null;
}

/** oEmbed's documented fields, read tolerantly: an unknown extra key must not fail the unfurl. */
const oembedSchema = z.object({
  title: z.string().optional(),
  provider_name: z.string().optional(),
  video_id: z.union([z.string(), z.number()]).optional(),
});

/**
 * The provider branch (UI-D-12). It yields the SAME card as an Open Graph page — a thumbnail, a
 * title and a play badge that opens externally. No frame element is produced anywhere: the web app
 * has no Content-Security-Policy today, so an embedded third-party frame could navigate the top
 * frame and set cookies inside the tenant's origin. Inline playback is a Phase 8 item behind a CSP.
 */
async function unfurlOembed(url: URL, provider: LinkPreviewProvider): Promise<UnfurlResult | null> {
  const endpoint = new URL(OEMBED[provider]);
  endpoint.searchParams.set('url', url.toString());
  endpoint.searchParams.set('format', 'json');

  const response = await fetch(endpoint, {
    // The same guard, the same Agent: an oEmbed endpoint is still an outbound fetch to a host we do
    // not control, and a DNS answer pointing it at the metadata address must be refused too.
    dispatcher: agent,
    redirect: 'follow',
    signal: AbortSignal.timeout(SCRAPER_TIMEOUT_SECONDS * 1_000),
  });
  if (!response.ok) return null;

  const parsed = oembedSchema.safeParse(await response.json());
  if (!parsed.success) return null;

  return {
    title: parsed.data.title ?? null,
    description: null,
    siteName: parsed.data.provider_name ?? null,
    provider,
    providerVideoId:
      parsed.data.video_id === undefined ? null : String(parsed.data.video_id).slice(0, 64),
  };
}

/** Untrusted remote strings are bounded before they are stored — no metadata field may be a novel. */
const MAX_TITLE = 300;
const MAX_DESCRIPTION = 1_000;
const clamp = (value: string | undefined, max: number): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
};

/**
 * Fetch and normalise. Returns `null` when the target simply carries no usable metadata — which is
 * NOT an error: a plain HTML page with no Open Graph tags renders as the bare link, exactly like a
 * refused one (UI-D-13's indistinguishability, which is the whole point).
 *
 * `assertAllowedUrl` runs again here even though `createPost` already ran it. The job payload is a
 * row in a queue table, not a value this process derived, and re-validating costs a `new URL`.
 */
export async function unfurl(rawUrl: string): Promise<UnfurlResult | null> {
  const url = assertAllowedUrl(rawUrl);

  const provider = providerFor(url);
  if (provider !== null) return unfurlOembed(url, provider);

  const { error, result } = await ogs({
    url: url.toString(),
    timeout: SCRAPER_TIMEOUT_SECONDS,
    // VERIFIED against open-graph-scraper@6.12.0 `dist/esm/lib/request.js`: it calls `undici.fetch`
    // and spreads `fetchOptions` into it, so the dispatcher is honoured — and every redirect hop
    // re-enters the guard's connector.
    fetchOptions: { dispatcher: agent, redirect: 'follow' },
  }).catch((thrown: unknown) => {
    /**
     * VERIFIED against open-graph-scraper@6.12.0 `dist/esm/index.js`: on failure it does not
     * RESOLVE with `{ error: true }` — it THROWS a plain object literal
     * `{ error, result: { error, errorDetails }, … }`, burying the real cause in `errorDetails`.
     *
     * Rethrowing that literal unchanged would reach `failureReasonFor` as a non-Error with no
     * `cause` chain to walk, and EVERY refusal would be classified `unreachable` — a
     * `BlockedTargetError` would be recorded as "the host did not answer". The distinction never
     * reaches an admin (UI-D-13), but it is the only thing an operator reading the table has, so
     * the cause is unwrapped here rather than lost.
     */
    const details = (thrown as { result?: { errorDetails?: unknown } })?.result?.errorDetails;
    if (details instanceof Error) throw details;
    throw thrown;
  });
  if (error) return null;

  const title = clamp(result.ogTitle ?? result.twitterTitle, MAX_TITLE);
  const description = clamp(result.ogDescription ?? result.twitterDescription, MAX_DESCRIPTION);
  const siteName = clamp(result.ogSiteName, MAX_TITLE);
  // A page with a URL and nothing else is not a preview — it is the bare link with a border on it.
  if (title === null && description === null) return null;

  return { title, description, siteName, provider: null, providerVideoId: null };
}

/**
 * The synthetic context. The job has no human behind it; the tenant lane reads only `tenant_id`
 * from the claims, and the write's `using`/`with check` is what actually scopes the update.
 */
function jobContext(tenantId: string): RequestContext {
  return {
    userId: '00000000-0000-0000-0000-000000000000',
    tenantId,
    role: 'member',
    requestId: 'job',
    events: [],
  };
}

/** Terminal write, conditional on the row still being `pending`: a purge or a re-unfurl is untouched. */
async function writeOutcome(
  tenantId: string,
  previewId: string,
  patch:
    | { status: 'resolved'; result: UnfurlResult }
    | { status: 'failed'; reason: LinkPreviewFailureReason },
): Promise<number> {
  const ctx = jobContext(tenantId);
  const rows = await withTenantTx(ctx, (tx) =>
    patch.status === 'resolved'
      ? tx.execute<{ id: string }>(sql`
          update feed_link_previews
             set status = 'resolved',
                 title = ${patch.result.title},
                 description = ${patch.result.description},
                 site_name = ${patch.result.siteName},
                 provider = ${patch.result.provider},
                 provider_video_id = ${patch.result.providerVideoId},
                 failure_reason = null,
                 fetched_at = now()
           where id = ${previewId}::uuid
             and status = 'pending'
         returning id`)
      : tx.execute<{ id: string }>(sql`
          update feed_link_previews
             set status = 'failed',
                 failure_reason = ${patch.reason},
                 fetched_at = now()
           where id = ${previewId}::uuid
             and status = 'pending'
         returning id`),
  );
  return rows.length;
}

/**
 * Every way this can go wrong, mapped to ONE of four machine codes. The codes exist for operators
 * reading the table, never for the admin: nothing here crosses the wire (UI-D-13).
 */
function failureReasonFor(error: unknown): LinkPreviewFailureReason {
  if (error instanceof BlockedTargetError) return 'blocked';
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    if (current instanceof BlockedTargetError) return 'blocked';
    if (current instanceof Error) {
      const name = current.name;
      if (name === 'TimeoutError' || name === 'AbortError' || /timeout/i.test(current.message)) {
        return 'timeout';
      }
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    current = undefined;
  }
  return 'unreachable';
}

export const feedUnfurlJob: JobDefinition<FeedUnfurlJob> = {
  name: FEED_UNFURL_QUEUE,
  handler: async (payload) => {
    // A malformed payload is dropped, not raised: pg-boss would retry a raise forever against a
    // shape that can never become valid.
    const parsed = z
      .object({ tenantId: z.uuid(), previewId: z.uuid(), url: z.string().min(1) })
      .safeParse(payload);
    if (!parsed.success) {
      log.warn({ event: 'feed.unfurl.bad_payload' }, 'unfurl payload rejected');
      return;
    }
    const { tenantId, previewId, url } = parsed.data;
    const started = Date.now();

    let outcome: 'resolved' | LinkPreviewFailureReason;
    let updated = 0;
    try {
      const result = await unfurl(url);
      if (result === null) {
        outcome = 'no_metadata';
        updated = await writeOutcome(tenantId, previewId, {
          status: 'failed',
          reason: 'no_metadata',
        });
      } else {
        outcome = 'resolved';
        updated = await writeOutcome(tenantId, previewId, { status: 'resolved', result });
      }
    } catch (error) {
      const reason = failureReasonFor(error);
      outcome = reason;
      // The terminal write is itself guarded: if THIS fails the handler still must not throw, or a
      // transient database blip would turn into an endless retry of an outbound fetch.
      updated = await writeOutcome(tenantId, previewId, { status: 'failed', reason }).catch(
        () => 0,
      );
    }

    // Shape only (T-04-36): no URL, no query string, no page body.
    log.info(
      {
        event: 'feed.unfurl.done',
        tenantId,
        previewId,
        outcome,
        updated,
        elapsedMs: Date.now() - started,
      },
      'link unfurled',
    );
  },
};
