import { ENGAGEMENT_BAND_ORDER } from '../ui/metrics';
import type { EngagementBand, EngagementBands, RelativeMoment, ReportValue } from './shared';
import { tenantOwnerPanel } from './tenant-owner';

/**
 * The level-4 band lists (quick 261012-pkd D-02): who is in each engagement band, for the whole base,
 * for each community and for each event's registrants (quick 261012-qer B-2). RAW DATA (MOD-02): a fixed name table plus a pure builder, no randomness and
 * no clock, so every render lists the same people. One roster feeds every scope, so a member is never
 * more engaged nor more recent in a community than in the whole base.
 *
 * These names are visible to the client's own team (D-03): the app's privacy notice must say so
 * before real data replaces this fixture.
 */

/** The page size of a band list (the future endpoint's page size). */
export const OWNER_BAND_LIST_LIMIT = 10;

/**
 * The sample's today (a Monday). The Encontro mensal used to be on this day; it moved to the next
 * Saturday, 17/10, so the bell says when instead of "hoje" (quick 261014-dwc PD-16).
 */
export const PREVIEW_TODAY = '2026-10-12';

/**
 * The sample's "now" on PREVIEW_TODAY: after the latest member action (22:40), so a wait in hours
 * becomes a day and clock reading no member action contradicts (quick 261013-uoi C-3).
 */
export const PREVIEW_NOW_TIME = '23:00';

const DAY_MINUTES = 1440;

/** The moment `hours` before the sample's now: whole days ago (⌊hours / 24⌋) and its clock reading. */
export function momentHoursAgo(hours: number): RelativeMoment {
  const [hh = 0, mm = 0] = PREVIEW_NOW_TIME.split(':').map(Number);
  const minutes = hh * 60 + mm - 60 * hours;
  const daysAgo = Math.max(0, Math.ceil(-minutes / DAY_MINUTES));
  const clock = minutes + DAY_MINUTES * daysAgo;
  const pad = (value: number) => String(value).padStart(2, '0');
  return { daysAgo, time: `${pad(Math.floor(clock / 60))}:${pad(clock % 60)}` };
}

/**
 * One row of a band list (the member card, quick 261012-qer B-1). `lastActive` is the scope's;
 * `topCommunityId` and `dailyMinutes` are the member's own, in every scope.
 */
export interface OwnerBandMember {
  id: string;
  name: string;
  /** ISO date the member joined. */
  memberSince: string;
  lastActive: RelativeMoment;
  topCommunityId: string;
  /** Average minutes in the app per day: an example (no usage sessions are recorded yet). */
  dailyMinutes: ReportValue<number>;
}

/** What the bands count: the whole base, one community's members, or one event's registrants. */
export type OwnerBandScope =
  | { kind: 'member' }
  | { kind: 'community'; id: string }
  | { kind: 'event'; id: string };

export interface OwnerBandList {
  members: OwnerBandMember[];
  /** The band's members not listed (the band count minus the rows). */
  more: number;
}

export interface OwnerRosterMember {
  id: string;
  name: string;
  memberSince: string;
  band: EngagementBand;
  lastActive: RelativeMoment;
  topCommunityId: string;
  dailyMinutes: ReportValue<number>;
  communities: Record<string, { band: EngagementBand; lastActive: RelativeMoment }>;
  /** The panel events the member RSVP'd "vou" to, oldest first. */
  eventIds: string[];
}

type UnregisteredMember = Omit<OwnerRosterMember, 'eventIds'>;

/** 12 names per band, in ENGAGEMENT_BAND_ORDER. Fictional; none is used elsewhere in the fixtures. */
const MEMBER_NAMES = [
  'Luana Ferraz',
  'Caio Menezes',
  'Débora Siqueira',
  'Henrique Prado',
  'Tatiane Moura',
  'Gustavo Rangel',
  'Priscila Antunes',
  'Rafael Quintana',
  'Camila Barreto',
  'Otávio Lacerda',
  'Juliana Teixeira',
  'Murilo Bastos',
  'Fernanda Paiva',
  'Leandro Assis',
  'Patrícia Nogueira',
  'Diego Valença',
  'Isabela Tavares',
  'Renato Couto',
  'Bruna Esteves',
  'Vinícius Correia',
  'Larissa Pimentel',
  'Thiago Brandão',
  'Aline Cardoso',
  'Fábio Monteiro',
  'Gabriela Sampaio',
  'Eduardo Falcão',
  'Natália Rezende',
  'Rodrigo Aguiar',
  'Simone Barros',
  'Matheus Leal',
  'Carolina Viana',
  'André Cavalcanti',
  'Vanessa Dutra',
  'Felipe Amaral',
  'Letícia Gomes',
  'Marcelo Sena',
  'Beatriz Fontes',
  'Lucas Damasceno',
  'Raquel Freitas',
  'Bruno Carvalho',
  'Helena Duarte',
  'Sérgio Rocha',
  'Mariana Pires',
  'Daniel Macedo',
  'Elisa Queiroz',
  'Hugo Pacheco',
  'Cecília Fonseca',
  'Alexandre Bezerra',
  'Jéssica Lima',
  'Ricardo Peixoto',
  'Lívia Medeiros',
  'Pedro Galvão',
  'Manuela Ribeiro',
  'Caetano Borges',
  'Sofia Araújo',
  'Leonardo Mattos',
  'Yasmin Coelho',
  'Gabriel Xavier',
  'Paloma Andrade',
  'Márcio Torres',
  'Clara Moraes',
  'Samuel Batista',
  'Tânia Furtado',
  'Davi Holanda',
  'Renata Guimarães',
  'Wagner Cunha',
  'Adriana Miranda',
  'Nelson Arruda',
  'Olívia Castro',
  'Rogério Pinto',
  'Heloísa Martins',
  'Fausto Bittencourt',
] as const;

