import type { ProjectHandle } from './project-pools';
import type { Tx } from './tenant-tx';

/**
 * The project of an open transaction (09.2-03, D-538). The routing seam passes the project EXPLICITLY, as
 * data attached to an explicit value: every lane registers the transaction it opens here, so plan 09's
 * `enqueueInTx` can find the database a job must land in from the `Tx` it was handed, without any ambient
 * context. A WeakMap, so a finished transaction is collected with its entry.
 *
 * There is deliberately no async-context store anywhere in this codebase for this purpose: an implicit
 * "current project" is exactly how a request ends up served from another tenant's database.
 */
export const projectOfTx = new WeakMap<Tx, ProjectHandle>();
