/**
 * `@tria/module-reels/ui` — the only surface `apps/web` may import from this module.
 *
 * Props-only: every string arrives as a prop (PWA-03), the media arrives as a render function the
 * host builds (the app tier binds the playback-token server action), and nothing here imports
 * another `@tria/module-*` package (MOD-02, `turbo boundaries`).
 */

export { compactCount } from './format';
export { ReelCaption, type ReelCaptionProps } from './ReelCaption';
export { ReelPlaybackError, type ReelPlaybackErrorProps } from './ReelPlaybackError';
export { ReelRail, type ReelRailProps } from './ReelRail';
export { type ReelsLane, ReelsLanes, type ReelsLanesProps } from './ReelsLanes';
export {
  ReelsPager,
  type ReelsPagerItem,
  type ReelsPagerLabels,
  type ReelsPagerProps,
} from './ReelsPager';
export { ReelsStage, type ReelsStageProps } from './ReelsStage';
export { type ReelsTick, ticksWindow } from './ticks';
