import {readFileSync} from 'node:fs';

const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const d1=config.d1_databases?.[0]?.database_id;
if(!d1||d1==='00000000-0000-0000-0000-000000000000'){
  console.error('BLOQUEADO: substitua database_id pelo ID do banco D1 criado na sua conta Cloudflare.');
  process.exitCode=1;
}else if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d1)){
  console.error('BLOQUEADO: o ID do banco D1 não está no formato esperado.');
  process.exitCode=1;
}else{
  console.log('Configuração D1 presente. Atenção: este teste NÃO verifica secrets, identidade, MFA, nem os requisitos legais.');
}
