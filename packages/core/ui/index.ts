/**
 * `@rede-social/core/ui` — the client-safe entry of the kernel. Everything exported here may be imported
 * by `apps/web` (server and client components) and by module UI; nothing here may touch the
 * kernel's server or database code (enforced by the `packages/core/ui/**` Biome override).
 */
export { AppShell, type AppShellProps } from './AppShell';
export {
  BEFORE_LOGOUT_TIMEOUT_MS,
  type BeforeLogout,
  BeforeLogoutProvider,
  runBeforeLogout,
  useBeforeLogout,
  useLogoutSubmit,
} from './BeforeLogout';
export { BottomNav, type BottomNavProps } from './BottomNav';
export { BrandPreview, type BrandPreviewLabels, type BrandPreviewProps } from './BrandPreview';
export {
  BUTTON_COLOR_KEYS,
  BUTTON_STYLES,
  type ButtonPair,
  type ButtonPairs,
  type ButtonStyle,
  type ButtonTheme,
  buttonGradient,
  buttonGradientHover,
  buttonHover,
  buttonInk,
  buttonRampEnd,
  buttonThemeVars,
} from './button-colors';
export { DesktopRail, type DesktopRailProps } from './DesktopRail';
export { type HomeSlot, HomeSlots, type HomeSlotsProps } from './HomeSlots';
export { MediaImage, type MediaImageProps } from './MediaImage';
export {
  activeTabChrome,
  activeTabKey,
  buildNav,
  iconFor,
  isNavItemActive,
  type NavBadge,
  type NavItem,
  type NavLabels,
  type NavModule,
  type ShellNav,
  withCollapsingTabs,
  withTabDots,
} from './nav';
export { appBadgeCount, applyAppBadge, type BadgeCounters } from './realtime/app-badge';
export {
  conversationsBadgeOf,
  type LiveCounters,
  LiveCountersProvider,
  type LiveCountersProviderProps,
  useLiveCounters,
} from './realtime/LiveCountersProvider';
export {
  type BroadcastMessage,
  HIDDEN_DISCONNECT_MS,
  type RealtimeApi,
  type RealtimeChannelLike,
  type RealtimeClientFactory,
  type RealtimeClientLike,
  type RealtimeClientOptionsLike,
  RealtimeProvider,
  type RealtimeProviderProps,
  type SignalHandler,
  useRealtime,
} from './realtime/RealtimeProvider';
export {
  type SlotBadgeLabel,
  SlotBadgeLabelsProvider,
  type SlotBadgeLabelsProviderProps,
  slotAccessibleName,
  slotBadgeStyle,
  useSlotBadgeLabel,
} from './realtime/SlotBadgeLabels';
export {
  createTokenSource,
  REFRESH_MARGIN_MS,
  type RealtimeToken,
  tokenFetcher,
} from './realtime/token-source';
export { type UseRealtimeTopicOptions, useRealtimeTopic } from './realtime/useRealtimeTopic';
export { ScrollRoot, type ScrollRootProps } from './ScrollRoot';
export { TenantLogo, type TenantLogoProps, type TenantLogoSize } from './TenantLogo';
export { type Theme, ThemeToggle, type ThemeToggleProps } from './ThemeToggle';
export { TopBar, type TopBarProps } from './TopBar';
