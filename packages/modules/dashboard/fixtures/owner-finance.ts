import { ENGAGEMENT_BAND_ORDER } from '../ui/metrics';
import { daysSince, type OwnerBandMember, ownerBandRoster } from './owner-members';
import { ownerPostTable } from './owner-posts';
import type { EngagementBand, ExampleValue, RelativeMoment } from './shared';
import { tenantOwnerPanel } from './tenant-owner';

/**
 * The level-4 Financeiro (quick 261014-dwc): ONE list of store orders, from which every money total
 * of the panel is computed — the Financeiro tabs, the panel's month (`kpis.orderValue`,
 * `store.products`, the orders channel), each member's purchases (`owner-member-insights.ts`) and
 * the sales tied to a publication (`owner-content.ts`). RAW DATA (MOD-02): ids, offers, days ago and
 * integer cents; no clock and no randomness, so two builds are equal.
 *
 * D-02 Primary × secondary revenue, by ORDER, never by product. Every member's first paid order is
 * primary: the purchase that gave access to the app, dated the day they joined. Every paid order
 * after it is secondary (an add-on purchase), a renewal included. `classifyOrders` computes it; it
 * is never stored on the order (PD-18). The same product sells as an entry and as an add-on, through
 * different OFFERS (own composition and price, PD-2); the 96 novos of the month are the month's 96
 * primary orders.
 * D-03 An entry gives one year of access: the access ends on purchase + 365 (an example, `expires_at`
 * is never filled). The community opened about a year ago: the 6 founders joined 358-364 days ago,
 * their accesses end in the next 7 days, and nobody else joined that week, so no access has ended
 * and nobody renewed yet (PD-5).
 * D-05 A revoked order (the admin's cancellation) never counts as revenue, as an order nor as primary.
 * PD-1 The month keeps R$ 8.940,00; its orders go from 96 to 126 (96 entries + 30 add-ons, PD-3).
 * PD-4 The buyer's band is today's: a purchase in the last 30 days is an action, so em risco and
 * inativos buy nothing in the month, and the month's entries are exactly the novos.
 * PD-6 The 72 roster members (the named sample) enter on their `memberSince`; the novos and the
 * VIP holders with an even slot enter through the VIP, the others through the e-book; a VIP holder
 * with an odd slot buys the VIP as an add-on later. A roster member buys at most once in the month,
 * on their last active day (a novo: the entry), and an older add-on sits 90+ days back, outside the
 * insights' 90-day window, so no band or history moves.
 */

export type FinanceOfferId =
  | 'ebook-entrada'
  | 'vip-entrada'
  | 'ebook-adicional'
  | 'vip-adicional'
  | 'mentoria-adicional'
  | 'workshop-adicional';

/** An entry offer is a member's first purchase (it gives the app); an add-on is any later one. */
export type FinanceOfferKind = 'entry' | 'addon';

export interface FinanceOffer {
  id: FinanceOfferId;
  /** Level 5's product id. */
  productId: string;
  kind: FinanceOfferKind;
  /** What the offer sells: tenant content, like a product's name. */
  composition: string;
  priceCents: number;
}

/** A member of the base: only the band of today and the day they joined; the roster has names. */
export interface FinanceMember {
  id: string;
  band: EngagementBand;
  joinedDaysAgo: number;
}

export interface FinanceOrder {
  id: string;
  memberId: string;
  offerId: FinanceOfferId;
  productId: string;
  cents: number;
  daysAgo: number;
  status: 'paid' | 'revoked';
}

/** Computed per order, never stored (PD-18). */
export type RevenueKind = 'primary' | 'secondary';

/** PD-2: the client's offers (no table records them yet). Add-ons keep today's unit prices. */
export const FINANCE_OFFERS: readonly FinanceOffer[] = [
  {
    id: 'ebook-entrada',
    productId: 's3',
    kind: 'entry',
    composition: 'E-book + 1 ano de acesso ao app',
    priceCents: 1700,
  },
  {
    id: 'vip-entrada',
    productId: 's2',
    kind: 'entry',
    composition: 'Comunidade VIP + 1 ano de acesso ao app',
    priceCents: 24700,
  },
  {
    id: 'ebook-adicional',
    productId: 's3',
    kind: 'addon',
    composition: 'E-book',
    priceCents: 2700,
  },
  {
    id: 'vip-adicional',
    productId: 's2',
    kind: 'addon',
    composition: 'Comunidade VIP por 1 ano',
    priceCents: 19700,
  },
  {
    id: 'mentoria-adicional',
    productId: 's1',
    kind: 'addon',
    composition: 'Mentoria em grupo: 4 encontros ao vivo',
    priceCents: 49000,
  },
  {
    id: 'workshop-adicional',
    productId: 's4',
    kind: 'addon',
    composition: 'Workshop gravado',
    priceCents: 9700,
  },
];

const PRODUCT_IDS: readonly string[] = tenantOwnerPanel.store.products.map((row) => row.id);

/** An offer by id; an id the fixture does not have is a bug, so it throws. */
export function financeOffer(id: string): FinanceOffer {
  const offer = FINANCE_OFFERS.find((row) => row.id === id);
  if (!offer) throw new Error(`no offer ${id}`);
  return offer;
}

/** A product's offers, the entry first; an unknown product throws. */
export function financeProductOffers(productId: string): FinanceOffer[] {
  if (!PRODUCT_IDS.includes(productId)) throw new Error(`no product ${productId}`);
  return FINANCE_OFFERS.filter((offer) => offer.productId === productId).sort(
    (a, b) => Number(a.kind === 'addon') - Number(b.kind === 'addon'),
  );
}

/**
 * Each paid order's revenue kind: a member's first paid order (most days ago; on a tie, the first in
 * the list) is primary, every later one secondary. A revoked order gets none.
 */
export function classifyOrders(orders: readonly FinanceOrder[]): ReadonlyMap<string, RevenueKind> {
  const first = new Map<string, FinanceOrder>();
  for (const order of orders) {
    if (order.status !== 'paid') continue;
    const before = first.get(order.memberId);
    if (!before || order.daysAgo > before.daysAgo) first.set(order.memberId, order);
  }
  const kinds = new Map<string, RevenueKind>();
  for (const order of orders) {
    if (order.status !== 'paid') continue;
    kinds.set(order.id, first.get(order.memberId) === order ? 'primary' : 'secondary');
  }
  return kinds;
}

/* ------------------------------------------------------------------------------- the base */

const { engagement, growth, communityEngagement } = tenantOwnerPanel;

/** Joins per week, 13 to 24 weeks back (newest first): 12 to 18 a week (the 12 weeks before). */
const PRIOR_WEEKLY_JOINS = [16, 13, 17, 15, 12, 18, 14, 16, 13, 17, 15, 14] as const;

