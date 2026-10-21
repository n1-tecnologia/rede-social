import type { NotificationSource } from '@rede-social/core/server/notifications/source';
import { PAYMENTS_NOTIFICATION_KINDS } from '../contracts/index';
import { paymentsPushCopy } from './notification-copy';

/**
 * The payments module's notification source (09.1-12, D-506, PAY-24): the module DECLARES who is
 * notified of its own event, and the notifications module never imports it (MOD-02). The app registry
 * registers this list on the kernel seam and subscribes the sink once per event name.
 *
 * **The only notice this phase adds is the buyer's "Compra confirmada".** A revocation, a cut, a
 * return, a refund of a one-off purchase, an event waiting for an account and an ignored event notify
 * NOBODY, member or admin (D-500, D-498, PR-6): the gateway already talks to the buyer (D-497) and the
 * admin has the members list. `payments.purchase_confirmed` is emitted by the apply job only on a
 * `purchased` outcome, so this source never has to filter.
 *
 * `resolve` reads nothing: the payload already carries the product name the apply job's definer
 * returned, and the audience is the one user id of a verified, tenant-pinned event. It runs in the
 * worker inside the fan-out's tenant lane of the payload's tenant, so the row can only land in the
 * event's tenant.
 *
 * **No retraction is declared (A-P30).** The UI contract says a notification about a product archived
 * since falls under the retracted variant, but an archived product stays readable to its holder
 * (STORE-06, D-359: holders keep access): a retraction on archive would show "Este conteúdo foi
 * removido." for something the buyer still owns. The notice keeps its link to `/loja/<productId>`,
 * which the holder can open, and the shipped retracted variant still renders for any row the existing
 * retraction path retracts. Overturning this is one line here plus a store event on archive.
 *
 * The dedupe key carries the sink instant (`meta.sinkAt`, stamped once and reused by a retried job): a
 * retried job cannot duplicate, and a repurchase after a refund is a new notice.
 */

/** A purchase banner lives a day, the other lifecycle notices' rule. */
export const PAYMENTS_NOTICE_TTL_SECONDS = 86_400;

/** The device `tag` of a purchase banner: one per product, characters the push service accepts. */
export const purchaseTag = (productId: string): string => `payments-purchase-${productId}`;

/** The Web Push `Topic` (at most 32 URL-safe characters, RFC 8030 section 5.4): the product id without hyphens. */
export const purchaseTopic = (productId: string): string =>
  productId.replaceAll('-', '').toLowerCase().slice(0, 32);

export const paymentsNotificationSources = [
  {
    event: 'payments.purchase_confirmed',
    resolve: async (_tx, payload, meta) => [
      {
        kind: PAYMENTS_NOTIFICATION_KINDS.purchaseConfirmed,
        audience: { type: 'users', userIds: [payload.userId] },
        excludeUserIds: [],
        dedupeKey: `${PAYMENTS_NOTIFICATION_KINDS.purchaseConfirmed}:${payload.productId}:${meta.sinkAt}`,
        subject: { type: 'product', id: payload.productId },
        object: null,
        actorUserId: null,
        facts: { productId: payload.productId, productName: payload.productName },
        channels: ['in_app', 'push'],
        push: {
          title: 'tenant',
          body: paymentsPushCopy.purchaseConfirmed(payload.productName),
          url: `/loja/${payload.productId}`,
          tag: purchaseTag(payload.productId),
          topic: purchaseTopic(payload.productId),
          ttlSeconds: PAYMENTS_NOTICE_TTL_SECONDS,
          urgency: 'normal',
          renotify: false,
        },
      },
    ],
  } satisfies NotificationSource<'payments.purchase_confirmed'>,
] as NotificationSource[];
