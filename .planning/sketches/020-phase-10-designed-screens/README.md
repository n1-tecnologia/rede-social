---
sketch: 020-phase-10-designed-screens
name: phase-10-designed-screens
phase: "10"
question: "As telas novas das publicações dos membros — a fila de stories em Explorar com o círculo do próprio membro e o '+', o menu e a exclusão no visualizador, a tela de publicar story do membro com o destino e o aviso de visibilidade, a seleção de destaques, a entrada 'Criar comunidade' com o aviso de limite, o 'Criada por' no card e no cabeçalho, os controles só do criador na comunidade, as confirmações do criador e do moderador com as três linhas novas do registro, o campo de limite no painel e os estados com a Rede social desligada ou o criador bloqueado — leem como a própria linguagem do protótipo, em claro e escuro, sob qualquer marca de tenant, em 320 e 390px?"
screens:
  - explorar-fila-membro-sem-story
  - explorar-fila-membro-com-story
  - explorar-fila-autores-novos-vistos
  - explorar-fila-glifo
  - explorar-fila-moderador
  - explorar-fila-moderador-carregando
  - explorar-fila-moderador-recarregar
  - explorar-fila-carregando
  - explorar-fila-vazia
  - explorar-fila-320
  - visualizador-menu-autor
  - visualizador-menu-moderador
  - confirma-excluir-story-autor
  - confirma-excluir-story-moderador
  - publicar-membro-antes
  - publicar-membro-sem-video
  - publicar-membro-depois
  - publicar-membro-video-processando
  - publicar-membro-video-longo
  - publicar-membro-320
  - destino-linha
  - destino-folha-membro
  - destino-aviso-tela
  - destaque-lista-membro
  - destaque-confirma-ligar
  - seus-stories-vazio
  - comunidades-criar-controle
  - comunidades-limite-aviso
  - comunidades-chips-membro
  - nova-limite-tela
  - forma-membro-linha-publico
  - forma-limite-alerta
  - card-criada-por
  - cabecalho-criada-por-membro
  - cabecalho-criada-por-voce
  - cabecalho-criada-por-texto
  - cabecalho-criada-por-320
  - pagina-criador
  - pagina-outro-membro
  - pagina-admin-comunidade-membro
  - pagina-admin-comunidade-org
  - pagina-criador-vazia
  - compositor-comunidade-linha
  - confirma-arquivar-criador
  - confirma-arquivar-moderador
  - confirma-excluir-moderador
  - moderacao-linha-story
  - moderacao-linha-arquivada
  - moderacao-linha-removida
  - plataforma-limites-campo
  - plataforma-limites-erro
  - plataforma-limites-320
  - social-desligado-criador
  - criador-bloqueado-nao-encontrada
  - story-bloqueado-nao-encontrado
status: approved
approved: true
approved_by: "Igor (recorded by Claude on Igor's instruction)"
approved_at: 2026-11-11
approval_kind: provisional
changes_requested: []
winner: null
tags: [phase-10, design-review, D-33, D-365, UI-04, social, member-stories, member-communities]
---

# Sketch 020: Fase 10 — Stories e comunidades dos membros, com a Rede social ligada (portão de revisão D-33 / D-365 / UI-04)

## Design Question

Com o módulo **Rede social** (`social`, Fase 9) ligado, a Fase 10 deixa o **membro** publicar stories e criar as
suas próprias comunidades, e faz a comunidade aceitar publicações só do seu dono. O protótipo do time de design
não tem a fila de stories em Explorar, a tela de publicar do membro, a entrada “Criar comunidade” com limite, o
“Criada por”, os controles só do criador nem o campo de limite no painel da plataforma, então essas superfícies
são **[designed]** e, pelas regras D-33, D-365 e D-417, precisam ser desenhadas e revisadas **antes de codar**
(UI-04). São dez grupos:

1. a **fila de Explorar** com o círculo do próprio membro e o “+”, os anéis de visto e não visto, o glifo, a
   linha do moderador e os estados de carregando e vazio (UI-D-697 a UI-D-700);
2. o **menu do visualizador** e as duas **confirmações de excluir story**, do autor e do moderador (UI-D-701);
3. a **tela de publicar story do membro**, antes e depois de escolher a mídia, com o vídeo em espera e o vídeo
   longo demais (UI-D-702 a UI-D-704);
4. a **linha de destino**, a folha de destino, o aviso de visibilidade, a **seleção de destaques** com a
   confirmação “Mostrar este story na comunidade?” e o “Seus stories” vazio (UI-D-704, UI-D-705);
