import { describe, expect, it } from 'vitest';
import { financeProductOffers, ownerFinanceWindow, tenantOwnerPanel } from '../fixtures';
import { attendancePercent, bandTotal, percentOf, perItem, sumOf, topBy } from '../ui/metrics';

/**
 * D-05 (quick 261012-o00): every sum the client owner's panel computes adds up. In the
 * rede-social-dashboard preview these numbers also equal the client admin's panel (level 5) and the
 * team's (level 6); the app has neither panel, so those values are pinned here as literals.
 */

const {
  attention,
  growth,
  kpis,
  byCommunity,
  byFormat,
  events,
  channels,
  support,
  topPosts,
  reach,
  stories,
  publishing,
  store,
  moderation,
  account,
} = tenantOwnerPanel;

/** Every rotation of `rows`, plus the rows reversed. */
function orderings<T>(rows: readonly T[]): T[][] {
  const rotations = rows.map((_, i) => [...rows.slice(i), ...rows.slice(0, i)]);
  return [...rotations, [...rows].reverse()];
}

function channel(name: (typeof channels)[number]['channel']): number | undefined {
  return channels.find((row) => row.channel === name)?.count;
}

describe('level-4 alerts (the header bell)', () => {
  it('holds three alerts: support, the next event with few seats and who entered at risk', () => {
    expect(attention.map((item) => item.kind)).toEqual([
      'support_waiting',
      'event_soon',
      'entered_at_risk',
    ]);
  });

  it('gives the support alert the queue (2 waiting, the oldest 26 h), with no member name', () => {
    const owner = attention.find((item) => item.kind === 'support_waiting');
    expect(owner).toMatchObject({
      severity: 'danger',
      conversations: support.awaiting.count,
      oldestHours: support.awaiting.oldestHours,
    });
    expect(support.awaiting).toEqual({ count: 2, oldestHours: 26 });
    expect(owner).toBeDefined();
    expect(Object.keys(owner ?? {})).not.toContain('oldestName');
    expect(JSON.stringify(attention)).not.toMatch(/\b(Ana|Rui)\b/);
  });

  it('gives the Encontro mensal of 17/10 to the bell, with its own numbers (D-10)', () => {
    const u1 = events.upcoming.find((row) => row.id === 'u1');
    const owner = attention.find((item) => item.kind === 'event_soon');
    expect(owner).toMatchObject({
      severity: 'warning',
      event: u1?.name,
      date: u1?.date,
      startsAtHour: u1?.startsAtHour,
      confirmed: u1?.confirmed,
      capacity: u1?.capacity,
    });
    expect(u1?.date).toBe('2026-10-17');
  });

  it('gives who entered at risk this week (23) and their push reach (9)', () => {
    const owner = attention.find((item) => item.kind === 'entered_at_risk');
    expect(owner).toMatchObject({ severity: 'warning', members: 23, withPush: 9 });
  });
});

describe('growth (Membros)', () => {
  it('joins exactly the novos and the new members', () => {
    expect(growth.joined).toBe(tenantOwnerPanel.engagement.counts.new);
    expect(growth.joined).toBe(kpis.members.newMembers);
    expect(growth.joined).toBe(96);
    expect(growth.left).toBe(9);
  });

  it('gives the balance the members KPI change (+8%)', () => {
    const balance = growth.joined - growth.left;
    expect(balance).toBe(87);
    expect(Math.round(percentOf(balance, kpis.members.count - balance))).toBe(
      kpis.members.delta.amount,
    );
  });

  it('ends the weekly series on the week’s 28 new members, 5 more than the week before', () => {
    expect(growth.weeklyJoined).toHaveLength(12);
    const last = growth.weeklyJoined.at(-1) ?? Number.NaN;
    const previous = growth.weeklyJoined.at(-2) ?? Number.NaN;
    expect(last).toBe(28);
    expect(last - previous).toBe(5);
    expect(sumOf(growth.weeklyJoined.slice(-4), (n) => n)).toBeLessThanOrEqual(growth.joined);
  });
});