/** The first members, who joined in the community's first week (PD-5). */
const FOUNDERS = 6;
const FOUNDERS_FROM = 358;
const DAYS_A_YEAR = 365;

/** Everyone else not counted by a week joined in this range of days ago. */
const REST_FROM = 7 * (12 + PRIOR_WEEKLY_JOINS.length);
const REST_TO = FOUNDERS_FROM - 1;

/** The founders' bands: loyal members, mostly still active. */
const FOUNDER_BANDS: readonly EngagementBand[] = [
  'superfan',
  'engaged',
  'engaged',
  'occasional',
  'superfan',
  'at_risk',
];

/** `count` days spread evenly over [from, to]. */
function spreadDays(from: number, to: number, count: number): number[] {
  const span = to - from + 1;
  return Array.from({ length: count }, (_, k) => from + Math.floor((k * span) / count));
}

function at<T>(rows: readonly T[], index: number): T {
  const row = rows[index];
  if (row === undefined) throw new Error(`no row at index ${index}`);
  return row;
}

const BASE_SIZE = ENGAGEMENT_BAND_ORDER.reduce((sum, band) => sum + engagement.counts[band], 0);

/**
 * The day (days ago) every member joined: the 12 weeks of `growth.weeklyJoined` in 7-day blocks back
 * from today (as `weeklyActiveDays`), the novos exactly under 30 days, the 12 weeks before, the
 * founders and the rest of the year between them.
 */
function joinDays(): number[] {
  const weekly = [...growth.weeklyJoined].reverse();
  const days: number[] = [];
  let novos = 0;
  for (const [w, count] of weekly.entries()) {
    const from = 7 * w;
    const to = from + 6;
    if (to < 30) {
      days.push(...spreadDays(from, to, count));
      novos += count;
    } else if (from < 30) {
      // The week across the 30-day line: its first days close the novos.
      const under = engagement.counts.new - novos;
      days.push(...spreadDays(from, 29, under), ...spreadDays(30, to, count - under));
      novos += under;
    } else {
      days.push(...spreadDays(from, to, count));
    }
  }
  for (const [k, count] of PRIOR_WEEKLY_JOINS.entries()) {
    const from = 7 * (weekly.length + k);
    days.push(...spreadDays(from, from + 6, count));
  }
  const rest = BASE_SIZE - days.length - FOUNDERS;
  days.push(...spreadDays(REST_FROM, REST_TO, rest));
  days.push(...spreadDays(FOUNDERS_FROM, FOUNDERS_FROM + 6, FOUNDERS));
  return days.sort((a, b) => a - b);
}

const allowedBand = (band: EngagementBand, joined: number) =>
  band === 'at_risk' ? joined >= 31 : band === 'inactive' ? joined >= 61 : true;

/**
 * The base: the roster on its own joining days, then the anonymous members (`ob-0001`, most recent
 * first) on the days left. Their bands make up `engagement.counts`: novos under 30 days, the founders
 * as FOUNDER_BANDS, and the rest interleaved by need (em risco from 31 days, inativos from 61).
 */
function buildMembers(): FinanceMember[] {
  const left = new Map<number, number>();
  for (const day of joinDays()) left.set(day, (left.get(day) ?? 0) + 1);
  const members: FinanceMember[] = [];
  for (const row of ownerBandRoster) {
    const joined = daysSince(row.memberSince);
    const count = left.get(joined) ?? 0;
    if (count === 0) throw new Error(`no joining slot for ${row.id} on day ${joined}`);
    left.set(joined, count - 1);
    members.push({ id: row.id, band: row.band, joinedDaysAgo: joined });
  }
  const days = [...left.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([day, count]) => Array.from({ length: count }, () => day));

  const need: Record<EngagementBand, number> = { ...engagement.counts };
  for (const member of members) need[member.band] -= 1;
  for (const band of FOUNDER_BANDS) need[band] -= 1;
  const middle = days.filter((day) => day >= 30 && day < FOUNDERS_FROM).length;
  const targets = { ...need };
  const given: Record<EngagementBand, number> = {
    new: 0,
    superfan: 0,
    engaged: 0,
    occasional: 0,
    at_risk: 0,
    inactive: 0,
  };

  let k = 0;
  let founder = 0;
  for (const [i, joined] of days.entries()) {
    let band: EngagementBand;
    if (joined < 30) band = 'new';
    else if (joined >= FOUNDERS_FROM) {
      band = at(FOUNDER_BANDS, founder);
      founder += 1;
    } else {
      let best: EngagementBand | null = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const row of ENGAGEMENT_BAND_ORDER) {
        if (row === 'new' || given[row] >= targets[row] || !allowedBand(row, joined)) continue;
        const score = (targets[row] * (k + 1)) / middle - given[row];
        if (score > bestScore) {
          best = row;
          bestScore = score;
        }
      }
      if (!best) throw new Error(`no band left for a member joined ${joined} days ago`);
      band = best;
      given[band] += 1;
      k += 1;
    }
    members.push({ id: `ob-${String(i + 1).padStart(4, '0')}`, band, joinedDaysAgo: joined });
  }
  for (const band of ENGAGEMENT_BAND_ORDER) {
    const count = members.filter((member) => member.band === band).length;
    if (count !== engagement.counts[band]) {
      throw new Error(`the base holds ${count} ${band}, the panel ${engagement.counts[band]}`);
    }
  }
  return members;
}

/* ----------------------------------------------------------------------------- the orders */

interface RawOrder {
  memberId: string;
  offerId: FinanceOfferId;
  daysAgo: number;
  status: FinanceOrder['status'];
}

/** The add-ons of the last 30 days bought by anonymous members (PD-3 minus the roster's). */
interface MonthAddons {
  band: EngagementBand;
  offerId: FinanceOfferId;
  days: readonly number[];
}

/**
 * PD-3's month, minus the roster's five add-ons (`ROSTER_MONTH`): the days are placed so the sales
 * tied to a publication fit their 7-day windows (quick 261014-dwc Tarefa 2).
 */
const MONTH_ADDONS: readonly MonthAddons[] = [
  { band: 'superfan', offerId: 'mentoria-adicional', days: [5, 13, 20] },
  { band: 'engaged', offerId: 'mentoria-adicional', days: [3, 17] },
  { band: 'new', offerId: 'vip-adicional', days: [1, 3, 6] },
  { band: 'engaged', offerId: 'vip-adicional', days: [0, 2, 5] },
  { band: 'superfan', offerId: 'ebook-adicional', days: [0, 1, 4, 9, 22] },
  { band: 'engaged', offerId: 'ebook-adicional', days: [2, 3, 7, 14, 26] },
  { band: 'occasional', offerId: 'ebook-adicional', days: [4, 11, 18, 25] },
];