5. a entrada **“Criar comunidade”** com o aviso de limite no lugar do controle, os chips do criador, a tela de
   limite e o alerta do formulário (UI-D-706, UI-D-707);
6. o **“Criada por”** no card e no cabeçalho: com link para o membro, “você” e texto simples (UI-D-708, UI-D-709);
7. a **matriz de controles só do criador** na página da comunidade: o criador, outro membro, um admin numa
   comunidade de membro, um admin numa comunidade da organização, a lista vazia do dono e a linha de destino do
   compositor (UI-D-710, UI-D-711);
8. as **confirmações do criador e do moderador** para arquivar e excluir, e as **três linhas novas** do
   registro de moderação (UI-D-712, UI-D-714);
9. a **folha de limites da plataforma** com o campo “Comunidades por membro”, o título e o rodapé reescritos
   (UI-D-715);
10. os estados com a **Rede social desligada** e com o **criador bloqueado**, que usam as telas de “não
    encontrado” já entregues (UI-D-716, UI-D-717).

A pergunta de design: tudo isso lê como a linguagem do protótipo — fundo `#f5f7fb` com cartões brancos, raios de
12px, alvos de 44px, a escala 12 / 14 / 16 / 24 com pesos 400 / 700 e **uma** cor de destaque, a marca do
tenant —, em claro e escuro, sob qualquer marca, em 320 e 390px? A Fase 10 não declara token, cor, fonte,
tamanho nem dependência nova; o desenho só combina as primitivas já entregues.

## How to View

