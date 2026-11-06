import {
  type AdminBranch,
  type AdminQuestion,
  type AdminStep,
  type ArchivedQuestion,
  adminQuestionListSchema,
  archivedQuestionListSchema,
  type ProfileFormSummary,
  profileFormSummarySchema,
} from '@rede-social/contracts/profile-form';
import { apiFetch } from '@/lib/api';

/**
 * The builder's server loaders (12-15, D-582, D-588, D-596; UI-D-564..UI-D-568; PFORM-23).
 *
 * The Perguntas tab reads the ACTIVE list and the summary; the Arquivadas tab reads the archived list
 * and, for the limit check of "Reativar", the active count. Both are read once per request on the
 * server (`apiFetch` is `no-store`) and never throw for an expected refusal: a 403 is `forbidden` and a
 * 404 (`MODULE_DISABLED`) is `moduleOff`, which the page turns into `notFound()` OUTSIDE any try/catch;
 * anything else, including a body that does not match the strict contract, is `error` (the "Algo deu
 * errado" card).
 *
 * **Aggregates only (D-593, PFORM-23):** every payload read here is a count or a definition. No
 * individual member's answer is fetched, and no log line carries more than a status or an error class.
 */

/** Only the error's class name is logged: a message could echo a payload. */
const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'unknown');

type Refused = { status: 'forbidden' } | { status: 'moduleOff' } | { status: 'error' };

/** The shared status mapping: 403 forbidden, 404 module off, anything else an error. */
function refusalOf(status: number, label: string): Refused {
  if (status === 403) return { status: 'forbidden' };
  if (status === 404) return { status: 'moduleOff' };
  console.error(`profile_form.${label}_failed`, { status });
  return { status: 'error' };
}

export type AdminFormResult =
  | {
      status: 'ok';
      questions: AdminQuestion[];
      /** The tenant's branches, name included (admin lane only); an empty list when the read has none (12.2-13). */
      branches: AdminBranch[];
      /** The tenant's steps in order (12.1-16); none for a form never built. */
      steps: AdminStep[];
      /** The most steps a tenant may have (D-633). */
      stepLimit: number;
      summary: ProfileFormSummary;
      activeCount: number;
      limit: number;
      /**
       * How many archived questions exist. Read ONLY when there is no active question (it decides
       * between the empty state and "only archived"); `null` when the active list is not empty.
       */
      archivedCount: number | null;
    }
  | Refused;

/**
 * `GET /v1/profile_form/questions` and `/summary` in parallel. With no active question it also reads
 * `/archived`, because "only archived questions exist" keeps the summary card above the empty state.
 */
export async function loadAdminForm(): Promise<AdminFormResult> {
  try {
    const [list, summary] = await Promise.all([
      apiFetch('/v1/profile_form/questions'),
      apiFetch('/v1/profile_form/summary'),
    ]);
    for (const res of [list, summary]) {
      if (!res.ok) return refusalOf(res.status, 'admin_form');
    }
    const parsedList = adminQuestionListSchema.parse(await list.json());
    const parsedSummary = profileFormSummarySchema.parse(await summary.json());

    let archivedCount: number | null = null;
    if (parsedList.questions.length === 0) {
      const archived = await apiFetch('/v1/profile_form/archived');
      if (!archived.ok) return refusalOf(archived.status, 'admin_form');
      archivedCount = archivedQuestionListSchema.parse(await archived.json()).questions.length;
    }

    return {
      status: 'ok',
      questions: parsedList.questions,
      branches: [],
      steps: parsedList.steps,
      stepLimit: parsedList.stepLimit,
      summary: parsedSummary,
      activeCount: parsedList.activeCount,
      limit: parsedList.limit,
      archivedCount,
    };
  } catch (error) {
    console.error('profile_form.admin_form_failed', { error: errorName(error) });
    return { status: 'error' };
  }
}

export type ArchivedResult =
  | {
      status: 'ok';
      questions: ArchivedQuestion[];
      /** The branches the archived questions sit in, so the list can name them; empty when the read has none (12.2-13). */
      branches: AdminBranch[];
      /** The branches of the ACTIVE list (12.2-13): what a reactivated question can still name. */
      activeBranches: AdminBranch[];
      activeCount: number;
      limit: number;
      /** The ACTIVE questions (12.1-17): the openers a reactivated question may name. */
      activeQuestions: AdminQuestion[];
    }
  | Refused;

/**
 * `GET /v1/profile_form/archived` (newest archive first, as the API returns it) and the active list
 * for its `activeCount` and `limit`, so "Reativar" can refuse at the limit without a write.
 */
export async function loadArchived(): Promise<ArchivedResult> {
  try {
    const [archived, list] = await Promise.all([
      apiFetch('/v1/profile_form/archived'),
      apiFetch('/v1/profile_form/questions'),
    ]);
    for (const res of [archived, list]) {
      if (!res.ok) return refusalOf(res.status, 'archived');
    }
    const parsedArchived = archivedQuestionListSchema.parse(await archived.json());
    const parsedList = adminQuestionListSchema.parse(await list.json());
    return {
      status: 'ok',
      questions: parsedArchived.questions,
      branches: [],
      activeBranches: [],
      activeCount: parsedList.activeCount,
      limit: parsedList.limit,
      activeQuestions: parsedList.questions,
    };
  } catch (error) {
    console.error('profile_form.archived_failed', { error: errorName(error) });
    return { status: 'error' };
  }
}
