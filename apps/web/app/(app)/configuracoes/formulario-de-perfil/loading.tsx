'use client';

import { Skeleton } from '@rede-social/ui';
import { useSearchParams } from 'next/navigation';
import { parseTab } from './tabs';

/**
 * `/configuracoes/formulario-de-perfil/loading.tsx` (12-15, UI-D-595, E01/E02/E05 loading): ROLE-NEUTRAL,
 * the `PageHeader` bar and the tab row first, so the frame never waits on a body, then the skeleton of the
 * tab the URL asks for: Perguntas (a 104px card and four 88px rows) or Arquivadas (three 88px rows). It
 * reads `?aba=` with the SAME parser the page uses, so the two always agree on the tab. No words: the
 * skeleton says nothing about the page it waits for, and no spinner (`aria-busy` only).
 */
export default function ProfileFormLoading() {
  const tab = parseTab(useSearchParams().get('aba') ?? undefined);
  const rows = tab === 'archived' ? 3 : 4;
  return (
    <div
      aria-busy="true"
      data-profile-form-loading={tab}
      className="mx-auto flex w-full max-w-[680px] flex-col gap-4"
    >
      <Skeleton variant="rect" className="h-12 rounded-none" />
      <Skeleton variant="rect" className="h-11 rounded-none" />
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-0">
        {tab === 'archived' ? null : <Skeleton variant="rect" className="h-[104px]" />}
        {Array.from({ length: rows }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed-length list of identical placeholders
          <Skeleton key={index} variant="rect" className="h-[88px]" />
        ))}
      </div>
    </div>
  );
}
