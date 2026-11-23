# Ativação manual — PowerShell / Cloudflare

**Você controla todas as etapas.** Este arquivo é um roteiro, não é executado sozinho. Não há deploy automático, criação de contas ou envio automático de WhatsApp pelo ZIP. Siga o fluxo GitHub → Cloudflare que você já usa.

Endereço do Worker: `https://central-dos-convenios.bernardioliveiras.workers.dev`

## 1. Validar o repositório e o D1 certo

Abra o PowerShell na pasta do projeto:

```powershell
npm ci
npm test
npm run build
npm run check:config
npx wrangler whoami
npx wrangler d1 list
npx wrangler d1 migrations list central_convenios --remote
```

Confira nome/conta/`database_id` do `wrangler.jsonc` antes de alterar a base. **Faça backup D1** se ela já tem dados. A migração `0002_cloudflare_auth.sql` adiciona tabelas e preserva as inscrições existentes. Quando estiver tudo conferido:

```powershell
npx wrangler d1 migrations apply central_convenios --remote
```

**Importante:** contas Supabase antigas não migram sozinhas. É necessário convidar novamente os corretores existentes e ativar novas senhas. Não importe hashes ou secrets antigos sem revisão.

## 2. Secrets obrigatórios do portal (sem Supabase)

Depois de enviar o novo código ao GitHub e conferir que o deploy terminou no Worker certo, gere valores aleatórios exclusivos e insira-os manualmente. Exemplo PowerShell; cada comando `wrangler secret put` altera a versão implantada do Worker:

```powershell
$SessionSecret = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
$SessionSecret | npx wrangler secret put SESSION_SECRET
Remove-Variable SessionSecret

$RateSalt = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
$RateSalt | npx wrangler secret put RATE_LIMIT_SALT
Remove-Variable RateSalt
```

**Guarde `SESSION_SECRET` em um cofre seguro para eventual restauração e não o troque sem planejamento:** sua troca invalida sessões, tokens pendentes e a chave de cifragem do TOTP do ADMIN. É necessário um procedimento de recuperação do segundo fator antes de rotacionar. Nunca inclua esse segredo no Git, no ZIP ou no chat.

Consulte a configuração pública:

```powershell
$Site = 'https://central-dos-convenios.bernardioliveiras.workers.dev'
Invoke-RestMethod "$Site/api/public-config" | Format-List
```

`authAvailable` deve ser `true` após o D1 e ambos os secrets estarem corretos. `registrationOpen` continuará `false` até os documentos e Turnstile serem aprovados.

**Plano Cloudflare:** a modalidade Workers Free limita o tempo de CPU a 10 ms por requisição. O algoritmo de senha PBKDF2 com 600 mil iterações é propositalmente pesado; valide login/ativação no ambiente real e confira os erros de CPU. Pode ser necessário usar Workers Paid para esse fluxo sem enfraquecer a proteção de senhas.

## 3. Criar o único ADMIN

E-mail **fixo**: `Acesso@centraldosconvenios.com.br`. Verifique antes que a Central controla essa caixa.

Gere um segredo de inicialização temporário e cadastre-o; mantenha a variável apenas no PowerShell **até finalizar a criação**:

```powershell
$SetupToken = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
$SetupToken | npx wrangler secret put ADMIN_SETUP_TOKEN
```

Após a publicação da nova versão com o secret, digite **sua senha pessoal** de 12 a 128 caracteres sem colocá-la no histórico do terminal:

```powershell
$SecurePassword = Read-Host 'Escolha sua senha ADMIN (12 a 128 caracteres)' -AsSecureString
$Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
try {
  $Password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer)
  $Payload = @{ setupToken=$SetupToken; email='Acesso@centraldosconvenios.com.br'; password=$Password } | ConvertTo-Json -Compress
  Invoke-RestMethod -Uri "$Site/api/setup/admin" -Method POST -ContentType 'application/json' -Body $Payload
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer)
  Remove-Variable Password,Payload,SecurePassword -ErrorAction SilentlyContinue
}
```

**Imediatamente após a confirmação de criação**, remova o secret temporário e a variável local:

```powershell
npx wrangler secret delete ADMIN_SETUP_TOKEN
Remove-Variable SetupToken
```

