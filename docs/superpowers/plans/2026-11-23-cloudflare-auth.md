# Plano de implementação: Worker + D1

1. Atualizar o esquema D1 com usuários locais, sessões, tokens de ativação e contadores de MFA.
2. Criar e testar primitivas criptográficas Web Crypto e sessão segura.
3. Trocar validação remota Supabase por login, logout, TOTP, bootstrap ADMIN e ativação local; testar acesso negado, replay, sessão e rate limiting.
4. Substituir convites Supabase por aprovação transacional e link de WhatsApp acionado manualmente; testar concorrência, expiração e reemissão.
5. Atualizar portal, configurações, guia de PowerShell, testes e checklists; executar build, testes, checagem e dry-run de deploy sem publicar.
6. Entregar ZIP e instruções para ativação manual pelo proprietário.
