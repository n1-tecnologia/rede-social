import { THEME_COOKIE } from '@rede-social/contracts/branding';
import { KERNEL_PERMISSIONS } from '@rede-social/contracts/moderation';
import { iconFor, ThemeToggle } from '@rede-social/core/ui';
import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { STORY_PERMISSIONS } from '@rede-social/module-stories/contracts';
import { Button, Card, PageHeader, SectionTitle } from '@rede-social/ui';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PushSettingRow } from '@/components/push/PushControls';
import { LogoutForm } from '@/components/shell/LogoutForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { env } from '@/lib/env';
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
 * `/configuracoes` (D-42): the kernel's settings page — theme toggle (D-41), the profile row (Phase 3),
 * this device's push switch (Phase 7, UI-D-256), the app version and "Sair" (D-08, this device only).
 * Server-rendered: the Switch reads its initial state from the `rede_theme` cookie, so there is no
 * loading state (E05/loading). On the platform host only Preferências and Sair render.
 *
 * Back (2026-10-09) returns to the screen the member came from; opened directly, it falls back to
 * `/perfil`, the screen that lists Configurações on the phone (the platform host's `/perfil`
 * redirects to `/inicio`).
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const [hostTenant, t, ta, cookieStore, params] = await Promise.all([
    getHostTenant(),
    getTranslations('app'),
    getTranslations('admin'),
    cookies(),
    searchParams,
  ]);
  const platform = hostTenant.mode === 'platform';
  let role: string | null = null;
  // UI-D-29's second door is gated on the composed PERMISSION rather than on the role beside it
  // (T-05-48): `stories.story.manage` is the identical value `requirePermission` evaluates on the
  // API, so V2 handing story management to another role is a settings flip with no web change.
  // A tenant without the `stories` module carries neither the permission nor the row.
  let canManageStories = false;
  // 08-01 (D-339, UI-D-269): the Moderação row, gated on the composed PERMISSION — the value the
  // API's `requirePermission('moderation.manage')` reads — never on the role (D-338).
  let canModerate = false;
  // 08-04 (D-339, D-340, UI-D-269): the Membros row needs `members.manage` OR `moderation.manage` —
  // unblocking lives there, so a moderator must be able to reach it.
  let canSeeMembers = false;
  // 08-06 (D-339, D-342, UI-D-269): the Marca row, gated on `tenant.manage` — the value the API's
  // `/v1/admin/branding` guard reads — and absent from the DOM without it. 08-07: the Regras row
  // shares the same gate (`/v1/admin/rules`).
  let canManageBrand = false;
  // 07 review C-WR-01: the push row only where the notifications module is on (the API refuses the
  // push routes otherwise, after the browser's permission prompt had already been spent).
  let notificationsOn = false;
  // 08.2-07 (D-339, D-340, D-362, UI-D-382): the Loja row, gated on the composed PERMISSION — the
  // value the API's `requirePermission('store.product.manage')` reads, composed only while the
  // store module is on — and absent from the DOM without it.
  let canManageStore = false;
  let tenantName = '';
  if (platform) await requirePlatformTenants();
  else {
    const bootstrap = await requireBootstrap();
    role = bootstrap.membership.role;
    tenantName = bootstrap.tenant.displayName;
    canManageStories = bootstrap.permissions.includes(STORY_PERMISSIONS.manage);
    canModerate = bootstrap.permissions.includes(KERNEL_PERMISSIONS.moderationManage);
    canSeeMembers = canModerate || bootstrap.permissions.includes(KERNEL_PERMISSIONS.membersManage);
    canManageBrand = bootstrap.permissions.includes(KERNEL_PERMISSIONS.tenantManage);
    canManageStore = bootstrap.permissions.includes(STORE_PERMISSIONS.manage);
    notificationsOn = bootstrap.modules.some((module) => module.key === 'notifications');
  }

  // E7/partial + E7/zero-one-many: the whole group — its `SectionTitle` included — is ABSENT from
  // the DOM unless one of its rows renders (Marca, Membros, Regras da comunidade, Moderação, Mídia, Seus stories), never rendered-and-disabled. A member must not learn
  // that an admin media screen exists, which is also why `/configuracoes/midia` itself answers
  // `notFound()` rather than a 403 screen.
  const isTenantAdmin = role === 'admin_tenant';

  const theme = cookieStore.get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  const version =
    process.env.NEXT_PUBLIC_APP_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';
  const LogoutIcon = iconFor('log-out');

  return (
    <div className="flex flex-col gap-4">
      {params.erro === 'sair' ? <ActionToast message={t('settings.logoutFailed')} /> : null}
      {/* UI-D-284: an admin action refused with 403 FORBIDDEN (the permission was lost in another
          tab) lands here — the Marca page itself would now answer notFound(). */}
      {params.erro === 'sem-permissao' ? <ActionToast message={ta('errors.forbidden')} /> : null}
      <PageHeader
        title={t('settings.title')}
        backHref="/perfil"
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
          {/* 07-07 (UI-D-256): this device's push switch replaces the "Em breve" pill. Its server
              render is the `checking` state; the real one is decided after mount. */}
          {platform || !notificationsOn ? null : (
            <PushSettingRow
              vapidKey={env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
              tenantName={tenantName}
            />
          )}
        </Group>
        {isTenantAdmin ||
        canManageStories ||
        canModerate ||
        canSeeMembers ||
        canManageBrand ||
        canManageStore ? (
          <Group title={t('settings.groups.admin')}>
            {/* UI-D-269 order: Marca, Membros, Regras da comunidade, Moderação, then (08.2-07,
                UI-D-382) Loja, then the shipped Mídia and Seus stories rows. */}
            {canManageBrand ? (
              <Row
                icon="palette"
                label={t('settings.rows.brand')}
                href="/configuracoes/marca"
                trailing={null}
              />
            ) : null}
            {canSeeMembers ? (
              <Row
                icon="users"
                label={t('settings.rows.members')}
                href="/configuracoes/membros"
                trailing={null}
              />
            ) : null}
            {/* 08-07 (ADMIN-03, UI-D-280): the rules editor shares Marca's gate, `tenant.manage`. */}
            {canManageBrand ? (
              <Row
                icon="scroll-text"
                label={t('settings.rows.rules')}
                href="/configuracoes/regras"
                trailing={null}
              />
            ) : null}
            {canModerate ? (
              <Row
                icon="shield-check"
                label={t('settings.rows.moderation')}
                href="/configuracoes/moderacao"
                trailing={null}
              />
            ) : null}
            {/* 08.2-07 (UI-D-382): the same `/loja` the TopBar slot opens, one store screen. */}
            {canManageStore ? (
              <Row
                icon="shopping-bag"
                label={t('settings.rows.store')}
                href="/loja"
                trailing={null}
              />
            ) : null}
            {isTenantAdmin ? (
              <Row
                icon="film"
                label={t('settings.rows.media')}
                href="/configuracoes/midia"
                trailing={null}
              />
            ) : null}
            {/* UI-D-29: the stable, discoverable door to D-84's history, beside the media row in
                the group Phase 3 already created. The other door is the publish screen's trailing
                text action; the strip's own "+" circle keeps its single tap to publishing. */}
            {canManageStories ? (
              <Row
                icon="sparkles"
                label={t('settings.rows.stories')}
                href="/stories/meus"
                trailing={null}
              />
            ) : null}
          </Group>
        ) : null}
        {platform ? null : (
          <Group title={t('settings.groups.about')}>
            <Row icon="info" label={t('settings.rows.version', { version })} trailing={null} />
          </Group>
        )}
        {/* 07-07: forgets this device's push subscription before signing out (T-07-45). */}
        <LogoutForm action={logout} className="border-t border-border p-4">
          <Button type="submit" variant="ghost" fullWidth className="text-danger">
            <LogoutIcon aria-hidden size={18} />
            {t('logout')}
          </Button>
        </LogoutForm>
      </Card>
    </div>
  );
}
