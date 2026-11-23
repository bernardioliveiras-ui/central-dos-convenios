import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function createTestDb() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_init.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0002_cloudflare_auth.sql',import.meta.url),'utf8'));
  const prepare=(sql)=>{
    const statement=sqlite.prepare(sql);
    let args=[];
    return {
      bind(...next) { args=next; return this; },
      async first() { return statement.get(...args) ?? null; },
      async all() { return {results:statement.all(...args)}; },
      async run() { const result=statement.run(...args); return {meta:{changes:result.changes}}; }
    };
  };
  const batch=async(statements)=>{
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const output=[];
      for (const statement of statements) output.push(await statement.run());
      sqlite.exec('COMMIT');
      return output;
    } catch(e){sqlite.exec('ROLLBACK');throw e;}
  };
  return { prepare, batch, sqlite };
}

export function seedApplication(db,id='app-1') {
  db.sqlite.prepare('INSERT INTO applications (id,name,email,phone,city,state,susep,profile,product) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id,'Maria Oliveira',`maria-${id}@example.com`,'11999999999','Barueri','SP','123456','cpf','saude');
}

export function apiRequest(path, method='GET', data, cookie, extraHeaders={}) {
  return new Request(`https://central.example${path}`,{
    method,
    headers:{...(data && {'content-type':'application/json'}),...(cookie && {'cookie':cookie}),...(method!=='GET' && {'origin':'https://central.example'}),...extraHeaders},
    ...(data && {body:JSON.stringify(data)})
  });
}

export function testEnv(db) {
  return {DB:db, SESSION_SECRET:'local-test-session-secret-please-change-1234567890',PASSWORD_PEPPER:'local-test-password-pepper-123456789012345',ADMIN_SETUP_TOKEN:'local-test-bootstrap-secret-1234567890',PORTAL_ORIGIN:'https://central.example',RATE_LIMIT_SALT:'local-test-rate-salt'};
}

export async function bootstrapAdmin(worker,env) {
  const response=await worker.fetch(apiRequest('/api/setup/admin','POST',{setupToken:env.ADMIN_SETUP_TOKEN,email:'Acesso@centraldosconvenios.com.br',password:'Senha-Admin-Demonstracao!2026'}),env);
  if(response.status!==201)throw Error(`Bootstrap failed: ${response.status} ${await response.text()}`);
  const login=await worker.fetch(apiRequest('/api/auth/login','POST',{email:'Acesso@centraldosconvenios.com.br',password:'Senha-Admin-Demonstracao!2026'}),env);
  if(login.status!==200)throw Error(`Admin login failed: ${login.status}`);
  return login.headers.get('set-cookie').split(';')[0];
}
