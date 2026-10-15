import { daysSince, momentHoursAgo, type OwnerRosterMember } from './owner-members';
import { OWNER_POST_UNANSWERED, type OwnerPost, ownerPostTable } from './owner-posts';
import type { EngagementBand, RelativeMoment, ReportValue } from './shared';

/**
 * The lists behind one member's insight numbers (quick 261012-tru D-07), for the level-4 Membros
 * area: which posts they liked and commented on, their strong actions, their active days and the
 * posts they saw in the last 30 days. RAW DATA (MOD-02), built purely from the numbers the insights
 * already computed, so each list's length IS its KPI and no row contradicts another.
 *
 * Which post a member liked or commented on is assigned across the whole roster at once
 * (`assignRosterInteractions`), so a member's comment and a post's commenter are one fact. The roster
 * is a sample of the base (quick 261013-uoi): a Conteúdo "Quem curtiu/comentou" list with a number
 * shows at least 1 and at most 10 of its members, and "e mais N" for the rest.
 *
 * Visible to the client's management only, like the insights: they show which posts a member liked,
 * commented on and viewed, never a comment's text.
 */

export interface OwnerLikedPost {
  post: OwnerPost;
  when: RelativeMoment;
}

export type OwnerStrongAction =
  | { kind: 'comment'; post: OwnerPost; when: RelativeMoment }
  | { kind: 'check_in'; eventId: string; when: RelativeMoment }
  | { kind: 'order'; productId: string; cents: number; when: RelativeMoment };

export interface OwnerSeenPost {
  post: OwnerPost;
  views: number;
  /** Seconds on screen, all views together. */
  seconds: number;
  lastSeen: RelativeMoment;
}

export interface OwnerMemberLists {
  /** One row per active day of the last 30, most recent first, with its counted actions. */
  activeDays: { when: RelativeMoment; actions: number }[];
  /** Most recent first; one post per like. */
  likes: OwnerLikedPost[];
  /** Most recent first; one comment per post, each on an active day after the post was published. */
  comments: OwnerLikedPost[];
  /** Comments, check-ins and the 30-day order, most recent first. */
  strongActions: OwnerStrongAction[];
  /** Example: no post views are recorded yet. Distinct posts, most viewed first. */
  postsSeen: ReportValue<OwnerSeenPost[]>;
}

/** One like or comment of the roster: the post and the day (days ago). */
export interface RosterInteraction {
  postId: string;
  daysAgo: number;
  /** Only on a post's oldest unanswered comment: the clock reading of its recorded wait. */
  time?: string;
}

/** What `assignRosterInteractions` needs of one active roster member. */
export interface RosterInteractionBase {
  row: OwnerRosterMember;
  /** The days ago of each active day of the last 30. */
  days: readonly number[];
  /** The member's 30-day likes (the KPI), all of which must be placed. */
  likes: number;
  /** The member's 30-day comments (the band's table), all of which must be placed. */
  comments: number;
}

/** Per member id: the posts liked and commented on, each with its day. */
export type RosterInteractions = ReadonlyMap<
  string,
  { likes: readonly RosterInteraction[]; comments: readonly RosterInteraction[] }
>;

/** A Conteúdo people list shows at most this many cards. */
const LIST_CARDS = 10;

/** Nobody comments more than twice on one day (quick 261013-uoi). */
const COMMENTS_A_DAY = 2;

/** Who comments first on a post: the most engaged bands, then the members with fewer comments. */
const COMMENT_BAND_RANK: Partial<Record<EngagementBand, number>> = {
  superfan: 0,
  engaged: 1,
  new: 2,
  occasional: 3,
};

interface MemberState {
  base: RosterInteractionBase;
  index: number;
  /** Active days, most recent first. */
  days: number[];
  /** Likes left to place. */
  budget: number;
  /** Comments left to place. */
  commentBudget: number;
  /** Likes per active day. */
  likedOn: Map<number, number>;
  liked: Map<string, number>;
  /** Comments per active day. */
  commentedOn: Map<number, number>;
  comments: RosterInteraction[];
}

