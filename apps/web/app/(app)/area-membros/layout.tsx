import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireBootstrap } from '@/lib/bootstrap';

/**
 * The module gate for `/area-membros` (quick 261019-k7x, 2026-10-19): the member side of the school
 * area, split out of `/cursos`. The same single check as `cursos/layout.tsx`: `courses` must be in
 * `bootstrap.modules`, else the kernel's generic not-found for every role (nothing about the school
 * leaks when it is off). `requireBootstrap` is React-cached, and reading it keeps the segment dynamic
 * (`scripts/check-static-routes.sh`).
 */
export default async function MemberAreaLayout({ children }: { children: ReactNode }) {
  const bootstrap = await requireBootstrap();
  if (!bootstrap.modules.some((module) => module.key === 'courses')) notFound();
  return children;
}