/** The roster's add-ons of the month, each on the member's last active day (PD-6). */
const ROSTER_MONTH: Readonly<Record<string, FinanceOfferId>> = {
  'om-13': 'mentoria-adicional',
  'om-15': 'ebook-adicional',
  'om-27': 'ebook-adicional',
  'om-39': 'ebook-adicional',
  'om-40': 'vip-adicional',
};

/** The month's cancellations (D-05): revoked by the admin, out of the revenue. */
const MONTH_REVOKED: readonly MonthAddons[] = [
  { band: 'engaged', offerId: 'vip-adicional', days: [12] },
  { band: 'superfan', offerId: 'mentoria-adicional', days: [8] },
];

/** The 30 days before (30-59 days ago): add-ons beyond the VIP ones the joining rule places. */
const BEFORE_ADDONS: readonly MonthAddons[] = [
  { band: 'superfan', offerId: 'mentoria-adicional', days: [33, 41, 52] },
  { band: 'engaged', offerId: 'mentoria-adicional', days: [36, 47] },
  { band: 'superfan', offerId: 'ebook-adicional', days: [31, 37, 44, 48, 53] },
  { band: 'engaged', offerId: 'ebook-adicional', days: [34, 39, 42, 50, 57, 58] },
  { band: 'occasional', offerId: 'ebook-adicional', days: [32, 38, 46, 51, 55, 59] },
];

/** Older add-ons are at least this old: past the 30 days before. */
const OLDER_FROM = 61;

/** The newest Workshop gravado sale: it has sold nothing for over 60 days (PD-9). */
const WORKSHOP_FROM = 74;

const ACTIVE_BANDS: readonly EngagementBand[] = ['superfan', 'engaged', 'occasional', 'at_risk'];
const OLD_BANDS: readonly EngagementBand[] = [...ACTIVE_BANDS, 'inactive'];

/**
 * Older add-ons, per offer: how many, from which bands and which entry, and from how many days back.
 * A few VIP entrants buy the Workshop gravado next: a path of the ladder under 5 people.
 */
const OLDER_ADDONS: readonly {
  offerId: FinanceOfferId;
  bands: readonly EngagementBand[];
  entry: FinanceOfferId;
  count: number;
  from: number;
}[] = [
  {
    offerId: 'mentoria-adicional',
    bands: ACTIVE_BANDS,
    entry: 'ebook-entrada',
    count: 45,
    from: OLDER_FROM,
  },
  {
    offerId: 'ebook-adicional',
    bands: OLD_BANDS,
    entry: 'vip-entrada',
    count: 26,
    from: OLDER_FROM,
  },
  {
    offerId: 'workshop-adicional',
    bands: OLD_BANDS,
    entry: 'ebook-entrada',
    count: 9,
    from: WORKSHOP_FROM,
  },
  {
    offerId: 'workshop-adicional',
    bands: OLD_BANDS,
    entry: 'vip-entrada',
    count: 3,
    from: WORKSHOP_FROM,
  },
];

/** Days from the entry to an older add-on: 7 to 56. */
const delayOf = (k: number) => 7 + ((k * 11) % 50);

/** The earliest day (days ago) a member of the band may have bought, by the band's rules. */
function lowestDay(band: EngagementBand): number {
  if (band === 'inactive') return 61;
  if (band === 'at_risk') return 31;
  return band === 'new' ? 0 : 30;
}

