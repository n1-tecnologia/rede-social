import postgres from 'postgres';
import {
  createCategory,
  createCourse,
  createLive,
  deleteCoursesByPrefix,
  deleteLivesByPrefix,
  linkCourseProduct,
  linkLiveProduct,
} from './courses-admin';
import {
  createProduct,
  deleteProductsByPrefix,
  grantEntitlement,
  setProductStatus,
} from './store-admin';

/**
 * Fixtures for the member school e2e (08.5-06 on), the `courses-admin.ts` shape: rows written through
 * a direct superuser connection, so a spec can stand up a catalogue (open, locked, draft and
 * long-title courses, a category, the five kinds of agenda card) in a few statements, without driving
 * the admin forms.
 *
 * Progress is written the way the member's progress route writes it (an own `course_lesson_progress`
 * row with `completed_at`); there is no member token helper in the harness, so `completeLessonAs`
 * is the one place a spec fakes a completion.
 *
 * Every row carries the run prefix in its title or name, and `deleteMemberCatalogueFixture` removes
 * lives (their replay pointer references a lesson), then courses (progress rows, store links and
 * categories with them), then products and their ledgers.
 */

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 2 },
  );
  return client;
}

/** Release the fixture connection (call from `test.afterAll` so Playwright can exit). */
export async function closeCoursesMember(): Promise<void> {
  await client?.end();
  client = null;
}

/**
 * Marks `lessonId` complete for the user `memberEmail` — the row the member's progress route writes
 * (`PUT /v1/courses/learn/lessons/{id}/progress { completed: true }`). Idempotent.
 */
export async function completeLessonAs(memberEmail: string, lessonId: string): Promise<void> {
  const rows = await sql()<{ lesson_id: string }[]>`
    insert into public.course_lesson_progress
      (tenant_id, user_id, lesson_id, completed_at, last_position_seconds, updated_at)
    select l.tenant_id, u.id, l.id, now(), 0, now()
      from public.course_lessons l, public.users u
     where l.id = ${lessonId}::uuid and u.email = ${memberEmail}
    on conflict (tenant_id, user_id, lesson_id)
      do update set completed_at = coalesce(public.course_lesson_progress.completed_at, now()),
                    updated_at = now()
    returning lesson_id::text as lesson_id`;
  if (!rows[0]) throw new Error(`could not complete ${lessonId} for ${memberEmail}`);
}

/** An ACTIVE grant of `productId` to `memberEmail` (the store's own fixture). Returns its id. */
export async function grantProduct(productId: string, memberEmail: string): Promise<string> {
  return grantEntitlement(memberEmail, productId);
}

/** The course's live lessons in curriculum order (module position, then lesson position). */
async function courseLessons(courseId: string): Promise<string[]> {
  const rows = await sql()<{ id: string }[]>`
    select l.id::text as id
      from public.course_lessons l
      join public.course_modules m on m.id = l.module_id
     where l.course_id = ${courseId}::uuid and l.deleted_at is null and m.deleted_at is null
     order by m.position asc, l.position asc`;
  return rows.map((row) => row.id);
}

/** Exactly `length` characters of real words after `prefix` (never an unbroken run). */
export function longTitle(prefix: string, length: number): string {
  const words =
    'harmonização facial avançada do zero ao resultado natural com segurança protocolos clínicos e técnica aplicada'.split(
      ' ',
    );
  let text = prefix;
  for (let index = 0; text.length < length; index += 1) {
    text += ` ${words[index % words.length]}`;
  }
  const cut = text.slice(0, length);
  return cut.endsWith(' ') ? `${cut.slice(0, -1)}a` : cut;
}

export type MemberCatalogueFixture = {
  category: { id: string; name: string };
  open: { id: string; title: string };
  /** Locked by `product` (the member holds none); its first lesson is free. */
  locked: { id: string; title: string; freeLessonId: string };
  draft: { id: string; title: string };
  /** 120 characters, locked by the ARCHIVED `archivedProduct`, its first lesson free. */
  long: { id: string; title: string; freeLessonId: string };
  product: { id: string; name: string };
  archivedProduct: { id: string; name: string };
  lives: {
    onAir: { id: string; title: string };
    scheduled: { id: string; title: string };
    cancelled: { id: string; title: string };
    recorded: { id: string; title: string };
    ended: { id: string; title: string };
    locked: { id: string; title: string };
  };
};

