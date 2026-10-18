/**
 * `@rede-social/module-dashboard/contracts` (08.7-01): the snapshot pipe's published contract. The
 * API serializes its answers with these schemas and the web parses them with the same ones, so
 * there is exactly one definition of every panel answer (MOD-01). Client-safe: zod only.
 */
export * from './activity';
export * from './members';
export * from './overview';
export * from './privacy-floor';
export * from './shared';
