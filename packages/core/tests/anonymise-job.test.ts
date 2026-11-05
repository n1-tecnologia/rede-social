import { describe, expect, it } from 'vitest';
import {
  type AnonymiseDeps,
  type DueMember,
  runAnonymiseDue,
} from '../server/accounts/anonymise-job';
import type { AccountDeletedMailInput } from '../server/mail/index';
import { formatDeletionDate, renderAccountDeleted } from '../server/mail/templates/account-deleted';
import type { MailBrand } from '../server/mail/templates/layout';

/**
 * `accounts.anonymise-due` at unit level (13-13, D-609, NATIVE-21, A-13-04): the four steps per member in order,
 * what a failure at each step leaves behind, the empty and already-deleted cases, and the mail template. Every
 * dependency is injected, so nothing here touches Auth, Postgres or a mail transport; the same job against the
 * real local stack is proved in `apps/api/tests/integration/account-deletion.test.ts`.
 */

const brand: MailBrand = {
  displayName: 'Rede Demo',
  logoUrl: null,
  primary: '#7c3aed',
  onPrimary: '#ffffff',
};

const member = (id: string, tenantId = 't1'): DueMember => ({
  membershipId: `m-${id}`,
  userId: `u-${id}`,
  tenantId,
});

type Harness = {
  deps: AnonymiseDeps;
  calls: string[];
  mails: { to: string; input: AccountDeletedMailInput }[];
  rearms: number;
  warns: Record<string, unknown>[];
  /** Users whose Auth account is already soft-deleted (the lookup answers null). */
  authGone: Set<string>;
  /** Steps that throw once, as `step:userId`. */
  failOnce: Set<string>;
  /** Members that still hold another live membership. */
  shared: Set<string>;
  anonymised: Set<string>;
};

function harness(due: DueMember[]): Harness {
  const h: Harness = {
    calls: [],
    mails: [],
    rearms: 0,
    warns: [],
    authGone: new Set(),
    failOnce: new Set(),
    shared: new Set(),
    anonymised: new Set(),
    deps: undefined as unknown as AnonymiseDeps,
  };
  const trip = (step: string, userId: string) => {
    const key = `${step}:${userId}`;
    if (h.failOnce.delete(key)) throw new Error(`injected failure at ${key}`);
  };
  h.deps = {
    listDue: async () => due.filter((m) => !h.anonymised.has(m.membershipId)),
    tenantFacts: async () => ({ brand, timeZone: 'America/Sao_Paulo' }),
    getAuthUser: async (userId) => {
      h.calls.push(`getAuthUser:${userId}`);
      return h.authGone.has(userId) ? null : { email: `${userId}@example.com` };
    },
    sendMail: async (to, input) => {
      h.calls.push(`sendMail:${to.split('@')[0]}`);
      trip('sendMail', to.split('@')[0] ?? '');
      h.mails.push({ to, input });
    },
    hasOtherMemberships: async (m) => h.shared.has(m.userId),
    softDeleteAuthUser: async (userId) => {
      h.calls.push(`softDelete:${userId}`);
      if (h.authGone.has(userId)) throw new Error('second soft delete');
      trip('softDelete', userId);
      h.authGone.add(userId);
    },
    anonymise: async (membershipId) => {
      h.calls.push(`anonymise:${membershipId}`);
      const userId = membershipId.replace('m-', 'u-');
      trip('anonymise', userId);
      h.anonymised.add(membershipId);
      return true;
    },
    scrubMirrors: async () => {
      h.calls.push('scrubMirrors');
      return 0;
    },
    rearm: async () => {
      h.rearms += 1;
      h.calls.push('rearm');
    },
    now: () => new Date('2026-11-05T15:00:00Z'),
    warn: (fields) => {
      h.warns.push(fields);
    },
  };
  return h;
}

