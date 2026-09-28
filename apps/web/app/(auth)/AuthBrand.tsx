/**
 * The brand block of the public pages (Auth Pages Contract, D-26): the tenant's logo rendered exactly
 * as uploaded — a plain `<img>` with no tint, no recolouring, no CSS image effect of any kind — or,
 * without a logo, the display name as text (verbatim: never clamped, sliced or normalised; it wraps
 * inside the auth column). Platform and generic hosts pass the neutral "Rede Social" wordmark as
 * `displayName` with `logoUrl` null, so the same 24/700 text renders there.
 *
 * Stand-in for `TenantLogo size="auth"` (`@rede-social/core/ui`, 02-03) with the identical contract; the
 * swap is a one-line follow-up (keep `data-testid="auth-brand-name"` or update auth-pages.spec.ts).
 */
export function AuthBrand({
  logoUrl,
  displayName,
}: {
  logoUrl: string | null;
  displayName: string;
}) {
  if (logoUrl) {
    return (
      // biome-ignore lint/performance/noImgElement: D-26 — the customer's logo is served as-is (any format, any origin); next/image would re-encode and constrain it.
      <img
        src={logoUrl}
        alt={displayName}
        decoding="async"
        className="h-16 max-w-[220px] object-contain"
      />
    );
  }
  return (
    <p
      data-testid="auth-brand-name"
      className="max-w-full break-words text-center text-2xl font-bold tracking-[-0.02em] text-text"
    >
      {displayName}
    </p>
  );
}

/** Whether the host brand carries a logo (drives the login title size, E06 populated). */
export function hasLogo(brand: { branding: { logoUrl: string | null } }): boolean {
  return brand.branding.logoUrl !== null;
}
