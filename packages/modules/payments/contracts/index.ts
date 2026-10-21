/**
 * The payments module's published contract surface (`@rede-social/module-payments/contracts`). The
 * DTOs and bodies live in `@rede-social/contracts/payments` (the kernel services and the routes share
 * them, planning decision 2); this file re-exports the admin API's part of them and adds the
 * permission constant, the shape every module contract has.
 */
export {
  ACCESS_ITEM_STATES,
  ACCESS_MAX_PAGE_SIZE,
  ACCESS_PAGE_SIZE,
  type AccessEmailBody,
  type AccessItem,
  type AccessItemState,
  type AccessListQuery,
  type AccessPage,
  type AccessProduct,
  type AccessProductBody,
  type AccessProductPatch,
  type AccessResult,
  accessEmailBodySchema,
  accessItemSchema,
  accessListQuerySchema,
  accessPageSchema,
  accessProductBodySchema,
  accessProductPatchSchema,
  accessProductSchema,
  accessResultSchema,
  type GateBody,
  type GatePreview,
  type GateResult,
  gateBodySchema,
  gatePreviewSchema,
  gateResultSchema,
  isCheckoutLink,
  PAYMENTS_ISSUE_SET,
  PAYMENTS_ISSUES,
  PAYMENTS_MAX_EMAIL,
  PAYMENTS_MAX_LINK,
  PAYMENTS_MAX_NAME,
  PAYMENTS_MAX_PRODUCT_ID,
  PAYMENTS_MAX_TOKEN,
  type PaymentsIntegration,
  type PaymentsIssue,
  type PaymentsOverview,
  paymentsIntegrationSchema,
  paymentsOverviewSchema,
  type RemoveAccessProductResult,
  removeAccessProductResultSchema,
  type SaveIntegrationBody,
  type SaveIntegrationResult,
  type StoreMapping,
  type StoreMappingBody,
  type StoreMappingResponse,
  saveIntegrationBodySchema,
  saveIntegrationResultSchema,
  storeMappingBodySchema,
  storeMappingResponseSchema,
  storeMappingSchema,
} from '@rede-social/contracts/payments';

/** The permission STRINGS, exported so the manifest and the web tier never retype them (D-338). */
export const PAYMENTS_PERMISSIONS = {
  manage: 'payments.manage',
} as const;