Entre em `/portal.html` com o e-mail e a senha escolhida; adicione a chave fornecida ao Google/Microsoft Authenticator (TOTP), digite o código de seis dígitos e ative o segundo fator. O ADMIN só vê solicitações após isso. **Faça backup seguro do autenticador antes de usar em produção.** O portal não oferece recuperação automática de MFA; perda do autenticador requer procedimento manual de suporte em ambiente controlado.

## 4. Credenciar corretores e enviar no WhatsApp

1. O profissional preenche o cadastro quando o formulário público estiver legalmente liberado.
2. O ADMIN entra com MFA e confere SUSEP, e-mail e **WhatsApp** antes de aprovar.
3. Clique **Aprovar**. O painel mostra o link individual e o botão **Enviar boas-vindas pelo WhatsApp**.
4. Clique no botão: o WhatsApp abre com texto e URL já preenchidos. **Você confirma manualmente o envio para o número certo.** Não envie senha; só o link pessoal.
5. O corretor usa o link em até **24 horas**, cria senha e entra com seu e-mail profissional. O token só funciona uma vez.
6. Se o link vencer ou não for entregue, use **Novo convite**. Para corretor ativo que esqueceu a senha, use **Recuperar acesso**, que gera outro link e revoga sessões ao completar a troca de senha.

Não existe e-mail automático, conta criada em massa ou compartilhamento de senha. **O link de convite é sensível: não encaminhe para grupos.**

### Demonstração enquanto o cadastro público estiver fechado

Use somente dados de teste e contatos próprios/autorizados numa base de homologação. Não aprove cadastros fictícios como profissionais reais. Os valores do simulador do corretor são **fictícios e identificados na interface**, apenas para apresentação.

Para demonstrar a análise sem liberar o formulário, você pode colocar **uma inscrição sintética apenas no D1 local** e usar `wrangler dev`:

```powershell
npx wrangler d1 migrations apply central_convenios --local
npx wrangler d1 execute central_convenios --local --command "INSERT INTO applications (id,name,email,phone,city,state,susep,profile,product) VALUES ('demo-local-1','Corretor de Demonstracao','teste-controlado@example.com','11999999999','Barueri','SP','DEMO0001','cpf','saude')"
```

O exemplo **não altera o D1 remoto** e o número/e-mail devem ser trocados por contatos de teste sob seu controle antes de abrir WhatsApp ou ativar o acesso. Para corretores reais é necessário ter autorização e documentos próprios aprovados.

## 5. Liberar cadastro público somente após a revisão jurídica

Para abrir o formulário com dados reais:

1. Defina razão social real, responsável, CNPJ, política de privacidade e termos de parceria **aprovados**, com URLs HTTPS publicadas.
2. Configure em `wrangler.jsonc` `COMPANY_LEGAL_NAME`, `PRIVACY_POLICY_URL`, `PARTNER_TERMS_URL`, `LEGAL_APPROVED="true"`.
3. Crie Turnstile no hostname do Worker e coloque `TURNSTILE_SITE_KEY` (pública) em `wrangler.jsonc`. Configure `TURNSTILE_SECRET` pelo PowerShell:

```powershell
npx wrangler secret put TURNSTILE_SECRET
```

4. Teste o Siteverify, hostname/action, fila, MFA, reprovação, WhatsApp, ativação, isolamento de corretores, perda de link, recuperação, rate limit e incidentes na sua conta.
5. Após homologação operacional e jurídica, altere `REGISTRATION_OPEN` para `"true"` e publique no GitHub pelo seu fluxo usual.

Até isso acontecer o cadastro público deve permanecer fechado, **mesmo com autenticação ADMIN ativa**. A liberação jurídica não deve ser simulada com documentos fictícios.

## Cuidados de operação

- Configure regras WAF/rate limiting, controle de acesso ao dashboard Cloudflare e backup/restauração D1.
- Não registre dados de clientes no simulador; ele calcula localmente só categoria, faixa etária e quantidade.
- Cotações reais/comissões só devem ser implementadas após tabelas, contratos e integrações oficiais.
- Revise logs, sessão, links vencidos, suspensão de usuários, resposta a incidentes e conformidade LGPD antes de abrir ao público.
- Os testes e o ZIP não representam auditoria independente nem confirmam estado do site de produção.
