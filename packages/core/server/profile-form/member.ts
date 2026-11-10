import { createHash } from 'node:crypto';
import {
  answerEtag,
  answerTokens,
  type DismissNoticeResult,
  type MemberForm,
  type MemberQuestion,
  memberBranchSchema,
  missingIssue,
  PROFILE_FORM_LIMITS,
  type ProfessionalIdFormat,
  type ProfileFormBootstrap,
  type ProfileFormIssue,
  type ProfileFormMode,
  type ProfileFormQuestionDef,
  type ProfileFormType,
  parseAnswer,
  type SaveAnswersBody,
  type SaveAnswersResult,
} from '@rede-social/contracts/profile-form';
import {
  type BranchTree,
  branchTreeOf,
  isQuestionVisibleInTree,
} from '@rede-social/contracts/profile-form-branches';
import { and, eq, sql } from 'drizzle-orm';
import { memberships, tenantModules } from '../../db/schema';
import { type Tx, withTenantTx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { ApiError } from '../http/api-error';
import { membershipOfRecord } from '../tenancy/membership-scope';
import { questionVisibleSql } from './visibility-sql';

/**
 * The member side of the profile form that the kernel owns (Phase 12-05 and 12-06). Pure tenant lane: every
 * statement runs in the caller's own transaction under RLS, with an explicit `tenant_id` / `membership_id`
 * predicate beside it (layer 2 of the three-layer scoping).
 *
 * The module key is a literal on purpose: the kernel never imports a module package. These are KERNEL routes
 * with no `requireModule` (UI-SPEC "Nothing to answer"): a module switched off meanwhile makes the read
 * `mode: 'none'` and the save a 200 no-op, never a 404.
 *
 * NOTHING HERE LOGS, and no thrown message carries a value: an answer is member content (T-12-15). Errors carry
 * closed issue codes keyed by question id and nothing else.
 */
const MODULE_KEY = 'profile_form';

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role'>;

/**
 * Whether the tenant's `profile_form` module is on RIGHT NOW: a live read of the `tenant_modules` row in
 * the given transaction, never the 30-second flags cache. The gate (`app.profile_form_missing`) reads the
 * same row live, so a bootstrap built from this answer and a gate that refuses cannot disagree (RESEARCH
 * Pitfall 1: a member would otherwise ping-pong between a refusal and an empty form). A missing row reads
 * as off.
 */
export async function liveModuleOn(tx: Tx, ctx: Pick<Ctx, 'tenantId'>): Promise<boolean> {
  const [row] = await tx
    .select({ enabled: tenantModules.enabled })
    .from(tenantModules)
    .where(and(eq(tenantModules.tenantId, ctx.tenantId), eq(tenantModules.moduleKey, MODULE_KEY)))
    .limit(1);
  return row?.enabled === true;
}

/** A non-negative integer count from a SQL result; anything else is a broken invariant, not "zero". */
function count(value: unknown, what: string): number {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what} returned an unexpected count`);
  return n;
}

/** `app.profile_form_missing_self()`: the SAME SQL rule the gate runs, derived from the session claims. */
async function missingSelf(tx: Tx): Promise<number> {
  const rows = await tx.execute<{ missing: number | string }>(
    sql`select app.profile_form_missing_self() as missing`,
  );
  return count(rows[0]?.missing ?? 0, 'profile_form_missing_self');
}

/**
 * The ACTIVE OPTIONAL questions listed after the member's "Agora não" instant (all of them while it is null)
 * that she has not answered AND can see (D-586, D-644): a question in a branch is new for her only while every
 * branch on its chain is open for her, the one SQL text the gate and the purge share (`questionVisibleSql`), so
 * a question her answers keep hidden at any depth is not "new". The tenant and the member reach the fragment as
 * columns of the `me` derived table (the fragment takes identifiers only), and are bound as parameters here.
 * Counts only: no title or value is selected.
 */
async function newOptionalCount(tx: Tx, ctx: Ctx): Promise<number> {
  const visible = sql.raw(
    questionVisibleSql({ question: 'q', tenant: 'me.tenant_id', member: 'me.membership_id' }),
  );
  const fresh = await tx.execute<{ fresh: number | string }>(sql`
    select count(*)::int as fresh
      from (select m.tenant_id, m.id as membership_id
              from public.memberships m
             where m.tenant_id = ${ctx.tenantId}::uuid
               and m.user_id = ${ctx.userId}::uuid
               and m.deleted_at is null
             limit 1) me
      join public.profile_form_questions q on q.tenant_id = me.tenant_id
     where q.archived_at is null
       and q.required = false
       and q.listed_at > coalesce(
             (select p.profile_form_notice_dismissed_at
                from public.member_profiles p
               where p.membership_id = me.membership_id
               limit 1),
             '-infinity'::timestamptz)
       and ${visible}
       and not exists (
             select 1
               from public.profile_form_answers a
              where a.tenant_id = q.tenant_id
                and a.question_id = q.id
                and a.membership_id = me.membership_id)`);
  return count(fresh[0]?.fresh ?? 0, 'profile form optional count');
}

/**
 * `GET /v1/me/bootstrap`'s `profileForm` block (PFORM-12, D-584, D-585, D-586): `undefined` when the role is
 * not `member` or the module is off; otherwise
 *   - `pendingRequired`: `app.profile_form_missing_self()`, the SAME SQL rule the gate runs;
 *   - `newOptional`: see `newOptionalCount`.
 */
export async function bootstrapBlock(tx: Tx, ctx: Ctx): Promise<ProfileFormBootstrap | undefined> {
  if (ctx.role !== 'member') return undefined;
  if (!(await liveModuleOn(tx, ctx))) return undefined;
  const pendingRequired = await missingSelf(tx);
  const newOptional = await newOptionalCount(tx, ctx);
  return { pendingRequired, newOptional };
}

// ── The member's read and save (12-06, 12.2-10) ─────────────────────────────────────────────────────

/** One active question as the database stores it, in the admin's order. */
type QuestionRow = {
  id: string;
  type: ProfileFormType;
  title: string;
  help_text: string | null;
  required: boolean;
  show_on_profile: boolean;
  allow_other: boolean;
  options: { id: string; label: string }[];
  limits: { min?: number | string; max?: number | string; format?: ProfessionalIdFormat };
  position: number;
  revision: number;
  /** 12.1 (D-627): the step the question sits in; every question has exactly one. */
  step_id: string;
  /** 12.2 (D-640): the branch the question sits in, or null for an always-shown question. */
  branch_id: string | null;
};

/** A step of the tenant as the etag needs it: its revision moves with every rename. */
type StepRow = { id: string; title: string; revision: number };

/**
 * A branch as a member may read it: the opener, the opening values and the revision the etag needs. The name
 * is NEVER selected here (T-12.2-03): it belongs to the admin lane.
 */
type BranchRow = {
  id: string;
  opener_question_id: string;
  open_values: string[];
  revision: number;
  archived_at: string | Date | null;
};

const toDef = (row: QuestionRow): ProfileFormQuestionDef => ({
  id: row.id,
  type: row.type,
  required: row.required,
  allowOther: row.allow_other,
  options: row.options,
  limits: row.limits,
});

/** The tree the visibility rule walks, from the rows read and every branch of the tenant (archived too). */
const treeOf = (rows: readonly QuestionRow[], branches: readonly BranchRow[]): BranchTree =>
  branchTreeOf(
    rows.map((row) => ({ id: row.id, branchId: row.branch_id })),
    branches.map((branch) => ({
      id: branch.id,
      openerQuestionId: branch.opener_question_id,
      values: branch.open_values,
    })),
  );

/** The branches the form shows and the etag covers: the ACTIVE ones. */
const activeBranches = (branches: readonly BranchRow[]): BranchRow[] =>
  branches.filter((branch) => branch.archived_at === null);

/**
 * The plain read of the active questions: the member form, in the order `position, created_at, id` (the same
 * canonical order the lock below uses). RLS limits the rows to the caller's tenant; the explicit predicate is
 * layer 2.
 */
async function readActiveQuestions(tx: Tx, ctx: Ctx): Promise<QuestionRow[]> {
  const rows = await tx.execute<QuestionRow>(sql`
    select q.id::text as id, q.type, q.title, q.help_text, q.required, q.show_on_profile,
           q.allow_other, q.options, q.limits, q.position, q.revision,
           q.step_id::text as step_id, q.branch_id::text as branch_id
      from public.profile_form_questions q
     where q.tenant_id = ${ctx.tenantId}::uuid
       and q.archived_at is null
     order by q.position, q.created_at, q.id`);
  return [...rows];
}

/** The tenant's branches, active and archived, without the name (members read them through their own policy). */
async function readBranches(tx: Tx, ctx: Ctx): Promise<BranchRow[]> {
  const rows = await tx.execute<BranchRow>(sql`
    select b.id::text as id, b.opener_question_id::text as opener_question_id,
           b.open_values, b.revision, b.archived_at
      from public.profile_form_branches b
     where b.tenant_id = ${ctx.tenantId}::uuid
     order by b.created_at, b.id`);
  return rows.map((row) => ({ ...row, revision: Number(row.revision) }));
}

/**
 * The same rows, locked `FOR SHARE` in the same canonical order (PFORM-24 member half, T-12-16). A member
 * cannot lock them herself: `FOR SHARE` applies the UPDATE policy, which only an admin passes, so from her
 * session it would lock and return nothing. `app.profile_form_lock_active_v3()` is a definer function that
 * takes the tenant from the session claims and locks regardless of the caller's role; the `_v3` swaps the
 * condition columns for the branch id (the older functions stay one release for the API revision still serving).
 */
async function lockActiveQuestions(tx: Tx): Promise<QuestionRow[]> {
  const rows = await tx.execute<QuestionRow>(sql`
    select id::text as id, type, title, help_text, required, show_on_profile,
           allow_other, options, limits, "position" as position, revision,
           step_id::text as step_id, branch_id::text as branch_id
      from app.profile_form_lock_active_v3()`);
  return [...rows];
}

/**
 * The branches, locked `FOR SHARE` AFTER the questions (D-645, T-12.2-04): the admin's writes lock questions
 * then branches in the same order, so there is no cycle, and an admin cannot change a branch's answers or its
 * opener under a member's in-flight answer. The definer function returns the branch WITHOUT its name.
 */
async function lockBranches(tx: Tx): Promise<BranchRow[]> {
  const rows = await tx.execute<BranchRow>(sql`
    select id::text as id, opener_question_id::text as opener_question_id,
           open_values, revision, archived_at
      from app.profile_form_lock_branches()`);
  return rows.map((row) => ({ ...row, revision: Number(row.revision) }));
}

/**
 * The steps a member is shown (D-628): the tenant's steps in `position, created_at, id` order that hold at
 * least one of the given ACTIVE questions. An empty step, and a step that only holds archived questions, is
 * never shown. Members read the steps through their own SELECT policy; the explicit tenant predicate is layer 2.
 */
async function readFormSteps(
  tx: Tx,
  ctx: Ctx,
  rows: readonly Pick<QuestionRow, 'step_id'>[],
): Promise<StepRow[]> {
  const held = new Set(rows.map((row) => row.step_id));
  const all = await tx.execute<{ id: string; title: string; revision: number | string }>(sql`
    select s.id::text as id, s.title, s.revision
      from public.profile_form_steps s
     where s.tenant_id = ${ctx.tenantId}::uuid
     order by s."position", s.created_at, s.id`);
  return all
    .filter((step) => held.has(step.id))
    .map((step) => ({ id: step.id, title: step.title, revision: Number(step.revision) }));
}

/** What the etag reads of a branch: what a member renders from it (never its name or its admin revision). */
type EtagBranch = { id: string; opener_question_id: string; open_values: readonly string[] };

/**
 * The identity of the form: a short hash of each question's `id:revision:step_id` (plus the branch id as a
 * fourth segment only when the question has one) in list order, the shown steps' `id:revision` and, only when
 * a branch holds an active question, those branches' `id:digest` (D-629, D-644). A form without branches
 * therefore hashes to exactly what 12.1 produced for the same questions and steps. A question moved between
 * steps or branches, a step rename and a branch's opener or opening values each change it.
 *
 * WR-02: a branch is covered by what a member renders from it (its opener and its sorted opening values), not
 * by its admin `revision`, and a branch with no active question is not covered at all. Renaming a branch (a
 * label members never see, D-642) or creating an empty one therefore does not turn every in-flight save of every
 * member into a 409 `form_changed`; the questions that later fill it carry their own branch id segment.
 */
export function formEtagOf(
  questions: readonly {
    id: string;
    revision: number;
    step_id: string;
    branch_id?: string | null;
  }[],
  steps: readonly { id: string; revision: number }[],
  branches: readonly EtagBranch[] = [],
): string {
  const held = new Set(questions.map((question) => question.branch_id ?? null));
  const covered = branches
    .filter((branch) => held.has(branch.id))
    .map((branch) => ({
      id: branch.id,
      revision: `${branch.opener_question_id}~${[...branch.open_values].sort().join(',')}`,
    }));
  const text = answerEtag(
    questions.map((question) => ({
      id: question.id,
      revision: question.revision,
      stepId: question.step_id,
      branchId: question.branch_id ?? null,
    })),
    steps,
    covered.length === 0 ? undefined : covered,
  );
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

async function ownMembershipId(tx: Tx, ctx: Ctx): Promise<string> {
  const [row] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(membershipOfRecord(ctx))
    .limit(1);
  if (!row) throw new ApiError(403, 'FORBIDDEN');
  return row.id;
}

type StoredAnswer = MemberQuestion['answer'];

/** The member's own stored answers by question id (self policy plus the explicit predicate). */
async function readOwnAnswers(
  tx: Tx,
  ctx: Ctx,
  membershipId: string,
): Promise<Map<string, NonNullable<StoredAnswer>>> {
  const rows = await tx.execute<{ question_id: string; value: NonNullable<StoredAnswer> }>(sql`
    select a.question_id::text as question_id, a.value
      from public.profile_form_answers a
     where a.tenant_id = ${ctx.tenantId}::uuid
       and a.membership_id = ${membershipId}::uuid`);
  return new Map(rows.map((row) => [row.question_id, row.value]));
}

const EMPTY_FORM: MemberForm = {
  mode: 'none',
  missingRequired: 0,
  formEtag: formEtagOf([], []),
  steps: [],
  questions: [],
  branches: [],
};

/** The member form payload from already-read rows: pre-filled answers, `mode`, `missingRequired`, `formEtag`. */
async function formFromRows(
  tx: Tx,
  ctx: Ctx,
  rows: readonly QuestionRow[],
  branches: readonly BranchRow[],
  membershipId: string,
): Promise<MemberForm> {
  const answers = await readOwnAnswers(tx, ctx, membershipId);
  const missingRequired = await missingSelf(tx);
  const steps = await readFormSteps(tx, ctx, rows);
  const shown = activeBranches(branches);
  const questions: MemberQuestion[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    helpText: row.help_text,
    required: row.required,
    showOnProfile: row.show_on_profile,
    allowOther: row.allow_other,
    limits: row.limits,
    stepId: row.step_id,
    branchId: row.branch_id,
    options: row.options,
    answer: answers.get(row.id) ?? null,
  }));
  // The mode is decided from the data, never from the URL (D-582).
  let mode: ProfileFormMode;
  if (rows.length === 0) mode = 'none';
  else if (missingRequired === 0) mode = 'edit';
  else if (questions.every((question) => question.answer === null)) mode = 'first';
  else mode = 'returning';
  return {
    mode,
    missingRequired,
    formEtag: formEtagOf(rows, steps, shown),
    steps: steps.map((step) => ({ id: step.id, title: step.title })),
    questions,
    // The strict member shape: the parse is the guard that no name rides along (T-12.2-03).
    branches: shown.map((branch) =>
      memberBranchSchema.parse({
        id: branch.id,
        openerQuestionId: branch.opener_question_id,
        values: branch.open_values,
      }),
    ),
  };
}

/**
 * `GET /v1/me/profile-form` (D-582, D-628, D-630, D-644): every ACTIVE question in the admin's order, hidden
 * ones included (the client reveals live), each with its `stepId` and `branchId`, the ACTIVE branches without a
 * name, pre-filled with the member's own stored answers, plus the shown `steps`. Staff and a module that is off
 * get `mode: 'none'` and no questions.
 */
export async function getMemberForm(ctx: Ctx): Promise<MemberForm> {
  return withTenantTx(ctx, async (tx) => {
    if (ctx.role !== 'member' || !(await liveModuleOn(tx, ctx))) return EMPTY_FORM;
    const membershipId = await ownMembershipId(tx, ctx);
    const rows = await readActiveQuestions(tx, ctx);
    const branches = await readBranches(tx, ctx);
    return formFromRows(tx, ctx, rows, branches, membershipId);
  });
}

/** The keyed refusal: the errors object lists the questions in the admin's order, unknown ids last. */
function refuse(order: readonly string[], errors: ReadonlyMap<string, ProfileFormIssue>): ApiError {
  const ordered: Record<string, ProfileFormIssue> = {};
  for (const id of order) {
    const issue = errors.get(id);
    if (issue) ordered[id] = issue;
  }
  const known = new Set(order);
  for (const id of [...errors.keys()].filter((key) => !known.has(key)).sort()) {
    const issue = errors.get(id);
    if (issue) ordered[id] = issue;
  }
  return new ApiError(400, 'VALIDATION_FAILED', {
    profileForm: 'answers_invalid',
    errors: ordered,
  });
}

/** A JSON value as a string with the object keys sorted, so two equal stored values compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The refusal of a race: the form changed under this save, so the client gets the fresh one (D-629). */
async function formChanged(tx: Tx, ctx: Ctx, membershipId: string): Promise<ApiError> {
  const fresh = await readActiveQuestions(tx, ctx);
  const branches = await readBranches(tx, ctx);
  return new ApiError(409, 'CONFLICT', {
    profileForm: 'form_changed',
    form: await formFromRows(tx, ctx, fresh, branches, membershipId),
  });
}

/**
 * What the member still owes after a save (D-629, D-631, D-644): the ids of the VISIBLE required questions with
 * no answer, over the whole form, in the form's order, and `missingRequired` from the SAME SQL function the gate
 * runs. The two are computed apart (TypeScript with `isQuestionVisibleInTree`, SQL with the chain fragment) and
 * must agree; when they do not a required question appeared after the lock was taken, and the save is a
 * `form_changed` (FA-32). Never refuses for what is owed elsewhere: only the SQL gate holds a member in.
 */
async function reportMissing(
  tx: Tx,
  ctx: Ctx,
  rows: readonly QuestionRow[],
  tree: BranchTree,
  membershipId: string,
): Promise<SaveAnswersResult> {
  const answers = await readOwnAnswers(tx, ctx, membershipId);
  const tokensOf = (id: string) => answerTokens(answers.get(id));
  const missingQuestionIds = rows
    .filter(
      (row) =>
        row.required &&
        !answers.has(row.id) &&
        isQuestionVisibleInTree({ branchId: row.branch_id }, tree, tokensOf),
    )
    .map((row) => row.id);
  const missingRequired = await missingSelf(tx);
  if (missingRequired !== missingQuestionIds.length) throw await formChanged(tx, ctx, membershipId);
  return { missingRequired, missingQuestionIds };
}

/**
 * `PUT /v1/me/profile-form/answers` (D-585, D-624, D-629, D-631, D-636, D-641, D-645; PFORM-07, PFORM-24,
 * PFORM-30, PFORM-33): one step, or the whole screen, in ONE transaction.
 *
 *   1. staff are refused (403); a module that is off is a 200 no-op;
 *   2. the active questions, then the branches, are locked `FOR SHARE` in the canonical order BEFORE anything is
 *      validated, so an admin's type, option, branch or step edit and this save never interleave; then a
 *      per-member advisory lock serialises two saves of one member, so the stored answers they read are never
 *      half-written;
 *   3. a stale `formEtag` (it hashes ids, revisions, steps, branch ids and the opener and values of the active branches that hold a question) is a 409
 *      `form_changed` carrying the fresh form, and nothing is written;
 *   4. the scope is the questions of `stepId`, or every active question without one. An unknown, empty or
 *      foreign step is 400 `unknown_step`; a key outside the scope is `unknown_question`;
 *   5. visibility is settled HERE in ONE pass over the questions in form order, from the effective answers
 *      (stored, overlaid with the submitted values as the pass reaches them), with the contracts'
 *      `isQuestionVisibleInTree`: the opener of a branch is strictly before every question of that branch, so
 *      a value applied to the effective answers only when its question is visible at that moment settles every
 *      level. The client's copy of the rule is only a convenience (T-12.1-16). A value for a question that is not
 *      visible is ignored, with no error and no write (T-12.2-05). A visible question goes through `parseAnswer`
 *      built from the STORED question; a visible required one left without an answer is `required` /
 *      `not_ticked`, but only inside the scope: what is owed in another step is reported, never refused (D-629);
 *   6. rows are written in the canonical question order (unchanged values are not rewritten), then
 *      `app.profile_form_purge_closed()` deletes, in the same transaction, the answers to every question that
 *      stopped applying through any level, ACTIVE or ARCHIVED (D-624, D-636, D-645);
 *   7. the report: `{ missingRequired, missingQuestionIds }`, the SQL count cross-checked with the list.
 *
 * `answers: {}` writes nothing and answers the current report. No completeness is ever stored.
 */
export async function saveAnswers(ctx: Ctx, body: SaveAnswersBody): Promise<SaveAnswersResult> {
  if (ctx.role !== 'member') throw new ApiError(403, 'FORBIDDEN');
  return withTenantTx(ctx, async (tx) => {
    if (!(await liveModuleOn(tx, ctx))) return { missingRequired: 0, missingQuestionIds: [] };
    const membershipId = await ownMembershipId(tx, ctx);
    const rows = await lockActiveQuestions(tx);
    const branches = await lockBranches(tx);
    const steps = await readFormSteps(tx, ctx, rows);
    const tree = treeOf(rows, branches);

    if (body.formEtag !== formEtagOf(rows, steps, activeBranches(branches))) {
      throw new ApiError(409, 'CONFLICT', {
        profileForm: 'form_changed',
        form: await formFromRows(tx, ctx, rows, branches, membershipId),
      });
    }

    // Scope (D-629). `steps` holds only steps with an active question, so an empty step is unknown too.
    let scope: readonly QuestionRow[] = rows;
    if (body.stepId !== undefined) {
      const stepId = body.stepId.toLowerCase();
      if (!steps.some((step) => step.id === stepId)) {
        throw new ApiError(400, 'VALIDATION_FAILED', { profileForm: 'unknown_step' });
      }
      scope = rows.filter((row) => row.step_id === stepId);
    }

    // Two saves of one member run one after the other: the answers read below are never a half-written view.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${MODULE_KEY}:member:${membershipId}`}, 0))`,
    );

    const submitted = Object.keys(body.answers);
    if (submitted.length === 0) return reportMissing(tx, ctx, rows, tree, membershipId);

    const order = scope.map((row) => row.id);
    const inScope = new Set(order);
    const errors = new Map<string, ProfileFormIssue>();
    for (const id of submitted) if (!inScope.has(id)) errors.set(id, 'unknown_question');

    // The parsed value of every submitted, in-scope key (null: the member cleared it).
    const parsedOf = new Map<string, ReturnType<typeof parseAnswer>>();
    for (const row of scope) {
      if (Object.hasOwn(body.answers, row.id)) {
        parsedOf.set(row.id, parseAnswer(toDef(row), body.answers[row.id]));
      }
    }

    // ONE pass in form order (D-645). `effective` starts as the stored answers and takes each valid submitted
    // value the moment its question is reached and visible, so every later question, at any depth, is judged
    // against the answers the member is giving in this very save.
    const stored = await readOwnAnswers(tx, ctx, membershipId);
    const effective = new Map<string, unknown>(stored);
    const tokensOf = (id: string) => answerTokens(effective.get(id));
    const writes: { id: string; value: unknown | null }[] = [];
    for (const row of rows) {
      // T-12.2-05: a question that is not visible takes no value, valid or not, and raises no error.
      if (!isQuestionVisibleInTree({ branchId: row.branch_id }, tree, tokensOf)) continue;
      if (!inScope.has(row.id)) continue;
      const def = toDef(row);
      const parsed = parsedOf.get(row.id);
      if (parsed === undefined) {
        if (row.required && !effective.has(row.id)) errors.set(row.id, missingIssue(def));
      } else if (!parsed.ok) {
        errors.set(row.id, parsed.issue);
      } else if (parsed.value === null) {
        effective.delete(row.id);
        if (row.required) errors.set(row.id, missingIssue(def));
        else writes.push({ id: row.id, value: null });
      } else if (
        Buffer.byteLength(JSON.stringify(parsed.value), 'utf8') > PROFILE_FORM_LIMITS.valueBytes
      ) {
        // The table CHECK would raise a 500; a value that big is a text too long in bytes.
        errors.set(row.id, 'too_long');
      } else {
        effective.set(row.id, parsed.value);
        writes.push({ id: row.id, value: parsed.value });
      }
    }
    if (errors.size > 0) throw refuse(order, errors);

    for (const write of writes) {
      const current = stored.get(write.id);
      if (write.value === null) {
        if (current === undefined) continue;
        await tx.execute(sql`
          delete from public.profile_form_answers
           where tenant_id = ${ctx.tenantId}::uuid
             and membership_id = ${membershipId}::uuid
             and question_id = ${write.id}::uuid`);
      } else {
        // PFORM-33 idempotency: an unchanged value is not rewritten, so `updated_at` stays.
        if (current !== undefined && canonical(current) === canonical(write.value)) continue;
        await tx.execute(sql`
          insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
          values (${ctx.tenantId}::uuid, ${write.id}::uuid, ${membershipId}::uuid, ${ctx.userId}::uuid,
                  ${JSON.stringify(write.value)}::jsonb)
          on conflict (tenant_id, membership_id, question_id)
          do update set value = excluded.value, updated_at = now()`);
      }
    }

    // D-624, D-636, D-645: what stopped applying is deleted by the save that closed it, in this transaction, at
    // every depth. It covers archived questions too (a member cannot see them through RLS, hence the definer
    // function).
    await tx.execute(sql`select question_id from app.profile_form_purge_closed()`);

    return reportMissing(tx, ctx, rows, tree, membershipId);
  });
}

/**
 * `POST /v1/me/profile-form/dismiss-notice` (D-586): "Agora não" on the "Há perguntas novas" notice, stored on
 * the server so it survives a reinstall and another device. Batch granularity: one instant, and a question
 * listed after it brings the notice back. Deliberately NOT a `coalesce` (unlike the first-access nudge): a later
 * dismissal after a later batch must move the timestamp forward. Staff are refused; a module that is off is a
 * no-op.
 */
export async function dismissNotice(ctx: Ctx): Promise<DismissNoticeResult> {
  if (ctx.role !== 'member') throw new ApiError(403, 'FORBIDDEN');
  return withTenantTx(ctx, async (tx) => {
    if (!(await liveModuleOn(tx, ctx))) return { newOptional: 0 };
    const membershipId = await ownMembershipId(tx, ctx);
    await tx.execute(sql`
      update public.member_profiles
         set profile_form_notice_dismissed_at = now(), updated_at = now()
       where tenant_id = ${ctx.tenantId}::uuid
         and membership_id = ${membershipId}::uuid`);
    return { newOptional: await newOptionalCount(tx, ctx) };
  });
}