function buildOrders(members: readonly FinanceMember[]): RawOrder[] {
  const byId = new Map(members.map((member) => [member.id, member]));
  const roster = new Map(ownerBandRoster.map((row) => [row.id, row]));
  const vipBands = communityEngagement.find((row) => row.id === 'c-vip')?.bands.counts;
  if (!vipBands) throw new Error('no VIP community bands');

  const orders: RawOrder[] = [];
  const owned = new Set<string>();
  const add = (memberId: string, offerId: FinanceOfferId, daysAgo: number) => {
    const { productId } = financeOffer(offerId);
    const key = `${memberId}:${productId}`;
    if (owned.has(key)) throw new Error(`${memberId} already owns ${productId}`);
    const member = byId.get(memberId);
    if (!member || daysAgo > member.joinedDaysAgo || daysAgo < 0) {
      throw new Error(`${memberId} cannot buy ${offerId} ${daysAgo} days ago`);
    }
    owned.add(key);
    orders.push({ memberId, offerId, daysAgo, status: 'paid' });
  };
  const owns = (memberId: string, productId: string) => owned.has(`${memberId}:${productId}`);

  // 1. Who holds the VIP and how they entered: the roster by its slot (PD-6), the founders by the VIP,
  //    the other anonymous holders spread across each band, alternating entry and add-on.
  const anonymous = members.filter((member) => !roster.has(member.id));
  const vipEntry = new Set<string>();
  const vipAddon = new Set<string>();
  for (const row of ownerBandRoster) {
    if (!row.communities['c-vip']) continue;
    const j = ownerBandRoster.filter((other) => other.band === row.band).indexOf(row);
    if (row.band === 'new' || j % 2 === 0) vipEntry.add(row.id);
    else vipAddon.add(row.id);
  }
  for (const member of anonymous) {
    if (member.joinedDaysAgo >= FOUNDERS_FROM) vipEntry.add(member.id);
  }
  for (const band of ENGAGEMENT_BAND_ORDER) {
    const holders = members.filter(
      (member) => member.band === band && (vipEntry.has(member.id) || vipAddon.has(member.id)),
    ).length;
    const pool = anonymous.filter(
      (member) => member.band === band && member.joinedDaysAgo < FOUNDERS_FROM,
    );
    if (band === 'new') {
      // One anonymous novo enters by the VIP today; three buy it as an add-on this month.
      const first = at(pool, 0);
      vipEntry.add(first.id);
      continue;
    }
    const count = vipBands[band] - holders;
    for (let i = 0; i < count; i += 1) {
      const member = at(pool, Math.floor(((i + 0.5) * pool.length) / count));
      if (i % 2 === 0) vipEntry.add(member.id);
      else vipAddon.add(member.id);
    }
  }

  // 2. Every member's entry, on the day they joined.
  for (const member of members) {
    add(member.id, vipEntry.has(member.id) ? 'vip-entrada' : 'ebook-entrada', member.joinedDaysAgo);
  }

  // 3. The roster's add-ons: the month's five on the last active day, the other VIP add-ons 90+ days
  //    back, never after the last action.
  for (const row of ownerBandRoster) {
    const month = ROSTER_MONTH[row.id];
    if (month) {
      add(row.id, month, row.lastActive.daysAgo);
      continue;
    }
    if (!vipAddon.has(row.id)) continue;
    const joined = daysSince(row.memberSince);
    const j = ownerBandRoster.filter((other) => other.band === row.band).indexOf(row);
    add(row.id, 'vip-adicional', Math.max(90, row.lastActive.daysAgo, joined - delayOf(j)));
  }

  // 4. The anonymous month: PD-3's add-ons and cancellations, from the most recent joiners up.
  const pick = (
    band: EngagementBand,
    offerId: FinanceOfferId,
    day: number,
    taken: ReadonlySet<string>,
  ): FinanceMember => {
    const { productId } = financeOffer(offerId);
    const member = anonymous.find(
      (row) =>
        row.band === band &&
        row.joinedDaysAgo > day &&
        !taken.has(row.id) &&
        !owns(row.id, productId) &&
        (offerId !== 'vip-adicional' || !vipEntry.has(row.id)) &&
        (offerId !== 'ebook-adicional' || vipEntry.has(row.id)),
    );
    if (!member) throw new Error(`no ${band} member left to buy ${offerId} ${day} days ago`);
    return member;
  };
  const busy = new Set<string>();
  const vipMonth = new Set<string>();
  for (const group of MONTH_ADDONS) {
    for (const day of group.days) {
      let member: FinanceMember;
      if (group.offerId === 'vip-adicional' && group.band !== 'new') {
        // An anonymous VIP add-on holder whose purchase falls in the month.
        const found = anonymous.find(
          (row) =>
            row.band === group.band &&
            vipAddon.has(row.id) &&
            !vipMonth.has(row.id) &&
            row.joinedDaysAgo > day,
        );
        if (!found) throw new Error(`no ${group.band} VIP add-on holder for the month`);
        member = found;
      } else {
        member = pick(group.band, group.offerId, day, busy);
      }
      if (group.offerId === 'vip-adicional') {
        vipAddon.add(member.id);
        vipMonth.add(member.id);
      }
      busy.add(member.id);
      add(member.id, group.offerId, day);
    }
  }
  for (const group of MONTH_REVOKED) {
    for (const day of group.days) {
      const member = anonymous.find(
        (row) =>
          row.band === group.band &&
          row.joinedDaysAgo > day &&
          !busy.has(row.id) &&
          !vipEntry.has(row.id) &&
          !vipAddon.has(row.id) &&
          !owns(row.id, financeOffer(group.offerId).productId),
      );
      if (!member) throw new Error(`no ${group.band} member to cancel ${group.offerId}`);
      busy.add(member.id);
      orders.push({ memberId: member.id, offerId: group.offerId, daysAgo: day, status: 'revoked' });
    }
  }

  // 5. The other anonymous VIP add-ons: some days after joining, never in the month, within the
  //    band's rules.
  let k = 0;
  for (const member of anonymous) {
    if (!vipAddon.has(member.id) || vipMonth.has(member.id)) continue;
    const day = Math.max(lowestDay(member.band), member.joinedDaysAgo - delayOf(k));
    add(member.id, 'vip-adicional', Math.min(day, member.joinedDaysAgo));
    k += 1;
  }

  // 6. The 30 days before, then the older add-ons: anonymous members not busy in the month.
  for (const group of BEFORE_ADDONS) {
    for (const day of group.days) {
      const member = pick(group.band, group.offerId, day, busy);
      busy.add(member.id);
      add(member.id, group.offerId, day);
    }
  }
  for (const group of OLDER_ADDONS) {
    const { productId } = financeOffer(group.offerId);
    const pool = anonymous.filter(
      (row) =>
        group.bands.includes(row.band) &&
        !busy.has(row.id) &&
        !owns(row.id, productId) &&
        vipEntry.has(row.id) === (group.entry === 'vip-entrada') &&
        row.joinedDaysAgo - delayOf(0) >= Math.max(group.from, lowestDay(row.band)),
    );
    if (pool.length < group.count) {
      throw new Error(`${pool.length} members for ${group.count} older ${group.offerId}`);
    }
    for (let i = 0; i < group.count; i += 1) {
      const member = at(pool, Math.floor(((i + 0.5) * pool.length) / group.count));
      const day = Math.max(group.from, lowestDay(member.band), member.joinedDaysAgo - delayOf(k));
      add(member.id, group.offerId, Math.min(day, member.joinedDaysAgo));
      k += 1;
    }
  }
  return orders;
}

/** Oldest first; on one day the entries first, then by member. */
function chronological(a: RawOrder, b: RawOrder): number {
  const entry = (order: RawOrder) => (financeOffer(order.offerId).kind === 'entry' ? 0 : 1);
  return b.daysAgo - a.daysAgo || entry(a) - entry(b) || a.memberId.localeCompare(b.memberId);
}

/** The whole ledger, built from scratch (the exports below are one build of it). */
export function buildOwnerFinanceLedger(): {
  members: FinanceMember[];
  orders: FinanceOrder[];
} {
  const members = buildMembers();
  const orders = buildOrders(members)
    .sort(chronological)
    .map((order, i) => {
      const offer = financeOffer(order.offerId);
      return {
        id: `of-${String(i + 1).padStart(4, '0')}`,
        memberId: order.memberId,
        offerId: order.offerId,
        productId: offer.productId,
        cents: offer.priceCents,
        daysAgo: order.daysAgo,
        status: order.status,
      };
    });
  return { members, orders };
}

const LEDGER = buildOwnerFinanceLedger();

/** The 1.240 members of the base. */
export const ownerFinanceMembers: readonly FinanceMember[] = LEDGER.members;

/** Every store order of the base, oldest first: the one list every money total comes from. */
export const ownerFinanceOrders: readonly FinanceOrder[] = LEDGER.orders;

const KINDS = classifyOrders(ownerFinanceOrders);
const MEMBER_BY_ID = new Map(ownerFinanceMembers.map((member) => [member.id, member]));

function memberOf(id: string): FinanceMember {
  const member = MEMBER_BY_ID.get(id);
  if (!member) throw new Error(`no member ${id}`);
  return member;
}

/** A paid order's revenue kind. */
export function financeRevenueKind(order: FinanceOrder): RevenueKind {
  const kind = KINDS.get(order.id);
  if (!kind) throw new Error(`order ${order.id} is not paid`);
  return kind;
}

/* ---------------------------------------------------------------------------- the totals */

export interface FinanceAmount {
  orders: number;
  cents: number;
}

export interface FinanceTotals extends FinanceAmount {
  /** Distinct members with a paid order. */
  buyers: number;
}

export interface FinanceWindow {
  total: FinanceTotals;
  primary: FinanceAmount;
  secondary: FinanceAmount;
  /** Revoked orders (D-05): never in any other figure. */
  revoked: FinanceAmount;
  byOffer: Record<FinanceOfferId, FinanceAmount>;
  byProduct: Record<string, FinanceTotals>;
  /** By the buyer's band of today (PD-4). */
  byBand: Record<EngagementBand, FinanceTotals>;
}

function totalsOf(orders: readonly FinanceOrder[]): FinanceTotals {
  return {
    orders: orders.length,
    cents: orders.reduce((sum, order) => sum + order.cents, 0),
    buyers: new Set(orders.map((order) => order.memberId)).size,
  };
}

