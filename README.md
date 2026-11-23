# Central dos Convênios — Portal de Corretores v0.2

Landing page independente + cadastro real de corretores + análise pelo BKO + convite de acesso + painel do corretor. Cores e logotipo da Central dos Convênios. A carteira particular de contatos **não é importada nem cadastrada**.

**IMPORTANTE:** este pacote é uma implementação inicial para configuração, homologação e auditoria. **Não está publicado nem pronto para receber tráfego pago com dados reais.** Sem as contas, credenciais, verificação jurídica e testes operacionais do proprietário, os formulários permanecem fechados por configuração. Ninguém deve interpretar o código ou os testes automatizados como certificação de segurança.

## O que existe

- Landing page responsiva, com CTA para credenciamento, explicação da parceria, três produtos, critérios e perguntas frequentes.
- Formulário público de dados **profissionais do corretor**, sem campo para carteira de leads e sem preços fictícios.
- API própria no Cloudflare Worker, banco Cloudflare D1, Turnstile com verificação no backend e limite simples de requisições.
- Portal de login individual por **Supabase Auth** (provedor externo independente de GPT); tokens de sessão guardados apenas na aba atual pelo SDK, nunca usados como fonte de autorização.
- Fila BKO Santana com decisão manual, motivo interno de reprovação, auditoria de decisão, convite de ativação e reenvio de convite falho.
- A API verifica a sessão junto à Supabase e consulta a permissão atual no D1 em cada operação restrita. BKO exige MFA AAL2.
- Painel do corretor com produtos e aviso de que **cotações comerciais estão desativadas** até homologação das tabelas.

## O que não existe ainda

- Cotação de preços em tempo real, tabelas/APIs de operadoras, envio de propostas, comissões ou carteira de leads.
- Conta Supabase, usuários BKO, banco D1 ou site Cloudflare criados para você.
- Envio de convites garantido: depende de provedor de e-mails da Supabase corretamente configurado, domínio permitido e confirmação de entrega.
- Revisão da LGPD, de termos de parceria, teste independente de segurança, backup e rotinas de suporte definidos pelo proprietário.

## Arquivos principais

| Arquivo | Responsabilidade |
|---|---|
| `index.html` | Landing page e formulário público |
| `portal.html` | Login, ativação, painel do corretor e BKO |
| `src/client/` | Interface sem dependência de GPT |
| `src/server/worker.js` | API REST e proteção do cadastro |
| `src/server/auth.js` | Validação da identidade e autorização por papel |
| `migrations/0001_init.sql` | Tabelas D1 (sem tabela de leads) |
| `public/_headers` | Cabeçalhos e CSP de páginas estáticas |
| `wrangler.jsonc` | Deploy de assets, Worker e binding D1 |
| `tests/` | Testes de rejeição, MFA, mudança de estado e isolamento |
| `security-checklist.md` | Critérios de aceite para lançamento real |

## Requisitos

- Node.js 20.19+ (recomendado 24 LTS) e npm;
- Conta **própria** Cloudflare com Workers, D1 e Turnstile;
- Conta **própria** Supabase com Auth e e-mails de convite configurados;
- Domínio/subdomínio HTTPS e informações jurídicas fornecidas pela Central.

Não envie senhas, tokens, API keys secretas ou dados de corretores por WhatsApp/chat de suporte. Use apenas configuração segura no painel do provedor.

## 1. Conferir e gerar frontend

```bash
npm install
npm test
npm run build
```

Para visualizar apenas as páginas em desenvolvimento: `npm run dev` e abra `http://127.0.0.1:5173/`. Nesse modo o formulário **não** recebe cadastros reais. Para testar APIs e D1, use `npx wrangler dev` depois de configurar o D1 local.

## 2. Criar banco D1 na sua Cloudflare

Entre na sua conta:

```bash
npx wrangler login
npx wrangler d1 create central_convenios
```

Copie o `database_id` retornado e substitua `00000000-0000-0000-0000-000000000000` no arquivo `wrangler.jsonc`. Em seguida:

```bash
npm run db:remote
```

**Não rode a migração num banco já usado por outro sistema.** O nome, o binding e a base são exclusivos deste projeto. A migration cria `applications`, `broker_profiles`, `staff_accounts`, `audit_events` e `request_limits`.

## 3. Configurar identidade na Supabase

Crie o projeto Supabase sob uma conta da Central. Em Authentication:

1. Desative **cadastro público/autossignup**: corretores entram apenas por convite do BKO, após aprovação.
2. Configure o **Site URL** para o domínio HTTPS da Cloudflare e permita os redirects `https://SEU-DOMINIO/portal.html` e `https://SEU-DOMINIO/portal.html?setup=1`. Configure também o redirect usado para recuperação de senha.
3. Configure o tempo de validade de links de convite/OTP em **24 horas** no provedor, confirme as regras de uso único e teste clique duplicado e link expirado. Não basta configurar esse tempo no frontend.
4. Ative **MFA TOTP** para o projeto, com uso obrigatório para BKO aplicado pela API (AAL2). Mantenha uma política forte de senha e regras de tentativas no provedor.
5. **Configure SMTP próprio** e identidade de e-mail com SPF/DKIM; o serviço padrão da Supabase pode ter limites e não deve ser assumido como pronto para convites reais.
6. Obtenha o **Project URL** e a **Publishable/anon key** (pública) no painel; obtenha a chave **service_role** (secreta) para o Worker.

