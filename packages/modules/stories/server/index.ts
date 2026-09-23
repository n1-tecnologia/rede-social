/**
 * `@tria/module-stories/server` — everything the API tier may touch. The app imports THIS, never a
 * file path inside the package (the `exports` map has no `./server/*`, and Biome blocks deep
 * imports).
 */
export { storiesRoutes } from './routes';
export {
  deleteStory,
  getStory,
  listActiveStories,
  listOwnStories,
  publishStory,
} from './service';
