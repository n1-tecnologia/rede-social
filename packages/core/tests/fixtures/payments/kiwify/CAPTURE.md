# Capturing real Kiwify deliveries (runbook for plan 09.1-20)

The adapter `packages/core/server/payments/kiwify.ts` and the fixtures in this folder were built from the
vendor's public documentation ("Webhooks (pt-br)") and synthetic data. No real delivery has been observed.
This runbook replaces the synthetic fixtures with redacted real captures and settles the open questions.
Every outcome is an edit to `kiwify.ts` and to this folder, and to nothing else.

## Prerequisites

- A Kiwify account owned by the user, with permission to create webhooks and products.
- A webhook inspector URL (for example `https://webhook.site`) that shows the raw body, the full request
  URL with its query string, and the headers of each request. Create it before step 1.
- **The capture sink is the inspector, never this system.** Do not point the webhook at the API, the
  homolog environment or any database while capturing: the raw bodies carry personal data and the
  `signature` query value, and this system deliberately stores neither (PR-9).
- Two throwaway products on the account: one **recurring** access product (a monthly plan) and one
  **one-off** product, both with a very low price.
- A throwaway buyer e-mail you control, with mixed case in its local part (for example `Teste.Captura@...`)
  so the casing question below can be answered.

## Step 1. Create the webhook in the vendor panel

1. In the Kiwify panel create a webhook pointing at the inspector URL, for all products.
2. Select all ten triggers: `compra_aprovada`, `compra_reembolsada`, `chargeback`, `subscription_late`,
   `subscription_canceled`, `subscription_renewed`, `compra_recusada`, `boleto_gerado`, `pix_gerado`,
   `carrinho_abandonado`.
3. Note the **token** the panel shows (it is shown when the webhook is created or edited). It is the HMAC
   key. Keep it in the user's private store; do not paste it into the repository, a ticket or a log.

## Step 2. Fire "Testar Webhook" once per trigger

For each of the ten triggers use the panel's "Testar Webhook" and save, from the inspector:

- the **raw body bytes** exactly as shown (use the inspector's "raw" view, not a pretty-printed one);
- the **full request URL including the query string**, which carries the `signature` value, and any other
  query parameter the vendor appends;
- the **request headers** (content type, user agent, anything that looks like a delivery or retry id).

Write down whether the test deliveries carry **dummy product ids** (then the mapping test in plan 20 needs a
real product to map).

## Step 3. Make real, small deliveries

1. Buy the one-off product once (pix is the cheapest). Save the `compra_aprovada` delivery.
2. Buy the recurring product once. Save `compra_aprovada` and any other delivery it triggers.
3. **Cancel the subscription in the middle of the paid period.** Save the `subscription_canceled` delivery.
4. Let a charge fail, or simulate a late payment, and save `subscription_late`.
5. Let a charge recover or renew, and save `subscription_renewed`.
6. Refund the one-off purchase and save `compra_reembolsada`. A chargeback cannot be forced; keep the test
   delivery from step 2.
7. Resend one delivery from the panel ("Reenviar") and note whether the bytes are identical.

Save every delivery, including the ones the adapter does not use.

## Step 4. Redact personal data

For every saved body, replace the personal values and keep every key and every value type:

- name, first name, CPF, CNPJ, phone, address fields, IP address and the e-mail local part;
- the e-mail domain may stay `example.com`.

Keep the **original, unredacted bytes only in the user's private store**; the redacted copy is the fixture.
Keep the `signature` value and the token out of the repository entirely.

## Step 5. Turn the captures into fixtures

Replace the synthetic files in this folder. The names are the capability ids of
`.planning/phases/09.1-acesso-por-gateway-de-pagamento/COVERAGE.md` with the colon replaced by a hyphen
(`trigger-compra_aprovada.json`, `payload-scheduled_installment_access_removed.json`, ...). Keep the
`_fixture` key and change its text to name the capture date and "redacted capture". If a capture exposes a
shape the matrix has no row for, add the row to `COVERAGE.md` and a fixture of the matching name: the
coverage test fails until both exist.

## Step 6. Learn which signature variant is real

Run the adapter tests with the real bytes and the real token (a throwaway local test, not committed):
`kiwifyGateway.verify({ rawBody, signature, secret })` returns `'raw'` or `'reserialised'` for the
variant that matched, or throws. Record the answer. If neither matches, the signed material is neither
candidate: add the third candidate in `signatureCandidates` and re-run.

## Step 7. Record the answers

Fill this table in plan 20's summary and edit `kiwify.ts` where an answer differs from the assumption.

| Question | Assumption carried | Answer from the capture |
|---|---|---|
| Which signature variant verifies: raw bytes or re-serialised JSON? | either (A-P17) | |
| Is `Customer.email` lower-case or mixed case as sent? | any case, the adapter lower-cases it | |
| `order_status` values seen | `paid` releases access, any other present value is `other` | |
| `Subscription.status` values seen | not read by the adapter | |
| Does a renewal carry a **new** `order_id` and the **same** `Subscription.id`? | same `Subscription.id`, new `order_id` | |
| `has_access` and `access_until` after a **mid-period cancel** | unknown (A-P2) | |
| `has_access` and `access_until` after `subscription_late` | `has_access` false | |
| Does "Testar Webhook" send dummy product ids? | unknown | |
| Is `Commissions.currency` always `BRL` for Brazilian sales? | yes (A-P14) | |
| Real format of `access_until` and `approved_date` | `YYYY-MM-DD HH:mm`, no timezone, read as UTC-3 (A-P25, A-P28) | |
| Does a re-sent delivery carry identical bytes? | yes, so the inbox dedupes it | |
| Shape of `ScheduledInstallment` and its `customer_access` (Parcelado accounts only) | assumed | |
| Is the query string only `signature`? | yes | |

## Decision tree for the cancel semantics (assumption A-P2)

The adapter cuts access immediately on `subscription_canceled`, which is decision D-496 read literally. The
cancel semantics live in ONE constant, `CANCEL_EFFECT` in `packages/core/server/payments/kiwify.ts`.

1. After the mid-period cancel in step 3, read `Subscription.customer_access.has_access` and `access_until`
   in the `subscription_canceled` delivery.
2. If `has_access` is **false** at once: D-496 and the vendor agree. Leave `CANCEL_EFFECT` as `'suspend'`.
3. If `has_access` stays **true** until `access_until`: ask the product owner whether D-496 (cut
   immediately) stays literal, or whether access should be kept until `access_until` and cut then. Record the
   answer in plan 20's summary.
   - Literal D-496: leave `CANCEL_EFFECT` as `'suspend'`.
   - Keep until the paid period ends: change the line in `toNeutral` that uses `CANCEL_EFFECT` so the effect
     is derived from `has_access` (`grant` while it is true with `validUntil` set, `suspend` once it is
     false), and update the `trigger-subscription_canceled` expectation in `payments-kiwify.test.ts`.
4. Either way the edit is the `CANCEL_EFFECT` constant and its mapping in `kiwify.ts`. Nothing outside that
   file changes.

## When the capture is done

- `pnpm --filter @rede-social/core test` is green with the real fixtures.
- The old synthetic fixtures are gone and every `_fixture` key says "redacted capture".
- The "Assumptions carried" list at the top of `kiwify.ts` is shortened to what is still unconfirmed.
- No token, no signature and no unredacted body is in the repository.
