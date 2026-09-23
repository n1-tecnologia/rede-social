/**
 * `@tria/module-communities/server` — everything the API tier may touch. The app imports THIS, never
 * a file path inside the package (the `exports` map has no `./server/*`, and Biome blocks deep
 * imports).
 */
export { communitiesRoutes } from './routes';
export {
  createCommunity,
  getCommunity,
  listCommunities,
  slugify,
  updateCommunity,
} from './service';
