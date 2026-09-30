/**
 * `@rede-social/module-chat/server` — everything the API tier may touch. The app imports THIS,
 * never a file path inside the package (the `exports` map has no `./server/*`).
 */
export { firstNameOf } from './first-name';
export {
  CHAT_PUSH_BODY_MAX,
  CHAT_PUSH_COPY,
  memberMessagePushCopy,
  supportReplyPushCopy,
} from './notification-copy';
export { CHAT_PUSH_TTL_SECONDS, chatNotificationSources, conversationTag } from './notifications';
export { chatRoutes } from './routes';
export {
  chatCounters,
  getConversation,
  getSupportThread,
  isStaff,
  listInbox,
  listMessages,
  type MemberState,
  markConversationRead,
  replyToConversation,
  sendSupportMessage,
} from './service';
