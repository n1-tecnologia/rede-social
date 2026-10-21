# Pendências de backend

Ajustes de 09/10, de 12/10, de 15/10 e de 20/10 (branch `FRONT-AJUSTES`). Atualizado em 2026-10-20.

## Feed e perfil

### 1. @ do Instagram

- **O que mudou:** campo "Instagram" em Editar perfil. O @ aparece abaixo do nome nas publicações (Início, comunidades, página do post e Reels), no perfil e na lista de membros (quando a bio não tem texto). Hoje ele fica dentro da bio, como última linha depois de uma linha em branco ("Instagram: @perfil", formato em `apps/web/lib/profile-instagram.ts`), e o web lê o `GET /v1/members/{id}` de cada autor para mostrar o @ nos posts. O formulário recusa uma bio cujo próprio texto termina nessa linha, então toda linha nesse formato é de fato o @ da pessoa.
- **Back:**
  - coluna `member_profiles.instagram_handle` com CHECK no formato do front (1 a 30 letras minúsculas, números, ponto e sublinhado, sem ponto no começo, no fim ou dois seguidos);
  - `instagramHandle` no `PATCH /v1/me/profile`, no `ownProfileSchema` e no `memberProfileSchema`;
  - o @ do autor no post (`feedPostAuthorSchema`), vindo na mesma consulta que já traz o nome e a foto;
  - migrar as bios que estão nesse formato: o @ vai para a coluna e a linha sai da bio;
  - decidir se o @ sozinho conta como bio para "Complete seu perfil" (hoje conta, porque está dentro da bio);
  - ordem: os schemas são `.strict()`, então o campo novo entra como `.optional()` e o web é publicado primeiro; depois a migration e a API.
- **Por quê:** a linha gasta até 44 dos 150 caracteres da bio, aparece como texto onde a bio é lida crua e cada página do feed faz uma chamada a mais por autor.

### 2. Proporção dos vídeos

- **O que mudou:** o feed e o Reels descobrem a proporção de cada vídeo no navegador (pela capa e pelos metadados do vídeo) e a guardam durante a visita. Um toque no vídeo do feed agora abre o Reels por cima, já naquele vídeo: a D-124 ("o Reels só abre pela aba") foi revertida a pedido do dono do produto.
- **Back:** expor a largura e a altura do vídeo no post (`postMediaSchema`, onde `width` e `height` vêm nulos para vídeo), ou o `aspect_ratio` que o Mux já envia e que fica guardado em `media_assets.aspect_ratio`, para o quadro já vir certo do servidor. O Reels lê o mesmo `GET /v1/feed?media=video`, então a mudança vale para os dois.
- **Por quê:** até a proporção chegar, o quadro usa um palpite (4:5 no feed, a tela toda no Reels) e pode mudar de tamanho.

## Marca: ícone do app e aparência

### 3. Ícone do app no Android sem moldura

- **O que mudou:** o editor "Ícone do app" (Marca da plataforma, Marca do admin e assistente de novo tenant) monta o ícone no navegador, já com o fundo, e envia um PNG quadrado de 1024 px (JPEG só se o PNG passar de 2 MB) pelo upload de ícone que já existe (`kind: 'icon'`). Desde 20/10 (pedido do cliente: "a arte tem que tomar o círculo inteiro"), a prévia do Android nesses editores mostra a arte ocupando o círculo inteiro, sem a faixa da cor principal: sempre no rascunho do editor e, no ícone salvo, quando o tenant tem um ícone próprio. O ícone derivado do logo continua com a margem na prévia. **O app instalado ainda mostra a moldura** até a mudança abaixo.
- **Back:**
  - no worker (`deriveIconSet` em `packages/core/server/branding/icons.ts`), gerar o `maskable512` ocupando o quadrado inteiro quando a fonte for um ícone enviado e opaco, em vez de colocá-lo em 80% sobre a cor principal; um ícone com transparência (ou derivado do logo) mantém a margem. Precisa de um marcador vindo do upload (um tipo de upload próprio ou o campo do item 4), porque um ícone enviado de outro jeito continua precisando dessa margem;
  - depois do deploy, refazer os ícones dos tenants que já têm um ícone próprio;
  - opcional: a marca pública do host (`toHostBranding`) dizer se o ícone é próprio, para o manifest e o front saberem sem outra leitura.
