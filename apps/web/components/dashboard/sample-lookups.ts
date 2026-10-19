import { type OwnerBandMember, tenantOwnerPanel } from '@rede-social/module-dashboard/fixtures';
import type { MemberRowView } from '@/lib/owner-list-view';
import {
  communityLabel,
  type DashboardT,
  formatBrlCompact,
  formatHoursMinutes,
  formatMonthYear,
  initials,
} from './format';

/*
 * The SAMPLE lookups of the owner panel's areas that are not on real data yet (08.7-05). Membros
 * left the fixtures in 08.7-05, so its components (`BandScopeCards`, `BandMembers`) no longer hold
 * these; the Conteúdo, Eventos and Financeiro areas keep reading them here until their own plans
 * (08.7-07, 08.7-08, 08.7-10) wire them, and those plans delete what they stop using.
 */

const ALL_EVENTS = [...tenantOwnerPanel.events.past, ...tenantOwnerPanel.events.upcoming];

/** A sample community by its fixture id; an id the fixture does not have is a bug. */
export function ownerCommunity(id: string) {
  const community = tenantOwnerPanel.byCommunity.find((row) => row.id === id);
  if (!community) throw new Error(`no community ${id}`);
  return community;
}

/** A sample event by its fixture id; an id the fixture does not have is a bug. */
export function ownerEvent(id: string) {
  const event = ALL_EVENTS.find((row) => row.id === id);
  if (!event) throw new Error(`no event ${id}`);
  return event;
}

/** A sample event as `EventCard` draws it: its name and format, with no cover asset. */
export function sampleEventCard(id: string): {
  name: string;
  format: 'in_person' | 'online';
  coverAssetId: null;
} {
  const event = ownerEvent(id);
  return { name: event.name, format: event.format, coverAssetId: null };
}

/**
 * An event's example receita: RSVPs × the example ticket price, the one formula of every sample
 * card. A free event reads "Gratuito", not "R$ 0,00". Membros' event card no longer shows it (its
 * "Receita" is "Em breve", D-455).
 */
export function eventRevenue(
  t: DashboardT,
  event: { confirmed: number; ticketCents: { value: number } },
) {
  const cents = event.confirmed * event.ticketCents.value;
  return cents === 0 ? t('tenantOwner.scopeCards.event.free') : formatBrlCompact(cents);
}

/** A sample roster member as the shared `MemberCard` draws it (Conteúdo's people, P1). */
export function sampleMemberCard(
  t: DashboardT,
  member: OwnerBandMember,
  href: string,
  extra: { bandLine?: string; lead?: string } = {},
): Omit<MemberRowView, 'type' | 'id'> {
  const key = 'tenantOwner.bandMembers';
  return {
    href,
    name: member.name,
    initials: initials(member.name),
    lead: extra.lead,
    lines: [
      ...(extra.bandLine ? [{ label: t(`${key}.band`), value: extra.bandLine }] : []),
      { label: t(`${key}.since`), value: formatMonthYear(member.memberSince) },
      {
        label: t(`${key}.lastActive`),
        value: t(`${key}.when`, {
          days: member.lastActive.daysAgo,
          time: member.lastActive.time ?? '',
        }),
      },
      {
        label: t(`${key}.topCommunity`),
        value: communityLabel(t, ownerCommunity(member.topCommunityId)),
      },
      {
        label: t(`${key}.dailyTime`),
        value: formatHoursMinutes(t, member.dailyMinutes.value),
      },
    ],
  };
}
