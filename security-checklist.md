# Checklist de homologação — segurança e lançamento

**Estado:** pendente. Nenhuma conta real foi configurada ou testada neste pacote.

## Infraestrutura e credenciais

- [ ] D1 exclusivo criado e migração aplicada em produção.
- [ ] Segredos `SESSION_SECRET`, `RATE_LIMIT_SALT` e `TURNSTILE_SECRET` definidos somente no armazenamento seguro da Cloudflare.
- [ ] `PORTAL_ORIGIN` conferido; nenhum valor Supabase necessário.
- [ ] Bootstrap exclusivo do ADMIN concluído e `ADMIN_SETUP_TOKEN` **apagado** dos secrets do Worker.
- [ ] MFA TOTP do único ADMIN configurado; sessão sem segundo fator rejeitada no backend.
- [ ] Convite testado: válido uma vez, expira em 24h e é inutilizável após consumo/reemissão; envio manual WhatsApp confirmado.
- [ ] HTTPS, CSP, cookies/sessões, CORS, WAF, captcha e cabeçalhos observados no domínio final.
- [ ] Política de backup, restauração e exportação de auditoria testada.

## Autorização e isolamento

- [ ] BKO não autenticado (401), corretor tentando BKO (403), BKO sem MFA (403).
- [ ] Solicitante pendente ou reprovado sem perfil de corretor.
- [ ] Broker vinculado a outra inscrição sem acesso ao conteúdo dela; nenhuma rota permite informar `role`, `owner_id` ou `broker_id` do cliente.
- [ ] Conta suspensa bloqueada imediatamente, mesmo se a sessão D1 ainda existir; logout e recuperação revogam sessões.
- [ ] Duas aprovações concorrentes não resultam em convites adicionais nem autorizações duplicadas.
- [ ] Reemissão de convite, recuperação de senha e aprovação são auditadas; só ADMIN com MFA pode emitir links.
- [ ] Fluxos de recuperação, logout, expiração de cookie/sessão e perda de MFA testados.

## Cadastros e dados pessoais

- [ ] Token Turnstile inválido, expirado, de outro hostname ou ação: cadastro recusado.
- [ ] Limite por IP e regras WAF contra robôs validados.
- [ ] Duplicidade de e-mail não divulga a existência prévia da pessoa.
- [ ] Formulário não aceita dados além dos profissionais autorizados.
- [ ] Política de Privacidade, Termos, razão social/CNPJ e contato aprovados pelo responsável.
- [ ] Bases legais, consentimentos/ciência, retenção e exclusão de solicitações definidos.
- [ ] Logs e pixels não coletam PII, saúde, tokens ou dados de formulário.
- [ ] Não há importação de leads; simulações inventadas estão visivelmente marcadas como **DEMONSTRAÇÃO** e não são comercializadas.

## Operação e lançamento

- [ ] Teste manual em celular e desktop; teclado, foco e leitor de tela considerados.
- [ ] E-mail, WhatsApp e SUSEP do profissional verificados manualmente pelo ADMIN.
- [ ] Cenários completos com usuário de teste: pedido → análise → aprovação/reprovação → convite → ativação → sessão.
- [ ] Auditoria de segurança independente concluída (incluindo OWASP ASVS/IDOR) e achados graves corrigidos.
- [ ] Teste de restauração, incidentes, monitoramento de falhas e responsável de plantão definidos.
- [ ] Proprietário aprovou a comunicação “credenciamento antecipado” sem cotações comerciais ao vivo.
- [ ] Só então `LEGAL_APPROVED` e `REGISTRATION_OPEN` definidos como `"true"` e anúncios liberados.
