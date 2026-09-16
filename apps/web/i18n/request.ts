import { getRequestConfig } from 'next-intl/server';
import { loadMessages } from './messages';

/**
 * Single pt-BR catalog, no locale routing (PWA-03). The catalog is assembled from
 * `messages/pt-BR/<namespace>.json` by `loadMessages()` (memoized per process).
 *
 * A missing key is never silent: outside production it throws (a failing render in dev and in tests);
 * in production it is logged and the dotted key (`namespace.key`) is rendered so the gap is visible on
 * the screen instead of an empty string.
 */
export default getRequestConfig(async () => ({
  locale: 'pt-BR',
  messages: loadMessages(),
  onError: (error) => {
    if (process.env.NODE_ENV !== 'production') throw error;
    console.error(error);
  },
  getMessageFallback: ({ namespace, key }) => [namespace, key].filter(Boolean).join('.'),
}));
