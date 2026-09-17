/**
 * `@tria/core/ui` — the client-safe entry of the kernel. Everything exported here may be imported
 * by `apps/web` (server and client components) and by module UI; nothing here may touch the
 * kernel's server or database code (enforced by the `packages/core/ui/**` Biome override).
 */
export { AppShell, type AppShellProps } from './AppShell';
export { BottomNav, type BottomNavProps } from './BottomNav';
export { BrandPreview, type BrandPreviewLabels, type BrandPreviewProps } from './BrandPreview';
export { DesktopRail, type DesktopRailProps } from './DesktopRail';
export { type HomeSlot, HomeSlots, type HomeSlotsProps } from './HomeSlots';
export {
  activeTabKey,
  buildNav,
  iconFor,
  isNavItemActive,
  type NavBadge,
  type NavItem,
  type NavLabels,
  type NavModule,
  type ShellNav,
} from './nav';
export { ScrollRoot, type ScrollRootProps } from './ScrollRoot';
export { TenantLogo, type TenantLogoProps, type TenantLogoSize } from './TenantLogo';
export { type Theme, ThemeToggle, type ThemeToggleProps } from './ThemeToggle';
export { TopBar, type TopBarProps } from './TopBar';
