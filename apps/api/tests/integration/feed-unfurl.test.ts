import http from 'node:http';
import { sqlClient } from '@tria/core/db';
import { stopBoss } from '@tria/core/server/jobs/boss';
import { FEED_UNFURL_QUEUE, type FeedPost } from '@tria/module-feed/contracts';
import { feedUnfurlJob } from '@tria/module-feed/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * MEDIA-04 — the link-preview cache, the create-time enqueue and the worker job, against the live
 * local stack and LOCAL `node:http` fixtures only.
 *
 * Not one assertion here reaches the public internet. A test that depends on a third party's uptime
 * is not an unfurl test, it is a network test that happens to import an unfurler. Both fixtures bind
 * to the loopback on an ephemeral port and are closed in `afterAll`.
 *
 * What ONLY this file can prove:
 *  - **The request path does no outbound work.** `POST /v1/feed/posts` creates ONE `pending` cache
 *    row and ONE pg-boss job whose `singleton_key` is that preview id — and the fixture's request
 *    counter has not moved. The bytes are the worker's business (UI-D-11's whole premise).
 *  - **A second post of the same link in the same tenant costs NO second fetch.** The counter is the
 *    evidence: `on conflict (tenant_id, url_hash) do nothing` reuses the row and enqueues nothing.
 *  - **The cache boundary is per TENANT.** The identical URL in the other tenant is a separate row —
 *    one organisation can never learn what another shared (T-04-34).
 *  - **UI-D-13's silence, asserted as an ABSENCE.** A caption pointing at a loopback address (an
 *    internal service, as far as the policy is concerned) publishes with 201 and a NULL preview, and
 *    the response body contains no field that separates "blocked" from "no metadata". Asserting the
 *    absence is the point: a test that looked for a refusal marker would pass while the marker
 *    existed, which is exactly the oracle this rule forbids.
 *  - **The handler never throws**, and a refused target lands `status: 'failed'`,
 *    `failure_reason: 'blocked'` rather than looping.
 *
 * The job handler is driven IN PROCESS (`feedUnfurlJob.handler(...)`), the `worker.test.ts` posture:
 * pg-boss's polling loop is not what this file is about, and waiting on it would make the suite
 * timing-dependent.
 */

const DEMO_ADMIN = 'admin@tria-demo.local';
const LAB_ADMIN = 'admin@tria-lab.local';

const tokens = { demoAdmin: '', labAdmin: '' };
const tenantIds = { demo: '', lab: '' };

/** Everything this file wrote, swept in `afterAll` so the shared seed survives a re-run. */
const createdPostIds: string[] = [];

interface Fixture {
  server: http.Server;
  port: number;
  /** How many requests the fixture has ACTUALLY served — the cache-hit evidence. */
  requests: number;
}

const fixtures: Fixture[] = [];

async function listen(handler: http.RequestListener): Promise<Fixture> {
  const fixture: Fixture = { server: null as unknown as http.Server, port: 0, requests: 0 };
  fixture.server = http.createServer((req, res) => {
    fixture.requests += 1;
    handler(req, res);
  });
  await new Promise<void>((resolve) => fixture.server.listen(0, '127.0.0.1', resolve));
  const address = fixture.server.address();
  if (address === null || typeof address === 'string') throw new Error('fixture has no port');
  fixture.port = address.port;
  fixtures.push(fixture);
  return fixture;
}

/** Serves ordinary Open Graph tags. */
let metadata: Fixture;
/** Stands in for an internal service the policy must refuse. */
let internal: Fixture;

const FIXTURE_TITLE = 'Titulo da fixture';
const FIXTURE_DESCRIPTION = 'Descricao da fixture';