/** A post's comments so far, and the latest day (days ago) a new one may land on. */
interface PostState {
  post: OwnerPost;
  age: number;
  limit: number;
  /** Takes no more comments. */
  closed: boolean;
  commenters: number;
}

function unlikedDays(state: MemberState): number[] {
  return state.days.filter((day) => !state.likedOn.has(day));
}

/** The day with the fewest actions in `counts`; a tie goes to the most recent (`days` run recent first). */
function leastBusy(
  days: readonly number[],
  counts: ReadonlyMap<number, number>,
): number | undefined {
  let best: number | undefined;
  for (const day of days) {
    if (best === undefined || (counts.get(day) ?? 0) < (counts.get(best) ?? 0)) best = day;
  }
  return best;
}

function like(state: MemberState, postId: string, day: number, likers: Map<string, number>): void {
  state.liked.set(postId, day);
  state.likedOn.set(day, (state.likedOn.get(day) ?? 0) + 1);
  state.budget -= 1;
  likers.set(postId, (likers.get(postId) ?? 0) + 1);
}

/** The member's active days a comment on `target` may still land on (none when it cannot comment). */
function commentDays(state: MemberState, target: PostState): number[] {
  if (target.closed || state.commentBudget <= 0) return [];
  if (state.base.row.communities[target.post.communityId] === undefined) return [];
  if (state.comments.some((entry) => entry.postId === target.post.id)) return [];
  return state.days.filter(
    (day) => day <= target.limit && (state.commentedOn.get(day) ?? 0) < COMMENTS_A_DAY,
  );
}

function comment(state: MemberState, target: PostState, day: number, time?: string): void {
  state.comments.push({ postId: target.post.id, daysAgo: day, ...(time ? { time } : {}) });
  state.commentedOn.set(day, (state.commentedOn.get(day) ?? 0) + 1);
  state.commentBudget -= 1;
  target.commenters += 1;
}

/**
 * Assigns the roster's likes and comments to the 61 posts, deterministically and all at once. The
 * roster is a sample of the base, so a Conteúdo people list with a number shows at least 1 and at
 * most 10 of its members (quick 261013-uoi):
 *
 * - A member is eligible for a post when they reach its community and have an active day no later
 *   than the post's age.
 * - Likes, newest post first: each post gets min(its likes, 10, eligible members) likers, taken from
 *   the eligible members who can still afford a like without leaving an active day bare (most likes
 *   left first, then roster order), on their active day by then with the fewest likes (a tie: the
 *   most recent). Then each like left goes, one at a time, to the active day with the fewest likes
 *   that still has a reachable, unliked post published by then with likers below its likes; there,
 *   the newest such post. Each member places exactly their likes KPI.
 * - Comments: each member exactly their band's budget, one per post, never 3 on one day, on the
 *   allowed active day with the fewest comments (a tie: the most recent); superfãs, engajados, novos
 *   and ocasionais comment first, then fewer comments, then roster order.
 *   (a) The posts with unanswered comments, shortest wait first: the oldest comes exactly at
 *       `momentHoursAgo(wait)`, by a member active then (and, on their last day, before their last
 *       action); the other unanswered ones come later that day when it is today (the post then takes
 *       no more), else on earlier days, and so does every later comment there.
 *   (b) Every post still without a commenter gets one, newest first.
 *   (c) Each member's comments left, in roster order, go to the reachable post with the fewest
 *       commenters below min(its comments, 10) (a tie: the newest).
 */
