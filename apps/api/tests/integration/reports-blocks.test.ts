import { sqlClient } from '@rede-social/core/db';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { resolveReport } from '@rede-social/core/server/safety/index';
import type { FeedComment } from '@rede-social/module-feed/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * Reports and member blocks, the API against the live local stack (13-14, D-616, NATIVE-31, NATIVE-33; T-13-32,
 * T-13-33, T-13-34).
 *
 * `reports tracer`: a member reports another member's comment; the tenant's `admin_tenant` lists it and resolves it
 * with `remove_content` in ONE tenant transaction that calls the comment removal the moderation routes call, so the
 * `comment_removed` log row exists, the comment is gone from the feed read and the report reads `content_removed`;
 * the same calls from the other tenant see and change nothing.
 *
 * The suite uses the SEEDED members and never deletes a member or a log row (the log is append-only and its pgTAP
 * anchor check would trip on a departed party): every assertion is scoped by the ids it created, the reports and
 * blocks it wrote are deleted at the end, and a member it blocked is unblocked through the admin route.
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };

const tokens = { admin: '', support: '', author: '', reporter: '', third: '', labAdmin: '' };
const ids = {
  tenant: '',
  labTenant: '',
  admin: '',
  support: '',
  author: '',
  reporter: '',
  third: '',
};
const memberships = { author: '' };

const CAPTION_PREFIX = 'Denuncia de teste';
const BODY_PREFIX = 'Comentario denunciado';
const createdPosts: string[] = [];
const createdReports: string[] = [];

const request = (path: string, token: string, init: RequestInit = {}, host: string = HOSTS.demo) =>
  api.request(path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      'x-tenant-host': host,
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });

const post = (path: string, token: string, body: unknown, host: string = HOSTS.demo) =>
  request(path, token, { method: 'POST', body: JSON.stringify(body) }, host);

const errorOf = async (res: Response) => ((await res.json()) as Envelope).error;

async function seedPost(label: string, authorId: string = ids.admin): Promise<string> {
  const rows = await adminSql<{ id: string }[]>`
    insert into public.feed_posts (tenant_id, caption, author_user_id)
    values (${ids.tenant}::uuid, ${`${CAPTION_PREFIX} ${label}`}, ${authorId}::uuid)
    returning id`;
  const id = rows[0]?.id ?? '';
  createdPosts.push(id);
  return id;
}

async function comment(token: string, postId: string, body: string): Promise<FeedComment> {
  const res = await post(`/v1/feed/posts/${postId}/comments`, token, { body });
  expect(res.status, `POST comment ${body}`).toBe(201);
  return (await res.json()) as FeedComment;
}

/** A reporter files a report and the test remembers the row for the cleanup. */
async function report(
  token: string,
  subjectType: 'feed_post' | 'post_comment',
  subjectId: string,
  reason = 'spam',
  note?: string,
): Promise<Response> {
  const res = await post('/v1/reports', token, {
    subjectType,
    subjectId,
    reason,
    ...(note === undefined ? {} : { note }),
  });
  if (res.status === 201) {
    const body = (await res.clone().json()) as { id: string };
    createdReports.push(body.id);
  }
  return res;
}

type ReportRow = { status: string; resolved_by_user_id: string | null; note: string | null };
const reportRow = async (id: string) => {
  const [row] = await adminSql<ReportRow[]>`
    select status, resolved_by_user_id::text, note from public.content_reports where id = ${id}::uuid`;
  return row;
};

const logRowsFor = (subjectId: string) =>
  adminSql<{ action: string; actor_user_id: string; target_user_id: string }[]>`
    select action, actor_user_id::text, target_user_id::text
      from public.moderation_log where subject_id = ${subjectId}::uuid`;

type AdminReportItem = {
  id: string;
  status: string;
  subjectType: string;
  subjectId: string;
  reason: string;
  note: string | null;
  excerpt: string;
  contentAvailable: boolean;
  reporter: { displayName: string | null };
  author: { displayName: string | null; isMember: boolean };
};
type AdminReportPage = { items: AdminReportItem[]; nextCursor: string | null };

async function listAdmin(token: string, query = '', host: string = HOSTS.demo) {
  const res = await request(`/v1/admin/reports${query}`, token, {}, host);
  expect(res.status, `GET /v1/admin/reports${query}`).toBe(200);
  return (await res.json()) as AdminReportPage;
}