const HOUR = 60 * 60_000;

/**
 * A member catalogue on `tenantSlug` (rede-demo by default), every title under `prefix`:
 *
 *  - a category, an OPEN published course in it (level Iniciante, 1 × 2 lessons);
 *  - a LOCKED published course (no category) linked to an active product the member lacks, its first
 *    lesson free; a DRAFT course (must never show); a LOCKED 120-character course whose only product
 *    is ARCHIVED (the E03 long-text backstop: "Exclusivo" and "Produto arquivado"), first lesson free;
 *  - lives: one on air (started 10 min ago), one scheduled (tomorrow), one cancelled (in 2 h), one
 *    recorded with a replay lesson (3 h ago), one ended WITHOUT a replay (5 h ago, must never show),
 *    and one scheduled live locked by the product.
 *
 * The courses are back-dated a minute apart, so newest-first is deterministic among them.
 */
export async function memberCatalogueFixture(
  prefix: string,
  tenantSlug = 'rede-demo',
): Promise<MemberCatalogueFixture> {
  const categoryName = `${prefix} Lábios`;
  const categoryId = await createCategory({ tenantSlug, name: categoryName });

  const openTitle = `${prefix} Curso aberto`;
  const openId = await createCourse({
    tenantSlug,
    title: openTitle,
    status: 'published',
    modules: 1,
    lessonsPerModule: 2,
    minutesAgo: 4,
  });
  await sql()`
    update public.courses set category_id = ${categoryId}::uuid, level = 'iniciante'
     where id = ${openId}::uuid`;

  const lockedTitle = `${prefix} Curso exclusivo`;
  const lockedId = await createCourse({
    tenantSlug,
    title: lockedTitle,
    status: 'published',
    modules: 1,
    lessonsPerModule: 2,
    minutesAgo: 3,
  });

  const draftTitle = `${prefix} Curso rascunho`;
  const draftId = await createCourse({ tenantSlug, title: draftTitle, status: 'draft' });

  const long = longTitle(`${prefix} Longo`, 120);
  const longId = await createCourse({
    tenantSlug,
    title: long,
    status: 'published',
    modules: 1,
    lessonsPerModule: 2,
    minutesAgo: 2,
  });

  const productName = `${prefix} Produto`;
  const productId = await createProduct({ tenantSlug, name: productName, priceCents: 4900 });
  const archivedName = `${prefix} Produto antigo`;
  const archivedId = await createProduct({ tenantSlug, name: archivedName, priceCents: 9900 });
  await linkCourseProduct(lockedId, productId);
  await linkCourseProduct(longId, archivedId);
  await setProductStatus(archivedId, 'archived');

  const lockedLessons = await courseLessons(lockedId);
  const longLessons = await courseLessons(longId);
  const lockedFree = lockedLessons[0] ?? '';
  const longFree = longLessons[0] ?? '';
  await sql()`
    update public.course_lessons set is_free = true
     where id in (${lockedFree}::uuid, ${longFree}::uuid)`;

  const now = Date.now();
  const at = (offset: number) => new Date(now + offset).toISOString();
  const onAir = { title: `${prefix} Live no ar`, id: '' };
  onAir.id = await createLive({ tenantSlug, title: onAir.title, startsAt: at(-10 * 60_000) });
  const scheduled = { title: `${prefix} Live agendada`, id: '' };
  scheduled.id = await createLive({ tenantSlug, title: scheduled.title, startsAt: at(24 * HOUR) });
  const cancelled = { title: `${prefix} Live cancelada`, id: '' };
  cancelled.id = await createLive({
    tenantSlug,
    title: cancelled.title,
    startsAt: at(2 * HOUR),
  });
  const recorded = { title: `${prefix} Live gravada`, id: '' };
  recorded.id = await createLive({ tenantSlug, title: recorded.title, startsAt: at(-3 * HOUR) });
  const ended = { title: `${prefix} Live sem replay`, id: '' };
  ended.id = await createLive({ tenantSlug, title: ended.title, startsAt: at(-5 * HOUR) });
  const lockedLive = { title: `${prefix} Live exclusiva`, id: '' };
  lockedLive.id = await createLive({
    tenantSlug,
    title: lockedLive.title,
    startsAt: at(25 * HOUR),
  });
  // The store refuses to link a cancelled live (T-08.4-01): link first, then cancel elsewhere.
  await linkLiveProduct(lockedLive.id, productId);
  await sql()`update public.course_lives set cancelled_at = now() where id = ${cancelled.id}::uuid`;
  // The replay is a live lesson of the OPEN course (D-431: "Gravadas" needs one).
  const openLessons = await courseLessons(openId);
  await sql()`
    update public.course_lives set replay_lesson_id = ${openLessons[0] ?? ''}::uuid
     where id = ${recorded.id}::uuid`;

  return {
    category: { id: categoryId, name: categoryName },
    open: { id: openId, title: openTitle },
    locked: { id: lockedId, title: lockedTitle, freeLessonId: lockedFree },
    draft: { id: draftId, title: draftTitle },
    long: { id: longId, title: long, freeLessonId: longFree },
    product: { id: productId, name: productName },
    archivedProduct: { id: archivedId, name: archivedName },
    lives: {
      onAir,
      scheduled,
      cancelled,
      recorded,
      ended,
      locked: lockedLive,
    },
  };
}

