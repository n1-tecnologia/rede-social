/**
 * Group totals below this read "menos de 5" with no value (D-462), so no small group is identified.
 * Moved here from `ui/metrics.ts` (08.7-01; `ui/metrics.ts` re-exports it) so the API and the web
 * share ONE constant. Its own file, free of zod, so the client-side `ui` entry pulls nothing else.
 */
export const PRIVACY_FLOOR = 5;
