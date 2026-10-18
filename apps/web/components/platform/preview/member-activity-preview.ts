import {
  MEMBER_ACTIVITY_NOT_MEASURED,
  type MemberActivityReady,
} from '@rede-social/module-dashboard/contracts';

/**
 * The super_admin's device preview of "Sua atividade" (08.7-03, UI-D-489 e): a PLATFORM MOCK in the
 * real answer's shape (`GET /v1/dashboard/activity`), so `TenantAppPreview` renders the very report
 * a member sees, with the "Em breve" forms in the same places (usage, saves, shares, posts seen,
 * videos) and no freshness line. It is never tenant data and never reaches a member's runtime: the
 * member's `/perfil` reads the API. Excluded from the D-459 guard (plan 12) for that reason.
 *
 * The numbers and community names are the rede-social-dashboard preview's member level (the retired
 * `member-activity-sample`); the community ids are fixed placeholders of the mock.
 */
export const MEMBER_ACTIVITY_PREVIEW: MemberActivityReady = {
  state: 'ready',
  snapshot: { day: '2026-10-11', builtAt: '2026-10-12T03:30:00Z' },
  likes: { count: 46, previous: 38 },
  comments: { count: 12, previous: 9 },
  saves: MEMBER_ACTIVITY_NOT_MEASURED.saves,
  shares: MEMBER_ACTIVITY_NOT_MEASURED.shares,
  usage: MEMBER_ACTIVITY_NOT_MEASURED.usage,
  seen: {
    stories: 23,
    posts: MEMBER_ACTIVITY_NOT_MEASURED.posts,
    videos: MEMBER_ACTIVITY_NOT_MEASURED.videos,
  },
  byCommunity: [
    {
      communityId: '00000000-0000-4000-8000-0000000000c1',
      name: 'Comunidade VIP',
      interactions: 31,
    },
    { communityId: null, name: null, interactions: 19 },
    { communityId: '00000000-0000-4000-8000-0000000000c3', name: 'Eventos', interactions: 8 },
  ],
  attendance: { attended: 3, events: 4 },
  weekStreak: 6,
};

/** The preview without the communities module: the answer omits `byCommunity` (the block goes). */
export function memberActivityPreview(communities: boolean): MemberActivityReady {
  if (communities) return MEMBER_ACTIVITY_PREVIEW;
  const { byCommunity: _omitted, ...withoutCommunities } = MEMBER_ACTIVITY_PREVIEW;
  return withoutCommunities;
}
