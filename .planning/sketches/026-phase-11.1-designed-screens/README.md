---
sketch: 026-phase-11.1-designed-screens
name: phase-11.1-designed-screens
phase: "11.1"
question: "As telas novas das permissões de quem comprou, por produto, numa comunidade: as cinco caixas Curtir, Comentar, Compartilhar, Postar na comunidade e Postar story sob cada comunidade do produto (com as linhas de ajuda), a chave Aberto a compradores na folha de editar destaque e a pílula Compradores na lista, o que o membro vê quando um controle some (a linha de ações do post, a folha de comentários, os botões de publicar, o + da faixa de stories, os Reels, o detalhe), o fluxo de story do comprador só em destaques abertos, o fluxo de publicação pela página da comunidade e a recusa neutra, leem como a própria linguagem do protótipo, em claro e escuro, sob qualquer marca de tenant, em 320 e 390px? 47 quadros em cinco grupos mais três de nota; aprovação pendente (só o Igor escreve a linha approved)."
screens:
  - produto-permissoes-novo-vinculo
  - produto-permissoes-varias-comunidades
  - produto-permissoes-todas-e-nenhuma
  - produto-permissoes-social-desligada
  - produto-permissoes-sem-destaque-aberto
  - produto-permissoes-edicao-existente
  - produto-permissoes-320
  - produto-comunidade-aviso-exclusiva
  - produto-permissoes-erro-ao-salvar
  - destaque-editar-aberto-desligado
  - destaque-editar-aberto-ligado
  - destaque-editar-gravando-e-erro
  - destaque-editar-sem-a-chave
  - destaques-lista-com-selo
  - destaques-lista-320
  - destaque-editar-social-desligada
  - post-acoes-completas
  - post-acoes-sem-curtir
  - post-acoes-sem-comentar
  - post-acoes-sem-compartilhar
  - post-acoes-so-contagens
  - comentarios-sem-campo
  - comentarios-sem-curtir-comentario
  - comentarios-vazio-leitura
  - comunidade-sem-publicar
  - comunidade-com-publicar
  - faixa-de-stories-com-e-sem-mais
  - inicio-post-de-comunidade-sem-acoes
  - reel-sem-curtir
  - post-detalhe-sem-comentar
  - comunidade-bloqueada-amostra-inalterada
  - story-publicar-destino-comprador
  - story-publicar-destino-aviso
  - story-publicar-sem-destaque-aberto
  - story-meus-destacar-comprador
  - story-meus-destacar-confirmar
  - story-meus-remover-do-destaque
  - story-meus-sem-destacar
  - story-publicar-recusa
  - story-destacar-recusa-destaque-fechado
  - postar-comprador-composer
  - postar-comprador-publicado-na-comunidade
  - postar-comprador-recusa
  - comunidade-post-de-membro-menus
  - matriz-estados-comprador
  - leitor-de-tela-fase-11-1
  - defaults-a-confirmar-fase-11-1
