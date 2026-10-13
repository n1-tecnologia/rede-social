import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  CATEGORY_MAX_NAME,
  COURSE_FILTERS,
  COURSE_ISSUE_SET,
  COURSE_ISSUES,
  COURSE_LEVELS,
  COURSE_MAX_CURSOR_LENGTH,
  COURSE_MAX_DESCRIPTION,
  COURSE_MAX_HOURS,
  COURSE_MAX_ORDER,
  COURSE_MAX_OUTCOME,
  COURSE_MAX_OUTCOMES,
  COURSE_MAX_PAGE_SIZE,
  COURSE_MAX_PRODUCTS,
  COURSE_MAX_TAGLINE,
  COURSE_MAX_TITLE,
  COURSE_PAGE_SIZE,
  COURSE_PERMISSIONS,
  COURSE_STATUSES,
  categoryInputSchema,
  categoryListSchema,
  categoryPatchSchema,
  categorySchema,
  courseDetailSchema,
  courseInputSchema,
  courseListQuerySchema,
  coursePageSchema,
  coursePatchSchema,
  courseRowSchema,
  courseStatusBodySchema,
  LESSON_MAX_DESCRIPTION,
  LESSON_MAX_MATERIALS,
  LESSON_MAX_TITLE,
  lessonDetailSchema,
  lessonInputSchema,
  lessonListSchema,
  lessonPatchSchema,
  lessonViewSchema,
  MATERIAL_KINDS,
  MATERIAL_URL_TTL_SECONDS,
  MODULE_MAX_SUMMARY,
  MODULE_MAX_TITLE,
  materialKind,
  materialSchema,
  materialsBodySchema,
  materialUrlSchema,
  moduleInputSchema,
  moduleListSchema,
  modulePatchSchema,
  moduleViewSchema,
  reorderIdsSchema,
  reorderLessonsSchema,
  reorderModulesSchema,
} from '../contracts/index';