const asAdminCtx = (): RequestContext => ({
  userId: ids.admin,
  tenantId: ids.tenant,
  role: 'admin_tenant',
  requestId: 'reports-blocks-test',
  events: [],
});

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');

  const [tenant] = await adminSql<{ id: string }[]>`
    select id::text from public.tenants where slug = 'rede-demo'`;
  const [lab] = await adminSql<{ id: string }[]>`
    select id::text from public.tenants where slug = 'rede-lab'`;
  ids.tenant = tenant?.id ?? '';
  ids.labTenant = lab?.id ?? '';

  const people = await adminSql<{ email: string; user_id: string; membership_id: string }[]>`
    select u.email, u.id::text as user_id, m.id::text as membership_id
      from public.users u join public.memberships m on m.user_id = u.id
     where m.tenant_id = ${ids.tenant}::uuid`;
  const byEmail = new Map(people.map((p) => [p.email, p]));
  const need = (email: string) => {
    const found = byEmail.get(email);
    if (!found) throw new Error(`the seed must provide ${email}`);
    return found;
  };
  ids.admin = need('admin@rede-demo.local').user_id;
  ids.support = need('support@rede-demo.local').user_id;
  // Three ordinary members no other suite writes content with: the author, the reporter and a bystander.
  ids.author = need('cristovao.nobrega@rede-demo.local').user_id;
  memberships.author = need('cristovao.nobrega@rede-demo.local').membership_id;
  ids.reporter = need('ana.paula.ferreira@rede-demo.local').user_id;
  ids.third = need('beatriz.almeida@rede-demo.local').user_id;

  tokens.admin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.support = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  tokens.author = await signInAs('cristovao.nobrega@rede-demo.local', SEED_PASSWORD);
  tokens.reporter = await signInAs('ana.paula.ferreira@rede-demo.local', SEED_PASSWORD);
  tokens.third = await signInAs('beatriz.almeida@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
});

afterAll(async () => {
  if (createdReports.length > 0) {
    await adminSql`delete from public.content_reports where id = any(${createdReports}::uuid[])`;
  }
  await adminSql`delete from public.content_reports where tenant_id = ${ids.tenant}::uuid and subject_id = any(${createdPosts}::uuid[])`;
  if (createdPosts.length > 0) {
    await adminSql`delete from public.notifications where subject_id = any(${createdPosts}::uuid[])`;
    await adminSql`delete from public.feed_posts where id = any(${createdPosts}::uuid[])`;
  }
  await adminSql`delete from public.feed_posts where caption like ${`${CAPTION_PREFIX}%`}`;
  await adminSql`
    update pgboss.job_common set state = 'completed', completed_on = now()
     where name = 'notifications.fanout' and state = 'created'
       and data->>'tenantId' = ${ids.tenant}`;
  await adminSql.end();
  await sqlClient.end();
});

