import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import { expect } from 'vitest';
import { adminSql, api, HOSTS } from './setup';

/**
 * The 08.5 member-lane fixture (08.5-01), shared by `courses-learn.test.ts` (the tracer),
 * `media-playback.test.ts` (`08.5 lesson asset gate`) and `isolation.test.ts` (`phase 08.5 sweep:
 * courses learn`): ONE published course of a seed tenant, linked to a fresh product nobody holds,
 * with a module holding a FREE lesson F and a PAID lesson P, each with a ready `lesson` video and —
 * unless `materials: false` — one real `attachment` material uploaded through the broker (so an
 * object exists and `/original` can answer its 302).
 *
 * Everything is built through the ADMIN API on the tenant's own host (course, module, lessons,
 * materials, product link, publish); only the two videos are written by `adminSql` in a READY
 * state (the fake provider's transcode is 03-06's subject, not this one's). Every row carries
 * `prefix` (course and product titles, asset filenames), and `removeLearnFixture(prefix)` sweeps by
 * it in foreign-key order: entitlements, products (links cascade), progress rows, courses
 * (modules, lessons and materials cascade), assets.
 */

export type LearnFixture = {
  tenantId: string;
  courseId: string;
  moduleId: string;
  freeLessonId: string;
  paidLessonId: string;
  freeVideoId: string;
  paidVideoId: string;
  freeMaterialAssetId: string | null;
  paidMaterialAssetId: string | null;
  productId: string;
};

/** The title the free lesson carries: quotes, accents and an emoji must round-trip (EP-14). */
export const FREE_LESSON_TITLE = 'Aula "Ação" 🎓';
/** The paid lesson's description: it must never appear in a member answer while P is locked. */
export const PAID_LESSON_DESCRIPTION = 'Conteúdo pago: só para quem comprou';

const SLUGS: Record<keyof typeof HOSTS, string> = { demo: 'rede-demo', lab: 'rede-lab' };
const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');

