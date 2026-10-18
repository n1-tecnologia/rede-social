/**
 * RED STUB (08.7-01 Task 3 TDD): deliberately inert — registration validates nothing and records
 * nothing, and the singleton key is empty, so `tests/daily-dispatch.test.ts` fails on its
 * assertions. The GREEN commit replaces this file whole.
 */
export function registerDailyTenantJobs(_names: readonly string[]): void {}

export function registeredDailyTenantJobs(): string[] {
  return [];
}

export function dailyTenantSingletonKey(_tenantId: string, _day: string): string {
  return '';
}
