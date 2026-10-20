import { PageHeader } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { MembersSkeleton } from '@/components/profile/MembersSkeleton';

/**
 * `/perfil/seguidores` loading (UI-D-502, UI-D-511): the page header at once and the SAME eight rows the
 * directory shows while it loads, so the shape never changes when the list resolves.
 */
export default function FollowersLoading() {
  const t = useTranslations('social');
  const tm = useTranslations('members');

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col" aria-busy>
      <PageHeader
        title={t('followers.title')}
        backHref="/perfil"
        backLabel={tm('back')}
        stickyTop="0px"
        className="md:static md:px-0"
      />
      <MembersSkeleton />
    </div>
  );
}
