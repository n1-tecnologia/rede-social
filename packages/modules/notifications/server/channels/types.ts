import type { Tx } from '@rede-social/core/db/tenant-tx';
import type {
  NotificationChannelKey,
  NotificationIntent,
} from '@rede-social/core/server/notifications/source';

/**
 * NOTIF-04: a delivery channel is a key plus a `deliver`. A V2 adapter (e-mail, WhatsApp) is a
 * `NotificationChannelKey` union member plus one file registering itself, with no schema change.
 */

/** What one channel is asked to deliver for one intent. */
export interface DeliveryBatch {
  tenantId: string;
  intent: NotificationIntent;
  /**
   * The user ids an EARLIER channel delivered to (`in_app` runs first and hands on only the rows it
   * newly inserted). Empty for the first channel, and for a later channel of an intent that did not
   * request `in_app` (push-only, 07-08's chat): that channel resolves its own audience.
   */
  recipients: string[];
}

export interface ChannelResult {
  /** The user ids this channel actually delivered to (newly, for `in_app`). */
  delivered: string[];
  skipped: number;
}

export interface NotificationChannel {
  key: NotificationChannelKey;
  deliver(tx: Tx, batch: DeliveryBatch): Promise<ChannelResult>;
}
