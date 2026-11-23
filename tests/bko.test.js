import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/server/worker.js';
import {createTestDb,seedApplication,apiRequest,testEnv,bootstrapAdmin} from './db-helper.js';

async function setup(){
  const db=createTestDb();seedApplication(db);
  const env=testEnv(db),cookie=await bootstrapAdmin(worker,env);
  return {db,env,cookie};
}

test('reprovação exige motivo e grava trilha de auditoria',async()=>{
  const {db,env,cookie}=await setup();
  assert.equal((await worker.fetch(apiRequest('/api/bko/applications/app-1/decision','POST',{decision:'reject'},cookie),env)).status,400);
  assert.equal((await worker.fetch(apiRequest('/api/bko/applications/app-1/decision','POST',{decision:'reject',reason:'Registro SUSEP não confirmado'},cookie),env)).status,200);
  assert.equal(db.sqlite.prepare("SELECT status FROM applications WHERE id='app-1'").get().status,'REPROVADO');
  assert.equal(db.sqlite.prepare("SELECT count(*) c FROM audit_events WHERE action='APPLICATION_REJECTED'").get().c,1);
});

test('falha de auditoria impede decisão sem registro',async()=>{
  const {db,env,cookie}=await setup();
  db.sqlite.exec("CREATE TRIGGER block_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
  assert.equal((await worker.fetch(apiRequest('/api/bko/applications/app-1/decision','POST',{decision:'reject',reason:'Documentos insuficientes'},cookie),env)).status,503);
  assert.equal(db.sqlite.prepare("SELECT status FROM applications WHERE id='app-1'").get().status,'PENDENTE');
});

test('aprovação cria convite único com WhatsApp e ativação individual',async()=>{
  const {db,env,cookie}=await setup();
  const res=await worker.fetch(apiRequest('/api/bko/applications/app-1/decision','POST',{decision:'approve'},cookie),env);
  assert.equal(res.status,200);
  const issued=await res.json();
  assert.match(issued.activationUrl,/\/portal.html#token=/);
  assert.match(issued.whatsappUrl,/^https:\/\/wa\.me\/55/);
  assert.ok(!JSON.stringify(db.sqlite.prepare('SELECT * FROM auth_tokens').get()).includes(issued.activationUrl.split('token=')[1]));
  assert.equal((await worker.fetch(apiRequest('/api/bko/applications/app-1/decision','POST',{decision:'approve'},cookie),env)).status,409);
  assert.equal(db.sqlite.prepare("SELECT count(*) c FROM auth_users WHERE role='CORRETOR'").get().c,1);
  const token=issued.activationUrl.split('token=')[1];
  const activated=await worker.fetch(apiRequest('/api/auth/activate','POST',{token,password:'Minha-Senha-Forte!2026'}),env);
  assert.equal(activated.status,200);
  assert.equal((await worker.fetch(apiRequest('/api/auth/activate','POST',{token,password:'Minha-Senha-Forte!2026'}),env)).status,400);
  const login=await worker.fetch(apiRequest('/api/auth/login','POST',{email:'maria-app-1@example.com',password:'Minha-Senha-Forte!2026'}),env);
  assert.equal(login.status,200);
  const brokerCookie=login.headers.get('set-cookie').split(';')[0];
  const me=await (await worker.fetch(apiRequest('/api/me','GET',null,brokerCookie),env)).json();
  assert.equal(me.role,'CORRETOR');
  assert.equal((await worker.fetch(apiRequest('/api/bko/applications','GET',null,brokerCookie),env)).status,403);
});

test('ADMIN pode reemitir convite revogando o anterior, mas token expirado falha',async()=>{
  const {db,env,cookie}=await setup();
  const first=await (await worker.fetch(apiRequest('/api/bko/applications/app-1/decision','POST',{decision:'approve'},cookie),env)).json();
  const renewed=await worker.fetch(apiRequest('/api/bko/applications/app-1/retry-invite','POST',{},cookie),env);
  assert.equal(renewed.status,200);
  const second=await renewed.json();
  assert.notEqual(first.activationUrl,second.activationUrl);
  assert.equal((await worker.fetch(apiRequest('/api/auth/activate','POST',{token:first.activationUrl.split('token=')[1],password:'Minha-Senha-Forte!2026'}),env)).status,400);
  db.sqlite.prepare("UPDATE auth_tokens SET expires_at=1 WHERE used_at IS NULL").run();
  assert.equal((await worker.fetch(apiRequest('/api/auth/activate','POST',{token:second.activationUrl.split('token=')[1],password:'Minha-Senha-Forte!2026'}),env)).status,400);
});

test('recuperação ADMIN substitui senha do corretor ativo e revoga sessão anterior',async()=>{
  const {env,cookie}=await setup();
  const first=await (await worker.fetch(apiRequest('/api/bko/applications/app-1/decision','POST',{decision:'approve'},cookie),env)).json();
  await worker.fetch(apiRequest('/api/auth/activate','POST',{token:first.activationUrl.split('token=')[1],password:'Senha-Antiga-Exemplo!2026'}),env);
  const login=await worker.fetch(apiRequest('/api/auth/login','POST',{email:'maria-app-1@example.com',password:'Senha-Antiga-Exemplo!2026'}),env);
  const oldCookie=login.headers.get('set-cookie').split(';')[0];
  const reset=await worker.fetch(apiRequest('/api/bko/applications/app-1/reset-access','POST',{},cookie),env);
  assert.equal(reset.status,200);
  const data=await reset.json();assert.equal(data.purpose,'RESET');
  const changed=await worker.fetch(apiRequest('/api/auth/activate','POST',{token:data.activationUrl.split('token=')[1],password:'Senha-Nova-Exemplo!2026'}),env);
  assert.equal(changed.status,200);
  assert.equal((await worker.fetch(apiRequest('/api/me','GET',null,oldCookie),env)).status,401);
  assert.equal((await worker.fetch(apiRequest('/api/auth/login','POST',{email:'maria-app-1@example.com',password:'Senha-Antiga-Exemplo!2026'}),env)).status,401);
  assert.equal((await worker.fetch(apiRequest('/api/auth/login','POST',{email:'maria-app-1@example.com',password:'Senha-Nova-Exemplo!2026'}),env)).status,200);
});
