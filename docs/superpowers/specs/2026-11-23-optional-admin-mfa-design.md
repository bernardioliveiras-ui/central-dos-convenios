# MFA opcional para o administrador — design curto (2026-11-23)

## Intenção

Permitir que o administrador já cadastrado entre com e-mail e senha sem ser
obrigado a configurar um aplicativo autenticador, mantendo a opção de ativar
o MFA quando desejar. Preservar o fluxo e os dados existentes dos corretores.

## Alternativas consideradas

1. **Remover MFA completamente:** acesso apenas por senha; mais simples, mas
   perde a possibilidade de reforçar a conta no futuro.
2. **MFA opt-in — escolhido pelo usuário:** senha basta enquanto não houver MFA
   ativado; depois de ativá-lo, sessões novas pedem código de 6 dígitos.

## Escopo proposto

- API: `requireStaff` autoriza ADMIN ativo com senha/sessão válida quando
  `mfa_enabled=0`. Quando `mfa_enabled=1`, continua exigindo MFA verificado na
  sessão. `/api/me` indica necessidade de desafio somente para MFA já ativado.
- Portal: login ADMIN sem MFA leva diretamente ao painel. Painel administrativo
  mostra controle **Ativar verificação em duas etapas** (somente se desativado),
  que inicia configuração voluntária. Se MFA já estiver ativo, manter desafio
  no login para sessões novas.
- Chave antiga exibida em captura de tela: ao iniciar a configuração voluntária,
  exigir a senha atual, limitar tentativas, sempre gerar e salvar uma **nova**
  chave antes da ativação; nunca reutilizar uma chave pendente exposta. Isso
  impede que uma sessão deixada aberta ative MFA com autenticador de terceiros.
- Segurança mantida: PBKDF2 + pepper, sessões HttpOnly/SameSite, proteção contra
  origem cruzada, controles de função/conta, limitação de tentativas e auditoria.
- Sem migração D1, sem recriação de ADMIN, sem alterações nos secrets e sem
  automação de publicação. O usuário recebe ZIP e faz GitHub/Cloudflare.
- Atualizar testes de autorização/admin/MFA e instruções operacionais.

## Limitações e risco assumido

Sem MFA ativado, comprometimento da senha pode dar acesso ao painel. Recomendam-se
senha forte/exclusiva, backup e WAF. Depois de ativado, não haverá botão de
desativação nesta alteração; uma recuperação segura precisará de procedimento
administrativo específico. O cadastro público segue fechado até a aprovação
jurídica e Turnstile. Validação de produção depende de teste após deploy manual.
