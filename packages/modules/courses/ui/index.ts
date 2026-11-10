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
export { LiveStatusChip, type LiveStatusChipProps } from './member/LiveStatusChip';
// 2026-10-26 — the academy reference's cards: a module, a lesson and a track.
export {
  MemberLessonCard,
  type MemberLessonCardProps,
  type MemberLessonCardState,
} from './member/MemberLessonCard';
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
export {
  MemberModuleCard,
  type MemberModuleCardProps,
  type MemberModuleCardState,
} from './member/MemberModuleCard';
export { MemberQuickCard, type MemberQuickCardProps } from './member/MemberQuickCard';
export { MemberTrackCard, type MemberTrackCardProps } from './member/MemberTrackCard';
export { ModuleCover, type ModuleCoverProps, type ModuleCoverState } from './member/ModuleCover';
export { ProgressBar, type ProgressBarProps } from './member/ProgressBar';
export { ProgressRing, type ProgressRingProps } from './member/ProgressRing';
export { StatBlock, type StatBlockProps } from './member/StatBlock';

/* ── 2026-10-22: the courses area redesign on the social-igoralves prototype (class recipes) ───── */

export {
  GLASS_CHIP,
  GLASS_CHIP_LG,
  MEDIA_CHIP,
  MEDIA_CHIP_LG,
  MEMBER_CARD,
  MEMBER_SECTION_TITLE,
  OVERLINE,
  OVERLINE_MEDIA,
  POSTER_FRAME,
  RAIL,
  SCRIM_CARD,
  SCRIM_EVENT,
  SCRIM_HERO,
  SCRIM_MODULE,
  SCRIM_POSTER,
  SCRIM_RESUME,
  SCRIM_TRACK,
  SCRIM_TRACK_CARD,
  SCRIM_TRACK_TILE,
  TRACK_LINE_SHADOW,
} from './member/recipes';

/* ── 2026-10-22: the admin's module band control (the curriculum editor's arrows over the art) ── */

export { MODULE_BAND_CONTROL } from './ModuleCard';