status: approved
approved: true
approved_by: Igor (recorded by Claude on Igor's instruction)
approved_at: 2026-11-25
approval_kind: provisional
changes_requested: []
winner: null
tags: [phase-11.1, design-review, D-417, UI-04, buyer-permissions, store, highlights]
---

# Sketch 026: Fase 11.1 — Permissões de quem comprou, por produto, numa comunidade (portão de revisão D-33 / D-365 / D-417 / UI-04)

## Design Question

Hoje um produto da loja só diz quais comunidades quem o comprou enxerga (Fase 08.2). A Fase 11.1 faz o produto dizer
também **o que o comprador pode fazer em cada uma delas**: curtir, comentar, compartilhar, postar na comunidade e postar
story. Para a equipe isso vira cinco caixas por comunidade no formulário do produto e uma chave "Aberto a compradores" em
cada destaque. Para o membro, a mudança é quase só uma ausência: o controle que o produto não permite **não existe** na
tela (nem cinza, nem cadeado, nem frase explicando), e os vizinhos fecham o espaço. Como o protótipo do time de design
não tem permissão por produto, nem papel de comprador, nem formulário de produto, nem tela de destaques, estas superfícies
são **[designed]** e, pelas regras D-33, D-365 e D-417, precisam ser desenhadas e revisadas **antes de codar** (UI-04).
São cinco grupos de portão e três quadros de nota:

- G1 · O formulário do produto (9 quadros)
- G2 · As telas de destaque da equipe (7 quadros)
- G3 · O que o membro vê quando um controle some (15 quadros)
- G4 · O fluxo de story de quem comprou (9 quadros)
- G5 · O fluxo de publicação de quem comprou (4 quadros)
- Notas (3 quadros de anotação, fora dos cinco grupos): a matriz de estados, as frases do leitor de tela e a
  tabela dos padrões a confirmar

A pergunta de design: tudo isso lê como a linguagem do protótipo (fundo `#f5f7fb` com cartões brancos, raios de 12px,
alvos de 44px, a escala 12 / 14 / 16 com pesos 400 / 700 e **uma** cor de destaque, a marca do tenant), em claro e escuro,
sob qualquer marca (inclusive o Amarelo claro e o Marinho escuro), em 320 e 390px? A Fase 11.1 não declara token, cor,
fonte, tamanho, glifo nem dependência nova; o desenho só combina as primitivas já entregues.

## How to View

```
open .planning/sketches/026-phase-11.1-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem framework, sem script remoto e sem imagem real. O arquivo abre offline. É um
artefato de revisão sob `.planning/`: nenhum código de aplicação o importa, empacota ou referencia. Os quadros são
estáticos (as caixas de marcar e o rodízio de tema, marca e largura funcionam).

Controles no topo (chrome do mockup, fora do produto): tema claro e escuro, as marcas de tenant (Azul, Verde, Coral,
**Amarelo claro** e **Marinho escuro**) e a largura 390 ou 320px. Cada quadro leva o seu nome em `data-frame` e na
etiqueta. São **47 quadros** e a lista `screens:` do topo deste arquivo é igual aos quadros desenhados, na ordem da
página. Todos usam a mesma linha do tempo de exemplo (segunda-feira, 23 de novembro de 2026, 10:00); a organização, os
produtos, as comunidades e os membros são fictícios e não há e-mail, foto, preço ou mensagem reais.

## O que olhar, em que ordem

1. **O formulário do produto (G1).** `produto-permissoes-varias-comunidades`, `produto-permissoes-edicao-existente` e
   `produto-permissoes-320`: as cinco caixas sob cada comunidade e o aviso "As permissões valem para quem já tem o
   produto…".
2. **As duas linhas de ajuda (G1).** `produto-permissoes-social-desligada` e `produto-permissoes-sem-destaque-aberto`.
3. **O destaque (G2).** `destaque-editar-aberto-desligado`, `destaques-lista-com-selo` e `destaques-lista-320`.
4. **A ausência (G3), o que mais pesa.** `post-acoes-sem-comentar`, `post-acoes-so-contagens` e `reel-sem-curtir`: a
   linha fecha o espaço e ninguém sente falta de nada? Depois `comentarios-sem-campo`, `comunidade-sem-publicar` e
   `faixa-de-stories-com-e-sem-mais`.
5. **O story do comprador (G4).** `story-publicar-destino-comprador`, `story-meus-destacar-comprador` e
   `story-publicar-sem-destaque-aberto`.
6. **A recusa neutra (G4 e G5).** `story-publicar-recusa` e `postar-comprador-recusa`.
7. **Por último, `defaults-a-confirmar-fase-11-1`:** a tabela com cada suposição, o que está desenhado, a alternativa e
   quanto custa trocar. Responda cada linha com "manter" ou "trocar". As notas `matriz-estados-comprador` e
   `leitor-de-tela-fase-11-1` não pedem aprovação de pixel.

## As sete perguntas ao time de design (uma por grupo)

- **(a) O formulário do produto.** Os cinco campos de marcar sob cada comunidade ficam fáceis de ler e de tocar, sem
  encher o formulário quando há várias comunidades, e o aviso "As permissões valem para quem já tem o produto…" tranquiliza
  sem assustar? Ver `produto-permissoes-varias-comunidades`, `produto-permissoes-edicao-existente`,
  `produto-permissoes-320`.
- **(b) Rede social desligada.** Com a Rede social desligada, deixar "Postar na comunidade" e "Postar story" editáveis com
  uma linha de aviso é melhor que desativá-los? Ver `produto-permissoes-social-desligada`,
  `produto-permissoes-sem-destaque-aberto`.
- **(c) O destaque.** A chave "Aberto a compradores" na folha de editar destaque, entre a posição e os stories, é fácil
  de achar logo depois de criar um destaque, e o selo "Compradores" na lista distingue os círculos abertos sem poluir? Ver
  `destaque-editar-aberto-desligado`, `destaques-lista-com-selo`, `destaques-lista-320`.
- **(d) A linha de ações do post.** Quando o produto não permite uma ação, a linha de ações do post fechando o espaço (e
  sumindo inteira quando não há nenhuma) lê como um post normal, sem parecer que algo quebrou? Ver
  `post-acoes-sem-comentar`, `post-acoes-so-contagens`, `reel-sem-curtir`.
- **(e) Comentários e comunidade.** A folha de comentários sem o campo e a linha "Nenhum comentário ainda." leem
  naturais, e a comunidade sem botão de publicar e sem o "+" nas stories não deixa um vazio estranho? Ver
  `comentarios-sem-campo`, `comunidade-sem-publicar`, `faixa-de-stories-com-e-sem-mais`.
- **(f) O story do comprador.** O comprador salvar o próprio story só em destaques abertos, com o aviso "Todos os membros
  verão este story na comunidade." mantido, fica claro sem explicar compra nem permissão? Ver
  `story-publicar-destino-comprador`, `story-meus-destacar-comprador`, `story-publicar-sem-destaque-aberto`.
- **(g) A recusa neutra.** Depois de um reembolso, a recusa neutra ("Você não pode publicar nesta comunidade." e o aviso
  genérico) é aceitável para o comprador que ainda via o controle? Ver `story-publicar-recusa`,
  `postar-comprador-recusa`.

## Os padrões que o product owner pode pedir para trocar (A-UI-1..A-UI-16)

São os padrões do pesquisador de UI da Fase 11.1: cada um é o caminho mais conservador compatível com o que já existe e
**nenhum muda uma decisão travada** (D-880 a D-892). Você pode derrubar qualquer um com uma linha, nesta revisão. O
quadro `defaults-a-confirmar-fase-11-1` os repete.

| # | O que está desenhado (padrão) | A alternativa | Custo de trocar |
|---|---------------|---------------|-----------------|
| A-UI-1 | As cinco caixas sempre desenhadas sob cada comunidade, uma coluna, sem recolher. | Um “Permissões” que abre por comunidade, com resumo de uma linha. | Estado de abrir, função do resumo e regra de foco; formulário mais curto com muitas comunidades. |
| A-UI-2 | A caixa é o campo nativo com a cor da marca, na linha inteira de 44px, sem peça nova. | Uma peça Checkbox nova em packages/ui. | Peça e testes novos; seria a primeira dessa pasta. |
| A-UI-3 | Com a Rede social desligada as duas caixas de publicar seguem editáveis, com uma linha de aviso por formulário. | Desativar as duas caixas com a linha ao lado; ou escondê-las. | Controle desativado não leva descrição para leitor de tela e impede preparar antes de ligar; esconder muda o modelo mental. |
| A-UI-4 | Sem confirmação ao desmarcar uma permissão; uma frase diz que vale ao salvar; o aviso de “tornar exclusiva” só para comunidades recém-ligadas. | Um diálogo com o número de compradores afetados antes de salvar. | Leitura nova como a da D-364 e um diálogo; o dado (compradores por marca) seria novo. |
| A-UI-5 | A linha de “nenhum destaque aberto” é texto simples, só com “Postar story” marcada e zero conhecido. | Um link para a tela de destaques da comunidade; ou uma linha permanente. | Link sairia de um formulário com alterações não salvas; linha permanente é ruído para quem não usa story. |
| A-UI-6 | Remover uma comunidade e escolher de novo na mesma sessão recomeça dos padrões. | Lembrar as marcas até fechar o formulário. | Mapa de sessão no formulário; valor baixo, surpresa pequena. |
| A-UI-7 | A chave mora só na folha de editar, entre “Posição” e “Stories neste destaque”; a etapa de criar segue um campo só. | Também na etapa de criar; ou no topo, abaixo de “Nome”. | Mexe na geometria da etapa de criar e no “criar no compositor”, para uma chave que raramente se quer num círculo novo. |
| A-UI-8 | A chave grava na hora, sem botão de salvar. | Gravar junto com “Salvar nome”. | Dois caminhos de salvar na mesma folha e um estado de alteração pendente. |
| A-UI-9 | Sem confirmação ao fechar o destaque; a frase diz o que fica. | Um diálogo “Fechar para compradores?”. | Um diálogo a mais; nada se perde ao fechar. |
| A-UI-10 | A marca da lista é a pílula neutra “Compradores”; os itens da folha de editar não ganham linha de autor. | Uma palavra mais longa na pílula; o nome do autor em cada item de um destaque aberto. | A palavra longa corta em 320px; a linha de autor é um elemento a mais só da equipe (o visualizador já mostra o autor). |
| A-UI-11 | Os metadados mantêm as contagens como texto quando curtir ou comentar some; a contagem de comentários segue botão da lista só para leitura. | Esconder a contagem de curtidas com o coração e a de comentários com o balão. | O montador dos metadados por controle; a contagem é conteúdo e esconder tira o sinal de atividade da comunidade. |
| A-UI-12 | Um dado por publicação com as ações da pessoa, só em posts de comunidade da organização; ausente vale tudo. | Uma segunda chamada por cartão; ou esconder os três controles em todo post de comunidade. | N+1 ou leitura em lote; a segunda esconde controles que a pessoa pode usar. |
| A-UI-13 | Sem destaque aberto os pontos de entrada somem, inclusive o “+” da comunidade. | Manter o “+” e abrir o compositor em “Nenhum” (Explorar). | O “+” prometeria um story da comunidade que não entrega; o caminho de Explorar segue pelo Início. |
| A-UI-14 | A pessoa publica só pela página da comunidade; /criar não ganha seletor de destino. | Uma linha “Publicar em” no compositor do membro com as comunidades permitidas. | Uma linha nova e seus estados; a Fase 10 (UI-D-504) manteve o compositor do membro sem seletor. |
| A-UI-15 | Sem sinal em tempo real nem sondagem: o controle some na próxima atualização, o servidor recusa enquanto isso, o compositor recusado desativa “Publicar” com a frase neutra. | Reler as ações por um sinal novo; ou virar em silêncio o compositor de Explorar. | Um sinal novo, sua assinatura e testes; a troca silenciosa muda para onde vão as palavras da pessoa, por isso não é recomendada. |
| **A-UI-16** | Um sketch só (este, 026) leva todos os quadros novos; as peças de banco, contrato, API e funções puras não esperam por ele. | Dois sketches (telas do administrador primeiro, as do membro depois). | Uma segunda aprovação; as telas do administrador poderiam sair antes. Se você prefere dois, diga aqui. |

**A-UI-16 diz respeito a esta própria revisão.** Se você aprovar este sketch, confirma que um só sketch vale para todas as
telas novas da Fase 11.1 (as peças de banco, contrato, API, worker, funções puras de vista e catálogo não esperam por ele).

Dois pontos que o desenho deixou para você ver:

- **Nome de comunidade em 320px.** O contrato do UI-SPEC diz que o nome de 60 caracteres "quebra com break-words" na
  linha da comunidade; a linha entregue do formulário corta o nome com reticências (o nome inteiro fica no nome acessível
  do "X"). `produto-permissoes-320` desenha a linha entregue. Se você quer a quebra, diga "trocar".
- **A faixa da comunidade trancada.** `comunidade-bloqueada-amostra-inalterada` desenha a faixa entregue na Fase 08.2 só
  como um marcador de contexto (o texto dela fala em compra, então não o redesenhamos aqui); nada nela muda nesta fase.

## O que a revisão do desenho não consegue provar

Estas provas são do Igor e não dá para fazê-las localmente (o celular não alcança `*.localhost`); entram como linhas
manuais do ledger da fase:

- o formulário do produto e a chave de destaque num celular de verdade, em 320 e em 390px;
- um post e um story de comprador, num celular de verdade, no domínio próprio do tenant;
- um reembolso pelo gateway com a tela do comprador aberta e, depois, a próxima atualização;
- as frases do leitor de tela (`leitor-de-tela-fase-11-1`) no VoiceOver e no TalkBack.

## Decisões travadas a montante (não se rediscutem aqui)

D-880 a D-892 do `11.1-CONTEXT.md` e UI-D-882 a UI-D-898 do `11.1-UI-SPEC.md` (as decisões visuais) estão fixadas. Esta
revisão só pergunta se o **desenho** as cumpre, e confirma ou derruba os padrões acima. Fora de revisão (nada novo a
desenhar): a casca do formulário do produto, o seletor e o diálogo de exclusividade (08.2, 08.4), as outras seções da folha
de destaque e a geometria da lista (05.2), o compositor de story, a folha de destino e o aviso de visibilidade (10), o
compositor de publicação do membro (10), o cartão da publicação, a folha de comentários, o visualizador de Reels e a página
da comunidade, e os avisos e esqueletos já entregues.

## Como revisar e como o resultado é registrado

1. Abra o `index.html`, alterne tema claro e escuro, troque entre as marcas (acima de tudo o Amarelo claro) e a largura
   320px, e confira os quadros de 320px.
2. Comece por `post-acoes-so-contagens` e `produto-permissoes-varias-comunidades`, e termine em
   `defaults-a-confirmar-fase-11-1`.
3. **Quem registra o resultado é o Igor**, editando o frontmatter deste arquivo. Para aprovar, troque os valores
   pendentes por estes (o exemplo está recuado de propósito, para nenhuma verificação ler a aprovação como já dada):

       status: approved
       approved: true
       approved_by: <seu nome>
       approved_at: <AAAA-MM-DD>
       approval_kind: provisional

   Para pedir mudanças, deixe `approved: false` e liste em `changes_requested:` o nome do quadro e o que muda.
   **Nenhum agente e nenhum plano escreve essa aprovação.** Se você disser "faz você", o Claude pode registrar por você,
   mas só depois da sua palavra. Uma aprovação provisória já abre o portão; os ajustes do time de design depois são um
   polimento.
4. Todo plano de tela da Fase 11.1 (12 a 17) começa com `grep -q '^approved: true'` neste arquivo e para se a linha não
   existir. Os planos de banco, contrato, API, worker, funções de vista, catálogo e segurança (02 a 11) não dependem desta
   aprovação e seguem sem ela.
5. Se você dispensar o portão, registre a dispensa como uma decisão no `11.1-CONTEXT.md`; os planos 12 a 17 então largam
   o guarda. O menor pedaço que ainda vale olhar é o par `post-acoes-so-contagens` e `produto-permissoes-varias-comunidades`.

## Sources

- `.planning/phases/11.1-permissoes-do-comprador-por-produto-numa-comunidade/11.1-UI-SPEC.md` (o contrato, seções "Defaults chosen" e "Sketch gate") e `11.1-CONTEXT.md` (D-880 a D-892).
- Sketches 024 e 025 (a casca, as marcas de tenant, o relógio, as convenções de quadro), o sketch 008 (a faixa da comunidade
  trancada) e `packages/ui/src/styles/tokens.css`.