function amountOf(orders: readonly FinanceOrder[]): FinanceAmount {
  const { orders: count, cents } = totalsOf(orders);
  return { orders: count, cents };
}

/** The orders paid (or revoked) from `fromDaysAgo` to `toDaysAgo`, both included. */
export function ownerFinanceWindow(fromDaysAgo: number, toDaysAgo: number): FinanceWindow {
  const inside = ownerFinanceOrders.filter(
    (order) => order.daysAgo >= fromDaysAgo && order.daysAgo <= toDaysAgo,
  );
  const paid = inside.filter((order) => order.status === 'paid');
  const byOffer = Object.fromEntries(
    FINANCE_OFFERS.map((offer) => [
      offer.id,
      amountOf(paid.filter((order) => order.offerId === offer.id)),
    ]),
  ) as Record<FinanceOfferId, FinanceAmount>;
  const byBand = Object.fromEntries(
    ENGAGEMENT_BAND_ORDER.map((band) => [
      band,
      totalsOf(paid.filter((order) => memberOf(order.memberId).band === band)),
    ]),
  ) as Record<EngagementBand, FinanceTotals>;
  return {
    total: totalsOf(paid),
    primary: amountOf(paid.filter((order) => financeRevenueKind(order) === 'primary')),
    secondary: amountOf(paid.filter((order) => financeRevenueKind(order) === 'secondary')),
    revoked: amountOf(inside.filter((order) => order.status === 'revoked')),
    byOffer,
    byProduct: Object.fromEntries(
      PRODUCT_IDS.map((id) => [id, totalsOf(paid.filter((order) => order.productId === id))]),
    ),
    byBand,
  };
}

/** A year after the purchase: when an entry's (or the VIP's) access ends (D-03, an example). */
export const FINANCE_ACCESS_DAYS = DAYS_A_YEAR;

/** A product with no paid order for longer than this is stalled ("Parado", PD-9). */
export const FINANCE_STALLED_DAYS = 60;

export interface FinanceProductSummary {
  id: string;
  name: string;
  /** The store price: the add-on offer's (an entry bundles the app's access). */
  priceCents: number;
  /** The last 30 days: entries, add-ons, all orders and their value. */
  month: { entry: number; addon: number } & FinanceTotals;
  /** The 30 days before. */
  before: FinanceTotals;
  /** Days since the last paid order; null when it never sold. */
  lastSaleDaysAgo: number | null;
}

/** One product's card numbers (D-08); an unknown id throws. */
export function ownerFinanceProduct(productId: string): FinanceProductSummary {
  const offers = financeProductOffers(productId);
  const store = tenantOwnerPanel.store.products.find((row) => row.id === productId);
  const addon = offers.find((offer) => offer.kind === 'addon');
  if (!store || !addon) throw new Error(`no store product ${productId}`);
  const month = ownerFinanceWindow(0, 29);
  const count = (kind: FinanceOfferKind) =>
    offers
      .filter((offer) => offer.kind === kind)
      .reduce((sum, offer) => sum + month.byOffer[offer.id].orders, 0);
  const sold = ownerFinanceOrders.filter(
    (order) => order.status === 'paid' && order.productId === productId,
  );
  const empty = { orders: 0, cents: 0, buyers: 0 };
  return {
    id: productId,
    name: store.product,
    priceCents: addon.priceCents,
    month: {
      entry: count('entry'),
      addon: count('addon'),
      ...(month.byProduct[productId] ?? empty),
    },
    before: ownerFinanceWindow(30, 59).byProduct[productId] ?? empty,
    lastSaleDaysAgo: sold.length === 0 ? null : Math.min(...sold.map((order) => order.daysAgo)),
  };
}

/* ------------------------------------------------------------------------ the overview */

const PAID_ORDERS = ownerFinanceOrders.filter((order) => order.status === 'paid');
const MONTH_DAYS = 30;

/** Each member's paid orders, oldest first (the ledger's order). */
function paidByMember(orders: readonly FinanceOrder[]): Map<string, FinanceOrder[]> {
  const byMember = new Map<string, FinanceOrder[]>();
  for (const order of orders) {
    byMember.set(order.memberId, [...(byMember.get(order.memberId) ?? []), order]);
  }
  return byMember;
}

const PAID_BY_MEMBER = paidByMember(PAID_ORDERS);

/** The six numbers of Visão geral (D-07), on one day. */
export interface FinanceSummary {
  primary: FinanceAmount;
  secondary: FinanceAmount;
  total: FinanceAmount;
  /** Members who had joined by then. */
  base: number;
  /** Members with two or more paid orders by then. */
  rebought: number;
  /** Average days from the first to the second paid order, of those who bought again. */
  timeToSecondDays: number;
  /** Every paid order's value by then: ÷ `base` is the revenue per member for life. */
  lifetimeCents: number;
}

/**
 * The overview's numbers as if today were `asOfDaysAgo` days ago: the base and the orders of then,
 * the 30 days up to then (D-10: the comparison is that day against today, 30 days before).
 */
export function ownerFinanceSummary(asOfDaysAgo: number): FinanceSummary {
  const paid = PAID_ORDERS.filter((order) => order.daysAgo >= asOfDaysAgo);
  const kinds = classifyOrders(paid);
  const window = paid.filter((order) => order.daysAgo < asOfDaysAgo + MONTH_DAYS);
  const gaps = [...paidByMember(paid).values()]
    .filter((orders) => orders.length >= 2)
    .map(([first, second]) => (first?.daysAgo ?? 0) - (second?.daysAgo ?? 0));
  return {
    primary: amountOf(window.filter((order) => kinds.get(order.id) === 'primary')),
    secondary: amountOf(window.filter((order) => kinds.get(order.id) === 'secondary')),
    total: amountOf(window),
    base: ownerFinanceMembers.filter((member) => member.joinedDaysAgo >= asOfDaysAgo).length,
    rebought: gaps.length,
    timeToSecondDays: gaps.length === 0 ? 0 : gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length,
    lifetimeCents: paid.reduce((sum, order) => sum + order.cents, 0),
  };
}

/** Weekly cents, oldest first: the last 12 weeks and the 12 before them. */
export interface FinanceWeeks {
  current: number[];
  previous: number[];
}

/** Receita por semana (PD-13): primary and secondary revenue in 7-day blocks back from today. */
export function ownerFinanceWeekly(): { primary: FinanceWeeks; secondary: FinanceWeeks } {
  const weeks = (kind: RevenueKind, from: number) =>
    Array.from({ length: 12 }, (_, i) => {
      const weeksBack = from + 11 - i;
      return PAID_ORDERS.filter(
        (order) =>
          KINDS.get(order.id) === kind &&
          order.daysAgo >= 7 * weeksBack &&
          order.daysAgo <= 7 * weeksBack + 6,
      ).reduce((sum, order) => sum + order.cents, 0);
    });
  return {
    primary: { current: weeks('primary', 0), previous: weeks('primary', 12) },
    secondary: { current: weeks('secondary', 0), previous: weeks('secondary', 12) },
  };
}

