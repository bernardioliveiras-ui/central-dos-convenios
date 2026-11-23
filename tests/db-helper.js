import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function createTestDb() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_init.sql',import.meta.url),'utf8'));
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

export function tokenFor(id,aal='aal2') {
  const payload=Buffer.from(JSON.stringify({sub:id,aal,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  return `test.${payload}.signature`;
}

export function apiRequest(path, method='GET', data, jwt) {
  return new Request(`https://central.example${path}`,{
    method,
    headers:{...(data && {'content-type':'application/json'}),...(jwt && {'authorization':`Bearer ${jwt}`})},
    ...(data && {body:JSON.stringify(data)})
  });
}

export function testEnv(db) {
  return {DB:db, SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test', SUPABASE_SERVICE_ROLE_KEY:'secret-test', PORTAL_ORIGIN:'https://central.example'};
}

export async function withFakeAuth(fn, options={}) {
  const saved=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async (url, request={})=>{
    calls.push({url:String(url),request});
    if (String(url).includes('/auth/v1/user')) return new Response(JSON.stringify({id:options.id??'bko-1',email:'bko@example.com'}),{status:options.unauthorized?401:200});
    if (String(url).includes('/auth/v1/invite')) return new Response(JSON.stringify(options.inviteFails?{message:'failure'}:{id:'broker-1',email:'maria@example.com'}),{status:options.inviteFails?500:200});
    throw Error('Unexpected network request');
  };
  try { return await fn(calls); } finally { globalThis.fetch=saved; }
}
