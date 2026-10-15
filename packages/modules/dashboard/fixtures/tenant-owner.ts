import type {
  Delta,
  EngagementBand,
  EngagementBands,
  PostType,
  ReportValue,
  Severity,
} from './shared';

/**
 * Level 4, "Dono do cliente" (quick 261012-o00): the client owner's six-area panel, shown to the
 * tenant admin on `/perfil` (2026-10-15). SAMPLE data, the same for every tenant, until the backend
 * measures it (`docs/pendencias-backend.md` item 10). RAW DATA only (MOD-02): counts, ids, ISO dates,
 * money in integer cents, never a sentence. Percents and per-post figures are computed from the raw
 * counts here (`ui/metrics.ts`), never typed next to them, and `tests/tenant-owner.test.ts` proves
 * every sum.
 */

/**
 * The owner's header-bell alerts. The support alert deliberately has no name field: the level-4 panel
 * never names a member.
 */
export type TenantOwnerAttention =
  | {
      id: string;
      kind: 'support_waiting';
      severity: Severity;
      conversations: number;
      oldestHours: number;
    }
  | {
      id: string;
      /** The next event, a few seats left (quick 261014-dwc PD-16: it is no longer today). */
      kind: 'event_soon';
      severity: Severity;
      event: string;
      /** ISO date of the event. */
      date: string;
      startsAtHour: number;
      confirmed: number;
      capacity: number;
    }
  | { id: string; kind: 'entered_at_risk'; severity: Severity; members: number; withPush: number };

export type EventFormat = 'in_person' | 'online';

/** One event of the last 30 days: `events.capacity` (null = no limit), RSVPs "vou" and check-ins. */
export interface OwnerPastEvent {
  id: string;
  name: string;
  format: EventFormat;
  date: string;
  capacity: number | null;
  /** RSVPs "vou". */
  confirmed: number;
  /** Check-ins of confirmed members. */
  checkIns: number;
  /** Check-ins of members with no RSVP. */
  walkIns: number;
  /** `ends_at` − `starts_at`, in minutes (measured). */
  durationMinutes: number;
  /**
   * The ticket price in cents (0 = free): an example, no ticket sale is recorded yet. The revenue a
   * card shows is `confirmed` × this, computed in the web tier like every per-item figure; it is
   * not part of the store revenue (Financeiro).
   */
  ticketCents: ReportValue<number>;
}

/** An event still to come: `events.capacity` (null = no limit) and the RSVPs "vou" so far. */
export interface OwnerUpcomingEvent {
  id: string;
  name: string;
  format: EventFormat;
  date: string;
  /** São Paulo hour it starts. */
  startsAtHour: number;
  capacity: number | null;
  confirmed: number;
  /** `ends_at` − `starts_at`, in minutes (measured). */
  durationMinutes: number;
  /** The ticket price in cents (0 = free): an example, as `OwnerPastEvent.ticketCents`. */
  ticketCents: ReportValue<number>;
}

/**
 * The waiting list of a full event (no table records it yet): who waited, who got a seat when
 * someone gave theirs up, and of those, who came (`null` while the event has not happened).
 */
export interface OwnerWaitlistRow {
  eventId: string;
  name: string;
  capacity: number;
  waiting: number;
  gotSeat: number;
  attended: number | null;
}

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** What a support conversation is about (not recorded yet: the subject block is an example). */
export type SupportSubject = 'access' | 'payment' | 'events' | 'content' | 'other';