describe('runAnonymiseDue: the order of the steps', () => {
  it('runs read address, send mail, soft-delete the Auth user, anonymise, for each member in the order the list gives (ties already broken by id in SQL)', async () => {
    const h = harness([member('a'), member('b')]);
    const result = await runAnonymiseDue(h.deps);

    const own = h.calls.filter((c) => !c.startsWith('scrubMirrors') && c !== 'rearm');
    expect(own).toEqual([
      'getAuthUser:u-a',
      'sendMail:u-a',
      'softDelete:u-a',
      'anonymise:m-a',
      'getAuthUser:u-b',
      'sendMail:u-b',
      'softDelete:u-b',
      'anonymise:m-b',
    ]);
    expect(result).toMatchObject({ due: 2, anonymised: 2, mailed: 2, failed: 0 });
    // The mirror scrub comes after every member and the re-arm is the very last thing.
    expect(h.calls.slice(-2)).toEqual(['scrubMirrors', 'rearm']);
  });

  it('a failed mail send raises after the batch, leaves that member untouched and still processes the others and re-arms', async () => {
    const h = harness([member('a'), member('b')]);
    h.failOnce.add('sendMail:u-a');

    await expect(runAnonymiseDue(h.deps)).rejects.toThrow(/1 member/);

    // u-a stopped at the mail: no soft delete, no anonymisation, so it is still due; u-b went through.
    expect(h.calls).not.toContain('softDelete:u-a');
    expect(h.calls).not.toContain('anonymise:m-a');
    expect(h.calls).toContain('anonymise:m-b');
    expect(h.rearms).toBe(1);
    expect(h.warns).toEqual([
      expect.objectContaining({
        event: 'account.anonymise.failed',
        tenantId: 't1',
        step: 'sendMail',
      }),
    ]);
    // The shape-only warning never carries the address, the user id or the message of the error.
    expect(JSON.stringify(h.warns)).not.toContain('example.com');
    expect(JSON.stringify(h.warns)).not.toContain('u-a');

    // The next run resumes the member that stayed due.
    await runAnonymiseDue(h.deps);
    expect(h.anonymised.has('m-a')).toBe(true);
    expect(h.mails.filter((m) => m.to.startsWith('u-a@'))).toHaveLength(1);
  });

  it('a failure after the soft delete resumes on the next run without a second soft delete and without a second mail', async () => {
    const h = harness([member('a')]);
    h.failOnce.add('anonymise:u-a');

    await expect(runAnonymiseDue(h.deps)).rejects.toThrow();
    expect(h.authGone.has('u-a')).toBe(true);
    expect(h.mails).toHaveLength(1);

    h.calls.length = 0;
    const second = await runAnonymiseDue(h.deps);
    expect(second).toMatchObject({ due: 1, anonymised: 1, mailed: 0, failed: 0 });
    // The Auth account is already gone: the address cannot be read, so no mail and no delete are attempted.
    expect(h.calls).toContain('anonymise:m-a');
    expect(h.calls).not.toContain('softDelete:u-a');
    expect(h.calls.some((c) => c.startsWith('sendMail'))).toBe(false);
    expect(h.mails).toHaveLength(1);
  });

  it('a member who still holds another live membership keeps their Auth account (only the rows of THIS membership are anonymised)', async () => {
    const h = harness([member('a'), member('b')]);
    h.shared.add('u-a');

    const result = await runAnonymiseDue(h.deps);

    expect(h.calls).toContain('sendMail:u-a');
    expect(h.calls).not.toContain('softDelete:u-a');
    expect(h.calls).toContain('anonymise:m-a');
    expect(h.calls).toContain('softDelete:u-b');
    expect(result).toMatchObject({ anonymised: 2, mailed: 2, keptIdentity: 1 });
  });

  it('formats the date in the tenant time zone and passes the membership as the idempotency key', async () => {
    const h = harness([member('a')]);
    await runAnonymiseDue(h.deps);
    const [sent] = h.mails;
    expect(sent?.input.idempotencyKey).toBe('account-deleted:m-a');
    expect(sent?.input.tenantId).toBe('t1');
    expect(sent?.input.date).toBe('5 de novembro de 2026');
  });
});

