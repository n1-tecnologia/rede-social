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
 * **D-806: `chat.support.assign` (hand a support case to a colleague) is granted to `admin_tenant` ONLY**; the
 * database definer spells the same role once, and the drift test compares both. The permission gates the UI and the
 * API, never roles (D-223); with chat off it is revoked together with `chat.support`.
 *
 * `counters` (D-237, D-238): the member's dot or the staff count, decided from the caller's composed
 * permissions. `notificationSources` (D-228): `chat.message_sent` becomes a PUSH-ONLY intent to the
 * other side of the thread, delivered by the notifications module's push channel through the kernel
 * seam; chat never imports that module, and support messages never write a bell row.
 *
 * `sweepFunctions` (D-844, D-807): `chat_cases_auto_close` closes every support case left `resolved` for 7 days, run
 * by the kernel's existing hourly sweeper through the admin lane (no new queue, no new job name). The 7 days live in the
 * SQL function only, never here (D-807); the closing is silent for the member (D-808).
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
    admin_tenant: ['chat.support', 'chat.support.assign'],
    support_tenant: ['chat.support'],
    member: ['chat.support.contact'],
  },
  counters: chatCounters,
  notificationSources: chatNotificationSources,
  sweepFunctions: ['chat_cases_auto_close'],
});
