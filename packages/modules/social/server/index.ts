/**
 * `@rede-social/module-social/server` - everything the API tier may touch. The app imports THIS,
 * never a file path inside the package (the `exports` map has no `./server/*`).
 */
export { socialRoutes } from './routes';
export {
  followMember,
  followState,
  getMemberSocial,
  listFollowers,
  listFollowing,
  unfollowMember,
} from './service';
