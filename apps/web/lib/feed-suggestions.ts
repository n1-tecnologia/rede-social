import type { Bootstrap } from '@rede-social/contracts';
import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { loadCommunities } from '@/lib/communities';
import { getLearnCatalogue } from '@/lib/courses-learn';
import type { CoursesTranslator } from '@/lib/courses-view';
import {
  FEED_SUGGESTIONS_MAX,
  type FeedSuggestionsView,
  feedSuggestionsView,
} from '@/lib/feed-suggestions-view';

/** The catalogue page the column reads: enough to find a course in progress among the newest. */
const COURSES_READ = 24;

/**
 * The feed's suggestions column (2026-10-26): the first page of the course catalogue and of the
 * active communities, read side by side and only for the modules the tenant has on. Both are reads
 * the app already makes (the member area's Cursos, `/comunidades`): no new endpoint, no write. A
 * read that fails or is refused leaves its kind out; with neither, there is no column.
 */
export async function loadFeedSuggestions(
  bootstrap: Pick<Bootstrap, 'modules' | 'permissions'>,
  t: CoursesTranslator,
): Promise<FeedSuggestionsView | null> {
  const on = (key: string) => bootstrap.modules.some((module) => module.key === key);
  const coursesOn = on('courses');
  const communitiesOn = on('communities');
  if (!coursesOn && !communitiesOn) return null;

  const [catalogue, communities] = await Promise.all([
    coursesOn ? getLearnCatalogue({ limit: COURSES_READ }) : Promise.resolve(null),
    communitiesOn ? loadCommunities({ limit: FEED_SUGGESTIONS_MAX }) : Promise.resolve(null),
  ]);
  return feedSuggestionsView({
    courses: catalogue?.status === 'ok' ? catalogue.page.items : null,
    communities: communities ? communities.items : null,
    preview: bootstrap.permissions.includes(COURSE_PERMISSIONS.manage),
    t,
  });
}
