---
sketch: 007
name: phase-07-designed-screens
phase: 7
question: "Do the nine prototype-less Phase 7 surfaces (staff inbox, desktop split, soft-ask card, push switch row, InstallHint push variant, member thread header and greeting, actor-less and removed notification rows, comment highlight, dot badge) and the two proto deltas read as the prototype's own language in light/dark under any tenant brand?"
screens:
  - s1-caixa-de-entrada-da-equipe-celular (UI-D-262)
  - s2-divisao-lista-conversa-desktop-lg (UI-D-264)
  - s3-cartao-de-pedido-de-push (UI-D-255)
  - s4-linha-de-push-seis-estados-e-ocupado (UI-D-256)
  - s5-installhint-variante-push (UI-D-257)
  - s6-cabecalho-da-conversa-do-membro-e-saudacao (UI-D-258)
  - s7-linhas-sem-ator-removido-desconhecido-ator-que-saiu (UI-D-251)
  - s8-destaque-do-comentario-e-avisos-de-alvo-ausente (UI-D-254)
  - s9-ponto-do-suporte-e-numero-do-sino (UI-D-253)
  - delta-a-rotulo-do-remetente-acima-e-neutro (UI-D-259)
  - delta-b-compositor-sem-anexo-ate-cinco-linhas (UI-D-260)
status: pending
approved: false
approved_by: null
approved_at: null
approval_kind: null
changes_requested: []
winner: null
gated_tasks:
  - 07-04 Task 3
  - 07-05 Task 2
  - 07-07 Task 2
  - 07-09 Task 2
  - 07-10 Task 1
  - 07-10 Task 2
tags: [phase-07, design-review, D-33, UI-04, notifications, push, chat]
---

# Sketch 007: Fase 7 — Notificações, Push e Suporte (portão de revisão D-33)

## Design Question

A Fase 7 leva a comunidade até o membro em tempo real: o **sino** com a lista de notificações, o
**push** no app instalado (com o portão do iPhone) e a **conversa de suporte** com a equipe do tenant,
com uma caixa de entrada para a equipe.

O protótipo do time de design (git `05f68b1`) cobre a linha de notificação com ator, as seções
"Novas" / "Anteriores", o par de bolhas da conversa e o compositor de resposta. Esses são
**portados** (D-66) e não precisam de desenho. **Não cobre** as nove superfícies abaixo, que
`07-UI-SPEC.md` marca `[designed]` e que D-33 manda desenhar e revisar **antes de codar** (UI-04):

1. **A caixa de entrada da equipe** no celular (UI-D-262).
2. **A divisão lista + conversa** no desktop, a partir de `lg` (UI-D-264).
3. **O cartão de pedido de push** no topo de `/notificacoes` (UI-D-255).
4. **A linha de push de Configurações**, nos seis estados mais o ocupado (UI-D-256).
5. **A variante push do `InstallHint`** (UI-D-257).
6. **O cabeçalho da conversa do membro** e a **saudação vazia** (UI-D-258).
7. **As linhas de notificação sem ator e de conteúdo removido** (UI-D-251).
8. **O destaque do comentário** na página do post (UI-D-254).
9. **O ponto no slot do suporte**, ao lado do número do sino (UI-D-253).

E dois deltas `[proto]`, desenhados porque mudam o que o time de design desenhou:

- **(a)** o rótulo do remetente sai de dentro da bolha, sobe para cima dela e fica neutro
  (UI-D-259, D-222);
- **(b)** o compositor perde o anexo, ganha o campo de 16px, cresce até cinco linhas e mostra o
  contador a partir de 1.800 caracteres (UI-D-260, D-225).

A pergunta de design: tudo isso lê como a linguagem que vocês já assinaram — ground `#f5f7fb` com
cartões brancos, raios de 12px, alvos de 44px, a escala 12/14/16/24 com pesos 400/700, e **uma** cor de
destaque que é a do tenant — em claro e escuro, sob qualquer marca?

## How to View

