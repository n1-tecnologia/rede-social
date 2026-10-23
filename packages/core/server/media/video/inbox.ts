import { sql } from 'drizzle-orm';
import { withAdminTx } from '../../../db/admin-tx';
import { enqueueInTx } from '../../jobs/boss';
import { moduleLogger } from '../../logging';
import { ProjectUnboundError } from '../../tenancy/project-errors';
import { videoProvider } from './index';
import { resolveVideoTenant } from './routes';
import { MEDIA_PROVIDER_EVENT_QUEUE, type VideoProviderEvent } from './types';

const log = moduleLogger('media-webhook');

/** Events accepted and dropped because no tenant could be found for them, since this process started. */
let unroutable = 0;

/**
 * The kernel half of `POST /v1/webhooks/mux`: record the provider's own event id EXACTLY once and
 * enqueue the state change in the SAME admin transaction (MEDIA-03, R-03, T-03-38).
 *
 * It lives here rather than in the route because the admin transaction lane is kernel-only — Biome
 * refuses `@rede-social/core/db/admin-tx` outside `server/{tenancy,platform,media}` — and because it is the
 * whole replay defence, which deserves one implementation a test can point at. The route stays what
 * it should be: read the raw body, verify the signature, call this, answer 2xx.
 *
 * `on conflict (id) do nothing returning id` returns zero rows for a delivery we have already seen,
 * and then NOTHING is enqueued: the caller answers 200 and Mux stops retrying. Mux warns that
 * duplicates happen even after a 2xx, so this is not a rare path. The enqueue additionally carries
 * `singletonKey = event.id` under the `short` queue policy, so two simultaneous FIRST deliveries —
 * which both pass the insert in different transactions only if the unique index lets them, and it
 * does not — still converge on one job.
 *
 * WHERE (09.2-10, DBT-13). A delivery carries no host, so the tenant is found first: the `<tenantId>:<assetId>`
 * passthrough names it directly; an asset created before this phase (a bare uuid) or an event with no
 * passthrough is found through the central `platform.video_asset_routes`. The row and the job are then written
 * in THAT tenant's own project, in one transaction. `media_provider_events` has no tenant column, so its
 * dedupe by provider event id is per project, which is exact: one event always resolves to one tenant.
 * An event that resolves to no tenant (or to a tenant that no longer exists) is ACCEPTED and dropped: the
 * route still answers 200, because a 4xx/5xx would make Mux retry for 24 h an event nobody can ever apply.
 * The authenticity of the whole payload (and so of the tenant it names) is the provider's HMAC.
 *
 * Returns `enqueued` for the call that enqueued, `duplicate` for an event already seen, `unroutable` for the
 * dropped one.
 */
export type ProviderEventOutcome = 'enqueued' | 'duplicate' | 'unroutable';

export async function recordProviderEvent(
  event: VideoProviderEvent,
): Promise<ProviderEventOutcome> {
  const tenantId = await resolveVideoTenant(event);
  if (!tenantId) return dropUnroutable(event);
  try {
    return await withAdminTx({ tenantId }, async (tx) => {
      const rows = (await tx.execute(sql`
        insert into public.media_provider_events (id, provider, type)
        values (${event.id}, ${videoProvider.name}, ${event.rawType})
        on conflict (id) do nothing
        returning id`)) as unknown as { id: string }[];
      if (rows.length === 0) return 'duplicate' as const;
      await enqueueInTx(tx, MEDIA_PROVIDER_EVENT_QUEUE, event, { singletonKey: event.id });
      return 'enqueued' as const;
    });
  } catch (error) {
    // A passthrough naming a tenant that is gone: nothing can ever apply it.
    if (error instanceof ProjectUnboundError) return dropUnroutable(event);
    throw error;
  }
}

function dropUnroutable(event: VideoProviderEvent): ProviderEventOutcome {
  unroutable += 1;
  log.warn(
    {
      event: 'media.webhook.unroutable',
      eventId: event.id,
      rawType: event.rawType,
      count: unroutable,
    },
    'video webhook names no tenant of ours; accepted and dropped',
  );
  return 'unroutable';
}