const VIP_PRODUCT = 's2';

/** Members who hold the VIP: a paid VIP order in the last year. */
function vipOwners(): FinanceMember[] {
  return ownerFinanceMembers.filter((member) =>
    (PAID_BY_MEMBER.get(member.id) ?? []).some(
      (order) => order.productId === VIP_PRODUCT && order.daysAgo < DAYS_A_YEAR,
    ),
  );
}

/** The entries whose year of access ends in the next 7 days (D-03). */
function endingEntries(): FinanceOrder[] {
  return PAID_ORDERS.filter(
    (order) =>
      KINDS.get(order.id) === 'primary' &&
      DAYS_A_YEAR - order.daysAgo >= 1 &&
      DAYS_A_YEAR - order.daysAgo <= 7,
  );
}

export interface FinanceAttention {
  /** VIP holders with no action in 30 days, and of the em risco how many have push on. */
  vipFading: { atRisk: number; inactive: number; withPush: number };
  /** Example: the end of an access is not recorded (`expires_at` is never filled). */
  expiring: ExampleValue<{ count: number; productId: string }>;
  /** Products unsold for over 60 days, with the days since the last sale. */
  stalled: { productId: string; days: number }[];
  /** Example: the full next events and how many wait (no waiting list is recorded). */
  fullEvents: ExampleValue<{ eventId: string; waiting: number }[]>;
}

/** Precisa de atenção (D-07): what loses money if nobody acts. */
export function ownerFinanceAttention(): FinanceAttention {
  const fading = vipOwners();
  const vip = communityEngagement.find((row) => row.id === 'c-vip');
  if (!vip) throw new Error('no VIP community');
  const ending = endingEntries();
  const products = new Set(ending.map((order) => order.productId));
  const [productId] = products;
  if (products.size !== 1 || productId === undefined) {
    throw new Error('the accesses ending this week are not of one product');
  }
  const { waitlist, upcoming } = tenantOwnerPanel.events;
  return {
    vipFading: {
      atRisk: fading.filter((member) => member.band === 'at_risk').length,
      inactive: fading.filter((member) => member.band === 'inactive').length,
      withPush: vip.atRiskWithPush,
    },
    expiring: {
      example: true,
      reason: 'needs_access_expiry',
      value: { count: ending.length, productId },
    },
    stalled: PRODUCT_IDS.flatMap((id) => {
      const days = ownerFinanceProduct(id).lastSaleDaysAgo;
      return days !== null && days > FINANCE_STALLED_DAYS ? [{ productId: id, days }] : [];
    }),
    fullEvents: {
      example: true,
      reason: 'needs_waitlist',
      value: waitlist.value
        .filter((row) => upcoming.some((event) => event.id === row.eventId))
        .map((row) => ({ eventId: row.eventId, waiting: row.waiting })),
    },
  };
}

/* -------------------------------------------------------------------- the associations */

/**
 * Paid orders by members who interacted with a publication up to 7 days before (a measured
 * association, not a cause): per publication, how many of each product. Moved here from Conteúdo's
 * BUSINESS table so a publication's sales are orders of this list (quick 261014-dwc D-02).
 */
const CONTENT_SALES: Readonly<Record<string, readonly (readonly [string, number])[]>> = {
  'op-11': [
    ['s3', 4],
    ['s2', 2],
  ],
  'op-15': [['s2', 6]],
  'op-19': [['s3', 3]],
  'op-41': [
    ['s3', 5],
    ['s2', 3],
    ['s1', 1],
  ],
  'op-55': [['s3', 2]],
};

/** Paid orders by members who went to a past event, up to 7 days after it. */
const EVENT_SALES: Readonly<Record<string, number>> = { e1: 2, e2: 3, e3: 6, e4: 4 };

/** The days after an interaction or a check-in an order still counts as associated. */
const ASSOCIATION_DAYS = 7;

const ROSTER_IDS = new Set(ownerBandRoster.map((row) => row.id));

/**
 * The month's add-on orders an association can name: anonymous members only, so no roster
 * member's insights (which posts they liked, which events they went to) are contradicted.
 */
const ASSOCIABLE = PAID_ORDERS.filter(
  (order) =>
    KINDS.get(order.id) === 'secondary' &&
    order.daysAgo < MONTH_DAYS &&
    !ROSTER_IDS.has(order.memberId),
);

export interface FinanceAssociation {
  orders: number;
  cents: number;
  orderIds: string[];
}

export interface FinanceContentSales {
  posts: (FinanceAssociation & {
    postId: string;
    products: { productId: string; count: number }[];
  })[];
  /** Distinct orders: one order tied to two publications counts once. */
  total: FinanceAmount;
}

function distinctTotal(ids: Iterable<string>): FinanceAmount {
  const set = new Set(ids);
  return amountOf(PAID_ORDERS.filter((order) => set.has(order.id)));
}

/**
 * Sales tied to a publication (what only the app knows): each publication's orders are the most
 * recent of the product's add-ons paid on or after the day it was published.
 */
export function ownerFinanceContentSales(): FinanceContentSales {
  const posts = Object.entries(CONTENT_SALES).map(([postId, rows]) => {
    const post = ownerPostTable.find((row) => row.id === postId);
    if (!post) throw new Error(`no post ${postId}`);
    const age = daysSince(post.date);
    const orderIds = rows.flatMap(([productId, count]) => {
      const picked = ASSOCIABLE.filter(
        (order) => order.productId === productId && order.daysAgo <= age,
      )
        .sort((a, b) => a.daysAgo - b.daysAgo || a.id.localeCompare(b.id))
        .slice(0, count);
      if (picked.length < count) throw new Error(`${postId} has too few ${productId} orders`);
      return picked.map((order) => order.id);
    });
    const { orders, cents } = distinctTotal(orderIds);
    return {
      postId,
      orders,
      cents,
      orderIds,
      products: rows.map(([productId, count]) => ({ productId, count })),
    };
  });
  return { posts, total: distinctTotal(posts.flatMap((post) => post.orderIds)) };
}

export interface FinanceEventSales {
  events: (FinanceAssociation & { eventId: string })[];
  total: FinanceAmount;
}

