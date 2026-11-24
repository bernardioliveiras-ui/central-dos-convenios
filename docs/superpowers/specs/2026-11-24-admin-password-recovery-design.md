# Recuperação emergencial de senha ADMIN — design curto

## Intenção

O proprietário perdeu a senha do único ADMIN da Central dos Convênios e já
confirmou que a credencial não está mais na sessão do PowerShell. Recuperar
o acesso sem excluir conta, usuários, corretores, inscrições ou dados do D1.
O proprietário faz manualmente GitHub → Cloudflare e comandos PowerShell.

## Abordagens

1. Excluir ADMIN no D1 e executar bootstrap outra vez: **descartada**, pois
   pode violar referências e auditoria e perde o estado de segurança.
2. Atualizar o hash diretamente no D1: **descartada**; `PASSWORD_PEPPER` está
   guardado como segredo do Worker e não deve ser extraído.
3. **Escolhida**: endpoint de recuperação excepcional protegido por segredo
   aleatório temporário `ADMIN_RECOVERY_TOKEN`, configurado pelo proprietário
   no Worker, com senha nova inserida por `Get-Credential` no PowerShell.

## Comportamento e segurança

- `POST /api/setup/admin/recover` só atualiza senha do **ADMIN existente**
  com e-mail fixo `acesso@centraldosconvenios.com.br` se o token de recuperação
  corresponder ao secret de pelo menos 32 caracteres e a nova senha respeitar
  12 a 128 caracteres.
- O token tem alta entropia, comparação em tempo constante e limite por
  origem/taxa. A operação registra auditoria sem senha/token em claro.
- A mesma credencial de recuperação só pode ser usada **uma vez**, inclusive
  se o segredo temporário demorar a ser removido: identificador derivado
  criptograficamente ocupa uma chave única na tabela `audit_events` existente.
- Atualização de hash com `PASSWORD_PEPPER`, revogação de **todas** as sessões
  do ADMIN e marcação de token usado ocorrem em transação D1.
- Não muda `mfa_enabled`, contas de corretores nem estados de aprovação.
- A nova senha nunca aparece em logs, histórico, ZIP ou resposta da API.
- Após sucesso, proprietário apaga `ADMIN_RECOVERY_TOKEN` do Cloudflare,
  preferindo o dashboard com Deploy se o CLI retornar 10215. Nenhuma
  publicação ou acesso externo será executado pelo assistente.
- Não requer migração D1 nem reconfiguração de secrets permanentes.

## Limites

Não é um fluxo público de "esqueci senha" nem envia e-mail. Um portador do
secret temporário pode redefinir o ADMIN enquanto ele existir e não for
consumido; por isso deve ser criado só na operação de recuperação, usado uma
vez e removido imediatamente. O portal em produção só pode ser validado pelo
proprietário após o deploy do ZIP.
