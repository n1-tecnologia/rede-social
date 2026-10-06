import { describe, expect, it } from 'vitest';
import { ApiError } from '../server/http/api-error';
import { registeredJobQueues } from '../server/jobs/boss';
import {
  classifyInviteSendError,
  INVITE_SEND_DELAY_S,
  INVITE_SEND_QUEUE,
  inviteSendDelaySeconds,
  inviteSendJobOptions,
  inviteSendPayloadSchema,
} from '../server/platform/invite-send';

/**
 * `kernel.invite-send` (quick 260929-g0s) — the deferred, idempotent, retrying first-admin invite.
 * Unit level only (no DB): the delay per allow-list adapter, the exact pg-boss options the scheduler
 * hands `enqueueInTx`, the retry/terminal classification of a failed send, the payload shape (ids
 * only — never the e-mail address, T-g0s-03) and the queue self-registration at import.
 */

const INVITE_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';

describe('kernel.invite-send — scheduling options', () => {
  it('waits the Supabase Auth propagation window only when the allow-list is the real one', () => {
    expect(INVITE_SEND_DELAY_S).toBe(60);
    expect(inviteSendDelaySeconds('supabase')).toBe(60);
    expect(inviteSendDelaySeconds('local')).toBe(0);
  });

  it('keys the job on the invite id and carries the bounded exponential retry', () => {
    expect(inviteSendJobOptions(INVITE_ID, 60)).toEqual({
      singletonKey: INVITE_ID,
      startAfter: 60,
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      retryDelayMax: 600,
    });
  });

  it('registers its queue at import so the API lazy boss creates it before the first send', () => {
    expect(INVITE_SEND_QUEUE).toBe('kernel.invite-send');
    expect(registeredJobQueues()).toContain(INVITE_SEND_QUEUE);
  });
});

describe('kernel.invite-send — error classification', () => {
  it('an identity refusal is terminal and names its cause', () => {
    expect(
      classifyInviteSendError(
        new ApiError(409, 'INVITE_STATE_INVALID', { reason: 'email_in_use' }),
      ),
    ).toEqual({ retry: false, lastError: 'invite:email_in_use' });
    // 08.1-06 (D-314): an existing identity already active here is a fact too, never retried.
    expect(
      classifyInviteSendError(
        new ApiError(409, 'INVITE_STATE_INVALID', { reason: 'already_accepted' }),
      ),
    ).toEqual({ retry: false, lastError: 'invite:already_accepted' });
  });

  it('a GoTrue/hook failure or any other error is retried', () => {
    expect(classifyInviteSendError(new ApiError(500, 'INTERNAL'))).toEqual({
      retry: true,
      lastError: 'invite',
    });
    expect(classifyInviteSendError(new Error('connection reset'))).toEqual({
      retry: true,
      lastError: 'invite',
    });
  });
});

describe('kernel.invite-send — payload', () => {
  it('accepts ids only and rejects a missing inviteId or a non-uuid tenantId', () => {
    expect(
      inviteSendPayloadSchema.safeParse({ tenantId: TENANT_ID, inviteId: INVITE_ID }).success,
    ).toBe(true);
    expect(inviteSendPayloadSchema.safeParse({ tenantId: TENANT_ID }).success).toBe(false);
    expect(
      inviteSendPayloadSchema.safeParse({ tenantId: 'nope', inviteId: INVITE_ID }).success,
    ).toBe(false);
  });
});
