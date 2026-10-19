/**
 * Quick 261018-owq: the e-mail allowlist refusal. The two Postgres auth hooks
 * (`public.hook_custom_access_token_allowlist` / `hook_before_user_created_allowlist`) answer
 * `{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}`, which GoTrue forwards to supabase-js as
 * an `AuthApiError` with `status 403` and this exact message. SQL cannot import this constant, so
 * pgTAP 175 pins the SQL literal and the integration suite compares this constant with GoTrue's real
 * error: the three stay in lockstep.
 */
export const ALLOWLIST_REJECTION_MESSAGE = 'EMAIL_NOT_ALLOWED' as const;
export const ALLOWLIST_REJECTION_STATUS = 403 as const;

/** True only for the hook's refusal: status 403 AND the exact sentinel message. */
export function isAllowlistRejection(
  error: { status?: number; message?: string } | null | undefined,
): boolean {
  return (
    !!error &&
    error.status === ALLOWLIST_REJECTION_STATUS &&
    error.message === ALLOWLIST_REJECTION_MESSAGE
  );
}
