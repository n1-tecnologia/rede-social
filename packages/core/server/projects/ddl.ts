import postgres, { type Sql } from 'postgres';
import { open } from '../secrets/sealed';
import type { ProjectRecord } from '../tenancy/project-registry';

/**
 * The DDL connection of a project (09.2-15, 09.2-23): ONE place that knows how the operator commands reach a
 * project's database as `postgres` (the migration fan-out, the move tool, the central-clean check).
 *
 *  - the CENTRAL project (`is_central` or `credential_source = 'env'`) is `MIGRATION_DATABASE_URL`; outside
 *    production the local stack's URL stands in; in production no URL is a refusal, never a guess;
 *  - any other project is its sealed `ddl_url` (AAD `<projectId>:ddl_url`).
 *
 * A failure carries a fixed code (`credential_missing`, `credential_unreadable`); a connection string, a
 * password or a driver message is never part of an error (PR-4).
 */

export class DdlError extends Error {
  readonly code: 'credential_missing' | 'credential_unreadable';
  constructor(code: 'credential_missing' | 'credential_unreadable') {
    super(code);
    this.name = 'DdlError';
    this.code = code;
  }
}

const LOCAL_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres';

/** The central URL: `MIGRATION_DATABASE_URL`, the local stack outside production, nothing in production. */
export function centralDdlUrl(): string {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (url && url.length > 0) return url;
  if (process.env.NODE_ENV === 'production') throw new DdlError('credential_missing');
  return LOCAL_URL;
}

const connectOptions = { max: 1, prepare: false, connect_timeout: 15, onnotice: () => undefined };

export type DdlProject = Pick<
  ProjectRecord,
  'id' | 'isCentral' | 'credentialSource' | 'ddlUrlSealed'
>;

/**
 * One connection (`max: 1`) to `project` as `postgres`. With `readOnly` the connection runs
 * `set default_transaction_read_only = on` before anything else (the statement queues first on the single
 * connection), so a statement of the caller that would write fails. The SOURCE side of a move is always opened
 * read only; only `--confirm-delete` opens a writable client on it (PR-6). The caller closes the client.
 */
export function openDdlSql(project: DdlProject, options: { readOnly?: boolean } = {}): Sql {
  let url: string;
  if (project.isCentral || project.credentialSource === 'env') {
    url = centralDdlUrl();
  } else {
    if (!project.ddlUrlSealed) throw new DdlError('credential_missing');
    try {
      url = open(project.ddlUrlSealed, `${project.id}:ddl_url`);
    } catch {
      throw new DdlError('credential_unreadable');
    }
  }
  const client = postgres(url, connectOptions);
  if (options.readOnly) {
    client.unsafe('set default_transaction_read_only = on').then(
      () => undefined,
      () => undefined,
    );
  }
  return client;
}
