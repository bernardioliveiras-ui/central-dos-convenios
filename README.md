# Central dos Convênios — Portal de Parceiros v0.3

Projeto para GitHub → Cloudflare Workers + Cloudflare D1. **Não usa Supabase nem serviço externo de autenticação.** A implantação, as senhas e as contas são administradas manualmente pelo proprietário, via PowerShell e painel do portal. Nenhuma conta é provisionada pelo ZIP.

## O que funciona após a ativação manual

- Landing page responsiva com logotipo/favicons atualizados sem fundo branco.
- Login individual no Worker com hash forte de senha, sessões HttpOnly/Secure/SameSite, expiração, logout/revogação, limite de tentativas e segundo fator TOTP obrigatório para o único ADMIN.
- Única conta administrativa: `Acesso@centraldosconvenios.com.br`. A criação exige o segredo de inicialização e só é aceita uma vez.
- Solicitações de credenciamento protegidas por Turnstile e bloqueadas até termos reais e aprovação jurídica estarem configurados.
- Painel ADMIN para analisar SUSEP, aprovar/reprovar, auditar decisões, criar link individual de ativação de 24 horas, reemitir e recuperar acesso de corretor aprovado.
- **Botão “Enviar boas-vindas pelo WhatsApp”**: abre WhatsApp com texto e link preenchidos, **sem envio automático**. O administrador confirma destinatário e envio.
- Contas de corretores independentes; ativação de uso único, senha própria, área privada. Sem carteira de leads e sem armazenamento de dados de clientes.
- Simulador interativo **somente para apresentação**, com valores fictícios identificados em todas as simulações. Não calcula planos reais, propostas, coberturas ou preços de operadoras.

## Primeiro acesso

Leia **[ATIVACAO-POWERSHELL.md](ATIVACAO-POWERSHELL.md)** para aplicar as duas migrações ao D1 certo, configurar `SESSION_SECRET`, `RATE_LIMIT_SALT`, `ADMIN_SETUP_TOKEN`, inicializar o ADMIN manualmente, apagar o segredo de inicialização e ligar o Turnstile quando a documentação estiver aprovada.

No terminal do projeto:

```powershell
npm ci
npm test
npm run build
npm run check:config
npx wrangler deploy --dry-run
```

O pacote tem Worker em `src/server/worker.js`, autenticação em `src/server/auth.js`, criptografia em `src/server/crypto.js`, cliente em `src/client/portal.js`, migrações `0001_init.sql` + `0002_cloudflare_auth.sql` e testes em `tests/`.

O `wrangler.jsonc` já usa o nome `central-dos-convenios` e o hostname `central-dos-convenios.bernardioliveiras.workers.dev`; valide o D1 ligado antes de aplicar qualquer comando remoto.

**Atenção:** testes automatizados locais e dry-run não garantem que o site publicado ou as configurações da conta Cloudflare estejam funcionando. Testes ponta a ponta, dados jurídicos reais, proteção WAF, backup, retenção LGPD e validação independente de segurança continuam sob responsabilidade do proprietário. **O ZIP não publica o site.**

## Limites da demonstração

As cotações no simulador são inventadas, exclusivamente para apresentar navegação e interação. Para comercialização é necessário homologar regras, idades, regiões, coberturas e tabelas/APIs das operadoras, substituir o módulo fictício por fonte oficial, revisar textos e aprovar contrato/legal. Nunca envie um valor demonstrativo como cotação real.
