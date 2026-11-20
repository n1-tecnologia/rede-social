import { join } from 'node:path';
import type { ReportItem } from '@rede-social/contracts/moderation';
import { createTranslator } from 'next-intl';
import { loadMessages } from '@/i18n/messages';
import { type ReportQueueRow, reportQueueRow } from '@/lib/reports';

/**
 * Test-only builders for the queue's tests (11-25): an API item as the strict contract names it, and the FINISHED
 * `ReportQueueRow` the screens receive, built by the real `reportQueueRow` with the real pt-BR catalog. A test file
 * that imports this must `vi.mock('@/lib/api')` (the loader module the builder lives in imports it).
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
const translator = (namespace: string) =>
  createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never });

export const REPORT_ID = '0b000000-0000-4000-8000-000000000001';
export const MEDIA_ID = '0c000000-0000-4000-8000-0000000000aa';

export function apiItem(over: Partial<ReportItem> = {}): ReportItem {
  return {
    id: REPORT_ID,
    createdAt: '2026-11-19T17:00:00.000000Z',
    subjectType: 'story',
    subjectId: '0d000000-0000-4000-8000-000000000001',
    reason: 'spam',
    note: null,
    excerpt: 'Compre agora o curso milagroso',
    status: 'open',
    resolvedAt: null,
    contentAvailable: true,
    reporter: { displayName: 'Larissa Souza', avatarAssetId: null },
    author: { displayName: 'Carla Nunes', avatarAssetId: null, isMember: true },
    ref: { storyId: '0d000000-0000-4000-8000-000000000001' },
    ...over,
  };
}

export function queueRow(over: Partial<ReportItem> = {}): ReportQueueRow {
  return reportQueueRow(apiItem(over), {
    timeZone: 'America/Sao_Paulo',
    ts: translator('safety') as never,
    tm: translator('moderation') as never,
  });
}
