/**
 * `@rede-social/module-feed/server` — everything the API tier may touch. The app imports THIS, never a file
 * path inside the package (the `exports` map has no `./server/*`, and Biome blocks deep imports).
 */
export { feedUnfurlJob } from './jobs';
export { feedRoutes } from './routes';
export {
  createComment,
  createPost,
  deleteComment,
  getPost,
  likeComment,
  likePost,
  listComments,
  listCommunityFeed,
  listFeed,
  listReplies,
  setPostLinkPreview,
  softDeletePost,
  unlikeComment,
  unlikePost,
  updatePost,
} from './service';