```
open .planning/sketches/020-phase-10-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem framework, sem script remoto e sem imagem real. O arquivo abre
offline. É um artefato de revisão sob `.planning/`: nenhum código de aplicação o importa, empacota ou
referencia. Os tokens são os de `packages/ui/src/styles/tokens.css`.

Controles no topo (chrome do mockup, fora do produto): alternar tema claro e escuro, três marcas de tenant e a
largura 390 ou 320px. Cada quadro leva o seu nome em `data-frame` e na etiqueta. São **55 quadros** e a lista
`screens:` do topo deste arquivo é igual aos quadros desenhados, na ordem da página. Quatro quadros trazem o
390px e o 320px lado a lado (`explorar-fila-320`, `publicar-membro-320`, `cabecalho-criada-por-320`,
`plataforma-limites-320`). Nenhum anel de story aparece em avatar fora dos círculos de Explorar (D-704).

## O que se pede ao time de design

As perguntas do UI-SPEC (seção “Sketch gate”):

- **(a)** A fila de Explorar lê como uma lista só: o círculo do próprio membro com o selo “+”, os anéis de não
  visto (marca) e visto (neutro), e a linha do moderador com os círculos finais de carregando e “Recarregar”?
  Ver `explorar-fila-membro-sem-story`, `explorar-fila-membro-com-story`, `explorar-fila-moderador`.
- **(b)** O círculo do próprio membro, com o selo “+” de 24px e o anel que nunca vira cor de marca (UI-D-698),
  deixa claro que dali se publica e que, com story ativo, o toque abre o visualizador? Ver
  `explorar-fila-membro-sem-story`, `explorar-fila-membro-com-story`, `visualizador-menu-autor`.
- **(c)** A matriz de controles só do criador é a que o produto quer: criador, outro membro, admin numa
  comunidade de membro e admin numa comunidade da organização? Ver `pagina-criador`, `pagina-outro-membro`,
  `pagina-admin-comunidade-membro`, `pagina-admin-comunidade-org`.
- **(d)** “Criada por” como texto simples no card (o card inteiro é o link) e como link no cabeçalho, ou texto
  simples quando o perfil não abre, é aceitável? Ver `card-criada-por`, `cabecalho-criada-por-membro`,
  `cabecalho-criada-por-texto`.
- **(e)** O aviso de visibilidade da tela de publicar e da folha de destino, e o aviso de limite no lugar do
  controle “Criar comunidade”, leem bem antes de “Publicar” e de “Criar”? Ver `destino-aviso-tela`,
  `publicar-membro-depois`, `comunidades-limite-aviso`, `plataforma-limites-campo`.

Comece por `explorar-fila-membro-sem-story` e `pagina-criador`: se esses dois quadros estão certos, o resto
segue as mesmas primitivas.

## Perguntas OQ-1..OQ-7: respondidas, padrão aceito

As sete perguntas abertas do UI-SPEC (seção “Open questions for the owner”) foram respondidas pelo Igor em
**2026-11-11** (“sim pra tudo”): **o padrão do UI-SPEC foi aceito nas sete**, e é o que está desenhado.
Continuam listadas aqui para a revisão do desenho poder derrubar qualquer uma, com o custo de mudar:

| # | Pergunta | Padrão desenhado (resposta: padrão aceito) |
|---|----------|--------------------------------------------|
| **OQ-1** | D-714 (“sem segunda entrada”) contra D-706 (o dono publica na própria comunidade) | O círculo “+” da comunidade abre **a mesma tela de publicar do membro** com a comunidade já escolhida; o menu do próprio círculo tem “Publicar novo story”. Quadros `destino-linha`, `pagina-criador`, `visualizador-menu-autor`. |
| **OQ-2** | D-703 (o nome abre o perfil do membro, no card e no cabeçalho) | **Card:** texto simples, o card é o link. **Cabeçalho:** o nome é link onde o perfil abre, texto simples nos outros casos. Quadros `card-criada-por`, `cabecalho-criada-por-texto`. |
| **OQ-3** | D-711 (o moderador arquiva ou remove) contra D-713 (o criador reativa e exclui as arquivadas) | O criador pode **reativar uma comunidade que o moderador arquivou** (os dois casos aparecem iguais para ele); remover continua em **dois passos**, arquivar e depois excluir. Quadros `confirma-arquivar-moderador`, `confirma-excluir-moderador`. |
| **OQ-4** | D-709 com o UI-D-509 (a marca “Administrador” segue a audiência carimbada) | A marca **nunca** aparece num post de membro; o contrato do feed ganha um campo com o tipo do autor. É regra de dados, sem quadro próprio. |
| **OQ-5** | D-710 (limite por membro, “padrão 3”, sem faixa nem significado do 0) | Faixa **0 a 20, padrão 3**; **0 = membros não criam** (controle ausente, sem aviso); arquivadas e removidas não contam. Quadros `plataforma-limites-campo`, `plataforma-limites-erro`. |
| **OQ-6** | D-716 (“diz antes de confirmar”) | O aviso fica **sempre visível** acima das linhas **e** ligar um destaque pergunta uma vez por abertura da folha (“Mostrar este story na comunidade?”); em “Publicar”, o aviso está logo acima do botão. Quadros `destaque-lista-membro`, `destaque-confirma-ligar`. |
| **OQ-7** | D-705 (a leitura, as curtidas e os comentários seguem o portão de seguidor) contra D-716 (story salvo em destaque é lido por todos) | Curtir e comentar são **desenhados** num story de destaque exatamente como num destaque da organização; a API precisa permitir para quem lê a comunidade, ou o planejamento os remove e a interface os esconde. |

## Os padrões da pesquisa que o product owner pode derrubar (dez confirmações pendentes)

O UI-SPEC foi escrito sem poder perguntar nada e registrou dez padrões na seção “Pending User Confirmation”.
**São padrões do pesquisador, e o Igor pode derrubar qualquer um nesta revisão.** Os três que coincidem com as
perguntas OQ acima (3 = OQ-6, 5 e 8 = OQ-5, 7 = OQ-3) já foram aceitos; os demais continuam abertos até a
aprovação:

1. **O anel do próprio círculo nunca vira cor de marca**, e o selo é o “+” original do UI-D-28 (UI-D-698).
   Alternativa: o anel segue o visto do próprio autor, ou o disco `Plus` centralizado do admin.
2. **O vídeo do membro precisa estar `ready` antes de “Publicar” habilitar** num story (UI-D-703). Alternativa:
   publicar durante o processamento, como o story do admin (enfraquece o limite de duração; não recomendado).
3. **Ligar um destaque pergunta uma vez por abertura da folha** (UI-D-705, OQ-6). Aceito.
4. **A linha do moderador pagina de 20 em 20** e uma página que falha deixa um círculo “Recarregar” (UI-D-699).
5. **O aviso de limite substitui o controle** e “Arquive uma” é a única dica; limite 0 não mostra nada
   (UI-D-706, OQ-5). Aceito.
6. **Os chips “Ativas · Arquivadas” só aparecem enquanto o membro tem uma comunidade arquivada** (UI-D-706).
   Alternativa: sempre mostrar para um criador.
7. **A remoção de uma comunidade pelo moderador tem dois passos**: arquivar e depois excluir, como já é
   entregue (UI-D-714, OQ-3). Aceito.
8. **A faixa do campo da plataforma é 0 a 20, padrão 3** (UI-D-715, OQ-5). Aceito.
9. **“Seus stories” abre para qualquer membro que possa publicar**, só a partir do cabeçalho de publicar
   (UI-D-705). Alternativa: sem histórico para membros, ou uma porta pelo perfil.
10. **Quem não é o dono e digita `/criar?comunidade={id}` cai em silêncio** no compositor comum do membro
    (UI-D-710). Alternativa: redirecionar para a página da comunidade.

### Suposições do planejamento que o Igor confirma na mesma sentada

Estas não são padrões de desenho, são regras que o código vai seguir ao pé da letra. Aprovar o sketch as confirma;
o Igor pode mudar qualquer uma (texto literal dos planos 03, 05, 06 e 07):

- **A1** (plano 03): as comunidades de membro ordenam depois das da organização por uma posição sentinela
  `position = 1000000` garantida por CHECK, sem mudar a instrução da lista, o índice nem o cursor. Alternativa:
  ordem começando por `kind` com um índice parcial novo, outro formato de cursor e as asserções de EXPLAIN dos
  pgTAP 110/111 refeitas.
- **A2** (plano 05): chaves de permissão novas só de membro, `communities.community.create` e
  `communities.community.manage_own`, e `stories.story.publish` reaproveitada para membros. Alternativa: dar aos
  membros `communities.community.manage`, o que viraria reordenar, a leitura de arquivadas e o formulário da loja
  para os membros.
- **A3** (plano 06): quem tem `moderation.manage` pode remover **um** post dentro de uma comunidade de membro; a
  ação grava a linha `post_removed` no mesmo registro, não avisa o criador e funciona com a Rede social
  desligada, para que a única saída contra um post ruim não seja arquivar a comunidade inteira. É separável: sai
  com uma tarefa e um requisito (MCOMM-11).
- **A7** (plano 07): o id de usuário de outro membro **não** é enviado nos stories de membros. `authorUserId`
  passa a ser anulável e só vem preenchido para o próprio autor; o autor viaja como `author { membershipId,
  displayName, avatarUrl }`. Consequência de implantação: o web precisa ser publicado **antes** de a API parar de
  enviar o campo antigo (o plano 15 registra essa ordem).
- **A8** (plano 05): um admin que edita o nome, a descrição ou a capa de uma comunidade de membro **pode**, e a
  edição **não** é registrada (o D-711 registra só arquivar e remover). Alternativa: registrar uma ação
  `community_updated`, ou restringir o admin a arquivar e excluir.

## Textos de exemplo no desenho

O texto vem do Copywriting Contract do UI-SPEC onde ele existe. O desenho também mostra, só como **contexto
das telas já entregues** e marcados como exemplo, estes textos que o UI-SPEC não define e que não estão em
revisão: o rótulo “Criar” do botão do formulário; “Nova publicação”, “Escreva algo para a comunidade…”,
“Adicionar foto” e “Adicionar vídeo” do compositor do Início; o título “Moderação”; os números da folha da
plataforma (4 fotos, 5 MB, 30 s, 50 MB e as faixas dos outros cinco campos, que usam os rótulos já entregues em
`platformModules.social.json`); e os nomes de demonstração (Helena, Marcos, Tânia, Beto, Lia, Rafael, Bruna) e de
comunidades (“Horta em casa”, “Receitas da vizinhança”, “Troca de sementes”, “Clube do livro de domingo”). **Pergunta
ao time de design:** algum desses exemplos mascara um problema de largura ou de quebra de linha que um nome real
mais longo causaria em 320px?

## Decisões travadas a montante (não se rediscutem aqui)

D-701 a D-718 do `10-CONTEXT.md` e UI-D-697 a UI-D-720 do `10-UI-SPEC.md` (as decisões visuais) estão fixadas.
Esta revisão só pergunta se o **desenho** as cumpre, e confirma ou derruba as perguntas e suposições acima.

## Como revisar e como o resultado é registrado

1. Abra o `index.html`, alterne tema claro e escuro, troque entre as marcas e a largura 320px, e confira os
   quadros de 320px.
2. Comece por `explorar-fila-membro-sem-story` e `pagina-criador`.
3. **Quem registra o resultado é o Igor**, editando o frontmatter deste arquivo. Para aprovar, troque os valores
   pendentes por estes:

       status: approved
       approved: true
       approved_by: <seu nome>
       approved_at: <AAAA-MM-DD>
       approval_kind: provisional

   Para pedir mudanças, liste-as em `changes_requested:` e deixe `approved: false`; o desenho é então revisado e
   a revisão se repete. Se o Igor dispensar o portão, ele registra a dispensa como decisão no `10-CONTEXT.md`, e
   os planos 11 a 15 largam a guarda; o mínimo que ainda vale olhar são os dois quadros acima.

Enquanto este arquivo disser `approved: false`, **todas as tarefas de tela da Fase 10 (planos 11 a 15) param na
precondição**. Os planos de banco, contrato, núcleo e API (03 a 10) não dependem desta aprovação e seguem.
