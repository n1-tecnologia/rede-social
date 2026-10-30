import { exportAnswers } from '@rede-social/core/server/profile-form/export';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  removeProfileFormByPrefix,
  SEED_PASSWORD,
  seedProfileFormAnswer,
  seedProfileFormQuestion,
  signInAs,
  withProfileForm,
} from './setup';

/**
 * 12-10 (D-595, PFORM-08 route half, PFORM-21; T-12-24, T-12-25, T-12-26) against the live local stack: the
 * answers export under `GET /v1/profile_form/export` -- the bytes, the roles, the audit row before the body, and
 * tenant isolation.
 *
 * WHO EXPORTS. The audit row of a successful export lands in the append-only `moderation_log`, which no fixture
 * can clean up, and an orphaned row (its membership deleted with a throwaway identity) trips pgTAP 154's anchor
 * check. So every export that SUCCEEDS is made by a SEEDED admin (`admin@rede-lab.local`, `admin@rede-demo.local`),
 * whose membership outlives the run. Throwaway identities (prefix `pfx`) are the MEMBERS that are exported and the
 * support and member sessions that are refused; they write no log row.
 *
 * Questions carry the title prefix `pfx ` so the sweep removes only this file's rows. The seeded tenants have
 * their own members, so every assertion looks at the rows whose e-mail starts with `pfx-`.
 */

const PREFIX = 'pfx';
const TITLE = 'pfx ';
const BOM = '﻿';

let labTenantId = '';
let demoTenantId = '';
let labAdmin = { userId: '', token: '' };
let demoAdmin = { userId: '', token: '' };

type Person = { userId: string; email: string; password: string; token: string };

async function member(
  role: 'member' | 'admin_tenant' | 'support_tenant' = 'member',
  options: {
    host?: keyof typeof HOSTS;
    status?: 'active' | 'blocked' | 'invited';
    displayName?: string;
  } = {},
): Promise<Person> {
  const identity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [
      {
        host: options.host ?? 'lab',
        role,
        status: options.status ?? 'active',
        ...(options.displayName === undefined ? {} : { displayName: options.displayName }),
      },
    ],
  });
  return { ...identity, token: await signInAs(identity.email, identity.password) };
}

const callExport = (token: string, host: string = HOSTS.lab) =>
  api.request('/v1/profile_form/export', {
    method: 'GET',
    headers: { 'x-tenant-host': host, authorization: `Bearer ${token}` },
  });

/**
 * The body as text WITH its byte-order mark: `Response.text()` strips a leading BOM, and the BOM is part of
 * what is under test, so the bytes are decoded by hand and the first three are pinned separately.
 */
async function bodyOf(res: Response): Promise<string> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}

const codeOf = async (res: Response): Promise<string | undefined> =>
  ((await res.json()) as { error?: { code?: string } }).error?.code;

/** RFC 4180 with `;`: quotes doubled inside a quoted field, CR and LF kept inside one. */
function parseCsv(raw: string): { header: string[]; rows: string[][] } {
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw;
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"' && text.charAt(i + 1) === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ';') {
      record.push(field);
      field = '';
    } else if (ch === '\r' && text.charAt(i + 1) === '\n') {
      record.push(field);
      records.push(record);
      field = '';
      record = [];
      i += 1;
    } else field += ch;
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  const [header = [], ...rows] = records;
  return { header, rows };
}

/** The exported rows whose e-mail is one of this file's throwaway identities, by e-mail. */
function mine(csv: { rows: string[][] }): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const row of csv.rows) {
    if ((row[1] ?? '').startsWith(`${PREFIX}-`)) out.set(row[1] ?? '', row);
  }
  return out;
}

const exportedRows = async (userId: string) =>
  adminSql<
    {
      id: string;
      tenant_id: string;
      actor_user_id: string;
      actor_membership_id: string;
      target_user_id: string;
      target_membership_id: string;
      subject_type: string | null;
      subject_id: string | null;
      reason: string | null;
      excerpt: string | null;
      details: unknown;
    }[]
  >`
    select id::text as id, tenant_id::text as tenant_id, actor_user_id::text as actor_user_id,
           actor_membership_id::text as actor_membership_id, target_user_id::text as target_user_id,
           target_membership_id::text as target_membership_id, subject_type, subject_id::text as subject_id,
           reason, excerpt, details
      from public.moderation_log
     where action = 'profile_form_exported' and actor_user_id = ${userId}::uuid
     order by created_at, id`;

