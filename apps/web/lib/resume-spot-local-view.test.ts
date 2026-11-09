import { fileURLToPath } from 'node:url';
import type { LearnOverviewHero } from '@rede-social/module-courses/contracts';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../i18n/messages';
import type { CoursesTranslator } from './courses-view';
import { resumeSpotLocalView } from './resume-spot-local-view';

/**
 * 2026-10-27 — the TEMPORARY sample of "Continue de onde parou" for the administrator's preview (the
 * API writes no progress for him). Pinned: it never reaches a member and never covers a real resume.
 */

const catalogDir = fileURLToPath(new URL('../messages/pt-BR/', import.meta.url));
const t = createTranslator({
  locale: 'pt-BR',
  messages: loadMessages(catalogDir),
}) as unknown as CoursesTranslator;

const COURSE = '11111111-1111-4111-8111-111111111111';
const LESSON = '22222222-2222-4222-8222-222222222222';

const HERO: LearnOverviewHero = {
  state: 'comecando',
  courseId: COURSE,
  courseTitle: 'Skinbooster',
  courseTagline: 'Pele bonita do diagnóstico ao plano.',
  coverAssetId: null,
  lessonId: LESSON,
  lessonTitle: 'Avaliação da pele',
  lessonDurationSeconds: 660,
  moduleNumber: 1,
  moduleTitle: 'Começo',
  lessonNumber: 1,
  moduleLessonsLeft: 2,
  isFree: false,
  percent: 0,
  done: 0,
  total: 3,
  lessonCount: 3,
  durationSeconds: 1980,
};

describe('resumeSpotLocalView', () => {
  it("the preview's hero lesson as if resumed, at a sample 40% of its video", () => {
    const view = resumeSpotLocalView(HERO, true, t);
    expect(view).toMatchObject({
      heading: 'Continue de onde parou',
      title: 'Avaliação da pele',
      cta: { label: 'Continuar aula', href: `/cursos/${COURSE}/aulas/${LESSON}?ver=aluno` },
      watched: { percent: 40, line: 'Você parou em 4:24 de 11:00' },
    });
  });

  it('never for a member, never over a real resume, never without a lesson with a video', () => {
    expect(resumeSpotLocalView(HERO, false, t)).toBeNull();
    expect(resumeSpotLocalView({ ...HERO, state: 'retomando' }, true, t)).toBeNull();
    expect(resumeSpotLocalView({ ...HERO, lessonId: null }, true, t)).toBeNull();
    expect(resumeSpotLocalView({ ...HERO, lessonDurationSeconds: null }, true, t)).toBeNull();
    expect(resumeSpotLocalView(null, true, t)).toBeNull();
  });
});
