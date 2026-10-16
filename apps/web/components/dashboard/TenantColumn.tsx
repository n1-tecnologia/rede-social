import type { ReactNode } from 'react';

/**
 * The owner panel's column, at the content's whole width at every size: the header, the area tabs
 * and the area, one under the other. The area arranges its own wide layout (`AREA_GRID`) from its
 * `@container`.
 */
export function TenantColumn({ children }: { children: ReactNode }) {
  return <div className="flex w-full flex-col gap-6">{children}</div>;
}
