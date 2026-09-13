/**
 * `@tria/module-example/server` — everything the API tier may touch. The app imports THIS, never a
 * file path inside the package (the `exports` map has no `./src/*`, and Biome blocks deep imports).
 */
export { exampleProcessJob } from './jobs';
export { exampleRoutes } from './routes';
export { createItem, getItem, listItems, markProcessed } from './service';
