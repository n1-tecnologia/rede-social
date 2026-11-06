/**
 * The profile form module's published contract surface (`@rede-social/module-profile-form/contracts`). The
 * DTOs and bodies live in `@rede-social/contracts/profile-form` (the kernel services and the routes share
 * them); this file re-exports the builder API's part of them and adds the permission constant, the shape
 * every module contract has.
 */
export {
  type AdminBranch,
  type AdminQuestion,
  type AdminQuestionList,
  type AdminStep,
  type ArchivedQuestion,
  adminBranchSchema,
  adminQuestionListSchema,
  adminQuestionSchema,
  adminStepSchema,
  answerTokens,
  archivedQuestionListSchema,
  archivedQuestionSchema,
  type CreateBranchBody,
  type CreateQuestionBody,
  type CreateStepBody,
  createBranchBodySchema,
  createQuestionBodySchema,
  createStepBodySchema,
  type DeleteStepResult,
  deleteStepResultSchema,
  dependentSchema,
  hasDependentsDetailsSchema,
  type ImpactQuery,
  type ImpactResult,
  impactQuerySchema,
  impactResultSchema,
  isQuestionVisible,
  layoutBodySchema,
  type MemberBranch,
  memberBranchSchema,
  memberStepSchema,
  PROFILE_FORM_CONDITION_OPENER_TYPES,
  PROFILE_FORM_DEFAULT_STEP_TITLE,
  PROFILE_FORM_ISSUE_SET,
  type ProfileFormCondition,
  type ProfileFormConditionOpenerType,
  type ProfileFormIssue,
  type ProfileFormSummary,
  profileFormConditionSchema,
  profileFormSummarySchema,
  type ReorderBody,
  type ReplaceQuestionBody,
  reorderBodySchema,
  replaceQuestionBodySchema,
  type UndoBranchResult,
  type UpdateBranchBody,
  type UpdateQuestionBody,
  type UpdateStepBody,
  undoBranchResultSchema,
  updateBranchBodySchema,
  updateQuestionBodySchema,
  updateStepBodySchema,
  visibleSteps,
} from '@rede-social/contracts/profile-form';
// 12.2 (D-641, D-652): the pure branch rules, one source for the gate's TypeScript twin, the stepper and the builder.
export {
  type BranchTree,
  branchChainOf,
  branchTreeOf,
  isQuestionVisibleInTree,
  type ProfileFormBranchDef,
  type TreeOrderInput,
  type TreeOrderStep,
  treeOrder,
  visibleStepsInTree,
} from '@rede-social/contracts/profile-form-branches';

/** The permission STRINGS, exported so the manifest and the web tier never retype them (D-338). */
export const PROFILE_FORM_PERMISSIONS = {
  manage: 'profile_form.manage',
  read: 'profile_form.read',
} as const;
