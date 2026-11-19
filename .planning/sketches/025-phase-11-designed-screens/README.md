---
sketch: 025-phase-11-designed-screens
name: phase-11-designed-screens
phase: "11"
question: "As telas novas das mensagens diretas, do bloqueio entre membros e das denúncias — a lista Conversas e o balão do topo, a conversa com a faixa fechada, a faixa de quem bloqueou e a de membro removido, 'Enviar mensagem' no perfil e na linha de Membros, os menus e folhas de denunciar e bloquear nos cinco assuntos, a fila de denúncias com os quatro assuntos novos e a mensagem inteira ou em áudio, e as linhas do sino 'começou a te seguir' e 'Nova denúncia' — leem como a própria linguagem do protótipo, em claro e escuro, sob qualquer marca de tenant, em 320 e 390px? 64 quadros em cinco grupos; aprovação pendente (só o Igor escreve a linha approved)."
screens:
  - post-menu-denunciar
  - comentario-menu
  - denunciar-folha
  - denunciar-enviando
  - denunciar-erro
  - denunciar-ja-feita
  - bloquear-dialogo
  - bloqueados-linha
  - bloqueados-lista
  - bloqueados-vazio
  - denuncias-linha-moderacao
  - denuncias-lista
  - denuncias-vazio
  - denuncias-resolver-folha
  - denuncias-remover-dialogo
  - denuncias-320
  - conteudo-bloqueado-oculto
  - story-menu-denunciar
  - story-comentario-menu
  - comunidade-menu-denunciar
  - denunciar-folha-assuntos
  - denunciar-folha-mensagem
  - denunciar-folha-mensagem-voz
  - bloquear-dialogo-rede-social
  - barra-superior-conversas
  - conversas-lista
  - conversas-previas
  - conversas-sem-diretas
  - conversas-carregando
  - conversas-erro
  - conversas-320
  - conversa-nova-vazia
  - conversa-aberta
  - conversa-com-voz
  - conversa-menu-mensagem
  - conversa-fechada-sem-aviso
  - conversa-voce-bloqueou
  - conversa-recusa-ao-enviar
  - conversa-membro-removido
  - conversa-nao-encontrada
  - conversa-320
  - perfil-enviar-mensagem
  - perfil-enviar-mensagem-320
  - perfil-voce-bloqueou
  - perfil-sem-botoes
  - membros-linha-mensagem
  - membros-linha-320
  - membros-linhas-estados
  - denuncias-linha-story
  - denuncias-linha-comentario-de-story
  - denuncias-linha-comunidade
  - denuncias-linha-mensagem
  - denuncias-linha-mensagem-voz
  - denuncias-linha-mensagem-apagada
  - denuncias-resolver-mensagem
  - denuncias-resolver-comunidade
  - denuncias-arquivar-dialogo
  - denuncias-320-novos-assuntos
  - sino-comecou-a-te-seguir
  - sino-nova-denuncia
  - avisos-push-fase-11
  - estados-rede-social-ligada-e-desligada
  - leitor-de-tela-fase-11
  - defaults-a-confirmar-fase-11
status: approved
approved: true
approved_by: Igor
approved_at: 2026-11-19
approval_kind: provisional
changes_requested: []
winner: null
tags: [phase-11, design-review, D-33, D-365, D-417, UI-04, direct-messages, reports, D-616]
---

# Sketch 025: Fase 11 — Mensagens diretas, bloqueio entre membros e denúncias (portão de revisão D-33 / D-365 / D-417 / UI-04)

## Design Question

Hoje o chat só leva o membro à equipe de suporte. A Fase 11 deixa um membro escrever a outro membro (uma conversa por
par, com texto e com a mensagem de voz da Fase 12.5), faz o bloqueio de um membro valer também para as mensagens e para
o seguir, e leva a denúncia a mais quatro assuntos: story, comentário de story, comunidade e mensagem. Junto vêm as
telas de denunciar e bloquear que o plano 13-20 da Fase 13 nunca entregou: elas passam a ser construídas por esta fase,
a partir deste desenho, e a sua aprovação aqui é também o portão delas. Como o protótipo do time de design não tem nada
disso, estas superfícies são **[designed]** e, pelas regras D-33, D-365 e D-417, precisam ser desenhadas e revisadas
**antes de codar** (UI-04). São cinco grupos de portão e três quadros de nota:

