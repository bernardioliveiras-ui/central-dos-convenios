import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/server/worker.js';
import {createSession} from '../src/server/auth.js';
import {hashPassword,generateTotp} from '../src/server/crypto.js';
import {estimateDemoPlan} from '../src/client/simulation.js';
import {createTestDb,seedApplication,apiRequest,testEnv,bootstrapAdmin} from './db-helper.js';

async function brokerSession(db,env,id,appId,state='ACTIVE'){
  const passwordHash=await hashPassword('Senha-Corretor-Exemplo!2026',env.PASSWORD_PEPPER);
  db.sqlite.prepare('INSERT INTO auth_users(id,email,role,password_hash,state) VALUES (?,?,?,?,?)')
    .run(id,`${id}@example.com`,'CORRETOR',passwordHash,state);
  db.sqlite.prepare('INSERT INTO broker_profiles(auth_user_id,application_id) VALUES (?,?)').run(id,appId);
  return (await createSession(env,id)).split(';')[0];
}

test('corretor aprovado vê somente seu próprio perfil e não acessa BKO',async()=>{
  const db=createTestDb();seedApplication(db,'app-a');seedApplication(db,'app-b');
  db.sqlite.prepare("UPDATE applications SET status='APROVADO'").run();
  const env=testEnv(db),cookie=await brokerSession(db,env,'broker-a','app-a');
  await brokerSession(db,env,'broker-b','app-b');
  const response=await worker.fetch(apiRequest('/api/me','GET',null,cookie),env);
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.role,'CORRETOR');
  assert.equal(data.name,'Maria Oliveira');
  assert.equal(data.demoSimulation,true);
  assert.equal(data.quotesEnabled,false);
  assert.equal(JSON.stringify(data).includes('maria-app-b@example.com'),false);
  assert.equal((await worker.fetch(apiRequest('/api/bko/applications','GET',null,cookie),env)).status,403);
});

test('pedido pendente, suspensão ou conta revogada bloqueiam o corretor',async()=>{
  const db=createTestDb();seedApplication(db);const env=testEnv(db);
  const cookie=await brokerSession(db,env,'broker-a','app-1');
  assert.equal((await worker.fetch(apiRequest('/api/me','GET',null,cookie),env)).status,403);
  db.sqlite.prepare("UPDATE applications SET status='APROVADO' WHERE id='app-1'").run();
  db.sqlite.prepare("UPDATE broker_profiles SET suspended_at=CURRENT_TIMESTAMP WHERE auth_user_id='broker-a'").run();
  assert.equal((await worker.fetch(apiRequest('/api/me','GET',null,cookie),env)).status,403);
  db.sqlite.prepare("UPDATE broker_profiles SET suspended_at=NULL WHERE auth_user_id='broker-a'").run();
  db.sqlite.prepare("UPDATE auth_users SET state='SUSPENDED' WHERE id='broker-a'").run();
  assert.equal((await worker.fetch(apiRequest('/api/me','GET',null,cookie),env)).status,401);
});

test('nova sessão ADMIN não reutiliza código TOTP já aceito em outra sessão',async()=>{
  const db=createTestDb(),env=testEnv(db),cookie=await bootstrapAdmin(worker,env);
  const setup=await (await worker.fetch(apiRequest('/api/auth/mfa/setup','POST',{password:'Senha-Admin-Demonstracao!2026'},cookie),env)).json();
  const code=await generateTotp(setup.secret);
  assert.equal((await worker.fetch(apiRequest('/api/auth/mfa/verify','POST',{code},cookie),env)).status,200);
  const fresh=await worker.fetch(apiRequest('/api/auth/login','POST',{email:'acesso@centraldosconvenios.com.br',password:'Senha-Admin-Demonstracao!2026'}),env);
  const newCookie=fresh.headers.get('set-cookie').split(';')[0];
  assert.equal((await worker.fetch(apiRequest('/api/auth/mfa/verify','POST',{code},newCookie),env)).status,400);
  assert.equal((await worker.fetch(apiRequest('/api/bko/applications','GET',null,newCookie),env)).status,403);
});

test('origem externa é negada inclusive para sessão válida',async()=>{
  const db=createTestDb(),env=testEnv(db),cookie=await bootstrapAdmin(worker,env);
  const response=await worker.fetch(apiRequest('/api/auth/logout','POST',{},cookie,{'origin':'https://site-externo.example'}),env);
  assert.equal(response.status,403);
  assert.equal((await worker.fetch(apiRequest('/api/me','GET',null,cookie),env)).status,200);
});

test('preços de demonstração calculam corretamente e jamais alegam ser cotação oficial',()=>{
  assert.deepEqual(estimateDemoPlan('saude',1,1),{monthly:269,annual:3228,fictitious:true});
  assert.deepEqual(estimateDemoPlan('odontologico',0,3),{monthly:82.65,annual:991.8,fictitious:true});
  assert.throws(()=>estimateDemoPlan('saude',5,1));
  assert.throws(()=>estimateDemoPlan('pet',0,200));
});

test('configuração pública nunca revela segredos e cadastro segue fechado por padrão',async()=>{
  const response=await worker.fetch(apiRequest('/api/public-config'),{SESSION_SECRET:'do-not-expose',ADMIN_SETUP_TOKEN:'do-not-expose',TURNSTILE_SECRET:'do-not-expose'});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.registrationOpen,false);
  assert.equal(data.authAvailable,false);
  assert.equal(JSON.stringify(data).includes('do-not-expose'),false);
});
