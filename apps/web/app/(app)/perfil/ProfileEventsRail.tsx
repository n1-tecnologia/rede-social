import { EventPoster } from '@rede-social/module-events/ui';
import { CalendarDays, CircleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { EventLiveNote } from '@/components/events/EventLiveNote';
import {
  ProfileEmptyCard,
  ProfileRail,
  ProfileRailItem,
} from '@/components/profile/ProfileSection';
import { eventSectionsView } from '@/lib/events-view';
import { profileEventSections } from '@/lib/profile-activity';
import { PROFILE_RAIL_SIZE } from '@/lib/profile-activity-view';

/**
 * The "Eventos" section of `/perfil` (2026-10-12): the "Meus eventos" gallery of `/eventos` (the
 * events the member is in that have not ended, then the ended ones they checked in to, in the API's
 * order), at most `PROFILE_RAIL_SIZE` posters in the same sideways rail; the section's "Ver todos"
 * opens `/eventos/meus`. It shares the events read with "Atividades" (`profileEventSections`, one
 * request per render), and a failed read is this section's own error card.
 *
 * Phase 10.2: the poster's note is the live count of the shared card view (`EventLiveNote`), exactly as
 * in the gallery: the holder's count to a paid event runs through the check-in window until the start
 * (A-UI-15, one branch in `lib/events-view.ts`), and a free event draws its shipped note.
 */
export async function ProfileEventsRail({ tz, nowMs }: { tz: string; nowMs: number }) {
  const [t, te, sections] = await Promise.all([
    getTranslations('profile'),
    getTranslations('events'),
    profileEventSections(),
  ]);

  if (!sections) {
    return (
      <ProfileEmptyCard
        icon={CircleAlert}
        title={t('sectionErrors.title')}
        body={t('sectionErrors.events')}
        action={{ href: '/perfil', label: t('sectionErrors.retry'), variant: 'outline' }}
      />
    );
  }

  const cards = eventSectionsView(sections, { tz, nowMs, t: te }).mine.slice(0, PROFILE_RAIL_SIZE);
  if (cards.length === 0) {
    return (
      <ProfileEmptyCard
        icon={CalendarDays}
        title={te('sections.mine.emptyTitle')}
        body={te('sections.mine.emptyBody')}
        action={{ href: '/eventos', label: te('reine.mine.explore'), variant: 'filled' }}
      />
    );
  }

  // Lazy posters: the rail sits under "Atividades", below the fold of a phone.
  return (
    <ProfileRail>
      {cards.map((card) => (
        <ProfileRailItem key={card.id}>
          <EventPoster
            href={card.href}
            ariaLabel={card.ariaLabel}
            title={card.title}
            category={card.category}
            place={card.place}
            placeKind={card.placeKind}
            badge={card.badge}
            note={
              card.note !== undefined || card.countdown ? (
                <EventLiveNote note={card.note ?? ''} countdown={card.countdown} surface="poster" />
              ) : undefined
            }
            coverAssetId={card.coverAssetId}
            coverVariantWidths={card.coverVariantWidths}
            coverAlt={card.coverAlt}
            grayscale={card.grayscale}
          />
        </ProfileRailItem>
      ))}
    </ProfileRail>
  );
}
