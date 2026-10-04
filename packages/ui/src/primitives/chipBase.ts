/**
 * Same geometry for Chip and StatusPill (UI-SPEC: rounded-full px-3.5 py-1.5 text-12/700).
 *
 * Kept OUT of Chip.tsx on purpose (PDF item #9). Chip.tsx is a 'use client' module, and in the RSC
 * graph Next replaces EVERY export of a client module with a client-reference function. A Server
 * Component that imports a VALUE from there gets that function instead of the value, and `cn()`
 * drops it without a word, because clsx keeps only strings, numbers and objects. That is how every
 * server-rendered StatusPill (event header "Cancelado", community "Arquivada", tenant status, the
 * old settings "Em breve") shipped its tone alone: square, flush, 16px regular. This module carries
 * no directive, so the server graph and the client graph both import the real string.
 *
 * Never re-export it from Chip.tsx (that arms the trap again). `tests/client-boundary.test.ts`
 * fails when a 'use client' module of this package exports anything but functions and React
 * element types.
 */
export const chipBase =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors';
