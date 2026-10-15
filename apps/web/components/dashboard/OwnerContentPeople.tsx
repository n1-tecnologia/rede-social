import {
  type ContentPerson,
  type ContentWho,
  type EngagementBand,
  OWNER_BAND_LIST_LIMIT,
  ownerContentInteractions,
  ownerContentInteractors,
  ownerContentItem,
  ownerContentPeople,
} from '@rede-social/module-dashboard/fixtures';
import { CountUp, RISE, SURFACE } from '@rede-social/module-dashboard/ui';
import { Card, cn, StatusPill } from '@rede-social/ui';
import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  contentBackHref,
  contentMemberAnchor,
  contentPostAnchor,
  type OwnerContentView,
  ownerContentHref,
} from '@/lib/owner-content-view';
import { BackLink } from './BackLink';
import { MemberCard } from './BandMembers';
import { CoverThumb } from './CoverThumb';
import { bandLabel, type DashboardT, formatCount, momentText } from './format';
import { SPAN_ALL } from './ownerGrid';
import { DisabledAction, PanelSection } from './PanelSection';

/*
 * The only web file that reads `ownerContentPeople`, `ownerContentInteractors` and
 * `ownerContentInteractions`: the names behind the Conteúdo numbers (P1) reach the client's own team
 * only, never a comment's text (the unanswered ones are OwnerContentReplies.tsx's), and no views or
 * reach number ever leads here (P3).
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
              t={t}
              member={person}
              band={showBand ? person.band : undefined}
              lead={leadOf(person)}
              id={contentMemberAnchor(person.id)}
              href={hrefOf(person.id)}
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

/**
 * Who did one of a publication's numbers (D-06, P1): "Voltar" to that number, the title, which
 * publication, the count, then the member cards most recent first, each saying when the person did
 * it — commenters the team has not answered first, marked "Sem resposta" (PD-9: never the comment's
 * text here). Each card opens the member's insights. It reads across the whole area.
 */
export function OwnerContentPeople({ t, view }: { t: DashboardT; view: OwnerContentView }) {
  const back = contentBackHref(view);
  // The parser only sets `who` with a publication that has that number: a gap here is a bug.
  if (!view.postId || !view.who || back === null) throw new Error('a people list with no number');
  const item = ownerContentItem(view.postId);
  const { people, total } = ownerContentPeople(view.postId, view.who);
  const who: ContentWho = view.who;

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', SPAN_ALL)}>
      <BackLink href={back} label={t('tenantOwner.memberDetail.back')} />
      <PanelSection title={t(`${KEY}.title.${view.who}`)} prominent>
        <p className="text-sm text-text [overflow-wrap:anywhere]">{item.excerpt}</p>
        <p className="text-sm text-text-secondary">
          <CountUp value={t(`${KEY}.count.${view.who}`, { count: total })} />
        </p>
        {total === 0 ? (
          <p className="text-sm text-text-secondary">{t(`${KEY}.empty.${view.who}`)}</p>
        ) : (
          <PeopleCards
            t={t}
            people={people}
            total={total}
            hrefOf={(memberId) => ownerContentHref({ ...view, memberId, list: null })}
            leadOf={(person) => t(`${KEY}.when.${who}`, { when: momentText(t, person.when) })}
            showBand
            moreText={(more) => t(`${KEY}.more.${who}`, { count: more })}
            statusOf={(person) =>
              person.answered === false ? (
                <StatusPill tone="warning">{t(`${KEY}.unanswered`)}</StatusPill>
              ) : null
            }
            wide
          />
        )}
      </PanelSection>
    </div>
  );
}

/**
 * The members who interacted with the content in 30 days (PD-5): of one band (inside "Quem interage",
 * where the cards do not repeat the band) or all of them (the Membros que interagiram number), most
 * recent first, each saying when they last interacted. `wide` when the list spans the whole area.
 */
export function InteractorList({
  t,
  view,
  band,
  wide = false,
}: {
  t: DashboardT;
  view: OwnerContentView;
  band: EngagementBand | null;
  wide?: boolean;
}) {
  const { people, total } = ownerContentInteractors(band);
  return (
    <PeopleCards
      t={t}
      people={people}
      total={total}
      hrefOf={(memberId) => ownerContentHref({ ...view, band, memberId, list: null })}
      leadOf={(person) => t(`${KEY}.when.interacted`, { when: momentText(t, person.when) })}
      showBand={band === null}
      moreText={(more) => t('tenantOwner.bandMembers.more', { count: more })}
      wide={wide}
    />
  );
}

/**
 * The interactions themselves (PD-7): the publication's thumbnail (decorative, quick 261013-orf D-01),
 * who, their band, liked or commented, which publication and when, most recent first; each row opens
 * the publication. The first row of a publication carries its anchor, so the detail's "Voltar" lands
 * on it. One list card on the report's surface, two columns of rows on the web.
 */
export function InteractionList({ t, view }: { t: DashboardT; view: OwnerContentView }) {
  const { rows, total } = ownerContentInteractions();
  const shown = rows.slice(0, OWNER_BAND_LIST_LIMIT);
  const more = total - shown.length;
  const key = 'tenantOwner.content.interactions';
  const anchored = new Set<string>();
  return (
    <>
      <Card className={cn(SURFACE, RISE, 'overflow-hidden')}>
        <ul className="grid divide-y divide-border @4xl:grid-cols-2 @4xl:gap-x-6 @4xl:divide-y-0 @4xl:px-3">
          {shown.map((row) => {
            const first = !anchored.has(row.itemId);
            anchored.add(row.itemId);
            const item = ownerContentItem(row.itemId);
            return (
              <li
                key={`${row.person.id}-${row.action}-${row.itemId}`}
                className="@4xl:border-b @4xl:border-border @4xl:[&:nth-last-child(-n+2)]:border-b-0"
              >
                <a
                  id={first ? contentPostAnchor(row.itemId) : undefined}
                  href={ownerContentHref({ ...view, postId: row.itemId })}
                  className="group/link flex scroll-mt-20 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                >
                  <CoverThumb
                    t={t}
                    kind={item.kind}
                    seed={item.id}
                    durationSeconds={item.durationSeconds}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
                    <span className="text-sm font-bold text-text">{row.person.name}</span>
                    <span className="text-xs text-text-secondary">
                      {t(`${key}.line`, {
                        band: bandLabel(t, row.person.band),
                        action: t(`${key}.${row.action}`),
                        when: momentText(t, row.when),
                      })}
                    </span>
                    <span className="line-clamp-2 text-xs text-text">{item.excerpt}</span>
                  </span>
                  <ArrowUpRight
                    aria-hidden
                    size={16}
                    className="shrink-0 text-text-tertiary transition-[color,transform] duration-300 ease-out group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 group-hover/link:text-brand motion-reduce:transition-none"
                  />
                </a>
              </li>
            );
          })}
        </ul>
      </Card>
      {more > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-text-secondary">
            {t(`${key}.more`, { count: more, value: formatCount(more) })}
          </p>
          <DisabledAction>{t(`${key}.seeAll`)}</DisabledAction>
        </div>
      ) : null}
    </>
  );
}
