import { describe, expect, it } from 'vitest';
import { PAYMENTS_NOTIFICATION_KINDS } from '../contracts/index';
import { paymentsModule } from '../module';
import { paymentsPushCopy } from '../server/notification-copy';
import { paymentsNotificationSources } from '../server/notifications';

/**
 * 09.1-12 (PAY-24, D-498, D-500, D-506): the payments module's `payments.purchase_confirmed` source,
 * pinned with a `tx` that REFUSES every statement: the source reads nothing but the event payload (the
 * apply job's definer already returned the product name). The rows, the push job and the signal are proved
 * end to end by `payments-notifications.test.ts`.
 */

const T = 'e05bbbdd-92d5-4d38-beab-69100a1a269b';
const U = '22222222-2222-4222-8222-222222222222';
const P = '1d000000-0000-4000-8000-000000000001';
const meta = { sinkAt: '2026-10-21T12:00:00.123456Z' };

const source = paymentsNotificationSources[0];
if (!source) throw new Error('payments declares no notification source');

const refusingTx = {
  execute: async () => {
    throw new Error('the source must not read any table');
  },
} as unknown as Parameters<typeof source.resolve>[0];

// The kernel's push hint rules (`notificationPushHintSchema`), restated: a hint that breaks one is dropped.
const PUSH_TAG = /^[A-Za-z0-9_-]{1,64}$/;
const PUSH_TOPIC = /^[A-Za-z0-9_-]{1,32}$/;
const PUSH_PATH = /^\/(?![/\\])[^\\\s]*$/;

const payload = { tenantId: T, userId: U, productId: P, productName: 'Curso A' };

describe('payments notification source', () => {
  it('listens to payments.purchase_confirmed only, and the manifest declares it (no retraction)', () => {
    expect(paymentsNotificationSources.map((entry) => entry.event)).toEqual([
      'payments.purchase_confirmed',
    ]);
    expect(paymentsModule.notificationSources).toBe(paymentsNotificationSources);
    expect(paymentsModule.notificationRetractions).toBeUndefined();
    expect(PAYMENTS_NOTIFICATION_KINDS.purchaseConfirmed).toBe('payments.purchase_confirmed');
  });

  it('turns the payload into exactly one actor-less intent for the buyer and nobody else', async () => {
    const intents = await source.resolve(refusingTx, payload, meta);
    expect(intents).toHaveLength(1);
    const intent = intents[0];
    expect(intent).toMatchObject({
      kind: 'payments.purchase_confirmed',
      audience: { type: 'users', userIds: [U] },
      excludeUserIds: [],
      actorUserId: null,
      subject: { type: 'product', id: P },
      object: null,
      facts: { productId: P, productName: 'Curso A' },
      channels: ['in_app', 'push'],
    });
    expect(intent?.dedupeKey).toBe(`payments.purchase_confirmed:${P}:${meta.sinkAt}`);
  });

  it('carries the productId and productName facts only: no e-mail, amount, reference or gateway field', async () => {
    const [intent] = await source.resolve(refusingTx, payload, meta);
    expect(Object.keys(intent?.facts ?? {}).sort()).toEqual(['productId', 'productName']);
    expect(JSON.stringify(intent)).not.toMatch(/@|amount|externalRef|provider/i);
  });

  it('a repurchase after a refund is a new notice: the dedupe key follows the sink instant', async () => {
    const [first] = await source.resolve(refusingTx, payload, meta);
    const [again] = await source.resolve(refusingTx, payload, {
      sinkAt: '2026-10-22T09:00:00.000000Z',
    });
    const [retried] = await source.resolve(refusingTx, payload, meta);
    expect(again?.dedupeKey).not.toBe(first?.dedupeKey);
    expect(retried?.dedupeKey).toBe(first?.dedupeKey);
  });

  it('the push hint is titled with the tenant, opens the product and is a valid kernel hint', async () => {
    const [intent] = await source.resolve(refusingTx, payload, meta);
    const push = intent?.push;
    expect(push).toMatchObject({
      title: 'tenant',
      body: paymentsPushCopy.purchaseConfirmed('Curso A'),
      url: `/loja/${P}`,
      ttlSeconds: 86_400,
      urgency: 'normal',
      renotify: false,
    });
    expect(push?.body).toBe('Compra confirmada: Curso A');
    expect(push?.tag).toMatch(PUSH_TAG);
    expect(push?.topic).toMatch(PUSH_TOPIC);
    expect(push?.url).toMatch(PUSH_PATH);
  });

  it('cuts the push body of a 120-character product name at 100 graphemes with an ellipsis', async () => {
    const productName = Array.from({ length: 20 }, (_, i) => `curso${i}`)
      .join(' ')
      .slice(0, 120)
      .padEnd(120, 'x');
    const [intent] = await source.resolve(refusingTx, { ...payload, productName }, meta);
    const body = intent?.push?.body ?? '';
    expect(
      Array.from(new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(body)).length,
    ).toBeLessThanOrEqual(100);
    expect(body.endsWith('…')).toBe(true);
    // the row keeps the whole name: the bell clamps it, the push cuts it
    expect(intent?.facts.productName).toBe(productName);
  });
});