/** The clock reading of slot j's last action, latest first. */
const TIMES = [
  '22:40',
  '21:15',
  '20:30',
  '19:05',
  '18:20',
  '16:45',
  '14:10',
  '12:35',
  '10:50',
  '09:25',
  '07:40',
  '06:10',
] as const;

const PER_BAND = TIMES.length;

/** Whole-base days since the last action, by band and slot: inside each band's window. */
const WHOLE_DAYS: Record<EngagementBand, (j: number) => number> = {
  new: (j) => j,
  superfan: (j) => Math.floor(j / 4),
  engaged: (j) => j,
  occasional: (j) => 4 + 2 * j,
  at_risk: (j) => 31 + 2 * j,
  inactive: (j) => 64 + 9 * j,
};

/** The example daily minutes by band and slot: superfãs the most, inactive none. */
const DAILY_MINUTES: Record<EngagementBand, (j: number) => number> = {
  new: (j) => 18 + 2 * j,
  superfan: (j) => 45 + 3 * j,
  engaged: (j) => 25 + 2 * j,
  occasional: (j) => 8 + j,
  at_risk: (j) => 2 + (j % 3),
  inactive: () => 0,
};

/** Days since the last action in a community where the member sits one band lower. */
const DROPPED_DAYS: Record<Exclude<EngagementBand, 'new'>, (whole: number, j: number) => number> = {
  superfan: (whole) => whole + 5,
  engaged: (whole) => whole + 10,
  occasional: (_whole, j) => 30 + j,
  at_risk: (_whole, j) => 60 + 5 * j,
  inactive: (whole) => whole + 20,
};

/**
 * Per community: from which slot a member has access (only the exclusive VIP is bought), and from
 * which slot a member sits one band lower there (null = never).
 */
const COMMUNITY_RULES: Record<string, { accessFrom: number; dropFrom: number | null }> = {
  'c-vip': { accessFrom: 2, dropFrom: null },
  'c-geral': { accessFrom: 0, dropFrom: 10 },
  'c-iniciantes': { accessFrom: 0, dropFrom: 6 },
  'c-eventos': { accessFrom: 0, dropFrom: 3 },
};

const DAY_MS = 86_400_000;

