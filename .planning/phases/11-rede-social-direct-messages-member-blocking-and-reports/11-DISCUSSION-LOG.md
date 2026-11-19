# Phase 11: Rede Social - Direct Messages, Member Blocking and Reports - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-19
**Phase:** 11-rede-social-direct-messages-member-blocking-and-reports
**Areas discussed:** Onde ficam as conversas, O que o bloqueio muda, Avisos novos, Denúncia de story, comunidade e mensagem

---

## Onde ficam as conversas

### Where do conversations live
| Option | Description | Selected |
|--------|-------------|----------|
| Uma lista só no balão (Recomendado) | With `social` on the bubble opens "Conversas", Suporte is the pinned first row, member conversations below; with `social` off it opens the case directly as today | ✓ |
| Suporte e membros separados | The bubble stays support only, member conversations get another place and a second unread counter | |
| Duas abas dentro do chat | The bubble opens a chat screen with "Suporte" and "Membros" tabs, one more tap to reach support | |

**User's choice:** Uma lista só no balão (Recomendado)

### How a conversation starts
| Option | Description | Selected |
|--------|-------------|----------|
| Perfil e linha de /membros (Recomendado) | Same places as the Seguir button (D-470); an existing conversation is reopened, at most one per pair | ✓ |
| Só no perfil | Exactly what the roadmap asks | |
| Perfil, lista e "Nova conversa" | Also a "Nova conversa" button in the list that opens a member search | |

**User's choice:** Perfil e linha de /membros (Recomendado)

### Administrator blocks or removes the other member
| Option | Description | Selected |
|--------|-------------|----------|
| Some até desbloquear (Recomendado) | The conversation leaves the list and refuses messages, returns whole on unblock (D-484); a deleted account shows "Membro removido", read only | ✓ |
| Fica visível, só leitura | The row stays with the name replaced by "Membro indisponível" and a closed composer | |

**User's choice:** Some até desbloquear (Recomendado)

---

## O que o bloqueio muda

### What the blocked member sees when writing
| Option | Description | Selected |
|--------|-------------|----------|
| Campo fechado, sem motivo (Recomendado) | Composer replaced by "Esta conversa não aceita novas mensagens.", history still visible, nothing sent | ✓ |
| Parece enviar, mas ninguém recebe | Shows as sent but never delivered, hides the block better, more code and bug risk | |
| Erro genérico a cada envio | Composer stays open, every send fails with a generic error, looks like a defect | |

**User's choice:** Campo fechado, sem motivo (Recomendado)

### The blocker's side of the old conversation
| Option | Description | Selected |
|--------|-------------|----------|
| Fica na lista, com Desbloquear (Recomendado) | History readable, composer replaced by "Você bloqueou {nome}" and Desbloquear, kept as evidence for a report | ✓ |
| Some da lista de A | Same filter as the feed, the conversation returns on unblock | |

**User's choice:** Fica na lista, com Desbloquear (Recomendado)

### Existing follows when a block happens
| Option | Description | Selected |
|--------|-------------|----------|
| Os dois são desfeitos (Recomendado) | Both follow rows deleted in the block's transaction, unblock restores nothing | ✓ |
| Ficam guardados e voltam ao desbloquear | Rows kept and ignored while blocked, every count, list and "Siga para ver" read must check the block | |

**User's choice:** Os dois são desfeitos (Recomendado)

### What the blocked member still sees
| Option | Description | Selected |
|--------|-------------|----------|
| Vê como antes (Recomendado) | Only the roadmap's three losses; profile and public posts stay visible, no new filter | ✓ |
| Perfil e posts de A somem para B | B stops seeing A everywhere, like the administrator's block, reveals the block and needs new filters in many surfaces | |

**User's choice:** Vê como antes (Recomendado)

---

## Avisos novos

### Member post and followers
| Option | Description | Selected |
|--------|-------------|----------|
| Ninguém é avisado (Recomendado) | Keeps D-476, followers find the post in Explorar | ✓ |
| Seguidores recebem uma linha no sino | One bell row per follower per post, no push | |
| Seguidores recebem sino e push | Same as administrator posts, no way to switch a kind off | |

**User's choice:** Ninguém é avisado (Recomendado)

### "Começou a te seguir"
| Option | Description | Selected |
|--------|-------------|----------|
| Só linha no sino (Recomendado) | Like a like, no push, once per pair | ✓ |
| Sino e push | General rule of D-235, a push per new follower | |

**User's choice:** Só linha no sino (Recomendado)

### "Nova mensagem"
| Option | Description | Selected |
|--------|-------------|----------|
| Número no balão e push (Recomendado) | Same shape as the support reply, push titled with the sender's name and the start of the message | ✓ |
| Push sem prévia do texto | Push says only that a message arrived, more private on the lock screen | |
| Número no balão, sem push | Nothing arrives with the app closed | |

**User's choice:** Número no balão e push (Recomendado)

---

## Denúncia de story, comunidade e mensagem

### What the administrator reads of a reported message
| Option | Description | Selected |
|--------|-------------|----------|
| Só a mensagem denunciada (Recomendado) | A copy of that message (or the recording, audible only through the report); the rest stays private | ✓ |
| A mensagem e as 5 antes e depois | Context snapshot, shows conversations nobody reported, costly to change later | |
| A conversa inteira | Admin opens the whole conversation, not recommended | |

**User's choice:** Só a mensagem denunciada (Recomendado)

### Actions on a reported message
| Option | Description | Selected |
|--------|-------------|----------|
| Ignorar e Bloquear autor (Recomendado) | No "Remover conteúdo", the chat is append only (D-859) | ✓ |
| Também Ocultar mensagem | A third action hiding the message for both sides, breaks append only, new column and policy | |

**User's choice:** Ignorar e Bloquear autor (Recomendado)

### "Remover conteúdo" on a member community
| Option | Description | Selected |
|--------|-------------|----------|
| Arquivar (Recomendado) | Reversible, log row `community_archived`; removal for good stays outside the queue | ✓ |
| Remover | Gone for good, no way back | |
| O admin escolhe na folha | Two separate actions for communities only, one more state to design | |

**User's choice:** Arquivar (Recomendado)

### How the administrator learns of a new report
| Option | Description | Selected |
|--------|-------------|----------|
| Sino e push para quem modera (Recomendado) | Bell row and "Nova denúncia" push, no content, no reporter, one per report | ✓ |
| Só contador na fila | A count on the "Denúncias" row, no notice | |
| Só linha no sino, sem push | Bell only, nothing with the app closed | |

**User's choice:** Sino e push para quem modera (Recomendado)

---

## Claude's Discretion

- The UI-gate path (one new sketch carrying the Phase 13 report and block frames forward plus the new surfaces), not decided with Igor, confirmed at the sketch review.
- Abuse limits on direct messages (length and send rate), neutral error codes and wording, "Membro removido" label, blocker's profile control, retraction of the follow notice, routes and RLS for the member lane of direct messages, list ordering and realtime topic.

## Deferred Ideas

- Group chats, message requests, mute or delete a conversation, a setting for who may message me.
- Context around a reported message, an administrator action that hides a message, a "Nova conversa" button.
- Follower notice for member posts, push for a new follower, per-kind switches (V2-NOTIF-01), read and played receipts (V2-CHAT-02).