function authed(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function createPost(caption: string, token = tokens.demoAdmin, host = HOSTS.demo) {
  return api.request('/v1/feed/posts', {
    method: 'POST',
    headers: { ...authed(token), 'x-tenant-host': host },
    body: JSON.stringify({ caption }),
  });
}

/** A 201 create, parsed and registered for cleanup. Fails loudly on anything else. */
async function created(caption: string, token = tokens.demoAdmin, host = HOSTS.demo) {
  const res = await createPost(caption, token, host);
  expect(res.status, `POST /v1/feed/posts -> ${res.status}`).toBe(201);
  const item = (await res.json()) as FeedPost;
  createdPostIds.push(item.id);
  return item;
}

async function previewRowsFor(tenantId: string, url: string) {
  return adminSql<
    { id: string; status: string; title: string | null; failure_reason: string | null }[]
  >`select id, status, title, failure_reason
      from public.feed_link_previews
     where tenant_id = ${tenantId}::uuid and url = ${url}`;
}

async function jobsFor(previewId: string) {
  return adminSql<{ singleton_key: string | null }[]>`
    select singleton_key from pgboss.job_common
     where name = ${FEED_UNFURL_QUEUE} and data->>'previewId' = ${previewId}`;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');

  metadata = await listen((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      '<html><head>' +
        `<meta property="og:title" content="${FIXTURE_TITLE}">` +
        `<meta property="og:description" content="${FIXTURE_DESCRIPTION}">` +
        '<meta property="og:site_name" content="Fixture Site">' +
        '</head><body></body></html>',
    );
  });
  internal = await listen((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><head><title>painel interno</title></head><body>segredo</body></html>');
  });

  [tokens.demoAdmin, tokens.labAdmin] = await Promise.all([
    signInAs(DEMO_ADMIN, SEED_PASSWORD),
    signInAs(LAB_ADMIN, SEED_PASSWORD),
  ]);

  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('tria-demo', 'tria-lab')`;
  for (const row of rows) {
    if (row.slug === 'tria-demo') tenantIds.demo = row.id;
    if (row.slug === 'tria-lab') tenantIds.lab = row.id;
  }
  if (!tenantIds.demo || !tenantIds.lab) throw new Error('the two demo tenants are not seeded');
});

afterAll(async () => {
  if (createdPostIds.length > 0) {
    await adminSql`delete from public.feed_posts where id = any(${createdPostIds}::uuid[])`;
  }
  // The posts hold the only references (`on delete set null`), so the preview rows go after them.
  await adminSql`delete from public.feed_link_previews where url like 'http://127.0.0.1:%'`;
  await adminSql`delete from pgboss.job_common where name = ${FEED_UNFURL_QUEUE}`;
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
  await Promise.all(
    fixtures.map(
      (fixture) => new Promise<void>((resolve) => fixture.server.close(() => resolve())),
    ),
  );
});

describe('MEDIA-04 — the preview cache, the enqueue and the worker job', () => {
  it('1. creating a post enqueues ONE job for ONE pending row, and fetches nothing in the request', async () => {
    const url = `http://127.0.0.1:${metadata.port}/artigo`;
    const before = metadata.requests;

    const item = await created(`Saiu a materia: ${url}`);

    // UI-D-11: the card cannot exist yet, so the wire carries nothing for it to draw.
    expect(item.linkPreview).toBeNull();

    const rows = await previewRowsFor(tenantIds.demo, url);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('pending');

    const jobs = await jobsFor(rows[0]?.id ?? '');
    expect(jobs).toHaveLength(1);
    // T-07-04: keyed on the preview id, so a retried request cannot stack two fetches of one URL.
    expect(jobs[0]?.singleton_key).toBe(rows[0]?.id);

    // The whole point of deferring to the worker: the request path touched no remote host.
    expect(metadata.requests).toBe(before);
  });

  /**
   * The PRODUCTION agent refuses the loopback — which is the whole point of the guard, and is why
   * this case asserts a terminal `failed`/`blocked` rather than a resolved title. The metadata
   * fixture serves perfectly good Open Graph tags; the guard never gets far enough to read them.
   *
   * That the scraper DOES parse those tags when the policy allows the target is proved at unit
   * level, against the same fixture shape, by `packages/modules/feed/tests/unfurl-guard.test.ts`
   * (which can substitute the block list). The resolved WIRE shape is proved below against the
   * seeded row. Splitting it this way is what keeps every assertion in this repo honest without
   * ever relaxing the production policy for a test.
   */
  it('2. driving the handler against a loopback target writes failed/blocked and does NOT throw', async () => {
    const url = `http://127.0.0.1:${metadata.port}/artigo`;
    const [row] = await previewRowsFor(tenantIds.demo, url);
    expect(row).toBeDefined();
    expect(row?.status).toBe('pending');

    await expect(
      feedUnfurlJob.handler({ tenantId: tenantIds.demo, previewId: row?.id ?? '', url }),
    ).resolves.toBeUndefined();

    const [after] = await previewRowsFor(tenantIds.demo, url);
    // Terminal, never left 'pending': a poison URL cannot loop and the card has something definite
    // to not-draw.
    expect(after?.status).toBe('failed');
    expect(after?.failure_reason).toBe('blocked');
    expect(after?.title).toBeNull();

    // UI-D-11 / UI-D-13 on the wire: a failed preview is INDISTINGUISHABLE from no link at all.
    const res = await api.request(`/v1/feed/posts/${createdPostIds[0]}`, {
      headers: { ...authed(tokens.demoAdmin), 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(200);
    const item = (await res.json()) as FeedPost;
    expect(item.linkPreview).toBeNull();
    // The guard refused at the SOCKET, so the fixture was never actually read.
    expect(metadata.requests).toBe(0);
  });

  /**
   * The RESOLVED wire shape, against the row `pnpm db:seed` writes directly. The seed is the
   * fixture writer of record and performs no unfurl, exactly so this assertion does not depend on
   * reaching any host — the same reason the guard suite binds its fixtures to the loopback.
   */
  it('2b. a RESOLVED preview projects onto the wire with its metadata and a derived hostname', async () => {
    const rows = await adminSql<{ id: string; post_id: string }[]>`
      select lp.id, p.id as post_id
        from public.feed_link_previews lp
        join public.feed_posts p on p.link_preview_id = lp.id
       where lp.tenant_id = ${tenantIds.demo}::uuid and lp.status = 'resolved'
       limit 1`;
    const seeded = rows[0];
    expect(seeded, 'the seed writes one resolved preview per tenant').toBeDefined();

    const res = await api.request(`/v1/feed/posts/${seeded?.post_id}`, {
      headers: { ...authed(tokens.demoAdmin), 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(200);
    const item = (await res.json()) as FeedPost;
    expect(item.linkPreview).not.toBeNull();
    expect(item.linkPreview?.status).toBe('resolved');
    expect(item.linkPreview?.title).toBe('Encontro anual da comunidade');
    expect(item.linkPreview?.siteName).toBe('Noticias Exemplo');
    // Derived server-side and `www.`-stripped, so the card never parses a URL.
    expect(item.linkPreview?.hostname).toBe('noticias.exemplo.invalid');
    // V1 stores no remote thumbnail — the card renders body-only rather than hot-linking a host.
    expect(item.linkPreview?.imageAssetId).toBeNull();
    // The failure code is NOT on the wire, on any status (UI-D-13).
    expect(Object.keys(item.linkPreview ?? {})).not.toContain('failureReason');
  });

  /** The seeded FAILED preview: a post that has one renders exactly like a post that has none. */
  it('2c. a FAILED preview projects as null — there is no pending or failed card (UI-D-11)', async () => {
    const rows = await adminSql<{ post_id: string }[]>`
      select p.id as post_id
        from public.feed_link_previews lp
        join public.feed_posts p on p.link_preview_id = lp.id
       where lp.tenant_id = ${tenantIds.demo}::uuid and lp.status = 'failed'
       limit 1`;
    const postId = rows[0]?.post_id;
    expect(postId, 'the seed writes one failed preview per tenant').toBeDefined();

    const res = await api.request(`/v1/feed/posts/${postId}`, {
      headers: { ...authed(tokens.demoAdmin), 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect((JSON.parse(body) as FeedPost).linkPreview).toBeNull();
    // And nothing in the body hints that a preview was ever attempted.
    expect(body).not.toMatch(/no_metadata|failure_reason|failureReason/);
  });

  it('3. a SECOND post of the same link reuses the row, adds no job and issues no second fetch', async () => {
    const url = `http://127.0.0.1:${metadata.port}/artigo`;
    const before = metadata.requests;
    const [existing] = await previewRowsFor(tenantIds.demo, url);
    const jobsBefore = await jobsFor(existing?.id ?? '');

    const item = await created(`Vale reler: ${url}`);

    const rows = await previewRowsFor(tenantIds.demo, url);
    // Still exactly ONE row for this (tenant, url) — the cache, not a second copy.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(existing?.id);

    const jobsAfter = await jobsFor(existing?.id ?? '');
    expect(jobsAfter).toHaveLength(jobsBefore.length);

    // THE assertion this test exists for: no second outbound request was ever made.
    expect(metadata.requests).toBe(before);
    // The reused row is terminal (test 2 drove it to 'failed'), so the wire still carries nothing —
    // the cache hit saved the fetch, and the silence is unchanged.
    expect(item.linkPreview).toBeNull();
  });

  it('4. the SAME url in the OTHER tenant is a separate row — the cache is per tenant', async () => {
    const url = `http://127.0.0.1:${metadata.port}/artigo`;

    await created(`Saiu a materia: ${url}`, tokens.labAdmin, HOSTS.lab);

    const lab = await previewRowsFor(tenantIds.lab, url);
    const demo = await previewRowsFor(tenantIds.demo, url);
    expect(lab).toHaveLength(1);
    expect(demo).toHaveLength(1);
    expect(lab[0]?.id).not.toBe(demo[0]?.id);
    // The lab's own row starts from scratch: it inherits nothing from what the demo tenant resolved.
    expect(lab[0]?.status).toBe('pending');
  });

  it('5. UI-D-13 — a refused URL publishes with 201, a null preview and NO refusal marker', async () => {
    const url = `http://127.0.0.1:${internal.port}/painel`;
    const before = internal.requests;

    const res = await createPost(`Olha isso: ${url}`);
    // The post PUBLISHES. A 400 here would tell an admin their URL was special.
    expect(res.status).toBe(201);
    const body = await res.text();
    const item = JSON.parse(body) as FeedPost;
    createdPostIds.push(item.id);

    // Asserted as an ABSENCE, deliberately: looking for a refusal marker would pass while the
    // marker existed, and the marker IS the internal-network oracle this rule forbids.
    expect(item.linkPreview).toBeNull();
    expect(body).not.toMatch(/blocked|refus|bloquead|ssrf|failure/i);

    // A row IS created, at 'pending' — the create path validates the URL's SHAPE, never its
    // address (that needs a resolver, and a resolver has no place in a request). The row is
    // invisible on the wire until it resolves, which is what makes the silence structural rather
    // than a message somebody remembered not to write.
    const rows = await previewRowsFor(tenantIds.demo, url);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('pending');
    // And nothing reached the "internal service" from the request path: no outbound work happened.
    expect(internal.requests).toBe(before);
  });

  it('6. the handler writes failed/blocked for a refused target and does NOT throw', async () => {
    const url = `http://127.0.0.1:${internal.port}/painel`;
    const before = internal.requests;

    // The row test 5 left at 'pending' — the realistic path, not a hand-made fixture.
    const [row] = await previewRowsFor(tenantIds.demo, url);
    expect(row?.status).toBe('pending');

    await expect(
      feedUnfurlJob.handler({ tenantId: tenantIds.demo, previewId: row?.id ?? '', url }),
    ).resolves.toBeUndefined();

    const [after] = await previewRowsFor(tenantIds.demo, url);
    expect(after?.status).toBe('failed');
    expect(after?.failure_reason).toBe('blocked');
    // The guard refused at the SOCKET, so the "internal service" was never contacted.
    expect(internal.requests).toBe(before);
  });

  it('7. a tenant-B session can never read a tenant-A preview through any feed response', async () => {
    const rows = await adminSql<{ id: string; post_id: string }[]>`
      select lp.id, p.id as post_id
        from public.feed_link_previews lp
        join public.feed_posts p on p.link_preview_id = lp.id
       where lp.tenant_id = ${tenantIds.demo}::uuid and lp.status = 'resolved'
       limit 1`;
    const demoRow = rows[0];
    const demoPostId = demoRow?.post_id;

    // POSITIVE CONTROL, in the same test: A's own lane returns the preview.
    const own = await api.request(`/v1/feed/posts/${demoPostId}`, {
      headers: { ...authed(tokens.demoAdmin), 'x-tenant-host': HOSTS.demo },
    });
    expect(own.status).toBe(200);
    expect(((await own.json()) as FeedPost).linkPreview?.status).toBe('resolved');

    // B asking for A's post gets the same bare 404 an unknown id gets (FEED-07).
    const cross = await api.request(`/v1/feed/posts/${demoPostId}`, {
      headers: { ...authed(tokens.labAdmin), 'x-tenant-host': HOSTS.lab },
    });
    expect(cross.status).toBe(404);

    // And nothing in B's own feed carries A's preview id.
    const feed = await api.request('/v1/feed?limit=25', {
      headers: { ...authed(tokens.labAdmin), 'x-tenant-host': HOSTS.lab },
    });
    expect(feed.status).toBe(200);
    expect(await feed.text()).not.toContain(demoRow?.id ?? 'unreachable-sentinel');
  });
});
