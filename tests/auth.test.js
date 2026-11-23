import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/server/worker.js';
import {hashPassword,verifyPassword,generateTotp,encryptSecret,decryptSecret} from '../src/server/crypto.js';
import {createTestDb,apiRequest,testEnv,bootstrapAdmin} from './db-helper.js';

test('senhas usam salt independente e a senha incorreta não é aceita',async()=>{
  const pepper='test-password-pepper-1234567890123456';
  const a=await hashPassword('Senha-Secreta-Exemplo!2026',pepper);
  const b=await hashPassword('Senha-Secreta-Exemplo!2026',pepper);
  assert.notEqual(a,b);
  assert.equal(await verifyPassword('Senha-Secreta-Exemplo!2026',a,pepper),true);
  assert.equal(await verifyPassword('outra senha',a,pepper),false);
});

test('senha protegida com pepper funciona sob limite de 100 mil iterações do Worker',async()=>{
  const password='Senha-Especial-Cloudflare!2026';
  const pepper='pepper-unico-para-ambiente-1234567890';
  const record=await hashPassword(password,pepper);
  const iterations=Number(record.split('$')[1]);
  assert.ok(iterations>0&&iterations<=100000,'Worker de produção rejeita PBKDF2 acima de 100000');
  assert.equal(await verifyPassword(password,record,pepper),true);
  assert.equal(await verifyPassword(password,record,'outro-pepper-para-ambiente-1234567890'),false);
});

test('portal não declara autenticação pronta sem PASSWORD_PEPPER',async()=>{
  const env=testEnv(createTestDb());
  delete env.PASSWORD_PEPPER;
  const publicConfig=await (await worker.fetch(apiRequest('/api/public-config'),env)).json();
  assert.equal(publicConfig.authAvailable,false);
});

test('cifra TOTP fica protegida por segredo do Worker',async()=>{
  const data=await encryptSecret('SECRETO123','chave-muito-longa-12345678901234567890');
  assert.notEqual(data,'SECRETO123');
  assert.equal(await decryptSecret(data,'chave-muito-longa-12345678901234567890'),'SECRETO123');
  await assert.rejects(()=>decryptSecret(data,'outra-chave-longa-12345678901234567890'));
});

