# Phase 12: Formulário de perfil do tenant - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-29
**Phase:** 12-formulario-de-perfil-do-tenant
**Areas discussed:** Como o formulário aparece, Quando pedir de novo, Tipos de pergunta, Quem vê as respostas

---

## Como o formulário aparece

### Onde um membro novo responde

| Option | Description | Selected |
|--------|-------------|----------|
| Logo depois do login, na tela de completar perfil | Same screen the existing member uses; sign-up unchanged; e-mail verification does not interfere | ✓ |
| Dentro da tela de cadastro | Answers before the account exists; touches both sign-up doors and must hold answers before e-mail verification | |
| Você decide | Claude picks the simpler | |

**User's choice:** After login, on the complete-profile screen (D-580).

### O que o membro consegue fazer sem responder

| Option | Description | Selected |
|--------|-------------|----------|
| Nada: fica só no formulário | Like the payment cut; every route sends back to the form; sign-out stays | ✓ |
| Navega, mas vê um aviso fixo | App opens with a banner; can be ignored forever | |
| Trava só por um tempo | Warning for some days then lock; admin would pick the deadline | |

**User's choice:** Hard gate (D-581).

### Como as perguntas aparecem

| Option | Description | Selected |
|--------|-------------|----------|
| Todas numa tela rolável | One list with Save at the end; same screen for first time, return and edit | ✓ |
| Uma pergunta por vez | Step-by-step with progress bar | |
| Em grupos (seções) | Admin groups questions; adds a concept to the builder | |

**User's choice:** One scrollable screen (D-582).

### Para onde o membro vai depois de salvar

| Option | Description | Selected |
|--------|-------------|----------|
| Para onde ele estava indo | Return to the link opened (notification, share); else Início | ✓ |
| Sempre para o Início | Simpler; the opened link is lost | |

**User's choice:** Return to the intended destination (D-583). **Notes:** Claude added the open-redirect constraint (same-origin relative path only).

### O formulário vale para quem

| Option | Description | Selected |
|--------|-------------|----------|
| Só para membros | Admin, support and super_admin never gated | ✓ |
| Para todos os papéis do tenant | Admin and support also answer | |
| Admin escolhe por pergunta | Per-question role targeting | |

**User's choice:** Members only (D-584).

---

## Quando pedir de novo

### Pergunta obrigatória nova num formulário existente

| Option | Description | Selected |
|--------|-------------|----------|
| Todos voltam, respondem só a nova | Completeness computed from the rules; no version counter; old answers kept | ✓ |
| Todos voltam e respondem tudo | Redo everything | |
| Só membros novos | Members who completed are not asked again | |

**User's choice:** Everyone returns and answers only what is missing (D-585).

### Pergunta opcional nova

| Option | Description | Selected |
|--------|-------------|----------|
| Não trava; aviso no perfil | Dismissible "Há perguntas novas", like today's completeness card | ✓ |
| Mostra a tela uma vez, dá para pular | One-time screen with "Agora não" | |
| Trata igual à obrigatória | Everyone returns, can save blank | |

**User's choice:** No gate, dismissible notice on the profile (D-586).

### Admin muda uma pergunta que já tem respostas

| Option | Description | Selected |
|--------|-------------|----------|
| Texto livre muda sempre; tipo e opções travam | Add options allowed; type change or removing an answered option = new question + archive old | ✓ |
| Pode mudar tudo; respostas que não servem são descartadas | Silent data loss | |
| Pode mudar; respostas antigas guardadas e a pergunta reabre | Old answer kept aside, member answers again | |

**User's choice:** Free text changes always; type and answered options lock (D-587).

### Admin tira uma pergunta

| Option | Description | Selected |
|--------|-------------|----------|
| Arquiva: some para o membro, admin ainda vê | Answers kept, listed and exported; can be reactivated | ✓ |
| Apaga a pergunta e todas as respostas | Gone for good, with a warning | |
| Arquiva se tem resposta, apaga se não tem | Both paths | |

**User's choice:** Archive (D-588).

---

## Tipos de pergunta

### Tipos extras (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| Número e data | Numeric and date fields with min and max | ✓ |
| Telefone, e-mail e link | Validation and Brazilian phone mask | ✓ |
| Sim/não e aceite | Switch, and a box that must be ticked | ✓ |
| Nota de 1 a 5 | Star or number scale | ✓ |

**User's choice:** All four groups (D-590). **Notes:** The ROADMAP note said "the six asked"; Igor listed five (short text, long text, dropdown, multiple choice, radio). Corrected in the ROADMAP.

### Tipos pesados

| Option | Description | Selected |
|--------|-------------|----------|
| Nenhum agora | Deferred; model ready for new types without rewriting tables | ✓ |
| Só estado e cidade | Needs the municipality list | |
| Só upload de foto ou arquivo | Private file answer | |
| Os dois | | |

**User's choice:** None now (D-591).

### Opção "Outro"

| Option | Description | Selected |
|--------|-------------|----------|
| Sim, o admin liga por pergunta | Free-text stored with the answer | ✓ |
| Não | Only listed options | |

**User's choice:** Yes, per question (D-592).

---

## Quem vê as respostas

### Visibilidade

| Option | Description | Selected |
|--------|-------------|----------|
| Admin escolhe por pergunta se aparece no perfil | Default admin and support only; per-question "show on my profile" | ✓ |
| Só admin e suporte, nunca outros membros | Most private | |
| Tudo aparece no perfil | All answers public to the tenant | |

**User's choice:** Admin chooses per question (D-593).

### LGPD

| Option | Description | Selected |
|--------|-------------|----------|
| Aviso no construtor + respostas somem com a conta | Warning when creating a question; answers cascade with the membership | ✓ |
| Aviso + campo "Para que usamos?" | Purpose field shown to the member | |
| Plataforma bloqueia palavras sensíveis | Keyword blocking | |

**User's choice:** Warning plus cascade deletion (D-594).

### Exportação

| Option | Description | Selected |
|--------|-------------|----------|
| CSV com uma linha por membro | admin_tenant only; logged in the moderation log | ✓ |
| Só ver na tela, sem exportar | | |
| Exportar e também filtrar a lista de membros por resposta | | |

**User's choice:** CSV, one row per member (D-595). **Notes:** Claude added formula-injection neutralisation as a constraint.

### Módulo ou núcleo

| Option | Description | Selected |
|--------|-------------|----------|
| Módulo, desligado por padrão | Same mold as store, courses, social, payments; super_admin turns it on | ✓ |
| Faz parte de todo tenant, sempre ligado | | |
| Módulo, mas ligado por padrão em tenants novos | | |

**User's choice:** Module, off by default (D-596).

---

## Claude's Discretion

- Limits (questions, options, character caps), the exact gate error code and API shape (no second round trip on the `requireAuth` hot path), builder ergonomics (reorder, preview, duplicate, response counts), freezing the "show on profile" switch once answers exist, hard delete of a never-answered question, pt-BR copy, final module key name.

## Deferred Ideas

- State/city type; file/photo type; sections and conditional questions; notifying members when the form changes; filtering members by answer; a per-question purpose field.
