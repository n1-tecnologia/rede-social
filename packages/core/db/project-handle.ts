import type { ProjectHandle } from './project-pools';
import type { Tx } from './tenant-tx';

/** Which lane opened a transaction. `tenant` is `withTenantTx`, `admin` is `withAdminTx`, `platform` is `withPlatformTx`. */
export type TxLane = 'tenant' | 'admin' | 'platform';

/** What a lane records about the transaction it opened: the project it runs on and the lane that opened it. */
export type TxContext = { handle: ProjectHandle; lane: TxLane };

/**
 * The project and the lane of an open transaction (09.2-03, 09.2-09, D-538). The routing seam passes the
 * project EXPLICITLY, as data attached to an explicit value: every lane registers the transaction it opens
 * here, so `enqueueInTx` finds the database a job must land in, and the kind of queue that lane may write to,
 * from the `Tx` it was handed, without any ambient context. A WeakMap, so a finished transaction is collected
 * with its entry.
 *
 * There is deliberately no async-context store anywhere in this codebase for this purpose: an implicit
 * "current project" is exactly how a request ends up served from another tenant's database.
 */
export const projectOfTx = new WeakMap<Tx, TxContext>();

/** The context a lane registered for `tx`, `undefined` for a transaction no lane opened. */
export const txContextOf = (tx: Tx): TxContext | undefined => projectOfTx.get(tx);
