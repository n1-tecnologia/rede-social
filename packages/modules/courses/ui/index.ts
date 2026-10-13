/**
 * This module's `./ui` export: the only surface `apps/web` may import from the courses UI (MOD-02).
 * Every component here is presentational and props-only — no catalog import, no route, no fetch;
 * every word arrives from the host (PWA-03, UI-D-406).
 */

export { CourseRow, type CourseRowPill, type CourseRowProps } from './CourseRow';
export type { ListRowPill } from './ListRow';
export { LiveRow, type LiveRowPill, type LiveRowProps } from './LiveRow';
export { RowSkeleton, type RowSkeletonProps } from './RowSkeleton';
export { TrackRow, type TrackRowPill, type TrackRowProps } from './TrackRow';
