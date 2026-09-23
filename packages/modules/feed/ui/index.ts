/** `@tria/module-feed/ui` — the only surface `apps/web` may import from this module. */
export {
  type AttachmentDescriptor,
  AttachmentRow,
  type AttachmentRowProps,
} from './AttachmentRow';
export {
  CommentInput,
  type CommentInputProps,
  type ReplyTarget,
} from './CommentInput';
export {
  type CommentAuthorView,
  CommentItem,
  type CommentItemLabels,
  type CommentItemProps,
  type CommentView,
} from './CommentItem';
export { CommentSheet, type CommentSheetProps } from './CommentSheet';
export {
  type CommentCreateOutcome,
  type CommentLikeOutcome,
  type CommentPageOutcome,
  CommentsList,
  type CommentsListLabels,
  type CommentsListProps,
  CommentsListSkeleton,
  type CommentViewer,
} from './CommentsList';
export {
  FeedCardSkeleton,
  type FeedCommentsProps,
  FeedList,
  type FeedListProps,
  FeedListSkeleton,
} from './FeedList';
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
export { linkify } from './linkify';
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
  type PostShareTarget,
} from './PostCard';
export { PostHeader, type PostHeaderProps } from './PostHeader';
export {
  PostMedia,
  type PostMediaImage,
  type PostMediaLabels,
  type PostMediaProps,
} from './PostMedia';
export {
  type SharePostPayload,
  type SharePostResult,
  type SharePostSurfaces,
  sharePost,
} from './sharePost';