/** The ISO date `days` before `isoDate` (negative = after). */
export function daysBefore(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from an ISO date to the sample's today. */
export function daysSince(isoDate: string): number {
  return Math.round(
    (Date.parse(`${PREVIEW_TODAY}T00:00:00Z`) - Date.parse(`${isoDate}T00:00:00Z`)) / DAY_MS,
  );
}

function lowerBand(band: EngagementBand): EngagementBand {
  const index = ENGAGEMENT_BAND_ORDER.indexOf(band);
  return ENGAGEMENT_BAND_ORDER[Math.min(index + 1, ENGAGEMENT_BAND_ORDER.length - 1)] ?? band;
}

function at<T>(rows: readonly T[], index: number): T {
  const row = rows[index];
  if (row === undefined) throw new Error(`no row at index ${index}`);
  return row;
}

function buildMember(bandIndex: number, j: number): UnregisteredMember {
  const i = bandIndex * PER_BAND + j;
  const band = at(ENGAGEMENT_BAND_ORDER, bandIndex);
  const time = at(TIMES, j);
  const wholeDays = WHOLE_DAYS[band](j);
  const joinedDaysAgo = band === 'new' ? 12 + j : 40 + 23 * bandIndex + 9 * j;

  const communities: OwnerRosterMember['communities'] = {};
  const eligible: string[] = [];
  for (const [offset, { id }] of tenantOwnerPanel.byCommunity.entries()) {
    const rule = COMMUNITY_RULES[id];
    if (!rule) throw new Error(`no roster rule for community ${id}`);
    if (j < rule.accessFrom) continue;
    const drop = band !== 'new' && rule.dropFrom !== null && j >= rule.dropFrom;
    if (drop) {
      communities[id] = {
        band: lowerBand(band),
        lastActive: { daysAgo: DROPPED_DAYS[band](wholeDays, j), time },
      };
    } else {
      communities[id] = { band, lastActive: { daysAgo: wholeDays + offset, time } };
      eligible.push(id);
    }
  }

  return {
    id: `om-${String(i + 1).padStart(2, '0')}`,
    name: at(MEMBER_NAMES, i),
    memberSince: daysBefore(PREVIEW_TODAY, joinedDaysAgo),
    band,
    lastActive: { daysAgo: wholeDays, time },
    topCommunityId: at(eligible, j % eligible.length),
    dailyMinutes: { example: true, reason: 'needs_usage_sessions', value: DAILY_MINUTES[band](j) },
    communities,
  };
}

const unregistered: readonly UnregisteredMember[] = ENGAGEMENT_BAND_ORDER.flatMap(
  (_band, bandIndex) => Array.from({ length: PER_BAND }, (_, j) => buildMember(bandIndex, j)),
);

/** The scope's six bands; an id the fixture does not have is a bug, so it throws. */
export function ownerScopeBands(scope: OwnerBandScope): EngagementBands {
  if (scope.kind === 'member') return tenantOwnerPanel.engagement;
  const rows =
    scope.kind === 'community'
      ? tenantOwnerPanel.communityEngagement
      : tenantOwnerPanel.eventEngagement;
  const entry = rows.find((row) => row.id === scope.id);
  if (!entry) throw new Error(`no engagement bands for ${scope.kind} ${scope.id}`);
  return entry.bands;
}

const PAST_EVENTS = tenantOwnerPanel.events.past;
const EVENTS = [...PAST_EVENTS, ...tenantOwnerPanel.events.upcoming];

/** Nobody RSVPs to a past event before joining; anyone may have RSVP'd to an upcoming one. */
function eligible(member: UnregisteredMember, event: { id: string; date: string }): boolean {
  return !PAST_EVENTS.some((row) => row.id === event.id) || member.memberSince <= event.date;
}

/**
 * An event's registrants in the roster, per band: the first eligible slots (ascending j) up to the
 * band's registrant count, so every list adds up to the event's bands.
 */
function registers(member: UnregisteredMember, event: { id: string; date: string }): boolean {
  const count = ownerScopeBands({ kind: 'event', id: event.id }).counts[member.band];
  return unregistered
    .filter((row) => row.band === member.band && eligible(row, event))
    .slice(0, Math.min(count, PER_BAND))
    .some((row) => row.id === member.id);
}

export const ownerBandRoster: readonly OwnerRosterMember[] = unregistered.map((member) => ({
  ...member,
  eventIds: EVENTS.filter((event) => registers(member, event)).map((event) => event.id),
}));

/** Most recent first: fewer days ago, then a later clock reading, then the id. */
function byRecency(a: OwnerBandMember, b: OwnerBandMember): number {
  return (
    a.lastActive.daysAgo - b.lastActive.daysAgo ||
    (b.lastActive.time ?? '').localeCompare(a.lastActive.time ?? '') ||
    a.id.localeCompare(b.id)
  );
}

/** The member's band and last action in a scope, or null when the scope does not hold them. */
function scopeEntry(
  row: OwnerRosterMember,
  scope: OwnerBandScope,
): { band: EngagementBand; lastActive: RelativeMoment } | null {
  if (scope.kind === 'community') return row.communities[scope.id] ?? null;
  if (scope.kind === 'event' && !row.eventIds.includes(scope.id)) return null;
  return { band: row.band, lastActive: row.lastActive };
}

/**
 * The members of `band` in a scope (an id the fixture does not have throws): the
 * `OWNER_BAND_LIST_LIMIT` most recent, with the scope's last action, and how many more the band count
 * holds. An event's registrants sit in their whole-base band, with their whole-base last action.
 */
export function ownerBandList(scope: OwnerBandScope, band: EngagementBand): OwnerBandList {
  const count = ownerScopeBands(scope).counts[band];
  const members = ownerBandRoster
    .flatMap((row): OwnerBandMember[] => {
      const entry = scopeEntry(row, scope);
      if (entry?.band !== band) return [];
      const { id, name, memberSince, topCommunityId, dailyMinutes } = row;
      return [
        { id, name, memberSince, topCommunityId, dailyMinutes, lastActive: entry.lastActive },
      ];
    })
    .sort(byRecency)
    .slice(0, OWNER_BAND_LIST_LIMIT);
  return { members, more: count - members.length };
}

/**
 * Whether the member sits in `band` within the scope: the membership the band lists filter on (the
 * whole band, not only its listed rows). The URL parser uses it so a link cannot open a member outside
 * the band and scope it names (quick 261012-ri4 R-5).
 */
export function ownerBandIncludes(
  scope: OwnerBandScope,
  band: EngagementBand,
  memberId: string,
): boolean {
  const row = ownerBandRoster.find((member) => member.id === memberId);
  return row !== undefined && scopeEntry(row, scope)?.band === band;
}
