import { resolveBranding } from '@rede-social/contracts';
import { KERNEL_PERMISSIONS } from '@rede-social/contracts/moderation';
import { isFixedTopSlot, type NavItem, phoneChrome, withPhoneTabSlots } from '@rede-social/core/ui';
import { PageHeader } from '@rede-social/ui';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PhoneMenuEditor } from '@/components/admin/PhoneMenuEditor';
import { requireBootstrap } from '@/lib/bootstrap';
import { savedPhoneLayout } from '@/lib/phone-nav-layout';
import { MAIN_SLOTS, shellTabs } from '@/lib/shell-tabs';
import { getHostTenant } from '@/lib/tenant-host';
import { clearPhoneMenuAction, savePhoneMenuAction } from './actions';

/** What the editor needs of a nav item. */
const item = ({ key, label, icon }: NavItem) => ({ key, label, icon });

/**
 * 2026-11-05 — Configurações › Menu do app (the product owner: "nesta parte onde somente o admin do
 * tenant tem acesso ... personalizar hotbar do usuário", "somente no mobile"): the phone's bottom bar
 * and top, arranged by the tenant's administrator (`PhoneMenuEditor`). Marca's gate (`tenant.manage`)
 * on a tenant host; the platform host has no such menu.
 *
 * The items are the caller's own shell (`shellTabs`, the layout's builder, with the Loja moved to the
 * bar as the layout does), so the editor shows the bar the app draws: what the school keeps now (the
 * bootstrap brand's saved menu, 12.3-16) and the shell's own menu for "Restaurar o padrão". The
 * counter slots (Notificações, Suporte) stay at the top and are only drawn.
 */
export default async function AdminMenuPage() {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') notFound();

  const bootstrap = await requireBootstrap();
  if (!bootstrap.permissions.includes(KERNEL_PERMISSIONS.tenantManage)) notFound();

  const [t, tApp, tRoot] = await Promise.all([
    getTranslations('admin'),
    getTranslations('app'),
    getTranslations(),
  ]);
  const branding = resolveBranding(bootstrap.tenant.branding);

  const nav = withPhoneTabSlots(
    shellTabs(
      bootstrap,
      {
        home: tApp('nav.home'),
        profile: tApp('nav.profile'),
        memberNav: tRoot('courses.memberNav'),
      },
      tRoot,
    ),
    MAIN_SLOTS,
  );
  const slots = nav.topbar.filter((slot) => !isFixedTopSlot(slot));
  const items = [
    ...nav.tabs,
    ...slots.filter((slot) => !nav.tabs.some((tab) => tab.key === slot.key)),
  ];
  const keys = (list: readonly NavItem[]) =>
    list.filter((entry) => !isFixedTopSlot(entry)).map((entry) => entry.key);
  const now = phoneChrome(nav.tabs, nav.topbar, savedPhoneLayout(branding));
  const shell = phoneChrome(nav.tabs, nav.topbar);

  return (
    <div data-testid="menu-screen" className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
      <PageHeader
        title={t('menu.title')}
        backHref="/configuracoes"
        backLabel={t('back')}
        className="md:static md:px-0"
      />
      <PhoneMenuEditor
        items={items.map(item)}
        fixed={nav.topbar.filter(isFixedTopSlot).map(item)}
        initial={{ bar: keys(now.bar), top: keys(now.top) }}
        defaults={{ bar: keys(shell.bar), top: keys(shell.top) }}
        brand={{ displayName: bootstrap.tenant.displayName, logoUrl: branding.logoUrl }}
        onSave={savePhoneMenuAction}
        onClear={clearPhoneMenuAction}
      />
    </div>
  );
}
