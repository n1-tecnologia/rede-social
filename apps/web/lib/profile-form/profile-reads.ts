import {
  type MemberBranch,
  type PublicAnswers,
  publicAnswersSchema,
  type StaffAnswers,
  staffAnswersSchema,
} from '@rede-social/contracts/profile-form';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { type AnswerView, type AnswerWords, answerView } from './answer-view';
import { getMemberForm } from './member-form';
import { storedVisibleQuestionIds } from './visibility';

/**
 * The profile surfaces' readers of the profile form (12-14, D-584, D-593; UI-D-590, UI-D-592, UI-D-593).
 *
 * Both loaders are called inside a `Suspense` boundary of their own, after the base profile has rendered,
 * so they NEVER throw: a failed read is `{ status: 'error' }` (a small card with a retry), never the
 * app-level error page and never a blank profile (the `loadOwnProfile` mould). The only difference
 * between a miss and a failure is on purpose: for another member's answers a bare 404 is `absent` (the
 * block simply does not exist: module off, staff target, nothing to show), anything else is `error`.
 *
 * No answer reaches a log line: only a status or a code is written (T-12-30).
 */

/** Only the error's class name is logged: its message could echo a stored value (T-12-30). */
const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'unknown');

/** One row of "Minhas respostas": the question, how its answer reads, and whether others see it. */
export type MyAnswerRow = {
  questionId: string;
  title: string;
  /** `null` is an unanswered question ("Sem resposta"). */
  view: AnswerView | null;
  isPublic: boolean;
  /**
   * True for a conditional question whose opener answer does not match (12.1, D-634, UI-D-659): the member
   * never sees it, so "Minhas respostas" omits the row instead of reading "Sem resposta". Absent counts as
   * shown. This is a derived-row rule only: no stored answer is filtered (D-624).
   */
  hidden?: boolean;
};

export type MyAnswersResult =
  | { status: 'ok'; rows: MyAnswerRow[] }
  | { status: 'empty' }
  | { status: 'error' };

/**
 * The member's own answers in the admin's order (the API returns the form in that order). `empty` is "no
 * active question": the section is then absent altogether. Staff and a module that is off read
 * `mode: 'none'` with no question, which is the same `empty`.
 */
export async function loadMyAnswers(words: AnswerWords): Promise<MyAnswersResult> {
  try {
    const form = await getMemberForm();
    if (form.questions.length === 0) return { status: 'empty' };
    const shown = storedVisibleQuestionIds(form);
    return {
      status: 'ok',
      rows: form.questions.map((question) => ({
        questionId: question.id,
        title: question.title,
        view: answerView(question, question.answer, words),
        isPublic: question.showOnProfile,
        hidden: !shown.has(question.id),
      })),
    };
  } catch (error) {
    console.error('profile_form.my_answers_failed', { error: errorName(error) });
    return { status: 'error' };
  }
}

const memberAnswersSchema = z.discriminatedUnion('kind', [publicAnswersSchema, staffAnswersSchema]);

/** The staff payload with the branches always present (an empty list when the read has none), no name (12.2-13). */
export type StaffPayload = Omit<StaffAnswers, 'branches'> & { branches: MemberBranch[] };

export type MemberAnswersPayload = PublicAnswers | StaffPayload;

export type MemberAnswersResult =
  | { status: 'ok'; payload: MemberAnswersPayload }
  | { status: 'absent' }
  | { status: 'error' };

/**
 * `GET /v1/members/{membershipId}/profile-answers`: another member's public answers (a member viewer) or
 * every answer (staff). The API answers ONE bare 404 for every miss, so a 404 is `absent`. A body that
 * does not match the strict contract is an `error` (nothing of it is rendered).
 */
export async function loadMemberAnswers(membershipId: string): Promise<MemberAnswersResult> {
  try {
    const res = await apiFetch(`/v1/members/${encodeURIComponent(membershipId)}/profile-answers`);
    if (res.status === 404) return { status: 'absent' };
    if (!res.ok) {
      console.error('profile_form.member_answers_failed', { status: res.status });
      return { status: 'error' };
    }
    return {
      status: 'ok',
      payload: memberAnswersSchema.parse(await res.json()) as MemberAnswersPayload,
    };
  } catch (error) {
    console.error('profile_form.member_answers_failed', { error: errorName(error) });
    return { status: 'error' };
  }
}