export interface TenantOwnerPanel {
  attention: TenantOwnerAttention[];
  kpis: {
    members: { count: number; newMembers: number; delta: Delta };
    /** The percent is computed from `events.past` (`attendancePercent`); only its change lives here. */
    eventAttendance: { delta: Delta };
    orderValue: { cents: number; delta: Delta };
    /** The "Engajados" share is computed from `engagement`; only its change and the actions rate live here. */
    engaged: { delta: Delta; actionsPerActiveMember: number };
  };
  /** The members in the six engagement bands, last 30 days. */
  engagement: EngagementBands;
  /**
   * The six bands per community (quick 261012-pkd D-01), with the same ids and order as
   * `byCommunity`. Same band rules as `engagement`, counting only the member's actions in that
   * community. The base is who has access: the exclusive VIP = who bought it, the others = every
   * member. Novos in an open community are the base's novos. `atRiskWithPush` is the community's em
   * risco who have push on (quick 261012-qer A-2), named like the base's own field.
   */
  communityEngagement: { id: string; bands: EngagementBands; atRiskWithPush: number }[];
  /**
   * The six bands of each panel event's registrants (quick 261012-qer B-2): today's whole-base band of
   * everyone who RSVP'd "vou", so each entry sums to the event's `confirmed`. Nobody is inactive: no
   * fixture RSVP is older than 60 days. `newActivated` equals the novos, because an RSVP is a counted
   * action. `atRiskWithPush` is the registrants in em risco with push on.
   */
  eventEngagement: { id: string; bands: EngagementBands; atRiskWithPush: number }[];
  /**
   * Band today vs 30 days ago, novos excluded: how many moved up or down, and the biggest flows
   * (`active` = any of superfã, engajado or ocasional).
   */
  movement: {
    up: number;
    down: number;
    flows: { from: EngagementBand | 'active'; to: EngagementBand; members: number }[];
  };
  /** Members in risk who have push on (reachable by a notification). */
  atRiskWithPush: number;
  /**
   * Memberships of the last 30 days: who joined and who left, and the members who joined per week
   * (the last 12 weeks, oldest first).
   */
  growth: { joined: number; left: number; weeklyJoined: number[] };
  /**
   * Posts and their likes + comments of the last 30 days by format; the per-post figure is computed
   * (`perItem`), never typed.
   */
  byFormat: { type: PostType; posts: number; interactions: number }[];
  /**
   * Posts and their likes + comments of the last 30 days by community (`feed_posts.community_id`),
   * in rank order; the ids are level 5's.
   */
  byCommunity: {
    id: string;
    name: string;
    /**
     * `communities.description`: the community's own text, tenant content like `name` (not a UI
     * sentence), shown on its card (quick 261012-tru D-03).
     */
    description: string;
    exclusive: boolean;
    posts: number;
    interactions: number;
    /** Members with a counted action in this community in the last 7 days. */
    activeWeek: number;
  }[];
  /**
   * Last 14 days, best first: level 5's posts. Likes and comments are `feed_likes` and
   * `feed_comments`; saves and shares are examples (no table records them yet).
   */
  topPosts: {
    id: string;
    date: string;
    type: PostType;
    community: string;
    likes: number;
    comments: number;
    saves: ReportValue<number>;
    shares: ReportValue<number>;
  }[];
  /** Members reached per post on average: an example (no post views are recorded yet). */
  reach: ReportValue<{ perPost: number }>;
  /** Videos and reels: average % watched and % watched to the end; examples (no playback data yet). */
  videoPlayback: { watchedPercent: ReportValue<number>; completionPercent: ReportValue<number> };
  /** Stories of the last 30 days and their unique viewers on average (`story_views`, aggregate only). */
  stories: { count: number; averageUniqueViewers: number };
  /**
   * Posts of the last 30 days and their likes + comments, by the São Paulo weekday (Monday first) and
   * time slot they were published in.
   */
  publishing: {
    byWeekday: { weekday: Weekday; posts: number; interactions: number }[];
    bySlot: { fromHour: number; toHour: number; posts: number; interactions: number }[];
  };
  /** Members who interacted per week, oldest first, and the 12 weeks before them. */
  weeklyInteracting: { current: number[]; previous: number[] };
  /** Interactions by channel in the period. */
  channels: {
    channel: 'likes' | 'comments' | 'attendance' | 'orders' | 'support';
    count: number;
  }[];
  events: {
    /** The events of the last 30 days, oldest first. */
    past: OwnerPastEvent[];
    /** The next events, soonest first. */
    upcoming: OwnerUpcomingEvent[];
    /** Example: the waiting lists of the full events (only `events.capacity` exists today). */
    waitlist: ReportValue<OwnerWaitlistRow[]>;
    /** Presences (check-ins + walk-ins) by the band the member was in the day before the event. */
    attendanceByBand: Record<EngagementBand, number>;
  };
  /** Paid store orders of the last 30 days (`store` orders); money in integer cents. */
  store: {
    /**
     * Orders and their registered value per product, level 5's ids: entries and add-ons together.
     * Literals (this file cannot import the ledger), proved equal to `owner-finance.ts`'s single
     * order list by `tests/owner-finance.test.ts` (quick 261014-dwc D-02).
     */
    products: { id: string; product: string; orders: number; cents: number }[];
  };
  /** Support chat conversations (`chat_conversations` of kind support). */
  support: {
    /** Waiting for a first staff answer now, and how long the oldest has waited. */
    awaiting: { count: number; oldestHours: number };
    /** Median minutes to the first staff answer per week, the last 8 weeks, oldest first. */
    firstResponse: { delta: Delta; weeklyMedianMinutes: number[] };
    /** Support conversations opened per week, the last 8 weeks, oldest first. */
    weeklyConversations: number[];
    /** Example: the conversations of the last 30 days by subject (no subject is recorded yet). */
    bySubject: ReportValue<{ subject: SupportSubject; conversations: number }[]>;
    /**
     * Conversations answered per staff member in 30 days (`chat_messages.author_user_id`). Names of
     * the client's own team only, never a member's.
     */
    answeredByStaff: { id: string; name: string; conversations: number }[];
  };
  /** Moderation of the last 30 days (removed comments, blocks and unblocks). */
  moderation: { removedComments: number; blocks: number; unblocks: number };
  /** Retention by joining month (`YYYY-MM`): % that interacted in each month after joining. */
  cohorts: { month: string; values: number[] }[];
  account: {
    plan: 'pilot' | 'pro';
    domain: string;
    domainStatus: 'verified' | 'pending';
    admins: number;
    staff: number;
    billing: 'coming_soon';
  };
}