const id = (n: number) => `19000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { title: 'Harmonização', instructorName: 'Dra. Ana' };

/** The machine code a failed parse carries (the route `defaultHook` lifts the first known one). */
function issueOf(input: unknown, schema: z.ZodType = courseInputSchema): string | undefined {
  const result = schema.safeParse(input);
  if (result.success) return undefined;
  return result.error.issues.map((issue) => issue.message).find((m) => COURSE_ISSUE_SET.has(m));
}

describe('courses contracts (08.3-01)', () => {
  it('pins the caps, the permission, the enums and the issue vocabulary', () => {
    expect(COURSE_MAX_TITLE).toBe(120);
    expect(COURSE_MAX_TAGLINE).toBe(160);
    expect(COURSE_MAX_DESCRIPTION).toBe(5000);
    expect(COURSE_MAX_OUTCOMES).toBe(10);
    expect(COURSE_MAX_OUTCOME).toBe(120);
    expect(COURSE_MAX_HOURS).toBe(999);
    expect(COURSE_MAX_PRODUCTS).toBe(50);
    expect(MODULE_MAX_TITLE).toBe(120);
    expect(MODULE_MAX_SUMMARY).toBe(500);
    expect(LESSON_MAX_TITLE).toBe(120);
    expect(LESSON_MAX_DESCRIPTION).toBe(2000);
    expect(COURSE_PERMISSIONS.manage).toBe('courses.manage');
    expect(COURSE_STATUSES).toEqual(['draft', 'published', 'archived']);
    expect(COURSE_LEVELS).toEqual(['iniciante', 'intermediario', 'avancado']);
    for (const code of ['video_not_ready', 'status_invalid', 'video_invalid', 'video_in_use']) {
      expect(COURSE_ISSUES).toContain(code);
      expect(COURSE_ISSUE_SET.has(code)).toBe(true);
    }
    expect(new Set(COURSE_ISSUES).size).toBe(COURSE_ISSUES.length);
  });

  it('title: 0 after trim fails title_required; 1 and 120 pass; 121 fails title_too_long', () => {
    expect(issueOf({ ...base, title: '' })).toBe('title_required');
    expect(issueOf({ ...base, title: '   ' })).toBe('title_required');
    expect(courseInputSchema.parse({ ...base, title: '  a  ' }).title).toBe('a');
    expect(courseInputSchema.safeParse({ ...base, title: 'x'.repeat(120) }).success).toBe(true);
    expect(courseInputSchema.safeParse({ ...base, title: ` ${'x'.repeat(120)} ` }).success).toBe(
      true,
    );
    expect(issueOf({ ...base, title: 'x'.repeat(121) })).toBe('title_too_long');
  });

  it('instructor: required (D-412); 120 passes; 121 fails', () => {
    expect(issueOf({ ...base, instructorName: '' })).toBe('instructor_required');
    expect(issueOf({ ...base, instructorName: ' ' })).toBe('instructor_required');
    expect(issueOf({ title: 'x' })).toBeUndefined();
    expect(courseInputSchema.safeParse({ title: 'x' }).success).toBe(false);
    expect(courseInputSchema.safeParse({ ...base, instructorName: 'n'.repeat(120) }).success).toBe(
      true,
    );
    expect(issueOf({ ...base, instructorName: 'n'.repeat(121) })).toBe('title_too_long');
  });

  it('tagline and description: default empty; 160/5000 pass; 161/5001 fail', () => {
    const parsed = courseInputSchema.parse(base);
    expect(parsed.tagline).toBe('');
    expect(parsed.description).toBe('');
    expect(courseInputSchema.safeParse({ ...base, tagline: 't'.repeat(160) }).success).toBe(true);
    expect(issueOf({ ...base, tagline: 't'.repeat(161) })).toBe('tagline_too_long');
    expect(courseInputSchema.safeParse({ ...base, description: 'd'.repeat(5000) }).success).toBe(
      true,
    );
    expect(issueOf({ ...base, description: 'd'.repeat(5001) })).toBe('description_too_long');
  });

  it('outcomes: default []; 10 items pass, 11 fail; 120 chars pass, 121 fail', () => {
    expect(courseInputSchema.parse(base).outcomes).toEqual([]);
    const ten = Array.from({ length: 10 }, (_, i) => `meta ${i}`);
    expect(courseInputSchema.safeParse({ ...base, outcomes: ten }).success).toBe(true);
    expect(issueOf({ ...base, outcomes: [...ten, 'onze'] })).toBe('outcomes_too_many');
    expect(courseInputSchema.safeParse({ ...base, outcomes: ['o'.repeat(120)] }).success).toBe(
      true,
    );
    expect(issueOf({ ...base, outcomes: ['o'.repeat(121)] })).toBe('outcome_too_long');
    expect(courseInputSchema.parse({ ...base, outcomes: ['  a  '] }).outcomes).toEqual(['a']);
  });

  it('certificate hours: default null; 0 and 999 pass; -1, 1000 and 1.5 fail hours_invalid', () => {
    expect(courseInputSchema.parse(base).certificateHours).toBeNull();
    expect(courseInputSchema.safeParse({ ...base, certificateHours: 0 }).success).toBe(true);
    expect(courseInputSchema.safeParse({ ...base, certificateHours: 999 }).success).toBe(true);
    expect(courseInputSchema.safeParse({ ...base, certificateHours: null }).success).toBe(true);
    expect(issueOf({ ...base, certificateHours: -1 })).toBe('hours_invalid');
    expect(issueOf({ ...base, certificateHours: 1000 })).toBe('hours_invalid');
    expect(issueOf({ ...base, certificateHours: 1.5 })).toBe('hours_invalid');
  });

  it('level: the three values and null pass; anything else fails level_invalid', () => {
    expect(courseInputSchema.parse(base).level).toBeNull();
    for (const level of COURSE_LEVELS) {
      expect(courseInputSchema.safeParse({ ...base, level }).success).toBe(true);
    }
    expect(issueOf({ ...base, level: 'expert' })).toBe('level_invalid');
  });

  it('cover, photo and category ids: null by default; a non-uuid names its own code', () => {
    const parsed = courseInputSchema.parse(base);
    expect(parsed.coverAssetId).toBeNull();
    expect(parsed.instructorPhotoAssetId).toBeNull();
    expect(parsed.categoryId).toBeNull();
    expect(issueOf({ ...base, coverAssetId: 'nope' })).toBe('cover_invalid');
    expect(issueOf({ ...base, instructorPhotoAssetId: 'nope' })).toBe('photo_invalid');
    expect(issueOf({ ...base, categoryId: 'nope' })).toBe('category_invalid');
    expect(courseInputSchema.safeParse({ ...base, coverAssetId: id(1) }).success).toBe(true);
  });

  it('products: default []; 50 pass; 51 fail too_many_products; duplicates collapse; a non-uuid is product_invalid', () => {
    expect(courseInputSchema.parse(base).productIds).toEqual([]);
    const fifty = Array.from({ length: 50 }, (_, i) => id(i + 1));
    expect(courseInputSchema.safeParse({ ...base, productIds: fifty }).success).toBe(true);
    expect(issueOf({ ...base, productIds: [...fifty, id(51)] })).toBe('too_many_products');
    expect(
      courseInputSchema.parse({ ...base, productIds: [id(1), id(1), id(2)] }).productIds,
    ).toEqual([id(1), id(2)]);
    expect(issueOf({ ...base, productIds: ['nope'] })).toBe('product_invalid');
  });

  it('an unknown key fails (strict), and no known issue code is lifted for it', () => {
    const result = courseInputSchema.safeParse({ ...base, slug: 'x' });
    expect(result.success).toBe(false);
    expect(issueOf({ ...base, slug: 'x' })).toBeUndefined();
  });

  it('patch: an empty body fails patch_empty; one field passes; defaults are NOT re-applied', () => {
    expect(issueOf({}, coursePatchSchema)).toBe('patch_empty');
    const parsed = coursePatchSchema.parse({ title: 'Novo' });
    expect(parsed).toEqual({ title: 'Novo' });
    expect('tagline' in parsed).toBe(false);
    expect(issueOf({ title: '' }, coursePatchSchema)).toBe('title_required');
    expect(coursePatchSchema.safeParse({ productIds: [id(1), id(1)] }).success).toBe(true);
    expect(coursePatchSchema.parse({ productIds: [id(1), id(1)] }).productIds).toEqual([id(1)]);
  });

  it('status body: the three statuses pass, anything else or an extra key fails', () => {
    for (const status of COURSE_STATUSES) {
      expect(courseStatusBodySchema.safeParse({ status }).success).toBe(true);
    }
    expect(courseStatusBodySchema.safeParse({ status: 'live' }).success).toBe(false);
    expect(courseStatusBodySchema.safeParse({ status: 'draft', force: true }).success).toBe(false);
  });

  it('module input: title 1..120, summary ≤ 500 defaulting to empty, requiresPrevious defaults false', () => {
    const parsed = moduleInputSchema.parse({ title: 'Módulo 1' });
    expect(parsed).toEqual({ title: 'Módulo 1', summary: '', requiresPrevious: false });
    expect(issueOf({ title: '' }, moduleInputSchema)).toBe('title_required');
    expect(issueOf({ title: 'x'.repeat(121) }, moduleInputSchema)).toBe('title_too_long');
    expect(moduleInputSchema.safeParse({ title: 'x', summary: 's'.repeat(500) }).success).toBe(
      true,
    );
    expect(issueOf({ title: 'x', summary: 's'.repeat(501) }, moduleInputSchema)).toBe(
      'description_too_long',
    );
    expect(moduleInputSchema.safeParse({ title: 'x', requiresPrevious: 'yes' }).success).toBe(
      false,
    );
    expect(issueOf({}, modulePatchSchema)).toBe('patch_empty');
    expect(modulePatchSchema.parse({ requiresPrevious: true })).toEqual({ requiresPrevious: true });
  });

  it('lesson input: title 1..120, description ≤ 2000, videoAssetId null or uuid (video_invalid), isFree defaults false', () => {
    const parsed = lessonInputSchema.parse({ title: 'Aula 1' });
    expect(parsed).toEqual({ title: 'Aula 1', description: '', videoAssetId: null, isFree: false });
    expect(issueOf({ title: '' }, lessonInputSchema)).toBe('title_required');
    expect(issueOf({ title: 'x'.repeat(121) }, lessonInputSchema)).toBe('title_too_long');
    expect(issueOf({ title: 'x', description: 'd'.repeat(2001) }, lessonInputSchema)).toBe(
      'description_too_long',
    );
    expect(issueOf({ title: 'x', videoAssetId: 'nope' }, lessonInputSchema)).toBe('video_invalid');
    expect(
      lessonInputSchema.safeParse({ title: 'x', videoAssetId: id(7), isFree: true }).success,
    ).toBe(true);
    expect(issueOf({}, lessonPatchSchema)).toBe('patch_empty');
    expect(lessonPatchSchema.parse({ videoAssetId: null })).toEqual({ videoAssetId: null });
  });

  it('categories (08.3-04, D-411, P15): name 0 after trim fails, 1 and 60 pass, 61 fails; cover null by default or a uuid; unknown key fails; empty patch fails', () => {
    expect(CATEGORY_MAX_NAME).toBe(60);
    expect(issueOf({ name: '' }, categoryInputSchema)).toBe('title_required');
    expect(issueOf({ name: '   ' }, categoryInputSchema)).toBe('title_required');
    expect(categoryInputSchema.parse({ name: ' a ' })).toEqual({ name: 'a', coverAssetId: null });
    expect(categoryInputSchema.safeParse({ name: 'n'.repeat(60) }).success).toBe(true);
    // The cap is measured AFTER the trim: 60 letters inside spaces pass.
    expect(categoryInputSchema.safeParse({ name: ` ${'n'.repeat(60)} ` }).success).toBe(true);
    expect(issueOf({ name: 'n'.repeat(61) }, categoryInputSchema)).toBe('title_too_long');
    // Code points, not UTF-16 units: 60 emoji are 60 characters here (P15).
    expect(categoryInputSchema.safeParse({ name: '😀'.repeat(60) }).success).toBe(true);
    expect(issueOf({ name: '😀'.repeat(61) }, categoryInputSchema)).toBe('title_too_long');
    expect(issueOf({ name: 'x', coverAssetId: 'nope' }, categoryInputSchema)).toBe('cover_invalid');
    expect(categoryInputSchema.safeParse({ name: 'x', coverAssetId: id(1) }).success).toBe(true);
    expect(categoryInputSchema.safeParse({ name: 'x', icon: 'star' }).success).toBe(false);
    expect(issueOf({ name: 'x', icon: 'star' }, categoryInputSchema)).toBeUndefined();

    expect(issueOf({}, categoryPatchSchema)).toBe('patch_empty');
    expect(categoryPatchSchema.parse({ name: 'Novo' })).toEqual({ name: 'Novo' });
    expect(categoryPatchSchema.parse({ coverAssetId: null })).toEqual({ coverAssetId: null });
    expect(issueOf({ name: '' }, categoryPatchSchema)).toBe('title_required');
    expect(categoryPatchSchema.safeParse({ name: 'x', icon: 'star' }).success).toBe(false);

    const category = { id: id(1), name: 'Lábios', coverAssetId: null, courseCount: 0 };
    expect(categorySchema.safeParse(category).success).toBe(true);
    expect(categorySchema.safeParse({ ...category, courseCount: -1 }).success).toBe(false);
    expect(categorySchema.safeParse({ ...category, extra: 1 }).success).toBe(false);
    expect(categoryListSchema.safeParse({ items: [category] }).success).toBe(true);
    expect(categoryListSchema.safeParse({ items: [category], nextCursor: null }).success).toBe(
      false,
    );
  });

  it('list query (08.3-04, COURSE-02, T-08.3-19): filter defaults to all, limit 1..50 defaulting to 20, a 513-char cursor fails, an unknown key fails', () => {
    expect(COURSE_FILTERS).toEqual(['all', 'draft', 'published', 'archived']);
    expect(COURSE_PAGE_SIZE).toBe(20);
    expect(COURSE_MAX_PAGE_SIZE).toBe(50);
    expect(COURSE_MAX_CURSOR_LENGTH).toBe(512);
    expect(courseListQuerySchema.parse({})).toEqual({ filter: 'all', limit: 20 });
    for (const filter of COURSE_FILTERS) {
      expect(courseListQuerySchema.safeParse({ filter }).success).toBe(true);
    }
    expect(courseListQuerySchema.safeParse({ filter: 'rascunho' }).success).toBe(false);
    expect(courseListQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(courseListQuerySchema.parse({ limit: '1' }).limit).toBe(1);
    expect(courseListQuerySchema.parse({ limit: '50' }).limit).toBe(50);
    expect(courseListQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(courseListQuerySchema.safeParse({ limit: '1.5' }).success).toBe(false);
    expect(courseListQuerySchema.safeParse({ cursor: 'c'.repeat(512) }).success).toBe(true);
    expect(courseListQuerySchema.safeParse({ cursor: 'c'.repeat(513) }).success).toBe(false);
    expect(courseListQuerySchema.safeParse({ sort: 'asc' }).success).toBe(false);
  });

  it('P08: caps are measured in code points on the trimmed string — a 120-code-point title with 10 emoji passes, 121 fails', () => {
    const emojiTitle = `${'😀'.repeat(10)}${'x'.repeat(110)}`;
    expect([...emojiTitle].length).toBe(120);
    expect(emojiTitle.length).toBe(130); // UTF-16 units: the browser's stricter count
    expect(courseInputSchema.safeParse({ ...base, title: emojiTitle }).success).toBe(true);
    expect(courseInputSchema.safeParse({ ...base, title: `  ${emojiTitle}  ` }).success).toBe(true);
    expect(issueOf({ ...base, title: `${emojiTitle}x` })).toBe('title_too_long');
    expect(issueOf({ title: `${emojiTitle}x` }, coursePatchSchema)).toBe('title_too_long');
  });

  it('the course row and page are strict', () => {
    const row = {
      id: id(1),
      title: 'Curso',
      status: 'draft',
      coverAssetId: null,
      categoryName: null,
      level: null,
      moduleCount: 0,
      lessonCount: 0,
      durationSeconds: 0,
      hasUnreadyVideo: false,
      createdAt: '2026-10-13T12:00:00.000000Z',
      publishedAt: null,
    };
    expect(courseRowSchema.safeParse(row).success).toBe(true);
    expect(
      courseRowSchema.safeParse({
        ...row,
        status: 'published',
        categoryName: 'Lábios',
        level: 'iniciante',
        publishedAt: '2026-10-13T12:00:00.000000Z',
      }).success,
    ).toBe(true);
    expect(courseRowSchema.safeParse({ ...row, status: 'live' }).success).toBe(false);
    expect(courseRowSchema.safeParse({ ...row, extra: 1 }).success).toBe(false);
    const { hasUnreadyVideo: _dropped, ...withoutFlag } = row;
    expect(courseRowSchema.safeParse(withoutFlag).success).toBe(false);
    expect(coursePageSchema.safeParse({ items: [row], nextCursor: null }).success).toBe(true);
    expect(coursePageSchema.safeParse({ items: [row] }).success).toBe(false);
  });

  it('the views are strict: a lesson view, a module view and a course detail round-trip', () => {
    const lesson = {
      id: id(1),
      moduleId: id(2),
      title: 'Aula',
      description: '',
      position: 1,
      isFree: false,
      videoAssetId: id(3),
      videoStatus: 'ready',
      durationSeconds: 600,
    };
    expect(lessonViewSchema.safeParse(lesson).success).toBe(true);
    expect(lessonViewSchema.safeParse({ ...lesson, videoStatus: 'rejected' }).success).toBe(false);
    const module = {
      id: id(2),
      title: 'Módulo',
      summary: '',
      position: 1,
      requiresPrevious: false,
      lessonCount: 1,
      durationSeconds: 600,
      lessons: [lesson],
    };
    expect(moduleViewSchema.safeParse(module).success).toBe(true);
    const detail = {
      id: id(4),
      title: 'Curso',
      tagline: '',
      description: '',
      category: null,
      level: null,
      coverAssetId: null,
      instructorName: 'Ana',
      instructorPhotoAssetId: null,
      outcomes: [],
      certificateHours: null,
      status: 'draft',
      publishedAt: null,
      archivedAt: null,
      createdAt: '2026-10-13T12:00:00.000000Z',
      products: [{ id: id(5), name: 'Produto', status: 'active' }],
      modules: [module],
      moduleCount: 1,
      lessonCount: 1,
      durationSeconds: 600,
      hasUnreadyVideo: false,
      unreadyLessonIds: [],
    };
    expect(courseDetailSchema.safeParse(detail).success).toBe(true);
    expect(courseDetailSchema.safeParse({ ...detail, extra: 1 }).success).toBe(false);
  });

  it('reorder (08.3-05, D-414, P18, P25): 0 ids fail, 1 passes, 200 pass, 201 fail, a duplicate fails as plain input (no courses code), an unknown key fails; the module and lesson bodies are the factory at COURSE_MAX_ORDER', () => {
    expect(COURSE_MAX_ORDER).toBe(200);
    const ids = (n: number) => Array.from({ length: n }, (_, i) => id(i + 1));
    for (const schema of [reorderModulesSchema, reorderLessonsSchema, reorderIdsSchema(200)]) {
      expect(schema.safeParse({ ids: [] }).success).toBe(false);
      expect(schema.safeParse({ ids: ids(1) }).success).toBe(true);
      expect(schema.safeParse({ ids: ids(200) }).success).toBe(true);
      expect(schema.safeParse({ ids: ids(201) }).success).toBe(false);
      // The same id twice, and the same id in two spellings, are one id named twice.
      expect(schema.safeParse({ ids: [id(1), id(1)] }).success).toBe(false);
      const dup = schema.safeParse({ ids: [id(1), id(1).toUpperCase()] });
      expect(dup.success).toBe(false);
      expect(issueOf({ ids: [id(1), id(1)] }, schema)).toBeUndefined();
      expect(schema.safeParse({ ids: ['not-a-uuid'] }).success).toBe(false);
      expect(schema.safeParse({ ids: ids(1), extra: 1 }).success).toBe(false);
      expect(schema.safeParse({}).success).toBe(false);
    }
    expect(reorderIdsSchema(2).safeParse({ ids: ids(3) }).success).toBe(false);
    expect(reorderIdsSchema(2).safeParse({ ids: ids(2) }).success).toBe(true);
  });

  it('lesson detail (08.3-05, COURSE-06, D-409, PR-6): the view plus materials, module and course round-trips strictly; the lesson INPUT carries no url and no typed duration', () => {
    const material = {
      id: id(7),
      assetId: id(8),
      filename: 'planilha de doses.xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      kind: 'sheet',
      bytes: 2048,
      position: 1,
    };
    expect(materialSchema.safeParse(material).success).toBe(true);
    expect(materialSchema.safeParse({ ...material, kind: 'file' }).success).toBe(false);
    expect(materialSchema.safeParse({ ...material, position: 0 }).success).toBe(false);
    expect(materialSchema.safeParse({ ...material, extra: 1 }).success).toBe(false);
    const detail = {
      id: id(1),
      moduleId: id(2),
      title: 'Aula',
      description: '',
      position: 1,
      isFree: true,
      videoAssetId: id(3),
      videoStatus: 'pending',
      durationSeconds: null,
      materials: [material],
      module: { id: id(2), title: 'Módulo', position: 1 },
      course: { id: id(4), title: 'Curso', status: 'draft', hasProducts: true },
    };
    expect(lessonDetailSchema.safeParse(detail).success).toBe(true);
    expect(lessonDetailSchema.safeParse({ ...detail, materials: [] }).success).toBe(true);
    expect(lessonDetailSchema.safeParse({ ...detail, extra: 1 }).success).toBe(false);
    expect(
      lessonDetailSchema.safeParse({ ...detail, module: { ...detail.module, extra: 1 } }).success,
    ).toBe(false);
    const { course: _course, ...withoutCourse } = detail;
    expect(lessonDetailSchema.safeParse(withoutCourse).success).toBe(false);
    // PR-6: nothing about the video is typed — a url or a duration in the input is an unknown key.
    for (const schema of [lessonInputSchema, lessonPatchSchema]) {
      expect(schema.safeParse({ title: 'Aula', videoUrl: 'https://youtu.be/x' }).success).toBe(
        false,
      );
      expect(schema.safeParse({ title: 'Aula', durationSeconds: 600 }).success).toBe(false);
      expect(schema.safeParse({ title: 'Aula', videoStatus: 'ready' }).success).toBe(false);
    }
  });

  it('materials body (08.3-05, D-410, P24, P25, P26): 0 and 10 ids pass, 11 fail too_many_materials, a duplicate fails as plain input, a non-uuid is material_invalid, an unknown key fails; the url answer is strict and the TTL is 600 s', () => {
    expect(LESSON_MAX_MATERIALS).toBe(10);
    expect(MATERIAL_URL_TTL_SECONDS).toBe(600);
    const ids = (n: number) => Array.from({ length: n }, (_, i) => id(i + 1));
    expect(materialsBodySchema.safeParse({ assetIds: [] }).success).toBe(true);
    expect(materialsBodySchema.safeParse({ assetIds: ids(1) }).success).toBe(true);
    expect(materialsBodySchema.safeParse({ assetIds: ids(10) }).success).toBe(true);
    expect(issueOf({ assetIds: ids(11) }, materialsBodySchema)).toBe('too_many_materials');
    expect(materialsBodySchema.safeParse({ assetIds: [id(1), id(1)] }).success).toBe(false);
    expect(issueOf({ assetIds: [id(1), id(1)] }, materialsBodySchema)).toBeUndefined();
    expect(materialsBodySchema.safeParse({ assetIds: [id(1), id(1).toUpperCase()] }).success).toBe(
      false,
    );
    expect(issueOf({ assetIds: ['x'] }, materialsBodySchema)).toBe('material_invalid');
    expect(materialsBodySchema.safeParse({ assetIds: ids(1), extra: 1 }).success).toBe(false);
    expect(materialsBodySchema.safeParse({}).success).toBe(false);
    expect(materialsBodySchema.safeParse({ ids: ids(1) }).success).toBe(false);
    const answer = { url: 'https://storage/x?token=abc', expiresAt: '2026-10-13T12:10:00.000Z' };
    expect(materialUrlSchema.safeParse(answer).success).toBe(true);
    expect(materialUrlSchema.safeParse({ ...answer, token: 'abc' }).success).toBe(false);
    expect(materialUrlSchema.safeParse({ url: answer.url }).success).toBe(false);
  });

  it('materialKind (08.3-05, D-410, P27): the eight accepted mimes map to pdf / sheet / slides / image, anything else is other', () => {
    expect(MATERIAL_KINDS).toEqual(['pdf', 'sheet', 'slides', 'image', 'other']);
    expect(materialKind('application/pdf')).toBe('pdf');
    expect(materialKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(
      'sheet',
    );
    expect(materialKind('application/vnd.ms-excel')).toBe('sheet');
    expect(
      materialKind('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
    ).toBe('slides');
    expect(materialKind('application/vnd.ms-powerpoint')).toBe('slides');
    expect(materialKind('image/jpeg')).toBe('image');
    expect(materialKind('image/png')).toBe('image');
    expect(materialKind('image/webp')).toBe('image');
    expect(materialKind('image/gif')).toBe('image');
    expect(materialKind('application/msword')).toBe('other');
    expect(materialKind('')).toBe('other');
  });

  it('the module list and the lesson list are strict', () => {
    const lesson = {
      id: id(1),
      moduleId: id(2),
      title: 'Aula',
      description: '',
      position: 1,
      isFree: false,
      videoAssetId: null,
      videoStatus: 'none',
      durationSeconds: null,
    };
    const module = {
      id: id(2),
      title: 'Módulo',
      summary: '',
      position: 1,
      requiresPrevious: false,
      lessonCount: 1,
      durationSeconds: 0,
      lessons: [lesson],
    };
    expect(moduleListSchema.safeParse({ items: [module] }).success).toBe(true);
    expect(moduleListSchema.safeParse({ items: [] }).success).toBe(true);
    expect(moduleListSchema.safeParse({ items: [module], extra: 1 }).success).toBe(false);
    expect(moduleListSchema.safeParse({}).success).toBe(false);
    expect(lessonListSchema.safeParse({ items: [lesson] }).success).toBe(true);
    expect(lessonListSchema.safeParse({ items: [lesson], extra: 1 }).success).toBe(false);
  });
});
