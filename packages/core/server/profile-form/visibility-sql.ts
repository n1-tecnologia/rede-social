import { PROFILE_FORM_LIMITS } from '@rede-social/contracts/profile-form';

/**
 * The ONE SQL fragment of chain visibility (Phase 12.2, D-644; PFORM-45; T-12.2-11). Whether a member SEES a
 * question is "every branch on its chain is open for this member", and 12.1 restated the single-level gate in
 * TypeScript four times (the summary, the impact, the new-optional notice, the gate). With a chain of three
 * that would be copied four times, so the summary, the impact and the new-optional queries of plans 10 and 11
 * call these builders instead.
 *
 * The builders return the TEXT of a boolean expression. The caller wraps it with `sql.raw(...)` inside its own
 * statement and gives it caller-controlled IDENTIFIERS only: a table alias or a column (`q.branch_id`,
 * `q.tenant_id`, `m.id`). A bound value cannot travel in raw text; a caller that holds the tenant or the member
 * as a parameter exposes it as a column of a CTE or a `values` alias and passes that column. Every identifier is
 * validated against `^[a-z_][a-z0-9_.]*$`, so a quote, a space, a semicolon, a cast or a placeholder throws
 * instead of reaching the database (T-12.2-11).
 *
 * The expression is the unrolled chain of the SQL gate of plan 06, with exactly `PROFILE_FORM_LIMITS.branchDepth`
 * levels (the database trigger PF008 forbids a deeper chain, so the last level is the deepest there can be):
 * one correlated `exists` over `public.profile_form_branches` left-joined to the opener question and to the
 * next branch up, ANDed with one `exists` per level over the member's own answer to that level's opener,
 * `open_values && app.profile_form_answer_tokens(answer.value)`. A level that is not on the chain (`pfb2.id is
 * null`) counts as open. A dangling branch id has no `pfb1` row and the whole expression is false: the question
 * is not visible, the safe direction. NO recursion and NO predicate on a branch's or a question's
 * `archived_at`: an archived block keeps its answers, and a question archived on its own is excluded by the
 * caller's own `archived_at is null`, never here (Pitfall 3). The aliases of the fragment start with `pf`, so
 * they do not collide with the caller's.
 */

/** The number of branch levels the fragment unrolls; it MUST equal the limit (a unit test pins it). */
export const VISIBILITY_SQL_DEPTH = PROFILE_FORM_LIMITS.branchDepth;

const IDENTIFIER = /^[a-z_][a-z0-9_.]*$/;

function identifier(value: string, name: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`visibility-sql: ${name} is not a plain identifier`);
  return value;
}

/** `exists` of the member's answer to the opener of level `level` overlapping its opening values. */
function openAt(level: number, tenant: string, member: string): string {
  return `exists (
      select 1
      from public.profile_form_answers pfa${level}
      where pfa${level}.tenant_id = ${tenant}
        and pfa${level}.membership_id = ${member}
        and pfa${level}.question_id = pfb${level}.opener_question_id
        and pfb${level}.open_values && app.profile_form_answer_tokens(pfa${level}.value)
    )`;
}

/**
 * "Every branch on the chain of `branchRef` is open for `member`", as one boolean expression. `branchRef` is
 * the column that holds the branch id (`q.branch_id`), `tenant` the column that holds the tenant id and
 * `member` the one that holds the membership id.
 */
export function branchChainOpenSql(input: {
  branchRef: string;
  tenant: string;
  member: string;
}): string {
  const branchRef = identifier(input.branchRef, 'branchRef');
  const tenant = identifier(input.tenant, 'tenant');
  const member = identifier(input.member, 'member');

  const levels = Array.from({ length: VISIBILITY_SQL_DEPTH }, (_, index) => index + 1);
  const joins = levels.flatMap((level) => {
    const climb =
      level === 1
        ? []
        : [
            `left join public.profile_form_branches pfb${level} on pfb${level}.tenant_id = pfo${level - 1}.tenant_id and pfb${level}.id = pfo${level - 1}.branch_id`,
          ];
    const opener =
      level === VISIBILITY_SQL_DEPTH
        ? []
        : [
            `left join public.profile_form_questions pfo${level} on pfo${level}.tenant_id = pfb${level}.tenant_id and pfo${level}.id = pfb${level}.opener_question_id`,
          ];
    return [...climb, ...opener];
  });
  const open = levels.map((level) =>
    level === 1
      ? openAt(level, tenant, member)
      : `(pfb${level}.id is null or ${openAt(level, tenant, member)})`,
  );

  return `exists (
    select 1
    from public.profile_form_branches pfb1
    ${joins.join('\n    ')}
    where pfb1.tenant_id = ${tenant}
      and pfb1.id = ${branchRef}
      and ${open.join('\n      and ')}
  )`;
}

/**
 * "The member sees this question": a question with no branch is always visible, one in a branch only when the
 * whole chain is open. `question` is the alias of the row that holds `branch_id`.
 */
export function questionVisibleSql(input: {
  question: string;
  tenant: string;
  member: string;
}): string {
  const question = identifier(input.question, 'question');
  return `(${question}.branch_id is null or ${branchChainOpenSql({
    branchRef: `${question}.branch_id`,
    tenant: input.tenant,
    member: input.member,
  })})`;
}