No `wrangler.jsonc`, configure apenas `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `PORTAL_ORIGIN`, com o domínio HTTPS completo. A chave secreta **NÃO** entra no JSON:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

A aprovação usa a API administrativa da Supabase Auth para convidar o e-mail informado. O link e a conta são geridos pelo provedor; a Central **não armazena o token de convite**. Se o convite for emitido mas a ligação ao D1 falhar, o login é negado e a equipe precisará reconciliar manualmente. Não cadastre corretores na Supabase por fora da fila autorizada.

## 4. Criar a conta do Santana no BKO

Um administrador da Central deverá verificar a identidade do responsável e criar/invitar a conta dele pela Supabase. Depois de confirmar **pessoalmente** o e-mail e o `auth_user_id` na interface administrativa, rode no D1 um SQL equivalente a este (substitua o UUID):

```bash
npx wrangler d1 execute central_convenios --remote --command="INSERT INTO staff_accounts (auth_user_id,role,label) VALUES ('UUID-VERIFICADO-DA-SUPABASE','BKO','Santana')"
```

Não inclua esse UUID em código de frontend. É um dado administrativo e **não é senha**. O Santana acessará `/portal.html` e deverá configurar e confirmar a autenticação TOTP antes de visualizar solicitações. O frontend não pode conceder permissão BKO; a permissão existe apenas no D1.

Para suspender acesso da equipe: atualizar `staff_accounts.suspended_at` pelo canal administrativo com auditoria e revogar sessões no provedor. Para suspender um corretor: atualizar `broker_profiles.suspended_at`, registrar auditoria e revogar sessões. Exija procedimento de dupla checagem para essas operações.

## 5. Turnstile e proteção contra abusos

Crie um widget Turnstile na **sua** Cloudflare para o domínio final da LP. Copie a chave pública `TURNSTILE_SITE_KEY` em `wrangler.jsonc`; configure o segredo no Worker:

```bash
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put RATE_LIMIT_SALT
```

`RATE_LIMIT_SALT` deve ser um valor aleatório longo, exclusivo do ambiente. O backend exige `success=true`, o mesmo **hostname** do site e a ação `broker_signup`. A limitação D1 básica é 8 tentativas de envio por IP/hora e deve ser complementada com as **WAF/Rate Limiting Rules** da Cloudflare, proteção do login Supabase, monitoramento e testes de carga antes dos anúncios.

## 6. Informações oficiais e abertura do formulário

O proprietário da Central precisa fornecer/revisar os dados jurídicos, política de privacidade, termos de parceria e canal oficial. Depois de publicar documentos aprovados em URLs HTTPS:

```json
"COMPANY_LEGAL_NAME": "Razão social verdadeira e aprovada",
"PRIVACY_POLICY_URL": "https://SEU-DOMINIO/privacidade",
"PARTNER_TERMS_URL": "https://SEU-DOMINIO/termos",
"LEGAL_APPROVED": "true"
```

Essas configurações **não** validam o conteúdo jurídico; apenas exigem que a Central confirme a aprovação. Mantenha `REGISTRATION_OPEN` como `"false"` até todos os testes operacionais passarem. Depois, altere para `"true"` e publique uma nova versão.

## 7. Publicar na conta Cloudflare

Com o D1 real configurado:

```bash
npm run deploy
```

O comando confere se existe ID D1, gera a pasta `dist/` e publica **código Worker + assets** na Cloudflare. A interface anterior de **“Upload your static files” não é suficiente para esta versão**, pois ela não liga a API ao banco D1 nem aos segredos. Use Wrangler ou GitHub com build/deploy equivalente.

Antes da abertura real, faça testes ponta a ponta **no domínio final**: cadastro fictício com permissão da equipe, registro D1, fila Santana, MFA, reprovação, aprovação, chegada de e-mail, ativação, login do corretor, acesso negado a outro corretor e suspensão. Consulte `security-checklist.md`.

## 8. Migração futura para Hostinger

As páginas (`index.html`, `portal.html`, `src/client/`) podem ser compiladas e hospedadas em outro provedor. Contudo, **a API Worker e o banco D1 não migram simplesmente por upload de ZIP**: será necessário portar os endpoints para backend compatível (ex.: Node/PHP), migrar dados para PostgreSQL/MySQL, preservar identidade/autorização e refazer todos os testes. A Supabase Auth pode continuar independente, se contratualmente desejável.

## Política de acesso e dados

- Sem login: apenas LP e endpoint público para solicitar credenciamento (com proteção).
- BKO com MFA: vê solicitações, aprova/reprova e inicia convite.
- Corretor aprovado: vê **somente seu próprio perfil**; endpoints de cotação estão indisponíveis nesta fase.
- Cadastro pendente/reprovado ou conta suspensa: sem acesso privado.
- No banco, **não existe tabela de leads** nem dados clínicos de clientes.
- Somente uma futura atualização homologada poderá persistir cotações de clientes interessados, com verificação de proprietário em toda rota.

## Incidentes e responsabilidades

O dono deve indicar responsáveis por contas, revisão SUSEP, direitos de titulares LGPD, prazo de retenção, exportações de backup, recuperação de incidentes e auditoria independente. A v0.2 não substitui homologação, política jurídica nem teste externo de segurança.
