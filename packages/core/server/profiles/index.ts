/**
 * Kernel member-profile capability (PROF-01/PROF-02/PROF-03, CONTEXT D-16 — always on, no module
 * flag). A PURE TENANT-LANE area: `profiles/**` is deliberately absent from the privileged-lane
 * allow-list in `biome.json`, so every read and write here runs under RLS.
 *
 * Imported as `@tria/core/server/profiles/index` from outside the kernel (the `./server/*` export
 * maps to a file, not a directory).
 *
 * `./search` is the PURE half (query normalisation, `like` escaping, the opaque keyset cursor) and
 * `./service` the tenant-lane queries — including 03-03's `getMemberProfile` and `listMembers`.
 */

export * from './search';
export * from './service';