export const learnRequest = (
  method: string,
  path: string,
  token: string,
  host: string,
  body?: unknown,
) =>
  api.request(path, {
    method,
    headers: {
      [TENANT_HOST_HEADER]: host,
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

async function created<T extends { id: string }>(res: Response, what: string): Promise<T> {
  expect(res.status, `${what} -> ${res.status}`).toBe(201);
  return (await res.json()) as T;
}

async function readyLessonVideo(tenantId: string, prefix: string, label: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
       mime, bytes, duration_seconds, aspect_ratio, filename, ready_at)
    select ${tenantId}::uuid, m.user_id, 'video', 'lesson', 'ready', 'fake',
           ${`fake-${crypto.randomUUID()}`}, ${`fake-playback-${prefix}-${label}`},
           'video/mp4', 1048576, 600, '16:9', ${`${prefix}-${label}.mp4`}, now()
      from public.memberships m
     where m.tenant_id = ${tenantId}::uuid and m.role = 'admin_tenant'
     order by m.joined_at
     fetch first 1 rows only
    returning id::text as id`;
  if (!row) throw new Error(`could not seed the ${label} lesson video`);
  return row.id;
}

/** A real `attachment` through the broker: start, PUT the bytes to Storage, complete (READY). */
async function uploadMaterial(
  token: string,
  host: string,
  prefix: string,
  label: string,
): Promise<string> {
  const start = await learnRequest('POST', '/v1/media/uploads', token, host, {
    kind: 'file',
    purpose: 'attachment',
    mime: 'application/pdf',
    size: PDF_BYTES.length,
    filename: `${prefix}-${label}.pdf`,
  });
  expect(start.status).toBe(201);
  const target = (await start.json()) as { assetId: string; signedUrl: string };
  const put = await fetch(target.signedUrl, {
    method: 'PUT',
    body: new Uint8Array(PDF_BYTES),
    headers: { 'content-type': 'application/pdf', 'x-upsert': 'false' },
  });
  expect(put.ok, `PUT material -> ${put.status}`).toBe(true);
  const done = await learnRequest(
    'POST',
    `/v1/media/uploads/${target.assetId}/complete`,
    token,
    host,
  );
  expect(done.status).toBe(200);
  return target.assetId;
}

/**
 * Builds the fixture on `host` as its admin (`adminToken`). The caller turns `store` and `courses`
 * on for that tenant first (`withModuleEnabled`) and calls `removeLearnFixture(prefix)` after.
 */
export async function buildLearnFixture(input: {
  prefix: string;
  adminToken: string;
  host: keyof typeof HOSTS;
  materials?: boolean;
}): Promise<LearnFixture> {
  const { prefix, adminToken } = input;
  const host = HOSTS[input.host];
  const [tenant] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = ${SLUGS[input.host]}`;
  if (!tenant) throw new Error(`tenant ${SLUGS[input.host]} is not seeded`);
  const send = (method: string, path: string, body?: unknown) =>
    learnRequest(method, path, adminToken, host, body);

  const course = await created<{ id: string }>(
    await send('POST', '/v1/courses', { title: `${prefix} curso`, instructorName: 'Dra. Ana' }),
    'course',
  );
  const module = await created<{ id: string }>(
    await send('POST', `/v1/courses/${course.id}/modules`, { title: `${prefix} módulo` }),
    'module',
  );
  const freeVideoId = await readyLessonVideo(tenant.id, prefix, 'free');
  const paidVideoId = await readyLessonVideo(tenant.id, prefix, 'paid');
  const free = await created<{ id: string }>(
    await send('POST', `/v1/courses/modules/${module.id}/lessons`, {
      title: FREE_LESSON_TITLE,
      description: 'Aula aberta para todos',
      videoAssetId: freeVideoId,
      isFree: true,
    }),
    'free lesson',
  );
  const paid = await created<{ id: string }>(
    await send('POST', `/v1/courses/modules/${module.id}/lessons`, {
      title: `${prefix} aula paga`,
      description: PAID_LESSON_DESCRIPTION,
      videoAssetId: paidVideoId,
    }),
    'paid lesson',
  );

  let freeMaterialAssetId: string | null = null;
  let paidMaterialAssetId: string | null = null;
  if (input.materials !== false) {
    freeMaterialAssetId = await uploadMaterial(adminToken, host, prefix, 'material-free');
    paidMaterialAssetId = await uploadMaterial(adminToken, host, prefix, 'material-paid');
    for (const [lessonId, assetId] of [
      [free.id, freeMaterialAssetId],
      [paid.id, paidMaterialAssetId],
    ] as const) {
      const res = await send('PUT', `/v1/courses/lessons/${lessonId}/materials`, {
        assetIds: [assetId],
      });
      expect(res.status).toBe(200);
    }
  }

  const product = await created<{ id: string }>(
    await send('POST', '/v1/store/products', {
      name: `${prefix} produto`,
      priceCents: 990,
      courseIds: [course.id],
    }),
    'product',
  );
  const published = await send('PUT', `/v1/courses/${course.id}/status`, { status: 'published' });
  expect(published.status).toBe(200);

  return {
    tenantId: tenant.id,
    courseId: course.id,
    moduleId: module.id,
    freeLessonId: free.id,
    paidLessonId: paid.id,
    freeVideoId,
    paidVideoId,
    freeMaterialAssetId,
    paidMaterialAssetId,
    productId: product.id,
  };
}

/** Grants the fixture's product to the seed user `email` through the admin's grant route. */
export async function grantFixtureProduct(
  fixture: LearnFixture,
  adminToken: string,
  host: keyof typeof HOSTS,
  email: string,
): Promise<void> {
  const [membership] = await adminSql<{ id: string }[]>`
    select m.id::text as id
      from public.memberships m join public.users u on u.id = m.user_id
     where m.tenant_id = ${fixture.tenantId}::uuid and u.email = ${email}`;
  if (!membership) throw new Error(`no membership for ${email}`);
  const res = await learnRequest(
    'POST',
    `/v1/store/products/${fixture.productId}/grants`,
    adminToken,
    HOSTS[host],
    { membershipId: membership.id },
  );
  expect(res.status).toBe(200);
}

/** Sweeps everything a fixture with this prefix (or an interrupted earlier run) left behind. */
export async function removeLearnFixture(prefix: string): Promise<void> {
  const like = `${prefix}%`;
  await adminSql`
    delete from public.store_entitlements e
     using public.store_products p
     where e.product_id = p.id and p.name like ${like}`;
  await adminSql`delete from public.store_products where name like ${like}`;
  await adminSql`
    delete from public.course_lesson_progress p
     using public.course_lessons l join public.courses c on c.id = l.course_id
     where p.lesson_id = l.id and c.title like ${like}`;
  await adminSql`delete from public.courses where title like ${like}`;
  await adminSql`delete from public.media_assets where filename like ${like}`;
}