describe('interactions by community', () => {
  it('sums to the 61 posts by format and to likes + comments', () => {
    const posts = sumOf(byCommunity, (row) => row.posts);
    const interactions = sumOf(byCommunity, (row) => row.interactions);
    expect(posts).toBe(sumOf(tenantOwnerPanel.byFormat, (row) => row.posts));
    expect(posts).toBe(61);
    expect(interactions).toBe((channel('likes') ?? 0) + (channel('comments') ?? 0));
    expect(interactions).toBe(3940);
    expect(perItem(interactions, posts)).toBe(65);
  });

  it('lists the four communities, VIP the only exclusive, each at least its 14-day count', () => {
    const fortnight: Record<string, number> = {
      'c-vip': 1240,
      'c-geral': 980,
      'c-iniciantes': 410,
      'c-eventos': 220,
    };
    expect(byCommunity.map((row) => row.id)).toEqual(Object.keys(fortnight));
    for (const row of byCommunity) {
      expect(row.interactions).toBeGreaterThanOrEqual(
        fortnight[row.id] ?? Number.POSITIVE_INFINITY,
      );
      expect(row.exclusive).toBe(row.id === 'c-vip');
    }
    expect(byCommunity.map((row) => perItem(row.interactions, row.posts))).toEqual([
      75, 63, 54, 47,
    ]);
  });
});

describe('interactions by format (C-4)', () => {
  it('sums to the 61 posts and to likes + comments, the per post computed', () => {
    expect(sumOf(byFormat, (row) => row.posts)).toBe(61);
    const interactions = sumOf(byFormat, (row) => row.interactions);
    expect(interactions).toBe(3940);
    expect(interactions).toBe((channel('likes') ?? 0) + (channel('comments') ?? 0));
    expect(byFormat.map((row) => perItem(row.interactions, row.posts))).toEqual([96, 71, 48, 23]);
  });
});

describe('highlights follow the values, not the order (C-6)', () => {
  const perPost = (row: { posts: number; interactions: number }) =>
    perItem(row.interactions, row.posts);

  it('picks VIP as the community that yields most, in any order', () => {
    for (const rows of orderings(byCommunity)) {
      const top = topBy(rows, perPost);
      expect(top?.id).toBe('c-vip');
      expect(top ? perPost(top) : 0).toBe(75);
    }
  });

  it('picks the 82% event as the best attendance, in any order', () => {
    for (const rows of orderings(events.past)) {
      const top = topBy(rows, (row) => percentOf(row.checkIns, row.confirmed));
      expect(top?.id).toBe('e1');
      expect(top ? Math.round(percentOf(top.checkIns, top.confirmed)) : 0).toBe(82);
    }
  });

  it('picks likes as the top channel, in any order', () => {
    for (const rows of orderings(channels)) {
      expect(topBy(rows, (row) => row.count)?.channel).toBe('likes');
    }
  });
});

describe('past events', () => {
  it('give the attendance: 64% overall and 82 / 58 / 64 / 49 per event', () => {
    expect(Math.round(attendancePercent(events.past))).toBe(64);
    expect(
      events.past.map((row) => ({
        name: row.name,
        percent: Math.round(percentOf(row.checkIns, row.confirmed)),
      })),
    ).toEqual([
      { name: 'Encontro set.', percent: 82 },
      { name: 'Live de dúvidas', percent: 58 },
      { name: 'Workshop', percent: 64 },
      { name: 'Aula aberta', percent: 49 },
    ]);
  });

  it('give the 6 walk-ins and the presences channel', () => {
    expect(sumOf(events.past, (row) => row.walkIns)).toBe(6);
    expect(
      sumOf(events.past, (row) => row.checkIns) + sumOf(events.past, (row) => row.walkIns),
    ).toBe(channel('attendance'));
    expect(channel('attendance')).toBe(236);
  });

  it('never check in more than confirmed, nor confirm more than the capacity', () => {
    for (const row of events.past) {
      expect(row.checkIns).toBeLessThanOrEqual(row.confirmed);
      if (row.capacity !== null) expect(row.confirmed).toBeLessThanOrEqual(row.capacity);
    }
  });
});

