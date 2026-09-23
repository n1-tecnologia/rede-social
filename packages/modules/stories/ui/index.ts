/** `@tria/module-stories/ui` — the only surface `apps/web` may import from this module. */

export {
  StoriesStrip,
  type StoriesStripProps,
  type StoryCircleItem,
  type StoryStripOwnCircle,
} from './StoriesStrip';
export {
  StoryCircle,
  type StoryCircleProps,
  type StoryCircleVariant,
} from './StoryCircle';
export {
  StoryProgressBars,
  type StoryProgressBarsProps,
} from './StoryProgressBars';
export {
  type StoryMediaControls,
  StoryViewer,
  type StoryViewerItem,
  type StoryViewerLabels,
  type StoryViewerProps,
} from './StoryViewer';
export {
  type StoryClock,
  useStoryClock,
  type UseStoryClockOptions,
} from './useStoryClock';
