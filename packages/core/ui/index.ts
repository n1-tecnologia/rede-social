/**
 * `@tria/core/ui` — the client-safe entry of the kernel. Everything exported here may be imported
 * by `apps/web` (server and client components) and by module UI; nothing here may touch the
 * kernel's server or database code (enforced by the `packages/core/ui/**` Biome override).
 */
export { TenantLogo, type TenantLogoProps, type TenantLogoSize } from './TenantLogo';
