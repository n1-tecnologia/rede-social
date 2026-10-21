# Capturing real Kiwify deliveries (runbook for plan 09.1-20)

> **Status (2026-10-21): partly executed.** Six of the ten triggers were captured as the vendor's own
> "Testar Webhook" test deliveries, bodies only. The request URL (so the `signature`), the headers, the panel
> token and four triggers (boleto, pix, abandoned cart, renewal) were NOT provided, and no real sale, real
> cancel, late payment or renewal was made. Read the **Results** section at the end before trusting any
> fixture: six are `real-capture (redacted)`, the rest are still `documented-example (synthetic)`.

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
| Which signature variant verifies: raw bytes or re-serialised JSON? | either (A-P17) | **Not answerable**: no request URL, no header and no token were provided. Both stay accepted. |
| Is `Customer.email` lower-case or mixed case as sent? | any case, the adapter lower-cases it | Lower-case in all six (a test value, weak evidence). The adapter still lower-cases. |
| `order_status` values seen | `paid` releases access, any other present value is `other` | `paid`, `refused`, `chargedback`, `refunded`. Confirmed that only `paid` may release access, and that the value disagrees with the event name on purpose in three bodies. |
| `Subscription.status` values seen | not read by the adapter | `active`, `waiting_payment`, `canceled`. Still not read: a chargeback body says `active`. |
| Does a renewal carry a **new** `order_id` and the **same** `Subscription.id`? | same `Subscription.id`, new `order_id` | **Not answerable**: "Assinatura renovada" was not ticked in the panel, so no renewal exists. **Owed.** |
| `has_access` and `access_until` after a **mid-period cancel** | unknown (A-P2) | **Absent**: no body has `Subscription.customer_access`. The cancel body has `Subscription.status: "canceled"`, a future `next_payment` and `order_status: "refunded"`. |
| `has_access` and `access_until` after `subscription_late` | `has_access` false | **Absent** (same reason). The late body has `Subscription.status: "waiting_payment"` and `order_status: "paid"`. |
| Does "Testar Webhook" send dummy product ids? | unknown | **Yes**: a different random `Product.product_id` per delivery, product name "Example product". The product mapping cannot be exercised with them. |
| Is `Commissions.currency` always `BRL` for Brazilian sales? | yes (A-P14) | `BRL` in all six; the test sales are fabricated, so this is weak evidence. |
| Real format of `access_until` and `approved_date` | `YYYY-MM-DD HH:mm`, no timezone, read as UTC-3 (A-P25, A-P28) | `approved_date`, `created_at`, `updated_at`, `refunded_at` are `YYYY-MM-DD HH:mm` with no zone, as assumed. `access_until` never appeared. The `Subscription` dates (`start_date`, `next_payment`, `charges[].created_at`) are ISO-8601 UTC with a `Z`, which the adapter now also reads. |
| Does a re-sent delivery carry identical bytes? | yes, so the inbox dedupes it | **Not answerable** ("Reenviar" was not used). |
| Shape of `ScheduledInstallment` and its `customer_access` (Parcelado accounts only) | assumed | **Not answerable**: none of the six is an instalment event. |
| Is the query string only `signature`? | yes | **Not answerable**: no URL was provided. |

## Decision tree for the cancel semantics (assumption A-P2)

The adapter cuts access immediately on `subscription_canceled`, which is decision D-496 read literally. The
cancel semantics live in ONE constant, `CANCEL_EFFECT` in `packages/core/server/payments/kiwify.ts`.

1. After the mid-period cancel in step 3, read `Subscription.customer_access.has_access` and `access_until`
   in the `subscription_canceled` delivery.
2. If `has_access` is **false** at once: D-496 and the vendor agree. Leave `CANCEL_EFFECT` as `'suspend'`.
3. If `has_access` stays **true** until `access_until`: ask the product owner whether D-496 (cut
   immediately) stays literal, or whether access should be kept until `access_until` and cut then. Record the
   answer in plan 20's summary.
   - Literal D-496: leave `CANCEL_EFFECT` as `'suspend'`. **Chosen on 2026-10-21 (see Results).**
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

## Results

Recorded by plan 09.1-20 on 2026-10-21. No personal data, no token and no signature appear here.

### What was captured

The product owner pasted six request **bodies** from the vendor's "Testar Webhook" and a screenshot of the
webhook's event list. The panel selection was: **ticked** Compra recusada, Compra aprovada, Reembolso,
Chargeback, Assinatura cancelada, Assinatura atrasada; **not ticked** Boleto gerado, Pix gerado, Carrinho
abandonado, Assinatura renovada. The raw bodies were kept outside the repository and never copied into it;
the committed fixtures are the redacted result (every personal and identifying value replaced by a
synthetic one, ids renumbered consistently, key order, key names and value vocabularies untouched, JSON
re-indented, `_fixture` provenance key added). The bodies are the vendor's synthetic test payloads (a
fabricated buyer, random ids), **not** a real sale.