export function assignRosterInteractions(
  bases: readonly RosterInteractionBase[],
): RosterInteractions {
  const posts = ownerPostTable
    .map((post, order) => ({ post, order, age: daysSince(post.date) }))
    .sort((a, b) => a.age - b.age || a.order - b.order);
  const states: MemberState[] = bases.map((base, index) => ({
    base,
    index,
    days: [...base.days].sort((a, b) => a - b),
    budget: base.likes,
    commentBudget: base.comments,
    likedOn: new Map(),
    liked: new Map(),
    commentedOn: new Map(),
    comments: [],
  }));
  const likers = new Map<string, number>();
  const reaches = (state: MemberState, post: OwnerPost) =>
    state.base.row.communities[post.communityId] !== undefined;
  const activeBy = (state: MemberState, limit: number) => state.days.some((day) => day <= limit);

  for (const { post, age } of posts) {
    const pool = states.filter((state) => reaches(state, post) && activeBy(state, age));
    const need = Math.min(post.likes, LIST_CARDS, pool.length);
    for (let count = 0; count < need; count += 1) {
      const pick = pool
        .filter((state) => {
          if (state.liked.has(post.id) || state.budget <= 0) return false;
          const bare = unlikedDays(state);
          return state.budget > bare.length || bare.some((day) => day <= age);
        })
        .sort((a, b) => b.budget - a.budget || a.index - b.index)[0];
      if (!pick) break;
      const day = leastBusy(
        pick.days.filter((candidate) => candidate <= age),
        pick.likedOn,
      );
      if (day === undefined) throw new Error(`${pick.base.row.id} has no day to like ${post.id}`);
      like(pick, post.id, day, likers);
    }
  }

  for (const state of states) {
    const open = (day: number) =>
      posts.find(
        ({ post, age }) =>
          age >= day &&
          reaches(state, post) &&
          !state.liked.has(post.id) &&
          (likers.get(post.id) ?? 0) < post.likes,
      );
    while (state.budget > 0) {
      const day = leastBusy(
        state.days.filter((candidate) => open(candidate) !== undefined),
        state.likedOn,
      );
      const next = day === undefined ? undefined : open(day);
      if (day === undefined || !next) {
        throw new Error(`${state.base.row.id} has likes left and no post to like`);
      }
      like(state, next.post.id, day, likers);
    }
  }

  const targets = new Map<string, PostState>(
    posts.map(({ post, age }) => [
      post.id,
      { post, age, limit: age, closed: false, commenters: 0 },
    ]),
  );
  const target = (id: string): PostState => {
    const entry = targets.get(id);
    if (!entry) throw new Error(`no post ${id}`);
    return entry;
  };
  const rank = (a: MemberState, b: MemberState) =>
    (COMMENT_BAND_RANK[a.base.row.band] ?? 9) - (COMMENT_BAND_RANK[b.base.row.band] ?? 9) ||
    a.comments.length - b.comments.length ||
    a.index - b.index;
  const commentOnce = (entry: PostState, within: (day: number) => boolean) => {
    const pick = states.filter((state) => commentDays(state, entry).some(within)).sort(rank)[0];
    const day = pick && leastBusy(commentDays(pick, entry).filter(within), pick.commentedOn);
    if (!pick || day === undefined) throw new Error(`nobody left to comment on ${entry.post.id}`);
    comment(pick, entry, day);
  };

  const waits = Object.entries(OWNER_POST_UNANSWERED).sort((a, b) => a[1][1] - b[1][1]);
  for (const [id, [unanswered, hours]] of waits) {
    const entry = target(id);
    const oldest = momentHoursAgo(hours);
    const d0 = oldest.daysAgo;
    const t0 = oldest.time ?? '';
    if (d0 > entry.age) throw new Error(`${id} waits longer than it exists`);
    const author = states
      .filter((state) => {
        const last = state.base.row.lastActive;
        return (
          commentDays(state, entry).includes(d0) && (last.daysAgo !== d0 || (last.time ?? '') > t0)
        );
      })
      .sort(rank)[0];
    if (!author) throw new Error(`nobody to leave the oldest unanswered comment on ${id}`);
    comment(author, entry, d0, t0);
    const within = d0 === 0 ? (day: number) => day === 0 : (day: number) => day < d0;
    for (let k = 1; k < unanswered; k += 1) commentOnce(entry, within);
    if (d0 === 0) entry.closed = true;
    else entry.limit = d0 - 1;
  }

  for (const { post } of posts) {
    const entry = target(post.id);
    if (post.comments > 0 && entry.commenters === 0) commentOnce(entry, () => true);
  }

  for (const state of states) {
    while (state.commentBudget > 0) {
      const next = posts
        .map(({ post }) => target(post.id))
        .filter(
          (entry) =>
            entry.commenters < Math.min(entry.post.comments, LIST_CARDS) &&
            commentDays(state, entry).length > 0,
        )
        .sort((a, b) => a.commenters - b.commenters || a.age - b.age)[0];
      const day = next && leastBusy(commentDays(state, next), state.commentedOn);
      if (!next || day === undefined) {
        throw new Error(`${state.base.row.id} has comments left and no post to comment on`);
      }
      comment(state, next, day);
    }
  }

  return new Map(
    states.map((state) => [
      state.base.row.id,
      {
        likes: [...state.liked].map(([postId, daysAgo]) => ({ postId, daysAgo })),
        comments: state.comments,
      },
    ]),
  );
}

