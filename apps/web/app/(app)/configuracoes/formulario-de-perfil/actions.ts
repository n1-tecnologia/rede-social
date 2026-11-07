'use server';

import {
  type AdminBranch,
  type AdminQuestion,
  type AdminStep,
  adminBranchSchema,
  adminQuestionSchema,
  adminStepSchema,
  type CreateBranchBody,
  type CreateQuestionBody,
  createBranchBodySchema,
  createQuestionBodySchema,
  createStepBodySchema,
  type Dependent,
  deleteStepResultSchema,
  dependentSchema,
  impactQuerySchema,
  impactResultSchema,
  layoutBodySchema,
  type ProfileFormImpactChange,
  profileFormSummarySchema,
  reorderBodySchema,
  replaceQuestionBodySchema,
  updateQuestionBodySchema,
  updateStepBodySchema,
} from '@rede-social/contracts/profile-form';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * The builder's server actions on the TENANT LANE (12-15, D-582, D-585, D-588, UI-D-567, UI-D-576,
 * UI-D-578; T-12-33, T-12-34).
 *
 * Every action calls a route behind the API's guard chain (`requireAuth`, `requireModule`,
 * `profile_form.manage`), which is the real control; the actions only translate its answers. Results
 * are typed, never a throw for an expected refusal, with one closed vocabulary of codes:
 *
 *  - `forbidden`: 403 `FORBIDDEN` (the permission was lost in another tab): the shipped forbidden toast
 *    plus a refresh into the page's `notFound()`.
 *  - `moduleOff`: 404 `MODULE_DISABLED` (a `super_admin` turned the module off): its own toast plus the
 *    same refresh.
 *  - `mismatch`: 409 `order_mismatch` (the list changed under the admin): refresh and the failed sentence.
 *  - `limit`: 409 `limit_reached` (30 active questions): the limit sentence.
 *  - `failed`: anything else.
 *
 * Session and membership refusals follow the shipped `(app)` navigation, OUTSIDE the try/catch (Next 16:
 * `redirect()` throws). Only a status and a code reach a log line, never a title or an answer.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

export type BuilderRefusal = 'forbidden' | 'moduleOff' | 'mismatch' | 'limit' | 'failed';

export type ReorderResult =
  | { ok: true }
  | { ok: false; code: 'forbidden' | 'moduleOff' | 'mismatch' | 'failed' };

export type ImpactActionResult =
  | { ok: true; members: number }
  | { ok: false; code: 'forbidden' | 'moduleOff' | 'failed' };

export type ReactivateResult =
  | { ok: true }
  | { ok: false; code: 'limit' | 'forbidden' | 'moduleOff' | 'failed' }
  // 12.1-17 (D-632): the question's own opener is not in the form any more; `openerId` is the opener the server named.
  | { ok: false; code: 'conditionInvalid'; openerId: string | null };

type ErrorBody = { code?: string; details?: Record<string, unknown>; requestId?: string };
type Envelope = { error?: ErrorBody };

