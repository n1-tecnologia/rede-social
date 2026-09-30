import { cutOnWord } from '@rede-social/contracts/text';

/**
 * The pt-BR push banner bodies for support chat, verbatim from 07-UI-SPEC §Push banner copy
 * (UI-D-266, UI-D-267). Push text is rendered SERVER-SIDE (a push must exist before any page loads,
 * so it cannot come from next-intl) and travels only in the intent's push hint. Chat kinds are
 * push-only (D-228): nothing here is ever stored in a `notifications` row.
 *
 * Titles are resolved by the push adapter (07-06): `team` is "Equipe {tenant}" for a support reply
 * to the member, `tenant` is the tenant's display name for a member message to the team.
 */

/** A banner body is about one line on a lock screen (the feed's `PUSH_BODY_MAX`). */
export const CHAT_PUSH_BODY_MAX = 100;

export const CHAT_PUSH_COPY = {
  /** Member message → staff: "Nova mensagem de {member}: {preview}". */
  memberMessage: (member: string, preview: string) => `Nova mensagem de ${member}: ${preview}`,
  /** Only when the member's name is unavailable at fan-out time. */
  memberFallback: 'um membro',
} as const;

/** Support reply → member: the reply itself, cut on a word with `…` only when it cut. */
export function supportReplyPushCopy(body: string): string {
  return cutOnWord(body, CHAT_PUSH_BODY_MAX);
}

/** Member message → staff: the whole banner cut on a word to `CHAT_PUSH_BODY_MAX` graphemes. */
export function memberMessagePushCopy(memberName: string | null, body: string): string {
  const member = memberName?.trim() ? memberName.trim() : CHAT_PUSH_COPY.memberFallback;
  return cutOnWord(CHAT_PUSH_COPY.memberMessage(member, body), CHAT_PUSH_BODY_MAX);
}
