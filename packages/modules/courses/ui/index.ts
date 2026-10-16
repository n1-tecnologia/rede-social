/**
 * This module's `./ui` export: the only surface `apps/web` may import from the courses UI (MOD-02).
 * Every component here is presentational and props-only — no catalog import, no route, no fetch;
 * every word arrives from the host (PWA-03, UI-D-406).
 */

export {
  type CategoryPickerItem,
  CategoryPickerSheet,
  type CategoryPickerSheetProps,
} from './CategoryPickerSheet';
export {
  type CoursePickerItem,
  type CoursePickerLabels,
  CoursePickerSheet,
  type CoursePickerSheetProps,
} from './CoursePickerSheet';
export { CourseRow, type CourseRowPill, type CourseRowProps } from './CourseRow';
export {
  type LessonPickerGroup,
  type LessonPickerLabels,
  type LessonPickerLesson,
  LessonPickerSheet,
  type LessonPickerSheetProps,
} from './LessonPickerSheet';
export { LessonRow, type LessonRowPill, type LessonRowProps, type LessonThumb } from './LessonRow';
export type { ListRowPill } from './ListRow';
export { LiveRow, type LiveRowPill, type LiveRowProps } from './LiveRow';
export { ModuleCard, type ModuleCardProps } from './ModuleCard';
export {
  PUBLISH_BLOCKED_MAX_LINKS,
  type PublishBlockedLink,
  PublishBlockedNotice,
  type PublishBlockedNoticeProps,
} from './PublishBlockedNotice';
export {
  type ReorderItem,
  ReorderList,
  type ReorderListLabels,
  type ReorderListProps,
} from './ReorderList';
export { RowSkeleton, type RowSkeletonProps } from './RowSkeleton';
export { TrackRow, type TrackRowPill, type TrackRowProps } from './TrackRow';

/* ── 08.5: the member side (ported from the prototype, props only, MOD-02) ─────────────────── */

export { CourseCard, type CourseCardProgress, type CourseCardProps } from './member/CourseCard';
export { LiveCard, type LiveCardProps } from './member/LiveCard';
export {
  MemberLessonRow,
  type MemberLessonRowProps,
  type MemberLessonTrailing,
} from './member/MemberLessonRow';
export {
  MemberLessonThumb,
  type MemberLessonThumbProps,
  type MemberLessonThumbState,
} from './member/MemberLessonThumb';
export { ModuleCover, type ModuleCoverProps, type ModuleCoverState } from './member/ModuleCover';
export { ProgressBar, type ProgressBarProps } from './member/ProgressBar';
export { ProgressRing, type ProgressRingProps } from './member/ProgressRing';
export { StatBlock, type StatBlockProps } from './member/StatBlock';
