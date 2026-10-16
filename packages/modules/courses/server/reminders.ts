import type { Tx } from '@rede-social/core/db/tenant-tx';

/**
 * INERT STUB (08.6-05 Task 1 RED): the signatures the live-reminder arming tests pin, answering
 * constants so the failing cases fail on their assertions, not on an import. The GREEN commit
 * replaces every body.
 */

export function liveReminderFireAtMs(_startsAtMs: number): number {
  return 0;
}

export function liveReminderSingletonKey(_liveId: string, _startsAtMs: number): string {
  return '';
}

export function planLiveReminder(_startsAtMs: number, _nowMs: number): { startAfter: Date } | null {
  return null;
}

export async function armLiveReminder(
  _tx: Tx,
  _input: { tenantId: string; liveId: string; startsAt: string },
  _nowMs: number = Date.now(),
): Promise<boolean> {
  return false;
}
