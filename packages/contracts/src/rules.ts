import { z } from 'zod';

/**
 * The tenant's community rules as the admin edits them (ADMIN-03, D-341, UI-D-280).
 *
 * CLIENT-SAFE on purpose: `legal.ts` reads the platform's legal markdown through `node:fs`, so the
 * rules editor (a client component) imports this file through `@rede-social/contracts/rules`, and
 * `legal.ts` re-exports it for the server consumers of the package root.
 *
 * The text is plain text: paragraphs are separated by a blank line and a single line break inside a
 * paragraph is kept (`RulesText`, UI-D-281). That is exactly how `/cadastro` renders it, so the
 * stored value needs no markup and has no raw-HTML path (T-08-38).
 */

/** The cap, in UTF-16 code units after normalisation — the same unit as the field's `maxLength`. */
export const RULES_TEXT_MAX = 10000;

/** The refusal codes a rules body can produce, carried as `details.rulesText`. */
export const RULES_ISSUES = ['required', 'too_long'] as const;
export type RulesIssue = (typeof RULES_ISSUES)[number];

/**
 * ADMIN-03 encoding (explicit): CRLF and a lone CR become LF, then leading and trailing whitespace is
 * trimmed. The server compares and stores THIS value, so a Windows paste of identical text is the
 * same text and bumps nothing; the editor compares its draft through the same function, so the save
 * stays disabled for it.
 */
export function normaliseRulesText(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

/** `value.length` is UTF-16 code units (an emoji is two), which is what `maxLength` counts too. */
const withinCodeUnits = (value: string) => value.length <= RULES_TEXT_MAX;

/**
 * `PUT /v1/admin/rules` body. Normalised in a `preprocess` and only THEN checked, so the checks see
 * the stored value: empty or whitespace-only is `required`, more than `RULES_TEXT_MAX` code units is
 * `too_long`. Strict: no other key (a tenant id, a version) is accepted.
 */
export const rulesBodySchema = z
  .object({
    rulesText: z.preprocess(
      (value) => (typeof value === 'string' ? normaliseRulesText(value) : value),
      z
        .string()
        .refine((value) => value.length > 0, 'required')
        .refine(withinCodeUnits, 'too_long'),
    ),
  })
  .strict();
export type RulesBody = z.infer<typeof rulesBodySchema>;

/** `GET` / `PUT /v1/admin/rules` answer: the stored text and the version new consents point at. */
export const adminRulesSchema = z
  .object({
    rulesText: z.string(),
    rulesVersion: z.number().int().positive(),
  })
  .strict();
export type AdminRules = z.infer<typeof adminRulesSchema>;