- **Por quê:** com um fundo diferente da cor principal, aparece uma moldura no Android: a faixa da cor principal em volta do ícone. Aviso para o cliente: no Android de quem já instalou o app, o ícone novo não aparece na hora; ele troca quando o Chrome atualizar o app instalado.

### 4. Guardar as escolhas do editor de ícone

- **O que mudou:** as escolhas do editor "Ícone do app" ficam só no navegador; só o ícone pronto é enviado. Nas telas Marca, quem volta à página encontra o editor no padrão, e o ícone não acompanha uma troca da cor principal: o editor avisa para editar o ícone de novo.
- **Back:** um campo `appIcon` na marca com as escolhas (modo, cor ou imagem de fundo, tamanho do logo e as imagens de origem: o logo usado, a imagem de fundo e a arte), devolvido no detalhe do tenant (`GET /v1/platform/tenants/{id}`) e no `GET /v1/admin/branding`. Opcional: refazer o ícone quando a cor principal mudar.
- **Por quê:** o editor reabrir com o que foi usado da última vez, e o ícone acompanhar a cor principal sem ninguém precisar refazê-lo.

### 5. Aparência na Marca do admin

- **O que mudou:** Configurações → Marca mostra a aparência salva do tenant (fundo do modo claro, cores e fundo do modo escuro, cores dos botões) só para leitura, com um aviso de que fundo, modo escuro, botões e fonte dos títulos são definidos pela equipe da plataforma. Só a Marca da plataforma edita a aparência.
- **Back:** rota `PUT /v1/admin/branding/look` com o `brandingLookBodySchema` (o mesmo corpo da rota da plataforma), exigindo `tenant.manage` e usando o tenant da sessão, como as outras rotas de `/v1/admin/branding`. Com a rota, o front só passa o editor de aparência para a página.
- **Por quê:** o admin do tenant mudar a aparência da própria marca, como já muda o logo e as cores.

### 6. Remover o ícone do app de um tenant sem logo

- **O que mudou:** o editor "Ícone do app" deixa criar um tenant só com uma arte, sem logo. Depois de "Remover" o ícone, a prévia passou a mostrar o ícone que o app continua servindo, em vez de dizer que ele usa o ícone padrão da plataforma.
- **Back:** em `removeIconOverride` / `resolveIconSource` (`packages/core/server/platform/branding.ts`), quando o ícone é removido e não há logo, não refazer os ícones a partir da imagem anterior (`previous_i512`): limpar `iconUrls`, para o manifest e o ícone do iPhone voltarem ao padrão da plataforma. A fonte `previous_i512` continua servindo para refazer os ícones depois de uma troca de cor.
- **Por quê:** hoje a derivação que roda depois do "Remover" usa o 512 gerado a partir da arte removida, e o app instalado continua com a arte que o admin tirou.

## Perfil (ajustes de 12/10)

### 7. Lista de membros só para a equipe

- **O que mudou:** a linha "Membros" saiu do Perfil, e a lista `/membros` passou a abrir só para o admin e o suporte do tenant. Um membro que abre o endereço volta para o Perfil, e o "Carregar mais" da lista recusa quem não é da equipe. O perfil de uma pessoa (`/membros/{id}`, aberto pelo nome num post) continua aberto para todos; para o membro, o voltar dessa tela leva ao Início.
- **Back:** `GET /v1/members` (com e sem a busca `?q=`) exigindo papel de equipe (`admin_tenant` ou `support_tenant`) e respondendo 403 para `member`. O `GET /v1/members/{id}` continua aberto para membros, porque é ele que abre o perfil pelo nome e mostra o @ do autor nos posts.
- **Por quê:** hoje o bloqueio está só nas telas, e a rota da API continua devolvendo a lista de membros para qualquer membro.

