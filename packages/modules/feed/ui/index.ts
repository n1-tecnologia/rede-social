/** `@tria/module-feed/ui` — the only surface `apps/web` may import from this module. */
export {
  type AttachmentDescriptor,
  AttachmentRow,
  type AttachmentRowProps,
} from './AttachmentRow';
export { FeedList, type FeedListProps } from './FeedList';
export {
  LikeButton,
  type LikeButtonProps,
  type LikeState,
  type LikeToggle,
  useOptimisticLike,
} from './LikeButton';
export {
  LinkPreviewCard,
  type LinkPreviewCardProps,
  type LinkPreviewView,
} from './LinkPreviewCard';
export { buildPostMeta, type CountTemplates, formatCountLabel, type PostMetaInput } from './meta';
export { PostActions, type PostActionsProps } from './PostActions';
export { PostCaption, type PostCaptionProps } from './PostCaption';
export {
  type LikeOutcome,
  PostCard,
  type PostCardLabels,
  type PostCardMediaView,
  type PostCardProps,
  type PostCardView,
} from './PostCard';
export { PostHeader, type PostHeaderProps } from './PostHeader';
export {
  PostMedia,
  type PostMediaImage,
  type PostMediaLabels,
  type PostMediaProps,
} from './PostMedia';