describe('top posts (Conteúdo)', () => {
  it('are the four best posts of the last 14 days, with saves and shares as examples', () => {
    expect(
      topPosts.map(({ id, date, type, community, likes, comments }) => ({
        id,
        date,
        type,
        community,
        likes,
        comments,
      })),
    ).toEqual([
      { id: 'p1', date: '2026-10-08', type: 'video', community: 'Geral', likes: 96, comments: 31 },
      { id: 'p2', date: '2026-10-06', type: 'gallery', community: 'VIP', likes: 70, comments: 12 },
      { id: 'p3', date: '2026-10-04', type: 'text', community: 'Geral', likes: 40, comments: 20 },
      {
        id: 'p4',
        date: '2026-10-02',
        type: 'link',
        community: 'Iniciantes',
        likes: 22,
        comments: 4,
      },
    ]);
    for (const post of topPosts) {
      expect(post.saves).toMatchObject({ example: true, reason: 'needs_saves' });
      expect(post.shares).toMatchObject({ example: true, reason: 'needs_shares' });
    }
  });
});

describe('reach and stories', () => {
  it('never reach more than the member base', () => {
    expect(reach.value.perPost).toBeLessThanOrEqual(kpis.members.count);
    expect(stories.averageUniqueViewers).toBeLessThanOrEqual(kpis.members.count);
  });

  it('count at least the 4 stories of the week', () => {
    expect(stories.count).toBeGreaterThanOrEqual(4);
  });
});

describe('best day and time to publish', () => {
  it('splits the 61 posts and 3.940 interactions by weekday and by time slot', () => {
    const lists: readonly { posts: number; interactions: number }[][] = [
      publishing.byWeekday,
      publishing.bySlot,
    ];
    for (const rows of lists) {
      expect(sumOf(rows, (row) => row.posts)).toBe(61);
      expect(sumOf(rows, (row) => row.interactions)).toBe(3940);
    }
    expect(new Set(publishing.byWeekday.map((row) => row.weekday)).size).toBe(7);
  });

  it('peaks on Thursday (88 per post) and at 20h–22h (79 per post)', () => {
    const best = <T extends { posts: number; interactions: number }>(rows: readonly T[]) =>
      [...rows].sort(
        (a, b) => perItem(b.interactions, b.posts) - perItem(a.interactions, a.posts),
      )[0];
    const day = best(publishing.byWeekday);
    const slot = best(publishing.bySlot);
    expect(day?.weekday).toBe('thu');
    expect(perItem(day?.interactions ?? 0, day?.posts ?? 0)).toBe(88);
    expect([slot?.fromHour, slot?.toHour]).toEqual([20, 22]);
    expect(perItem(slot?.interactions ?? 0, slot?.posts ?? 0)).toBe(79);
  });
});

