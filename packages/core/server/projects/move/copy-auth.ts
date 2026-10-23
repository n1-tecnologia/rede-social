import { accountIdsOf } from './plan';
import {
  type AuthCopyReport,
  type Db,
  idsParam,
  MoveError,
  type MoveSide,
  quoteIdent,
  run,
} from './types';

/**
 * The Auth copy (09.2-22, D-534 step 4, D-533, PR-7, T-09.2-97).
 *
 * The accounts to copy are the people of the tenant: the distinct `user_id` of its memberships (any status)
 * plus the invitees that already hold an account. `auth.users` and `auth.identities` are copied over the
 * `postgres` connection with SQL because the Admin API documents no password-hash import and no custom id
 * (RESEARCH Q11; hosted behaviour of `postgres` on `auth.*` is assumption A10, hosted proof H6). The column
 * set is the INTERSECTION of what both sides have (GoTrue versions differ), generated columns excluded
 * (`confirmed_at`, `email` of identities). The id, the bcrypt hash, the confirmation, the metadata, the
 * creation time and the instance id travel unchanged.
 *
 *  - One account per tenant, independent after the move (D-533): the source keeps its row for the tenants
 *    still there; the target holds its own copy. Nothing links the two afterwards.
 *  - No identity merge (PR-7): a target that already holds the same e-mail under a DIFFERENT id aborts the
 *    copy with `email_conflict` BEFORE any row is written. The error carries a count, never an address.
 *  - Sessions and refresh tokens are not copied; members sign in again (D-535).
 *  - The `on_auth_user_created` trigger fills `public.users` in the target; the source `public.users` rows
 *    (`name`, `created_at`) are then upserted so they match exactly.
 *
 * Nothing here logs or returns a value: the report is counts only.
 */

/** Thrown before any write when an account of this tenant would collide with a different person's. */
export class EmailConflictError extends MoveError {
  constructor(count: number) {
    super('email_conflict', [], { conflicts: count });
    this.name = 'EmailConflictError';
  }
}

const BATCH = 500;

/** Non-generated columns of `schema.table` (live, not dropped), by name. */
async function liveColumns(db: Db, qualified: string): Promise<string[]> {
  const rows = await run<{ name: string }>(
    db,
    `select a.attname as name from pg_attribute a
      where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
      order by a.attnum`,
    [qualified],
  );
  return rows.map((row) => row.name);
}

const intersect = (a: string[], b: string[]): string[] => {
  const right = new Set(b);
  return a.filter((name) => right.has(name));
};

/** Reads `to_jsonb(row)::text` documents of `select` in batches of `BATCH`, joined as JSON arrays. */
async function* documents(
  db: Db,
  query: string,
  params: readonly unknown[],
): AsyncGenerator<{ json: string; rows: number }> {
  const cursor = db.unsafe(query, params as never[]).cursor(BATCH);
  for await (const rows of cursor) {
    const list = (rows as unknown as { j: string }[]).map((row) => row.j);
    if (list.length > 0) yield { json: `[${list.join(',')}]`, rows: list.length };
  }
}

async function writeBatches(
  source: Db,
  target: Db,
  selectQuery: string,
  params: readonly unknown[],
  insertSql: (jsonParam: string) => string,
): Promise<number> {
  let written = 0;
  for await (const batch of documents(source, selectQuery, params)) {
    const result = await target.unsafe(insertSql('$1::text::jsonb'), [batch.json] as never[]);
    written += result.count;
  }
  return written;
}

/**
 * Copies the accounts of `source.tenantId` into `target`. `userIds` defaults to `accountIdsOf` (memberships
 * of any status plus invitees); tests pass an explicit list to exercise the conflict path.
 */