### 8. Comunidades do membro

- **O que mudou:** o Perfil ganhou a seção Comunidades, com até 10 comunidades que o membro acessa: as abertas e as exclusivas já liberadas pela Loja (as trancadas ficam de fora). Como não existe participação por comunidade, a seção usa a mesma lista de `/comunidades` (a primeira página, de 25) e a filtra no front com a lista de acesso da Loja (`GET /v1/store/community-access`).
- **Back:** participação por comunidade (entrar e sair, numa tabela de membros da comunidade) e `GET /v1/me/communities` devolvendo as comunidades da pessoa já com o acesso calculado (aberta, liberada ou trancada).
- **Por quê:** hoje a seção mostra as mesmas comunidades para todo mundo, porque todo membro acessa todas as abertas, e o front faz 2 leituras para montá-la.

### 9. "Sua atividade" do membro com dados reais

- **O que mudou:** o Perfil do membro (só o papel `member`; admin e suporte não veem) ganhou "Sua atividade", o relatório do projeto rede-social-dashboard: Tempo de uso (média por dia, gráfico da semana e pico de uso), Seu engajamento (curtidas, comentários, salvamentos, compartilhamentos), O que você viu (posts, stories, vídeos e reels, tempo em vídeos), Onde você mais participa e Presença e constância (presença nos encontros, sequência de semanas). Por decisão do dono do produto, os números são de exemplo e sem etiqueta (`apps/web/lib/member-activity-sample.ts`): todo membro vê os mesmos valores. "Onde você mais participa" também é de exemplo (as comunidades do dashboard), e só aparece com o módulo de comunidades ligado.
- **Back:** `GET /v1/me/activity` com a janela dos últimos 7 dias completos (no fuso do tenant) e a comparação com os 7 dias anteriores:
  - já dá para contar com o que existe no banco: curtidas (`feed_likes`), comentários (`feed_comments`), stories vistos (`story_views` do próprio membro), interações por comunidade (curtidas + comentários por `feed_posts.community_id`), presença nos encontros (check-ins contra confirmações nos últimos 30 dias) e sequência (semanas seguidas com pelo menos uma ação);
  - precisa começar a registrar (tabelas novas, migrations e o app enviando os eventos em lote): sessões de uso (tempo de uso e horário de pico), posts vistos, reprodução de vídeos e reels (quantidade e tempo), compartilhamentos e salvamentos (o app ainda nem tem "salvar post").
- **Por quê:** hoje os números não são do membro. Riscos do lado do back: o registro de visualizações e de tempo gera muita escrita (lote, índices e prazo de retenção); tempo de uso e o que a pessoa viu são dados de comportamento (precisam estar na política de privacidade, com retenção definida, e cada membro só pode ler os próprios); e qualquer migration roda em produção no merge da master, e a homolog usa o mesmo Supabase.

## Painel do dono (ajustes de 15/10)

### 10. Painel do dono para o admin com dados reais