describe('runAnonymiseDue: empty and already-deleted (NATIVE-21 edge empty)', () => {
  it('an empty due list sends nothing, deletes nothing and still re-arms', async () => {
    const h = harness([]);
    const result = await runAnonymiseDue(h.deps);
    expect(result).toEqual({ due: 0, anonymised: 0, mailed: 0, keptIdentity: 0, failed: 0 });
    expect(h.mails).toHaveLength(0);
    expect(h.calls.some((c) => c.startsWith('softDelete') || c.startsWith('anonymise'))).toBe(
      false,
    );
    expect(h.rearms).toBe(1);
  });

  it('a member whose Auth user is already soft-deleted skips the mail and still anonymises the rows', async () => {
    const h = harness([member('a')]);
    h.authGone.add('u-a');
    const result = await runAnonymiseDue(h.deps);
    expect(h.mails).toHaveLength(0);
    expect(h.calls).toContain('anonymise:m-a');
    expect(result).toMatchObject({ due: 1, anonymised: 1, mailed: 0 });
  });
});

describe('account-deleted mail template (NATIVE-21 edge encoding, T-13-31)', () => {
  const hostile: MailBrand = { ...brand, displayName: 'Associação São João & Cia <b>' };

  it('renders a tenant name with accents, an ampersand and markup as safe UTF-8', () => {
    const mail = renderAccountDeleted({ brand: hostile, date: '5 de novembro de 2026' });
    // The subject is plain text for the transport's MIME layer: accents stay, no line break can be injected.
    expect(mail.subject).toBe('Sua conta em Associação São João & Cia <b> foi excluída');
    expect(mail.subject).not.toMatch(/[\r\n]/);
    // The HTML escapes the markup and keeps the accents literal (never mojibake, never entities for them).
    expect(mail.html).toContain('Associação São João &amp; Cia &lt;b&gt;');
    expect(mail.html).not.toContain('<b>');
    expect(mail.html).not.toMatch(/Ã|Â|�/);
    expect(mail.html).toContain('<meta charset="utf-8">');
    expect(mail.text).toContain('Associação São João & Cia <b>');
  });

  it('cannot inject a header line through the tenant name', () => {
    const mail = renderAccountDeleted({
      brand: { ...brand, displayName: 'Rede\r\nBcc: alguem@example.com' },
      date: '5 de novembro de 2026',
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject).toBe('Sua conta em Rede Bcc: alguem@example.com foi excluída');
  });

  it('carries the tenant name, the date and one sentence, and nothing else', () => {
    const mail = renderAccountDeleted({ brand, date: '5 de novembro de 2026' });
    expect(mail.text).toBe(
      [
        'Rede Demo',
        '',
        'Conta excluída',
        '',
        'Em 5 de novembro de 2026, os seus dados pessoais foram apagados de Rede Demo.',
        '',
        '— Enviado pela plataforma Rede Social',
      ].join('\n'),
    );
    expect(mail.html).not.toMatch(/href=/);
    expect(mail.html).not.toMatch(/@/);
  });

  it('formats the date in the given zone and falls back to UTC for an unknown zone', () => {
    const instant = new Date('2026-11-05T01:30:00Z');
    expect(formatDeletionDate(instant, 'America/Sao_Paulo')).toBe('4 de novembro de 2026');
    expect(formatDeletionDate(instant, 'Asia/Tokyo')).toBe('5 de novembro de 2026');
    expect(formatDeletionDate(instant, 'Not/AZone')).toBe('5 de novembro de 2026');
  });

  it('an address with a non-ASCII local part and an internationalised domain reaches the transport untouched', async () => {
    const h = harness([member('a')]);
    h.deps.getAuthUser = async () => ({ email: 'josé.açaí@exemplo-ção.com.br' });
    await runAnonymiseDue(h.deps);
    expect(h.mails[0]?.to).toBe('josé.açaí@exemplo-ção.com.br');
  });
});
