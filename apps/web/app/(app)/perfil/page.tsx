import { iconFor } from '@tria/core/ui';
import { Avatar, PageHeader, StatusPill } from '@tria/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { getHostTenant } from '@/lib/tenant-host';

/**
 * `/perfil` — the Perfil tab's target (D-40/D-42), a minimal presentational kernel page: avatar,
 * display name, e-mail, role, and the row to `/configuracoes`. Phase 3 replaces it with the profile
 * module UI. The platform host has no membership to show, so it lands back on `/inicio`.
 */
export default async function ProfilePage() {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const [t, { user, membership }] = await Promise.all([getTranslations('app'), requireBootstrap()]);
  const SettingsIcon = iconFor('settings');
  const ChevronIcon = iconFor('chevron-right');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('profile.title')}
        backHref="/inicio"
        backLabel={t('settings.back')}
        className="md:static md:px-0"
      />

      <div className="flex flex-col items-center gap-3 px-4 text-center">
        <Avatar size="xl" src={membership.profile.avatarUrl} alt={membership.profile.displayName} />
        <h2 className="text-2xl font-bold tracking-[-0.02em] text-text">
          {membership.profile.displayName}
        </h2>
        <p className="text-sm text-text-secondary">{user.email}</p>
        <StatusPill tone="brand">{t(`role.${membership.role}`)}</StatusPill>
      </div>

      <Link
        href="/configuracoes"
        className="flex w-full items-center gap-3 border-t border-border px-4 py-3.5 text-text transition-colors hover:bg-bg-hover md:rounded-xl md:border md:bg-card"
      >
        <SettingsIcon aria-hidden size={20} className="shrink-0 text-text-secondary" />
        <span className="min-w-0 flex-1 truncate text-sm">{t('profile.settings')}</span>
        <ChevronIcon aria-hidden size={18} className="shrink-0 text-text-tertiary" />
      </Link>
    </div>
  );
}