async function readEnvelope(res: Response): Promise<ErrorBody | null> {
  try {
    const body = (await res.json()) as Envelope;
    return body?.error && typeof body.error.code === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

/** The closed vocabulary a refusal of the builder API maps to, or `null` for anything else. */
function refusalOf(status: number, envelope: ErrorBody | null): BuilderRefusal | null {
  if (status === 404 && envelope?.code === 'MODULE_DISABLED') return 'moduleOff';
  if (status === 403 && envelope?.code === 'FORBIDDEN') return 'forbidden';
  const detail = envelope?.details?.profileForm;
  if (status === 409 && detail === 'order_mismatch') return 'mismatch';
  if (status === 409 && detail === 'limit_reached') return 'limit';
  return null;
}

/** The `(app)` navigation for a session or membership refusal, or `null` when it is not one. */
function navigationFor(status: number, envelope: ErrorBody | null): string | null {
  if (status !== 401 && status !== 403) return null;
  return bootstrapRedirectPath(
    new ApiClientError(
      status,
      envelope?.code ?? 'HTTP_ERROR',
      envelope?.details,
      envelope?.requestId,
    ),
  );
}

/**
 * `PUT /v1/profile_form/order`: stores the WHOLE active list in the given order (D-582). The body is the
 * contract's, validated here first, so a malformed list never leaves the server tier. The API answers
 * `order_mismatch` when the ids are not exactly the active set, and renumbers the list in one statement.
 */
export async function reorderQuestionsAction(ids: string[]): Promise<ReorderResult> {
  const body = reorderBodySchema.safeParse({ ids });
  if (!body.success) return { ok: false, code: 'failed' };

  let refusal: string | null = null;
  let result: ReorderResult = { ok: false, code: 'failed' };
  try {
    const res = await apiFetch('/v1/profile_form/order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body.data),
    });
    if (res.ok) {
      result = { ok: true };
    } else {
      const envelope = await readEnvelope(res);
      const code = refusalOf(res.status, envelope);
      if (code === 'forbidden' || code === 'moduleOff' || code === 'mismatch') {
        result = { ok: false, code };
      } else {
        refusal = navigationFor(res.status, envelope);
        if (!refusal) {
          console.error('profile_form.reorder_failed', {
            status: res.status,
            code: envelope?.code,
          });
        }
      }
    }
  } catch (error) {
    console.error('profile_form.reorder_failed', {
      error: error instanceof Error ? error.name : 'unknown',
    });
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * `GET /v1/profile_form/impact`: how many members a change would ask to answer (D-585, UI-D-576). It is a
 * READ: nothing is written. `{ ok: false }` is the caller's signal that the count is unknown, and **the
 * caller must then not write** (T-12-34): a reopening change is never applied on a guess of how many
 * members it holds out.
 * 12.1-17 (D-634): `remove_condition` asks how many members do NOT see a required question today and lack an
 * answer, before the condition is removed (UI-D-649). 403 and 404 carry their own code so the screen can end in `notFound()`; anything
 * else, including a body that breaks the contract, is `failed`.
 */
export async function readImpactAction(input: {
  change: ProfileFormImpactChange;
  questionId?: string;
  /**
   * 12.1-17 (D-634): the condition the NEW question will have (a create or a replace), so only the members who would
   * see it are counted. The tokens travel comma-joined, as the route reads them.
   */
  conditionQuestionId?: string;
  conditionValues?: string[];
  /**
   * 12.2-16 (D-634, D-644): the branch the NEW question will sit in (a create or a replace), so only the members
   * for whom its whole chain is open are counted. The per-question condition keys above are retired on the
   * server (400) and kept here only until plan 20 removes them.
   */
  branchId?: string;
}): Promise<ImpactActionResult> {
  const { conditionValues, ...rest } = input;
  const query = impactQuerySchema.safeParse({
    ...rest,
    ...(conditionValues && conditionValues.length > 0
      ? { conditionValues: conditionValues.join(',') }
      : {}),
  });
  if (!query.success) return { ok: false, code: 'failed' };

  const params = new URLSearchParams({ change: query.data.change });
  if (query.data.questionId) params.set('questionId', query.data.questionId);
  if (query.data.conditionQuestionId) {
    params.set('conditionQuestionId', query.data.conditionQuestionId);
  }
  if (query.data.conditionValues) params.set('conditionValues', query.data.conditionValues);
  if (query.data.branchId) params.set('branchId', query.data.branchId);

  let refusal: string | null = null;
  let result: ImpactActionResult = { ok: false, code: 'failed' };
  try {
    const res = await apiFetch(`/v1/profile_form/impact?${params.toString()}`);
    if (res.ok) {
      result = { ok: true, members: impactResultSchema.parse(await res.json()).members };
    } else {
      const envelope = await readEnvelope(res);
      const code = refusalOf(res.status, envelope);
      if (code === 'forbidden' || code === 'moduleOff') {
        result = { ok: false, code };
      } else {
        refusal = navigationFor(res.status, envelope);
        if (!refusal) {
          console.error('profile_form.impact_failed', { status: res.status, code: envelope?.code });
        }
      }
    }
  } catch (error) {
    console.error('profile_form.impact_failed', {
      error: error instanceof Error ? error.name : 'unknown',
    });
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * `POST /v1/profile_form/questions/{id}/reactivate`: an archived question returns at the END of the active
 * list with its stored answers valid again (D-588). `limit` is 409 `limit_reached` (30 active questions).
 * The action does not read the impact itself: the screen reads it first and decides whether to write.
 */
export async function reactivateQuestionAction(id: string): Promise<ReactivateResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, code: 'failed' };

  let refusal: string | null = null;
  let result: ReactivateResult = { ok: false, code: 'failed' };
  try {
    const res = await apiFetch(`/v1/profile_form/questions/${id}/reactivate`, { method: 'POST' });
    if (res.ok) {
      result = { ok: true };
    } else {
      const envelope = await readEnvelope(res);
      const code = refusalOf(res.status, envelope);
      if (code === 'forbidden' || code === 'moduleOff' || code === 'limit') {
        result = { ok: false, code };
      } else if (res.status === 409 && envelope?.details?.profileForm === 'condition_invalid') {
        const openerId = envelope.details.openerId;
        result = {
          ok: false,
          code: 'conditionInvalid',
          openerId: typeof openerId === 'string' ? openerId : null,
        };
      } else {
        refusal = navigationFor(res.status, envelope);
        if (!refusal) {
          console.error('profile_form.reactivate_failed', {
            status: res.status,
            code: envelope?.code,
          });
        }
      }
    }
  } catch (error) {
    console.error('profile_form.reactivate_failed', {
      error: error instanceof Error ? error.name : 'unknown',
    });
  }

  if (refusal) redirect(refusal);
  return result;
}

// ── 12-16: the question editor's writes ────────────────────────────────────────────────────────────

/** The field of the sheet a refusal of a write belongs to; `form` is a refusal no single field owns. */
export type SaveFieldKey =
  | 'title'
  | 'helpText'
  | 'options'
  | 'limits'
  | 'condition'
  | 'branch'
  | 'form';

/**
 * What a write of a question returns (UI-D-569). `invalid` is a 400: the issue code per field, which the
 * sheet renders under that field. `conflict` is a 409 other than the limit: a stale revision, one of the
 * five D-587 locks, an already archived question, or a question that is gone (`issue` is the API's code,
 * `not_found` for the last). `limit` is 409 `limit_reached`. `pending` is the SERVER's count of members
 * still held by the form after a write that reopened it (`GET /summary`), never the preview's number.
 */
export type SaveQuestionResult =
  | { ok: true; question: AdminQuestion; pending: number | null }
  | { ok: false; code: 'invalid'; fields: Partial<Record<SaveFieldKey, string>> }
  // `dependents` rides with `has_dependents` (12.1-17, D-632): the questions that name this one as their opener.
  | { ok: false; code: 'conflict'; issue: string; dependents?: Dependent[] }
  | { ok: false; code: 'limit' | 'forbidden' | 'moduleOff' | 'failed' };

type Sent =
  | { kind: 'ok'; body: unknown }
  | { kind: 'error'; status: number; envelope: ErrorBody | null }
  | { kind: 'thrown' };

/** One request to the builder API; it never throws, so the caller's `redirect()` stays outside any catch. */
async function send(label: string, path: string, init?: RequestInit): Promise<Sent> {
  try {
    const res = await apiFetch(path, init);
    if (res.ok) {
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return { kind: 'ok', body };
    }
    const envelope = await readEnvelope(res);
    return { kind: 'error', status: res.status, envelope };
  } catch (error) {
    console.error(`profile_form.${label}_failed`, {
      error: error instanceof Error ? error.name : 'unknown',
    });
    return { kind: 'thrown' };
  }
}

/** The issue codes a 400 can name that belong to the title rather than to the whole form. */
const TITLE_ISSUES: ReadonlySet<string> = new Set(['required', 'too_long']);

/** The field of a contract issue's path. */
function fieldOf(path: PropertyKey[]): SaveFieldKey {
  const head = path[0];
  if (
    head === 'title' ||
    head === 'helpText' ||
    head === 'options' ||
    head === 'limits' ||
    head === 'condition'
  ) {
    return head;
  }
  // 12.2-16: a `branchId` the contract or the server refuses (`unknown_branch`) belongs to the "Ramo" field.
  if (head === 'branchId') return 'branch';
  return 'form';
}

/** A body the contract refuses, as per-field issue codes (the first issue of a field wins). */
function fieldsOf(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const fields: Partial<Record<SaveFieldKey, string>> = {};
  for (const issue of issues) {
    const key = fieldOf(issue.path);
    if (fields[key] === undefined) fields[key] = issue.message;
  }
  return fields;
}

/**
 * The closed vocabulary of a failed write, shared by every question write. A 401 or a session-level 403
 * is the `(app)` navigation (`navigate`), done by the caller OUTSIDE any try/catch; the rest is a result.
 */
function failureOf(
  label: string,
  sent: Exclude<Sent, { kind: 'ok' }>,
): { result: Extract<SaveQuestionResult, { ok: false }>; navigate: string | null } {
  if (sent.kind === 'thrown') return { result: { ok: false, code: 'failed' }, navigate: null };
  const { status, envelope } = sent;
  const detail = envelope?.details?.profileForm;
  const issue = typeof detail === 'string' ? detail : null;

  const refusal = refusalOf(status, envelope);
  if (refusal === 'forbidden' || refusal === 'moduleOff' || refusal === 'limit') {
    return { result: { ok: false, code: refusal }, navigate: null };
  }
  if (status === 409) {
    const listed =
      issue === 'has_dependents'
        ? z.array(dependentSchema).safeParse(envelope?.details?.dependents)
        : null;
    return {
      result: {
        ok: false,
        code: 'conflict',
        issue: issue ?? 'conflict',
        ...(listed?.success ? { dependents: listed.data } : {}),
      },
      navigate: null,
    };
  }
  if (status === 404 && envelope?.code === 'NOT_FOUND') {
    return { result: { ok: false, code: 'conflict', issue: 'not_found' }, navigate: null };
  }
  if (status === 400 && envelope?.code === 'VALIDATION_FAILED') {
    const issues = envelope.details?.issues;
    if (Array.isArray(issues)) {
      const fields: Partial<Record<SaveFieldKey, string>> = {};
      for (const entry of issues as { path?: unknown; message?: unknown }[]) {
        const head = typeof entry.path === 'string' ? entry.path.split('.')[0] : undefined;
        const key = fieldOf(head === undefined ? [] : [head]);
        if (fields[key] === undefined) fields[key] = String(entry.message ?? 'invalid');
      }
      return { result: { ok: false, code: 'invalid', fields }, navigate: null };
    }
    // The route lifts the first issue code to `details.profileForm`: the path is lost, so a title issue is
    // best placed under the title and anything else is the whole form's.
    const key: SaveFieldKey = issue !== null && TITLE_ISSUES.has(issue) ? 'title' : 'form';
    return {
      result: { ok: false, code: 'invalid', fields: { [key]: issue ?? 'invalid' } },
      navigate: null,
    };
  }
  const navigate = navigationFor(status, envelope);
  if (!navigate) console.error(`profile_form.${label}_failed`, { status, code: envelope?.code });
  return { result: { ok: false, code: 'failed' }, navigate };
}

/**
 * After a write that REOPENED the form: how many members the form now holds, from `GET /summary`
 * (`total - complete`). A read that fails is `null` and the toast simply omits the count: the write
 * already happened and is not undone by a missing figure.
 */
async function pendingMembers(): Promise<number | null> {
  const sent = await send('summary', '/v1/profile_form/summary');
  if (sent.kind !== 'ok') return null;
  const parsed = profileFormSummarySchema.safeParse(sent.body);
  return parsed.success ? Math.max(parsed.data.total - parsed.data.complete, 0) : null;
}

/** The answer of a successful question write: the stored question and, when asked, the server's pending count. */
async function savedQuestion(body: unknown, reopens: boolean): Promise<SaveQuestionResult> {
  const question = adminQuestionSchema.safeParse(body);
  if (!question.success) return { ok: false, code: 'failed' };
  return { ok: true, question: question.data, pending: reopens ? await pendingMembers() : null };
}

/**
 * `POST /v1/profile_form/questions`: a new question at the END of the list. The body is validated here with
 * the contract's own schema first, so a malformed body never leaves the server tier and comes back per field.
 * `reopens` says the write may hold members back (a required question): the result then carries the server's
 * pending count for the toast.
 */
export async function createQuestionAction(
  body: unknown,
  options: { reopens?: boolean } = {},
): Promise<SaveQuestionResult> {
  const parsed = createQuestionBodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, code: 'invalid', fields: fieldsOf(parsed.error.issues) };

  const sent = await send('create', '/v1/profile_form/questions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed.data satisfies CreateQuestionBody),
  });
  if (sent.kind === 'ok') return savedQuestion(sent.body, options.reopens === true);

  const failure = failureOf('create', sent);
  if (failure.navigate) redirect(failure.navigate);
  return failure.result;
}

/**
 * `PATCH /v1/profile_form/questions/{id}`: an edit under the five D-587 locks and an optimistic `revision`.
 * The server answers `conflict` (`stale_revision`, one of the lock codes, `already_archived`) and the sheet
 * explains it; a body that changes nothing is a 200 that does not bump the revision.
 */
export async function updateQuestionAction(
  id: string,
  body: unknown,
  options: { reopens?: boolean } = {},
): Promise<SaveQuestionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, code: 'failed' };
  const parsed = updateQuestionBodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, code: 'invalid', fields: fieldsOf(parsed.error.issues) };

  const sent = await send('update', `/v1/profile_form/questions/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed.data),
  });
  if (sent.kind === 'ok') return savedQuestion(sent.body, options.reopens === true);

  const failure = failureOf('update', sent);
  if (failure.navigate) redirect(failure.navigate);
  return failure.result;
}

/**
 * `POST /v1/profile_form/questions/replace`: the new question and the archive of the old one as ONE server
 * operation, so a failure leaves the old question active (D-587, UI-D-574). The body is the create body plus
 * `replaces`; it is validated here with the contract's own schema first.
 */
export async function replaceQuestionAction(
  body: unknown,
  options: { reopens?: boolean } = {},
): Promise<SaveQuestionResult> {
  const parsed = replaceQuestionBodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, code: 'invalid', fields: fieldsOf(parsed.error.issues) };

  const sent = await send('replace', '/v1/profile_form/questions/replace', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed.data),
  });
  if (sent.kind === 'ok') return savedQuestion(sent.body, options.reopens === true);

  const failure = failureOf('replace', sent);
  if (failure.navigate) redirect(failure.navigate);
  return failure.result;
}

/**
 * What archive and delete answer: `hasAnswers` (409 `has_answers`: an answer arrived between the page read
 * and the tap, D-588), `gone` (404: the question is no longer there), and the shared codes.
 */
export type RemoveResult =
  | { ok: true }
  | { ok: false; code: 'hasAnswers' | 'gone' | 'forbidden' | 'moduleOff' | 'failed' }
  // 12.1-17 (D-632): the question still opens others; `dependents` is the server's list (a race the page missed).
  | { ok: false; code: 'hasDependents'; dependents: Dependent[] };

async function remove(
  label: 'archive' | 'delete',
  id: string,
  path: string,
  init: RequestInit,
): Promise<RemoveResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, code: 'failed' };
  const sent = await send(label, path, init);
  if (sent.kind === 'ok') return { ok: true };

  const failure = failureOf(label, sent);
  if (failure.navigate) redirect(failure.navigate);
  const result = failure.result;
  if (result.ok) return { ok: false, code: 'failed' };
  if (result.code === 'conflict') {
    if (result.issue === 'has_dependents') {
      return { ok: false, code: 'hasDependents', dependents: result.dependents ?? [] };
    }
    return { ok: false, code: result.issue === 'has_answers' ? 'hasAnswers' : 'gone' };
  }
  if (result.code === 'forbidden' || result.code === 'moduleOff') {
    return { ok: false, code: result.code };
  }
  return { ok: false, code: 'failed' };
}

/**
 * `POST /v1/profile_form/questions/{id}/archive`: the question leaves the form and every answer stays
 * (D-588). Idempotent on the server. It frees members, so it needs no impact count.
 */
export async function archiveQuestionAction(id: string): Promise<RemoveResult> {
  return remove('archive', id, `/v1/profile_form/questions/${id}/archive`, { method: 'POST' });
}

/**
 * `DELETE /v1/profile_form/questions/{id}`: only a question nobody ever answered. If an answer arrived since
 * the page was read the server refuses with `has_answers` and the screen offers "Arquivar" instead (D-588).
 */
export async function deleteQuestionAction(id: string): Promise<RemoveResult> {
  return remove('delete', id, `/v1/profile_form/questions/${id}`, { method: 'DELETE' });
}

// ── 12.1-16: the steps and the layout reorder ──────────────────────────────────────────────────────

/** One step of the layout body: the step and its active question ids in order. */
export type LayoutStepInput = { id: string; questionIds: string[] };

/**
 * What `PUT /order` with the layout body answers. `mismatch` is 409 `order_mismatch` (the list changed under
 * the admin); `condition_order` is the coded 409 of D-623 (a race the client check could not see) and names
 * the QUESTION that would sit at or before its opener and that opener, never a step.
 */
export type ReorderLayoutResult =
  | { ok: true }
  | { ok: false; code: 'forbidden' | 'moduleOff' | 'mismatch' | 'failed' }
  | { ok: false; code: 'condition_order'; questionId: string; openerId: string };

/**
 * `PUT /v1/profile_form/order` with the whole layout `{ steps: [{ id, questionIds }] }` (D-623, D-627): every
 * step in order and each step's questions in order, validated here with the contract's own schema first. The
 * write has already happened when the API answers, and the builder keeps the order it holds and re-reads the
 * list when the mode ends, so the refreshed list in the answer is not parsed.
 */
export async function reorderLayoutAction(input: {
  steps: LayoutStepInput[];
}): Promise<ReorderLayoutResult> {
  const body = layoutBodySchema.safeParse(input);
  if (!body.success) return { ok: false, code: 'failed' };

  const sent = await send('reorder_layout', '/v1/profile_form/order', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body.data),
  });
  if (sent.kind === 'ok') return { ok: true };
  if (sent.kind === 'thrown') return { ok: false, code: 'failed' };

  const { status, envelope } = sent;
  const refusal = refusalOf(status, envelope);
  if (refusal === 'forbidden' || refusal === 'moduleOff' || refusal === 'mismatch') {
    return { ok: false, code: refusal };
  }
  if (status === 409 && envelope?.details?.profileForm === 'condition_order') {
    const { questionId, openerId } = envelope.details;
    if (typeof questionId === 'string' && typeof openerId === 'string') {
      return { ok: false, code: 'condition_order', questionId, openerId };
    }
  }
  const navigate = navigationFor(status, envelope);
  if (navigate) redirect(navigate);
  console.error('profile_form.reorder_layout_failed', { status, code: envelope?.code });
  return { ok: false, code: 'failed' };
}

/** The issue codes of a title the API refuses with a 400 (UI-D-645). */
export type StepIssue = 'required' | 'too_long' | 'invalid';

const STEP_ISSUES: ReadonlySet<string> = new Set<StepIssue>(['required', 'too_long', 'invalid']);

const stepIssueOf = (value: unknown): StepIssue =>
  typeof value === 'string' && STEP_ISSUES.has(value) ? (value as StepIssue) : 'invalid';

/** What a refused step write is, in one closed vocabulary shared by the three step actions. */
type StepFailure =
  | { code: 'invalid'; issue: StepIssue }
  | {
      code:
        | 'limit_reached'
        | 'stale_revision'
        | 'step_not_empty'
        | 'last_step'
        | 'gone'
        | 'forbidden'
        | 'moduleOff'
        | 'failed';
    };

/**
 * The refusals of the step routes (plans 08 and 09): 403 and the module switch like the rest of the builder,
 * 409 `limit_reached` (10 steps), `stale_revision`, `step_not_empty` and `last_step`, a bare 404 for a step
 * that is gone and a 400 with the title's issue code. A session refusal is the `(app)` navigation, done by
 * the caller OUTSIDE any try/catch.
 */
function stepFailureOf(
  label: string,
  sent: Exclude<Sent, { kind: 'ok' }>,
): { failure: StepFailure; navigate: string | null } {
  if (sent.kind === 'thrown') return { failure: { code: 'failed' }, navigate: null };
  const { status, envelope } = sent;
  const detail = envelope?.details?.profileForm;

  const refusal = refusalOf(status, envelope);
  if (refusal === 'forbidden' || refusal === 'moduleOff') {
    return { failure: { code: refusal }, navigate: null };
  }
  if (status === 409) {
    if (detail === 'limit_reached') return { failure: { code: 'limit_reached' }, navigate: null };
    if (detail === 'stale_revision') return { failure: { code: 'stale_revision' }, navigate: null };
    if (detail === 'step_not_empty') return { failure: { code: 'step_not_empty' }, navigate: null };
    if (detail === 'last_step') return { failure: { code: 'last_step' }, navigate: null };
  }
  if (status === 404 && envelope?.code === 'NOT_FOUND') {
    return { failure: { code: 'gone' }, navigate: null };
  }
  if (status === 400 && envelope?.code === 'VALIDATION_FAILED') {
    return { failure: { code: 'invalid', issue: stepIssueOf(detail) }, navigate: null };
  }
  const navigate = navigationFor(status, envelope);
  if (!navigate) console.error(`profile_form.${label}_failed`, { status, code: envelope?.code });
  return { failure: { code: 'failed' }, navigate };
}

export type CreateStepResult =
  | { ok: true; step: AdminStep }
  | { ok: false; code: 'invalid'; issue: StepIssue }
  | { ok: false; code: 'limit_reached' | 'forbidden' | 'moduleOff' | 'failed' };

/**
 * `POST /v1/profile_form/steps`: a new EMPTY step at the END of the form (D-627). The title is validated
 * here with the contract's own schema first, so an empty or too long one never leaves the server tier. A
 * tenant with no step yet gets its default step first (the server does it); the new step is still last.
 */
export async function createStepAction(input: { title: string }): Promise<CreateStepResult> {
  const parsed = createStepBodySchema.safeParse({ title: input.title });
  if (!parsed.success) {
    return { ok: false, code: 'invalid', issue: stepIssueOf(parsed.error.issues[0]?.message) };
  }

  const sent = await send('create_step', '/v1/profile_form/steps', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed.data),
  });
  if (sent.kind === 'ok') {
    const step = adminStepSchema.safeParse(sent.body);
    return step.success ? { ok: true, step: step.data } : { ok: false, code: 'failed' };
  }

  const { failure, navigate } = stepFailureOf('create_step', sent);
  if (navigate) redirect(navigate);
  if (failure.code === 'invalid') return { ok: false, code: 'invalid', issue: failure.issue };
  if (failure.code === 'limit_reached' || failure.code === 'forbidden') {
    return { ok: false, code: failure.code };
  }
  if (failure.code === 'moduleOff') return { ok: false, code: 'moduleOff' };
  return { ok: false, code: 'failed' };
}

export type RenameStepResult =
  | { ok: true; step: AdminStep }
  | { ok: false; code: 'invalid'; issue: StepIssue }
  | { ok: false; code: 'stale_revision' | 'gone' | 'forbidden' | 'moduleOff' | 'failed' };

/**
 * `PATCH /v1/profile_form/steps/{id}`: the new title under the optimistic `revision` the admin read. A stale
 * revision is its own code so the sheet keeps the typed title and the page re-reads the step.
 */
export async function renameStepAction(input: {
  id: string;
  revision: number;
  title: string;
}): Promise<RenameStepResult> {
  if (!z.uuid().safeParse(input.id).success) return { ok: false, code: 'failed' };
  const parsed = updateStepBodySchema.safeParse({ revision: input.revision, title: input.title });
  if (!parsed.success) {
    return { ok: false, code: 'invalid', issue: stepIssueOf(parsed.error.issues[0]?.message) };
  }

  const sent = await send('rename_step', `/v1/profile_form/steps/${input.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed.data),
  });
  if (sent.kind === 'ok') {
    const step = adminStepSchema.safeParse(sent.body);
    return step.success ? { ok: true, step: step.data } : { ok: false, code: 'failed' };
  }

  const { failure, navigate } = stepFailureOf('rename_step', sent);
  if (navigate) redirect(navigate);
  if (failure.code === 'invalid') return { ok: false, code: 'invalid', issue: failure.issue };
  if (
    failure.code === 'stale_revision' ||
    failure.code === 'gone' ||
    failure.code === 'forbidden' ||
    failure.code === 'moduleOff'
  ) {
    return { ok: false, code: failure.code };
  }
  return { ok: false, code: 'failed' };
}

