# Central dos Convênios — Portal de Parceiros v0.3.3

Projeto para GitHub → Cloudflare Workers + Cloudflare D1. **Não usa Supabase nem serviço externo de autenticação.** A implantação, as senhas e as contas são administradas manualmente pelo proprietário, via PowerShell e painel do portal. Nenhuma conta é provisionada pelo ZIP.

## O que funciona após a ativação manual

- Landing page responsiva com logotipo/favicons atualizados sem fundo branco.
- Login individual no Worker com PBKDF2 compatível com o limite de produção da Cloudflare e HMAC usando `PASSWORD_PEPPER` independente, sessões HttpOnly/Secure/SameSite, expiração, logout/revogação e limite de tentativas. **MFA é opcional** para o ADMIN: sem ativação, e-mail e senha bastam; depois de ativado, códigos TOTP são obrigatórios em novos logins.
- Única conta administrativa: `Acesso@centraldosconvenios.com.br`. A criação exige o segredo de inicialização e só é aceita uma vez.
- **Recuperação manual e de uso único da senha ADMIN** com `ADMIN_RECOVERY_TOKEN` temporário, sem recriar conta nem apagar D1; revoga todas as sessões antigas e mantém o MFA já ativado.
- Solicitações de credenciamento protegidas por Turnstile e bloqueadas até termos reais e aprovação jurídica estarem configurados.
- Painel ADMIN para analisar SUSEP, aprovar/reprovar, auditar decisões, criar link individual de ativação de 24 horas, reemitir e recuperar acesso de corretor aprovado.
- **Botão “Enviar boas-vindas pelo WhatsApp”**: abre WhatsApp com texto e link preenchidos, **sem envio automático**. O administrador confirma destinatário e envio.
- Contas de corretores independentes; ativação de uso único, senha própria, área privada. Sem carteira de leads e sem armazenamento de dados de clientes.
- Simulador interativo **somente para apresentação**, com valores fictícios identificados em todas as simulações. Não calcula planos reais, propostas, coberturas ou preços de operadoras.

## Primeiro acesso

**Quem já usa a v0.3.1 ou v0.3.2:** substitua os arquivos do repositório pelo pacote v0.3.3, faça o push e aguarde a Cloudflare implantar. Não recrie o ADMIN, não rode as migrações de novo, não substitua os secrets permanentes. Após a atualização, faça logout e login no portal: se o MFA ainda estiver desativado, entrará direto no painel. O botão "Ativar verificação em duas etapas" fica disponível dentro do BKO e pede a senha atual antes de gerar a chave. Qualquer chave TOTP pendente anteriormente exibida em captura de tela é substituída por chave nova quando se inicia a configuração voluntária. **Isso reduz a segurança enquanto MFA estiver desligado: mantenha senha forte e exclusiva.** Se o MFA já estiver ativado no D1, esta atualização não o desativa nem contorna o desafio.

**Quem já está na v0.3.2 e esqueceu a senha ADMIN:** instale o ZIP v0.3.3 no repositório (sem migrações), depois siga **a seção 3A de [ATIVACAO-POWERSHELL.md](ATIVACAO-POWERSHELL.md)**. Crie `ADMIN_RECOVERY_TOKEN` apenas durante a recuperação e remova-o imediatamente após a atualização da senha. **Não rode novamente o bootstrap do ADMIN e não regenere `SESSION_SECRET` nem `PASSWORD_PEPPER`.**

Leia **[ATIVACAO-POWERSHELL.md](ATIVACAO-POWERSHELL.md)** para aplicar as duas migrações ao D1 certo, configurar `SESSION_SECRET`, `RATE_LIMIT_SALT`, `PASSWORD_PEPPER` e o temporário `ADMIN_SETUP_TOKEN`, inicializar o ADMIN manualmente, apagar o segredo de inicialização e ligar o Turnstile quando a documentação estiver aprovada. Quem já migrou o D1 e tem `SESSION_SECRET` e `RATE_LIMIT_SALT` **não deve criar novamente esses secrets**: apenas acrescente `PASSWORD_PEPPER`.

No terminal do projeto:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run check:config
npx.cmd wrangler deploy --dry-run
```

O pacote tem Worker em `src/server/worker.js`, autenticação em `src/server/auth.js`, criptografia em `src/server/crypto.js`, cliente em `src/client/portal.js`, migrações `0001_init.sql` + `0002_cloudflare_auth.sql` e testes em `tests/`.

O `wrangler.jsonc` já usa o nome `central-dos-convenios` e o hostname `central-dos-convenios.bernardioliveiras.workers.dev`; valide o D1 ligado antes de aplicar qualquer comando remoto.

**Atenção:** testes automatizados locais e dry-run não garantem que o site publicado ou as configurações da conta Cloudflare estejam funcionando. Testes ponta a ponta, dados jurídicos reais, proteção WAF, backup, retenção LGPD e validação independente de segurança continuam sob responsabilidade do proprietário. **O ZIP não publica o site.**

## Limites da demonstração

As cotações no simulador são inventadas, exclusivamente para apresentar navegação e interação. Para comercialização é necessário homologar regras, idades, regiões, coberturas e tabelas/APIs das operadoras, substituir o módulo fictício por fonte oficial, revisar textos e aprovar contrato/legal. Nunca envie um valor demonstrativo como cotação real.
