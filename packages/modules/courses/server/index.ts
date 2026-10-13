/**
 * `@rede-social/module-courses/server` — everything the API tier may touch. The app imports THIS,
 * never a file path inside the package (the `exports` map has no `./server/*`).
 */
export { coursesRoutes } from './routes';
export { createCourse, createLesson, createModule, getCourse, setCourseStatus } from './service';
