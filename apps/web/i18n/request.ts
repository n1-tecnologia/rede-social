import { getRequestConfig } from 'next-intl/server';

// Single pt-BR catalog, no locale routing (PWA-03 lands in Phase 2; strings are centralised now).
export default getRequestConfig(async () => ({
  locale: 'pt-BR',
  messages: (await import('../messages/pt-BR.json')).default,
}));
