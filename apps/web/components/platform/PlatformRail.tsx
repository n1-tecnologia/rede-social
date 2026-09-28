'use client';

import { Button, cn, IconButton } from '@rede-social/ui';
import { Building2, LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export interface PlatformRailProps {
  labels: { brand: string; title: string; tenants: string; logout: string; nav: string };
  signOutAction: () => Promise<void>;
  /** Bottom-group slot for the kernel `ThemeToggle` (mounted by 02-16); empty until then. */
  themeSlot?: ReactNode;
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * The panel's navigation chrome (D-33 mockup `tenant-list` / `platform-shell-mobile`): a sticky
 * 240 px rail on desktop (wordmark, "Tenants", theme slot, "Sair") and a 48 px top bar on the phone
 * (wordmark, Tenants chip, sign-out icon). Always the neutral platform brand — the panel never wears a
 * tenant's colours. Strings arrive as props (PWA-03); icons are decorative.
 */
export function PlatformRail({ labels, signOutAction, themeSlot }: PlatformRailProps) {
  const pathname = usePathname();
  const tenantsActive = pathname.startsWith('/plataforma');

  return (
    <>
      <aside className="hidden border-r border-border bg-bg-secondary px-3 py-6 md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col">
        <div className="flex h-12 flex-col justify-center px-3">
          <span className="text-base font-bold tracking-[-0.02em] text-text">{labels.brand}</span>
          <span className="text-xs text-text-tertiary">{labels.title}</span>
        </div>
        <nav aria-label={labels.nav} className="mt-6 flex flex-col gap-1">
          <Link
            href="/plataforma"
            aria-current={tenantsActive ? 'page' : undefined}
            className={cn(
              'flex h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors',
              tenantsActive
                ? 'bg-brand-soft font-bold text-brand'
                : 'text-text-secondary hover:bg-bg-hover',
              focusRing,
            )}
          >
            <Building2 aria-hidden size={22} />
            {labels.tenants}
          </Link>
        </nav>
        <div className="mt-auto flex flex-col gap-1">
          {themeSlot}
          <form action={signOutAction}>
            <Button
              type="submit"
              variant="ghost"
              className="h-11 w-full justify-start gap-3 px-3 text-sm text-text-secondary"
            >
              <LogOut aria-hidden size={22} />
              {labels.logout}
            </Button>
          </form>
        </div>
      </aside>

      <header className="sticky top-0 z-40 flex h-12 items-center justify-between bg-bg/95 px-4 backdrop-blur-sm md:hidden">
        <span className="text-base font-bold tracking-[-0.02em] text-text">{labels.brand}</span>
        <div className="flex items-center gap-1">
          <Link
            href="/plataforma"
            aria-current={tenantsActive ? 'page' : undefined}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-bold transition-colors',
              tenantsActive ? 'bg-brand-soft text-brand' : 'bg-bg-input text-text-secondary',
              focusRing,
            )}
          >
            <Building2 aria-hidden size={16} />
            {labels.tenants}
          </Link>
          <form action={signOutAction}>
            <IconButton type="submit" icon={LogOut} label={labels.logout} />
          </form>
        </div>
      </header>
    </>
  );
}
