---
sketch: 008-phase-08.2-designed-screens
name: phase-08.2-designed-screens
phase: 08.2
question: "As sete superfícies da Loja que o protótipo não desenha — a grade com os chips, a página do produto, o pop-up de compra e o sucesso, a comunidade exclusiva, as tags do cartão, o formulário do produto com o aviso e \"Compradores\" com \"Conceder acesso\" — lêem como a própria linguagem do protótipo, em claro e escuro, sob qualquer marca de tenant?"
screens:
  - topbar-slot-loja-ativo-390
  - topbar-slot-loja-repouso-e-modulo-desligado
  - topbar-320-logo-largo
  - trilho-desktop-grupo-de-baixo
  - loja-membro-todos-390
  - loja-gestor-todos-carregando-mais
  - loja-gestor-arquivados
  - loja-membro-comprados-com-arquivado
  - loja-320-nome-80-e-100-mil
  - loja-carregando-e-erro-de-mais
  - loja-vazios-membro-gestor-comprados-arquivados
  - loja-erro-primeiro-carregamento
  - loja-desktop-gestor
  - produto-nao-comprado-duas-comunidades
  - produto-comprado
  - produto-gratis-obter
  - produto-sem-comunidade
  - produto-gestor-ativo
  - produto-gestor-arquivado-reativar
  - produto-vindo-da-comunidade
  - produto-320-descricao-2000
  - produto-carregando
  - produto-not-found-e-erro
  - produto-desktop-comprado
  - compra-confirmar-duas-comunidades
  - compra-confirmar-quatro-comunidades
  - compra-obter-gratis
  - compra-confirmar-sem-comunidade
  - compra-confirmando
  - compra-erro-em-linha
  - compra-sucesso-uma
  - compra-sucesso-varias
  - compra-sucesso-nenhuma
  - compra-no-contexto
  - compra-toasts-retorno-e-recusas
  - exclusiva-um-produto-n4
  - exclusiva-varios-produtos-n2
  - exclusiva-nenhum-a-venda-produto-arquivado-n1
  - exclusiva-link-escondido-exclusivo-1
  - exclusiva-exclusivo-1-sem-produto
  - exclusiva-uma-publicacao
  - exclusiva-sem-publicacoes
  - exclusiva-folha-opcoes-de-acesso
  - postcard-normal-x-readonly
  - exclusiva-toast-meio-da-sessao
  - exclusiva-desktop-e-folha-cartao
  - tags-membro-390
  - tags-320-nome-60-produto-arquivado
  - tags-gestor
  - tags-desktop
  - formulario-novo-vazio
  - formulario-novo-preenchido-paisagem
  - formulario-recorte-4-5
  - formulario-erros-e-envio
  - formulario-editar-ativo
  - formulario-editar-arquivado
  - formulario-enviando
  - formulario-folha-comunidades-multi
  - aviso-uma-comunidade-n-maior-que-0
  - aviso-uma-comunidade-n-1
  - aviso-uma-comunidade-n-0
  - aviso-varias-comunidades
  - aviso-dez-comunidades-320-pendente
  - dialogos-arquivar-reativar-descartar
  - formulario-toasts
  - comunidade-editar-bloco-acesso
  - formulario-desktop-editar
  - compradores-390
  - compradores-320-nome-60
  - compradores-vazio
  - compradores-carregando
  - compradores-carregar-mais-e-erros
  - revogar-quatro-corpos
  - compradores-depois-de-revogar
  - conceder-antes-de-digitar
  - conceder-carregando
  - conceder-resultados
  - conceder-sem-resultado
  - conceder-confirmar-com-e-sem-comunidade
  - compradores-depois-de-conceder
  - conceder-revogar-toasts
  - compradores-desktop-e-folha-cartao
status: approved
approved: true
approved_by: Igor
approved_at: 2026-10-08
approval_kind: provisional
changes_requested: []
winner: null
tags: [phase-08.2, design-review, D-33, UI-04, store]
---

# Sketch 008: Fase 08.2 — Loja e acesso a comunidades por compra (portão de revisão D-365)

## Design Question