test('TOTP corresponde ao vetor RFC 6238 usado por autenticadores externos',async()=>{
  assert.equal(await generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',1),'287082');
});

test('bootstrap cria somente um ADMIN por token secreto e nunca cadastra outro',async()=>{
  const db=createTestDb(),env=testEnv(db);
  const wrong=await worker.fetch(apiRequest('/api/setup/admin','POST',{email:'Acesso@centraldosconvenios.com.br',password:'Senha-Admin-Demonstracao!2026',setupToken:'errado'}),env);
  assert.equal(wrong.status,403);
  const cookie=await bootstrapAdmin(worker,env);
  assert.match(cookie,/^__Host-cdc_session=/);
  const attempt=await worker.fetch(apiRequest('/api/setup/admin','POST',{email:'Acesso@centraldosconvenios.com.br',password:'Senha-Admin-Demonstracao!2026',setupToken:env.ADMIN_SETUP_TOKEN}),env);
  assert.equal(attempt.status,409);
  assert.equal(db.sqlite.prepare("SELECT count(*) c FROM auth_users WHERE role='ADMIN'").get().c,1);
});

test('ADMIN sem MFA ativado acessa fila por senha e chave pendente não bloqueia o painel',async()=>{
  const db=createTestDb(),env=testEnv(db),cookie=await bootstrapAdmin(worker,env);
  db.sqlite.prepare("UPDATE auth_users SET mfa_secret='chave-antiga-pendente' WHERE role='ADMIN'").run();
  const me=await (await worker.fetch(apiRequest('/api/me','GET',null,cookie),env)).json();
  assert.equal(me.mfaRequired,false);
  assert.equal(me.mfaEnabled,false);
  const allowed=await worker.fetch(apiRequest('/api/bko/applications','GET',null,cookie),env);
  assert.equal(allowed.status,200);
});

test('ativação opcional do MFA exige senha atual e não cria chave após tentativa inválida',async()=>{
  const db=createTestDb(),env=testEnv(db),cookie=await bootstrapAdmin(worker,env);
  const missing=await worker.fetch(apiRequest('/api/auth/mfa/setup','POST',{},cookie),env);
  assert.equal(missing.status,400);
  const wrong=await worker.fetch(apiRequest('/api/auth/mfa/setup','POST',{password:'Senha-Incorreta-Demonstracao!2026'},cookie),env);
  assert.equal(wrong.status,401);
  assert.equal(db.sqlite.prepare("SELECT mfa_secret FROM auth_users WHERE role='ADMIN'").get().mfa_secret,null);
  const success=await worker.fetch(apiRequest('/api/auth/mfa/setup','POST',{password:'Senha-Admin-Demonstracao!2026'},cookie),env);
  assert.equal(success.status,200);
});

test('ativação MFA limita tentativas de senha e não permite liberar a chave na nona tentativa',async()=>{
  const db=createTestDb(),env=testEnv(db),cookie=await bootstrapAdmin(worker,env);
  for(let attempt=0;attempt<8;attempt++){
    const wrong=await worker.fetch(apiRequest('/api/auth/mfa/setup','POST',{password:'Senha-Errada-Demonstracao!2026'},cookie),env);
    assert.equal(wrong.status,401);
  }
  const blocked=await worker.fetch(apiRequest('/api/auth/mfa/setup','POST',{password:'Senha-Admin-Demonstracao!2026'},cookie),env);
  assert.equal(blocked.status,429);
  assert.equal(db.sqlite.prepare("SELECT mfa_secret FROM auth_users WHERE role='ADMIN'").get().mfa_secret,null);
});

test('opt-in MFA gera chave nova, inutiliza a exposta e passa a exigir código em novas sessões',async()=>{
  const db=createTestDb(),env=testEnv(db),cookie=await bootstrapAdmin(worker,env);
  const setup=await worker.fetch(apiRequest('/api/auth/mfa/setup','POST',{password:'Senha-Admin-Demonstracao!2026'},cookie),env);
  assert.equal(setup.status,200);
  const {secret:oldSecret}=await setup.json();
  const renewed=await worker.fetch(apiRequest('/api/auth/mfa/setup','POST',{password:'Senha-Admin-Demonstracao!2026'},cookie),env);
  assert.equal(renewed.status,200);
  const {secret}=await renewed.json();
  assert.notEqual(secret,oldSecret);
  const oldCode=await generateTotp(oldSecret);
  assert.equal((await worker.fetch(apiRequest('/api/auth/mfa/verify','POST',{code:oldCode},cookie),env)).status,400);
  const code=await generateTotp(secret);
  const verify=await worker.fetch(apiRequest('/api/auth/mfa/verify','POST',{code},cookie),env);
  assert.equal(verify.status,200);
  const replay=await worker.fetch(apiRequest('/api/auth/mfa/verify','POST',{code},cookie),env);
  assert.equal(replay.status,400);
  const allowed=await worker.fetch(apiRequest('/api/bko/applications','GET',null,cookie),env);
  assert.equal(allowed.status,200);
  const fresh=await worker.fetch(apiRequest('/api/auth/login','POST',{email:'acesso@centraldosconvenios.com.br',password:'Senha-Admin-Demonstracao!2026'}),env);
  assert.equal(fresh.status,200);
  const newCookie=fresh.headers.get('set-cookie').split(';')[0];
  const state=await (await worker.fetch(apiRequest('/api/me','GET',null,newCookie),env)).json();
  assert.equal(state.mfaRequired,true);
  assert.equal(state.mfaEnabled,true);
  assert.equal((await worker.fetch(apiRequest('/api/bko/applications','GET',null,newCookie),env)).status,403);
});

test('logout invalida a sessão e rejeita uso posterior do cookie',async()=>{
  const db=createTestDb(),env=testEnv(db),cookie=await bootstrapAdmin(worker,env);
  const out=await worker.fetch(apiRequest('/api/auth/logout','POST',{},cookie),env);
  assert.equal(out.status,200);
  const denied=await worker.fetch(apiRequest('/api/me','GET',null,cookie),env);
  assert.equal(denied.status,401);
});
