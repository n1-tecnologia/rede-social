/**
 * `@rede-social/module-chat/server` — everything the API tier may touch. The app imports THIS,
 * never a file path inside the package (the `exports` map has no `./server/*`).
 */
export { firstNameOf } from './first-name';
export { chatRoutes } from './routes';
export {
  getSupportThread,
  isStaff,
  listMessages,
  type MemberState,
  replyToConversation,
  sendSupportMessage,
} from './service';
