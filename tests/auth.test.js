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

test('ADMIN exige TOTP para acessar fila e rejeita reutilização do mesmo código',async()=>{
  const db=createTestDb(),env=testEnv(db),cookie=await bootstrapAdmin(worker,env);
  const denied=await worker.fetch(apiRequest('/api/bko/applications','GET',null,cookie),env);
  assert.equal(denied.status,403);
  const setup=await worker.fetch(apiRequest('/api/auth/mfa/setup','POST',{},cookie),env);
  assert.equal(setup.status,200);
  const {secret}=await setup.json();
  const code=await generateTotp(secret);
  const verify=await worker.fetch(apiRequest('/api/auth/mfa/verify','POST',{code},cookie),env);
  assert.equal(verify.status,200);
  const replay=await worker.fetch(apiRequest('/api/auth/mfa/verify','POST',{code},cookie),env);
  assert.equal(replay.status,400);
  const allowed=await worker.fetch(apiRequest('/api/bko/applications','GET',null,cookie),env);
  assert.equal(allowed.status,200);
});

test('logout invalida a sessão e rejeita uso posterior do cookie',async()=>{
  const db=createTestDb(),env=testEnv(db),cookie=await bootstrapAdmin(worker,env);
  const out=await worker.fetch(apiRequest('/api/auth/logout','POST',{},cookie),env);
  assert.equal(out.status,200);
  const denied=await worker.fetch(apiRequest('/api/me','GET',null,cookie),env);
  assert.equal(denied.status,401);
});