describe('upcoming events and the waiting list (Eventos)', () => {
  it('moves the Encontro mensal to Saturday 17/10, 19h, with the same 92 of 100 (PD-16)', () => {
    const u1 = events.upcoming.find((row) => row.id === 'u1');
    expect(u1).toMatchObject({
      name: 'Encontro mensal',
      date: '2026-10-17',
      startsAtHour: 19,
      durationMinutes: 180,
      confirmed: 92,
      capacity: 100,
    });
    expect(new Date('2026-10-17T12:00:00Z').getUTCDay()).toBe(6);
    expect(tenantOwnerPanel.eventEngagement.find((row) => row.id === 'u1')?.bands.counts).toEqual({
      new: 14,
      superfan: 26,
      engaged: 34,
      occasional: 12,
      at_risk: 6,
      inactive: 0,
    });
  });

  it('keeps the next events in date order, all after the sample’s today', () => {
    expect(events.upcoming.map((row) => row.id)).toEqual(['u2', 'u1', 'u3']);
    const dates = events.upcoming.map((row) => row.date);
    expect([...dates].sort()).toEqual(dates);
    for (const date of dates) expect(date > '2026-10-12').toBe(true);
  });

  it('is an example, only for full events, never seating or counting more than waited', () => {
    const { waitlist } = events;
    expect(waitlist).toMatchObject({ example: true, reason: 'needs_waitlist' });
    const all = [...events.past, ...events.upcoming];
    for (const row of waitlist.value) {
      const event = all.find((other) => other.id === row.eventId);
      expect(event?.name).toBe(row.name);
      expect(event?.capacity).toBe(row.capacity);
      expect(event?.confirmed).toBe(event?.capacity);
      expect(row.gotSeat).toBeLessThanOrEqual(row.waiting);
      if (row.attended !== null) expect(row.attended).toBeLessThanOrEqual(row.gotSeat);
      const upcoming = events.upcoming.some((other) => other.id === row.eventId);
      expect(row.attended === null).toBe(upcoming);
    }
  });

  it('adds up to 67 waiting in 3 events, 15 seated, 10 of 13 who came', () => {
    const rows = events.waitlist.value;
    expect(rows).toHaveLength(3);
    expect(sumOf(rows, (row) => row.waiting)).toBe(67);
    expect(sumOf(rows, (row) => row.gotSeat)).toBe(15);
    const happened = rows.filter((row) => row.attended !== null);
    expect(sumOf(happened, (row) => row.attended ?? 0)).toBe(10);
    expect(sumOf(happened, (row) => row.gotSeat)).toBe(13);
  });

  it('splits the 236 presences by band, 164 of them superfãs and engajados', () => {
    const { attendanceByBand } = events;
    expect(Object.values(attendanceByBand).reduce((total, n) => total + n, 0)).toBe(
      channel('attendance'),
    );
    expect(attendanceByBand.superfan + attendanceByBand.engaged).toBe(164);
  });
});

/** Every path whose value is an `ExampleValue`, with its reason (an example's own value is not walked). */
function examplePaths(value: unknown, path: string[] = []): { path: string; reason: unknown }[] {
  if (value === null || typeof value !== 'object') return [];
  if ('example' in value && value.example === true) {
    return [{ path: path.join('.'), reason: 'reason' in value ? value.reason : undefined }];
  }
  return Object.entries(value).flatMap(([key, child]) => examplePaths(child, [...path, key]));
}

describe('D-03: the example values of level 4', () => {
  it('are exactly the metrics the app does not collect yet, each with its reason', () => {
    const found = examplePaths(tenantOwnerPanel);
    expect(found.map((item) => item.path).sort()).toEqual(
      [
        ...[0, 1, 2, 3].flatMap((i) => [`topPosts.${i}.saves`, `topPosts.${i}.shares`]),
        'reach',
        'videoPlayback.watchedPercent',
        'videoPlayback.completionPercent',
        'events.waitlist',
        'support.bySubject',
        ...[0, 1, 2, 3].map((i) => `events.past.${i}.ticketCents`),
        ...[0, 1, 2].map((i) => `events.upcoming.${i}.ticketCents`),
      ].sort(),
    );
    for (const item of found) expect(typeof item.reason).toBe('string');
  });
});

