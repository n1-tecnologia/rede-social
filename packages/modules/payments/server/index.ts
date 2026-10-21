/**
 * `@rede-social/module-payments/server` — everything the API tier may touch. The app imports THIS, never
 * a file path inside the package (the `exports` map has no `./server/*`). The services live in the
 * kernel (`@rede-social/core/server/payments/*`); the routes are thin wrappers over them.
 */

export { PAYMENTS_PUSH_BODY_MAX, paymentsPushCopy } from './notification-copy';
export { paymentsNotificationSources } from './notifications';
export { paymentsRoutes } from './routes';
