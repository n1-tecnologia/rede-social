import { requestId } from 'hono/request-id';

/** Assigns `requestId` (honours an incoming `X-Request-Id`); every log line and error envelope carries it. */
export const requestIdMiddleware = () => requestId();
