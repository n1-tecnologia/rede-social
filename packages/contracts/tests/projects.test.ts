import { describe, expect, it } from 'vitest';
import {
  BOOTSTRAP_REASON_CODES,
  BOOTSTRAP_STEP_KEYS,
  createTenantBodySchema,
  DATABASE_PROBLEM_STATES,
  DATABASE_STATES,
  type DatabaseStateInput,
  databaseOverviewSchema,
  databaseState,
  isProjectRef,
  localProjectRefSchema,
  normalizeProjectRef,
  platformTenantsQuerySchema,
  precheckAnswerSchema,
  precheckBodySchema,
  projectRefSchema,
  replaceCredentialsBodySchema,
  TOKEN_CHECKS,
  TOKEN_EXPIRING_WINDOW_DAYS,
  TOKEN_STATES,
  type TokenCheck,
  type TokenState,
  tokenExpiryIsValid,
  tokenState,
} from '../src';
import * as projectsSubpath from '../src/projects';

/**
 * 09.2-14 (D-541, D-542, D-543, D-545): the project DTO module. The ref normaliser, the single derivation of
 * the database state and the strict answers are shared by the API and the web, so they are pinned here.
 */

const REF = 'abcdefghijklmnopqrst';

describe('projectRefSchema and the per-provider shape', () => {
  it('the supabase shape is exactly 20 lower-case letters (19 and 21 fail)', () => {
    expect(projectRefSchema.safeParse('a'.repeat(19)).success).toBe(false);
    expect(projectRefSchema.safeParse('a'.repeat(20)).success).toBe(true);
    expect(projectRefSchema.safeParse('a'.repeat(21)).success).toBe(false);
    expect(projectRefSchema.safeParse(`${'a'.repeat(19)}1`).success).toBe(false);
    expect(projectRefSchema.safeParse(`${'a'.repeat(19)}A`).success).toBe(false);
    expect(projectRefSchema.safeParse(`${'a'.repeat(19)}-`).success).toBe(false);
    expect(projectRefSchema.safeParse('').success).toBe(false);
  });

  it('the local form is looser and only the fake provider accepts it', () => {
    expect(localProjectRefSchema.safeParse('fk-1a2b3c').success).toBe(true);
    expect(isProjectRef('fake', 'fk-1a2b3c')).toBe(true);
    expect(isProjectRef('supabase', 'fk-1a2b3c')).toBe(false);
    expect(isProjectRef('supabase', REF)).toBe(true);
    expect(isProjectRef('fake', 'Ab')).toBe(false);
  });

  it('the subpath module exports the same things as the barrel', () => {
    expect(projectsSubpath.databaseState).toBe(databaseState);
    expect(projectsSubpath.normalizeProjectRef).toBe(normalizeProjectRef);
  });
});

describe('normalizeProjectRef (UI-D-533)', () => {
  it('keeps a bare ref, trimmed and lower-cased', () => {
    expect(normalizeProjectRef(REF)).toBe(REF);
    expect(normalizeProjectRef(`  ${REF.toUpperCase()}\n`)).toBe(REF);
  });

  it('extracts the ref from the dashboard URL, with any trailing path, query or hash', () => {
    const base = `https://supabase.com/dashboard/project/${REF}`;
    expect(normalizeProjectRef(base)).toBe(REF);
    expect(normalizeProjectRef(`${base}/`)).toBe(REF);
    expect(normalizeProjectRef(`${base}/settings/database`)).toBe(REF);
    expect(normalizeProjectRef(`${base}?tab=1`)).toBe(REF);
    expect(normalizeProjectRef(`${base}#top`)).toBe(REF);
    expect(
      normalizeProjectRef(`  HTTPS://Supabase.com/Dashboard/Project/${REF.toUpperCase()}/x  `),
    ).toBe(REF);
    expect(normalizeProjectRef(`http://www.supabase.com/dashboard/project/${REF}`)).toBe(REF);
  });

  it('extracts the ref from the project URL', () => {
    expect(normalizeProjectRef(`https://${REF}.supabase.co`)).toBe(REF);
    expect(normalizeProjectRef(`https://${REF}.supabase.co/`)).toBe(REF);
    expect(normalizeProjectRef(`https://${REF}.supabase.co/rest/v1/`)).toBe(REF);
    expect(normalizeProjectRef(`https://${REF.toUpperCase()}.SUPABASE.CO`)).toBe(REF);
  });

  it('keeps anything else as typed (so the format rule fails it)', () => {
    expect(normalizeProjectRef('')).toBe('');
    expect(normalizeProjectRef('   ')).toBe('');
    expect(normalizeProjectRef('not a ref')).toBe('not a ref');
    expect(normalizeProjectRef('https://example.com/dashboard/project/abc')).toBe(
      'https://example.com/dashboard/project/abc',
    );
    expect(normalizeProjectRef(`https://evil.test/?u=https://${REF}.supabase.co`)).toBe(
      `https://evil.test/?u=https://${REF}.supabase.co`,
    );
    expect(normalizeProjectRef(`https://${REF}.supabase.co.evil.test/`)).toBe(
      `https://${REF}.supabase.co.evil.test/`,
    );
    // A URL with a wrong-shaped ref still extracts it, so the field shows what failed.
    expect(normalizeProjectRef('https://supabase.com/dashboard/project/abc')).toBe('abc');
  });
});

