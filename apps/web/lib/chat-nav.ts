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

/** The slice of a translator scoped to the `chat` namespace that the slot's name needs. */
type ChatTranslate = (key: string, values?: { count: number }) => string;

/**
 * 11-19 (UI-D-861, UI-D-253, D-237, D-238): the chat slot's accessible name while something is unread. A viewer
 * who holds `chat.direct` hears "Conversas, {count, plural, one {# conversa com mensagem nova} other {#
 * conversas com mensagem nova}}" (the number counts CONVERSATIONS with something unread, support included, and the
 * visual badge is the shipped count `Badge` the API's `conversationsBadge: 'count'` asks for). Every other viewer
 * keeps the shipped sentences: "Suporte, nova resposta da equipe" for the member's dot and "Suporte, {count}
 * aguardando resposta" for the staff count. The shell calls this only with a count above zero (at zero the name is
 * the plain slot label, `slotAccessibleName`), and the catalog words are the `chat.navConversationsBadge`,
 * `chat.navBadge.member` and `chat.navBadge.staff` keys.
 */
export function chatSlotLabel(
  t: ChatTranslate,
  {
    count,
    style,
    conversations,
  }: { count: number; style: 'dot' | 'count'; conversations: boolean },
): string {
  if (conversations) return t('navConversationsBadge', { count });
  return style === 'dot' ? t('navBadge.member') : t('navBadge.staff', { count });
}
