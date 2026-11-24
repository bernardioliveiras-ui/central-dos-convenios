import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/server/worker.js';
import {hashPassword,generateTotp} from '../src/server/crypto.js';
import {createTestDb,testEnv,apiRequest,bootstrapAdmin,seedApplication} from './db-helper.js';

const recoveryToken='recuperacao-manual-aleatoria-48bytes-exemplo-local-2026';
const email='acesso@centraldosconvenios.com.br';
const oldPassword='Senha-Admin-Demonstracao!2026';
const newPassword='Senha-Nova-Segura-Do-Admin!2026';

function recover(env,token=recoveryToken,password=newPassword,address=email){
  return worker.fetch(apiRequest('/api/setup/admin/recover','POST',{
    recoveryToken:token,email:address,password
  }),env);
}

test('recuperação só aceita secret temporário correto e preserva ADMIN quando inválido',async()=>{
  const db=createTestDb(),env=testEnv(db),cookie=await bootstrapAdmin(worker,env);
  assert.equal((await recover(env)).status,403);
  env.ADMIN_RECOVERY_TOKEN='curto';
  assert.equal((await recover(env,'curto')).status,403);
  env.ADMIN_RECOVERY_TOKEN=recoveryToken;
  assert.equal((await recover(env,'token-incorreto')).status,403);
  assert.equal((await recover(env,recoveryToken,newPassword,'outro@example.com')).status,403);
  assert.equal((await worker.fetch(apiRequest('/api/me','GET',null,cookie),env)).status,200);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS c FROM audit_events WHERE action='ADMIN_PASSWORD_RECOVERED'").get().c,0);
});

test('recuperação única atualiza senha, revoga todas as sessões, audita sem segredos e preserva corretor',async()=>{
  const db=createTestDb(),env=testEnv(db),cookie=await bootstrapAdmin(worker,env);
  env.ADMIN_RECOVERY_TOKEN=recoveryToken;
  seedApplication(db);
  db.sqlite.prepare("UPDATE applications SET status='APROVADO' WHERE id='app-1'").run();
  const brokerHash=await hashPassword('Senha-Corretor-Exemplo!2026',env.PASSWORD_PEPPER);
  db.sqlite.prepare("INSERT INTO auth_users(id,email,role,password_hash,state) VALUES (?,?,?,?,?)")
    .run('broker-1','corretor@exemplo.com','CORRETOR',brokerHash,'ACTIVE');
  db.sqlite.prepare('INSERT INTO broker_profiles(auth_user_id,application_id) VALUES (?,?)').run('broker-1','app-1');
  const adminBefore=db.sqlite.prepare("SELECT id,mfa_enabled,mfa_secret FROM auth_users WHERE role='ADMIN'").get();

  const response=await recover(env);
  assert.equal(response.status,200);
  assert.match((await response.json()).message,/senha atualizada/i);
  assert.equal((await worker.fetch(apiRequest('/api/me','GET',null,cookie),env)).status,401);
  assert.equal((await worker.fetch(apiRequest('/api/auth/login','POST',{email,password:oldPassword}),env)).status,401);
  assert.equal((await worker.fetch(apiRequest('/api/auth/login','POST',{email,password:newPassword}),env)).status,200);
  assert.equal((await worker.fetch(apiRequest('/api/auth/login','POST',{email:'corretor@exemplo.com',password:'Senha-Corretor-Exemplo!2026'}),env)).status,200);

  const adminAfter=db.sqlite.prepare("SELECT id,mfa_enabled,mfa_secret FROM auth_users WHERE role='ADMIN'").get();
  assert.deepEqual(adminAfter,adminBefore);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS c FROM auth_users WHERE role='ADMIN'").get().c,1);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS c FROM auth_users WHERE role='CORRETOR'").get().c,1);
  const audit=db.sqlite.prepare("SELECT action,metadata FROM audit_events WHERE action='ADMIN_PASSWORD_RECOVERED'").get();
  assert.equal(audit.action,'ADMIN_PASSWORD_RECOVERED');
  assert.ok(!JSON.stringify(audit).includes(newPassword));
  assert.ok(!JSON.stringify(audit).includes(recoveryToken));
});

