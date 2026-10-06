# Pendências de backend

Atualizado em 2026-10-06.

## Marca

### 1. Logo do modo escuro

- **O que mudou:** o assistente de novo tenant e a aba Marca ganharam o campo "Logo do modo escuro", só na prévia.
- **Back:** aceitar o upload `logoDark` em `BRANDING_UPLOAD_KINDS`, guardar a URL na marca e devolvê-la no bootstrap e no by-host (`hostBrandingSchema` e `resolveBranding`).
- **Por quê:** um logo escuro some no tema escuro. Com o segundo logo, o app troca sozinho conforme o tema.

## Eventos

### 2. Informações úteis (traje, incluso, o que levar, certificado)

- **O que mudou:** o formulário de evento ganhou a etapa 2 com esses campos. Hoje eles são salvos dentro da descrição, num bloco "Informações úteis".
- **Back:** colunas novas em `events`: `dress_code`, `included`, `bring`, `certificate` e `certificate_hours`. Criar e editar aceitam, o detalhe devolve. Migrar os blocos já salvos nas descrições.
- **Por quê:** o bloco gasta o limite de 4.000 caracteres da descrição e aparece como texto em qualquer lugar que mostre a descrição crua.

### 3. Código do ingresso

- **O que mudou:** o cartão "Inscrição confirmada" mostra um código de exemplo (EXEMPLO).
- **Back:** gerar um código único por inscrição quando o membro responde "Vou" e devolvê-lo só para ele.
- **Por quê:** o membro mostra o código na entrada e o admin localiza a inscrição por ele.

### 4. QR pessoal e leitor do admin

- **O que mudou:** o ingresso mostra um QR decorativo (EXEMPLO). O "Escanear QR code" do admin não foi feito.
- **Back:** um token pessoal por inscrição e uma rota para o admin validar o QR lido e registrar a presença.
- **Por quê:** fazer o check-in na porta lendo o QR. Hoje o membro digita o código de 4 caracteres do local.

### 5. Programação

- **O que mudou:** a página do evento ganhou a seção "Programação", com abas por dia, preenchida com um exemplo (EXEMPLO).
- **Back:** tabela `event_schedule_items` (horário, título, palestrante, ordem), devolvida no detalhe, e rotas para o admin cadastrar.
- **Por quê:** mostrar a agenda real do evento.

### 6. Certificado

- **O que mudou:** botão "Ver meu certificado" para quem fez check-in num evento encerrado. Hoje só mostra um aviso (EXEMPLO).
- **Back:** gerar o PDF (nome, evento, data e horas) e a rota `GET /v1/events/{id}/certificate`, só para o próprio membro. Depende do item 2.
- **Por quê:** o membro baixar o certificado.

### 7. Pagamento e nota fiscal

- **O que mudou:** o cartão de inscrição mostra "pagamento aprovado" e "Ver nota fiscal" de exemplo (EXEMPLO).
- **Back:** preço por evento, integração de pagamento e emissão de nota fiscal.
- **Por quê:** eventos pagos. Depende de decisão de produto. Se os eventos forem gratuitos, o front tira essa linha.

### 8. Tela "Meus eventos"

- **O que mudou:** tela nova com os eventos inscritos e participados, horas e certificados. Para somar horas e certificados, ela abre o detalhe de até 10 eventos, um por um.
- **Back:** rota `GET /v1/events/mine` com as listas e os totais.
- **Por quê:** a tela fica mais rápida, e os números ficam exatos acima de 10 eventos.

### 9. Tela "Fotos"

- **O que mudou:** tela nova com as fotos dos eventos que já aconteceram. Ela faz uma chamada por evento e mostra só os 12 mais recentes.
- **Back:** rota `GET /v1/events/photos`, paginada, com o evento de cada foto.
- **Por quê:** a tela fica mais rápida e mostra também os eventos mais antigos.

## Feed e perfil

### 10. Ícone de administrador

- **O que mudou:** ícone ao lado do nome do admin nos posts e no perfil, na cor secundária. Em "Editar perfil", o admin escolhe entre 10 ícones (coroa é o padrão). A escolha fica num cookie do aparelho (`rede_admin_icon`), então só o aparelho de quem escolheu mostra o ícone; os outros veem a coroa. O ícone aparece em todo autor quando só admins podem postar.
- **Back:**
  - guardar o ícone escolhido no perfil do membro (um campo como `adminIcon`, aceitando só os ids `crown`, `star`, `gem`, `seal`, `shield`, `trophy`, `medal`, `bolt`, `flame`, `heart`) e aceitá-lo no `PATCH /v1/me/profile`;
  - devolver o ícone e `isAdmin` (ou o papel) do autor no post (`feedPostAuthorSchema`) e no perfil de membro.
- **Por quê:** todos os membros verem o ícone que o admin escolheu, em qualquer aparelho. E, se o tenant liberar posts para membros, o ícone aparecer só nos admins, inclusive quando outra pessoa abre o perfil de um admin.