export type DeleteStepActionResult =
  | { ok: true }
  | {
      ok: false;
      code: 'step_not_empty' | 'last_step' | 'gone' | 'forbidden' | 'moduleOff' | 'failed';
    };

/**
 * `DELETE /v1/profile_form/steps/{id}`: only a step with no ACTIVE question, and never the only step. An
 * ARCHIVED question of the step is re-pointed to the first remaining step by the server, so deleting a step
 * never discards a question or an answer. The two refusals are coded so the sheet can explain them.
 */
export async function deleteStepAction(id: string): Promise<DeleteStepActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, code: 'failed' };

  const sent = await send('delete_step', `/v1/profile_form/steps/${id}`, { method: 'DELETE' });
  if (sent.kind === 'ok') {
    return deleteStepResultSchema.safeParse(sent.body).success
      ? { ok: true }
      : { ok: false, code: 'failed' };
  }

  const { failure, navigate } = stepFailureOf('delete_step', sent);
  if (navigate) redirect(navigate);
  if (
    failure.code === 'step_not_empty' ||
    failure.code === 'last_step' ||
    failure.code === 'gone' ||
    failure.code === 'forbidden' ||
    failure.code === 'moduleOff'
  ) {
    return { ok: false, code: failure.code };
  }
  return { ok: false, code: 'failed' };
}

