# API Coverage — Kiwify (inbound webhooks and webhook management)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.

External service: **Kiwify** (Brazilian checkout / subscription gateway), the first adapter behind the provider-neutral payments seam (D-486). The phase integrates it as an INBOUND webhook receiver only: Kiwify POSTs signed JSON to `POST /v1/webhooks/kiwify/{integrationId}`. There is no outbound call, no SDK and no OAuth client (D-486: "a thin adapter, no vendor client"). The capability surface below is the ten trigger types of Kiwify's `Criar webhook` reference (`docs.kiwify.com.br/api-reference/webhooks/create.md`, fetched 2026-10-20), the payload-level event types the Kiwify webhook page documents for installment accounts, the five webhook-management endpoints listed in `docs.kiwify.com.br/llms.txt`, the OAuth token endpoint those endpoints sit behind, and the delivery-level behaviours (signature, retries, test deliveries).

Decision vocabulary used here. `INTEGRATE`: the adapter maps the capability to a neutral type and effect and the apply job acts on it. `OPT-OUT`: no state change is made for the capability. For the four non-purchase triggers the adapter STILL accepts and records the delivery as an `ignored` inbox event (PAY-33), so the "Eventos recentes" list shows it and Kiwify never retries it; only the access or order effect is opted out.

| capability | decision | reason |
|---|---|---|
| trigger:compra_aprovada | INTEGRATE | approved purchase: grants platform access or creates the order and entitlement; type `purchase_approved`. Observed (vendor test): `paid` with a `Subscription`, so recurring; one-off not observed |
| trigger:compra_reembolsada | INTEGRATE | refund: revokes access or the entitlement; terminal for a one-off order; type `purchase_refunded`. Observed (vendor test): a subscription sale, so a recurring, non-terminal revoke |
| trigger:chargeback | INTEGRATE | chargeback: same effect as a refund; neutral type `chargeback`. Observed 2026-10-21: `Subscription.status` is still `"active"` in the body, so the status cannot decide; the event name does |
| trigger:subscription_late | INTEGRATE | late subscription cuts access at once, no grace (D-496, D-505); type `subscription_late`. Observed: `order_status` is `paid` and Subscription status `waiting_payment`, so the event name decides |
| trigger:subscription_canceled | INTEGRATE | cancel cuts access at the event (D-496; owner decision 2026-10-21, A-P2 option a). Observed: no `customer_access` or `access_until`, so no paid-through date; `CANCEL_EFFECT` stays `suspend` |
| trigger:subscription_renewed | INTEGRATE | renewal returns access, no admin action (D-496); type `subscription_renewed`. OWED: not ticked in the panel, so the fixture is a documented example; capture before production (it alone returns access) |
| trigger:compra_recusada | OPT-OUT | a refused payment is no purchase fact: recorded as `ignored` (`purchase_refused`), no state change. Observed: `order_status` refused, a `card_rejection_reason`, no `Subscription` |
| trigger:boleto_gerado | OPT-OUT | an unpaid boleto grants nothing until `compra_aprovada`: recorded as `ignored` (`boleto_generated`), no state change. Not captured (not ticked in the panel): documented example only |
| trigger:pix_gerado | OPT-OUT | an unpaid pix grants nothing until `compra_aprovada`: recorded as an `ignored` event (`pix_generated`), no state change. Not captured (not ticked in the panel on 2026-10-21): documented example only |
| trigger:carrinho_abandonado | OPT-OUT | an abandoned cart is a marketing signal with no e-mail match and no access meaning: recorded as `ignored` (`cart_abandoned`). Not captured (not ticked in the panel): documented example only |
| payload:scheduled_installment_access_removed | INTEGRATE | Parcelado accounts: mapped to `subscription_late` (suspend) by the adapter, decided from the installment's `customer_access.has_access` (assumed field, confirmed by the capture) |
| payload:scheduled_installment_access_restored | INTEGRATE | Parcelado accounts: mapped to `subscription_renewed` (grant) the same way |
| payload:scheduled_installment_other | OPT-OUT | the remaining `scheduled_installment_*` types (created, cycle paid, settled, overdue, cancelled) do not move access by themselves; recorded as `ignored` (`other`) |
| payload:unknown_shape | OPT-OUT | any payload the Zod schema of the adapter cannot read is recorded as an `ignored` event and still answers 2xx, so a new Kiwify event type never makes Kiwify retry and never fails a delivery |
| delivery:signature_hmac | INTEGRATE | HMAC-SHA1 hex in the `signature` query value, tried over the raw body and the re-serialised JSON, constant-time; mismatch is 403. OWED: no URL or token captured, so the real variant is unknown |
| delivery:retry_idempotency | INTEGRATE | Kiwify retries up to 5 times and carries no event id: the inbox key is the SHA-256 of the raw body per integration, so a retry or a manual "Reenviar" never applies twice |
| delivery:test_webhook | INTEGRATE | the panel's Testar Webhook is an ordinary signed delivery; dummy product ids land as `unknown_product` in Eventos (D-503). Confirmed: each test delivery has a random `product_id`, never a mapped one |
| management:POST /v1/webhooks (Criar webhook) | OPT-OUT | the admin creates the webhook by hand in the Kiwify panel and pastes its token (UI-D-514); automating it needs a per-tenant OAuth client and an outbound call, which D-486 keeps out of this phase |
| management:GET /v1/webhooks (Listar webhooks) | OPT-OUT | same reason: no outbound call; the Pagamentos card shows "Conectado" and the last event received instead |
| management:GET /v1/webhooks/{id} (Consultar webhook) | OPT-OUT | same reason: no outbound call |
| management:PUT /v1/webhooks/{id} (Atualizar webhook) | OPT-OUT | same reason: the admin edits the trigger set in the Kiwify panel |
| management:DELETE /v1/webhooks/{id} (Deletar webhook) | OPT-OUT | same reason; there is also no "Desconectar" action in this phase (UI-SPEC A-UI-4, PU-2) |
| auth:POST /oauth/token (client credentials) | OPT-OUT | needed only by the management endpoints above; no credential of the tenant's Kiwify account is stored beyond the webhook token |