- **O que mudou:** o Perfil do admin do tenant (só o papel `admin_tenant`; membro e suporte não veem) ganhou, logo abaixo de "Complete seu perfil", o painel "Visão do dono": a tela "Dono do cliente" do projeto rede-social-dashboard, com os mesmos cartões e menus. No topo, o ícone e o nome do tenant, "Visão do dono", a janela "30 dias" e o sino de alertas; embaixo, as seis áreas (Visão geral, Membros, Conteúdo, Eventos, Financeiro e Atendimento), com as listas e os detalhes que abrem dentro delas. Tudo navega por parâmetros em `/perfil` (`?area=membros`, `&faixa=`, `&membro=`, `&lista=`, `&vista=`, `&post=`, `&produto=` e os outros, lidos por `apps/web/lib/owner-panel.ts`, `owner-band-scope.ts`, `owner-content-view.ts` e `owner-finance-view.ts`). Por decisão do dono do produto, os números são de exemplo e sem etiqueta (`packages/modules/dashboard/fixtures`): todo tenant vê os mesmos valores, os mesmos 72 membros fictícios, as mesmas publicações, eventos e pedidos. Só são reais o nome e o ícone do tenant e o domínio do cartão "Conta" (o domínio principal do tenant). "Ver operação do dia (painel do admin)" abre Configurações, porque o app não tem o painel do admin do cliente. As ações sugeridas ("Ver todos", "Responder", "Enviar push" e afins) aparecem desativadas.
- **Back:** rotas só para `admin_tenant`, com a janela dos últimos 30 dias (no fuso do tenant) e a comparação com os 30 dias anteriores, uma por área, e as listas paginadas atrás de cada número:
  - já dá para contar com o que existe no banco: crescimento (entraram, saíram, novos por semana, pelas datas de entrada e saída das participações); as seis faixas de engajamento da base, por comunidade e por evento, e os membros de cada faixa (as ações contadas: curtida, comentário, post, RSVP "vou", check-in e pedido pago); interações por publicação, por comunidade e por tipo de publicação (curtidas e comentários por `feed_posts.community_id` e `media_kind`); melhor dia e horário para publicar; visualizações únicas de story (`story_views`, só o total, nunca quem viu); quem curtiu e quem comentou cada publicação, e os comentários sem resposta da equipe; próximos eventos, comparecimento, presencial e online, quem vai (`events.capacity`, RSVPs "vou" e check-ins); receita primária e secundária, receita por produto e por faixa, quem compra e a escada de compra (o primeiro pedido pago de cada membro é a primária, os seguintes a secundária, sempre calculado); vendas até 7 dias depois de uma publicação ou de um evento (associação, não causa); fila, 1ª resposta, atendimentos por semana e equipe (as conversas do suporte e `chat_messages.author_user_id`); moderação (comentários removidos, bloqueios e desbloqueios); os insights de um membro (dias ativos, curtidas, comentários, ações fortes, eventos, compras e quantas conversas de suporte, nunca o texto);
  - precisa começar a registrar (tabelas novas, migrations e o app enviando os eventos em lote): salvamentos e compartilhamentos por publicação; visualizações e alcance por publicação, por membro, guardados só para contar (taxa de engajamento e alcance por faixa dependem disso); reprodução de vídeo (% assistido e retenção); até que cartão cada membro passou no carrossel; cliques no link; toques no story (avançou, voltou, saiu); lista de espera dos eventos lotados; o assunto de cada atendimento; o preço e as vendas de ingresso de cada evento (a receita do cartão de evento); sessões de uso (o tempo médio diário do membro) e posts vistos por membro;
  - o que falta na loja: uma tabela de ofertas e o `offer_id` no pedido (a mesma oferta de entrada e de adicional hoje não se distingue), preencher `expires_at` quando um acesso com prazo é concedido (os "acessos que vencem em 7 dias" dependem disso), rever o `store_orders_live_uq` (impede renovar o mesmo produto sem revogar o pedido anterior) e decidir se um acesso que vence sem renovação encerra a participação;
  - as listas com nomes (membros de cada faixa, quem curtiu ou comentou, quem compra e quanto) só para a equipe do tenant, e todo total de grupo abaixo de 5 pedidos ou pessoas aparece como "menos de 5", sem o número.
- **Por quê:** hoje o painel não é do tenant: todo admin vê a mesma empresa fictícia. Riscos do lado do back: o registro de visualizações, tempo de vídeo e toques gera muita escrita (lote, índices e prazo de retenção); o painel mostra o comportamento individual de cada membro, o que ele curtiu, comentou e comprou, e o texto dos comentários sem resposta (precisa estar na política de privacidade, com retenção definida, e nunca sair da equipe do tenant); e qualquer migration roda em produção no merge da master, e a homolog usa o mesmo Supabase.

## Correções do FRONT.pdf (20/10)

Os outros itens do PDF ficaram só no front: vídeos sem a barra do player e com som desde a abertura, story que só pausa segurando, setas e cantos arredondados na barra de stories, excluir e compartilhar story. Os itens abaixo dependem do back. Riscos comuns: qualquer migration roda em produção no merge da master, e a homolog usa o mesmo Supabase; nos itens 13 e 14, o banco e a API sobem antes (ou junto) do web, porque o formulário passa a aceitar mais assim que a constante do contrato muda.