/** Sales tied to a past event: add-ons paid within 7 days after it, the nearest to it first. */
export function ownerFinanceEventSales(): FinanceEventSales {
  const events = tenantOwnerPanel.events.past.map((event) => {
    const age = daysSince(event.date);
    const count = EVENT_SALES[event.id] ?? 0;
    const orderIds = ASSOCIABLE.filter(
      (order) => order.daysAgo <= age && order.daysAgo >= age - ASSOCIATION_DAYS,
    )
      .sort((a, b) => b.daysAgo - a.daysAgo || a.id.localeCompare(b.id))
      .slice(0, count)
      .map((order) => order.id);
    if (orderIds.length < count) throw new Error(`${event.id} has too few orders after it`);
    return { eventId: event.id, ...distinctTotal(orderIds), orderIds };
  });
  return { events, total: distinctTotal(events.flatMap((event) => event.orderIds)) };
}

/** The VIP's revenue of the month next to its use: active in the week and who holds it. */
export function ownerFinanceVipUsage(): { cents: number; activeWeek: number; holders: number } {
  const community = tenantOwnerPanel.byCommunity.find((row) => row.id === 'c-vip');
  if (!community) throw new Error('no VIP community');
  return {
    cents: ownerFinanceWindow(0, MONTH_DAYS - 1).byProduct[VIP_PRODUCT]?.cents ?? 0,
    activeWeek: community.activeWeek,
    holders: vipOwners().length,
  };
}

/* ---------------------------------------------------------------------------- the people */

/** The lists of named buyers (D-11: level 4 only, read by one web file). */
export type FinancePeopleList =
  | { kind: 'offer'; offerId: FinanceOfferId }
  /** `band`: the band's buyers of the month; `never`: the band's members with one paid order. */
  | { kind: 'band' | 'never'; band: EngagementBand }
  | {
      kind:
        | 'primary'
        | 'secondary'
        | 'rebought'
        | 'timeToSecond'
        | 'lifetime'
        | 'vipFading'
        | 'expiring';
    };

export interface FinancePerson extends OwnerBandMember {
  band: EngagementBand;
  /** When they bought what the list is about (the last purchase, for the lifetime list). */
  when: RelativeMoment;
  /** That purchase's value; for the lifetime list, everything they paid. */
  cents: number;
  offerId: FinanceOfferId;
  /** The time-to-second list only: days from the first to the second purchase. */
  days?: number;
}

export interface FinancePeople {
  /** The roster members in the list, in the list's order. */
  people: readonly FinancePerson[];
  /** The list's own number (the roster is a sample of it). */
  total: number;
}

/** Most recent first: fewer days ago, then a later clock reading, then the id. */
function byRecency(a: FinancePerson, b: FinancePerson): number {
  return (
    a.when.daysAgo - b.when.daysAgo ||
    (b.when.time ?? '').localeCompare(a.when.time ?? '') ||
    a.id.localeCompare(b.id)
  );
}

type Row = (typeof ownerBandRoster)[number];

function personOf(row: Row, order: FinanceOrder, extra?: Partial<FinancePerson>): FinancePerson {
  const { id, name, memberSince, lastActive, topCommunityId, dailyMinutes } = row;
  return {
    id,
    name,
    memberSince,
    lastActive,
    topCommunityId,
    dailyMinutes,
    band: row.band,
    when: order.daysAgo === lastActive.daysAgo ? { ...lastActive } : { daysAgo: order.daysAgo },
    cents: order.cents,
    offerId: order.offerId,
    ...extra,
  };
}

/** The roster's people of a list and the list's number. */
function buildPeople(list: FinancePeopleList): FinancePeople {
  const month = PAID_ORDERS.filter((order) => order.daysAgo < MONTH_DAYS);
  const paidOf = (row: Row) => PAID_BY_MEMBER.get(row.id) ?? [];
  const monthOf = (kind: RevenueKind) => month.filter((order) => KINDS.get(order.id) === kind);
  const rosterOf = (orders: readonly FinanceOrder[]) =>
    ownerBandRoster
      .flatMap((row) => {
        const order = orders.find((entry) => entry.memberId === row.id);
        return order ? [personOf(row, order)] : [];
      })
      .sort(byRecency);
  switch (list.kind) {
    case 'offer': {
      financeOffer(list.offerId);
      const orders = month.filter((order) => order.offerId === list.offerId);
      return { people: rosterOf(orders), total: orders.length };
    }
    case 'primary':
    case 'secondary': {
      const orders = monthOf(list.kind);
      return { people: rosterOf(orders), total: orders.length };
    }
    case 'rebought':
    case 'timeToSecond': {
      const people = ownerBandRoster.flatMap((row) => {
        const [first, second] = paidOf(row);
        if (!first || !second) return [];
        return [personOf(row, second, { days: first.daysAgo - second.daysAgo })];
      });
      const sorted =
        list.kind === 'rebought'
          ? people.sort(byRecency)
          : people.sort((a, b) => (a.days ?? 0) - (b.days ?? 0) || a.id.localeCompare(b.id));
      return { people: sorted, total: ownerFinanceSummary(0).rebought };
    }
    case 'lifetime': {
      const people = ownerBandRoster.flatMap((row) => {
        const orders = paidOf(row);
        const last = orders.at(-1);
        if (!last) return [];
        return [
          personOf(row, last, { cents: orders.reduce((sum, order) => sum + order.cents, 0) }),
        ];
      });
      return {
        people: people.sort((a, b) => b.cents - a.cents || a.id.localeCompare(b.id)),
        total: ownerFinanceMembers.length,
      };
    }
    case 'vipFading': {
      const fading = vipOwners().filter(
        (member) => member.band === 'at_risk' || member.band === 'inactive',
      );
      const people = ownerBandRoster.flatMap((row) => {
        if (!fading.some((member) => member.id === row.id)) return [];
        const vip = paidOf(row).find((order) => order.productId === VIP_PRODUCT);
        return vip ? [personOf(row, vip)] : [];
      });
      return {
        // The ones who left most recently first: they are the easiest to bring back.
        people: people.sort(
          (a, b) => a.lastActive.daysAgo - b.lastActive.daysAgo || a.id.localeCompare(b.id),
        ),
        total: fading.length,
      };
    }
    case 'expiring': {
      const ending = endingEntries();
      return { people: rosterOf(ending), total: ending.length };
    }
    case 'band': {
      // One card per buyer: their latest order of the month.
      const orders = [...month]
        .reverse()
        .filter((order) => memberOf(order.memberId).band === list.band);
      return {
        people: rosterOf(orders),
        total: new Set(orders.map((order) => order.memberId)).size,
      };
    }
    case 'never': {
      const single = ownerFinanceMembers.filter(
        (member) => member.band === list.band && (PAID_BY_MEMBER.get(member.id) ?? []).length === 1,
      );
      const people = ownerBandRoster.flatMap((row) => {
        const [entry] = paidOf(row);
        return entry && paidOf(row).length === 1 && row.band === list.band
          ? [personOf(row, entry)]
          : [];
      });
      return {
        // The most recently active first: the likeliest to buy next.
        people: people.sort(
          (a, b) => a.lastActive.daysAgo - b.lastActive.daysAgo || a.id.localeCompare(b.id),
        ),
        total: single.length,
      };
    }
  }
}

