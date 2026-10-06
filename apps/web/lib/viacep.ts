import { z } from 'zod';
import { ADDRESS_CAPS, cepDigits, UFS } from './event-address';

/**
 * PDF item #10: the ViaCEP lookup (https://viacep.com.br), in two halves that share this module.
 * The route handler `app/api/cep/[cep]/route.ts` asks ViaCEP and reads the answer with
 * `readViaCep`; the form's `useCepLookup` reads the route's answer back with `cepAddressSchema`.
 * Both sides validate, so a drift on either end is a refused shape, never a half-filled form.
 *
 * What ViaCEP answers (checked with curl, 2026-10-02):
 *  - a known CEP: 200 with `cep` ("01310-200"), `logradouro`, `complemento`, `unidade`, `bairro`,
 *    `localidade`, `uf` and fiscal codes. A city-wide CEP (one per small municipality) has an EMPTY
 *    `logradouro` and `bairro`;
 *  - an unknown CEP: 200 with `{ "erro": "true" }`, the flag a STRING (`true` is accepted too, in
 *    case they ever fix it);
 *  - a malformed CEP: 400 (the route never asks one: it refuses anything but 8 digits first).
 *
 * `complemento` is a note about the CEP's RANGE ("de 1512 a 2132 - lado par" for 01310-200), not
 * the venue's complement, so it is dropped here together with `unidade`: it must never prefill the
 * form's Complemento.
 */

/** The upstream budget: past it the route answers 502 and the admin types the address. */
export const VIACEP_TIMEOUT_MS = 4_000;

/** The ONE upstream URL. The host is fixed and the path is 8 digits the route already checked. */
export const viaCepUrl = (cep: string): string => `https://viacep.com.br/ws/${cep}/json/`;

/** What `GET /api/cep/{cep}` answers on a 200, with every part inside the form's caps. */
export const cepAddressSchema = z
  .object({
    cep: z.string().regex(/^\d{8}$/),
    street: z.string().max(ADDRESS_CAPS.street),
    district: z.string().max(ADDRESS_CAPS.district),
    city: z.string().min(1).max(ADDRESS_CAPS.city),
    state: z.enum(UFS),
  })
  .strict();
export type CepAddress = z.infer<typeof cepAddressSchema>;

/** ViaCEP's unknown CEP. */
const viaCepNotFoundSchema = z.object({ erro: z.union([z.literal(true), z.literal('true')]) });

/** ViaCEP's address: only the keys the form uses are read; every other key is ignored. */
const viaCepFoundSchema = z.object({
  cep: z.string(),
  logradouro: z.string().trim().default(''),
  bairro: z.string().trim().default(''),
  localidade: z.string().trim().min(1),
  uf: z.enum(UFS),
});

export type ViaCepAnswer = { kind: 'found'; address: CepAddress } | { kind: 'not_found' };

/**
 * ViaCEP's JSON → the route's answer, or `null` for a shape this module does not know (the
 * route's 502). Each part is cut to its cap, so a long `logradouro` can never push the composed
 * address past the contract's 300.
 */
export function readViaCep(body: unknown): ViaCepAnswer | null {
  if (viaCepNotFoundSchema.safeParse(body).success) return { kind: 'not_found' };
  const found = viaCepFoundSchema.safeParse(body);
  if (!found.success) return null;
  const cep = cepDigits(found.data.cep);
  if (cep.length !== 8) return null;
  return {
    kind: 'found',
    address: {
      cep,
      street: found.data.logradouro.slice(0, ADDRESS_CAPS.street),
      district: found.data.bairro.slice(0, ADDRESS_CAPS.district),
      city: found.data.localidade.slice(0, ADDRESS_CAPS.city),
      state: found.data.uf,
    },
  };
}
