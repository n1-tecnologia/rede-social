/**
 * `@rede-social/module-courses/server` — everything the API tier may touch. The app imports THIS,
 * never a file path inside the package (the `exports` map has no `./server/*`).
 */

// 08.6-05: the live reminder's fire-time body, with an injected clock (the integration suite's
// `runLiveReminderJobs` plays the worker through it).
export { runLiveReminder } from './reminders';
export { coursesRoutes } from './routes';
export { createCourse, createLesson, createModule, getCourse, setCourseStatus } from './service';