describe('databaseState (UI-D-539): the precedence moving > preparation_failed > preparing > unreachable > paused > behind > unchecked > ready', () => {
  const ready: DatabaseStateInput = {
    projectState: 'ready',
    steps: [],
    health: 'healthy',
    schema: { applied: 147, required: 147 },
    moving: false,
  };

  it('a healthy ready project at the required schema is ready', () => {
    expect(databaseState(ready)).toBe('ready');
  });

  it('each state on its own', () => {
    expect(databaseState({ ...ready, moving: true })).toBe('moving');
    expect(databaseState({ ...ready, steps: [{ status: 'failed' }] })).toBe('preparation_failed');
    expect(databaseState({ ...ready, projectState: 'preparing' })).toBe('preparing');
    expect(databaseState({ ...ready, health: 'unreachable' })).toBe('unreachable');
    expect(databaseState({ ...ready, health: 'paused' })).toBe('paused');
    expect(databaseState({ ...ready, schema: { applied: 144, required: 147 } })).toBe('behind');
    expect(databaseState({ ...ready, health: 'unknown' })).toBe('unchecked');
    expect(databaseState({ ...ready, health: null })).toBe('unchecked');
    expect(databaseState({ ...ready, health: undefined })).toBe('unchecked');
  });

  it('the full precedence matrix: every combination ranks by the fixed order', () => {
    const order = [
      'moving',
      'preparation_failed',
      'preparing',
      'unreachable',
      'paused',
      'behind',
      'unchecked',
      'ready',
    ] as const;
    // Eight switches that each ADD one reason, in the order of the precedence; the state is the first one on.
    for (let mask = 0; mask < 2 ** 7; mask += 1) {
      const on = (bit: number) => (mask & (1 << bit)) !== 0;
      const input: DatabaseStateInput = {
        moving: on(0),
        steps: on(1) ? [{ status: 'done' }, { status: 'failed' }] : [{ status: 'done' }],
        projectState: on(2) ? 'preparing' : 'ready',
        health: on(3) ? 'unreachable' : on(4) ? 'paused' : on(6) ? 'unknown' : 'healthy',
        schema: on(5) ? { applied: 1, required: 2 } : { applied: 2, required: 2 },
      };
      const reasons: (typeof order)[number][] = [];
      if (input.moving) reasons.push('moving');
      if (on(1)) reasons.push('preparation_failed');
      if (on(2)) reasons.push('preparing');
      if (on(3)) reasons.push('unreachable');
      if (!on(3) && on(4)) reasons.push('paused');
      if (on(5)) reasons.push('behind');
      if (!on(3) && !on(4) && on(6)) reasons.push('unchecked');
      const expected = reasons[0] ?? 'ready';
      expect(databaseState(input), `mask ${mask}`).toBe(expected);
    }
  });

  it('behind: one below is behind, equal and above are not, a missing number holds nothing out', () => {
    expect(databaseState({ ...ready, schema: { applied: 146, required: 147 } })).toBe('behind');
    expect(databaseState({ ...ready, schema: { applied: 147, required: 147 } })).toBe('ready');
    expect(databaseState({ ...ready, schema: { applied: 148, required: 147 } })).toBe('ready');
    expect(databaseState({ ...ready, schema: { applied: 0, required: 147 } })).toBe('behind');
    expect(databaseState({ ...ready, schema: { applied: null, required: 147 } })).toBe('ready');
    expect(databaseState({ ...ready, schema: { applied: 100, required: null } })).toBe('ready');
    expect(databaseState({ ...ready, schema: null })).toBe('ready');
    expect(databaseState({ ...ready, schema: undefined })).toBe('ready');
  });

  it('a project that is not ready is preparing whatever its state text, and the four problem states are a subset', () => {
    for (const projectState of ['preparing', 'failed', 'paused', 'anything']) {
      expect(databaseState({ ...ready, projectState })).toBe('preparing');
    }
    for (const state of DATABASE_PROBLEM_STATES) expect(DATABASE_STATES).toContain(state);
    expect([...DATABASE_PROBLEM_STATES]).toEqual([
      'preparation_failed',
      'behind',
      'paused',
      'unreachable',
    ]);
  });

  it('the eight states and the eight steps are fixed', () => {
    expect(DATABASE_STATES).toHaveLength(8);
    expect([...BOOTSTRAP_STEP_KEYS]).toEqual([
      'verify',
      'roles',
      'schema',
      'auth',
      'buckets',
      'realtime',
      'tenant',
      'invite',
    ]);
    expect(BOOTSTRAP_REASON_CODES).toHaveLength(10);
  });
});

