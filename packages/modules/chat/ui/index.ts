/**
 * `@rede-social/module-chat/ui`: the only surface `apps/web` may import from this module's UI.
 * Props-only components, no words (the host passes every string from the `chat` catalog).
 * May import `@rede-social/ui`, `@rede-social/core/ui` and `@rede-social/contracts` only (MOD-02).
 */
export {
  CHAT_COMPOSER_COUNTER_FROM,
  CHAT_COMPOSER_MAX_LENGTH,
  ChatComposer,
  type ChatComposerProps,
} from './ChatComposer';
export { DaySeparator, type DaySeparatorProps } from './DaySeparator';
export { InboxRow, type InboxRowProps, type InboxRowState } from './InboxRow';
export {
  MessageBubble,
  type MessageBubbleLabel,
  type MessageBubbleProps,
} from './MessageBubble';
export { MessageList, type MessageListItem, type MessageListProps } from './MessageList';
export {
  ThreadHeader,
  type ThreadHeaderMemberProps,
  type ThreadHeaderProps,
  type ThreadHeaderStaffProps,
} from './ThreadHeader';
