import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 12 review WR-01: `exportAnswers` refuses every role but `admin_tenant` BEFORE anything is read or
 * logged, even if a future caller skips the route guard. The transaction helpers are mocked, so a refusal is
 * proven by `withTenantTx` / `withAdminTx` never being entered.
 */
const withTenantTx = vi.fn();
const withAdminTx = vi.fn();
vi.mock('../db/tenant-tx', () => ({ withTenantTx: (...args: unknown[]) => withTenantTx(...args) }));
vi.mock('../db/admin-tx', () => ({ withAdminTx: (...args: unknown[]) => withAdminTx(...args) }));

import { ApiError } from '../server/http/api-error';
import { exportAnswers } from '../server/profile-form/export';

const base = {
  userId: '22222222-2222-4222-8222-222222222222',
  tenantId: '11111111-1111-4111-8111-111111111111',
  requestId: 'req-1',
};

describe('exportAnswers: role guard (WR-01)', () => {
  beforeEach(() => {
    withTenantTx.mockReset();
    withAdminTx.mockReset();
  });

  for (const role of ['support_tenant', 'member'] as const) {
    it(`refuses a ${role} caller with 403 FORBIDDEN before any read or audit row`, async () => {
      const error = await exportAnswers({ ...base, role }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(403);
      expect((error as ApiError).code).toBe('FORBIDDEN');
      expect(withTenantTx).not.toHaveBeenCalled();
      expect(withAdminTx).not.toHaveBeenCalled();
    });
  }

  it('lets an admin_tenant caller through to the first transaction', async () => {
    withTenantTx.mockRejectedValueOnce(new Error('reached'));
    await expect(exportAnswers({ ...base, role: 'admin_tenant' })).rejects.toThrow('reached');
    expect(withTenantTx).toHaveBeenCalledTimes(1);
  });
});
