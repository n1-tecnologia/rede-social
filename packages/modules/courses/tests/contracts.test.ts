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
  LESSON_COMPLETION_RATIO,
  LESSON_LOCK_REASONS,
  LESSON_MAX_DESCRIPTION,
  LESSON_MAX_MATERIALS,
  LESSON_MAX_TITLE,
  LESSON_PICKER_MAX,
  LIVE_FILTERS,
  LIVE_MAX_DESCRIPTION,
  LIVE_MAX_DURATION,
  LIVE_MAX_TITLE,
  LIVE_MAX_URL,
  LIVE_MIN_DURATION,
  LIVE_STATUSES,
  learnCourseSchema,
  learnLessonSchema,
  learnMaterialSchema,
  learnNeighbourSchema,
  learnOutlineLessonSchema,
  learnOutlineModuleSchema,
  learnProgressSchema,
  lessonDetailSchema,
  lessonInputSchema,
  lessonListSchema,
  lessonPatchSchema,
  lessonPickerListSchema,
  lessonViewSchema,
  liveDetailSchema,
  liveInputSchema,
  liveListQuerySchema,
  livePageSchema,
  livePatchSchema,
  liveRowSchema,
  liveStatusAt,
  MATERIAL_KINDS,
  MATERIAL_URL_TTL_SECONDS,
  MODULE_LOCK_REASONS,
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
  PROGRESS_MAX_POSITION_SECONDS,
  progressBodySchema,
  progressResultSchema,
  reorderIdsSchema,
  reorderLessonsSchema,
  reorderModulesSchema,
  reorderTrackCoursesSchema,
  TRACK_FILTERS,
  TRACK_MAX_AUDIENCE,
  TRACK_MAX_DESCRIPTION,
  TRACK_MAX_SUBTITLE,
  TRACK_MAX_TITLE,
  TRACK_STATUSES,
  trackDetailSchema,
  trackInputSchema,
  trackListQuerySchema,
  trackPageSchema,
  trackPatchSchema,
  trackRowSchema,
  trackStatusBodySchema,
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

  it('the old product link key is an unknown key on create and patch (strict, D-418: only the product form links)', () => {
    expect(COURSE_ISSUES).not.toContain('product_invalid' as never);
    expect(COURSE_ISSUES).not.toContain('too_many_products' as never);
    expect(courseInputSchema.safeParse({ ...base, productIds: [id(1)] }).success).toBe(false);
    expect(courseInputSchema.safeParse({ ...base, productIds: [] }).success).toBe(false);
    expect(coursePatchSchema.safeParse({ productIds: [id(1)] }).success).toBe(false);
    expect(coursePatchSchema.safeParse({ title: 'Novo', productIds: [] }).success).toBe(false);
    expect('productIds' in courseInputSchema.parse(base)).toBe(false);
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
    expect(parsed).toEqual({
      title: 'Aula 1',
      description: '',
      videoAssetId: null,
      isFree: false,
      requiresPrevious: false,
    });
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

  it('08.5 D-428: requiresPrevious defaults false on create, is optional on patch, and a patch with only requiresPrevious is valid', () => {
    expect(lessonInputSchema.parse({ title: 'x' }).requiresPrevious).toBe(false);
    expect(lessonInputSchema.parse({ title: 'x', requiresPrevious: true }).requiresPrevious).toBe(
      true,
    );
    expect(lessonInputSchema.safeParse({ title: 'x', requiresPrevious: 'yes' }).success).toBe(
      false,
    );
    expect(lessonPatchSchema.parse({ title: 'x' })).toEqual({ title: 'x' });
    expect(lessonPatchSchema.parse({ requiresPrevious: true })).toEqual({ requiresPrevious: true });
    expect(lessonPatchSchema.parse({ requiresPrevious: false })).toEqual({
      requiresPrevious: false,
    });
    expect(lessonPatchSchema.safeParse({ requiresPrevious: null }).success).toBe(false);
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
      requiresPrevious: false,
      videoAssetId: id(3),
      videoStatus: 'ready',
      durationSeconds: 600,
    };
    expect(lessonViewSchema.safeParse(lesson).success).toBe(true);
    expect(lessonViewSchema.safeParse({ ...lesson, videoStatus: 'rejected' }).success).toBe(false);
    // 08.5 D-428: the stored rule is part of the view; a view without it fails (strict and required).
    const withoutRule = Object.fromEntries(
      Object.entries(lesson).filter(([key]) => key !== 'requiresPrevious'),
    );
    expect(lessonViewSchema.safeParse(withoutRule).success).toBe(false);
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

  it('tracks (08.3-10, D-415, COURSE-10): the input caps — title 1..120, subtitle ≤ 160 and audience ≤ 60 default empty, description ≤ 2000, cover null or uuid; an unknown key fails; the patch needs one key and re-applies no default; the status body takes the two values only', () => {
    expect(TRACK_STATUSES).toEqual(['active', 'archived']);
    expect(TRACK_FILTERS).toEqual(['active', 'archived']);
    expect([
      TRACK_MAX_TITLE,
      TRACK_MAX_SUBTITLE,
      TRACK_MAX_AUDIENCE,
      TRACK_MAX_DESCRIPTION,
    ]).toEqual([120, 160, 60, 2000]);
    const minimal = trackInputSchema.parse({ title: '  Do zero  ' });
    expect(minimal).toEqual({
      title: 'Do zero',
      subtitle: '',
      audience: '',
      description: '',
      coverAssetId: null,
    });
    expect(issueOf({ title: '   ' }, trackInputSchema)).toBe('title_required');
    expect(issueOf({ title: 'x'.repeat(121) }, trackInputSchema)).toBe('title_too_long');
    expect(trackInputSchema.safeParse({ title: 'x'.repeat(120) }).success).toBe(true);
    expect(trackInputSchema.safeParse({ title: 'x', subtitle: 'y'.repeat(160) }).success).toBe(
      true,
    );
    expect(issueOf({ title: 'x', subtitle: 'y'.repeat(161) }, trackInputSchema)).toBe(
      'tagline_too_long',
    );
    expect(trackInputSchema.safeParse({ title: 'x', audience: 'y'.repeat(60) }).success).toBe(true);
    expect(issueOf({ title: 'x', audience: 'y'.repeat(61) }, trackInputSchema)).toBe(
      'tagline_too_long',
    );
    expect(trackInputSchema.safeParse({ title: 'x', description: 'y'.repeat(2000) }).success).toBe(
      true,
    );
    expect(issueOf({ title: 'x', description: 'y'.repeat(2001) }, trackInputSchema)).toBe(
      'description_too_long',
    );
    expect(issueOf({ title: 'x', coverAssetId: 'nope' }, trackInputSchema)).toBe('cover_invalid');
    expect(trackInputSchema.safeParse({ title: 'x', coverAssetId: id(1) }).success).toBe(true);
    // The course list never rides the create body (one write path, PUT …/order).
    expect(trackInputSchema.safeParse({ title: 'x', courseIds: [id(1)] }).success).toBe(false);
    expect(trackInputSchema.safeParse({ title: 'x', hours: 10 }).success).toBe(false);

    expect(issueOf({}, trackPatchSchema)).toBe('patch_empty');
    expect(trackPatchSchema.parse({ audience: ' Para quem começa ' })).toEqual({
      audience: 'Para quem começa',
    });
    expect(trackPatchSchema.parse({ coverAssetId: null })).toEqual({ coverAssetId: null });
    expect(issueOf({ title: '' }, trackPatchSchema)).toBe('title_required');
    expect(trackPatchSchema.safeParse({ courseIds: [] }).success).toBe(false);

    for (const status of TRACK_STATUSES) {
      expect(trackStatusBodySchema.safeParse({ status }).success).toBe(true);
    }
    expect(trackStatusBodySchema.safeParse({ status: 'draft' }).success).toBe(false);
    expect(trackStatusBodySchema.safeParse({ status: 'active', force: true }).success).toBe(false);
  });

  it('tracks (08.3-10): the list query defaults to filter=active and limit 20, refuses a third filter, a bad limit, a long cursor and an unknown key; the row, the page and the detail are strict', () => {
    expect(trackListQuerySchema.parse({})).toEqual({ filter: 'active', limit: 20 });
    expect(trackListQuerySchema.parse({ filter: 'archived', limit: '50' })).toEqual({
      filter: 'archived',
      limit: 50,
    });
    expect(trackListQuerySchema.safeParse({ filter: 'all' }).success).toBe(false);
    expect(trackListQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(trackListQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(trackListQuerySchema.safeParse({ cursor: 'c'.repeat(513) }).success).toBe(false);
    expect(trackListQuerySchema.safeParse({ status: 'active' }).success).toBe(false);

    const row = {
      id: id(1),
      title: 'Do zero ao primeiro atendimento',
      coverAssetId: null,
      status: 'active',
      courseCount: 3,
      createdAt: '2026-10-13T12:00:00.000000Z',
    };
    expect(trackRowSchema.safeParse(row).success).toBe(true);
    expect(trackRowSchema.safeParse({ ...row, courseCount: -1 }).success).toBe(false);
    expect(trackRowSchema.safeParse({ ...row, extra: 1 }).success).toBe(false);
    expect(trackPageSchema.safeParse({ items: [row], nextCursor: null }).success).toBe(true);
    expect(trackPageSchema.safeParse({ items: [row] }).success).toBe(false);

    const detail = {
      id: id(1),
      title: 'Do zero',
      subtitle: '',
      audience: 'Para quem está começando',
      description: '',
      coverAssetId: id(9),
      status: 'archived',
      archivedAt: '2026-10-13T12:00:00.000000Z',
      createdAt: '2026-10-13T11:00:00.000000Z',
      courses: [
        { id: id(2), title: 'A', status: 'published', coverAssetId: null, position: 1 },
        { id: id(3), title: 'B', status: 'draft', coverAssetId: id(8), position: 2 },
      ],
      courseCount: 1,
    };
    expect(trackDetailSchema.parse(detail)).toEqual(detail);
    // PR-11: a track carries no lessons, no hours and no certificate of its own.
    for (const key of ['lessons', 'certificateHours', 'durationSeconds', 'modules']) {
      expect(trackDetailSchema.safeParse({ ...detail, [key]: [] }).success).toBe(false);
    }
    expect(trackDetailSchema.safeParse({ ...detail, status: 'draft' }).success).toBe(false);
    expect(
      trackDetailSchema.safeParse({
        ...detail,
        courses: [{ ...detail.courses[0], position: 0 }],
      }).success,
    ).toBe(false);
  });

  it('tracks order body (08.3-10, D-414, P39, P40): [] is VALID (it clears the membership), 200 pass and 201 fail, a duplicate in one or two spellings fails as plain input, a non-uuid is course_invalid by name, an unknown key fails', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => id(i + 1));
    expect(reorderTrackCoursesSchema.parse({ ids: [] })).toEqual({ ids: [] });
    expect(reorderTrackCoursesSchema.safeParse({ ids: ids(1) }).success).toBe(true);
    expect(reorderTrackCoursesSchema.safeParse({ ids: ids(200) }).success).toBe(true);
    expect(reorderTrackCoursesSchema.safeParse({ ids: ids(201) }).success).toBe(false);
    expect(reorderTrackCoursesSchema.safeParse({ ids: [id(1), id(1)] }).success).toBe(false);
    expect(issueOf({ ids: [id(1), id(1)] }, reorderTrackCoursesSchema)).toBeUndefined();
    expect(reorderTrackCoursesSchema.safeParse({ ids: [id(1), id(1).toUpperCase()] }).success).toBe(
      false,
    );
    expect(issueOf({ ids: ['not-a-uuid'] }, reorderTrackCoursesSchema)).toBe('course_invalid');
    expect(reorderTrackCoursesSchema.safeParse({ ids: ids(1), extra: 1 }).success).toBe(false);
    expect(reorderTrackCoursesSchema.safeParse({}).success).toBe(false);
    // The module and lesson bodies still refuse [] — there the list is a permutation, not a set.
    expect(reorderIdsSchema(200).safeParse({ ids: [] }).success).toBe(false);
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
      requiresPrevious: false,
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
      requiresPrevious: false,
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

  it('liveStatusAt (08.3-11, D-416, COURSE-11, RESEARCH Pattern 8): the clock decides — scheduled before the start, live AT the start and during, recorded AT the end and after; cancelledAt wins over every instant; the status vocabulary and the two filters are closed', () => {
    expect(LIVE_STATUSES).toEqual(['scheduled', 'live', 'recorded', 'cancelled']);
    expect(LIVE_FILTERS).toEqual(['upcoming', 'past']);
    expect([LIVE_MAX_TITLE, LIVE_MAX_DESCRIPTION, LIVE_MIN_DURATION, LIVE_MAX_DURATION]).toEqual([
      120, 2000, 5, 600,
    ]);
    const start = new Date('2026-10-16T22:00:00.000Z');
    const live = { startsAt: start.toISOString(), durationMin: 60, cancelledAt: null };
    const at = (ms: number) => new Date(start.getTime() + ms);
    // The six instants: well before, one millisecond before, AT the start, mid-way, AT the end, after.
    expect(liveStatusAt(live, at(-86_400_000))).toBe('scheduled');
    expect(liveStatusAt(live, at(-1))).toBe('scheduled');
    expect(liveStatusAt(live, at(0))).toBe('live');
    expect(liveStatusAt(live, at(30 * 60_000))).toBe('live');
    expect(liveStatusAt(live, at(60 * 60_000 - 1))).toBe('live');
    expect(liveStatusAt(live, at(60 * 60_000))).toBe('recorded');
    expect(liveStatusAt(live, at(7 * 86_400_000))).toBe('recorded');
    // Cancelled wins before, during and after; a Date input reads the same as a string.
    const cancelled = { ...live, cancelledAt: '2026-10-10T10:00:00.000Z' };
    expect(liveStatusAt(cancelled, at(-86_400_000))).toBe('cancelled');
    expect(liveStatusAt(cancelled, at(30 * 60_000))).toBe('cancelled');
    expect(liveStatusAt(cancelled, at(7 * 86_400_000))).toBe('cancelled');
    expect(liveStatusAt({ ...live, startsAt: start }, at(1))).toBe('live');
    // The duration is what separates live from recorded: 5 minutes ends at +5 min, 600 at +10 h.
    expect(liveStatusAt({ ...live, durationMin: 5 }, at(5 * 60_000 - 1))).toBe('live');
    expect(liveStatusAt({ ...live, durationMin: 5 }, at(5 * 60_000))).toBe('recorded');
    expect(liveStatusAt({ ...live, durationMin: 600 }, at(600 * 60_000 - 1))).toBe('live');
  });

  it('live input (08.3-11, D-416, T-08.3-11): title 1..120, description ≤ 2000 default empty, cover null or uuid, startsAt an ISO instant with offset (start_required otherwise), durationMin an integer 5..600 (duration_invalid for 4, 601 and 5.5), externalUrl https only (url_invalid for http, javascript, ftp, a bare host and over 2048); the old product link key, an unknown key and a replay on create fail', () => {
    const minimal = liveInputSchema.parse({
      title: '  Tira-dúvidas  ',
      startsAt: '2026-10-16T19:00:00-03:00',
      durationMin: 60,
      externalUrl: 'https://youtu.be/abc',
    });
    expect(minimal).toEqual({
      title: 'Tira-dúvidas',
      description: '',
      coverAssetId: null,
      startsAt: '2026-10-16T19:00:00-03:00',
      durationMin: 60,
      externalUrl: 'https://youtu.be/abc',
    });
    const ok = {
      title: 'x',
      startsAt: '2026-10-16T22:00:00Z',
      durationMin: 60,
      externalUrl: 'https://a.b',
    };
    expect(issueOf({ ...ok, title: '   ' }, liveInputSchema)).toBe('title_required');
    expect(issueOf({ ...ok, title: 'x'.repeat(121) }, liveInputSchema)).toBe('title_too_long');
    expect(liveInputSchema.safeParse({ ...ok, title: 'x'.repeat(120) }).success).toBe(true);
    expect(liveInputSchema.safeParse({ ...ok, description: 'y'.repeat(2000) }).success).toBe(true);
    expect(issueOf({ ...ok, description: 'y'.repeat(2001) }, liveInputSchema)).toBe(
      'description_too_long',
    );
    expect(issueOf({ ...ok, coverAssetId: 'nope' }, liveInputSchema)).toBe('cover_invalid');
    expect(liveInputSchema.safeParse({ ...ok, coverAssetId: id(1) }).success).toBe(true);
    // startsAt: an instant with its offset; a date alone, a local time, an empty string and an
    // impossible day are start_required; a start in the past is accepted (A-UI-5).
    for (const startsAt of [
      '2026-10-16',
      '2026-10-16T19:00',
      '',
      '2026-02-30T10:00:00Z',
      'amanhã',
    ]) {
      expect(issueOf({ ...ok, startsAt }, liveInputSchema)).toBe('start_required');
    }
    expect(
      issueOf({ title: 'x', durationMin: 60, externalUrl: 'https://a.b' }, liveInputSchema),
    ).toBe('start_required');
    for (const startsAt of [
      '2026-10-16T19:00:00-03:00',
      '2026-10-16T22:00:00Z',
      '2026-10-16T22:00:00.000Z',
      '2000-01-01T00:00:00Z',
    ]) {
      expect(liveInputSchema.safeParse({ ...ok, startsAt }).success).toBe(true);
    }
    // durationMin: the two bounds inclusive, integers only.
    for (const durationMin of [4, 601, 5.5, 0, -10]) {
      expect(issueOf({ ...ok, durationMin }, liveInputSchema)).toBe('duration_invalid');
    }
    for (const durationMin of [5, 60, 600]) {
      expect(liveInputSchema.safeParse({ ...ok, durationMin }).success).toBe(true);
    }
    expect(liveInputSchema.safeParse({ ...ok, durationMin: '60' }).success).toBe(false);
    // externalUrl: https only (T-08.3-11).
    for (const externalUrl of [
      'http://youtu.be/abc',
      'javascript:alert(1)',
      'ftp://files.example.com/live',
      'youtube.com/live',
      'https://',
      '',
      `https://example.com/${'a'.repeat(LIVE_MAX_URL)}`,
    ]) {
      expect(issueOf({ ...ok, externalUrl }, liveInputSchema)).toBe('url_invalid');
    }
    for (const externalUrl of [
      'https://www.youtube.com/watch?v=abc',
      'https://meet.google.com/abc-defg-hij',
      'https://zoom.us/j/123?pwd=x',
      'HTTPS://EXAMPLE.COM/x',
    ]) {
      expect(liveInputSchema.safeParse({ ...ok, externalUrl }).success).toBe(true);
    }
    // The old product link key is an unknown key (strict, D-418: only the product form links).
    expect(liveInputSchema.safeParse({ ...ok, productIds: [id(1)] }).success).toBe(false);
    expect(liveInputSchema.safeParse({ ...ok, productIds: [] }).success).toBe(false);
    // No stored state, no replay on create, no unknown key (D-416, A5).
    expect(liveInputSchema.safeParse({ ...ok, status: 'scheduled' }).success).toBe(false);
    expect(liveInputSchema.safeParse({ ...ok, replayLessonId: id(1) }).success).toBe(false);
    expect(liveInputSchema.safeParse({ ...ok, cancelledAt: null }).success).toBe(false);
  });

  it('live patch, list query, row, page and detail (08.3-11): the patch needs one key, re-applies no default and takes replayLessonId alone (null clears; a non-uuid is lesson_invalid); the query defaults to filter=upcoming and limit 20 and refuses a third filter; the row, the page, the detail and the picker list are strict and status is one of the four', () => {
    expect(issueOf({}, livePatchSchema)).toBe('patch_empty');
    expect(livePatchSchema.parse({ replayLessonId: id(7) })).toEqual({ replayLessonId: id(7) });
    expect(livePatchSchema.parse({ replayLessonId: null })).toEqual({ replayLessonId: null });
    expect(issueOf({ replayLessonId: 'nope' }, livePatchSchema)).toBe('lesson_invalid');
    expect(livePatchSchema.parse({ title: ' Nova ' })).toEqual({ title: 'Nova' });
    expect(livePatchSchema.parse({ coverAssetId: null })).toEqual({ coverAssetId: null });
    expect(livePatchSchema.safeParse({ productIds: [id(1)] }).success).toBe(false);
    expect(livePatchSchema.safeParse({ title: 'x', productIds: [] }).success).toBe(false);
    expect(issueOf({ externalUrl: 'http://a.b' }, livePatchSchema)).toBe('url_invalid');
    expect(issueOf({ durationMin: 601 }, livePatchSchema)).toBe('duration_invalid');
    expect(issueOf({ startsAt: '2026-10-16' }, livePatchSchema)).toBe('start_required');
    expect(livePatchSchema.safeParse({ cancelledAt: null }).success).toBe(false);
    expect(livePatchSchema.safeParse({ status: 'cancelled' }).success).toBe(false);

    expect(liveListQuerySchema.parse({})).toEqual({ filter: 'upcoming', limit: 20 });
    expect(liveListQuerySchema.parse({ filter: 'past', limit: '50' })).toEqual({
      filter: 'past',
      limit: 50,
    });
    for (const query of [
      { filter: 'all' },
      { filter: 'cancelled' },
      { limit: '0' },
      { limit: '51' },
      { cursor: 'c'.repeat(513) },
      { status: 'live' },
    ]) {
      expect(liveListQuerySchema.safeParse(query).success).toBe(false);
    }

    const row = {
      id: id(1),
      title: 'Tira-dúvidas',
      coverAssetId: null,
      startsAt: '2026-10-16T22:00:00.000000Z',
      durationMin: 60,
      status: 'scheduled',
    };
    for (const status of LIVE_STATUSES) {
      expect(liveRowSchema.safeParse({ ...row, status }).success).toBe(true);
    }
    expect(liveRowSchema.safeParse({ ...row, status: 'ended' }).success).toBe(false);
    expect(liveRowSchema.safeParse({ ...row, cancelledAt: null }).success).toBe(false);
    expect(livePageSchema.safeParse({ items: [row], nextCursor: null }).success).toBe(true);
    expect(livePageSchema.safeParse({ items: [row] }).success).toBe(false);

    const detail = {
      ...row,
      description: '',
      externalUrl: 'https://youtu.be/abc',
      cancelledAt: null,
      products: [{ id: id(2), name: 'Plano', status: 'active' }],
      replayLesson: null,
      createdAt: '2026-10-01T10:00:00.000000Z',
    };
    expect(liveDetailSchema.safeParse(detail).success).toBe(true);
    expect(
      liveDetailSchema.safeParse({
        ...detail,
        status: 'recorded',
        replayLesson: { id: id(3), title: 'Aula 1', courseTitle: 'Curso' },
      }).success,
    ).toBe(true);
    expect(liveDetailSchema.safeParse({ ...detail, replayLesson: { id: id(3) } }).success).toBe(
      false,
    );
    // No stored state and nothing that streams: no `streamUrl`, no `isLive` flag (D-416).
    expect(liveDetailSchema.safeParse({ ...detail, isLive: true }).success).toBe(false);
    expect(liveDetailSchema.safeParse({ ...detail, streamUrl: 'x' }).success).toBe(false);

    expect(LESSON_PICKER_MAX).toBe(200);
    const item = {
      id: id(4),
      title: 'Aula',
      courseId: id(5),
      courseTitle: 'Curso',
      videoStatus: 'ready',
    };
    expect(lessonPickerListSchema.safeParse({ items: [item] }).success).toBe(true);
    expect(lessonPickerListSchema.safeParse({ items: [] }).success).toBe(true);
    expect(lessonPickerListSchema.safeParse({ items: [{ ...item, position: 1 }] }).success).toBe(
      false,
    );
  });
});

describe('courses member contracts (08.5-01, D-423, D-428, D-430, COURSE-18)', () => {
  const lockedLesson = {
    id: id(10),
    title: 'Aula "Ação" 🎓',
    position: 2,
    number: 2,
    durationSeconds: 600,
    hasVideo: true,
    isFree: false,
    requiresPrevious: false,
    lockReason: 'purchase',
    completedAt: null,
    lastPositionSeconds: 0,
  };
  const progress = {
    done: 1,
    total: 3,
    percent: 33,
    nextLessonId: id(11),
    firstLessonId: id(12),
    firstFreeLessonId: id(12),
  };

  it('the two member refusal codes join the closed vocabulary, and the lock reasons are closed', () => {
    for (const code of ['lesson_locked', 'lesson_sequence_locked']) {
      expect(COURSE_ISSUES).toContain(code);
      expect(COURSE_ISSUE_SET.has(code)).toBe(true);
    }
    expect(new Set(COURSE_ISSUES).size).toBe(COURSE_ISSUES.length);
    expect(LESSON_LOCK_REASONS).toEqual(['purchase', 'module', 'lesson']);
    expect(MODULE_LOCK_REASONS).toEqual(['purchase', 'module']);
  });

  it('a locked outline lesson is titles only: its EP-14 keys parse, an extra description, video or material key fails (strict, PR-1)', () => {
    expect(learnOutlineLessonSchema.safeParse(lockedLesson).success).toBe(true);
    expect(Object.keys(lockedLesson).sort()).toEqual(
      [
        'completedAt',
        'durationSeconds',
        'hasVideo',
        'id',
        'isFree',
        'lastPositionSeconds',
        'lockReason',
        'number',
        'position',
        'requiresPrevious',
        'title',
      ].sort(),
    );
    for (const extra of [
      { description: 'segredo' },
      { videoAssetId: id(13) },
      { materials: [] },
      { thumbnail: 'x' },
    ]) {
      expect(learnOutlineLessonSchema.safeParse({ ...lockedLesson, ...extra }).success).toBe(false);
    }
    // The evaluator's vocabulary only: the access answer's `sequence` is not a lesson lock reason.
    expect(
      learnOutlineLessonSchema.safeParse({ ...lockedLesson, lockReason: 'sequence' }).success,
    ).toBe(false);
    expect(learnOutlineLessonSchema.safeParse({ ...lockedLesson, lockReason: null }).success).toBe(
      true,
    );
  });

  it('a module, the progress summary and the course read are strict; a module never reads a lesson-rule lock', () => {
    const module = {
      id: id(14),
      title: 'Módulo 1',
      position: 1,
      number: 1,
      requiresPrevious: false,
      lockReason: 'purchase',
      lessons: [lockedLesson],
    };
    expect(learnOutlineModuleSchema.safeParse(module).success).toBe(true);
    expect(learnOutlineModuleSchema.safeParse({ ...module, lockReason: 'lesson' }).success).toBe(
      false,
    );
    expect(learnProgressSchema.safeParse(progress).success).toBe(true);
    expect(learnProgressSchema.safeParse({ ...progress, percent: 101 }).success).toBe(false);
    const course = {
      id: id(15),
      title: 'Curso',
      tagline: '',
      description: '',
      coverAssetId: null,
      category: null,
      level: null,
      instructorName: 'Dra. Ana',
      instructorPhotoAssetId: null,
      outcomes: [],
      certificateHours: null,
      locked: true,
      modules: [module],
      progress,
    };
    expect(learnCourseSchema.safeParse(course).success).toBe(true);
    expect(learnCourseSchema.safeParse({ ...course, status: 'published' }).success).toBe(false);
    expect(learnCourseSchema.safeParse({ ...course, products: [] }).success).toBe(false);
  });

  it('a full open lesson parses; its materials never carry the asset id', () => {
    const material = {
      id: id(16),
      filename: 'apostila.pdf',
      kind: 'pdf',
      mime: 'application/pdf',
      bytes: 1024,
    };
    expect(learnMaterialSchema.safeParse(material).success).toBe(true);
    expect(learnMaterialSchema.safeParse({ ...material, assetId: id(17) }).success).toBe(false);
    expect(learnNeighbourSchema.safeParse({ id: id(18), lockReason: 'lesson' }).success).toBe(true);
    const lesson = {
      id: id(19),
      courseId: id(15),
      courseTitle: 'Curso',
      coverAssetId: null,
      instructorName: 'Dra. Ana',
      instructorPhotoAssetId: null,
      moduleId: id(14),
      moduleTitle: 'Módulo 1',
      moduleNumber: 1,
      lessonNumber: 1,
      title: 'Aula aberta',
      description: 'Descrição',
      isFree: true,
      videoAssetId: id(20),
      videoStatus: 'ready',
      durationSeconds: 600,
      materials: [material],
      progress: { completedAt: '2026-10-15T12:00:00.000000Z', lastPositionSeconds: 30 },
      moduleLessons: [{ ...lockedLesson, lockReason: null }],
      moduleProgress: { done: 1, total: 3 },
      previous: null,
      next: { id: id(18), lockReason: 'purchase' },
    };
    expect(learnLessonSchema.safeParse(lesson).success).toBe(true);
    expect(learnLessonSchema.safeParse({ ...lesson, playbackId: 'x' }).success).toBe(false);
  });
});

describe('courses progress contracts (08.5-03, D-427, COURSE-21)', () => {
  it('the threshold is 90% and the body cap is the 4-hour lesson cap', () => {
    expect(LESSON_COMPLETION_RATIO).toBe(0.9);
    expect(PROGRESS_MAX_POSITION_SECONDS).toBe(14400);
    expect(Math.ceil(LESSON_COMPLETION_RATIO * 100)).toBe(90);
  });

  it('the body: {} is patch_empty; completed false, a negative, 14401, a fraction and an unknown key fail; a tick, the button and both parse', () => {
    expect(issueOf({}, progressBodySchema)).toBe('patch_empty');
    expect(progressBodySchema.safeParse({ completed: false }).success).toBe(false);
    expect(progressBodySchema.safeParse({ positionSeconds: -1 }).success).toBe(false);
    expect(progressBodySchema.safeParse({ positionSeconds: 14401 }).success).toBe(false);
    expect(progressBodySchema.safeParse({ positionSeconds: 1.5 }).success).toBe(false);
    expect(progressBodySchema.safeParse({ positionSeconds: '30' }).success).toBe(false);
    // Mass assignment: the body never names a user or a tenant (strict).
    expect(progressBodySchema.safeParse({ positionSeconds: 30, userId: id(1) }).success).toBe(
      false,
    );
    expect(progressBodySchema.safeParse({ completed: true, tenantId: id(1) }).success).toBe(false);
    expect(progressBodySchema.parse({ positionSeconds: 30 })).toEqual({ positionSeconds: 30 });
    expect(progressBodySchema.parse({ positionSeconds: 0 })).toEqual({ positionSeconds: 0 });
    expect(progressBodySchema.parse({ positionSeconds: 14400 })).toEqual({
      positionSeconds: 14400,
    });
    expect(progressBodySchema.parse({ completed: true })).toEqual({ completed: true });
    expect(progressBodySchema.parse({ positionSeconds: 12, completed: true })).toEqual({
      positionSeconds: 12,
      completed: true,
    });
  });

  it('the answer is strict: completedAt an ISO instant or null, lastPositionSeconds a non-negative int', () => {
    const result = { completedAt: '2026-10-15T12:00:00.000000Z', lastPositionSeconds: 90 };
    expect(progressResultSchema.safeParse(result).success).toBe(true);
    expect(progressResultSchema.safeParse({ ...result, completedAt: null }).success).toBe(true);
    expect(progressResultSchema.safeParse({ ...result, lastPositionSeconds: -1 }).success).toBe(
      false,
    );
    expect(progressResultSchema.safeParse({ ...result, userId: id(1) }).success).toBe(false);
  });
});
