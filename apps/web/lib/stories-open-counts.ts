import {
  openHighlightCountsSchema,
  STORY_OPEN_COUNTS_MAX_COMMUNITIES,
} from '@rede-social/module-stories/contracts';
import { apiFetch } from '@/lib/api';

/**
 * `GET /v1/stories/highlights/open-counts` (11.1-09, UI-D-884 (3), A-UI-5): how many highlights of each
 * named community are open to buyers, read by the product form's page for the "no highlight is open"
 * helper line. STAFF ONLY (`stories.story.manage`): a caller without it, a tenant with `stories` off or
 * any other refusal answers `null` here and the form draws no helper.
 *
 * **This helper NEVER throws, redirects or rethrows** (the `loadStories` posture): a failed count must
 * not turn a product form that is fine into an error page, and a missing count shows nothing. The
 * failure is logged by SHAPE only (a status or an error string, never a community id or a name).
 *
 * The answer is a record `communityId -> openHighlights`. A community the API leaves out (a member
 * community, an archived or removed one) is ABSENT from the record, never a zero: absent is "no helper".
 * More than `STORY_OPEN_COUNTS_MAX_COMMUNITIES` ids go in chunks of that size, deduplicated first; one
 * failed chunk makes the whole answer `null` (a partial map would draw a helper for some communities
 * and not others for no reason an administrator could see).
 */
export async function loadOpenHighlightCounts(
  communityIds: readonly string[],
): Promise<Record<string, number> | null> {
  const unique = [...new Set(communityIds)];
  if (unique.length === 0) return {};

  const chunks: string[][] = [];
  for (let at = 0; at < unique.length; at += STORY_OPEN_COUNTS_MAX_COMMUNITIES) {
    chunks.push(unique.slice(at, at + STORY_OPEN_COUNTS_MAX_COMMUNITIES));
  }

  try {
    const pages = await Promise.all(
      chunks.map(async (chunk) => {
        const res = await apiFetch(
          `/v1/stories/highlights/open-counts?communityIds=${encodeURIComponent(chunk.join(','))}`,
        );
        if (!res.ok) throw new Error(`open_counts_status_${res.status}`);
        return openHighlightCountsSchema.parse(await res.json());
      }),
    );
    const counts: Record<string, number> = {};
    for (const page of pages) {
      for (const row of page.items) counts[row.communityId] = row.openHighlights;
    }
    return counts;
  } catch (error) {
    console.error('stories.open_counts_failed', { error: String(error) });
    return null;
  }
}