export interface OwnerMemberListsInput {
  row: OwnerRosterMember;
  /** The member's slot in their band (0-11). */
  j: number;
  /** The days ago of each active day of the last 30. */
  activeDays: readonly number[];
  /** The member's likes and comments, from `assignRosterInteractions`. */
  likes: readonly RosterInteraction[];
  comments: readonly RosterInteraction[];
  /** The past events the member attended, with their days ago. */
  attended: readonly { eventId: string; daysAgo: number }[];
  /** The order of the last 30 days, or null. */
  order: { productId: string; cents: number; daysAgo: number } | null;
}

/** Most recent first: fewer days ago, then a later clock reading; a stable sort keeps the rest. */
function byRecency<T extends { when: RelativeMoment }>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      a.when.daysAgo - b.when.daysAgo || (b.when.time ?? '').localeCompare(a.when.time ?? ''),
  );
}

const POSTS = new Map(ownerPostTable.map((post) => [post.id, post]));

function postOf(id: string): OwnerPost {
  const post = POSTS.get(id);
  if (!post) throw new Error(`no post ${id}`);
  return post;
}

/** Minutes between two actions of the last day stamped in a row. */
const STAMP_STEP_MINUTES = 35;

/** The first time an "ontem" action reads when yesterday is not the member's last day. */
const YESTERDAY_FIRST_STAMP = '21:50';

/** A stable small number from a member id, to spread their clock readings. */
function idSpread(id: string): number {
  let sum = 0;
  for (const char of id) sum = (sum * 31 + char.charCodeAt(0)) % 997;
  return sum;
}

function clockMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function clockText(minutes: number): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function buildOwnerMemberLists(input: OwnerMemberListsInput): OwnerMemberLists {
  const { row, j, attended, order } = input;
  const days = [...input.activeDays].sort((a, b) => a - b);
  const last = row.lastActive;
  const dayMoment = (daysAgo: number): RelativeMoment =>
    daysAgo === last.daysAgo ? { ...last } : { daysAgo };

  // One clock reading per action of the last day (quick 261013-uoi F-1): the first in list order
  // gets the last action's time, each next one 35 min earlier, skipping a time already fixed there.
  const taken = new Set(
    [...input.likes, ...input.comments].flatMap((entry) =>
      entry.daysAgo === last.daysAgo && entry.time ? [entry.time] : [],
    ),
  );
  let clock = last.time === undefined ? Number.NaN : clockMinutes(last.time);
  // "ontem" also reads with its time (flow review of uoi): a day before the last that is still
  // "hoje"/"ontem" gets its own readings from 21:50 down, never a time already fixed that day.
  const earlierTaken = new Set(
    [...input.likes, ...input.comments].flatMap((entry) =>
      entry.daysAgo === 1 && entry.time ? [entry.time] : [],
    ),
  );
  // Each member starts at their own minute, so two people never share the same "ontem às".
  let earlierClock = clockMinutes(YESTERDAY_FIRST_STAMP) - (idSpread(row.id) % 36) * 5;
  const moment = (daysAgo: number, time?: string): RelativeMoment => {
    if (time !== undefined) return { daysAgo, time };
    if (daysAgo === 1 && daysAgo !== last.daysAgo) {
      while (earlierTaken.has(clockText(earlierClock))) earlierClock -= STAMP_STEP_MINUTES;
      if (earlierClock < 0) throw new Error(`${row.id} has more actions yesterday than its hours`);
      const stamped = clockText(earlierClock);
      earlierTaken.add(stamped);
      earlierClock -= STAMP_STEP_MINUTES;
      return { daysAgo, time: stamped };
    }
    if (daysAgo !== last.daysAgo || Number.isNaN(clock)) return { daysAgo };
    while (taken.has(clockText(clock))) clock -= STAMP_STEP_MINUTES;
    if (clock < 0) throw new Error(`${row.id} has more actions on their last day than its hours`);
    const stamped = clockText(clock);
    taken.add(stamped);
    clock -= STAMP_STEP_MINUTES;
    return { daysAgo, time: stamped };
  };

  const pool = ownerPostTable.filter((post) => row.communities[post.communityId]);
  const age = new Map(pool.map((post) => [post.id, daysSince(post.date)]));
  const ageOf = (post: OwnerPost) => age.get(post.id) ?? Number.NaN;

  // Ties keep the age order (newest post first), as the old per-member build did; the times are
  // stamped in that order, so the most recent action keeps the last action's time.
  const toRows = (rows: readonly RosterInteraction[]) =>
    byRecency(
      rows
        .map((entry) => ({ entry, post: postOf(entry.postId) }))
        .sort((a, b) => ageOf(a.post) - ageOf(b.post))
        .map(({ entry, post }) => ({ post, when: moment(entry.daysAgo, entry.time) })),
    );
  const likes = toRows(input.likes);
  const comments = toRows(input.comments);
  const checkIns = attended.map((event) => ({
    kind: 'check_in' as const,
    eventId: event.eventId,
    when: moment(event.daysAgo),
  }));
  const orders = order
    ? [
        {
          kind: 'order' as const,
          productId: order.productId,
          cents: order.cents,
          when: moment(order.daysAgo),
        },
      ]
    : [];

  const strongActions = byRecency<OwnerStrongAction>([
    ...comments.map((entry) => ({ kind: 'comment' as const, ...entry })),
    ...checkIns,
    ...orders,
  ]);

  const actionsOn = (day: number) =>
    likes.filter((entry) => entry.when.daysAgo === day).length +
    comments.filter((entry) => entry.when.daysAgo === day).length +
    attended.filter((event) => event.daysAgo === day).length +
    (order?.daysAgo === day ? 1 : 0);
  const activeDays = days.map((day) => ({ when: dayMoment(day), actions: actionsOn(day) }));

  // Every liked or commented post was seen, more than once; then per active day the newest unused
  // post of then.
  const used = new Set<string>();
  const seen: OwnerSeenPost[] = [];
  for (const [k, entry] of byRecency([...likes, ...comments]).entries()) {
    if (used.has(entry.post.id)) continue;
    used.add(entry.post.id);
    seen.push({
      post: entry.post,
      views: 2 + ((k + j) % 3),
      seconds: 20 + 10 * ((k + j) % 6),
      lastSeen: entry.when,
    });
  }
  for (const [k, day] of days.entries()) {
    const post = pool
      .filter((candidate) => !used.has(candidate.id) && ageOf(candidate) >= day)
      .sort((a, b) => ageOf(a) - ageOf(b))[0];
    if (!post) continue;
    used.add(post.id);
    seen.push({
      post,
      views: 1 + ((k + j) % 2),
      seconds: 20 + 10 * ((k + j) % 6),
      lastSeen: dayMoment(day),
    });
  }
  seen.sort((a, b) => b.views - a.views || a.lastSeen.daysAgo - b.lastSeen.daysAgo);

  return {
    activeDays,
    likes,
    comments,
    strongActions,
    postsSeen: { example: true, reason: 'needs_post_views', value: seen },
  };
}