```
open .planning/sketches/007-phase-07-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem React, sem script remoto, sem folha de estilo remota, sem
webfont remota, sem quadro incorporado e sem imagem real: fotos e logotipos são gradientes e formas
que simulam o conteúdo do tenant. Os links que aparecem como texto dentro das bolhas são conteúdo de
mensagem; todo link do arquivo aponta para uma âncora interna. O arquivo abre offline e pode ser
enviado por e-mail como está. Manrope renderiza se estiver instalada na máquina; sem ela o fallback
do sistema renderiza com as mesmas medidas.

Controles no topo (chrome do mockup, fora do produto):

- **Tema escuro / Tema claro** — alterna `data-theme` no `<html>`, como o cookie `rede_theme`.
- **Cor primária / Cor secundária** e quatro presets (Rede Social neutro, Demo roxo, Lab verde, e um
  **Amarelo** cuja tinta derivada é escura) — escrevem as cinco variáveis `--brand-*` como
  `brandStyleVars()` faz no servidor.
- Os links de seção pulam para cada superfície e cada delta.

O mockup tem um **relógio fictício**: agora = seg., 14 de out. de 2030, 14:20, no fuso do tenant.
Todos os valores de cor vêm de `packages/ui/src/styles/tokens.css`. **A Fase 7 não acrescenta nenhum
token, nenhuma medida de espaçamento, nenhum tamanho de tipo e nenhum peso.** Se algo parecer um
valor novo, é defeito do desenho, não proposta.

## What to review

Uma linha por superfície, com os estados desenhados (cada texto vem do §Copywriting Contract de
`07-UI-SPEC.md`: aprovar o desenho aprova o texto e a geometria juntos).

- **Superfície 1 — caixa de entrada (UI-D-262):** lista por última atividade; linha com avatar, nome
  14/700, prévia de uma linha (mensagem da equipe com o prefixo "Carla: "), horário "14:02" / "Ontem"
  / "12/10" e o ponto de 8px da marca quando aguarda; membro bloqueado com a pílula neutra
  "Bloqueado"; membro que saiu como "Membro removido"; vazia, esqueletos, erro ao carregar mais, 320px.
  **Sem chips de status e sem filtros** (D-221).
- **Conversa da equipe (UI-D-263, parte de 1 e 2):** cabeçalho com um link para o perfil do membro e
  **sem painel lateral** (D-224); só leitura para membro bloqueado e para membro que saiu; a tela única
  de "Conversa não encontrada".
- **Superfície 2 — divisão (UI-D-264):** o cartão `288px | 1fr` a 1.280px com a linha aberta em
  `bg-bg-active`; o painel ocioso "Escolha uma conversa"; e a nota de que entre `md` e `lg` a lista e a
  conversa são rotas separadas.
- **Superfície 3 — cartão de pedido (UI-D-255):** corpo do membro e da equipe, ocupado, 320px,
  dispensado (a lista começa na primeira seção) e os três toasts do fluxo.
- **Superfície 4 — linha de push (UI-D-256):** verificando, sem suporte, iPhone fora da Tela de
  Início, desligado, ligado, bloqueado (três linhas com um tenant de 30 caracteres em 320px) e
  ocupado.
- **Superfície 5 — `InstallHint` push (UI-D-257):** a folha sobre Configurações e em 320px, com **um**
  botão "Entendi" e sem "Agora não"; a variante de instalação atual ao lado, para comparar.
- **Superfície 6 — conversa do membro (UI-D-258):** cabeçalho com logotipo largo e sem logotipo;
  saudação vazia acima do compositor habilitado; conversa cheia com "Hoje" / "Ontem" / data,
  sequências, horário sob a última bolha, "Enviando…", links nas duas cores de bolha, a pílula de
  novas mensagens, "Carregar mensagens anteriores" e o erro dele, uma mensagem de 2.000 caracteres com
  quebras e uma URL de 300 caracteres sem espaço.
- **Superfície 7 — linhas (UI-D-251):** sem ator (lembretes de 1 h e 24 h), tipo desconhecido (a linha
  genérica), conteúdo removido (um botão, sem prévia), ator que saiu, curtida com o único glifo
  colorido; cada uma não lida e lida; a nota do leitor de tela "Não lida."; uma linha em 320px com ator
  de 60 caracteres, trecho de 80 e comunidade; vazio, carregando e erro.
- **Superfície 8 — destaque (UI-D-254):** a conversa-raiz primeiro com as respostas expandidas, o alvo
  em `rounded-xl bg-brand/10`, o quadro depois do sumiço, e os toasts "Este comentário não está mais
  disponível.", "Este story expirou." e "Este conteúdo não está mais disponível.".
- **Superfície 9 — selos (UI-D-253):** TopBar do membro (sino "3" + ponto) e da equipe (sino +
  suporte "2"), "99+", zerado, 320px, e o trilho do desktop para os dois papéis, com os nomes
  acessíveis escritos nas legendas.
- **Delta (a) — rótulo (UI-D-259):** antes (protótipo) e depois, e a mesma conversa nas visões do
  membro e da equipe.
- **Delta (b) — compositor (UI-D-260):** o protótipo com o que sai riscado; vazio, uma linha, cinco
  linhas, rolando, contador em 1.800 e em 2.000, falha com o rascunho de volta.

## Messages for the design team

Além da revisão visual, cinco mensagens.

### (a) O que não é portado do suporte do protótipo (CONTEXT, D-220, D-221)

O suporte do protótipo é um helpdesk de chamados. Na V1 ele vira **uma conversa contínua por membro**,
aberta direto pelo balão da TopBar. Por isso **não são portados**: o protocolo do chamado, a
categoria, a prioridade, a pílula de status, o botão **"Marcar como resolvido"** e o diálogo dele, o
FAQ, os anexos (botão de imagem, faixa de anexos, dica "anexe prints"), o lightbox e o hub `/suporte`
com a lista de chamados do membro. Sem status não há triagem por status na caixa da equipe (D-221), e
nada é atribuído a ninguém (D-225).

### (b) O nome do atendente sai de dentro da bolha (D-222, UI-D-259)

No protótipo, o nome do atendente ficava dentro da bolha da equipe, pequeno e na cor de destaque. Ele
sobe para **acima** da bolha, em 12/700 neutro. Na visão da equipe as bolhas da equipe são da cor da
marca, e **nenhum texto pequeno pode ficar sobre uma cor de tenant**: o contraste de 12px dependeria de
cada tenant. Fora da bolha o rótulo fica sempre no chão neutro, e a mesma peça serve às duas visões.

*A decidir:* o rótulo acima lê como parte da bolha, e o `ShieldCheck` basta para dizer "é da equipe"?

### (c) O compositor perde o anexo (V2-CHAT-02, D-225)

Anexos, confirmação de leitura e "digitando…" são V2. O compositor fica com o campo e o enviar,
cresce até cinco linhas e mostra o contador perto do limite de 2.000. O campo sobe de 14px para 16px
porque abaixo disso o iOS dá zoom ao focar.

### (d) A linha de conteúdo removido existe por uma escolha do plano (07-04)

Quando um post ou comentário é apagado, 07-04 **mantém** a linha de notificação e descarta só o
trecho guardado, em vez de apagar a linha. Por isso existe a variante "Este conteúdo foi removido.":
um botão sem prévia que, tocado, marca como lida e mostra um toast, em vez de levar a uma tela
quebrada.

### (e) A sinalização aberta do checker: "Entendi"

O `gsd-ui-checker` aprovou o UI-SPEC com uma sinalização de texto não bloqueante: o botão da folha push
é a palavra solta **"Entendi"** (`pwa.install.push.confirm`), a mesma da folha de instalação. A revisão
pode fechar isso trocando por algo mais específico (por exemplo "Entendi, vou instalar") ou mantendo
"Entendi". O desenho mostra a versão atual do contrato.

### Dois achados do próprio desenho, para a revisão fechar

1. **O ícone em linha da folha.** Na folha entregue, o `Share` 16 fica no **fim** do corpo. O corpo
   push termina em "ative as notificações.", longe de "Compartilhar". Opção barata: interpolar o ícone
   logo depois de "Compartilhar".
2. **O teto de cinco linhas.** `max-h-30` (120px) conta o `py-2` e a borda, então o campo mostra ~4,3
   linhas antes de rolar. Opções: aceitar ~4 linhas, ou calcular o teto pelo conteúdo (≈138px de caixa)
   no auto-grow.

## Upstream decisions already fixed

Já decididas em `07-CONTEXT.md` e fora de revisão; estão aqui para o desenho ser lido com elas em
mente, não para serem re-litigadas.

- **D-220** — o balão do membro abre direto a única conversa de suporte; sem hub; saudação vazia.
- **D-221** — sem resolver/fechar: uma conversa contínua por membro, sem triagem por status.
- **D-222** — cabeçalho "Equipe {tenant}" com logotipo; o primeiro nome em cada bolha da equipe; sem
  avatares da equipe.
- **D-223** — `admin_tenant` também responde o suporte (`chat.support`).
- **D-224** — o mesmo slot leva a equipe à caixa de entrada; lista + conversa no desktop; link para o
  perfil, sem painel lateral.
- **D-225** — conversa compartilhada, nada atribuído, leitura compartilhada pela equipe; texto puro de
  1 a 2.000 caracteres com links automáticos.
- **D-226** — posts, reels, stories, eventos novos e reativados notificam todo membro.
- **D-227** — uma notificação por publicação, sem agrupar.
- **D-228** — resposta do suporte não vira linha no sino: acende o selo e manda push.
- **D-229** — a equipe não recebe os tipos de difusão; ninguém se notifica.
- **D-230** — visto (zera o selo) separado de lido (tira a tinta); "Marcar todas como lidas".
- **D-231** — lista infinita com "Novas" e "Anteriores"; linhas com mais de 90 dias são apagadas.
- **D-232** — tocar abre o alvo; comentário abre o post no comentário; alvo ausente tem um aviso
  legível.
- **D-233** — push oferecido em Configurações e no cartão único; o aviso do sistema só depois de um
  toque.
- **D-234** — no iPhone fora da Tela de Início, "Ativar" abre o `InstallHint` com o texto do push.
- **D-235** — tudo vira push exceto curtidas; resposta do suporte com o título "Equipe {tenant}".
- **D-236** — título = nome do tenant, ícone do tenant, uma `tag` por tipo; sem banner com o app em
  foco.
- **D-237** — o selo do suporte do membro é um ponto, não um número.
- **D-238** — o selo do suporte da equipe é o número de conversas aguardando resposta.
- **D-239** — o ícone do app soma sino + suporte (Badging API).
- **D-240** — atualiza ao reconectar e ao voltar para o app; nada depende de reprodução do Realtime.
- **UI-D-250..UI-D-268** — as decisões visuais do UI-SPEC, das quais este desenho é a materialização.

## How to review

1. Abra `index.html` no navegador. Troque o **tema** e pelo menos **duas marcas** nos presets (o
   Amarelo mostra a tinta escura derivada). Tudo que é da marca recolore; selos, glifos dos tipos,
   rótulos do remetente, separadores de dia e a linha aberta da caixa continuam neutros.
2. **`/notificacoes`** — a linha sem ator e a de conteúdo removido leem como parentes da linha do
   protótipo? O cartão de pedido chama atenção sem gritar?
3. **Configurações** — cada estado da linha de push diz o que fazer, sem precisar de outra tela?
4. **Suporte do membro** — o cabeçalho diz "é a equipe da minha organização"? A saudação convida a
   escrever?
5. **Caixa da equipe** — o ponto de 8px basta para "aguardando resposta" sem virar um alarme?
6. **Desktop** — a divisão a 1.280px dá espaço às bolhas, e a lista lê como a mesma lista do celular?
7. **As mensagens acima** — confirme (a), (c) e (d); responda (b), (e) e os dois achados.
8. **Texto** — sinalize qualquer palavra a mudar; ela cai em `apps/web/messages/pt-BR/notifications.json`,
   `chat.json` ou `pwa.json`.

Fora do escopo desta revisão: a linha com ator, as seções "Novas" / "Anteriores", o par de bolhas e o
compositor em si. São `[proto]`, portados sem redesenho, e aparecem aqui como contexto em volta das
peças revisadas e dos dois deltas.

## How to approve

**Esta revisão é o portão, não uma formalidade.** Enquanto o frontmatter deste arquivo disser
`approved: false`, **as seis tarefas que codam uma superfície sem protótipo ficam bloqueadas**:

- 07-04 Task 3 — as linhas sem ator e de conteúdo removido, o destaque do comentário, o aviso de story
  expirado
- 07-05 Task 2 — as linhas sem ator dos lembretes de evento
- 07-07 Task 2 — o cartão de pedido, a linha de push e a variante push do `InstallHint`
- 07-09 Task 2 — o cabeçalho da conversa do membro, a saudação e o ponto do suporte
- 07-10 Task 1 — a caixa de entrada da equipe
- 07-10 Task 2 — o cabeçalho da conversa da equipe e a divisão no desktop

Cada uma carrega um `precondition` que afirma
`grep -q '^approved: true' .planning/sketches/007-phase-07-designed-screens/README.md` e que para
enquanto este arquivo disser `false`. `workflow.human_verify_mode` é `end-of-phase`, então isto não
sobe como checkpoint no meio da execução: a primeira tarefa a consultar o portão é 07-04 Task 3.

**O registro é uma edição do usuário, nunca do agente.** Para aprovar, cole no frontmatter deste arquivo, no lugar dos valores pendentes, as chaves `status: approved`, `approved: true`, `approved_by: <seu nome>`, `approved_at: <AAAA-MM-DD>` e `approval_kind: provisional` (product owner) ou `designer`.

As chaves ficam nessa frase de propósito: o portão procura `approved: true` no início de uma linha, e
só a linha do frontmatter pode satisfazê-lo. O executor da próxima tarefa bloqueada confere a edição
com esse `grep` e a commita como está.

Para pedir mudanças, liste-as em `changes_requested:` e deixe `approved: false` (com
`status: changes-requested`). O desenho é revisado e a revisão se repete; cada item vira uma seção
"Design review deltas" em `07-UI-SPEC.md`.

Seguindo o precedente de 02-04, 04-02, 05-02 e 06-02, **uma aprovação provisória do product owner já
desbloqueia a codificação**; deltas posteriores do designer são um passe de polimento, não um
bloqueio. A coluna Winner da linha 007 em `../MANIFEST.md` só é atualizada se você pedir.