describe('databaseOverviewSchema is strict and has no credential-capable field', () => {
  const overview = {
    ref: REF,
    plan: 'pro',
    state: 'ready',
    steps: BOOTSTRAP_STEP_KEYS.map((step) => ({
      step,
      status: 'done',
      attempt: 1,
      reasonCode: null,
      startedAt: '2026-10-23T00:00:00.000Z',
      finishedAt: '2026-10-23T00:00:01.000Z',
    })),
    schema: { applied: 147, required: 147 },
    lastCheckedAt: '2026-10-23T00:05:00.000Z',
    preparationFinishedAt: '2026-10-23T00:00:01.000Z',
    credentials: { held: true, updatedAt: '2026-10-23T00:00:01.000Z' },
    otherTenants: 0,
    moving: false,
    lastErrorCode: null,
  };

  it('accepts the documented shape', () => {
    expect(databaseOverviewSchema.safeParse(overview).success).toBe(true);
    expect(databaseOverviewSchema.safeParse({ ...overview, plan: null }).success).toBe(true);
  });

  it('rejects an unknown key at every level, so a credential cannot be added by accident', () => {
    expect(databaseOverviewSchema.safeParse({ ...overview, serviceKey: 'x' }).success).toBe(false);
    expect(
      databaseOverviewSchema.safeParse({ ...overview, databaseUrl: 'postgres://x' }).success,
    ).toBe(false);
    expect(
      databaseOverviewSchema.safeParse({
        ...overview,
        credentials: { held: true, updatedAt: null, password: 'x' },
      }).success,
    ).toBe(false);
    expect(
      databaseOverviewSchema.safeParse({
        ...overview,
        steps: [{ ...(overview.steps[0] as object), detail: 'select 1' }],
      }).success,
    ).toBe(false);
    expect(
      databaseOverviewSchema.safeParse({
        ...overview,
        schema: { applied: 1, required: 2, head: 'x' },
      }).success,
    ).toBe(false);
  });

  it('a reason outside the closed catalog is not a valid answer', () => {
    expect(
      databaseOverviewSchema.safeParse({ ...overview, lastErrorCode: 'ECONNREFUSED' }).success,
    ).toBe(false);
    expect(
      databaseOverviewSchema.safeParse({ ...overview, lastErrorCode: 'unreachable' }).success,
    ).toBe(true);
  });
});

describe('pre-check and write-only access schemas', () => {
  it('the body takes a ref string (empty allowed: that is an answer) and nothing else', () => {
    expect(precheckBodySchema.parse({ projectRef: `  ${REF} ` })).toEqual({ projectRef: REF });
    expect(precheckBodySchema.safeParse({ projectRef: '' }).success).toBe(true);
    expect(precheckBodySchema.safeParse({ projectRef: REF, url: 'https://x' }).success).toBe(false);
    expect(precheckBodySchema.safeParse({}).success).toBe(false);
    expect(precheckBodySchema.safeParse({ projectRef: 'x'.repeat(201) }).success).toBe(false);
  });

  it('the answer is ok+manualAccess or not-ok+reason, and the reason is one of the six', () => {
    expect(precheckAnswerSchema.safeParse({ ok: true, manualAccess: false }).success).toBe(true);
    for (const reason of ['invalid', 'not_found', 'not_empty', 'in_use', 'paused', 'unchecked']) {
      expect(precheckAnswerSchema.safeParse({ ok: false, reason }).success).toBe(true);
    }
    expect(precheckAnswerSchema.safeParse({ ok: false, reason: 'boom' }).success).toBe(false);
    expect(precheckAnswerSchema.safeParse({ ok: true }).success).toBe(false);
    expect(precheckAnswerSchema.safeParse({ ok: true, manualAccess: true, ref: REF }).success).toBe(
      false,
    );
  });

  it('replaceCredentialsBodySchema takes any non-empty subset and nothing else', () => {
    expect(replaceCredentialsBodySchema.safeParse({ databasePassword: 'p' }).success).toBe(true);
    expect(replaceCredentialsBodySchema.safeParse({ serviceKey: 'k' }).success).toBe(true);
    expect(
      replaceCredentialsBodySchema.safeParse({ publishableKey: 'k', serviceKey: 'k' }).success,
    ).toBe(true);
    expect(replaceCredentialsBodySchema.safeParse({}).success).toBe(false);
    expect(replaceCredentialsBodySchema.safeParse({ serviceKey: '' }).success).toBe(false);
    expect(replaceCredentialsBodySchema.safeParse({ serviceKey: '   ' }).success).toBe(false);
    expect(replaceCredentialsBodySchema.safeParse({ serviceKey: 'k', extra: 'x' }).success).toBe(
      false,
    );
    expect(replaceCredentialsBodySchema.safeParse({ serviceKey: 'k'.repeat(4097) }).success).toBe(
      false,
    );
  });
});