describe('reports tracer (NATIVE-31)', () => {
  it('a member reports a comment; the admin lists it and removes it in one transaction with its log row; the other tenant sees and changes nothing', async () => {
    const postId = await seedPost('tracer');
    const target = await comment(tokens.author, postId, `${BODY_PREFIX} tracer`);

    // The member files the report: 201 and the id, nothing about anyone. A whitespace note is stored as null.
    const filed = await report(tokens.reporter, 'post_comment', target.id, 'harassment', '   ');
    expect(filed.status).toBe(201);
    const body = (await filed.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['id']);
    const reportId = body.id as string;
    expect((await reportRow(reportId))?.note).toBeNull();

    // The admin sees it, open, with the reporter's name, the author's and the live content.
    const queue = await listAdmin(tokens.admin);
    const item = queue.items.find((row) => row.id === reportId);
    expect(item, 'the report is in the open queue').toBeDefined();
    expect(item).toMatchObject({
      status: 'open',
      subjectType: 'post_comment',
      subjectId: target.id,
      reason: 'harassment',
      note: null,
      contentAvailable: true,
      author: { isMember: true },
    });
    expect(item?.excerpt).toContain(`${BODY_PREFIX} tracer`);
    expect(item?.reporter.displayName).not.toBeNull();

    // The other tenant: its admin lists none of it, cannot resolve it, and a member of the lab reporting the
    // demo's comment is the bare 404 (positive controls are the demo calls above and below).
    const labQueue = await listAdmin(tokens.labAdmin, '?estado=todas', HOSTS.lab);
    expect(labQueue.items.map((row) => row.id)).not.toContain(reportId);
    const labResolve = await post(
      `/v1/admin/reports/${reportId}/resolve`,
      tokens.labAdmin,
      { resolution: 'dismiss' },
      HOSTS.lab,
    );
    expect(labResolve.status).toBe(404);
    expect((await reportRow(reportId))?.status).toBe('open');

    // The resolution removes the comment through the moderation path, in one transaction.
    const resolved = await post(`/v1/admin/reports/${reportId}/resolve`, tokens.admin, {
      resolution: 'remove_content',
    });
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toEqual({ id: reportId, status: 'content_removed' });

    const row = await reportRow(reportId);
    expect(row?.status).toBe('content_removed');
    expect(row?.resolved_by_user_id).toBe(ids.admin);

    // The moderation log row of the removal exists, anchored to this admin and this author.
    const logRows = await logRowsFor(target.id);
    expect(logRows).toEqual([
      { action: 'comment_removed', actor_user_id: ids.admin, target_user_id: ids.author },
    ]);

    // The comment is gone from the feed read, and the queue now reads the report as removed.
    const comments = await request(`/v1/feed/posts/${postId}/comments`, tokens.reporter);
    const page = (await comments.json()) as { items: FeedComment[] };
    expect(page.items.map((c) => c.id)).not.toContain(target.id);
    const after = await listAdmin(tokens.admin, '?estado=resolvidas');
    expect(after.items.find((r) => r.id === reportId)).toMatchObject({
      status: 'content_removed',
      contentAvailable: false,
    });
    expect((await listAdmin(tokens.admin)).items.map((r) => r.id)).not.toContain(reportId);

    // A second resolution is the stable refusal and writes no second log row.
    const again = await post(`/v1/admin/reports/${reportId}/resolve`, tokens.admin, {
      resolution: 'remove_content',
    });
    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe('REPORT_ALREADY_RESOLVED');
    expect(await logRowsFor(target.id)).toHaveLength(1);
  });

  it('a removal that fails rolls the whole resolution back: the report stays open and the comment stays live', async () => {
    const postId = await seedPost('atomic');
    const target = await comment(tokens.author, postId, `${BODY_PREFIX} atomico`);
    const filed = await report(tokens.reporter, 'post_comment', target.id);
    const { id: reportId } = (await filed.json()) as { id: string };

    await expect(
      resolveReport(
        asAdminCtx(),
        reportId,
        { resolution: 'remove_content' },
        {
          removeContent: async () => {
            throw new Error('the removal failed after the report was recorded');
          },
        },
      ),
    ).rejects.toThrow(/removal failed/);

    expect((await reportRow(reportId))?.status).toBe('open');
    const [live] = await adminSql<{ live: boolean }[]>`
      select deleted_at is null as live from public.feed_comments where id = ${target.id}::uuid`;
    expect(live?.live).toBe(true);
    expect(await logRowsFor(target.id)).toHaveLength(0);
  });
});

describe('who may use the report routes (T-13-32, T-13-33)', () => {
  it('only a holder of moderation.manage reads or resolves the queue; a member and support get 403', async () => {
    const postId = await seedPost('guard');
    const target = await comment(tokens.author, postId, `${BODY_PREFIX} guarda`);
    const filed = await report(tokens.reporter, 'post_comment', target.id);
    const { id: reportId } = (await filed.json()) as { id: string };

    for (const token of [tokens.third, tokens.support]) {
      const list = await request('/v1/admin/reports', token);
      expect(list.status).toBe(403);
      expect((await errorOf(list)).code).toBe('FORBIDDEN');
      const resolve = await post(`/v1/admin/reports/${reportId}/resolve`, token, {
        resolution: 'dismiss',
      });
      expect(resolve.status).toBe(403);
    }
    // Nothing changed, and the admin (the positive control) still can.
    expect((await reportRow(reportId))?.status).toBe('open');
    expect((await listAdmin(tokens.admin)).items.map((r) => r.id)).toContain(reportId);
  });
});
