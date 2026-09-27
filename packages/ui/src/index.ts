/**
 * @tria/ui — shared primitives ported from the design prototype (UI-01).
 *
 * Client-safe barrel: no server code, no import of the contracts package (its root pulls node:fs). Components take
 * every string and aria label as props and every colour from the token file, so nothing here can leak
 * a tenant's brand or language into another context.
 */
export { cn } from './cn';
// Hooks
export { useDebounce } from './hooks/useDebounce';
// The modal focus contract `BottomSheet` and `ConfirmDialog` already share. Exported for the story
// viewer (05-06), which is a third modal and must trap focus the SAME way rather than grow a
// second, subtly different implementation of Tab-cycling and Escape.
export { useFocusTrap } from './hooks/useFocusTrap';
export {
  type UseInfiniteScrollOptions,
  type UseInfiniteScrollResult,
  useInfiniteScroll,
} from './hooks/useInfiniteScroll';
export { useMediaQuery } from './hooks/useMediaQuery';
export { type UsePullToRefreshOptions, usePullToRefresh } from './hooks/usePullToRefresh';
// Layout
export { InfiniteScroll, type InfiniteScrollProps } from './layout/InfiniteScroll';
export { PullToRefresh, type PullToRefreshProps } from './layout/PullToRefresh';
export { SafeAreaWrapper, type SafeAreaWrapperProps } from './layout/SafeAreaWrapper';
export {
  ScrollContainerContext,
  ScrollContainerProvider,
  useScrollContainer,
} from './layout/ScrollContainerContext';
// Overlays
export { BottomSheet, type BottomSheetProps } from './overlays/BottomSheet';
export { ConfirmDialog, type ConfirmDialogProps } from './overlays/ConfirmDialog';
export { DoubleTapHeart, type DoubleTapHeartProps } from './overlays/DoubleTapHeart';
export {
  Toast,
  type ToastOptions,
  type ToastProps,
  ToastProvider,
  type ToastTone,
  useToast,
} from './overlays/Toast';
// Primitives
export { Avatar, type AvatarProps, type AvatarSize } from './primitives/Avatar';
export { Badge, type BadgeProps } from './primitives/Badge';
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './primitives/Button';
export { Card, type CardProps } from './primitives/Card';
export { Chip, type ChipProps, chipBase } from './primitives/Chip';
export { EmptyState, type EmptyStateProps } from './primitives/EmptyState';
export {
  FileDropZone,
  type FileDropZoneProps,
  type FileDropZoneState,
} from './primitives/FileDropZone';
export { IconButton, type IconButtonProps } from './primitives/IconButton';
export { Input, type InputProps } from './primitives/Input';
export { PageHeader, type PageHeaderProps } from './primitives/PageHeader';
export { SearchBar, type SearchBarProps } from './primitives/SearchBar';
export { SectionTitle, type SectionTitleProps } from './primitives/SectionTitle';
export { Skeleton, type SkeletonProps } from './primitives/Skeleton';
export { StatusPill, type StatusPillProps, type StatusTone } from './primitives/StatusPill';
export { Switch, type SwitchProps } from './primitives/Switch';
export {
  type TabItem,
  TabPanel,
  type TabPanelProps,
  Tabs,
  type TabsProps,
} from './primitives/Tabs';
export { Textarea, type TextareaProps } from './primitives/Textarea';
