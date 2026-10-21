import { describe, expect, it } from 'vitest';
import { deterministicIntegrationId, PAYMENTS_ID_NAMESPACE } from '../server/payments/ids';

/**
 * 09.1-09 (D-502, PAY-04): the webhook handle is a name-based UUID (RFC 4122 section 4.3, SHA-1), so
 * the Pagamentos screen can show the URL the admin pastes into the gateway BEFORE any token exists.
 * The pinned vectors below were computed with an independent implementation (Python's
 * `uuid.uuid5(PAYMENTS_ID_NAMESPACE, "<tenant>:<provider>")`), so this file does not merely compare the
 * function with itself.
 */

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

describe('deterministicIntegrationId', () => {
  it('is a valid uuid with version nibble 5 and the RFC variant bits', () => {
    expect(deterministicIntegrationId(TENANT_A, 'fake')).toMatch(UUID_V5);
    expect(deterministicIntegrationId(TENANT_B, 'kiwify')).toMatch(UUID_V5);
  });

  it('matches the RFC 4122 section 4.3 vectors computed outside this codebase', () => {
    expect(PAYMENTS_ID_NAMESPACE).toBe('7d0a4c9e-3b52-4f1a-a6c8-91e5d2b07f34');
    expect(deterministicIntegrationId(TENANT_A, 'fake')).toBe(
      'e9a51ca4-99a2-5773-bd60-8e1d77d07725',
    );
    expect(deterministicIntegrationId(TENANT_A, 'kiwify')).toBe(
      '0751ea72-0fa9-539f-a410-56984bddecd0',
    );
    expect(deterministicIntegrationId(TENANT_B, 'fake')).toBe(
      'a3d1987b-0a56-52ef-b749-38088789ab0c',
    );
  });

  it('is stable across calls', () => {
    expect(deterministicIntegrationId(TENANT_A, 'fake')).toBe(
      deterministicIntegrationId(TENANT_A, 'fake'),
    );
  });

  it('differs for another tenant or another provider, so two tenants never collide', () => {
    const ids = new Set([
      deterministicIntegrationId(TENANT_A, 'fake'),
      deterministicIntegrationId(TENANT_A, 'kiwify'),
      deterministicIntegrationId(TENANT_B, 'fake'),
      deterministicIntegrationId(TENANT_B, 'kiwify'),
    ]);
    expect(ids.size).toBe(4);
  });
});
