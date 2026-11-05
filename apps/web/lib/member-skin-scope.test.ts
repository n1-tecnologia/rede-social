import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Where the member skin is drawn (2026-10-26): the academy look of the members area and the
 * store's shop window, never the admin's screens. `MemberSkin` wraps the OUTERMOST element of a
 * member screen once; its hook classes are inert outside it, so this list is the whole scope. A
 * screen added to the area joins the list here; an admin screen never does, and a second wrapper
 * inside a wrapped screen would paint a second backdrop.
 */
const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '../app/(app)');

function* tsxFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* tsxFiles(full);
    else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) yield full;
  }
}

/** Each file that draws the skin, with how many times it opens a `<MemberSkin`. */
const drawn = new Map<string, number>();
for (const file of tsxFiles(app)) {
  const count = readFileSync(file, 'utf8').split('<MemberSkin').length - 1;
  if (count > 0) drawn.set(relative(app, file).split('\\').join('/'), count);
}

describe('the member skin scope', () => {
  it('wraps exactly the member screens, each at its outermost element', () => {
    expect(Object.fromEntries([...drawn].sort())).toEqual({
      // The five area screens and their loading states, from the area's layout.
      'area-membros/layout.tsx': 1,
      // The member's course page and its failed read (the admin's page never).
      'cursos/[courseId]/MemberCoursePage.tsx': 1,
      'cursos/[courseId]/page.tsx': 1,
      // The module's own page (2026-10-26) and its failed read.
      'cursos/[courseId]/modulos/[moduleId]/MemberModulePage.tsx': 1,
      'cursos/[courseId]/modulos/[moduleId]/page.tsx': 1,
      // The lesson, the locked lesson and the lesson's error card.
      'cursos/[courseId]/aulas/[lessonId]/MemberLessonPage.tsx': 1,
      'cursos/[courseId]/aulas/[lessonId]/LessonLocked.tsx': 2,
      // The member's live and its error card.
      'cursos/lives/[liveId]/MemberLivePage.tsx': 1,
      'cursos/lives/[liveId]/page.tsx': 1,
      // The shop window (Produtos, Comprados), its loading, the product page and the store's 404.
      'loja/StoreBrowseScreen.tsx': 1,
      'loja/StoreSkeletons.tsx': 1,
      'loja/[productId]/page.tsx': 2,
      'loja/[productId]/loading.tsx': 1,
      'loja/not-found.tsx': 1,
      // The feed's suggestions column (2026-10-26): the bento's tiles, without the page ground.
      'inicio/FeedSuggestions.tsx': 1,
    });
  });

  it('never reaches the admin screens or the layouts and loadings they share', () => {
    for (const file of [
      'cursos/layout.tsx',
      'cursos/loading.tsx',
      'cursos/not-found.tsx',
      'cursos/[courseId]/loading.tsx',
      'cursos/[courseId]/CoursePage.tsx',
      'cursos/[courseId]/aulas/[lessonId]/loading.tsx',
      'cursos/[courseId]/aulas/[lessonId]/not-found.tsx',
      'cursos/lives/[liveId]/loading.tsx',
      'cursos/lives/[liveId]/not-found.tsx',
      'cursos/gerenciar/ManageHub.tsx',
      'cursos/AdminListScreen.tsx',
      'cursos/CourseForm.tsx',
      'loja/layout.tsx',
      'loja/StoreManageScreen.tsx',
      'loja/ProductsManageList.tsx',
      'loja/ProductForm.tsx',
      'loja/[productId]/compradores/page.tsx',
    ]) {
      expect(readFileSync(resolve(app, file), 'utf8'), file).not.toContain('MemberSkin');
    }
  });

  it('keeps the shop window skeleton apart from the manager list one', () => {
    const skeletons = readFileSync(resolve(app, 'loja/StoreSkeletons.tsx'), 'utf8');
    const browse = skeletons.slice(skeletons.indexOf('export function StoreBrowseSkeleton'));
    const manage = skeletons.slice(skeletons.indexOf('export function StoreManageSkeleton'));
    expect(browse.slice(0, browse.indexOf('\n}\n'))).toContain('<MemberSkin>');
    expect(manage.slice(0, manage.indexOf('\n}\n'))).not.toContain('MemberSkin');
  });
});