describe('store (Financeiro)', () => {
  const month = ownerFinanceWindow(0, 29);

  it('splits the 126 orders and R$ 8.940,00 of the single ledger across the products', () => {
    const orders = sumOf(store.products, (row) => row.orders);
    expect(orders).toBe(126);
    expect(orders).toBe(month.total.orders);
    expect(orders).toBe(channel('orders'));
    expect(sumOf(store.products, (row) => row.cents)).toBe(kpis.orderValue.cents);
    expect(kpis.orderValue.cents).toBe(month.total.cents);
    for (const row of store.products) {
      expect([row.orders, row.cents], row.id).toEqual([
        month.byProduct[row.id]?.orders,
        month.byProduct[row.id]?.cents,
      ]);
    }
  });

  it('sells the four products, whose 7-day orders come from the same list (PD-7)', () => {
    const lastWeek: Record<string, { product: string; orders: number }> = {
      s1: { product: 'Mentoria em grupo', orders: 3 },
      s2: { product: 'Comunidade VIP', orders: 7 },
      s3: { product: 'E-book', orders: 35 },
      s4: { product: 'Workshop gravado', orders: 0 },
    };
    expect(store.products.map((row) => row.id).sort()).toEqual(Object.keys(lastWeek).sort());
    const week = ownerFinanceWindow(0, 6);
    for (const row of store.products) {
      const expected = lastWeek[row.id];
      expect(row.product).toBe(expected?.product);
      expect(expected?.orders, row.id).toBe(week.byProduct[row.id]?.orders);
      expect(row.orders).toBeGreaterThanOrEqual(expected?.orders ?? Number.POSITIVE_INFINITY);
    }
  });

  it('leaves Workshop gravado with no order', () => {
    const workshop = store.products.find((row) => row.product === 'Workshop gravado');
    expect(workshop).toMatchObject({ orders: 0, cents: 0 });
  });

  it('prices a VIP and a Mentoria purchase at one of the product’s offers', () => {
    for (const purchase of [
      { id: 'b1', product: 'Comunidade VIP', amountCents: 19700 },
      { id: 'b2', product: 'Mentoria em grupo', amountCents: 49000 },
    ]) {
      const row = store.products.find((other) => other.product === purchase.product);
      expect(
        financeProductOffers(row?.id ?? '').map((offer) => offer.priceCents),
        purchase.id,
      ).toContain(purchase.amountCents);
    }
  });

  it('keeps only the month’s products: expiry, renewal and conversion left with the old screen', () => {
    expect(Object.keys(store)).toEqual(['products']);
  });
});

describe('support (Atendimento)', () => {
  it('ends the weekly first-response median on 1h40 and its -20 min', () => {
    const { weeklyMedianMinutes, delta } = support.firstResponse;
    expect(weeklyMedianMinutes).toHaveLength(8);
    expect(weeklyMedianMinutes.at(-1)).toBe(100);
    expect(delta).toEqual({
      amount: 20,
      kind: 'minutes',
      direction: 'down',
      good: true,
      basis: 'none',
    });
    expect((weeklyMedianMinutes.at(-2) ?? 0) - (weeklyMedianMinutes.at(-1) ?? 0)).toBe(
      delta.amount,
    );
  });

  it('opens no more conversations in 4 weeks than the support channel’s 30 days', () => {
    expect(support.weeklyConversations).toHaveLength(8);
    const lastFour = sumOf(support.weeklyConversations.slice(-4), (n) => n);
    expect(lastFour).toBe(72);
    expect(lastFour).toBeLessThanOrEqual(channel('support') ?? 0);
  });

  it('splits the 74 conversations by subject, as an example', () => {
    expect(support.bySubject).toMatchObject({ example: true, reason: 'needs_support_subject' });
    expect(sumOf(support.bySubject.value, (row) => row.conversations)).toBe(channel('support'));
  });

  it('answers the 72 not waiting, by at most the client’s team, never naming a member', () => {
    const answered = sumOf(support.answeredByStaff, (row) => row.conversations);
    expect(answered).toBe((channel('support') ?? 0) - support.awaiting.count);
    expect(support.answeredByStaff.length).toBeLessThanOrEqual(account.admins + account.staff);
    for (const row of support.answeredByStaff) {
      expect(row.name).not.toMatch(/\b(Ana|Rui|Matos|João|Lia|Vieira|Souza)\b/);
    }
  });
});

describe('moderation', () => {
  it('counts the removals, blocks and unblocks', () => {
    expect(moderation).toEqual({ removedComments: 2, blocks: 1, unblocks: 0 });
  });
});