describe('the create body and the list query carry the project fields', () => {
  const body = {
    displayName: 'Comunidade',
    slug: 'comunidade',
    colors: { primary: '#7c3aed', secondary: '#a78bfa' },
    adminEmail: 'admin@cliente.com.br',
  };

  it('projectRef and access are optional; access is strict', () => {
    expect(createTenantBodySchema.safeParse(body).success).toBe(true);
    const parsed = createTenantBodySchema.parse({
      ...body,
      projectRef: ` ${REF} `,
      access: { databasePassword: 'p', serviceKey: 's', publishableKey: 'k' },
    });
    expect(parsed.projectRef).toBe(REF);
    expect(parsed.access).toEqual({ databasePassword: 'p', serviceKey: 's', publishableKey: 'k' });
    expect(createTenantBodySchema.safeParse({ ...body, access: { token: 'x' } }).success).toBe(
      false,
    );
    expect(createTenantBodySchema.safeParse({ ...body, projectRef: 'x'.repeat(201) }).success).toBe(
      false,
    );
  });

  it('banco=problema is accepted and is mutually exclusive with status', () => {
    expect(platformTenantsQuerySchema.parse({ banco: 'problema' })).toEqual({
      banco: 'problema',
      limit: 25,
    });
    expect(platformTenantsQuerySchema.safeParse({ banco: 'tudo' }).success).toBe(false);
    const both = platformTenantsQuerySchema.safeParse({ banco: 'problema', status: 'active' });
    expect(both.success).toBe(false);
    expect(both.error?.issues[0]?.path).toEqual(['banco']);
    expect(platformTenantsQuerySchema.safeParse({ status: 'suspended' }).success).toBe(true);
  });
});

