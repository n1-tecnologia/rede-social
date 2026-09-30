/**
 * The feed's auto-linker is THE shared one, re-homed into `@rede-social/ui` in 07-09 so the chat
 * module can use it without importing another module (MOD-02). This re-export keeps every feed
 * caller (`PostCaption`, `CommentItem`, the reels overlay through `@rede-social/module-feed/ui`)
 * unchanged, and keeps ONE implementation of the http/https-only link rule (T-04-43).
 */
export { linkify } from '@rede-social/ui';