const PEOPLE = new Map<string, FinancePeople>();

/**
 * The buyers behind one Financeiro number (memoized: the list is fixed): who, of the roster, and how
 * many in all. An unknown offer throws.
 */
export function ownerFinancePeople(list: FinancePeopleList): FinancePeople {
  const key =
    list.kind === 'offer'
      ? `offer:${list.offerId}`
      : list.kind === 'band' || list.kind === 'never'
        ? `${list.kind}:${list.band}`
        : list.kind;
  const cached = PEOPLE.get(key);
  if (cached) return cached;
  const people = buildPeople(list);
  PEOPLE.set(key, people);
  return people;
}

/** Whether the member is in the list (the URL parser's membership test; it reads no names). */
export function ownerFinanceIncludes(list: FinancePeopleList, memberId: string): boolean {
  return ownerFinancePeople(list).people.some((person) => person.id === memberId);
}

/**
 * Who to offer the VIP next (Próximos passos): superfãs and engajados who entered through the e-book
 * and never bought the VIP. A count only: the overview names nobody.
 */
export function ownerFinanceVipProspects(): number {
  return ownerFinanceMembers.filter((member) => {
    if (member.band !== 'superfan' && member.band !== 'engaged') return false;
    const orders = PAID_BY_MEMBER.get(member.id) ?? [];
    return (
      orders[0]?.offerId === 'ebook-entrada' &&
      !orders.some((order) => order.productId === VIP_PRODUCT)
    );
  }).length;
}

/* -------------------------------------------------------------------------- who buys */

export interface FinanceBand extends FinanceTotals {
  /** Members in the band today. */
  members: number;
}

/** The month's orders by the buyer's band of today (PD-4), with the band's size (D-09). */
export function ownerFinanceBands(): Record<EngagementBand, FinanceBand> {
  const { byBand } = ownerFinanceWindow(0, MONTH_DAYS - 1);
  return Object.fromEntries(
    ENGAGEMENT_BAND_ORDER.map((band) => [
      band,
      { ...byBand[band], members: engagement.counts[band] },
    ]),
  ) as Record<EngagementBand, FinanceBand>;
}

/** Below this many people a ladder path is grouped into "Outros caminhos" (D-06's floor). */
const PATH_FLOOR = 5;

export interface FinancePath {
  entry: FinanceOfferId;
  next: FinanceOfferId;
  people: number;
  averageDays: number;
}

/**
 * The purchase ladder (PD-15), since each member joined: the entry offer, the offer of the second
 * paid order, how many took that path and the average days between the two. Paths with 5 or more
 * people, most people first; the smaller ones together in `others`.
 */
export function ownerFinancePaths(): {
  paths: FinancePath[];
  others: { people: number; paths: number; averageDays: number } | null;
} {
  const groups = new Map<string, { entry: FinanceOfferId; next: FinanceOfferId; gaps: number[] }>();
  for (const orders of PAID_BY_MEMBER.values()) {
    const [first, second] = orders;
    if (!first || !second) continue;
    const key = `${first.offerId}>${second.offerId}`;
    const group = groups.get(key) ?? { entry: first.offerId, next: second.offerId, gaps: [] };
    group.gaps.push(first.daysAgo - second.daysAgo);
    groups.set(key, group);
  }
  const all = [...groups.values()].map((group) => ({
    entry: group.entry,
    next: group.next,
    people: group.gaps.length,
    averageDays: group.gaps.reduce((sum, gap) => sum + gap, 0) / group.gaps.length,
  }));
  const paths = all
    .filter((path) => path.people >= PATH_FLOOR)
    .sort((a, b) => b.people - a.people || a.entry.localeCompare(b.entry));
  const small = all.filter((path) => path.people < PATH_FLOOR);
  const people = small.reduce((sum, path) => sum + path.people, 0);
  return {
    paths,
    others:
      small.length === 0
        ? null
        : {
            people,
            paths: small.length,
            averageDays:
              small.reduce((sum, path) => sum + path.averageDays * path.people, 0) / people,
          },
  };
}

/** Members with exactly one paid order (the entry), by today's band: the next to offer to. */
export function ownerFinanceNeverAgain(): Record<EngagementBand, number> {
  return Object.fromEntries(
    ENGAGEMENT_BAND_ORDER.map((band) => [
      band,
      ownerFinanceMembers.filter(
        (member) => member.band === band && (PAID_BY_MEMBER.get(member.id) ?? []).length === 1,
      ).length,
    ]),
  ) as Record<EngagementBand, number>;
}

export interface FinanceProductDetail extends FinanceProductSummary {
  /** The month's cancellations of the product (D-05). */
  revoked: FinanceAmount;
  /** The product's revenue per week: the last 12 and the 12 before, oldest first. */
  weekly: FinanceWeeks;
  /** The month's orders by the buyer's band of today. */
  byBand: Record<EngagementBand, FinanceAmount>;
  /** The publications that sold it (associations), most orders first. */
  posts: { postId: string; orders: number; cents: number }[];
}

/** One product's detail (D-08); an unknown id throws. */
export function ownerFinanceProductDetail(productId: string): FinanceProductDetail {
  const summary = ownerFinanceProduct(productId);
  const addon = financeProductOffers(productId).find((offer) => offer.kind === 'addon');
  if (!addon) throw new Error(`no add-on offer for ${productId}`);
  const mine = PAID_ORDERS.filter((order) => order.productId === productId);
  const weeks = (from: number) =>
    Array.from({ length: 12 }, (_, i) => {
      const weeksBack = from + 11 - i;
      return mine
        .filter((order) => order.daysAgo >= 7 * weeksBack && order.daysAgo <= 7 * weeksBack + 6)
        .reduce((sum, order) => sum + order.cents, 0);
    });
  const month = mine.filter((order) => order.daysAgo < MONTH_DAYS);
  const revoked = ownerFinanceOrders.filter(
    (order) =>
      order.status === 'revoked' && order.productId === productId && order.daysAgo < MONTH_DAYS,
  );
  return {
    ...summary,
    revoked: amountOf(revoked),
    weekly: { current: weeks(0), previous: weeks(12) },
    byBand: Object.fromEntries(
      ENGAGEMENT_BAND_ORDER.map((band) => [
        band,
        amountOf(month.filter((order) => memberOf(order.memberId).band === band)),
      ]),
    ) as Record<EngagementBand, FinanceAmount>,
    posts: Object.entries(CONTENT_SALES)
      .flatMap(([postId, rows]) => {
        const count = rows.find(([id]) => id === productId)?.[1] ?? 0;
        return count === 0 ? [] : [{ postId, orders: count, cents: count * addon.priceCents }];
      })
      .sort((a, b) => b.orders - a.orders || a.postId.localeCompare(b.postId)),
  };
}
