import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  CATEGORY_MAX_NAME,
  COURSE_ISSUE_SET,
  COURSE_ISSUES,
  COURSE_LEVELS,
  COURSE_MAX_DESCRIPTION,
  COURSE_MAX_HOURS,
  COURSE_MAX_OUTCOME,
  COURSE_MAX_OUTCOMES,
  COURSE_MAX_PRODUCTS,
  COURSE_MAX_TAGLINE,
  COURSE_MAX_TITLE,
  COURSE_PERMISSIONS,
  COURSE_STATUSES,
  categoryInputSchema,
  categoryListSchema,
  categoryPatchSchema,
  categorySchema,
  courseDetailSchema,
  courseInputSchema,
  coursePatchSchema,
  courseStatusBodySchema,
  LESSON_MAX_DESCRIPTION,
  LESSON_MAX_TITLE,
  lessonInputSchema,
  lessonPatchSchema,
  lessonViewSchema,
  MODULE_MAX_SUMMARY,
  MODULE_MAX_TITLE,
  moduleInputSchema,
  modulePatchSchema,
  moduleViewSchema,
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
});
