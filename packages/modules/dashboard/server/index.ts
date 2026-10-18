/**
 * `@rede-social/module-dashboard/server` (08.7-01) — everything the API tier may touch. The app imports
 * THIS, never a file path inside the package (the `exports` map has no `./server/*`).
 */
export { getMemberActivity } from './activity';
export { getOwnerMembers, readMembersPayload } from './members';
export { getOwnerOverview } from './overview';
export {
  dashboardRoutes,
  memberActivityRoute,
  ownerMembersRoute,
  ownerOverviewRoute,
} from './routes';
export { readLatestSnapshot, type SnapshotRow, snapshotMetaOf } from './snapshot';
export { runSnapshotBuild, type SnapshotBuildOutcome, snapshotBuildJob } from './snapshot-job';
export { dashboardSystemCtx } from './system-context';
