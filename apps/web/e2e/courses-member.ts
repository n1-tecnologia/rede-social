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
