# API Coverage — Kiwify (inbound webhooks and webhook management)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.

External service: **Kiwify** (Brazilian checkout / subscription gateway), the first adapter behind the provider-neutral payments seam (D-486). The phase integrates it as an INBOUND webhook receiver only: Kiwify POSTs signed JSON to `POST /v1/webhooks/kiwify/{integrationId}`. There is no outbound call, no SDK and no OAuth client (D-486: "a thin adapter, no vendor client"). The capability surface below is the ten trigger types of Kiwify's `Criar webhook` reference (`docs.kiwify.com.br/api-reference/webhooks/create.md`, fetched 2026-10-20), the payload-level event types the Kiwify webhook page documents for installment accounts, the five webhook-management endpoints listed in `docs.kiwify.com.br/llms.txt`, the OAuth token endpoint those endpoints sit behind, and the delivery-level behaviours (signature, retries, test deliveries).

Decision vocabulary used here. `INTEGRATE`: the adapter maps the capability to a neutral type and effect and the apply job acts on it. `OPT-OUT`: no state change is made for the capability. For the four non-purchase triggers the adapter STILL accepts and records the delivery as an `ignored` inbox event (PAY-33), so the "Eventos recentes" list shows it and Kiwify never retries it; only the access or order effect is opted out.

| capability | decision | reason |
|---|---|---|
| trigger:compra_aprovada | INTEGRATE | approved purchase: grants platform access (access product) or creates the order and entitlement (store product); neutral type `purchase_approved` |
| trigger:compra_reembolsada | INTEGRATE | refund: revokes access or the entitlement; terminal for a one-off order; neutral type `purchase_refunded` |
| trigger:chargeback | INTEGRATE | chargeback: same effect as a refund; neutral type `chargeback` |
| trigger:subscription_late | INTEGRATE | late subscription cuts access immediately with no grace (D-496, D-505); neutral type `subscription_late` |
| trigger:subscription_canceled | INTEGRATE | canceled subscription cuts access immediately (D-496 literal; the cancel-mid-period semantics are decided after the real capture, assumption A-P2); neutral type `subscription_canceled` |
| trigger:subscription_renewed | INTEGRATE | renewed or recovered subscription returns access with no admin action (D-496); neutral type `subscription_renewed` |
| trigger:compra_recusada | OPT-OUT | a refused payment is not a purchase fact: recorded as an `ignored` event (`purchase_refused`), no state change |
| trigger:boleto_gerado | OPT-OUT | an unpaid boleto grants nothing until `compra_aprovada`: recorded as an `ignored` event (`boleto_generated`), no state change |
| trigger:pix_gerado | OPT-OUT | an unpaid pix grants nothing until `compra_aprovada`: recorded as an `ignored` event (`pix_generated`), no state change |
| trigger:carrinho_abandonado | OPT-OUT | an abandoned cart is a marketing signal with no e-mail match rule and no access meaning: recorded as an `ignored` event (`cart_abandoned`), no state change |
| payload:scheduled_installment_access_removed | INTEGRATE | Parcelado accounts: mapped to `subscription_late` (suspend) by the adapter, decided from the installment's `customer_access.has_access` (assumed field, confirmed by the capture) |
| payload:scheduled_installment_access_restored | INTEGRATE | Parcelado accounts: mapped to `subscription_renewed` (grant) the same way |
| payload:scheduled_installment_other | OPT-OUT | the remaining `scheduled_installment_*` types (created, cycle paid, settled, overdue, cancelled) do not move access by themselves; recorded as `ignored` (`other`) |
| payload:unknown_shape | OPT-OUT | any payload the Zod schema of the adapter cannot read is recorded as an `ignored` event and still answers 2xx, so a new Kiwify event type never makes Kiwify retry and never fails a delivery |
| delivery:signature_hmac | INTEGRATE | HMAC-SHA1 hex in the `signature` query parameter, tried over the raw body and over the re-serialised JSON, compared in constant time; mismatch is 403 with nothing stored |
| delivery:retry_idempotency | INTEGRATE | Kiwify retries up to 5 times and carries no event id: the inbox key is the SHA-256 of the raw body per integration, so a retry or a manual "Reenviar" never applies twice |
| delivery:test_webhook | INTEGRATE | the panel's "Testar Webhook" is an ordinary signed delivery; with dummy product ids it lands as `unknown_product` in "Eventos recentes", which is the integration test D-503 asks for |
| management:POST /v1/webhooks (Criar webhook) | OPT-OUT | the admin creates the webhook by hand in the Kiwify panel and pastes its token (UI-D-514); automating it needs a per-tenant OAuth client and an outbound call, which D-486 keeps out of this phase |
| management:GET /v1/webhooks (Listar webhooks) | OPT-OUT | same reason: no outbound call; the Pagamentos card shows "Conectado" and the last event received instead |
| management:GET /v1/webhooks/{id} (Consultar webhook) | OPT-OUT | same reason: no outbound call |
| management:PUT /v1/webhooks/{id} (Atualizar webhook) | OPT-OUT | same reason: the admin edits the trigger set in the Kiwify panel |
| management:DELETE /v1/webhooks/{id} (Deletar webhook) | OPT-OUT | same reason; there is also no "Desconectar" action in this phase (UI-SPEC A-UI-4, PU-2) |
| auth:POST /oauth/token (client credentials) | OPT-OUT | needed only by the management endpoints above; no credential of the tenant's Kiwify account is stored beyond the webhook token |
