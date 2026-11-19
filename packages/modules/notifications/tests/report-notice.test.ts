import { REPORT_NOTIFICATION_KIND } from '@rede-social/contracts/moderation';
import type { Tx } from '@rede-social/core/db/tenant-tx';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { notificationsModule } from '../module';
import {
  moderatorRoles,
  REPORT_PUSH_BODY,
  REPORT_PUSH_TITLE,
  REPORT_PUSH_URL,
  reportCreatedNotificationSource,
  reportTag,
} from '../server/report-notice';

/**
 * 11-17 (MODER-05, D-729, UI-D-876): the `report.created` notification source with a stubbed `tx`.
 * The audience is derived from the kernel's permission map, the reporter and the reported author are never
 * told, nobody left means no intent at all, and nothing in the intent names a subject, a person or a reason.
 */

const dialect = new PgDialect();
const TENANT = '00000000-0000-4000-8000-000000000001';
const REPORT_A = '1a2b3c4d-0000-4000-8000-00000000000a';
const REPORT_B = '1a2b3c4d-0000-4000-8000-00000000000b';
const ADMIN_1 = '00000000-0000-4000-8000-0000000000a1';
const ADMIN_2 = '00000000-0000-4000-8000-0000000000a2';
const REPORTER = '00000000-0000-4000-8000-0000000000b1';
const AUTHOR = '00000000-0000-4000-8000-0000000000c1';

type Call = { sql: string; params: unknown[] };

function stubTx(userIds: string[]): { tx: Tx; calls: Call[] } {
  const calls: Call[] = [];
  const tx = {
    execute: async (query: SQL) => {
      const { sql, params } = dialect.sqlToQuery(query);
      calls.push({ sql, params });
      return userIds.map((user_id) => ({ user_id }));
    },
  } as unknown as Tx;
  return { tx, calls };
}

const payload = (reportId = REPORT_A, reporterUserId = REPORTER, authorUserId = AUTHOR) => ({
  tenantId: TENANT,
  reportId,
  reporterUserId,
  authorUserId,
});
const meta = { sinkAt: '2026-11-19T12:00:00.000Z' };

describe('report.created notification source', () => {
  it('is registered on the notifications manifest for report.created', () => {
    expect(notificationsModule.notificationSources?.map((source) => source.event)).toContain(
      'report.created',
    );
    expect(reportCreatedNotificationSource.event).toBe('report.created');
  });

  it('derives the audience roles from the kernel permission map, never from a typed list', () => {
    expect(moderatorRoles()).toEqual(['admin_tenant']);
    expect(
      moderatorRoles({
        admin_tenant: ['moderation.manage'],
        support_tenant: ['moderation.manage'],
        member: [],
      }),
    ).toEqual(['admin_tenant', 'support_tenant']);
    expect(moderatorRoles({ admin_tenant: [], support_tenant: [], member: [] })).toEqual([]);
  });

  it('reads the live memberships of the tenant for those roles only, and tells the moderators', async () => {
    const { tx, calls } = stubTx([ADMIN_1, ADMIN_2]);
    const intents = await reportCreatedNotificationSource.resolve(tx, payload(), meta);
    expect(calls).toHaveLength(1);
    const call = calls[0] as Call;
    expect(call.params).toContain(TENANT);
    expect(call.params).toContain('admin_tenant');
    expect(call.params).not.toContain('support_tenant');
    expect(call.sql).toMatch(/status = 'active'/);
    expect(call.sql).toMatch(/blocked_at is null/);
    expect(call.sql).toMatch(/deleted_at is null/);
    expect(intents).toHaveLength(1);
    expect(intents[0]?.audience).toEqual({ type: 'users', userIds: [ADMIN_1, ADMIN_2] });
  });

  it('builds exactly the intent of D-729: both channels, empty facts, a fixed push, no actor', async () => {
    const { tx } = stubTx([ADMIN_1]);
    const [intent] = await reportCreatedNotificationSource.resolve(tx, payload(), meta);
    expect(intent).toBeDefined();
    expect(intent?.kind).toBe(REPORT_NOTIFICATION_KIND);
    expect(intent?.excludeUserIds).toEqual([REPORTER, AUTHOR]);
    expect(intent?.dedupeKey).toBe(`moderation.report_created:${REPORT_A}`);
    expect(intent?.subject).toEqual({ type: 'report', id: REPORT_A });
    expect(intent?.object).toBeNull();
    expect(intent?.actorUserId).toBeNull();
    expect(intent?.facts).toEqual({});
    expect(intent?.channels).toEqual(['in_app', 'push']);
    expect(intent?.push).toEqual({
      title: 'tenant',
      titleText: 'Nova denúncia',
      body: 'Toque para ver a fila de denúncias.',
      url: '/configuracoes/denuncias',
      tag: REPORT_A.replaceAll('-', ''),
      topic: REPORT_A.replaceAll('-', ''),
      ttlSeconds: 259_200,
      urgency: 'normal',
      renotify: false,
    });
    expect(REPORT_PUSH_TITLE).toBe('Nova denúncia');
    expect(REPORT_PUSH_BODY).toBe('Toque para ver a fila de denúncias.');
    expect(REPORT_PUSH_URL).toBe('/configuracoes/denuncias');
  });

  it('names nobody and nothing: the stored and pushed parts carry no id of a person', async () => {
    const { tx } = stubTx([ADMIN_1]);
    const [intent] = await reportCreatedNotificationSource.resolve(tx, payload(), meta);
    const visible = JSON.stringify({
      kind: intent?.kind,
      facts: intent?.facts,
      subject: intent?.subject,
      object: intent?.object,
      actor: intent?.actorUserId,
      push: intent?.push,
    });
    expect(visible).not.toContain(REPORTER);
    expect(visible).not.toContain(AUTHOR);
    expect(visible).not.toMatch(/feed_post|post_comment|story|community|direct_message/);
    expect(visible).not.toMatch(/spam|harassment|offensive|sexual_violent|reason|note|excerpt/);
  });

  it('never tells the reporter or the reported author, even when they hold the permission', async () => {
    const { tx } = stubTx([ADMIN_1, REPORTER, AUTHOR]);
    const [intent] = await reportCreatedNotificationSource.resolve(tx, payload(), meta);
    expect(intent?.audience).toEqual({ type: 'users', userIds: [ADMIN_1] });
  });

  it('returns no intent when the only holders are the reporter or the author', async () => {
    const { tx } = stubTx([REPORTER, AUTHOR]);
    expect(await reportCreatedNotificationSource.resolve(tx, payload(), meta)).toEqual([]);
    const none = stubTx([]);
    expect(await reportCreatedNotificationSource.resolve(none.tx, payload(), meta)).toEqual([]);
  });

  it('is per report: two reports give two tags and two keys, a redelivery gives the same key', async () => {
    const { tx } = stubTx([ADMIN_1]);
    const [a1] = await reportCreatedNotificationSource.resolve(tx, payload(REPORT_A), meta);
    const [a2] = await reportCreatedNotificationSource.resolve(tx, payload(REPORT_A), {
      sinkAt: '2026-11-19T13:00:00.000Z',
    });
    const [b] = await reportCreatedNotificationSource.resolve(tx, payload(REPORT_B), meta);
    expect(a1?.dedupeKey).toBe(a2?.dedupeKey);
    expect(a1?.push?.tag).toBe(a2?.push?.tag);
    expect(a1?.dedupeKey).not.toBe(b?.dedupeKey);
    expect(a1?.push?.tag).not.toBe(b?.push?.tag);
    expect(reportTag(REPORT_A)).toMatch(/^[0-9a-f]{32}$/);
  });
});
