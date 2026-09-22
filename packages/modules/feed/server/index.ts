/**
 * `@tria/module-feed/server` — everything the API tier may touch. The app imports THIS, never a file
 * path inside the package (the `exports` map has no `./server/*`, and Biome blocks deep imports).
 */
export { feedRoutes } from './routes';
export { createPost, getPost, listFeed } from './service';