describe('tokenState (D-573, UI-D-553): the precedence org_mismatch > invalid > no_permission > expired > expiring > unchecked > valid', () => {
  const today = '2026-10-27';
  const past = '2026-10-01';
  const in12 = '2026-11-08';
  const in30 = '2026-11-26';
  const in31 = '2026-11-27';

  type Row = [TokenCheck | null, string | null, TokenState];
  const table: Row[] = [
    // organização diferente wins over everything, expired or not
    ['org_mismatch', past, 'org_mismatch'],
    ['org_mismatch', in12, 'org_mismatch'],
    ['org_mismatch', in30, 'org_mismatch'],
    ['org_mismatch', in31, 'org_mismatch'],
    ['org_mismatch', null, 'org_mismatch'],
    // inválido
    ['invalid', past, 'invalid'],
    ['invalid', in12, 'invalid'],
    ['invalid', in30, 'invalid'],
    ['invalid', in31, 'invalid'],
    ['invalid', null, 'invalid'],
    // sem permissão ('forbidden' is the stored outcome)
    ['forbidden', past, 'no_permission'],
    ['forbidden', in12, 'no_permission'],
    ['forbidden', in30, 'no_permission'],
    ['forbidden', in31, 'no_permission'],
    ['forbidden', null, 'no_permission'],
    // ok: the date decides
    ['ok', past, 'expired'],
    ['ok', in12, 'expiring'],
    ['ok', in30, 'expiring'],
    ['ok', in31, 'valid'],
    ['ok', null, 'valid'],
    // never checked: a date can still say vencido / vencendo, otherwise não verificado
    [null, past, 'expired'],
    [null, in12, 'expiring'],
    [null, in30, 'expiring'],
    [null, in31, 'unchecked'],
    [null, null, 'unchecked'],
  ];

  it('precedence: every check crossed with every expiry follows the fixed order', () => {
    expect(table.length).toBeGreaterThanOrEqual(20);
    for (const [check, expiresAt, expected] of table) {
      expect(tokenState({ check, expiresAt, today }), `${check} / ${expiresAt}`).toBe(expected);
    }
  });

  it('the table covers every stored check outcome and every state', () => {
    for (const check of TOKEN_CHECKS) expect(table.some((row) => row[0] === check)).toBe(true);
    for (const state of TOKEN_STATES) expect(table.some((row) => row[2] === state)).toBe(true);
    expect([...TOKEN_CHECKS]).toEqual(['ok', 'invalid', 'forbidden', 'org_mismatch']);
    expect([...TOKEN_STATES]).toEqual([
      'valid',
      'expiring',
      'expired',
      'invalid',
      'no_permission',
      'org_mismatch',
      'unchecked',
    ]);
  });

  it('window: today is expiring (0 days left), 30 days is expiring, 31 days is valid, yesterday is expired', () => {
    expect(TOKEN_EXPIRING_WINDOW_DAYS).toBe(30);
    expect(tokenState({ check: 'ok', expiresAt: today, today })).toBe('expiring');
    expect(tokenState({ check: 'ok', expiresAt: '2026-11-26', today })).toBe('expiring');
    expect(tokenState({ check: 'ok', expiresAt: '2026-11-27', today })).toBe('valid');
    expect(tokenState({ check: 'ok', expiresAt: '2026-10-26', today })).toBe('expired');
  });

  it('window: the whole days are counted on calendar dates, with no timezone or DST in them', () => {
    // Crosses a year end and a leap day.
    expect(tokenState({ check: 'ok', expiresAt: '2027-01-05', today: '2026-12-06' })).toBe(
      'expiring',
    );
    expect(tokenState({ check: 'ok', expiresAt: '2027-01-06', today: '2026-12-06' })).toBe('valid');
    expect(tokenState({ check: 'ok', expiresAt: '2028-03-01', today: '2028-01-31' })).toBe(
      'expiring',
    );
    expect(tokenState({ check: 'ok', expiresAt: '2028-03-02', today: '2028-01-31' })).toBe('valid');
  });
});

describe('tokenExpiryIsValid (D-575): YYYY-MM-DD, strictly after today, at most one year after today', () => {
  const today = '2026-10-27';

  it('today, yesterday, an impossible date and a non-date are refused', () => {
    expect(tokenExpiryIsValid('2026-10-27', today)).toBe(false);
    expect(tokenExpiryIsValid('2026-10-26', today)).toBe(false);
    expect(tokenExpiryIsValid('2026-13-40', today)).toBe(false);
    expect(tokenExpiryIsValid('2026-02-30', today)).toBe(false);
    expect(tokenExpiryIsValid('abc', today)).toBe(false);
    expect(tokenExpiryIsValid('', today)).toBe(false);
    expect(tokenExpiryIsValid('2026-10-28T00:00:00Z', today)).toBe(false);
    expect(tokenExpiryIsValid('27/10/2026', today)).toBe(false);
  });

  it('more than one year after today is refused, exactly one year is accepted', () => {
    expect(tokenExpiryIsValid('2027-10-28', today)).toBe(false);
    expect(tokenExpiryIsValid('2028-10-27', today)).toBe(false);
    expect(tokenExpiryIsValid('2027-10-27', today)).toBe(true);
  });

  it('tomorrow is accepted', () => {
    expect(tokenExpiryIsValid('2026-10-28', today)).toBe(true);
  });
});

describe('the token state is its own axis (D-573, D-574, UI-D-551)', () => {
  it('DATABASE_STATES is the same eight entries and databaseState has no token input', () => {
    expect([...DATABASE_STATES]).toEqual([
      'ready',
      'preparing',
      'preparation_failed',
      'behind',
      'paused',
      'unreachable',
      'moving',
      'unchecked',
    ]);
    const base: DatabaseStateInput = {
      projectState: 'ready',
      steps: [],
      health: 'healthy',
      schema: { applied: 147, required: 147 },
      moving: false,
    };
    // A dead token handed in by mistake changes nothing: it can never become "Inacessível".
    for (const check of ['invalid', 'forbidden', 'org_mismatch']) {
      expect(databaseState({ ...base, check, token: 'invalid' } as DatabaseStateInput)).toBe(
        'ready',
      );
    }
    expect(DATABASE_STATES).not.toContain('invalid');
    expect(DATABASE_STATES).not.toContain('org_mismatch');
  });
});
