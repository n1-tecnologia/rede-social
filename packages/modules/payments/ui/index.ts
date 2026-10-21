/**
 * The payments module's props-only UI (MOD-02, UI-D-531): every word, route and clock arrives from
 * `apps/web`, and nothing here imports another module. 09.1-13 ships the skeleton; the row and pill
 * components of the Acessos and Eventos tabs follow in plan 14.
 */
export { PaymentsSkeleton, type PaymentsSkeletonProps } from './PaymentsSkeleton';
