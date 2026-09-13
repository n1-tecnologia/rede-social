/** Bumped when a published contract changes shape in a way consumers must react to. */
export const CONTRACTS_VERSION = 1;

export * from './auth';
export * from './bootstrap';
export * from './errors';
export * from './events';
export * from './hosts';
// SERVER-ONLY (`node:fs`): never import `@tria/contracts` from a client component that would pull this in.
export * from './legal';
export * from './modules';
export * from './platform';