const question = (over: Partial<Parameters<typeof seedProfileFormQuestion>[0]> = {}) =>
  seedProfileFormQuestion({
    tenantId: labTenantId,
    adminUserId: labAdmin.userId,
    title: `${TITLE}${crypto.randomUUID().slice(0, 8)}`,
    ...over,
  });

const answer = (userId: string, questionId: string, value: unknown, tenantId = labTenantId) =>
  seedProfileFormAnswer({ tenantId, questionId, userId, value });

async function userIdOf(email: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    select id::text as id from auth.users where email = ${email}`;
  if (!row) throw new Error(`seed user ${email} is missing, run pnpm db:seed first`);
  return row.id;
}

/**
 * A question title that is itself a payload cannot carry the `pfx ` prefix (the trigger must come first), so
 * it ends with a marker the sweep also removes.
 */
const TRAP_MARK = ' pfx-trap';
const TRAP_TITLE = `=cmd|' /C calc'!A0${TRAP_MARK}`;
const TRAP_HEADER = `'${TRAP_TITLE}`;

async function sweep(): Promise<void> {
  await adminSql`
    delete from public.profile_form_answers
     where question_id in (select id from public.profile_form_questions
                            where title like ${`%${TRAP_MARK}`})`;
  await adminSql`delete from public.profile_form_questions where title like ${`%${TRAP_MARK}`}`;
  await removeProfileFormByPrefix(TITLE);
  await removeIdentitiesByPrefix(PREFIX);
}

beforeAll(async () => {
  const tenants = await adminSql<{ id: string; slug: string }[]>`
    select id::text as id, slug from public.tenants where slug in ('rede-lab', 'rede-demo')`;
  const lab = tenants.find((t) => t.slug === 'rede-lab');
  const demo = tenants.find((t) => t.slug === 'rede-demo');
  if (!lab || !demo) throw new Error('seed tenants are missing, run pnpm db:seed first');
  labTenantId = lab.id;
  demoTenantId = demo.id;
  await sweep();
  labAdmin = {
    userId: await userIdOf('admin@rede-lab.local'),
    token: await signInAs('admin@rede-lab.local', SEED_PASSWORD),
  };
  demoAdmin = {
    userId: await userIdOf('admin@rede-demo.local'),
    token: await signInAs('admin@rede-demo.local', SEED_PASSWORD),
  };
});

// Each case builds its own questions and members: nothing a case seeded may show up in the next one's file.
afterEach(async () => {
  await sweep();
});

afterAll(async () => {
  await sweep();
  // The seed has no `profile_form` row and `withProfileForm` restores that, so none must remain.
  await adminSql`
    delete from public.tenant_modules
     where module_key = 'profile_form' and tenant_id in (${labTenantId}::uuid, ${demoTenantId}::uuid)`;
});

describe('12-10 tracer: the export commits its audit row before the first byte and then streams the file (D-595, T-12-26)', () => {
  it('headers, the audit row visible once the headers arrive and before the body is read, then the body', async () => {
    await withProfileForm(labTenantId, async () => {
      const ana = await member('member', { displayName: 'pfx Ana Souza' });
      const q = await question({ title: `${TITLE}Cidade`, position: 1 });
      await answer(ana.userId, q, 'São Paulo');

      const before = (await exportedRows(labAdmin.userId)).length;
      const res = await callExport(labAdmin.token);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('no-store');
      const [tenant] = await adminSql<{ timezone: string }[]>`
        select timezone from public.tenants where id = ${labTenantId}::uuid`;
      const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: tenant?.timezone ?? 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      expect(res.headers.get('content-disposition')).toBe(
        `attachment; filename="respostas-perfil-${day}.csv"`,
      );

      // T-12-26: the headers have arrived and the body is UNREAD, and the row is already committed.
      const during = await exportedRows(labAdmin.userId);
      expect(during).toHaveLength(before + 1);
      const row = during[during.length - 1];
      expect(row).toMatchObject({
        tenant_id: labTenantId,
        actor_user_id: labAdmin.userId,
        target_user_id: labAdmin.userId,
        subject_type: null,
        subject_id: null,
        reason: null,
        excerpt: null,
        details: null,
      });
      // The admin is BOTH parties, and the membership belongs to this tenant.
      expect(row?.actor_membership_id).toBe(row?.target_membership_id);
      const [membership] = await adminSql<{ tenant_id: string; user_id: string }[]>`
        select tenant_id::text as tenant_id, user_id::text as user_id from public.memberships
         where id = ${row?.actor_membership_id ?? ''}::uuid`;
      expect(membership).toEqual({ tenant_id: labTenantId, user_id: labAdmin.userId });

      const text = await bodyOf(res);
      expect(text.startsWith(`${BOM}Nome;E-mail;`)).toBe(true);
      expect(text).toContain('\r\n');
      const csv = parseCsv(text);
      expect(csv.header.slice(0, 2)).toEqual(['Nome', 'E-mail']);
      expect(csv.header).toContain(`${TITLE}Cidade`);
      const line = mine(csv).get(ana.email);
      expect(line?.[0]).toBe('pfx Ana Souza');
      expect(line?.[csv.header.indexOf(`${TITLE}Cidade`)]).toBe('São Paulo');
      // Reading the body wrote nothing more.
      expect(await exportedRows(labAdmin.userId)).toHaveLength(before + 1);
    });
  });

  it('a second export writes a second row, and the log row holds no answer, e-mail or member list', async () => {
    await withProfileForm(labTenantId, async () => {
      const ana = await member('member', { displayName: 'pfx Ana Segredo' });
      const q = await question({ title: `${TITLE}Segredo`, position: 1 });
      await answer(ana.userId, q, 'valor-sigiloso-xyz');
      const before = (await exportedRows(labAdmin.userId)).length;
      for (let i = 1; i <= 2; i += 1) {
        const res = await callExport(labAdmin.token);
        expect(res.status).toBe(200);
        await bodyOf(res);
        expect(await exportedRows(labAdmin.userId)).toHaveLength(before + i);
      }
      const rows = await adminSql<{ doc: string }[]>`
        select row_to_json(l)::text as doc from public.moderation_log l
         where action = 'profile_form_exported' and actor_user_id = ${labAdmin.userId}::uuid`;
      for (const { doc } of rows) {
        expect(doc).not.toContain('valor-sigiloso-xyz');
        expect(doc).not.toContain(ana.email);
        expect(doc).not.toContain('Ana Segredo');
      }
    });
  });
});

describe('12-10 who is in the file (A-12-02) and what each cell says (PFORM-21)', () => {
  it('one row per member, active and blocked; none for invited, staff or soft-deleted', async () => {
    await withProfileForm(labTenantId, async () => {
      const active = await member('member', { status: 'active' });
      const blocked = await member('member', { status: 'blocked' });
      const invited = await member('member', { status: 'invited' });
      const support = await member('support_tenant');
      const adminStaff = await member('admin_tenant');
      const deleted = await member('member');
      await adminSql`
        update public.memberships set deleted_at = now()
         where user_id = ${deleted.userId}::uuid`;

      const res = await callExport(labAdmin.token);
      expect(res.status).toBe(200);
      const text = await bodyOf(res);
      const rows = mine(parseCsv(text));
      expect([...rows.keys()].sort()).toEqual([active.email, blocked.email].sort());
      for (const gone of [invited, support, adminStaff, deleted]) {
        expect(rows.has(gone.email)).toBe(false);
      }
      // Every exported row is a member: the seeded admin and support never appear either.
      expect(text).not.toContain('admin@rede-lab.local');
      expect(text).not.toContain('support@rede-lab.local');
    });
  });

  it('renders every one of the thirteen types, active questions in the admin order then archived ones by archived_at, an unanswered archived question as an empty column', async () => {
    await withProfileForm(labTenantId, async () => {
      const ana = await member('member', { displayName: 'pfx Tipos' });
      const blank = await member('member', { displayName: 'pfx Sem respostas' });
      const [o1, o2, o3] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
      const choices = [
        { id: o1, label: 'Azul' },
        { id: o2, label: 'Verde' },
        { id: o3, label: 'Vermelho, escuro' },
      ];
      const make = (type: string, position: number, extra: Record<string, unknown> = {}) =>
        question({ type, title: `${TITLE}${type}`, position, ...extra });
      const ids = {
        short_text: await make('short_text', 1),
        long_text: await make('long_text', 2),
        dropdown: await make('dropdown', 3, { options: choices }),
        multiple_choice: await make('multiple_choice', 4, { options: choices, allowOther: true }),
        single_choice: await make('single_choice', 5, { options: choices, allowOther: true }),
        number: await make('number', 6),
        date: await make('date', 7),
        phone: await make('phone', 8),
        email: await make('email', 9),
        link: await make('link', 10),
        yes_no: await make('yes_no', 11),
        acceptance: await make('acceptance', 12),
        rating: await make('rating', 13),
      };
      // Archived: the LATER archive is listed last whatever the creation order; one has no answers.
      const archivedLate = await question({
        title: `${TITLE}arquivada tarde`,
        position: 1,
        archivedAt: new Date('2026-06-02T10:00:00Z'),
      });
      const archivedEarly = await question({
        title: `${TITLE}arquivada cedo`,
        position: 2,
        archivedAt: new Date('2026-06-01T10:00:00Z'),
      });
      const archivedEmpty = await question({
        title: `${TITLE}arquivada vazia`,
        position: 3,
        archivedAt: new Date('2026-06-03T10:00:00Z'),
      });
      void archivedEmpty;

      const values: [string, unknown][] = [
        [ids.short_text, 'Curto'],
        [ids.long_text, 'Linha 1\nLinha 2'],
        [ids.dropdown, { optionId: o2, otherText: null }],
        [ids.multiple_choice, { optionIds: [o2, o1], otherText: 'Roxo' }],
        [ids.single_choice, { optionId: null, otherText: 'Outra cor' }],
        [ids.number, 3.5],
        [ids.date, '2026-10-29'],
        [ids.phone, '11912345678'],
        [ids.email, 'ana@exemplo.com'],
        [ids.link, 'https://exemplo.com/a?b=1'],
        [ids.yes_no, false],
        [ids.acceptance, true],
        [ids.rating, 4],
        [archivedLate, 'tarde'],
        [archivedEarly, 'cedo'],
      ];
      for (const [questionId, value] of values) await answer(ana.userId, questionId, value);

      const res = await callExport(labAdmin.token);
      expect(res.status).toBe(200);
      const csv = parseCsv(await bodyOf(res));
      const titles = csv.header.filter((h) => h.startsWith(TITLE));
      expect(titles).toEqual(
        [
          'short_text',
          'long_text',
          'dropdown',
          'multiple_choice',
          'single_choice',
          'number',
          'date',
          'phone',
          'email',
          'link',
          'yes_no',
          'acceptance',
          'rating',
          'arquivada cedo',
          'arquivada tarde',
          'arquivada vazia',
        ].map((t) => `${TITLE}${t}`),
      );
      const cell = (row: string[] | undefined, name: string) =>
        row?.[csv.header.indexOf(`${TITLE}${name}`)];
      const rows = mine(csv);
      const line = rows.get(ana.email);
      expect(cell(line, 'short_text')).toBe('Curto');
      expect(cell(line, 'long_text')).toBe('Linha 1\nLinha 2');
      expect(cell(line, 'dropdown')).toBe('Verde');
      expect(cell(line, 'multiple_choice')).toBe('Azul, Verde, Outro: Roxo');
      expect(cell(line, 'single_choice')).toBe('Outro: Outra cor');
      expect(cell(line, 'number')).toBe('3,5');
      expect(cell(line, 'date')).toBe('29/10/2026');
      expect(cell(line, 'phone')).toBe('(11) 91234-5678');
      expect(cell(line, 'email')).toBe('ana@exemplo.com');
      expect(cell(line, 'link')).toBe('https://exemplo.com/a?b=1');
      expect(cell(line, 'yes_no')).toBe('Não');
      expect(cell(line, 'acceptance')).toBe('Aceito');
      expect(cell(line, 'rating')).toBe('4');
      expect(cell(line, 'arquivada cedo')).toBe('cedo');
      expect(cell(line, 'arquivada tarde')).toBe('tarde');
      expect(cell(line, 'arquivada vazia')).toBe('');
      // A member with no answers has empty cells in every question column.
      const empty = rows.get(blank.email);
      for (const title of titles) expect(empty?.[csv.header.indexOf(title)]).toBe('');
    });
  });

  it('neutralises the payloads placed in a question title, a display name and a text answer, and leaves a number question and adjacency alone (T-12-24)', async () => {
    await withProfileForm(labTenantId, async () => {
      const trap = await member('member', { displayName: '=HYPERLINK("http://evil","x")' });
      const plus = await member('member', { displayName: '+SUM(A1)' });
      const adjacent = await member('member', { displayName: 'Ana = Bia' });
      const titleQ = await question({ title: TRAP_TITLE, position: 1 });
      const textQ = await question({ title: `${TITLE}texto`, position: 2 });
      const numberQ = await question({ type: 'number', title: `${TITLE}numero`, position: 3 });
      await answer(trap.userId, textQ, '@SUM(A1)');
      await answer(trap.userId, titleQ, '-2+3');
      await answer(trap.userId, numberQ, -3);
      await answer(adjacent.userId, textQ, 'diz "oi"; ok\nlinha 2 = 3');

      const res = await callExport(labAdmin.token);
      const raw = await bodyOf(res);
      const csv = parseCsv(raw);
      const rows = mine(csv);
      // Header cell from admin-written text: neutralised like any body cell.
      expect(csv.header).toContain(TRAP_HEADER);
      expect(csv.header.some((h) => h.startsWith('=') || h.startsWith('+'))).toBe(false);
      const trapLine = rows.get(trap.email);
      expect(trapLine?.[0]).toBe('\'=HYPERLINK("http://evil","x")');
      expect(trapLine?.[csv.header.indexOf(`${TITLE}texto`)]).toBe("'@SUM(A1)");
      expect(trapLine?.[csv.header.indexOf(TRAP_HEADER)]).toBe("'-2+3");
      // A stored JSON number is data: the minus survives.
      expect(trapLine?.[csv.header.indexOf(`${TITLE}numero`)]).toBe('-3');
      expect(rows.get(plus.email)?.[0]).toBe("'+SUM(A1)");
      // Adjacency: a cell that merely CONTAINS `=` is untouched; quotes doubled, `;` and LF quoted.
      const adjacentLine = rows.get(adjacent.email);
      expect(adjacentLine?.[0]).toBe('Ana = Bia');
      expect(adjacentLine?.[csv.header.indexOf(`${TITLE}texto`)]).toBe('diz "oi"; ok\nlinha 2 = 3');
      expect(raw).toContain('"diz ""oi""; ok\nlinha 2 = 3"');
      // No physical cell of the file starts with a trigger once the quoting is read.
      for (const row of [trapLine, rows.get(plus.email), adjacentLine]) {
        for (const value of row ?? []) expect(/^[=+@\t\r\n]/.test(value)).toBe(false);
      }
    });
  });

  it('two exports of unchanged data are byte-identical', async () => {
    await withProfileForm(labTenantId, async () => {
      const ana = await member('member', { displayName: 'pfx Estável' });
      const q = await question({ title: `${TITLE}estavel`, position: 1 });
      await answer(ana.userId, q, 'sempre igual');
      const first = await bodyOf(await callExport(labAdmin.token));
      const second = await bodyOf(await callExport(labAdmin.token));
      expect(second).toBe(first);
    });
  });
});

describe('12-10 who may export (T-12-25)', () => {
  it('a support_tenant and a member are 403 and write no row; an unauthenticated call is 401', async () => {
    await withProfileForm(labTenantId, async () => {
      const support = await member('support_tenant');
      const plain = await member('member');
      for (const who of [support, plain]) {
        const res = await callExport(who.token);
        expect(res.status).toBe(403);
        expect(await exportedRows(who.userId)).toHaveLength(0);
      }
      const anonymous = await api.request('/v1/profile_form/export', {
        method: 'GET',
        headers: { 'x-tenant-host': HOSTS.lab },
      });
      expect(anonymous.status).toBe(401);
    });
  });

  it('the module off is 404 MODULE_DISABLED and writes no row', async () => {
    await withProfileForm(
      labTenantId,
      async () => {
        const before = (await exportedRows(labAdmin.userId)).length;
        const res = await callExport(labAdmin.token);
        expect(res.status).toBe(404);
        expect(await codeOf(res)).toBe('MODULE_DISABLED');
        expect(await exportedRows(labAdmin.userId)).toHaveLength(before);
      },
      { enabled: false },
    );
  });
});

describe('12-10 paging keeps memory to a page and loses no one (PFORM-21 ordering)', () => {
  it('exportAnswers with a page of 2 yields every member exactly once, in membership-id order, and the same file as the default page', async () => {
    await withProfileForm(labTenantId, async () => {
      const people: Person[] = [];
      for (let i = 0; i < 5; i += 1)
        people.push(await member('member', { displayName: `pfx P${i}` }));
      const q = await question({ title: `${TITLE}paginas`, position: 1 });
      for (const person of people) await answer(person.userId, q, `r-${person.email}`);

      const ctx = {
        userId: labAdmin.userId,
        tenantId: labTenantId,
        role: 'admin_tenant' as const,
        requestId: 'pfx-paging',
      };
      const small = await bodyOf(new Response((await exportAnswers(ctx, { pageSize: 2 })).body));
      const large = await bodyOf(new Response((await exportAnswers(ctx)).body));
      expect(small).toBe(large);

      const csv = parseCsv(small);
      const emails = csv.rows.map((row) => row[1] ?? '').filter((e) => e.startsWith(`${PREFIX}-`));
      expect(new Set(emails).size).toBe(5);
      const expected = await adminSql<{ email: string }[]>`
        select u.email from public.memberships m join public.users u on u.id = m.user_id
         where m.tenant_id = ${labTenantId}::uuid and u.email like ${`${PREFIX}-%`}
           and m.role = 'member' and m.deleted_at is null and m.status in ('active', 'blocked')
         order by m.id`;
      expect(emails).toEqual(expected.map((row) => row.email));
      // The whole file, seeded members included, is in membership-id order and has no repeat.
      const all = csv.rows.map((row) => row[1] ?? '');
      expect(new Set(all).size).toBe(all.length);
    });
  });
});

describe('12-10 tenant isolation (PFORM-08 route half, T-12-25)', () => {
  it('rede-demo never receives a rede-lab member or answer and the other way round; the foreign host is refused and writes no row', async () => {
    await withProfileForm(labTenantId, () =>
      withProfileForm(demoTenantId, async () => {
        const labMember = await member('member', { host: 'lab', displayName: 'pfx Só Lab' });
        const demoMember = await member('member', { host: 'demo', displayName: 'pfx Só Demo' });
        // The SAME title in both tenants (adjacency): only the tenant tells them apart.
        const labQ = await question({ title: `${TITLE}mesmo`, position: 1 });
        const demoQ = await seedProfileFormQuestion({
          tenantId: demoTenantId,
          adminUserId: demoAdmin.userId,
          title: `${TITLE}mesmo`,
          position: 1,
        });
        await answer(labMember.userId, labQ, 'resposta-do-lab');
        await answer(demoMember.userId, demoQ, 'resposta-do-demo', demoTenantId);

        const labFile = await bodyOf(await callExport(labAdmin.token, HOSTS.lab));
        expect(labFile).toContain(labMember.email);
        expect(labFile).toContain('resposta-do-lab');
        expect(labFile).not.toContain(demoMember.email);
        expect(labFile).not.toContain('resposta-do-demo');

        const demoFile = await bodyOf(await callExport(demoAdmin.token, HOSTS.demo));
        expect(demoFile).toContain(demoMember.email);
        expect(demoFile).toContain('resposta-do-demo');
        expect(demoFile).not.toContain(labMember.email);
        expect(demoFile).not.toContain('resposta-do-lab');

        // rede-demo's admin on rede-lab's host: refused before anything runs, and no log row is written.
        const before = (await exportedRows(demoAdmin.userId)).length;
        const wrongHost = await callExport(demoAdmin.token, HOSTS.lab);
        expect(wrongHost.status).toBe(403);
        expect(await codeOf(wrongHost)).toBe('TENANT_HOST_MISMATCH');
        expect(await exportedRows(demoAdmin.userId)).toHaveLength(before);
        // ...and the rows he DID write belong to the demo tenant.
        for (const row of await exportedRows(demoAdmin.userId)) {
          expect(row.tenant_id).toBe(demoTenantId);
        }
      }),
    );
  });
});