A Fase 08.2 cria a **Loja**: o admin do tenant publica produtos (imagem, nome, descrição, preço,
inclusive R$ 0) que podem liberar comunidades. Quem compra (ou recebe acesso do admin) vê essas
comunidades por completo; para os demais elas ficam **exclusivas**, com a publicação mais nova
aberta como amostra.

O protótipo do time de design **não tem** nenhuma tela de loja, produto, compra, preço, compradores
ou comunidade fechada. A linguagem mais próxima é a grade de cursos do protótipo (pôster 4:5, véu,
pílula no canto, cadeado). Por isso `08.2-UI-SPEC.md` marca as sete superfícies abaixo como
`[designed]`, e D-365 (o mesmo portão D-33 / UI-04 das Fases 4 a 7) manda desenhar e revisar
**antes de codar**:

1. **A grade da Loja com os chips** (`/loja`): "Todos · Comprados" e o "Arquivados" do gestor.
2. **A página do produto** (`/loja/[productId]`).
3. **O pop-up de compra e o sucesso** (`PurchaseDialog`), nas variantes de uma, várias e nenhuma
   comunidade.
4. **A comunidade exclusiva** (`/comunidades/[communityId]`): a amostra, os marcadores que somem, a
   linha de contagem, a seção do topo e a folha de escolha de produto.
5. **As tags do cartão** na lista de comunidades: "Exclusiva" e "Produto arquivado".
6. **O formulário do produto** (`/loja/novo`, `/loja/[productId]/editar`) com o aviso de perigo de
   tornar exclusiva.
7. **"Compradores"** (`/loja/[productId]/compradores`) com "Conceder acesso".

E como moldura, o slot "Loja" na TopBar e no trilho do desktop (UI-D-366).

A pergunta de design: tudo isso lê como a linguagem que vocês já assinaram — ground `#f5f7fb` com
cartões brancos, raios de 12px, alvos de 44px, a escala 12/14/16/24 com pesos 400/700, e **uma** cor
de destaque que é a do tenant — em claro e escuro, sob qualquer marca?

## How to View

