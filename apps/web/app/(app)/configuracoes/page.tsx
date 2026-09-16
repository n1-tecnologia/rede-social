import { THEME_COOKIE } from '@tria/contracts/branding';
import { iconFor, ThemeToggle } from '@tria/core/ui';
import { Button, Card, PageHeader, SectionTitle, StatusPill } from '@tria/ui';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { requireBootstrap } from '@/lib/bootstrap';
import { requirePlatformTenants } from '@/lib/platform';
import { getHostTenant } from '@/lib/tenant-host';
import { logout, setTheme } from '../actions';
import { ActionToast } from './ActionToast';

/** Prototype settings row geometry (UI-SPEC §Shell Contract, Settings): icon 20, 14px label, trailing slot. */
function Row({ icon, label, trailing }: { icon: string; label: string; trailing: ReactNode }) {
  const Icon = iconFor(icon);
  return (
    <div className="flex w-full items-center gap-3 px-4 py-3.5">
      <Icon aria-hidden size={20} className="shrink-0 text-text-secondary" />
      <span className="min-w-0 flex-1 truncate text-sm text-text">{label}</span>
      {trailing}
    </div>
  );
}

function Group({
  title,
  children,
  first = false,
}: {
  title: string;
  children: ReactNode;
  first?: boolean;
}) {
  return (
    <section className={first ? undefined : 'border-t border-border'}>
      <SectionTitle variant="group" className="px-4 pt-4 pb-2">
        {title}
      </SectionTitle>
      {children}
    </section>
  );
}

/**
 * `/configuracoes` (D-42): the kernel's settings page — theme toggle (D-41), placeholder rows that
 * Phase 3 (profile) and Phase 7 (push) wire, the app version and "Sair" (D-08, this device only).
 * Server-rendered: the Switch reads its initial state from the `tria_theme` cookie, so there is no
 * loading state (E05/loading). On the platform host only Preferências and Sair render.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const [hostTenant, t, cookieStore, params] = await Promise.all([
    getHostTenant(),
    getTranslations('app'),
    cookies(),
    searchParams,
  ]);
  const platform = hostTenant.mode === 'platform';
  if (platform) await requirePlatformTenants();
  else await requireBootstrap();

  const theme = cookieStore.get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  const version =
    process.env.NEXT_PUBLIC_APP_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';
  const LogoutIcon = iconFor('log-out');
  const soon = <StatusPill tone="neutral">{t('settings.soon')}</StatusPill>;

  return (
    <div className="flex flex-col gap-4">
      {params.erro === 'sair' ? <ActionToast message={t('settings.logoutFailed')} /> : null}
      <PageHeader
        title={t('settings.title')}
        backHref="/inicio"
        backLabel={t('settings.back')}
        className="md:static md:px-0"
      />
      <Card className="rounded-none bg-transparent shadow-none md:rounded-xl md:bg-card md:shadow-[0_1px_3px_rgba(22,35,59,.06)]">
        {platform ? null : (
          <Group title={t('settings.groups.account')} first>
            <Row icon="user-circle" label={t('settings.rows.editProfile')} trailing={soon} />
          </Group>
        )}
        <Group title={t('settings.groups.preferences')} first={platform}>
          <Row
            icon="moon"
            label={t('settings.rows.darkTheme')}
            trailing={
              <ThemeToggle initial={theme} label={t('settings.rows.darkTheme')} action={setTheme} />
            }
          />
          {platform ? null : (
            <Row icon="bell" label={t('settings.rows.notifications')} trailing={soon} />
          )}
        </Group>
        {platform ? null : (
          <Group title={t('settings.groups.about')}>
            <Row icon="info" label={t('settings.rows.version', { version })} trailing={null} />
          </Group>
        )}
        <form action={logout} className="border-t border-border p-4">
          <Button type="submit" variant="ghost" fullWidth className="text-danger">
            <LogoutIcon aria-hidden size={18} />
            {t('logout')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