/** One event's registrant bands: new, superfan, engaged, occasional, at_risk (inactive is always 0). */
function eventBands(
  id: string,
  [newCount, superfan, engaged, occasional, atRisk]: [number, number, number, number, number],
  atRiskWithPush: number,
): TenantOwnerPanel['eventEngagement'][number] {
  return {
    id,
    bands: {
      counts: { new: newCount, superfan, engaged, occasional, at_risk: atRisk, inactive: 0 },
      newActivated: newCount,
    },
    atRiskWithPush,
  };
}

export const tenantOwnerPanel: TenantOwnerPanel = {
  attention: [
    {
      id: 'o-support',
      kind: 'support_waiting',
      severity: 'danger',
      conversations: 2,
      oldestHours: 26,
    },
    {
      id: 'o-event',
      kind: 'event_soon',
      severity: 'warning',
      event: 'Encontro mensal',
      date: '2026-10-17',
      startsAtHour: 19,
      confirmed: 92,
      capacity: 100,
    },
    { id: 'o-at-risk', kind: 'entered_at_risk', severity: 'warning', members: 23, withPush: 9 },
  ],
  kpis: {
    members: {
      count: 1240,
      newMembers: 96,
      delta: { amount: 8, kind: 'percent', direction: 'up', good: true, basis: 'previous_30_days' },
    },
    eventAttendance: {
      delta: { amount: 5, kind: 'points', direction: 'up', good: true, basis: 'none' },
    },
    orderValue: {
      cents: 894000,
      // The single order list's month against the 30 days before (quick 261014-dwc D-10).
      delta: {
        amount: 12,
        kind: 'percent',
        direction: 'up',
        good: true,
        basis: 'previous_30_days',
      },
    },
    engaged: {
      delta: { amount: 2, kind: 'points', direction: 'down', good: false, basis: 'none' },
      actionsPerActiveMember: 9.3,
    },
  },
  engagement: {
    counts: { new: 96, superfan: 62, engaged: 205, occasional: 150, at_risk: 168, inactive: 559 },
    newActivated: 54,
  },
  communityEngagement: [
    {
      id: 'c-vip',
      bands: {
        counts: { new: 14, superfan: 38, engaged: 61, occasional: 33, at_risk: 22, inactive: 18 },
        newActivated: 11,
      },
      atRiskWithPush: 11,
    },
    {
      id: 'c-geral',
      bands: {
        counts: {
          new: 96,
          superfan: 41,
          engaged: 150,
          occasional: 170,
          at_risk: 190,
          inactive: 593,
        },
        newActivated: 48,
      },
      atRiskWithPush: 78,
    },
    {
      id: 'c-iniciantes',
      bands: {
        counts: { new: 96, superfan: 6, engaged: 38, occasional: 104, at_risk: 120, inactive: 876 },
        newActivated: 31,
      },
      atRiskWithPush: 49,
    },
    {
      id: 'c-eventos',
      bands: {
        counts: { new: 96, superfan: 3, engaged: 22, occasional: 88, at_risk: 97, inactive: 934 },
        newActivated: 14,
      },
      atRiskWithPush: 40,
    },
  ],
  eventEngagement: [
    eventBands('u1', [14, 26, 34, 12, 6], 3),
    eventBands('u2', [11, 12, 23, 14, 4], 2),
    eventBands('u3', [3, 15, 16, 4, 2], 1),
    eventBands('e4', [9, 9, 21, 17, 5], 2),
    eventBands('e3', [6, 16, 18, 7, 3], 1),
    eventBands('e2', [5, 28, 62, 41, 12], 5),
    eventBands('e1', [1, 30, 45, 18, 6], 3),
  ],
  movement: {
    up: 77,
    down: 171,
    flows: [
      { from: 'at_risk', to: 'inactive', members: 64 },
      { from: 'active', to: 'at_risk', members: 57 },
      { from: 'engaged', to: 'occasional', members: 41 },
      { from: 'occasional', to: 'engaged', members: 38 },
    ],
  },
  atRiskWithPush: 69,
  growth: { joined: 96, left: 9, weeklyJoined: [14, 17, 15, 19, 18, 21, 16, 19, 20, 22, 23, 28] },
  byFormat: [
    { type: 'video', posts: 18, interactions: 1729 },
    { type: 'gallery', posts: 15, interactions: 1067 },
    { type: 'text', posts: 20, interactions: 960 },
    { type: 'link', posts: 8, interactions: 184 },
  ],
  byCommunity: [
    {
      id: 'c-vip',
      name: 'VIP',
      description: 'Aulas, lives e materiais exclusivos para quem é VIP.',
      exclusive: true,
      posts: 22,
      interactions: 1650,
      activeWeek: 104,
    },
    {
      id: 'c-geral',
      name: 'Geral',
      description: 'Conversa aberta com toda a comunidade: dicas, recados e novidades.',
      exclusive: false,
      posts: 25,
      interactions: 1580,
      activeWeek: 296,
    },
    {
      id: 'c-iniciantes',
      name: 'Iniciantes',
      description: 'Primeiros passos para quem acabou de chegar.',
      exclusive: false,
      posts: 8,
      interactions: 430,
      activeWeek: 92,
    },
    {
      id: 'c-eventos',
      name: 'Eventos',
      description: 'Avisos, fotos e conversas dos encontros e das lives.',
      exclusive: false,
      posts: 6,
      interactions: 280,
      activeWeek: 41,
    },
  ],
  topPosts: [
    {
      id: 'p1',
      date: '2026-10-08',
      type: 'video',
      community: 'Geral',
      likes: 96,
      comments: 31,
      saves: { example: true, reason: 'needs_saves', value: 18 },
      shares: { example: true, reason: 'needs_shares', value: 7 },
    },
    {
      id: 'p2',
      date: '2026-10-06',
      type: 'gallery',
      community: 'VIP',
      likes: 70,
      comments: 12,
      saves: { example: true, reason: 'needs_saves', value: 15 },
      shares: { example: true, reason: 'needs_shares', value: 4 },
    },
    {
      id: 'p3',
      date: '2026-10-04',
      type: 'text',
      community: 'Geral',
      likes: 40,
      comments: 20,
      saves: { example: true, reason: 'needs_saves', value: 11 },
      shares: { example: true, reason: 'needs_shares', value: 2 },
    },
    {
      id: 'p4',
      date: '2026-10-02',
      type: 'link',
      community: 'Iniciantes',
      likes: 22,
      comments: 4,
      saves: { example: true, reason: 'needs_saves', value: 6 },
      shares: { example: true, reason: 'needs_shares', value: 1 },
    },
  ],
  // The 61 posts' average reach (owner-content.ts): active members plus a slice of em risco.
  reach: { example: true, reason: 'needs_post_views', value: { perPost: 385 } },
  videoPlayback: {
    watchedPercent: { example: true, reason: 'needs_video_playback', value: 58 },
    completionPercent: { example: true, reason: 'needs_video_playback', value: 34 },
  },
  stories: { count: 16, averageUniqueViewers: 296 },
  publishing: {
    byWeekday: [
      { weekday: 'mon', posts: 9, interactions: 520 },
      { weekday: 'tue', posts: 10, interactions: 610 },
      { weekday: 'wed', posts: 9, interactions: 560 },
      { weekday: 'thu', posts: 10, interactions: 880 },
      { weekday: 'fri', posts: 8, interactions: 520 },
      { weekday: 'sat', posts: 7, interactions: 420 },
      { weekday: 'sun', posts: 8, interactions: 430 },
    ],
    bySlot: [
      { fromHour: 7, toHour: 10, posts: 12, interactions: 560 },
      { fromHour: 12, toHour: 14, posts: 14, interactions: 770 },
      { fromHour: 18, toHour: 20, posts: 17, interactions: 1190 },
      { fromHour: 20, toHour: 22, posts: 18, interactions: 1420 },
    ],
  },
  weeklyInteracting: {
    current: [310, 330, 360, 352, 391, 410, 402, 425, 418, 396, 372, 380],
    previous: [280, 290, 300, 310, 305, 330, 340, 335, 350, 345, 360, 355],
  },
  channels: [
    { channel: 'likes', count: 3100 },
    { channel: 'comments', count: 840 },
    { channel: 'attendance', count: 236 },
    { channel: 'orders', count: 126 },
    { channel: 'support', count: 74 },
  ],
  events: {
    past: [
      {
        id: 'e1',
        name: 'Encontro set.',
        format: 'in_person',
        date: '2026-09-19',
        capacity: 100,
        confirmed: 100,
        checkIns: 82,
        walkIns: 6,
        durationMinutes: 180,
        ticketCents: { example: true, reason: 'needs_event_tickets', value: 6000 },
      },
      {
        id: 'e2',
        name: 'Live de dúvidas',
        format: 'online',
        date: '2026-09-24',
        capacity: null,
        confirmed: 148,
        checkIns: 86,
        walkIns: 0,
        durationMinutes: 60,
        ticketCents: { example: true, reason: 'needs_event_tickets', value: 0 },
      },
      {
        id: 'e3',
        name: 'Workshop',
        format: 'in_person',
        date: '2026-10-01',
        capacity: 50,
        confirmed: 50,
        checkIns: 32,
        walkIns: 0,
        durationMinutes: 240,
        ticketCents: { example: true, reason: 'needs_event_tickets', value: 12000 },
      },
      {
        id: 'e4',
        name: 'Aula aberta',
        format: 'online',
        date: '2026-10-07',
        capacity: null,
        confirmed: 61,
        checkIns: 30,
        walkIns: 0,
        durationMinutes: 90,
        ticketCents: { example: true, reason: 'needs_event_tickets', value: 0 },
      },
    ],
    upcoming: [
      {
        id: 'u2',
        name: 'Live de dúvidas',
        format: 'online',
        date: '2026-10-15',
        startsAtHour: 20,
        capacity: null,
        confirmed: 64,
        durationMinutes: 60,
        ticketCents: { example: true, reason: 'needs_event_tickets', value: 0 },
      },
      {
        id: 'u1',
        name: 'Encontro mensal',
        format: 'in_person',
        date: '2026-10-17',
        startsAtHour: 19,
        capacity: 100,
        confirmed: 92,
        durationMinutes: 180,
        ticketCents: { example: true, reason: 'needs_event_tickets', value: 6000 },
      },
      {
        id: 'u3',
        name: 'Imersão presencial',
        format: 'in_person',
        date: '2026-10-24',
        startsAtHour: 9,
        capacity: 40,
        confirmed: 40,
        durationMinutes: 480,
        ticketCents: { example: true, reason: 'needs_event_tickets', value: 35000 },
      },
    ],
    waitlist: {
      example: true,
      reason: 'needs_waitlist',
      value: [
        {
          eventId: 'e1',
          name: 'Encontro set.',
          capacity: 100,
          waiting: 38,
          gotSeat: 9,
          attended: 7,
        },
        { eventId: 'e3', name: 'Workshop', capacity: 50, waiting: 12, gotSeat: 4, attended: 3 },
        {
          eventId: 'u3',
          name: 'Imersão presencial',
          capacity: 40,
          waiting: 17,
          gotSeat: 2,
          attended: null,
        },
      ],
    },
    attendanceByBand: {
      new: 24,
      superfan: 70,
      engaged: 94,
      occasional: 40,
      at_risk: 6,
      inactive: 2,
    },
  },
  store: {
    products: [
      { id: 's2', product: 'Comunidade VIP', orders: 18, cents: 409600 },
      { id: 's1', product: 'Mentoria em grupo', orders: 6, cents: 294000 },
      { id: 's3', product: 'E-book', orders: 102, cents: 190400 },
      { id: 's4', product: 'Workshop gravado', orders: 0, cents: 0 },
    ],
  },
  support: {
    awaiting: { count: 2, oldestHours: 26 },
    firstResponse: {
      delta: { amount: 20, kind: 'minutes', direction: 'down', good: true, basis: 'none' },
      weeklyMedianMinutes: [180, 165, 150, 140, 150, 130, 120, 100],
    },
    weeklyConversations: [12, 14, 13, 16, 15, 19, 17, 21],
    bySubject: {
      example: true,
      reason: 'needs_support_subject',
      value: [
        { subject: 'access', conversations: 26 },
        { subject: 'payment', conversations: 19 },
        { subject: 'events', conversations: 15 },
        { subject: 'content', conversations: 9 },
        { subject: 'other', conversations: 5 },
      ],
    },
    answeredByStaff: [
      { id: 't-marina', name: 'Marina Costa', conversations: 31 },
      { id: 't-paulo', name: 'Paulo Reis', conversations: 25 },
      { id: 't-bia', name: 'Bia Lopes', conversations: 16 },
    ],
  },
  moderation: { removedComments: 2, blocks: 1, unblocks: 0 },
  cohorts: [
    { month: '2026-06', values: [100, 58, 46, 41, 38] },
    { month: '2026-07', values: [100, 55, 44, 40] },
    { month: '2026-08', values: [100, 61, 47] },
    { month: '2026-09', values: [100, 41] },
  ],
  account: {
    plan: 'pro',
    domain: 'comunidade.exemplo.com.br',
    domainStatus: 'verified',
    admins: 2,
    staff: 3,
    billing: 'coming_soon',
  },
};
