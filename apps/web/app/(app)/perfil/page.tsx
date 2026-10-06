import { iconFor } from '@rede-social/core/ui';
import { Card, EmptyState, PageHeader } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { getBootstrap } from '@/lib/bootstrap';
import { loadOwnProfile } from '@/lib/profile';
import { getHostTenant } from '@/lib/tenant-host';

/** Settings-row geometry [proto], shared by `/perfil` and `/configuracoes`: icon 20, 14px label, chevron 18. */
function Row({ href, icon, label }: { href: string; icon: string; label: string }) {
  const Icon = iconFor(icon);
  const Chevron = iconFor('chevron-right');
  return (
    <Link
      href={href}
      className="flex w-full items-center gap-3 border-t border-border px-4 py-3.5 text-text transition-colors hover:bg-bg-hover"
    >
      <Icon aria-hidden size={20} className="shrink-0 text-text-secondary" />
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <Chevron aria-hidden size={18} className="shrink-0 text-text-tertiary" />
    </Link>
  );
}

/**
 * `/perfil` (PROF-01, UI-SPEC §Own profile): the member's real profile — photo, display name, e-mail
 * and bio — over three rows: "Editar perfil", "Membros" (the directory entry point, R-11: a row, not
 * a fifth nav tab) and "Configurações". The Phase 2 stub's role `StatusPill` is GONE (UI-D-01): no
 * brand fill appears on this screen at all.
 *
 * The platform host has no membership to show, so it lands back on `/inicio` (unchanged from the
 * stub). A refusal the bootstrap map knows redirects inside `loadOwnProfile`; anything else renders
 * the generic "Tentar novamente" empty state here rather than the app-level error page (E1/error).
 */
export default async function ProfilePage() {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const [t, tf, profile, bootstrap] = await Promise.all([
    getTranslations('profile'),
    getTranslations('feed'),
    loadOwnProfile(),
    getBootstrap(),
  ]);
  // The viewer's OWN role: the only one this screen may know (D-47).
  const adminLabel = bootstrap.membership.role === 'admin_tenant' ? tf('post.adminBadge') : null;

  if (!profile) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('title')}
          backHref="/inicio"
          backLabel={t('back')}
          className="md:static md:px-0"
        />
        <EmptyState
          variant="card"
          icon={CircleAlert}
          title={t('errors.title')}
          body={t('errors.generic')}
          action={
            <a
              href="/perfil"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
            >
              {t('errors.retry')}
            </a>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        backHref="/inicio"
        backLabel={t('back')}
        className="md:static md:px-0"
      />

      <ProfileHeader
        displayName={profile.displayName}
        avatarAssetId={profile.avatarAssetId}
        bio={profile.bio}
        email={profile.email}
        adminLabel={adminLabel}
      />

      <Card className="rounded-none bg-transparent shadow-none md:rounded-xl md:bg-card md:shadow-[0_1px_3px_rgba(22,35,59,.06)]">
        <Row href="/perfil/editar" icon="user-circle" label={t('rows.editProfile')} />
        <Row href="/membros" icon="users" label={t('rows.members')} />
        <Row href="/configuracoes" icon="settings" label={t('rows.settings')} />
      </Card>
    </div>
  );
}