describe('engagement by community (Membros, D-01)', () => {
  const { engagement, communityEngagement } = tenantOwnerPanel;
  const PREFIX = ['superfan', 'engaged', 'occasional', 'at_risk'] as const;

  it('has one entry per community, in byCommunity order', () => {
    expect(communityEngagement.map((row) => row.id)).toEqual(byCommunity.map((row) => row.id));
  });

  it('pins every community’s bands', () => {
    expect(communityEngagement).toEqual([
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
          counts: {
            new: 96,
            superfan: 6,
            engaged: 38,
            occasional: 104,
            at_risk: 120,
            inactive: 876,
          },
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
    ]);
  });

  it('sums each community to its base: VIP who bought it, the open ones every member', () => {
    const whole = bandTotal(engagement);
    expect(whole).toBe(kpis.members.count);
    for (const row of communityEngagement) {
      const community = byCommunity.find((other) => other.id === row.id);
      if (community?.exclusive) {
        expect(bandTotal(row.bands)).toBe(186);
        expect(bandTotal(row.bands)).toBeLessThan(whole);
      } else {
        expect(bandTotal(row.bands), row.id).toBe(whole);
        expect(row.bands.counts.new, row.id).toBe(engagement.counts.new);
      }
    }
  });

  it('keeps VIP novos within the VIP orders', () => {
    const vip = communityEngagement.find((row) => row.id === 'c-vip');
    const orders = store.products.find((row) => row.id === 's2')?.orders ?? 0;
    expect(vip?.bands.counts.new ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(orders);
  });

  it('activates no more novos than the community has or the base activated', () => {
    for (const row of communityEngagement) {
      expect(row.bands.newActivated, row.id).toBeLessThanOrEqual(
        Math.min(row.bands.counts.new, engagement.newActivated),
      );
    }
  });

  it('never ranks more members from superfã down to em risco than the whole base', () => {
    for (const row of communityEngagement) {
      let community = 0;
      let whole = 0;
      for (const band of PREFIX) {
        community += row.bands.counts[band];
        whole += engagement.counts[band];
        expect(community, `${row.id} ${band}`).toBeLessThanOrEqual(whole);
      }
    }
  });
});

describe('engagement by event registrants (Membros, quick 261012-qer B-2)', () => {
  const { engagement, communityEngagement, eventEngagement, atRiskWithPush } = tenantOwnerPanel;
  const allEvents = [...events.upcoming, ...events.past];

  function entry(id: string) {
    const row = eventEngagement.find((other) => other.id === id);
    if (!row) throw new Error(`no event bands for ${id}`);
    return row;
  }

  it('has one entry per panel event', () => {
    expect(eventEngagement.map((row) => row.id).sort()).toEqual(
      allEvents.map((row) => row.id).sort(),
    );
  });

  it('pins every event’s bands and push reach', () => {
    const pinned: Record<string, [number, number, number, number, number, number, number]> = {
      u1: [14, 26, 34, 12, 6, 0, 3],
      u2: [11, 12, 23, 14, 4, 0, 2],
      u3: [3, 15, 16, 4, 2, 0, 1],
      e4: [9, 9, 21, 17, 5, 0, 2],
      e3: [6, 16, 18, 7, 3, 0, 1],
      e2: [5, 28, 62, 41, 12, 0, 5],
      e1: [1, 30, 45, 18, 6, 0, 3],
    };
    for (const [id, [n, s, e, o, r, i, push]] of Object.entries(pinned)) {
      const row = entry(id);
      expect(row.bands.counts, id).toEqual({
        new: n,
        superfan: s,
        engaged: e,
        occasional: o,
        at_risk: r,
        inactive: i,
      });
      expect(row.atRiskWithPush, id).toBe(push);
    }
  });

  it('sums each event’s bands to its RSVPs "vou"', () => {
    for (const event of allEvents) {
      expect(bandTotal(entry(event.id).bands), event.id).toBe(event.confirmed);
    }
  });

  it('never holds more members in a band than the whole base, and nobody inactive', () => {
    for (const row of eventEngagement) {
      for (const [band, count] of Object.entries(row.bands.counts)) {
        expect(count, `${row.id} ${band}`).toBeLessThanOrEqual(
          engagement.counts[band as keyof typeof engagement.counts],
        );
      }
      expect(row.bands.counts.inactive, row.id).toBe(0);
    }
  });

  it('counts every registrant novo as activated (an RSVP is a counted action)', () => {
    for (const row of eventEngagement) {
      expect(row.bands.newActivated, row.id).toBe(row.bands.counts.new);
    }
  });

  it('keeps em risco within the no-shows of a past event', () => {
    for (const event of events.past) {
      expect(entry(event.id).bands.counts.at_risk, event.id).toBeLessThanOrEqual(
        event.confirmed - event.checkIns,
      );
    }
  });

  it('draws past registrants mostly from superfãs and engajados, as attendanceByBand', () => {
    const confirmed = sumOf(events.past, (row) => row.confirmed);
    const strong = sumOf(events.past, (row) => {
      const { superfan, engaged } = entry(row.id).bands.counts;
      return superfan + engaged;
    });
    expect(strong * 2).toBeGreaterThan(confirmed);
    const { superfan, engaged } = events.attendanceByBand;
    const presences = sumOf(Object.values(events.attendanceByBand), (count) => count);
    expect((superfan + engaged) * 2).toBeGreaterThan(presences);
  });

  it('reaches by push no more members than em risco, in every scope (A-2)', () => {
    const scopes = [
      { id: 'base', atRisk: engagement.counts.at_risk, push: atRiskWithPush },
      ...communityEngagement.map((row) => ({
        id: row.id,
        atRisk: row.bands.counts.at_risk,
        push: row.atRiskWithPush,
      })),
      ...eventEngagement.map((row) => ({
        id: row.id,
        atRisk: row.bands.counts.at_risk,
        push: row.atRiskWithPush,
      })),
    ];
    expect(scopes).toHaveLength(12);
    for (const scope of scopes) {
      expect(Number.isInteger(scope.push), scope.id).toBe(true);
      expect(scope.push, scope.id).toBeGreaterThanOrEqual(0);
      expect(scope.push, scope.id).toBeLessThanOrEqual(scope.atRisk);
    }
  });
});

describe('scope cards (quick 261012-tru D-03, D-04)', () => {
  const { communityEngagement, weeklyInteracting } = tenantOwnerPanel;

  it('gives each community its own description and its members active in the week', () => {
    expect(byCommunity.map((row) => row.activeWeek)).toEqual([104, 296, 92, 41]);
    const lastWeek = weeklyInteracting.current.at(-1) ?? 0;
    for (const row of byCommunity) {
      expect(row.description.trim().length, row.id).toBeGreaterThan(0);
      const bands = communityEngagement.find((entry) => entry.id === row.id)?.bands;
      if (!bands) throw new Error(`no bands for ${row.id}`);
      const { new: newCount, superfan, engaged, occasional } = bands.counts;
      expect(row.activeWeek, row.id).toBeGreaterThanOrEqual(superfan);
      expect(row.activeWeek, row.id).toBeLessThanOrEqual(
        Math.min(newCount + superfan + engaged + occasional, lastWeek),
      );
    }
    expect(new Set(byCommunity.map((row) => row.description)).size).toBe(byCommunity.length);
  });

  it('gives every event its measured duration and an example ticket price', () => {
    const all = [...events.past, ...events.upcoming];
    const duration = Object.fromEntries(all.map((row) => [row.id, row.durationMinutes]));
    expect(duration).toEqual({ e1: 180, e2: 60, e3: 240, e4: 90, u1: 180, u2: 60, u3: 480 });
    const ticket = Object.fromEntries(all.map((row) => [row.id, row.ticketCents.value]));
    expect(ticket).toEqual({ e1: 6000, e2: 0, e3: 12000, e4: 0, u1: 6000, u2: 0, u3: 35000 });
    for (const row of all) {
      expect(row.ticketCents, row.id).toMatchObject({
        example: true,
        reason: 'needs_event_tickets',
      });
      if (row.format === 'online') expect(row.ticketCents.value, row.id).toBe(0);
      else expect(row.ticketCents.value, row.id).toBeGreaterThan(0);
    }
  });
});
