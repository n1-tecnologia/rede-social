import type { ProfileFormIssue } from '@rede-social/contracts/profile-form';

/**
 * The pure layout of the profile form (Phase 12.1, D-623, D-627): ONE sequence of question ids cut into
 * steps. This first cut carries the types and `flatten`; the operations arrive with the layout task.
 */

export type LayoutStep = { stepId: string; questionIds: readonly string[] };
export type Layout = readonly LayoutStep[];
export type LayoutResult = { ok: true; layout: Layout } | { ok: false; issue: ProfileFormIssue };

/** The question ids of every step in order; an empty step contributes nothing. */
export function flatten(layout: Layout): string[] {
  return layout.flatMap((step) => step.questionIds);
}
