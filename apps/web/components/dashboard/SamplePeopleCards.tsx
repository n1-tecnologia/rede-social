import { type ContentPerson, OWNER_BAND_LIST_LIMIT } from '@rede-social/module-dashboard/fixtures';
import { cn } from '@rede-social/ui';
import type { ReactNode } from 'react';
import { contentMemberAnchor } from '@/lib/owner-content-view';
import { bandLabel, type DashboardT } from './format';
import { MemberCard } from './OwnerListRows';
import { DisabledAction } from './PanelSection';
import { sampleMemberCard } from './sample-lookups';

/*
 * The SAMPLE people cards (08.7-07: out of OwnerContentPeople.tsx, which now reads the API). Only the
 * still-sample Financeiro area draws them, until 08.7-10 wires its buyer lists and deletes this file.
 */

const KEY = 'tenantOwner.content.people';

/** A people list that reads across the whole area: two columns from 56rem, three from 100rem. */
const WIDE_GRID = '@4xl:grid-cols-2 @min-[100rem]:grid-cols-3';

/**
 * Member cards, the first OWNER_BAND_LIST_LIMIT of `people`, each saying when the person did it and
 * (outside a band) their band; then, when the list is shorter than its number, how many more the
 * number holds, in the list's own unit, with a disabled "Ver todos" (the Membros pattern). Each card
 * opens the member one level down; the cards rise one after the other. A number with nobody in the
 * sample says so in one sentence instead: "e mais N" never follows zero cards (quick 261014-ia8 F-2).
 * `wide` lays the cards in columns across the whole area (the web); else they stack.
 */
export function PeopleCards<P extends ContentPerson>({
  t,
  people,
  total,
  hrefOf,
  leadOf,
  showBand,
  moreText,
  statusOf,
  emptyText,
  wide = false,
}: {
  t: DashboardT;
  people: readonly P[];
  total: number;
  hrefOf: (memberId: string) => string;
  /** The line under the name: when the person did it ("Curtiu há 3 dias"). */
  leadOf: (person: P) => string;
  /** False inside a band, where every card would repeat the same "Faixa:". */
  showBand: boolean;
  /** "e mais N …" in the list's unit. */
  moreText: (more: number) => string;
  statusOf?: (person: P) => ReactNode;
  /** The sentence when the number has people but none of them is in the sample. */
  emptyText?: string;
  /** The list spans the whole area: columns from a 56rem container. */
  wide?: boolean;
}) {
  const shown = people.slice(0, OWNER_BAND_LIST_LIMIT);
  const more = total - shown.length;
  if (shown.length === 0) {
    return total > 0 ? (
      <p className="text-sm text-text-secondary">{emptyText ?? t(`${KEY}.emptySample`)}</p>
    ) : null;
  }
  return (
    <>
      <ul data-dash-stagger className={cn('grid gap-3', wide && WIDE_GRID)}>
        {shown.map((person) => (
          <li key={person.id} className="min-w-0">
            <MemberCard
              member={sampleMemberCard(t, person, hrefOf(person.id), {
                bandLine: showBand ? bandLabel(t, person.band) : undefined,
                lead: leadOf(person),
              })}
              id={contentMemberAnchor(person.id)}
              status={statusOf?.(person)}
            />
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-text-secondary">{moreText(more)}</p>
          <DisabledAction>{t('tenantOwner.bandMembers.seeAll')}</DisabledAction>
        </div>
      ) : null}
    </>
  );
}