```
open .planning/sketches/008-phase-08.2-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem React, sem script remoto, sem folha de estilo remota, sem
webfont remota e sem imagem real: as fotos são gradientes que simulam o conteúdo do tenant (uma é
clara de propósito, para julgar o texto branco sobre o véu, e uma é **paisagem**, para mostrar o
recorte central 4:5). O arquivo abre offline e pode ser enviado como está. Manrope renderiza se
estiver instalada na máquina; sem ela o fallback do sistema renderiza com as mesmas medidas.

Controles no topo (chrome do mockup, fora do produto):

- **Tema escuro / Tema claro** — alterna `data-theme` no `<html>`.
- **Cor primária / Cor secundária** e quatro presets (Rede Social neutro, Demo roxo, Lab verde e um
  **Amarelo claro** cuja tinta derivada é escura) — escrevem as cinco variáveis `--brand-*` como
  `brandStyleVars()` faz no servidor. O readout mostra os valores derivados e o contraste da tinta.
- Os links de seção pulam para a moldura e cada uma das sete superfícies.

Todos os valores de cor vêm de `packages/ui/src/styles/tokens.css`. **A Fase 08.2 não acrescenta
nenhum token, nenhuma medida de espaçamento, nenhum tamanho de tipo e nenhum peso.** Se algo no
desenho parecer um valor novo, é defeito do desenho, não proposta. Todo texto de interface vem do
§Copywriting Contract de `08.2-UI-SPEC.md`, com dados de exemplo nas interpolações (o tenant é
**Rede Demo**).

## What is being asked of the design team

Aprovar o desenho aprova o texto e a geometria juntos. Oito mensagens, além da revisão visual:

### (a) "Loja" entra primeiro no grupo da direita da TopBar (UI-D-366)

O slot da Loja tem a ordem 5, antes de Notificações (10) e Suporte (20). O grupo é alinhado à
direita, então o sino e o balão **não andam** quando a Loja liga: os membros tocam neles todo dia, na
Loja raramente. Mesma geometria dos outros slots, sem badge, ativo em `text-brand` sob `/loja`. No
desktop, a mesma ordem no grupo de baixo do trilho. A BottomNav não muda (D-350).

*A decidir:* a ordem lê bem? Ver também o achado 1 abaixo (o logo em 320px).

### (b) O pôster do produto reusa a grade de cursos, sem cadeado (UI-D-368)

O `ProductCard` é o pôster 4:5 do curso: imagem, véu de baixo para cima, nome em até duas linhas e o
**preço no pôster** ("Grátis" em R$ 0), para o comprador ter a primeira resposta sem tocar. No
máximo uma pílula sobre a mídia ("Comprado" com um check, ou "Arquivado" para o gestor), sempre na
família `bg-black/60 text-white`, nunca na marca. **Produtos nunca aparecem fechados**: sem cinza,
sem cadeado central, sem pílula dourada. A grade tem duas colunas em toda largura (D-351).

*A decidir:* o pôster lê como "a mesma família de Eventos" e o preço é legível sobre fotos claras?

### (c) O pop-up de compra vira o sucesso no mesmo painel (UI-D-370)

O `PurchaseDialog` é o `ConfirmDialog` pixel por pixel, com dois passos trocados na hora, sem
deslizar: "Comprar {product}?" (R$ 0: "Obter {product}?") → "Compra concluída". O sucesso tem a ação
certa para **uma** comunidade ("Fechar │ Ir para a comunidade"), **várias** (a lista de links e um
"Fechar") ou **nenhuma** ("{product} agora é seu." e "Fechar"). Quando a compra começou numa
comunidade exclusiva, o sucesso é pulado: o membro volta direto para ela, já liberada, com um toast
(D-358). Nenhum texto fala de forma de pagamento (UI-D-388).

*A decidir:* a compra lê como uma confirmação do próprio app, e não como um checkout de outro lugar?

### (d) A comunidade exclusiva: marcadores estáticos que somem e uma contagem real (UI-D-373)

Abaixo da publicação mais nova (a amostra), até **três marcadores estáticos** a 100 / 70 / 40 % de
opacidade, e então "+ N publicações exclusivas" com o número real (só o número sai do servidor,
D-354). Os marcadores nunca piscam, para não lerem como "carregando". Acima, a **seção do topo** com
um disco neutro de cadeado, "Conteúdo exclusivo" e a única ação da marca ("Ver produto" ou "Ver
opções"); o bloco de contagem repete a ação em `outline`. Sem produto à venda, não há seção do topo
e a contagem diz "Esta comunidade não está à venda no momento.". A régua de destaques não aparece
(D-355).

*A decidir:* a coluna que some diz "tem mais aqui" sem prometer o que não mostra?

### (e) "Exclusiva" vai na capa, que continua colorida (UI-D-372, D-357)

No cartão da lista de comunidades, o cadeado vai **sobre a capa**, no canto superior esquerdo (onde o
protótipo põe a pílula do curso fechado), e a capa fica em cores: sem cinza, sem escurecer. "Produto
arquivado" vai na linha de contagem, como o "Arquivada" de comunidades. Duas tags na linha de
contagem deixariam a contagem com ~20px em 320px. O gestor vê as mesmas tags que o membro, para
conferir o que configurou.

### (f) A amostra somente leitura perde a linha de ações (UI-D-374)

A publicação mais nova abre por completo para quem não tem acesso (vídeo, imagens, anexos, D-356),
mas a linha de curtir / comentar / partilhar **não é renderizada** (em vez de aparecer inerte), a
meta vira texto simples e não há menu nem coração de toque duplo. O desenho mostra o cartão normal e
o somente leitura lado a lado.

### (g) O aviso de perigo diz quem perde acesso (UI-D-378, D-364)

Ao salvar um produto que torna exclusiva uma comunidade que não tinha produto, um `ConfirmDialog`
de perigo diz o número: "37 membros perderão acesso a {community} até comprarem ou receberem
acesso." (singular, N = 0 e várias comunidades também desenhados, incluindo dez comunidades em
320px). Confirmar diz "Tornar exclusiva(s)"; "Voltar" devolve ao formulário com a seleção intacta.

### (h) "Comprado" ou "Concedido" em cada linha de Compradores (UI-D-380, UI-D-381)

A tela copia Participantes dos eventos. Cada linha diz a origem — "Comprado" (`success`) ou
"Concedido" (`neutral`) — para uma concessão nunca ser confundida com uma compra (D-360), e tem o
controle de revogar. "Conceder acesso" é o único preenchimento da marca e abre uma busca sobre os
membros do tenant, com uma confirmação antes de conceder.

### Achados do próprio desenho, para a revisão fechar

Desenhar em 320px e 390px mostrou três pontos que o UI-SPEC não fecha:

1. **O logo em 320px.** Com a Loja, o grupo da direita da TopBar ocupa 204px e é `flex-none`; um logo
   largo de 120px fica com **72px úteis** em 320px (eram 128px sem a Loja). Nada se sobrepõe nem é
   cortado, mas o logo encolhe. Aceitável? Mudar o `gap-3` do grupo só abaixo de 360px seria uma
   decisão nova.
2. **O tempo relativo aparece duas vezes na amostra.** O `PostHeader` entregue já mostra "há 2 h"
   embaixo do nome, e a linha meta somente leitura do UI-SPEC também lista o tempo relativo. O
   desenho segue o contrato e mostra os dois. Opção barata: a meta somente leitura omitir o tempo.
3. **"e mais {n}" no corpo do pop-up.** O contrato lista no máximo dois nomes e depois "e mais {n}";
   um `Intl.ListFormat` de conjunção sobre três itens imprimiria "A, B e e mais 2". O desenho usa
   "A, B e mais 2" (a vírgula entre os dois nomes, o "e mais" no fim). Confirmar a forma.

## Decisions already fixed upstream

Já decididas em `08.2-CONTEXT.md` e `08.2-UI-SPEC.md` e **fora de revisão**. Estão aqui para o
desenho ser lido com elas em mente, não para serem re-litigadas:

- **D-350** — a Loja é um ícone da TopBar; a BottomNav de cinco abas não muda.
- **D-351** — a Loja é uma grade de cartões em duas colunas, com imagem, nome, preço ("Grátis" em
  R$ 0) e a tag "Comprado".
- **D-352** — o par de chips "Todos | Comprados"; sem tela "Minhas compras".
- **D-353** — um produto sem comunidade só registra a compra; a página não fala de comunidades.
- **D-354** — no máximo três marcadores abaixo da publicação mais nova, mais a linha de contagem real.
- **D-355** — a régua de destaques some para quem não comprou.
- **D-356** — a publicação mais nova é uma amostra lida por completo; só as interações são bloqueadas.
- **D-357** — o cartão da lista mostra tudo o que já mostra, mais a tag de cadeado; capa colorida.
- **D-358** — depois de "Confirmar", o pop-up vira "Compra concluída"; volta à comunidade quando a
  compra começou nela.
- **D-359** — revogar encerra o acesso e a pessoa pode comprar de novo.
- **D-360** — conceder e revogar vivem em "Compradores", com a origem em cada linha.
- **D-361** — o pedido guarda o valor; produtos de R$ 0 existem ("Grátis", "Obter").
- **D-362** — o admin gerencia dentro da Loja e por uma linha "Loja" em Configurações.
- **D-363** — as ligações produto–comunidade se editam só no formulário do produto.
- **D-364** — salvar uma ligação que torna exclusiva uma comunidade aberta pede confirmação.
- **D-365** — este portão de desenho antes de qualquer tarefa de UI.
- **UI-D-366..UI-D-388** — as decisões visuais do UI-SPEC, das quais este desenho é a
  materialização (posição do slot, grade, pôster, página do produto, pop-up e recusas, tags, página
  exclusiva, amostra somente leitura, folha de escolha, links escondidos, formulário, aviso,
  bloco "Acesso", Compradores, conceder, dinheiro, carregamento e falha, catálogo, acessibilidade,
  módulo desligado e vocabulário).

## How to review

1. Abra `index.html` no navegador. Troque o **tema** e pelo menos **duas marcas** nos presets (o
   Amarelo claro mostra a tinta escura derivada). Tudo que é da marca recolore; cartões, pílulas,
   preços, tags "Exclusiva", marcadores e o bloco de contagem continuam neutros.
2. **Moldura** — a TopBar mostra Loja primeiro, depois Notificações e Suporte; a BottomNav não muda.
   Confira o quadro de 320px com o logo largo.
3. **`/loja`** — lê como a grade de cursos do protótipo: pôsteres 4:5, o preço no pôster, "Grátis"
   em R$ 0, "Comprado" no canto superior esquerdo; os chips "Todos · Comprados" (e "Arquivados" do
   gestor). Confira o quadro de 320px com o nome de 80 caracteres e "R$ 100.000,00".
4. **Página do produto** — uma ação da marca ("Comprar"/"Obter") e o bloco "Comprado" depois da
   compra; "Libera o acesso a" some quando o produto não libera comunidade.
5. **Pop-up** — vira "Compra concluída" no lugar, com a ação certa para uma, várias e nenhuma
   comunidade.
6. **Comunidade exclusiva** — a publicação mais nova legível sem a linha de ações, os marcadores que
   somem, a contagem real "+ N publicações exclusivas" e a seção do topo; o cartão da lista mantém a
   capa colorida com "Exclusiva" sobre ela.
7. **Admin** — o formulário do produto, o aviso de perigo nomeando quantos membros perdem acesso, e
   Compradores com "Comprado"/"Concedido" e "Conceder acesso" lêem como as telas de admin do próprio
   app.
8. **As mensagens acima** — responda (a) a (h) e os três achados.
9. **Texto** — sinalize qualquer palavra a mudar; ela cai em `apps/web/messages/pt-BR/store.json`
   (ou `communities.json` para as tags e o bloco "Acesso").

Fora do escopo desta revisão: `CommunityCard`, `CommunityHeader`, `PostCard`, `ConfirmDialog`,
`BottomSheet`, `Chip`, `StatusPill` e a TopBar em si. Já existem e aparecem aqui só como contexto
ao redor das peças revisadas.

## Recording the outcome

**Esta revisão é o portão, não uma formalidade.** Enquanto o frontmatter deste arquivo disser
`approved: false`, **todas as tarefas que codam uma superfície sem protótipo da Fase 08.2 ficam
bloqueadas**:

- 08.2-07 Tarefas 1, 2 e 3 (catálogo, slot da TopBar, pôster, grade, página do produto, linha em
  Configurações)
- 08.2-08 Tarefas 1 e 2 (o pop-up de compra e a sua ligação)
- 08.2-09 Tarefas 1, 2 e 3 (amostra somente leitura, tags, página exclusiva, links escondidos)
- 08.2-10 Tarefas 1 e 2 (o formulário do produto, o aviso, o bloco "Acesso")
- 08.2-11 Tarefas 1 e 2 (Compradores e "Conceder acesso")

Cada uma carrega um `precondition` que afirma
`grep -q '^approved: true' .planning/sketches/008-phase-08.2-designed-screens/README.md` e que para
enquanto este arquivo disser `false`. Os planos de backend, esquema e portão (08.2-03 a 08.2-06)
não esperam por esta revisão.

**O registro é uma edição do usuário, não do agente.** Para aprovar, cole no frontmatter deste
arquivo, substituindo os valores pendentes:

- `status: approved`
- `approved: true`
- `approved_by: <seu nome>`
- `approved_at: <AAAA-MM-DD>`
- `approval_kind: provisional`

(Estas linhas ficam aqui como lista de propósito: o portão procura `approved: true` no início de uma
linha, e só a linha do frontmatter pode satisfazê-lo.)

Para pedir mudanças, liste-as em `changes_requested:` e deixe `approved: false` (e
`status: changes-requested`). O desenho é revisado e a revisão se repete. Onde o desenho aprovado e
o `08.2-UI-SPEC.md` discordarem, vale o desenho, e o UI-SPEC é corrigido no mesmo commit.

Seguindo o precedente dos sketches 001 a 006, **uma aprovação provisória do product owner já
desbloqueia a codificação**; deltas posteriores do designer são um passe de polimento, não um
bloqueio. A coluna Winner da linha 008 em `../MANIFEST.md` só é atualizada se você pedir.
