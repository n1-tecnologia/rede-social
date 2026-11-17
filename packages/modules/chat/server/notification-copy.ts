import { cutOnWord } from '@rede-social/contracts/text';

/**
 * The pt-BR push banner bodies for support chat, verbatim from 07-UI-SPEC §Push banner copy
 * (UI-D-266, UI-D-267). Push text is rendered SERVER-SIDE (a push must exist before any page loads,
 * so it cannot come from next-intl) and travels only in the intent's push hint. Chat message
 * kinds are push-only (D-228); the one bell row is the member's resolved notice (D-808), whose facts are ids only and
 * never carry any text from here.
 *
 * Titles are resolved by the push adapter (07-06): `team` is "Equipe {tenant}" for a support reply
 * and the resolved notice to the member, `tenant` is the tenant's display name for every notice to the team.
 * Phase 12.4 (CASE-20): every body carries the case number as `#N` (no separator) and is cut on a word at 100
 * graphemes, with `…` only when it was cut; one device tag per case (the conversation's 32-hex tag) replaces the
 * older banner and re-alerts.
 */

/**
 * The two server-side words of a recording (Phase 12.5, D-860, D-861, D-868): the constant label a case opened by
 * voice carries when no subject was typed (no duration: the label names the case, A-UI-1), and the words of a
 * recording that is gone. SQL never builds them; the previews of the lists carry facts and the host builds the rest.
 */
export const CHAT_VOICE_COPY = {
  label: 'Mensagem de voz',
  deleted: 'Mensagem de voz apagada',
} as const;

/** A banner body is about one line on a lock screen (the feed's `PUSH_BODY_MAX`). */
export const CHAT_PUSH_BODY_MAX = 100;

export const CHAT_PUSH_COPY = {
  /** Member message → staff on a case: "Nova mensagem de {member} no chamado #N: {preview}". */
  memberMessage: (member: string, number: number, preview: string) =>
    `Nova mensagem de ${member} no chamado #${number}: ${preview}`,
  /** A legacy thread with no case number: the shipped sentence, kept so no banner ever shows "#null". */
  memberMessageNoCase: (member: string, preview: string) =>
    `Nova mensagem de ${member}: ${preview}`,
  /** D-809: a new case → every live staff member. */
  caseNew: (number: number, member: string, preview: string) =>
    `Novo chamado #${number} de ${member}: ${preview}`,
  /** D-809: a Resolvido case came back to Aberto by a member message → every live staff member. */
  caseReopened: (number: number, member: string, preview: string) =>
    `O chamado #${number} de ${member} foi reaberto: ${preview}`,
  /** D-809: a case was assigned → the assignee only. */
  caseAssigned: (number: number, member: string) =>
    `O chamado #${number} de ${member} foi atribuído a você.`,
  /** D-808: the member's one case notice. A fixed sentence: no subject, no message text, no staff name. */
  caseResolved: (number: number) => `Seu chamado #${number} foi resolvido.`,
  /** Only when the member's name is unavailable at fan-out time. */
  memberFallback: 'um membro',
} as const;

const memberLabel = (memberName: string | null): string =>
  memberName?.trim() ? memberName.trim() : CHAT_PUSH_COPY.memberFallback;

/** Support reply → member: the reply itself, cut on a word with `…` only when it cut. */
export function supportReplyPushCopy(body: string): string {
  return cutOnWord(body, CHAT_PUSH_BODY_MAX);
}

/**
 * Member message → staff: the whole banner cut on a word to `CHAT_PUSH_BODY_MAX` graphemes. `number` is the case
 * number (CASE-20); null only for a thread that is not a numbered case, which keeps the shipped sentence.
 */
export function memberMessagePushCopy(
  memberName: string | null,
  number: number | null,
  body: string,
): string {
  const member = memberLabel(memberName);
  const text =
    number === null
      ? CHAT_PUSH_COPY.memberMessageNoCase(member, body)
      : CHAT_PUSH_COPY.memberMessage(member, number, body);
  return cutOnWord(text, CHAT_PUSH_BODY_MAX);
}

/** D-809: "Novo chamado #N de {member}: {preview}", cut on a word at 100 graphemes. */
export function caseNewPushCopy(number: number, memberName: string | null, body: string): string {
  return cutOnWord(
    CHAT_PUSH_COPY.caseNew(number, memberLabel(memberName), body),
    CHAT_PUSH_BODY_MAX,
  );
}

/** D-809: "O chamado #N de {member} foi reaberto: {preview}", cut on a word at 100 graphemes. */
export function caseReopenedPushCopy(
  number: number,
  memberName: string | null,
  body: string,
): string {
  return cutOnWord(
    CHAT_PUSH_COPY.caseReopened(number, memberLabel(memberName), body),
    CHAT_PUSH_BODY_MAX,
  );
}

/** D-809: "O chamado #N de {member} foi atribuído a você." */
export function caseAssignedPushCopy(number: number, memberName: string | null): string {
  return cutOnWord(
    CHAT_PUSH_COPY.caseAssigned(number, memberLabel(memberName)),
    CHAT_PUSH_BODY_MAX,
  );
}

/** D-808: "Seu chamado #N foi resolvido." (a fixed sentence, nothing the case or the team wrote). */
export function caseResolvedPushCopy(number: number): string {
  return CHAT_PUSH_COPY.caseResolved(number);
}