- G1 · Denunciar e bloquear (24 quadros, 17 trazidos do sketch 017 e redesenhados com as mudanças da Fase 11)
- G2 · Conversas e a conversa direta (17 quadros)
- G3 · Os pontos de entrada: perfil e linha de Membros (7 quadros)
- G4 · A fila de denúncias do administrador (10 quadros)
- G5 · Os avisos: sino e push (3 quadros)
- Notas (3 quadros de anotação, fora dos cinco grupos): estados com a Rede social ligada e desligada, frases do leitor
  de tela e a tabela de padrões a confirmar

A pergunta de design: tudo isso lê como a linguagem do protótipo — fundo `#f5f7fb` com cartões brancos, raios de 12px,
alvos de 44px, a escala 12 / 14 / 16 / 24 com pesos 400 / 700 e **uma** cor de destaque, a marca do tenant —, em claro e
escuro, sob qualquer marca (inclusive o Amarelo claro e o Marinho escuro), em 320 e 390px? A Fase 11 não declara token,
cor, fonte, tamanho nem dependência nova; o desenho só combina as primitivas já entregues.

## How to View

```
open .planning/sketches/025-phase-11-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem framework, sem script remoto e sem imagem real. O arquivo abre offline. É um
artefato de revisão sob `.planning/`: nenhum código de aplicação o importa, empacota ou referencia. Os quadros são
estáticos.

Controles no topo (chrome do mockup, fora do produto): tema claro e escuro, as marcas de tenant (Azul, Verde, Coral,
**Amarelo claro** e **Marinho escuro**) e a largura 390 ou 320px. Cada quadro leva o seu nome em `data-frame` e na
etiqueta. São **64 quadros** e a lista `screens:` do topo deste arquivo é igual aos quadros desenhados, na ordem da
página. Todos usam a mesma linha do tempo de exemplo: o "agora" é quinta-feira, 19 de novembro de 2026, 14:20; o
cliente e os membros são fictícios; nomes e textos são exemplos e não há e-mail real.

## O que olhar, em que ordem

1. **A conversa direta (G2).** `conversa-aberta`, `conversa-com-voz` e `conversa-320`: a gaveta com as reticências ao
   lado de cada mensagem recebida, no 320px mais apertado.
2. **As três faixas no lugar do campo (G2).** `conversa-fechada-sem-aviso`, `conversa-voce-bloqueou` e
   `conversa-membro-removido`. Se você só puder olhar um par de quadros, olhe `conversa-fechada-sem-aviso` e
   `conversa-voce-bloqueou`: é o que mais pesa na regra de que quem foi bloqueado não descobre o motivo.
3. **Conversas (G2).** `conversas-lista` e `conversas-sem-diretas`: a linha do suporte fixada em primeiro.
4. **O perfil e a linha de Membros (G3).** `perfil-enviar-mensagem`, `perfil-voce-bloqueou`, `perfil-sem-botoes` e
   `membros-linha-320`.
5. **Denunciar e bloquear (G1).** `denunciar-folha-assuntos`, `denunciar-folha-mensagem` e
   `bloquear-dialogo-rede-social`: sem um muro de vermelho.
6. **A fila (G4).** `denuncias-linha-mensagem-voz`, `denuncias-resolver-comunidade` e
   `denuncias-320-novos-assuntos`.
7. **O sino (G5).** `sino-comecou-a-te-seguir` e `sino-nova-denuncia`.
8. **Por último, `defaults-a-confirmar-fase-11`:** a tabela com cada suposição, o que está desenhado, a alternativa e
   quanto custa trocar. Responda cada linha com "manter" ou "trocar". As notas `avisos-push-fase-11`,
   `estados-rede-social-ligada-e-desligada` e `leitor-de-tela-fase-11` não pedem aprovação de pixel.

## As sete perguntas ao time de design (uma por grupo)

- **(a) A conversa como mensagem de um amigo.** O cabeçalho com a foto e o nome, o fio sem rótulo e a gaveta com as
  reticências ao lado de cada mensagem recebida leem como a linguagem do protótipo, sem poluir a conversa nem ficar
  escondidas? Ver `conversa-aberta`, `conversa-com-voz`, `conversa-320`.
- **(b) As três faixas no lugar do campo.** A fechada, "Você bloqueou {nome}" com Desbloquear e a de membro removido
  ficam calmas e iguais, e a fechada não dá nenhuma pista do motivo? Ver `conversa-fechada-sem-aviso`,
  `conversa-voce-bloqueou`, `conversa-membro-removido`.
- **(c) A lista Conversas.** A linha do suporte fixada em primeiro lugar parece o suporte de hoje, e quem nunca escreve
  a outro membro quase não nota nada novo? Ver `conversas-lista`, `conversas-sem-diretas`.
- **(d) O perfil.** Seguir e Enviar mensagem lado a lado (e empilhados em 320px), o Desbloquear no lugar dos dois e a
  ausência total deles para quem foi bloqueado. Ver `perfil-enviar-mensagem`, `perfil-voce-bloqueou`,
  `perfil-sem-botoes`, `membros-linha-320`.
- **(e) As folhas de denunciar e bloquear.** Continuam discretas, sem um muro de vermelho, nos cinco assuntos, e a frase
  "A equipe vê só esta mensagem" tranquiliza sem assustar? Ver `denunciar-folha-assuntos`, `denunciar-folha-mensagem`,
  `bloquear-dialogo-rede-social`.
- **(f) A fila de denúncias.** É fácil de varrer com seis tipos e uma mensagem inteira ou em áudio dentro da linha, e
  "Arquivar comunidade" deixa claro que arquiva? Ver `denuncias-linha-mensagem-voz`, `denuncias-resolver-comunidade`,
  `denuncias-320-novos-assuntos`.
- **(g) O sino.** A linha "começou a te seguir" e a linha "Nova denúncia" (sem dizer o quê nem quem) leem como as
  outras linhas do sino? Ver `sino-comecou-a-te-seguir`, `sino-nova-denuncia`.

## Os padrões que o product owner pode pedir para trocar (A-UI-1..A-UI-22)

São os padrões do pesquisador de UI da Fase 11: cada um é o caminho mais conservador compatível com o que já existe e
**nenhum muda uma decisão travada** (D-719 a D-734). Você pode derrubar qualquer um com uma linha, nesta revisão. O
quadro `defaults-a-confirmar-fase-11` os repete, com a coluna de resposta vazia. **Os quatro primeiros abaixo são os que
mais pedem o seu olhar**; depois vêm os outros dezoito, na ordem.

| # | O que está desenhado | A alternativa | Custo de trocar |
|---|---------------------|---------------|-----------------|
| **A-UI-6** | O gatilho do menu da mensagem é uma **reticência quieta e permanente na folga ao lado de cada balão recebido**, 40x44 em 320px e 44x44 a partir de 390px, sem toque longo (UI-D-870). | Toque longo sem controle visível; um gatilho sob a última bolha da sequência; um menu no cabeçalho. | Tratamento do gesto e uma alternativa acessível; ou a geometria do item da lista; ou um controle no cabeçalho. |
| **A-UI-1** | **Rotas:** `/conversas`, `/conversas/{id}`, `/conversas/com/{membershipId}`; o suporte continua em `/suporte` e o destino do balão é escolhido no servidor pela `social` (UI-D-861, UI-D-864). | Reusar `/suporte` para a lista e um segmento para a conversa. | Nomes de rota, o único `href` do módulo de chat e o link do push; chamada do planejador. |
| **A-UI-2** | Com `social` ligada, o selo do balão do membro é a **contagem** (`Badge`) de conversas com algo não lido; com `social` desligada continua o ponto (UI-D-861). | Manter o ponto também para quem tem `social` ligada (ele não diz quantas). | `counters.conversationsBadge` para membros e o nome acessível do selo. |
| **A-UI-22** | **Um só sketch (025)** leva os quadros de denunciar e bloquear da Fase 13 e as telas novas (padrão do CONTEXT; o Igor não decidiu). Ao aprovar aqui, você também confirma este caminho. | Um segundo sketch menor só para os quadros de denúncia. | Um segundo README com portão e uma segunda aprovação. |
| A-UI-3 | Conversas e conversa dos membros são **colunas únicas de 680px no desktop**, sem cartão dividido (UI-D-862, UI-D-864). | Divisão `288px` mais `1fr` como a caixa da equipe. | Um host dividido e um estado de linha selecionada; a divisão da equipe não muda. |
| A-UI-4 | A **linha do suporte fixada em primeiro, sem alfinete**, lê "Fale com a equipe de {tenant}" se o membro nunca escreveu e mostra ponto, enquanto as diretas mostram contagem; o **balão conta conversas, a linha conta mensagens** (UI-D-861, UI-D-862). | Contagem na linha do suporte; um alfinete; o número da linha contando conversas. | Os dados de não lidas na linha do suporte; um glifo. |
| A-UI-5 | A conversa direta usa a **variante da equipe do `ThreadHeader`** (foto e nome do contato levando ao perfil) e **nenhum rótulo de remetente** acima dos balões em uma conversa 1:1 (UI-D-864). | Uma variante nova de cabeçalho; o rótulo acima de todo balão recebido. | Uma variante de cabeçalho ou uma propriedade em `MessageList`. |
| A-UI-7 | **O fechamento é silencioso ao vivo:** o campo de quem foi bloqueado vira a faixa quando a conversa é relida, sem toast; só um **envio** recusado mostra o toast e a faixa (UI-D-865). | Um toast a cada fechamento ao vivo. | Um tratador de sinal; anunciaria uma mudança de que ninguém deve saber, por isso não é recomendado. |
| A-UI-8 | A **precedência** das faixas é: removido, depois a de quem bloqueou, depois a fechada (UI-D-865); a de removido diz "Este membro não está mais na comunidade. A conversa fica só para leitura." | A fechada vence as outras. | Uma condição e uma frase. |
| A-UI-9 | A zona do perfil é **Seguir (marca) ao lado de "Enviar mensagem" (contorno)**, empilhados abaixo de 360px; quem bloqueou vê um só "Desbloquear", quem foi bloqueado vê **nada** na zona (UI-D-867). | Um ícone de mensagem ao lado de um Seguir de largura cheia; uma linha "indisponível" visível para o bloqueado (rejeitada: avisa o bloqueado). | A geometria da zona; a segunda alternativa quebra a D-722. |
| A-UI-10 | O controle de mensagem da linha de `/membros` é um **botão de contorno só com ícone**, à esquerda de Seguir; o link do nome fica com cerca de 128px em 320px e trunca (UI-D-868). | Colocar o controle só no perfil; um botão de texto "Mensagem" (pede uma segunda linha). | Um controle; ou uma linha de duas linhas. |
| A-UI-11 | **Denunciar é uniforme:** aparece em todo item que não é do próprio espectador, no conteúdo da equipe e nos stories e comunidades da organização, e também para moderadores; **a equipe nunca vê "Bloquear {nome}"** (UI-D-869). | Esconder "Denunciar" dos moderadores (eles removem direto); denunciar só comunidades e stories criados por membros. | Duas condições em `canReport`; menos itens na fila. |
| A-UI-12 | **Nenhuma entrada de bloqueio no perfil nem no cabeçalho da conversa**; bloquear começa num menu de conteúdo (D-733); desbloquear começa na lista, na faixa e no perfil (UI-D-872). | Uma linha "Bloquear" no perfil e um menu no cabeçalho. | Mais um menu em cada tela. |
| A-UI-13 | As folhas **não são vermelhas**: "Denunciar" e "Bloquear {nome}" em tinta neutra; o vermelho do bloqueio só aparece na confirmação do diálogo (UI-D-869, UI-D-872). | Tinta vermelha em "Bloquear {nome}". | Uma classe; arrisca a pergunta do "muro de vermelho" do sketch 017 (g). |
| A-UI-14 | A fila ganha o link **"Ver conteúdo"** em todo assunto menos mensagem, **sem filtro por assunto**, e a mensagem aparece inteira (280 caracteres, sem corte) ou no player restrito à denúncia (UI-D-873). | Sem link (só o trecho); uma fileira de chips de assunto; cortar a mensagem. | Um link de rota por assunto; uma segunda fileira de chips e um parâmetro; um controle "mostrar mais". |
| A-UI-15 | A remoção de uma comunidade na fila se chama **"Arquivar comunidade"**, com o diálogo da UI-D-714 e o selo de estado "Comunidade arquivada"; uma mensagem oferece "Ignorar" e "Bloquear autor" com uma linha de ajuda (UI-D-874). | "Remover conteúdo" com uma linha de explicação; sem linha de ajuda. | Duas frases e um selo. |
| A-UI-16 | **"Começou a te seguir"** é a redação (a da D-727, onde a Fase 09 escreve "segue você"); a linha **nunca é retirada nem marcada** quando o seguir é desfeito; "Nova denúncia" leva à fila aberta (UI-D-875). | "começou a seguir você"; retirar a linha para o "Este conteúdo foi removido." entregue. | Uma frase do catálogo; o caminho de manter e marcar das D-448..D-454. |
| A-UI-17 | O **push de mensagem não tem rótulo de remetente além do título**, uma tag por conversa, e o push de denúncia uma tag por denúncia (UI-D-876). | Uma tag só para todas as denúncias. | Um campo no montador do push. |
| A-UI-18 | O **diálogo de bloquear avisa quem bloqueia que os seguires serão apagados e que desbloquear não os restaura**, quando `social` está ligada (UI-D-872). | O corpo entregue para os dois casos. | Uma frase do catálogo; quem bloqueia seria pego de surpresa pela perda dos seguires. |
| A-UI-19 | **"Desbloquear" não pede confirmação** na faixa e no perfil, como na lista (UI-D-865, UI-D-867). | Um diálogo de confirmação. | Um diálogo. |
| A-UI-20 | O **primeiro envio de uma conversa direta não mostra linha de confirmação nem toast** (UI-D-864). | Uma linha "Conversa iniciada" como o chamado do suporte. | Uma linha. |
| A-UI-21 | O **chat de suporte, a caixa da equipe e a equipe não mudam**: sem menu de mensagem, sem Conversas, sem entrada de denúncia numa mensagem de suporte (UI-D-877). | Uma entrada de denúncia nas mensagens de suporte. | Um assunto novo; ninguém pediu. |

**A-UI-22 diz respeito a esta própria revisão.** Se você aprovar este sketch, confirma que um só sketch vale para as
telas novas e para os quadros de denunciar e bloquear que o plano 13-20 da Fase 13 previa. O plano 13-20 **não é editado
por esta fase**: o orquestrador ajusta o texto do ROADMAP e do STATE. Este README só registra que as telas de denunciar e
bloquear de 13-20 são construídas pela Fase 11 a partir deste desenho, e que, aprovado o 025, o 13-20 vira uma conferência
dentro do app, com o guarda redirecionado do 017 para cá pelo planejador da Fase 11.

## O que o planejador assumiu e o Igor confirma na mesma sentada

Quatro suposições do plano da Fase 11, fora da tabela de UI. Responda cada uma com "manter" ou "trocar":

- **A-11-ROLE — quem vê "Bloquear {nome}".** O sinal `canBlock` da folha é **falso para quem é da equipe**, decidido no
  servidor pelo papel registrado da requisição; já a função de banco que bloqueia **não é estreitada** por papel.
  Alternativa: estreitar também a função de banco. Custo: uma checagem a mais no banco e um teste.
- **A-11-COPY — a "cópia" de uma mensagem de voz denunciada.** É uma **referência à gravação** mais a duração guardada,
  não um segundo arquivo: ela vive enquanto a gravação viver e passa a ler "Mensagem de voz apagada" quando a gravação é
  aposentada (exclusão de conta, regra da 12.5). Alternativa: copiar o arquivo para a denúncia. Custo: um segundo objeto
  de mídia por denúncia, mais armazenamento e uma regra de descarte.
- **A-11-SC — comentários de story com o filtro de quem bloqueou.** Os comentários de story ganham o mesmo filtro dos
  comentários de publicação, para que "Bloquear {nome}" num comentário de story tenha o efeito que a D-725 descreve. A
  D-725 diz que o bloqueio não cria filtro novo de story; isto é o filtro da **lista de comentários**, não da lista de
  stories. Alternativa: não filtrar. Custo: o bloqueio num comentário de story não esconderia nada para quem bloqueou.
- **A-11-ORG — remover da fila um story ou uma comunidade da organização.** Não escreve linha no registro de
  moderação, como os caminhos de remoção já entregues (que só escrevem para conteúdo de membro); a própria denúncia
  guarda quem resolveu. Alternativa: uma linha no registro para toda ação da fila, ou esconder a linha de remoção e
  oferecer só "Ignorar" e "Bloquear autor". Custo: um vínculo de assunto novo em `recordModerationAction` ou uma
  restrição ampliada.

Ponto de pesquisa ligado a estas: a D-728 ("o participante olhando a conversa não recebe push") é cumprida pela regra
global de primeiro plano do service worker, não por uma regra por conversa. Se você quiser a regra por conversa, é
trabalho novo. Diga "manter" ou "trocar".

## O que o desenho mostrou que fica para você ver

O sumário do plano 11-01 deixou sete achados no quadro `defaults-a-confirmar-fase-11` (F-1 a F-7). Os que pedem uma
resposta:

- **F-1.** A 320px, a bolha de voz de 245px, a folga de 4px e o gatilho de 40px somam 289px contra uma lista de 288px; a
  bolha encolhe 1px.
- **F-2.** "Ver conteúdo" está desenhado em tinta neutra, não no ghost na cor da marca, para honrar a regra de que a marca
  nunca colore texto sobre superfície neutra.
- **F-3.** "Não foi possível carregar mais conversas." é texto proposto, que não está no UI-SPEC.
- **F-4.** O toast do envio recusado usa a variante vermelha de erro já entregue; um toast neutro de informação é a
  alternativa.
- **F-5 a F-7.** A fonte do mockup é a de reserva, não a Manrope; os quadros do sketch 017 ficam substituídos (marcar o
  README do 017 é edição sua); os dados são fictícios.

## O que a revisão do desenho não consegue provar

Estas provas são do Igor e não dá para fazê-las localmente (o celular não alcança `*.localhost`); entram como linhas
manuais do ledger da fase:

- uma conversa entre **dois celulares de verdade, com push em cada um** (o PWA instalado no iPhone e um Android);
- uma mensagem de voz tocada pelo outro participante e **não tocável por um terceiro membro**;
- a faixa de quem foi bloqueado e o envio recusado, num aparelho real;
- a linha de voz da fila, **ouvida pelo administrador só por dentro da denúncia**;
- as frases do leitor de tela da UI-D-879 no VoiceOver e no TalkBack.

## Decisões travadas a montante (não se rediscutem aqui)

D-719 a D-734 do `11-CONTEXT.md` e UI-D-860 a UI-D-881 do `11-UI-SPEC.md` (as decisões visuais) estão fixadas. Esta
revisão só pergunta se o **desenho** as cumpre, e confirma ou derruba os padrões e as suposições acima. Fora de revisão
(nada novo a desenhar): a gravação e o player e todos os estados de voz (sketch 024), o cabeçalho da conversa, os
separadores de dia, a pílula "N novas mensagens", a geometria da faixa só de leitura e os esqueletos (sketches 007 e
023), o botão Seguir e as contagens (012), o visualizador de stories e o cabeçalho de comunidade (003, 004, 020), a
anatomia da linha do sino (006) e os diálogos, folhas e toasts já entregues.

## Como revisar e como o resultado é registrado

1. Abra o `index.html`, alterne tema claro e escuro, troque entre as marcas (acima de tudo o Amarelo claro) e a largura
   320px, e confira os quadros de 320px.
2. Comece por `conversa-fechada-sem-aviso` e `conversa-voce-bloqueou`, e termine em `defaults-a-confirmar-fase-11`.
3. **Quem registra o resultado é o Igor**, editando o frontmatter deste arquivo. Para aprovar, troque os valores
   pendentes por estes (o exemplo está recuado de propósito, para nenhuma verificação ler a aprovação como já dada):

       status: approved
       approved: true
       approved_by: <seu nome>
       approved_at: AAAA-MM-DD
       approval_kind: provisional

   Para pedir mudanças, deixe `approved: false` e liste em `changes_requested:` o nome do quadro e o que muda.
   **Nenhum agente e nenhum plano escreve essa aprovação.** Se você disser "faz você", o Claude pode registrar por você,
   mas só depois da sua palavra. Uma aprovação provisória já abre o portão; os ajustes do time de design depois são um
   polimento.
4. Todo plano de tela da Fase 11 (19 a 26) começa com `grep -q '^approved: true'` neste arquivo e para se a linha não
   existir. Os planos de banco, contrato, API, worker, push, funções de vista e catálogo (03 a 18) não dependem desta
   aprovação e seguem sem ela.
5. Se você dispensar o portão, registre a dispensa como uma decisão no `11-CONTEXT.md`; os planos 19 a 26 então largam o
   guarda. O menor pedaço que ainda vale olhar é o par `conversa-fechada-sem-aviso` e `conversa-voce-bloqueou`.

## Sources

- `.planning/phases/11-rede-social-direct-messages-member-blocking-and-reports/11-UI-SPEC.md` (o contrato, seções
  "Defaults chosen" e "Sketch gate") e `11-CONTEXT.md` (D-719 a D-734).
- `.planning/phases/11-rede-social-direct-messages-member-blocking-and-reports/11-RESEARCH.md` (Assumptions Log A3 e A5,
  Open Questions 2 e 6).
- Sketch 017 (os 17 quadros de denunciar e bloquear trazidos e redesenhados), sketch 024 (a voz), sketches 007 e 023 (a
  conversa e a casca) e `packages/ui/src/styles/tokens.css`.