export async function copyAuth(
  source: MoveSide,
  target: MoveSide,
  userIds?: readonly string[],
): Promise<AuthCopyReport> {
  const ids = [
    ...(userIds ??
      (await source.sql.begin('read only', (tx) => accountIdsOf(tx, source.tenantId)))),
  ];
  if (ids.length === 0) return { accounts: 0, usersWritten: 0, identitiesWritten: 0 };
  const idList = idsParam(ids);
  const inIds = (column: string) =>
    `${column} in (select value::uuid from jsonb_array_elements_text($1::text::jsonb))`;

  return source.sql.begin('isolation level repeatable read read only', async (src) => {
    const [userCols, identityCols, publicUserCols] = await Promise.all([
      Promise.all([liveColumns(src, 'auth.users'), liveColumns(target.sql, 'auth.users')]),
      Promise.all([
        liveColumns(src, 'auth.identities'),
        liveColumns(target.sql, 'auth.identities'),
      ]),
      liveColumns(src, 'public.users'),
    ]);
    const usersColumns = intersect(userCols[0], userCols[1]);
    const identitiesColumns = intersect(identityCols[0], identityCols[1]);
    for (const required of ['id', 'email', 'encrypted_password']) {
      if (!usersColumns.includes(required)) throw new MoveError('schema_mismatch', ['auth.users']);
    }

    // 1. Conflicts first: nothing of this tenant is written when one exists.
    const emails = await run<{ email: string }>(
      src,
      `select lower(email) as email from auth.users where ${inIds('id')} and email is not null`,
      [idList],
    );
    const [conflict] = await run<{ n: number }>(
      target.sql,
      `select count(*)::int as n from auth.users
        where lower(email) in (select value from jsonb_array_elements_text($1::text::jsonb))
          and id not in (select value::uuid from jsonb_array_elements_text($2::text::jsonb))`,
      [idsParam(emails.map((row) => row.email)), idList],
    );
    let conflicts = conflict?.n ?? 0;
    if (identitiesColumns.includes('provider_id') && identitiesColumns.includes('provider')) {
      const keys = await run<{ j: string }>(
        src,
        `select jsonb_build_object('provider', provider, 'provider_id', provider_id)::text as j
           from auth.identities where ${inIds('user_id')}`,
        [idList],
      );
      const [identityConflict] = await run<{ n: number }>(
        target.sql,
        `select count(*)::int as n from auth.identities i
          where (i.provider, i.provider_id) in (
                  select x.provider, x.provider_id
                    from jsonb_to_recordset($1::text::jsonb) as x(provider text, provider_id text))
            and i.user_id not in (select value::uuid from jsonb_array_elements_text($2::text::jsonb))`,
        [`[${keys.map((row) => row.j).join(',')}]`, idList],
      );
      conflicts += identityConflict?.n ?? 0;
    }
    if (conflicts > 0) throw new EmailConflictError(conflicts);

    // 2. One target transaction: users, identities, then the `public.users` mirror rows made exact.
    return target.sql.begin(async (tgt) => {
      const usersWritten = await writeBatches(
        src,
        tgt,
        `select to_jsonb(u)::text as j from auth.users u where ${inIds('u.id')} order by u.id`,
        [idList],
        (param) => `insert into auth.users (${usersColumns.map(quoteIdent).join(', ')})
                    select ${usersColumns.map(quoteIdent).join(', ')}
                      from jsonb_populate_recordset(null::auth.users, ${param})
                    on conflict (id) do nothing`,
      );
      const identitiesWritten = await writeBatches(
        src,
        tgt,
        `select to_jsonb(i)::text as j from auth.identities i where ${inIds('i.user_id')} order by i.id`,
        [idList],
        (param) => `insert into auth.identities (${identitiesColumns.map(quoteIdent).join(', ')})
                    select ${identitiesColumns.map(quoteIdent).join(', ')}
                      from jsonb_populate_recordset(null::auth.identities, ${param})
                    on conflict do nothing`,
      );
      const mirrored = publicUserCols.filter((name) => name !== 'id');
      await writeBatches(
        src,
        tgt,
        `select to_jsonb(p)::text as j from public.users p where ${inIds('p.id')} order by p.id`,
        [idList],
        (param) => `insert into public.users (${publicUserCols.map(quoteIdent).join(', ')})
                    select ${publicUserCols.map(quoteIdent).join(', ')}
                      from jsonb_populate_recordset(null::public.users, ${param})
                    on conflict (id) do update set
                      ${mirrored.map((name) => `${quoteIdent(name)} = excluded.${quoteIdent(name)}`).join(', ')}`,
      );
      return { accounts: ids.length, usersWritten, identitiesWritten };
    });
  });
}
