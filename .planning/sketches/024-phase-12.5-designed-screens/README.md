---
sketch: 024-phase-12.5-designed-screens
name: phase-12.5-designed-screens
phase: "12.5"
question: "As telas novas da mensagem de voz no chat — o campo de mensagem com o microfone e a gravação (permissão, limite de 5 minutos, interrupção, gravação curta), o envio e as falhas, o player no balão (estados, velocidade, contraste sob a marca Amarelo), a conversa com vários áudios e a mensagem apagada, o membro (abertura do chamado por voz, resposta, Meus chamados), a equipe (linha da caixa, resposta por voz, divisão de desktop), as prévias e o push, o leitor de tela e os padrões a confirmar — leem como a linguagem do protótipo em claro e escuro, sob qualquer marca, em 320 e 390px?"
screens:
  - compositor-ocioso-microfone
  - compositor-pedindo-permissao
  - compositor-gravando
  - compositor-aviso-4-30
  - compositor-limite-5-00
  - compositor-interrompida
  - compositor-gravacao-curta
  - compositor-microfone-bloqueado
  - compositor-sem-microfone
  - compositor-microfone-ocupado
  - compositor-sem-suporte
  - balao-enviando-progresso
  - balao-fila-segunda-gravacao
  - balao-falha-reenviar
  - balao-falha-definitiva
  - balao-player-estados
  - balao-player-velocidade
  - balao-player-amarelo-claro
  - balao-player-320-tempo-longo
  - conversa-varios-audios
  - conversa-novo-audio-chegando
  - balao-voz-apagada
  - membro-abertura-com-microfone
  - membro-abertura-gravando
  - membro-primeiro-envio-por-voz
  - membro-resolvido-resposta-por-voz
  - membro-fechado-sem-microfone
  - membro-bloqueado-sem-microfone
  - membro-meus-chamados-previa-voz
  - equipe-caixa-linha-voz
  - equipe-chamado-aberto-gravando
  - equipe-resposta-por-voz-assume
  - equipe-balao-do-membro-voz
  - equipe-desktop-divisao-voz
  - equipe-fechado-e-bloqueado-sem-microfone
  - equipe-detalhes-casos-anteriores-voz
  - previas-e-push-voz
  - leitor-de-tela-voz
  - defaults-a-confirmar-voz
status: approved
approved: true
approved_by: igor.vboas (word "aprovado" in the session, made definitive by his answer in the session on the same day, recorded by Claude)
approved_at: 2026-11-17
approval_kind: final
changes_requested: []
winner: null
tags: [phase-12.5, design-review, D-33, D-365, D-417, UI-04, voice-messages, chat]
---

# Sketch 024: Fase 12.5 — Mensagem de voz no chat (portão de revisão D-33 / D-365 / D-417 / UI-04)

## Design Question

Hoje o chat só manda texto. A Fase 12.5 deixa qualquer pessoa de um chat gravar uma mensagem de voz na hora (até 5
minutos), enviar com um toque e tocar a mensagem dentro da conversa. Valem as decisões que você tomou em 17 de
novembro: todos mandam, no máximo 5 minutos, em todos os chats; um toque grava, um toque envia, a lixeira joga fora; ao
chegar em 5:00 a gravação para e quem gravou escolhe enviar ou descartar; o microfone ocupa o lugar do botão de enviar
quando o campo está vazio; player de barra simples com velocidade 1x, 1,5x e 2x; a mensagem é áudio **ou** texto, nunca
os dois. Como o protótipo do time de design não tem nada disso, estas superfícies são **[designed]** e, pelas regras
D-33, D-365 e D-417, precisam ser desenhadas e revisadas **antes de codar** (UI-04). São sete grupos em três portões:

- 1 · O campo de mensagem com microfone
- 2 · O envio da mensagem de voz
- 3 · O player no balão
- 4 · A conversa com mensagens de voz
- 5 · O membro: abertura, resposta e Meus chamados
- 6 · A equipe: caixa de entrada e conversa
- 7 · Notas e padrões a confirmar

