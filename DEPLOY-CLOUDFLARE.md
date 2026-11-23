# Deploy correto no Cloudflare

Este projeto é um Cloudflare Worker com assets Vite e binding D1. A pasta `dist/` é gerada durante o build e não deve ser criada vazia nem depender de arquivos versionados.

## Configuração do pipeline conectado ao GitHub

Use:

- Node.js: 22.x ou versão compatível validada;
- Install command: `npm ci`;
- Build command: `npm run build`;
- Deploy command: `npx wrangler deploy`.

A sequência efetiva precisa ser:

```bash
npm ci
npm run build
npx wrangler deploy
```

Alternativamente, em um único comando local:

```bash
npm run deploy:cloudflare
```

O comando `npm run deploy` também executa `check:config` antes do build e bloqueia se o `database_id` D1 ainda for o placeholder. Isso é intencional.

## Erro corrigido

O erro abaixo ocorre quando o pipeline executa Wrangler antes do Vite:

```text
The directory specified by the "assets.directory" field does not exist:
/opt/buildhome/repo/dist
```

Não resolva criando uma `dist` vazia. O `dist` correto contém `index.html`, `portal.html`, assets compilados, logo, robots e headers.

## Antes do primeiro deploy

1. Criar o D1 na conta correta.
2. Substituir o `database_id` placeholder em `wrangler.jsonc`.
3. Configurar secrets com `wrangler secret put`.
4. Configurar `REGISTRATION_OPEN=false` até homologação.
5. Executar `npm test` e `npm run build`.
6. Usar `wrangler dev` e D1 local/preview antes de produção.
7. Não usar “Upload your static files”, pois a aplicação também possui Worker, API, D1 e secrets.
