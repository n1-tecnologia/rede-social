import { CalendarClock, CircleAlert } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { MemberActivityReport } from '@/components/profile/activity/MemberActivityReport';
import { ProfileEmptyCard } from '@/components/profile/ProfileSection';
import { getMemberActivity } from '@/lib/dashboard';
import { freshnessText } from '@/lib/dashboard-view';

/**
 * The body of `/perfil`'s "Sua atividade" (08.7-03, D-463, D-464, UI-D-468, UI-D-469, UI-D-479),
 * streamed in its own `Suspense` under the section's title and "Últimos 7 dias". It awaits the
 * member's OWN read (`getMemberActivity`, `GET /v1/dashboard/activity`, preloaded by the page) and
 * maps it:
 * - ready → the report on the member's numbers, its freshness line first, in the tenant's zone;
 * - preparing (no build has the member yet) → the preparing card, no action, never a sample;
 * - a failed read → this section's error card with an outline "Tentar novamente" to
 *   `/perfil#activity`, never `app/error.tsx` (the loader never throws);
 * - a session refusal → the bootstrap's navigation.
 */
export async function ProfileActivity({ tz, nowMs }: { tz: string; nowMs: number }) {
  const [t, ta, tr, result] = await Promise.all([
    getTranslations('profile'),
    getTranslations('profile.activity'),
    getTranslations('dashboard.report'),
    getMemberActivity(),
  ]);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'error') {
    return (
      <ProfileEmptyCard
        icon={CircleAlert}
        title={t('sectionErrors.title')}
        body={t('sectionErrors.activity')}
        action={{ href: '/perfil#activity', label: t('sectionErrors.retry'), variant: 'outline' }}
      />
    );
  }
  const answer = result.answer;
  if (answer.state === 'preparing') {
    return (
      <ProfileEmptyCard
        icon={CalendarClock}
        title={tr('preparing.member.title')}
        body={tr('preparing.member.body')}
      />
    );
  }
  const freshness = freshnessText(answer.snapshot, tz, nowMs);
  return (
    <MemberActivityReport
      t={ta}
      tr={tr}
      answer={answer}
      freshness={tr(`freshness.${freshness.key}`, freshness.values)}
    />
  );
}
