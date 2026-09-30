import { defineModule } from '@rede-social/core/server/modules/manifest';
import { chatNotificationSources } from './server/notifications';
import { chatCounters } from './server/service';

/**
 * The manifest: everything the kernel needs to know about the chat module, as data (MOD-01).
 *
 * **D-40 / D-224: the support chat is a TOPBAR slot at order 20**, after the bell (10), badged by
 * `bootstrap.counters.unreadConversations`. One href, `/suporte`, for everybody: the web renders the
 * member's own thread or the staff inbox by permission. `message-circle` is the icon name the shell
 * maps (`packages/core/ui/nav.ts`); the pt-BR label comes from the catalog's `chat.nav` when present.
 * A tenant with chat off gets no slot and every `/v1/chat` route answers 404 `MODULE_DISABLED`.
 *
 * **D-223: `chat.support` is granted HERE, to both staff roles**, not by the kernel: turning chat off
 * for a tenant therefore revokes it (the inbox, the staff reply and the staff read all require it).
 * Members get `chat.support.contact` instead, the right to write to the team; staff never hold it,
 * so they are never offered a support conversation of their own.
 *
 * `counters` (D-237, D-238): the member's dot or the staff count, decided from the caller's composed
 * permissions. `notificationSources` (D-228): `chat.message_sent` becomes a PUSH-ONLY intent to the
 * other side of the thread, delivered by the notifications module's push channel through the kernel
 * seam; chat never imports that module, and support messages never write a bell row.
 */
export const chatModule = defineModule({
  key: 'chat',
  nav: {
    placement: 'topbar',
    label: 'Suporte',
    icon: 'message-circle',
    badge: 'unreadConversations',
    href: '/suporte',
    order: 20,
  },
  routes: () => import('./server/routes').then((m) => m.chatRoutes),
  defaultRolePermissions: {
    admin_tenant: ['chat.support'],
    support_tenant: ['chat.support'],
    member: ['chat.support.contact'],
  },
  counters: chatCounters,
  notificationSources: chatNotificationSources,
});
