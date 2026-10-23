'use client';

import { Chip, Input, useDebounce } from '@rede-social/ui';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

export interface TenantToolbarProps {
  q?: string;
  status?: 'active' | 'suspended';
  /** `?banco=problema` (09.2-20, UI-D-540): one chip of the same single-select row as `status`. */
  banco?: 'problema';
  /** Only when the URL carried an explicit `limit` — the server default is never echoed. */
  limit?: number;
}

type ChipFilter = { status?: 'active' | 'suspended'; banco?: 'problema' };

function listUrl(params: { q?: string; limit?: number } & ChipFilter): string {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.status) search.set('status', params.status);
  if (params.banco) search.set('banco', params.banco);
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return qs ? `/plataforma?${qs}` : '/plataforma';
}

/**
 * Search + filter chips of the tenant list (UI-SPEC toolbar). The input is debounced 300 ms and
 * written to `?q=` with `router.replace` (status, banco and limit preserved, `cursor` dropped); the
 * chips are links carrying `?status=` or `?banco=problema` with `q` preserved. The four chips are ONE
 * single-select row (UI-D-540): each link carries only its own filter, so selecting one clears the
 * other and "Todos" clears both. The values arrive as props from the server
 * page — the toolbar never reads the URL through the client search-params hook (no Suspense
 * bailout) — and every filter is applied by the API, never in the browser.
 */
export function TenantToolbar({ q = '', status, banco, limit }: TenantToolbarProps) {
  const t = useTranslations('platform');
  const router = useRouter();
  const [value, setValue] = useState(q);
  const debounced = useDebounce(value, 300);

  useEffect(() => {
    const next = debounced.trim();
    if (next === q) return;
    router.replace(listUrl({ q: next || undefined, status, banco, limit }));
  }, [debounced, q, status, banco, limit, router]);

  const chips: ({ key: string; label: string } & ChipFilter)[] = [
    { key: 'all', label: t('list.filterAll') },
    { key: 'active', label: t('list.filterActive'), status: 'active' },
    { key: 'suspended', label: t('list.filterSuspended'), status: 'suspended' },
    { key: 'database', label: t('list.filterDatabaseProblem'), banco: 'problema' },
  ];

  return (
    <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center">
      <Input
        id="q"
        name="q"
        type="search"
        icon={Search}
        aria-label={t('list.searchLabel')}
        placeholder={t('list.searchPlaceholder')}
        autoComplete="off"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        containerClassName="md:max-w-[360px] md:flex-1"
      />
      <nav className="flex flex-wrap gap-2" aria-label={t('list.filterLabel')}>
        {chips.map((chip) => (
          <Chip
            key={chip.key}
            href={listUrl({ q: q || undefined, status: chip.status, banco: chip.banco, limit })}
            active={(status ?? undefined) === chip.status && (banco ?? undefined) === chip.banco}
          >
            {chip.label}
          </Chip>
        ))}
      </nav>
    </div>
  );
}