/**
 * Removes everything `memberCatalogueFixture(prefix)` wrote: lives first (the replay pointer has no
 * cascade), then courses with their progress, store links and categories, then the products with
 * their entitlements and orders.
 */
export async function deleteMemberCatalogueFixture(prefix: string): Promise<void> {
  await deleteLivesByPrefix(prefix);
  await deleteCoursesByPrefix(prefix);
  await deleteProductsByPrefix(prefix);
}

// ── 08.5-07: the course page ──────────────────────────────────────────────────────────────────

type LessonSpec = {
  title: string;
  /** Ready video seconds; null or absent → a practice lesson (no video). */
  seconds?: number | null;
  isFree?: boolean;
  /** The lesson description — a unique marker for the payload check (T-08.5-13). */
  description?: string;
};

type ModuleSpec = { title: string; requiresPrevious?: boolean; lessons: LessonSpec[] };

type CourseTree = { id: string; modules: { id: string; lessons: string[] }[] };

/**
 * A PUBLISHED course with exactly the modules and lessons given, every video a READY `lesson` asset
 * under the fake provider with its seconds (what the learn read prints as mm:ss), back-dated
 * `minutesAgo`. Written in one transaction by the tenant's seeded admin.
 */
async function createCourseTree(
  tenantSlug: string,
  fields: {
    title: string;
    tagline?: string;
    status?: 'published' | 'draft';
    minutesAgo?: number;
    modules: ModuleSpec[];
  },
): Promise<CourseTree> {
  const admins = await sql()<{ tenant_id: string; user_id: string }[]>`
    select m.tenant_id::text as tenant_id, m.user_id::text as user_id
      from public.memberships m
      join public.tenants t on t.id = m.tenant_id
     where t.slug = ${tenantSlug} and m.role = 'admin_tenant' and m.deleted_at is null
     order by m.joined_at asc
     limit 1`;
  const admin = admins[0];
  if (!admin) throw new Error(`no admin on ${tenantSlug}`);
  const { tenant_id: tenantId, user_id: userId } = admin;
  const stamp = new Date(Date.now() - (fields.minutesAgo ?? 0) * 60_000).toISOString();
  const status = fields.status ?? 'published';

  return sql().begin(async (tx) => {
    const courses = await tx<{ id: string }[]>`
      insert into public.courses
        (tenant_id, created_by_user_id, title, tagline, instructor_name, status, published_at,
         created_at, updated_at)
      values (${tenantId}::uuid, ${userId}::uuid, ${fields.title}, ${fields.tagline ?? ''},
              'Instrutora Fixture', ${status},
              ${status === 'published' ? stamp : null}::timestamptz,
              ${stamp}::timestamptz, ${stamp}::timestamptz)
      returning id::text as id`;
    const courseId = courses[0]?.id;
    if (!courseId) throw new Error(`could not create course "${fields.title}"`);

    const modules: CourseTree['modules'] = [];
    for (const [m, spec] of fields.modules.entries()) {
      const rows = await tx<{ id: string }[]>`
        insert into public.course_modules
          (tenant_id, course_id, title, position, requires_previous, created_at, updated_at)
        values (${tenantId}::uuid, ${courseId}::uuid, ${spec.title}, ${m + 1},
                ${spec.requiresPrevious ?? false}, ${stamp}::timestamptz, ${stamp}::timestamptz)
        returning id::text as id`;
      const moduleId = rows[0]?.id;
      if (!moduleId) throw new Error(`could not create module ${m + 1} of "${fields.title}"`);
      const lessons: string[] = [];
      for (const [l, lesson] of spec.lessons.entries()) {
        let videoId: string | null = null;
        if (typeof lesson.seconds === 'number') {
          const token = Math.random().toString(36).slice(2);
          const assets = await tx<{ id: string }[]>`
            insert into public.media_assets
              (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id,
               playback_id, mime, bytes, filename, duration_seconds, aspect_ratio, ready_at,
               created_at)
            values (${tenantId}::uuid, ${userId}::uuid, 'video', 'lesson', 'ready', 'fake',
                    ${`fake-e2e-cp-${token}`}, ${`fake-playback-cp-${token}`}, 'video/mp4',
                    1048576, ${`${lesson.title}.mp4`}, ${lesson.seconds}, '16:9', now(),
                    ${stamp}::timestamptz)
            returning id::text as id`;
          videoId = assets[0]?.id ?? null;
          if (!videoId) throw new Error(`could not create the video of "${lesson.title}"`);
        }
        const lessonRows = await tx<{ id: string }[]>`
          insert into public.course_lessons
            (tenant_id, course_id, module_id, title, description, position, video_asset_id,
             is_free, created_at, updated_at)
          values (${tenantId}::uuid, ${courseId}::uuid, ${moduleId}::uuid, ${lesson.title},
                  ${lesson.description ?? ''}, ${l + 1}, ${videoId}::uuid, ${lesson.isFree ?? false},
                  ${stamp}::timestamptz, ${stamp}::timestamptz)
          returning id::text as id`;
        const lessonId = lessonRows[0]?.id;
        if (!lessonId) throw new Error(`could not create lesson "${lesson.title}"`);
        lessons.push(lessonId);
      }
      modules.push({ id: moduleId, lessons });
    }
    return { id: courseId, modules };
  });
}

