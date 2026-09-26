/**
 * `@tria/module-reels/ui` — the only surface `apps/web` may import from this module.
 *
 * Props-only: every string arrives as a prop (PWA-03), the media arrives as a render function the
 * host builds (the app tier binds the playback-token server action), and nothing here imports
 * another `@tria/module-*` package (MOD-02, `turbo boundaries`).
 */

export { ReelPlaybackError, type ReelPlaybackErrorProps } from './ReelPlaybackError';
export {
  ReelsPager,
  type ReelsPagerItem,
  type ReelsPagerLabels,
  type ReelsPagerProps,
} from './ReelsPager';
export { ReelsStage, type ReelsStageProps } from './ReelsStage';
export { type ReelsTick, ticksWindow } from './ticks';
