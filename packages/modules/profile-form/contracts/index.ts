/**
 * The profile form module's published contract surface (`@rede-social/module-profile-form/contracts`). The
 * DTOs and bodies live in `@rede-social/contracts/profile-form` (the kernel services and the routes share
 * them); this file re-exports the builder API's part of them and adds the permission constant, the shape
 * every module contract has.
 */
export {
  type AdminQuestion,
  type AdminQuestionList,
  adminQuestionListSchema,
  adminQuestionSchema,
  type CreateQuestionBody,
  createQuestionBodySchema,
  PROFILE_FORM_ISSUE_SET,
  type ProfileFormIssue,
  type ReorderBody,
  reorderBodySchema,
  type UpdateQuestionBody,
  updateQuestionBodySchema,
} from '@rede-social/contracts/profile-form';

/** The permission STRINGS, exported so the manifest and the web tier never retype them (D-338). */
export const PROFILE_FORM_PERMISSIONS = {
  manage: 'profile_form.manage',
  read: 'profile_form.read',
} as const;
