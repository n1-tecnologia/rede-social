import { Card, Skeleton } from '@rede-social/ui';

/** Widths of the three fixed tab labels, so the row has the shape of "Configuração · Acessos · Eventos". */
const TAB_WIDTHS = [88, 56, 56];
/** The Configuração body draws a three-row list card (UI-D-528). */
const PRODUCT_ROWS = [0, 1, 2];

export interface PaymentsSkeletonProps {
  /**
   * `setup` is the Configuração body (the integration card, a three-row list card and the gate card);
   * `list` is the Acessos / Eventos body (a row list in the row's own geometry).
   */
  variant: 'setup' | 'list';
  /**
   * Draws the page header bar and the tab row first (the route's `loading.tsx`, so the frame never
   * waits on a body). Default on; a tab body's own `Suspense` fallback passes `false`.
   */
  frame?: boolean;
  /** Rows of the `list` variant (default 8, UI-D-528). */
  rows?: number;
}

/** A 40px disc and two text bars: the row anatomy of the products, accesses and events lists. */
function RowSkeleton({ testId }: { testId: string }) {
  return (
    <div data-testid={testId} className="flex min-h-18 items-center gap-3 px-4 py-3">
      <Skeleton variant="circle" className="h-10 w-10" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

/**
 * The loading shape of the Pagamentos screen (UI-D-528, UI-D-531, MOD-02): props-only and wordless.
 * A skeleton says nothing about the page it waits for, so every word, route and clock of the screen
 * stays in `apps/web`. Each block is drawn in its own geometry so a loaded block replaces it without
 * a layout shift.
 */
export function PaymentsSkeleton({ variant, frame = true, rows = 8 }: PaymentsSkeletonProps) {
  return (
    <div
      data-testid="payments-skeleton"
      aria-busy
      className="mx-auto flex w-full max-w-[680px] flex-col"
    >
      {frame ? (
        <>
          <div data-testid="payments-skeleton-header" className="flex items-center gap-2 px-4 py-2">
            <Skeleton variant="circle" className="h-11 w-11" />
            <Skeleton className="h-5 w-32" />
          </div>
          <div className="mb-4 flex gap-2 border-b border-divider px-4">
            {TAB_WIDTHS.map((width, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, static placeholder row.
                key={index}
                data-testid="payments-skeleton-tab"
                className="shrink-0"
              >
                <Skeleton variant="text" width={width} className="my-4 h-4" />
              </div>
            ))}
          </div>
        </>
      ) : null}

      {variant === 'setup' ? (
        <div className="flex flex-col gap-6 px-4 pb-6 md:px-0">
          <Card data-testid="payments-skeleton-integration" className="flex flex-col gap-4 p-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton variant="rect" className="h-11" />
            <Skeleton variant="rect" className="h-11" />
            <Skeleton variant="rect" className="h-11" />
          </Card>
          <Card className="p-0">
            <div className="divide-y divide-divider">
              {PRODUCT_ROWS.map((row) => (
                <RowSkeleton key={row} testId="payments-skeleton-product-row" />
              ))}
            </div>
          </Card>
          <Card data-testid="payments-skeleton-gate" className="flex items-start gap-3 p-4">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
            <div data-skeleton-switch className="shrink-0">
              <Skeleton variant="rect" className="h-6 w-11 rounded-full" />
            </div>
          </Card>
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-4 pb-6 md:px-0">
          <Card className="p-0">
            <div className="divide-y divide-divider">
              {Array.from({ length: rows }, (_, row) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, static placeholder row.
                <RowSkeleton key={row} testId="payments-skeleton-row" />
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