test('recuperação preserva MFA ativo e ainda exige TOTP na sessão nova',async()=>{
  const db=createTestDb(),env=testEnv(db),cookie=await bootstrapAdmin(worker,env);
  const setup=await worker.fetch(apiRequest('/api/auth/mfa/setup','POST',{password:oldPassword},cookie),env);
  assert.equal(setup.status,200);
  const {secret}=await setup.json();
  const verify=await worker.fetch(apiRequest('/api/auth/mfa/verify','POST',{code:await generateTotp(secret)},cookie),env);
  assert.equal(verify.status,200);
  assert.equal(db.sqlite.prepare("SELECT mfa_enabled FROM auth_users WHERE role='ADMIN'").get().mfa_enabled,1);
  env.ADMIN_RECOVERY_TOKEN=recoveryToken;
  assert.equal((await recover(env)).status,200);
  assert.equal((await worker.fetch(apiRequest('/api/me','GET',null,cookie),env)).status,401);
  const login=await worker.fetch(apiRequest('/api/auth/login','POST',{email,password:newPassword}),env);
  assert.equal(login.status,200);
  const newCookie=login.headers.get('set-cookie').split(';')[0];
  const me=await (await worker.fetch(apiRequest('/api/me','GET',null,newCookie),env)).json();
  assert.equal(me.mfaEnabled,true);
  assert.equal(me.mfaRequired,true);
  assert.equal((await worker.fetch(apiRequest('/api/bko/applications','GET',null,newCookie),env)).status,403);
});

test('token de recuperação não funciona duas vezes, mesmo quando permanece no Worker',async()=>{
  const db=createTestDb(),env=testEnv(db);await bootstrapAdmin(worker,env);
  env.ADMIN_RECOVERY_TOKEN=recoveryToken;
  assert.equal((await recover(env)).status,200);
  assert.equal((await recover(env,recoveryToken,'Outra-Senha-Forte!2026')).status,409);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS c FROM audit_events WHERE action='ADMIN_PASSWORD_RECOVERED'").get().c,1);
  assert.equal((await worker.fetch(apiRequest('/api/auth/login','POST',{email,password:newPassword}),env)).status,200);
  assert.equal((await worker.fetch(apiRequest('/api/auth/login','POST',{email,password:'Outra-Senha-Forte!2026'}),env)).status,401);
});

test('duas recuperações concorrentes não podem definir duas senhas com o mesmo token',async()=>{
  const db=createTestDb(),env=testEnv(db);await bootstrapAdmin(worker,env);
  env.ADMIN_RECOVERY_TOKEN=recoveryToken;
  const [a,b]=await Promise.all([
    recover(env,recoveryToken,'Primeira-Senha-Forte!2026'),
    recover(env,recoveryToken,'Segunda-Senha-Forte!2026')
  ]);
  assert.deepEqual([a.status,b.status].sort((x,y)=>x-y),[200,409]);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS c FROM audit_events WHERE action='ADMIN_PASSWORD_RECOVERED'").get().c,1);
  const first=await worker.fetch(apiRequest('/api/auth/login','POST',{email,password:'Primeira-Senha-Forte!2026'}),env);
  const second=await worker.fetch(apiRequest('/api/auth/login','POST',{email,password:'Segunda-Senha-Forte!2026'}),env);
  assert.equal([first.status,second.status].filter(status=>status===200).length,1);
});

test('senha fraca não consome token; sem ADMIN, recuperação não cria usuário',async()=>{
  const db=createTestDb(),env=testEnv(db);env.ADMIN_RECOVERY_TOKEN=recoveryToken;
  assert.equal((await recover(env)).status,404);
  await bootstrapAdmin(worker,env);
  assert.equal((await recover(env,recoveryToken,'123')).status,400);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS c FROM audit_events WHERE action='ADMIN_PASSWORD_RECOVERED'").get().c,0);
  assert.equal((await recover(env)).status,200);
});

test('JSON nulo ou lista não causa erro interno nem consome token',async()=>{
  const db=createTestDb(),env=testEnv(db);await bootstrapAdmin(worker,env);
  env.ADMIN_RECOVERY_TOKEN=recoveryToken;
  for(const body of ['null','[]']){
    const response=await worker.fetch(new Request('https://central.example/api/setup/admin/recover',{
      method:'POST',headers:{origin:'https://central.example','content-type':'application/json'},body
    }),env);
    assert.equal(response.status,400);
  }
  assert.equal((await recover(env)).status,200);
});

test('rota de recuperação limita tentativas e não altera senha quando excedido',async()=>{
  const db=createTestDb(),env=testEnv(db);await bootstrapAdmin(worker,env);
  env.ADMIN_RECOVERY_TOKEN=recoveryToken;
  for(let i=0;i<5;i++)assert.equal((await recover(env,'token-errado')).status,403);
  assert.equal((await recover(env)).status,429);
  assert.equal((await worker.fetch(apiRequest('/api/auth/login','POST',{email,password:oldPassword}),env)).status,200);
});
