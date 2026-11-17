---
sketch: 023-phase-12.4-designed-screens
name: phase-12.4-designed-screens
phase: "12.4"
question: "As telas novas do chamado no suporte — a abertura do chamado pelo membro com as categorias e o assunto, a barra do chamado e o ciclo de vida na conversa do membro, Meus chamados, a linha do sino, a caixa da equipe com abas, filtros e a linha do chamado, a barra e as ações da equipe com diálogos e folhas, a folha de detalhes e histórico e o cartão Atendimentos por assunto do painel do dono — leem como a própria linguagem do protótipo, em claro e escuro, sob qualquer marca de tenant, em 320 e 390px?"
screens:
  - membro-vazio-com-categorias
  - membro-vazio-categoria-e-assunto
  - membro-vazio-320-teclado
  - membro-vazio-historico
  - membro-primeiro-envio-chamado-aberto
  - membro-chamado-aberto
  - membro-chamado-em-atendimento
  - membro-chamado-resolvido-aviso
  - membro-resposta-reabre
  - membro-chamado-fechado-somente-leitura
  - membro-chamado-fechado-ao-vivo
  - membro-chamado-sem-assunto
  - membro-chamado-assunto-longo-320
  - membro-chamado-carregando
  - membro-chamado-erro
  - meus-chamados-atual-e-anteriores
  - meus-chamados-so-anteriores
  - meus-chamados-vazio
  - meus-chamados-carregando
  - meus-chamados-erro
  - meus-chamados-320
  - sino-chamado-resolvido
  - caixa-equipe-em-aberto
  - caixa-equipe-filtro-responsavel
  - caixa-equipe-filtro-prioridade
  - caixa-equipe-aguardando-ligado
  - caixa-equipe-resolvidos
  - caixa-equipe-fechados
  - caixa-equipe-vazia-por-aba
  - caixa-equipe-vazia-com-filtros
  - caixa-equipe-carregando
  - caixa-equipe-erro
  - caixa-equipe-desktop-divisao
  - caixa-equipe-quatro-abas
  - caixa-equipe-320
  - linha-do-chamado-variantes
  - equipe-chamado-aberto
  - equipe-chamado-em-atendimento-meu
  - equipe-chamado-em-atendimento-de-outro
  - equipe-chamado-resolvido
  - equipe-chamado-fechado
  - equipe-chamado-bloqueado-fechado
  - equipe-chamado-320
  - equipe-menu-acoes
  - dialogo-resolver
  - dialogo-fechar
  - dialogo-reabrir
  - dialogo-assumir-de-outra-pessoa
  - folha-atribuir
  - folha-editar
  - acao-obsoleta-toast
  - acao-erro-toast
  - detalhes-dados-e-historico
  - detalhes-chamados-anteriores
  - detalhes-historico-carregando
  - detalhes-historico-erro
  - painel-atendimento-por-assunto
  - painel-atendimento-por-assunto-vazio
  - painel-atendimento-por-assunto-320
  - painel-fila-chamados
  - leitor-de-tela
  - defaults-a-confirmar
status: pending
approved: false
approved_by: null
approved_at: null
approval_kind: null
changes_requested: []
winner: null
tags: [phase-12.4, design-review, D-33, D-365, D-417, UI-04, support-cases, chat, owner-panel]
---

# Sketch 023: Fase 12.4 — Abertura de chamado no suporte (portão de revisão D-33 / D-365 / D-417 / UI-04)

## Design Question

Hoje o suporte é uma conversa única por membro, sem estado, sem responsável e sem fechamento. A Fase 12.4 faz a
mensagem do membro **abrir um chamado** com número, e a equipe assume, responde, resolve e fecha. O protótipo do time
de design tem uma tela de "Ajuda" com lista de chamados, mas o produto decidiu **não** usar o modelo dele (sem tela de
Ajuda, um chamado ativo por vez, o membro escolhe a categoria e o assunto é opcional, prioridade só da equipe, sem
anexos). Por isso estas superfícies são **[designed]** e, pelas regras D-33, D-365 e D-417, precisam ser desenhadas e
revisadas **antes de codar** (UI-04). São dez grupos em três portões:

- 1 · A abertura do chamado: o membro escreve pela primeira vez
- 2 · A barra do chamado e o ciclo de vida do chamado
- 3 · Meus chamados
- 4 · O sino e o push do membro
- 5 · A caixa da equipe: abas, filtros e a linha do chamado
- 6 · A conversa da equipe e a barra do chamado
- 7 · Diálogos e folhas das ações
- 8 · A folha de detalhes e histórico
- 9 · O painel do dono: Atendimento por chamado
- 10 · Notas e padrões a confirmar

