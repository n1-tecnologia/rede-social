import { describe, expect, it, vi } from 'vitest';

/**
 * 09.1-15 (PAY-14, PAY-15, D-497, D-499) — `bootstrapRedirectPath` maps a payment cut to the pending
 * screen and leaves every older mapping alone. A pure function of the error: the same input always gives
 * the same path, and nothing in the mapping touches a session (the cut never signs the person out).
 */

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const { ApiClientError, bootstrapRedirectPath } = await import('./bootstrap');

describe('bootstrapRedirectPath: SUBSCRIPTION_PENDING (09.1-15)', () => {
  it('sends a payment cut to /assinatura-pendente with the tenant name as the fallback text', () => {
    const error = new ApiClientError(403, 'SUBSCRIPTION_PENDING', { tenantName: 'Clínica Ana' });
    expect(bootstrapRedirectPath(error)).toBe('/assinatura-pendente?t=Cl%C3%ADnica%20Ana');
  });

  it('reads a missing or non-string name as an empty fallback, never as "undefined"', () => {
    expect(bootstrapRedirectPath(new ApiClientError(403, 'SUBSCRIPTION_PENDING'))).toBe(
      '/assinatura-pendente?t=',
    );
    expect(
      bootstrapRedirectPath(new ApiClientError(403, 'SUBSCRIPTION_PENDING', { tenantName: null })),
    ).toBe('/assinatura-pendente?t=null');
  });

  it('encodes a name that tries to smuggle a second parameter or a path', () => {
    const path = bootstrapRedirectPath(
      new ApiClientError(403, 'SUBSCRIPTION_PENDING', {
        tenantName: 'A&link=https://evil.example/',
      }),
    );
    expect(path).toBe('/assinatura-pendente?t=A%26link%3Dhttps%3A%2F%2Fevil.example%2F');
  });

  it('is a pure function of the error: the same input gives the same path', () => {
    const make = () => new ApiClientError(403, 'SUBSCRIPTION_PENDING', { tenantName: 'Rede Demo' });
    expect(bootstrapRedirectPath(make())).toBe(bootstrapRedirectPath(make()));
  });

  it('keeps the blocked flow and the other mappings exactly as they were', () => {
    expect(
      bootstrapRedirectPath(
        new ApiClientError(403, 'MEMBERSHIP_BLOCKED', { tenantName: 'Rede Demo' }),
      ),
    ).toBe('/auth/blocked?t=Rede%20Demo');
    expect(bootstrapRedirectPath(new ApiClientError(401, 'UNAUTHORIZED'))).toBe('/entrar');
    expect(bootstrapRedirectPath(new ApiClientError(403, 'TENANT_SUSPENDED'))).toBe(
      '/auth/suspended',
    );
    expect(bootstrapRedirectPath(new ApiClientError(403, 'TENANT_HOST_MISMATCH'))).toBe(
      '/participar',
    );
    expect(bootstrapRedirectPath(new ApiClientError(403, 'FORBIDDEN'))).toBeNull();
  });
});
