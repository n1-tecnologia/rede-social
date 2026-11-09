import type { LearnOverviewHero } from '@rede-social/module-courses/contracts';
import { type HomeResumeSpotView, homeResumeSpotView } from '@/lib/courses-home-view';
import { homeHeroView } from '@/lib/courses-member-view';
import type { CoursesTranslator } from '@/lib/courses-view';

/** The sample share of the lesson the preview's card shows as watched. */
const SAMPLE_SHARE = 0.4;

/**
 * ⚠ TEMPORARY LOCAL VIEW (2026-10-27). REMOVE this file and its one call in `MemberHomeTab`
 * (`?? resumeSpotLocalView(...)`) when the product owner says "ok" — his words: "quero que coloque
 * um com progresso para eu ver como fica".
 *
 * The top card "Continue de onde parou" (`HomeResumeSpot`) only exists for a member in the middle of
 * a course, and the administrator's preview never is: the API writes no progress for `admin_tenant`
 * (D-422). For the PREVIEW only, this draws the card over the preview's own hero lesson as if it were
 * being resumed, at a SAMPLE 40% of its video, so he sees how it looks. Never for a member (who sees
 * his own minute), never over a real `retomando`, never without a lesson with a ready video.
 */
export function resumeSpotLocalView(
  hero: LearnOverviewHero | null,
  preview: boolean,
  t: CoursesTranslator,
): HomeResumeSpotView | null {
  if (!preview || !hero || hero.state === 'retomando' || hero.lessonId === null) return null;
  const length = hero.lessonDurationSeconds;
  if (!length) return null;
  return homeResumeSpotView(
    homeHeroView({ ...hero, state: 'retomando' }, t, { preview }),
    { lastPositionSeconds: Math.round(length * SAMPLE_SHARE), durationSeconds: length },
    t,
  );
}
