/**
 * The same ONE screen for a miss on the lazy start (11-22, UI-D-864, T-11-06): a target that is staff, removed,
 * another tenant's, unknown or malformed, or a caller without `chat.direct`, reads exactly what a missing
 * conversation reads, so enumerating membership ids through `/conversas/com/{id}` tells nobody anything.
 */
export { default } from '../../[conversationId]/not-found';
