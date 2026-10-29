/**
 * The profile form module's published contract surface (`@rede-social/module-profile-form/contracts`).
 * The DTOs and bodies arrive with the plans that need them (the kernel services and the routes share
 * them); this file starts with the permission constant, the shape every module contract has.
 */

/** The permission STRINGS, exported so the manifest and the web tier never retype them (D-338). */
export const PROFILE_FORM_PERMISSIONS = {
  manage: 'profile_form.manage',
  read: 'profile_form.read',
} as const;