| Trigger | Fixture | Provenance |
|---|---|---|
| Compra aprovada (`order_approved`) | `trigger-compra_aprovada.json` | real-capture (redacted) |
| Reembolso (`order_refunded`) | `trigger-compra_reembolsada.json` | real-capture (redacted) |
| Chargeback (`chargeback`) | `trigger-chargeback.json` | real-capture (redacted) |
| Assinatura atrasada (`subscription_late`) | `trigger-subscription_late.json` | real-capture (redacted) |
| Assinatura cancelada (`subscription_canceled`) | `trigger-subscription_canceled.json` | real-capture (redacted) |
| Compra recusada (`order_rejected`) | `trigger-compra_recusada.json` | real-capture (redacted) |
| Assinatura renovada | `trigger-subscription_renewed.json` | documented-example (synthetic): trigger not ticked |
| Boleto gerado | `trigger-boleto_gerado.json` | documented-example (synthetic): trigger not ticked |
| Pix gerado | `trigger-pix_gerado.json` | documented-example (synthetic): trigger not ticked |
| Carrinho abandonado | `trigger-carrinho_abandonado.json` | documented-example (synthetic): trigger not ticked |
| the three instalment payloads and the unknown shape | `payload-*.json` | documented-example (synthetic): not producible by the test deliveries |

### Answered by the six bodies

- The event names the adapter maps are the ones the vendor sends: `order_approved`, `order_rejected`,
  `order_refunded`, `chargeback`, `subscription_late`, `subscription_canceled`.
- The **event name alone** decides the type. Three bodies disagree with it on purpose: `subscription_late`
  has `order_status: "paid"`, `subscription_canceled` has `"refunded"`, `chargeback` has
  `Subscription.status: "active"`. The adapter already read the type from `webhook_event_type`; the
  tests now pin these three cases.
- `order_status` values `paid`, `refused`, `chargedback`, `refunded`; `Subscription.status` values `active`,
  `waiting_payment`, `canceled`.
- `Subscription.id` equals the top-level `subscription_id`; both are absent on the refused purchase.
- `Commissions.charge_amount` is an integer in cents next to `Commissions.currency` `"BRL"`.
- The customer e-mail arrives lower-case.
- Every approved, late, canceled, refunded and charged-back delivery of the test subscription product carries
  a `Subscription` object, so the adapter reads them as recurring and keys them by the subscription id. A
  **one-off** approval was not observed; the tests derive one by removing the `Subscription` and say so.
- The `Subscription` dates are ISO-8601 UTC (`...Z`) while the order dates are `YYYY-MM-DD HH:mm` with no
  zone. The adapter now places an `access_until` that carries its own zone as written (it was `null` before).

### Not answerable from six test deliveries

- **The signature variant** (raw bytes or re-serialised JSON): no request URL, headers or token were
  provided. The adapter keeps accepting both and logs the matched variant (`variant: raw | reserialised`).
- **Whether a renewal keeps the subscription id with a new order id**: no renewal delivery exists.
- **What `has_access` and `access_until` read** after a mid-period cancel or a late payment: none of the six
  bodies has `Subscription.customer_access`.
- Whether a re-sent delivery carries identical bytes, the instalment event shapes, the query string.
- Anything about a real product: every test delivery carries a different random `Product.product_id`.

### Owed before production is enabled

1. **Tick "Assinatura renovada" in the webhook's trigger list and capture a renewal.** The order-of-events
   policy **returns access on `subscription_renewed`**, and that trigger was not subscribed in the panel:
   without it a subscriber who pays again after a late payment would never get access back. This is the most
   important item.
2. A delivery with its **request URL** (the `signature` value) and headers, plus the panel token held
   privately, to settle the signature variant and tighten `verify` to it.
3. A real (or sandbox) **mid-period cancel** and **late payment**, to see whether the vendor reports
   `Subscription.customer_access` (`has_access`, `access_until`) at all.
4. A real **product id** from the account, to exercise the product mapping.
5. Which figure is **the amount paid**: `Commissions.charge_amount` (read today), the completed charge's own
   `amount`, or `my_commission`. In the two test bodies that carry a completed charge (approved, chargeback)
   its `amount` equals `my_commission` and both are lower than `charge_amount`; the other bodies have no
   completed charge.
6. Boleto, pix and abandoned-cart deliveries (they change nothing, so this is cosmetic), and a **one-off**
   approval, which the test deliveries never produce.

### Cancel semantics (assumption A-P2): decided 2026-10-21, option a

**Keep D-496 literal: a `subscription_canceled` cuts access at the cancel event.** `CANCEL_EFFECT` stays
`'suspend'`; no code changes beyond the tests that pin it. This is the product owner's answer, not an
automatic default. Evidence shown to the owner (no personal data): none of the six bodies carries
`Subscription.customer_access`, `has_access` or `access_until`; the cancel body carries only
`Subscription.status: "canceled"`, a future `next_payment` and `order_status: "refunded"`. There is
therefore no vendor-reported paid-through date to honour. Reopen this only if a real cancel (item 3 above)
shows one and the owner wants access kept until it.

### Observation for the owner (not changed)

The observed refund and chargeback are deliveries of a **subscription** product, so the policy treats them as
*recurring* revokes: non-terminal, and a later renewal returns access. For a one-off sale a refund or
chargeback is terminal. That follows from the policy table of plan 07 and is unchanged here.
