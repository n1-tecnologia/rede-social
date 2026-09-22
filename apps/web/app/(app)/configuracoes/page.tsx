import { THEME_COOKIE } from '@tria/contracts/branding';
import { iconFor, ThemeToggle } from '@tria/core/ui';
import { Button, Card, PageHeader, SectionTitle, StatusPill } from '@tria/ui';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { requireBootstrap } from '@/lib/bootstrap';
import { requirePlatformTenants } from '@/lib/platform';
import { getHostTenant } from '@/lib/tenant-host';
import { logout, setTheme } from '../actions';
import { ActionToast } from './ActionToast';

/**
 * Prototype settings row geometry (UI-SPEC §Shell Contract, Settings): icon 20, 14px label,
 * trailing slot. With `href` the WHOLE row becomes the link and the trailing slot defaults to the
 * chevron every navigating row carries (03-04: "Editar perfil" stopped being an "Em breve" pill).
 */
function Row({
  icon,
  label,
  trailing,
  href,
}: {
  icon: string;
  label: string;
  trailing: ReactNode;
  href?: string;
}) {
  const Icon = iconFor(icon);
  const Chevron = iconFor('chevron-right');
  const inner = (
    <>
      <Icon aria-hidden size={20} className="shrink-0 text-text-secondary" />
      <span className="min-w-0 flex-1 truncate text-sm text-text">{label}</span>
      {href
        ? (trailing ?? <Chevron aria-hidden size={18} className="shrink-0 text-text-tertiary" />)
        : trailing}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="flex w-full items-center gap-3 px-4 py-3.5 transition-colors hover:bg-bg-hover"
      >
        {inner}
      </Link>
    );
  }

  return <div className="flex w-full items-center gap-3 px-4 py-3.5">{inner}</div>;
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
  let role: string | null = null;
  if (platform) await requirePlatformTenants();
  else role = (await requireBootstrap()).membership.role;

  // E7/partial + E7/zero-one-many: the whole group — its `SectionTitle` included — is ABSENT from
  // the DOM for every role but `admin_tenant`, never rendered-and-disabled. A member must not learn
  // that an admin media screen exists, which is also why `/configuracoes/midia` itself answers
  // `notFound()` rather than a 403 screen.
  const isTenantAdmin = role === 'admin_tenant';

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
            <Row
              icon="user-circle"
              label={t('settings.rows.editProfile')}
              href="/perfil/editar"
              trailing={null}
            />
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
        {isTenantAdmin ? (
          <Group title={t('settings.groups.admin')}>
            <Row
              icon="film"
              label={t('settings.rows.media')}
              href="/configuracoes/midia"
              trailing={null}
            />
          </Group>
        ) : null}
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