// ── 12.2-16: the branch sheet's write (D-640, D-644, D-651; PFORM-57; T-12.2-01) ───────────────────

/** The field of the branch sheet a refusal belongs to; `form` is a refusal no single field owns. */
export type BranchFieldKey = 'name' | 'values' | 'opener' | 'form';

/**
 * What `createBranchAction` answers. `invalid` is a refused body (the contract here, or the server's 400): the
 * issue code per field, which the sheet renders under that field. `limit` is 409 `branch_limit` (15 active
 * branches). `conflict` is any other 409 (`branch_depth`: a third level too deep; `condition_invalid`: the
 * opener or its answers changed meanwhile) or a bare 404 (`not_found`).
 */
export type SaveBranchResult =
  | { ok: true; branch: AdminBranch }
  | { ok: false; code: 'invalid'; fields: Partial<Record<BranchFieldKey, string>> }
  | { ok: false; code: 'conflict'; issue: string }
  | { ok: false; code: 'limit' | 'forbidden' | 'moduleOff' | 'failed' };

/** The field of a branch body's issue path. */
function branchFieldOf(head: PropertyKey | undefined): BranchFieldKey {
  if (head === 'name') return 'name';
  if (head === 'values') return 'values';
  if (head === 'openerQuestionId') return 'opener';
  return 'form';
}

