'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isCep } from '@/lib/event-address';
import { type CepAddress, cepAddressSchema } from '@/lib/viacep';

/**
 * Where the lookup stands, for the status line under the CEP (`aria-live="polite"`):
 * - `found`: ViaCEP named the street;
 * - `generic`: a city-wide CEP, with no street and no bairro, so the admin types them;
 * - `not_found`: ViaCEP does not know the CEP; `failed`: no answer (timeout, offline, a 5xx).
 */
export type CepLookupStatus = 'idle' | 'loading' | 'found' | 'generic' | 'not_found' | 'failed';

export type CepLookup = {
  status: CepLookupStatus;
  /**
   * Call with the CEP's digits when they change: the lookup fires on the 8th digit, with no timer,
   * so a pasted CEP fires at once. A shorter value cancels a pending lookup and clears the status;
   * the same digits twice in a row fire nothing. Nothing seeds that memory, so the caller skips
   * digits it already holds (EventForm's `changeCep`), or a restored CEP would be asked again.
   */
  request: (digits: string) => void;
  /** Cancels a pending lookup and forgets the last CEP, so the same digits fire again. */
  reset: () => void;
};

/**
 * PDF item #10: the event form's CEP lookup through `GET /api/cep/{cep}` (the BFF in front of
 * ViaCEP), with ONE `AbortController`: a newer CEP, a `reset` or an unmount aborts the pending
 * request, so a slow answer for an old CEP can never overwrite a newer one.
 *
 * `onFound` receives the validated answer (`cepAddressSchema`) and decides what to fill: the form
 * overwrites rua and bairro only when ViaCEP returned them, always sets cidade and UF, never
 * touches número or complemento, and takes back what an answer wrote once the admin moves to
 * another CEP. The lookup is a convenience and never blocks the save: every failure leaves the
 * fields editable, and the status line says so.
 */
export function useCepLookup(onFound: (address: CepAddress) => void): CepLookup {
  const [status, setStatus] = useState<CepLookupStatus>('idle');
  const lastRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const foundRef = useRef(onFound);
  foundRef.current = onFound;

  useEffect(() => () => controllerRef.current?.abort(), []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    lastRef.current = null;
    setStatus('idle');
  }, []);

  const request = useCallback((digits: string) => {
    if (digits === lastRef.current) return;
    lastRef.current = digits;
    controllerRef.current?.abort();
    controllerRef.current = null;
    if (!isCep(digits)) {
      setStatus('idle');
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus('loading');
    void (async () => {
      try {
        const res = await fetch(`/api/cep/${digits}`, {
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (res.status === 404) {
          setStatus('not_found');
          return;
        }
        const parsed = res.ok ? cepAddressSchema.safeParse(await res.json()) : null;
        if (controller.signal.aborted) return;
        if (!parsed?.success) {
          setStatus('failed');
          return;
        }
        foundRef.current(parsed.data);
        setStatus(parsed.data.street === '' ? 'generic' : 'found');
      } catch {
        // An abort is a newer CEP (or the form leaving), not a failure to report.
        if (!controller.signal.aborted) setStatus('failed');
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    })();
  }, []);

  return { status, request, reset };
}