export type CoursePageFixture = {
  /**
   * OPEN, two modules: module 1 = a 12:34 video lesson + a practice lesson; module 2 (requires
   * the previous module) = one 8:10 video lesson.
   */
  open: {
    id: string;
    title: string;
    moduleIds: [string, string];
    videoLessonId: string;
    practiceLessonId: string;
    secondModuleLessonId: string;
  };
  /** Locked by TWO active products; a free 4:10 lesson and a paid 12:34 one, each with a marker. */
  lockedMany: {
    id: string;
    title: string;
    freeLessonId: string;
    paidLessonId: string;
    paidLessonTitle: string;
    freeMarker: string;
    paidMarker: string;
    products: [{ id: string; name: string }, { id: string; name: string }];
  };
  /** Locked by ONE active product, with a free lesson. */
  lockedOne: {
    id: string;
    title: string;
    freeLessonId: string;
    product: { id: string; name: string };
  };
  /** Locked by an ARCHIVED product only, no free lesson: not for sale, "Produto arquivado". */
  lockedNone: { id: string; title: string };
  draft: { id: string; title: string };
  /**
   * 120-character title, 160-character tagline, three modules; module 3 requires module 2 and holds
   * one long-titled lesson (the E07 320px backstop).
   */
  long: { id: string; title: string; tagline: string; module3Id: string; longLessonId: string };
};

/**
 * The course-page fixture (08.5-07) on `tenantSlug` (rede-demo by default), every title and product
 * name under `prefix`, so `deleteMemberCatalogueFixture(prefix)` removes it all.
 */