/**
 * `POST /v1/profile_form/branches`: a new, EMPTY branch from its opener (D-651). The body is validated here with
 * the contract's own schema first (answers 1 to 20 and unique, the name trimmed, at most 60 CODE POINTS, a
 * control character refused, a blank name sent as `null`), so a malformed body never leaves the server tier and
 * comes back per field. The server re-validates every rule and every id (a foreign opener is the same refusal as
 * a missing one, T-12.2-01). Only a status and a code reach a log line, never a name or an answer.
 */
export async function createBranchAction(body: unknown): Promise<SaveBranchResult> {
  const parsed = createBranchBodySchema.safeParse(body);
  if (!parsed.success) {
    const fields: Partial<Record<BranchFieldKey, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = branchFieldOf(issue.path[0]);
      if (fields[key] === undefined) fields[key] = issue.message;
    }
    return { ok: false, code: 'invalid', fields };
  }

  const sent = await send('create_branch', '/v1/profile_form/branches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed.data satisfies CreateBranchBody),
  });
  if (sent.kind === 'ok') {
    const branch = adminBranchSchema.safeParse(sent.body);
    return branch.success ? { ok: true, branch: branch.data } : { ok: false, code: 'failed' };
  }

  if (sent.kind === 'error' && sent.status === 400 && sent.envelope?.code === 'VALIDATION_FAILED') {
    const fields: Partial<Record<BranchFieldKey, string>> = {};
    const issues = sent.envelope.details?.issues;
    if (Array.isArray(issues)) {
      for (const entry of issues as { path?: unknown; message?: unknown }[]) {
        const head = typeof entry.path === 'string' ? entry.path.split('.')[0] : undefined;
        const key = branchFieldOf(head);
        if (fields[key] === undefined) fields[key] = String(entry.message ?? 'invalid');
      }
    } else {
      // The route lifts the first issue code to `details.profileForm`: the path is lost.
      const lifted = sent.envelope.details?.profileForm;
      fields.form = typeof lifted === 'string' ? lifted : 'invalid';
    }
    return { ok: false, code: 'invalid', fields };
  }

  const failure = failureOf('create_branch', sent);
  if (failure.navigate) redirect(failure.navigate);
  const result = failure.result;
  if (result.code === 'conflict') {
    if (result.issue === 'branch_limit') return { ok: false, code: 'limit' };
    return { ok: false, code: 'conflict', issue: result.issue };
  }
  if (result.code === 'limit' || result.code === 'forbidden' || result.code === 'moduleOff') {
    return { ok: false, code: result.code };
  }
  return { ok: false, code: 'failed' };
}