A pergunta de design: tudo isso lê como a linguagem do protótipo — fundo `#f5f7fb` com cartões brancos, raios de
12px, alvos de 44px, a escala 12 / 14 / 16 / 24 com pesos 400 / 700 e **uma** cor de destaque, a marca do tenant —, em
claro e escuro, sob qualquer marca, em 320 e 390px? A Fase 12.5 não declara token, cor, fonte, tamanho nem dependência
nova; o desenho só combina as primitivas já entregues e acrescenta as peças de voz, todas com os mesmos tokens.

## How to View

```
open .planning/sketches/024-phase-12.5-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem framework, sem script remoto e sem imagem real. O arquivo abre offline. É um
artefato de revisão sob `.planning/`: nenhum código de aplicação o importa, empacota ou referencia. Os quadros são
estáticos: o desenho mostra cada estado do microfone e do player lado a lado, não toca nem grava de verdade.

Controles no topo (chrome do mockup, fora do produto): tema claro e escuro, **quatro** marcas de tenant (Azul, Verde,
Coral e **Amarelo**, que está lá para mostrar o problema de contraste) e a largura 390 ou 320px. Cada quadro leva o seu
nome em `data-frame` e na etiqueta. São **39 quadros** e a lista `screens:` do topo deste arquivo é igual aos quadros
desenhados, na ordem da página. Os quadros de desktop (a divisão de 1280px) têm largura fixa. Todos usam a mesma linha do
tempo de exemplo: o "agora" é quinta-feira, 19 de novembro de 2026, 14:20; o cliente é o "Instituto Aurora"; a membro é
Marina Costa; os chamados são #42, #38, #31 e #12; as mensagens de voz de exemplo duram 0:07, 0:42, 1:05, 4:59 e 5:00.
Nomes, e-mails (domínio reservado `.invalid`) e textos são exemplos.

**Uma exceção à regra "o #42 nunca muda de assunto":** nos quadros que mostram um chamado aberto por voz
(`membro-primeiro-envio-por-voz`, `membro-meus-chamados-previa-voz`, os da equipe e o #38 em
`equipe-detalhes-casos-anteriores-voz`), o rótulo do chamado é "Mensagem de voz", sem duração, como decide a D-861.

## O que olhar, em que ordem

1. **O campo de mensagem (portão G1).** `compositor-ocioso-microfone`, `compositor-gravando`, `compositor-limite-5-00`
   e `compositor-microfone-bloqueado`; depois `balao-enviando-progresso` e `balao-falha-reenviar`.
2. **O player e a conversa (portão G1).** `balao-player-estados` (os oito estados, dos dois lados),
   `balao-player-amarelo-claro` (o problema de contraste, com as alternativas desenhadas), `balao-player-320-tempo-longo`
   e `conversa-varios-audios`.
3. **O membro (portão G2).** `membro-abertura-com-microfone`, `membro-primeiro-envio-por-voz`,
   `membro-resolvido-resposta-por-voz` e `membro-meus-chamados-previa-voz`.
4. **A equipe (portão G3).** `equipe-caixa-linha-voz`, `equipe-chamado-aberto-gravando`, `equipe-balao-do-membro-voz` e
   `equipe-desktop-divisao-voz`.
5. **Por último, `defaults-a-confirmar-voz`:** uma tabela só, em português simples, com cada suposição, o que está
   desenhado, a alternativa e quanto custa trocar. Responda cada linha com "manter" ou "trocar". As notas
   `previas-e-push-voz` e `leitor-de-tela-voz` não pedem aprovação de pixel.

## Os padrões que o product owner pode derrubar (A-UI-1..A-UI-26)

O quadro `defaults-a-confirmar-voz` lista as 26. As **duas primeiras** são as que mais pedem o seu olhar porque
completam decisões do contexto: A-UI-1 (o rótulo do chamado aberto por voz é só "Mensagem de voz", sem duração) e A-UI-2
(a prévia é "Mensagem de voz · 0:42" com um ícone de microfone nas linhas). Depois vêm a A-UI-3 (o piso de uma
gravação curta), a **A-UI-4 (a lixeira joga fora na hora, sem perguntar: quem toca sem querer perde até 4 minutos de
gravação)**, a A-UI-5 (sem medidor de volume), a A-UI-10 (a bolha que falhou fica para tentar de novo), a **A-UI-11
(começar outro áudio pausa o anterior e guarda a posição; a D-853 dizia "para")**, a A-UI-12 (a velocidade escrita "1,5x"),
a A-UI-14 (bolha de uma linha de 280px contra a de duas linhas, as duas desenhadas em `balao-player-320-tempo-longo`) e
a A-UI-15 (a barra do outro lado em tinta neutra, contra a cor da marca, também desenhada).

## O que o desenho mostrou que o contrato ainda não resolve

Ao desenhar, os quadros expuseram pontos que o UI-SPEC deixou abertos ou errou. Nenhum muda uma decisão travada
(D-846 a D-872); todos pedem uma resposta sua ou uma correção do contrato. Eu **não** corrigi o contrato ainda: espero a
sua revisão e corrijo de uma vez.

1. **Contraste do player sob a marca Amarelo (e em parte nas outras).** O trilho ainda não tocado mede 1,68 a 1,90:1
   do lado próprio e 1,16:1 do outro lado, abaixo dos 3:1 de contraste de elementos sem texto; a parte tocada fica na
   mesma faixa. O texto da pílula de velocidade do lado próprio mede 3,40 a 3,70:1 (precisa de 4,5:1). O disco do
   outro lado, na cor da marca sobre o balão branco, mede 1,63:1 no Amarelo claro (o ícone dentro tem 9,6:1). O
   contrato dizia que "nenhuma marca falha". Estão desenhados o padrão e as alternativas (`balao-player-amarelo-claro`):
   trilho reforçado (4,15:1), disco com tinta neutra (15,7:1) e barra na cor da marca. **Decisão sua.**
2. **A coluna do meio do player a 320px mede 124,8px, não 129.** O texto "0:12 / 4:59" ocupa cerca de 72px e cabe.
3. **A prévia na caixa da equipe a 288px não cabe inteira.** A coluna tem 154 a 158px; o microfone mais
   "Mensagem de voz · 0:42" pedem 168 a 177px, e com o prefixo "Carla: " pedem 216px. A duração é a primeira a ser cortada
   (`equipe-caixa-linha-voz`). A 320px, na lista de largura cheia, o prefixo também corta.
4. **A frase falada de 5:00 sai "5 minutos e 0 segundo".** A regra de plural do português trata o zero como singular; o
   texto precisa de um ramo para zero.
5. **A bolha cresce quando dá erro.** De 56px para 96px (76px no "sem suporte" a 280px), e o contrato falava de "cerca de
   56px". Os estados do disco, da barra e da pílula de velocidade da bolha que falhou não estavam no contrato; o desenho
   assumiu disco, barra e velocidade desativados.
6. **A linha de falha em vermelho a 14px não passa no contraste no tema claro** (cerca de 3,5:1 sobre o fundo). O mesmo
   vale para o erro que o app já entrega.
7. **O aviso de membro bloqueado do lado do membro não tem frase própria.** O 12.4 só desenhou o do lado da equipe, e a
   frase entregue lê "Marina Costa está bloqueado." quando é o próprio membro. **Precisa de decisão.**
8. **A barra da equipe a 320px corta o rótulo e o responsável** ("Mensagem d…", "Co…") quando há a pílula Em atendimento e o
   botão Resolver; um rótulo curto como "Mensagem de voz" também é cortado.
9. **Pequenos acertos de contrato:** o token `text-fg-secondary` não existe (é `--theme-text-secondary`); o ícone de
   tentar de novo é `RotateCw`, não o `RotateCcw` do "Reabrir"; a quarta frase de problema do microfone ("Não foi
   possível gravar. Tente de novo.") não tinha quadro e foi desenhada em `compositor-microfone-ocupado`; a pílula "nova
   mensagem" aparece no singular quando é uma; a área de toque da barra passa 6px da bolha mas não cobre nenhum controle; o
   corte de 100 caracteres do push vale para o aviso inteiro (frase com nome mais prévia), não só para a prévia.
10. **A fonte do mockup é a de reserva, não a Manrope.** Larguras apertadas ("Limite atingido" com "5:00" na pílula de
    320px, os dois botões da bolha que falhou, "1,5x" na pílula de 40px) precisam ser conferidas no app.

## Textos de exemplo no desenho

O texto vem do Copywriting Contract do UI-SPEC onde ele existe. Onde o contrato não tem texto, o quadro diz
"Suposição: …" na sua legenda. **Pergunta ao time de design:** algum exemplo mascara um problema de largura ou de quebra
de linha que um nome de 60 caracteres ou uma duração longa causaria em 320px? (Ver `balao-player-320-tempo-longo`,
`equipe-caixa-linha-voz` e `compositor-limite-5-00`.)

## Decisões travadas a montante (não se rediscutem aqui)

D-846 a D-872 do `12.5-CONTEXT.md` e UI-D-840 a UI-D-858 do `12.5-UI-SPEC.md` (as decisões visuais) estão fixadas. Esta
revisão só pergunta se o **desenho** as cumpre, e confirma ou derruba os padrões e as suposições acima.

## Como revisar e como o resultado é registrado

1. Abra o `index.html`, alterne tema claro e escuro, troque entre as quatro marcas e a largura 320px, e confira os
   quadros de 320px.
2. Comece por `compositor-gravando` e `balao-player-estados`, e termine em `defaults-a-confirmar-voz`.
3. **Quem registra o resultado é o Igor**, editando o frontmatter deste arquivo. Para aprovar, troque os valores
   pendentes por estes:

       status: approved
       approved: true
       approved_by: igor.vboas
       approved_at: AAAA-MM-DD
       approval_kind: final

   (ou `provisional`, se aprovar sem responder linha a linha). Para pedir mudanças, deixe `approved: false` e liste em
   `changes_requested:` o nome do quadro e o que muda. **Nenhum agente e nenhum plano escreve essa aprovação.** Se você
   disser "aprovado" aqui na conversa, o Claude pode registrar por você, como foi feito no sketch 023, mas só depois da
   sua palavra.
4. Todo plano de tela da Fase 12.5 (13 a 17) começa com `grep -q '^approved: true'` neste arquivo e para se a linha
   não existir. Os planos de banco, servidor, ffmpeg, API, prévias e push (01 a 11) não dependem desta aprovação.

## Sources

- `.planning/phases/12.5-mensagem-de-voz-no-chat/12.5-UI-SPEC.md` (o contrato, seção "Sketch gate") e
  `12.5-CONTEXT.md` (D-846 a D-872).
- Sketch 023 (a casca, as quatro marcas, as primitivas do chat) e `packages/ui/src/styles/tokens.css`.
- Peças de origem do desenho, não versionadas: `parts/` desta pasta (casca, `voice.css`, `voice-guide.md`, os
  fragmentos de cada grupo e as ferramentas de montagem).

## Registro da aprovação

**2026-11-17, tornada definitiva.** Depois da execução da fase, o Igor respondeu na conversa que aprova o sketch 024 "de
vez" (resposta à pergunta do Claude, na mesma sessão); o `approval_kind` passou de `provisional` para `final`. Nada mais
mudou no desenho. O texto abaixo é o registro original da aprovação provisória.

**2026-11-17, aprovado de forma provisória.** O Igor respondeu "aprovado" na conversa, sem responder linha a linha; o
Claude registrou a aprovação no frontmatter acima, como foi feito no sketch 023. Lido como: manter todos os padrões
A-UI-1 a A-UI-26 como estão desenhados, incluindo A-UI-1 e A-UI-2. As correções que o desenho forçou e os três pontos
que ficaram em aberto (contraste sob o Amarelo, o vermelho da linha de falha e a frase do membro bloqueado) estão na seção
"Sketch 024 review outcome" do `12.5-UI-SPEC.md`. Uma mudança pedida depois das provas em celular real reabre só as
telas, não o servidor.