export async function coursePageFixture(
  prefix: string,
  tenantSlug = 'rede-demo',
): Promise<CoursePageFixture> {
  const openTitle = `${prefix} Página aberta`;
  const open = await createCourseTree(tenantSlug, {
    title: openTitle,
    minutesAgo: 6,
    modules: [
      {
        title: `${prefix} Fundamentos`,
        lessons: [
          { title: `${prefix} Anatomia`, seconds: 754 },
          { title: `${prefix} Exercício`, seconds: null },
        ],
      },
      {
        title: `${prefix} Técnica`,
        requiresPrevious: true,
        lessons: [{ title: `${prefix} Aplicação`, seconds: 490 }],
      },
    ],
  });

  const freeMarker = `${prefix}-marcador-aberta-${Math.random().toString(36).slice(2)}`;
  const paidMarker = `${prefix}-marcador-exclusiva-${Math.random().toString(36).slice(2)}`;
  const paidLessonTitle = `${prefix} Técnica base`;
  const manyTitle = `${prefix} Página exclusiva`;
  const many = await createCourseTree(tenantSlug, {
    title: manyTitle,
    minutesAgo: 5,
    modules: [
      {
        title: `${prefix} Base`,
        lessons: [
          { title: `${prefix} Boas-vindas`, seconds: 250, isFree: true, description: freeMarker },
          { title: paidLessonTitle, seconds: 754, description: paidMarker },
        ],
      },
    ],
  });

  const oneTitle = `${prefix} Página um produto`;
  const one = await createCourseTree(tenantSlug, {
    title: oneTitle,
    minutesAgo: 4,
    modules: [
      {
        title: `${prefix} Único`,
        lessons: [
          { title: `${prefix} Aula grátis`, seconds: 120, isFree: true },
          { title: `${prefix} Aula paga`, seconds: 300 },
        ],
      },
    ],
  });

  const noneTitle = `${prefix} Página fora de venda`;
  const none = await createCourseTree(tenantSlug, {
    title: noneTitle,
    minutesAgo: 3,
    modules: [{ title: `${prefix} Arquivo`, lessons: [{ title: `${prefix} Aula`, seconds: 60 }] }],
  });

  const draftTitle = `${prefix} Página rascunho`;
  const draft = await createCourseTree(tenantSlug, {
    title: draftTitle,
    status: 'draft',
    modules: [
      { title: `${prefix} Rascunho`, lessons: [{ title: `${prefix} Aula r`, seconds: 60 }] },
    ],
  });

  const longCourseTitle = longTitle(`${prefix} Longo`, 120);
  const tagline = longTitle(`${prefix} Frase`, 160);
  const longCourse = await createCourseTree(tenantSlug, {
    title: longCourseTitle,
    tagline,
    minutesAgo: 2,
    modules: [
      { title: `${prefix} Um`, lessons: [{ title: `${prefix} L1`, seconds: 60 }] },
      { title: `${prefix} Dois`, lessons: [{ title: `${prefix} L2`, seconds: 60 }] },
      {
        title: `${prefix} Três`,
        requiresPrevious: true,
        lessons: [{ title: longTitle(`${prefix} Aula`, 64), seconds: 754 }],
      },
    ],
  });

  const productA = { name: `${prefix} Mentoria`, id: '' };
  productA.id = await createProduct({ tenantSlug, name: productA.name, priceCents: 4900 });
  const productB = { name: `${prefix} Encontro`, id: '' };
  productB.id = await createProduct({ tenantSlug, name: productB.name, priceCents: 0 });
  const productOld = { name: `${prefix} Antigo`, id: '' };
  productOld.id = await createProduct({ tenantSlug, name: productOld.name, priceCents: 9900 });
  await linkCourseProduct(many.id, productA.id);
  await linkCourseProduct(many.id, productB.id);
  await linkCourseProduct(one.id, productA.id);
  await linkCourseProduct(none.id, productOld.id);
  await setProductStatus(productOld.id, 'archived');

  const [openM1, openM2] = open.modules;
  const [longM1, longM2, longM3] = longCourse.modules;
  if (!openM1 || !openM2 || !longM1 || !longM2 || !longM3) throw new Error('fixture modules');

  return {
    open: {
      id: open.id,
      title: openTitle,
      moduleIds: [openM1.id, openM2.id],
      videoLessonId: openM1.lessons[0] ?? '',
      practiceLessonId: openM1.lessons[1] ?? '',
      secondModuleLessonId: openM2.lessons[0] ?? '',
    },
    lockedMany: {
      id: many.id,
      title: manyTitle,
      freeLessonId: many.modules[0]?.lessons[0] ?? '',
      paidLessonId: many.modules[0]?.lessons[1] ?? '',
      paidLessonTitle,
      freeMarker,
      paidMarker,
      products: [productA, productB],
    },
    lockedOne: {
      id: one.id,
      title: oneTitle,
      freeLessonId: one.modules[0]?.lessons[0] ?? '',
      product: productA,
    },
    lockedNone: { id: none.id, title: noneTitle },
    draft: { id: draft.id, title: draftTitle },
    long: {
      id: longCourse.id,
      title: longCourseTitle,
      tagline,
      module3Id: longM3.id,
      longLessonId: longM3.lessons[0] ?? '',
    },
  };
}