### 11. Excluir evento

- **O que mudou:** o formulário de edição do evento (junto de cancelar e reativar) e o aviso de evento cancelado ganharam o botão "Excluir evento", desativado e com "Em breve", só para quem gerencia eventos. O botão não faz nada: não existe rota de exclusão de evento.
- **Back:**
  - `DELETE /v1/events/{id}`, com a mesma permissão de editar o evento, fazendo exclusão suave: preencher `events.deleted_at` (a coluna existe, e o serviço, os lembretes, as notificações e as fotos já filtram `deleted_at is null`);
  - decidir o que acontece com as confirmações e os check-ins: a D-214 diz que respostas e check-ins nunca são apagados, então na exclusão suave eles ficam no banco e só o evento some das telas;
  - lembretes já agendados: o job de lembretes já lê se o evento foi excluído, conferir que ele pula o envio;
  - decidir se dá para excluir evento que já tem check-in, ou só cancelado ou sem confirmações.
- **Por quê:** hoje o evento só pode ser cancelado (e reativado); não há como tirá-lo do app.

### 12. Excluir comunidade arquivada

- **O que mudou:** o formulário da comunidade arquivada e a página dela (junto de "Reativar") ganharam o botão "Excluir comunidade", desativado e com "Em breve", só para quem gerencia comunidades. O botão não faz nada: não existe rota de exclusão de comunidade.
- **Back:**
  - `DELETE /v1/communities/{id}`, aceito só para comunidade arquivada, fazendo exclusão suave em `communities.deleted_at` (a coluna existe);
  - publicações: a chave de `feed_posts.community_id` não tem `on delete`, então uma exclusão definitiva falha; na suave, o feed, o Reels e a página do post precisam esconder as publicações da comunidade excluída;
  - o que hoje cai em cascata numa exclusão definitiva e precisa de decisão na suave: membros (`community_members`), destaques e fixações de story (`story_highlights`, `story_community_pins`) e os vínculos com produtos da Loja (`store_product_communities`); para a Loja, decidir o que acontece com quem comprou acesso a ela.
- **Por quê:** hoje a comunidade arquivada só pode ser reativada; não há como removê-la.

### 13. Cronograma do evento sem o limite de 30 momentos

- **O que mudou:** nada no front, por decisão de 20/10. O limite de 30 está no contrato (`EVENT_SCHEDULE_MAX_ITEMS` em `packages/modules/events/contracts/index.ts`, usado pelo schema da API e lido pelo formulário em `apps/web/lib/event-extras.ts`) e numa CHECK do banco (`events_schedule_chk`, `jsonb_array_length(schedule) <= 30`). Mudar só o front faria o formulário aceitar mais momentos e a API recusar o salvamento.
- **Back:** migration trocando a CHECK `events_schedule_chk` e a constante no contrato (o formulário acompanha sozinho). Proposta: 200 momentos, mantendo um teto para proteger a linha do evento e a página.
- **Por quê:** o cliente pediu cronogramas com mais de 30 momentos.

### 14. Nome do destaque sem o limite de 15 caracteres

- **O que mudou:** nada no front, por decisão de 20/10. O limite de 15 está no contrato (`STORY_HIGHLIGHT_MAX_TITLE` em `packages/modules/stories/contracts/index.ts`, lido pelo publicar story e pelo gerenciador de destaques), na checagem do serviço (`packages/modules/stories/server/service.ts`) e numa CHECK do banco (`story_highlights_title_chk`, de 1 a 15 caracteres).
- **Back:** migration trocando a CHECK `story_highlights_title_chk` e a constante no contrato (os formulários acompanham sozinhos). Proposta: 50 caracteres. O nome aparece numa linha embaixo do círculo do destaque, então nomes longos vão aparecer cortados com reticências.
- **Por quê:** o cliente pediu nomes de destaque maiores.
