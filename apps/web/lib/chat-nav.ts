import type { ShellNav } from '@rede-social/core/ui';
import { CHAT_PERMISSIONS } from '@rede-social/module-chat/contracts';

/** Where the chat slot opens for a member who may write to other members (UI-D-861, A-UI-1). */
export const CONVERSATIONS_HREF = '/conversas';

/** The key of the chat module's top-bar slot (`packages/modules/chat/module.ts`). */
const CHAT_SLOT_KEY = 'chat';

/**
 * 11-19 (D-719, D-220, UI-D-861): the nav with the chat slot pointed at Conversas for a viewer who holds
 * `chat.direct`. The permission is composed by the app tier only for a member while `social` AND `chat` are both
 * effective (`CHAT_PERMISSIONS.direct`), so this one test of DATA is the whole rule: no role is compared, and
 * staff, a member with `social` off and a tenant without the chat module get the nav back exactly as it was
 * (the slot opens `/suporte`, reads "Suporte", keeps its dot or its staff count).
 *
 * Only the slot's `href` and `label` change. Its icon, its place and the counter it reads
 * (`unreadConversations`) stay the manifest's, and the style of that badge (the shipped count `Badge`, `99+`)
 * is the API's `conversationsBadge: 'count'` for this viewer, never decided here. The input nav is not mutated
 * and an empty label is ignored, as `withTabOverrides` does for a tab.
 */
export function withConversationsDestination(
  nav: ShellNav,
  permissions: ReadonlyArray<string>,
  label: string,
): ShellNav {
  if (!permissions.includes(CHAT_PERMISSIONS.direct)) return nav;
  if (!nav.topbar.some((slot) => slot.key === CHAT_SLOT_KEY)) return nav;
  return {
    ...nav,
    topbar: nav.topbar.map((slot) =>
      slot.key === CHAT_SLOT_KEY
        ? { ...slot, href: CONVERSATIONS_HREF, ...(label ? { label } : {}) }
        : slot,
    ),
  };
}
