/**
 * The client owner's areas on the member report's grid: one column on a phone, two from a 56rem
 * container, four from 100rem. Each area's top-level blocks are its cells, in source order, and
 * stretch to the row's height.
 */
export const AREA_GRID =
  'flex flex-col gap-6 @4xl:grid @4xl:grid-cols-2 @4xl:items-stretch @min-[100rem]:grid-cols-4';

/** A block that reads across the whole area: its tabs, a KPI row, a wide chart, list or table. */
export const SPAN_ALL = '@4xl:col-span-full';

/** A block two cells wide: the whole row at two columns, half of it at four (a chart, a long list). */
export const SPAN_HALF = '@4xl:col-span-2';
