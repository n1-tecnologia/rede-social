import type { FinancePayload } from '../contracts/finance';

/** RED stub (08.7-09 Task 1): the floor pass is not written yet; it floors nothing. */
// biome-ignore lint/suspicious/noExplicitAny: an inert RED stub
export function applyFinanceFloor(_payload: FinancePayload): any {
  return { byBand: {}, ladder: { paths: [], others: undefined }, neverAgain: {}, revoked: {}, contentSales: {}, eventSales: {}, products: {} };
}
