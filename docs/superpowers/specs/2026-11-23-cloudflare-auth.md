# Autenticação e convites na própria Cloudflare

Objetivo: retirar Supabase do portal Central dos Convênios e usar apenas Worker + D1, mantendo uma conta ADMIN no e-mail `Acesso@centraldosconvenios.com.br` e contas de corretores aprovados individualmente.

## Fluxos

- O proprietário configura `SESSION_SECRET` e `ADMIN_SETUP_TOKEN` como secrets do Worker, aplica migração D1 e executa **manualmente** o bootstrap pelo PowerShell. Apenas uma conta ADMIN pode ser criada; bootstrap deve ser desabilitado removendo o secret.
- Login com e-mail e senha individual. Senhas são derivadas com PBKDF2-SHA256, salt aleatório por usuário e 600 mil iterações. Sessões aleatórias de 256 bits são guardadas no D1 apenas como hash SHA-256, expirem após 12 horas e usam cookie `__Host-` HttpOnly, Secure, SameSite=Strict.
- ADMIN obrigatoriamente configura/valida TOTP antes do primeiro acesso ao BKO, e valida novamente em cada login. Segredo TOTP cifrado no banco com AES-GCM e chave derivada do `SESSION_SECRET`. Tentativas de login e MFA são limitadas no D1.
- Cadastro profissional público mantém Turnstile, rate limit, termos e aprovação jurídica como pré-requisitos, fechado por padrão. O administrador analisa a SUSEP manualmente e aprova ou rejeita.
- Na aprovação, uma conta individual INVITED, vínculo ao pedido e token de ativação de uso único com 24h são gerados atomicamente. A URL completa aparece apenas na resposta da aprovação, para o ADMIN copiar ou enviar via botão WhatsApp. O WhatsApp **não é enviado automaticamente**; requer clique e confirmação no aplicativo. Token apenas com hash persistido. ADMIN pode revogar e gerar novo convite quando necessário.
- Corretor usa link, define senha e acessa seu próprio painel. Recuperação depende de novo convite manual do ADMIN, sem prometer e-mail automático.
- Painel do corretor oferece simulador **exclusivamente demonstrativo**, com valores fictícios explicitamente marcados, cálculo local e sem gravação de dados de clientes. Preços reais e propostas comerciais dependem de tabelas/APIs homologadas; devem permanecer bloqueados até essa etapa.

## Segurança e limites

- Nenhum token de autenticação enviado em query para APIs; link de ativação utiliza fragmento do URL (`#token=`) para evitar logs de servidor. Frontend remove fragmento assim que lê. Endpoints privados verificam sessão no D1, papel e MFA; mutações conferem origem e sessão.
- Nenhum lead ou dado clínico de clientes é armazenado. Links de ativação no WhatsApp são sensíveis e expiram. Registros de auditoria não contêm credenciais ou URLs de convite.
- Não executar deploy nem criar credenciais em serviços externos. O proprietário ativa infraestrutura, registra os dados jurídicos reais e executa testes reais no domínio.