A pergunta de design: tudo isso lê como a linguagem do protótipo — fundo `#f5f7fb` com cartões brancos, raios de
12px, alvos de 44px, a escala 12 / 14 / 16 / 24 com pesos 400 / 700 e **uma** cor de destaque, a marca do tenant —, em
claro e escuro, sob qualquer marca, em 320 e 390px? A Fase 12.4 não declara token, cor, fonte, tamanho nem dependência
nova; o desenho só combina as primitivas já entregues.

## How to View

```
open .planning/sketches/023-phase-12.4-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem framework, sem script remoto e sem imagem real. O arquivo abre offline. É um
artefato de revisão sob `.planning/`: nenhum código de aplicação o importa, empacota ou referencia.

Controles no topo (chrome do mockup, fora do produto): tema claro e escuro, **quatro** marcas de tenant (Azul, Verde,
Coral e **Amarelo**, que está lá para mostrar o problema de contraste da A-UI-8) e a largura 390 ou 320px. Cada quadro
leva o seu nome em `data-frame` e na etiqueta. São **62 quadros** e a lista `screens:` do topo deste arquivo é igual
aos quadros desenhados, na ordem da página. Os quadros de desktop (a divisão de 1280px) têm largura fixa. Todos usam
uma linha do tempo de exemplo única: o "agora" é quinta-feira, 19 de novembro de 2026, 14:20; o cliente é o "Instituto
Aurora"; a membro é Marina Costa; os chamados são #42, #38, #31 e #12. Nomes, e-mails (domínio reservado `.invalid`)
e textos são exemplos.

## O que olhar, em que ordem

1. **O membro (portão G1).** `membro-chamado-aberto` (a barra do chamado, com o problema de largura descrito abaixo),
   `membro-vazio-com-categorias` (a primeira mensagem), `membro-chamado-resolvido-aviso`,
   `meus-chamados-atual-e-anteriores` e `sino-chamado-resolvido`.
2. **A equipe (portão G2).** `caixa-equipe-em-aberto`, `linha-do-chamado-variantes`, `equipe-chamado-aberto`,
   `equipe-menu-acoes`, `dialogo-fechar`, `folha-atribuir`, `folha-editar` e `detalhes-dados-e-historico`.
3. **O dono (portão G3).** `painel-atendimento-por-assunto` e `painel-fila-chamados`.
4. **Por último, `defaults-a-confirmar`:** uma tabela só, em português simples, com cada suposição, o que está
   desenhado, a alternativa e quanto custa trocar. Responda cada linha com "manter" ou "trocar".

## Os padrões que o product owner pode derrubar (A-UI-1..A-UI-28)

O quadro `defaults-a-confirmar` lista as 28. As **quatro primeiras** (A-UI-1 a A-UI-4) são as suposições que a
`12.4-CONTEXT.md` assumiu sem perguntar: responder a um chamado sem responsável o assume; a equipe reabre só o que
está Resolvido; tudo continua sob o módulo `chat`; o aviso de membro bloqueado vence a faixa de Fechado. As outras
24 são escolhas do contrato de interface; as que mais pedem o seu olhar são a A-UI-5 (três abas ou quatro), a A-UI-8
(a cor da pílula Em atendimento), a A-UI-9 (reabrir tira o responsável), a A-UI-10 (não existe "Soltar"), a A-UI-11
(Fechado não permite corrigir campos), a A-UI-12 (sem linhas de evento no meio da conversa) e a A-UI-24 (a linha da
caixa cresce para quatro linhas).

## O que o desenho mostrou que o contrato ainda não resolve

Ao desenhar, os quadros expuseram pontos que o UI-SPEC deixou abertos ou errou. Nenhum muda uma decisão travada
(D-800 a D-815); todos pedem uma resposta sua ou do planejador:

1. **A barra do chamado do membro não cabe numa linha.** "Chamado #42" + a pílula + o link "Meus chamados" medem 349 a
   406px; há 356px a 390 e 286px a 320. `Em atendimento` nunca cabe a 390px. A barra que quebra muda de altura (de
   cerca de 82 para 118px) quando o estado muda ao vivo, o que briga com UI-D-830 ("uma mudança de estado nunca move a
   rolagem"). Está desenhada a quebra recomendada e uma alternativa (o link na linha do assunto, barra sempre de duas
   linhas). **Decisão sua**, em `membro-chamado-aberto`.
2. **A barra da equipe a 320px corta o responsável.** A linha de baixo mostra "Com Diego" como "Co…" por causa do
   botão principal e do menu de 44px. É justo o dado mais útil ali (`equipe-chamado-320`).
3. **A linha da caixa da equipe é alta.** Mede 152 a 186px na lista de 288px (o contrato dizia 113 a 152); cabem cerca
   de três chamados por tela no cartão de desktop. Com duas pílulas a linha de meta quebra em três linhas, e não duas.
   Veja `linha-do-chamado-variantes` e as alternativas da A-UI-24.
4. **O chip "Aguardando resposta" sai da tela a 390px** quando há um filtro de responsável ativo. Sugestão: ele passa
   a ser o primeiro chip. Além disso, o número dele só bate com o selo da equipe quando não há filtro de responsável
   nem de prioridade; o UI-D-823 diz "exatamente". Também há dois "Limpar filtros" na lista vazia filtrada.
5. **Quatro abas mal cabem a 390px (cerca de 386px) e a quarta é cortada a 320px.** A versão de três abas cabe
   (`caixa-equipe-quatro-abas`).
6. **O tema Amarelo falha em contraste não só na pílula.** Todo texto na cor da marca no tema claro some: o link
   "Meus chamados", os títulos "Chamado atual" e "Anteriores", "Sim, resolver", o "Cancelar" das folhas e o marcador
   dos rádios. É um problema do tema da marca, não do chamado; a alternativa neutra só existe para a pílula.
7. **No painel do dono a 320px**, o novo rótulo "Chamados aguardando resposta" quebra no meio da palavra na coluna de
   cerca de 46px. Foi desenhada uma alternativa de coluna única (`painel-atendimento-por-assunto-320`,
   `painel-fila-chamados`).
8. **A lista de atendentes das folhas "Atribuir" e "Responsável"** não tem estado de carregando nem de erro no
   contrato. Foi desenhado o que o planejador assumiria (três linhas de esqueleto, uma linha de nova tentativa e o
   texto proposto "Não foi possível carregar a equipe.", que precisa da sua aprovação).
9. **Lacunas de texto do contrato:** o que a barra do membro mostra no assunto de um chamado migrado, que não tem
   assunto (UI-D-818 contra D-812); quando some a linha "Chamado #N aberto." (UI-D-820a); o título dos pushes da
   equipe (UI-D-822); o que "Anteriores" significa e qual data mostra na folha de detalhes (UI-D-829); e o 12px do
   "Dados" e do disco do histórico, que a escala de espaçamento só permite como geometria já entregue.
10. **O sino não tem bolinha de não lido.** O componente entregue marca o não lido só com um fundo na cor da marca a
    10%; o UI-D-822 fala em "bolinha". Foi desenhado o fundo.
11. **O toast entregue fica no topo e é cheio**; os sketches 007 e 022 o desenharam como uma pílula escura no rodapé.
    Aqui está como o componente é de fato.

## Textos de exemplo no desenho

O texto vem do Copywriting Contract do UI-SPEC onde ele existe. Onde o contrato não tem texto, o quadro diz
"Suposição: …" na sua legenda. **Pergunta ao time de design:** algum exemplo mascara um problema de largura ou de
quebra de linha que um nome de 60 caracteres, um assunto de 80 caracteres ou um responsável de nome longo causaria
em 320px? (Ver `membro-chamado-assunto-longo-320`, `meus-chamados-320`, `equipe-chamado-320` e
`caixa-equipe-320`.)

## Decisões travadas a montante (não se rediscutem aqui)

D-800 a D-815 do `12.4-CONTEXT.md` e UI-D-816 a UI-D-835 do `12.4-UI-SPEC.md` (as decisões visuais) estão fixadas.
Esta revisão só pergunta se o **desenho** as cumpre, e confirma ou derruba os padrões e as suposições acima.

## Como revisar e como o resultado é registrado

1. Abra o `index.html`, alterne tema claro e escuro, troque entre as quatro marcas e a largura 320px, e confira os
   quadros de 320px.
2. Comece por `membro-chamado-aberto` e `caixa-equipe-em-aberto`, e termine em `defaults-a-confirmar`.
3. **Quem registra o resultado é o Igor**, editando o frontmatter deste arquivo. Para aprovar, troque os valores
   pendentes por estes:

       status: approved
       approved: true
       approved_by: <seu nome>
       approved_at: <AAAA-MM-DD>
       approval_kind: provisional

   Para pedir mudanças, liste-as em `changes_requested:` e deixe `approved: false`; o desenho é então revisado e a
   revisão se repete. Se o Igor dispensar o portão, ele registra a dispensa como decisão no `12.4-CONTEXT.md`, e os
   planos de tela largam a guarda; o mínimo que ainda vale olhar são os quadros do passo 2.

Enquanto este arquivo disser `approved: false`, **todas as tarefas de tela da Fase 12.4 param na precondição**
(`grep -q '^approved: true'` neste arquivo). Os planos de banco, contrato, API, worker do fechamento automático,
avisos e modelos de leitura não dependem desta aprovação e seguem.
