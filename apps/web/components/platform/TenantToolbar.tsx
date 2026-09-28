'use client';

import { Chip, Input, useDebounce } from '@rede-social/ui';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

export interface TenantToolbarProps {
  q?: string;
  status?: 'active' | 'suspended';
  /** Only when the URL carried an explicit `limit` — the server default is never echoed. */
  limit?: number;
}

function listUrl(params: { q?: string; status?: string; limit?: number }): string {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.status) search.set('status', params.status);
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return qs ? `/plataforma?${qs}` : '/plataforma';
}

/**
 * Search + status chips of the tenant list (UI-SPEC toolbar). The input is debounced 300 ms and
 * written to `?q=` with `router.replace` (status and limit preserved, `cursor` dropped); the chips
 * are links carrying `?status=` with `q` preserved. The values arrive as props from the server
 * page — the toolbar never reads the URL through the client search-params hook (no Suspense
 * bailout) — and every filter is applied by the API, never in the browser.
 */
export function TenantToolbar({ q = '', status, limit }: TenantToolbarProps) {
  const t = useTranslations('platform');
  const router = useRouter();
  const [value, setValue] = useState(q);
  const debounced = useDebounce(value, 300);

  useEffect(() => {
    const next = debounced.trim();
    if (next === q) return;
    router.replace(listUrl({ q: next || undefined, status, limit }));
  }, [debounced, q, status, limit, router]);

  const chips: { key: string; label: string; status?: 'active' | 'suspended' }[] = [
    { key: 'all', label: t('list.filterAll') },
    { key: 'active', label: t('list.filterActive'), status: 'active' },
    { key: 'suspended', label: t('list.filterSuspended'), status: 'suspended' },
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
      <nav className="flex gap-2" aria-label={t('list.filterLabel')}>
        {chips.map((chip) => (
          <Chip
            key={chip.key}
            href={listUrl({ q: q || undefined, status: chip.status, limit })}
            active={(status ?? undefined) === chip.status}
          >
            {chip.label}
          </Chip>
        ))}
      </nav>
    </div>
  );
}
