import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/server/worker.js';
import {createTestDb} from './db-helper.js';

const request = (path, method='GET', data, headers={}) => new Request(`https://central.example${path}`, {
  method, headers: { ...(data && {'content-type': 'application/json'}), ...headers },
  ...(data && {body: JSON.stringify(data)})
});
const valid = { name:'Maria Oliveira', email:'maria@example.com', phone:'11999999999', city:'Barueri', state:'SP', susep:'12345', profile:'cpf', product:'saude', privacyAccepted:true, partnerTermsAccepted:true, turnstileToken:'token' };

test('nega cadastros por padrão sem chave operacional', async () => {
  const res=await worker.fetch(request('/api/applications','POST',valid), { DB:{} });
  assert.equal(res.status, 503);
});

test('nega cadastro quando Turnstile não está configurado', async () => {
  const res=await worker.fetch(request('/api/applications','POST',valid), { DB:{}, REGISTRATION_OPEN:'true' });
  assert.equal(res.status, 503);
});

test('cadastro não pode abrir sem política e termos aprovados pela empresa',async()=>{
  const env={DB:{},REGISTRATION_OPEN:'true',TURNSTILE_SECRET:'secret',TURNSTILE_SITE_KEY:'site',RATE_LIMIT_SALT:'salt'};
  const config=await worker.fetch(request('/api/public-config'),env);
  assert.equal((await config.json()).registrationOpen,false);
  const response=await worker.fetch(request('/api/applications','POST',valid),env);
  assert.equal(response.status,503);
});

test('Turnstile recusado não grava dados no banco', async () => {
  let prepared = false;
  const env={ REGISTRATION_OPEN:'true', TURNSTILE_SECRET:'secret', TURNSTILE_SITE_KEY:'site', RATE_LIMIT_SALT:'test-salt-is-at-least-16', SESSION_SECRET:'test-session-secret-long-enough-1234567890', LEGAL_APPROVED:'true',PRIVACY_POLICY_URL:'https://central.example/privacidade',PARTNER_TERMS_URL:'https://central.example/termos',COMPANY_LEGAL_NAME:'Central Exemplo LTDA',DB:{ prepare(){ prepared=true; throw Error('não deveria gravar'); } }};
  const saved=globalThis.fetch;
  globalThis.fetch=async ()=>new Response(JSON.stringify({success:false}), {status:200});
  try {
    const res=await worker.fetch(request('/api/applications','POST',valid),env);
    assert.equal(res.status,400); assert.equal(prepared,false);
  } finally { globalThis.fetch=saved; }
});

test('Turnstile não aceita resposta de domínio ou ação diferente',async()=>{
  const db=createTestDb();
  const env={DB:db,REGISTRATION_OPEN:'true',TURNSTILE_SECRET:'secret',TURNSTILE_SITE_KEY:'site',RATE_LIMIT_SALT:'test-salt-is-at-least-16',SESSION_SECRET:'test-session-secret-long-enough-1234567890',LEGAL_APPROVED:'true',PRIVACY_POLICY_URL:'https://central.example/privacidade',PARTNER_TERMS_URL:'https://central.example/termos',COMPANY_LEGAL_NAME:'Central Exemplo LTDA'};
  const saved=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({success:true,hostname:'outro-site.example',action:'broker_signup'}));
  try{
    const response=await worker.fetch(request('/api/applications','POST',valid),env);
    assert.equal(response.status,400);
    assert.equal(db.sqlite.prepare('SELECT count(*) c FROM applications').get().c,0);
  }finally{globalThis.fetch=saved;}
});

test('cadastro real é salvo uma vez, mas e-mail repetido não pode ser enumerado',async()=>{
  const db=createTestDb();
  const env={DB:db,REGISTRATION_OPEN:'true',TURNSTILE_SECRET:'secret',TURNSTILE_SITE_KEY:'site',RATE_LIMIT_SALT:'test-salt-is-at-least-16',SESSION_SECRET:'test-session-secret-long-enough-1234567890',LEGAL_APPROVED:'true',PRIVACY_POLICY_URL:'https://central.example/privacidade',PARTNER_TERMS_URL:'https://central.example/termos',COMPANY_LEGAL_NAME:'Central Exemplo LTDA'};
  const saved=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({success:true,hostname:'central.example',action:'broker_signup'}));
  try{
    const first=await worker.fetch(request('/api/applications','POST',valid),env);
    const second=await worker.fetch(request('/api/applications','POST',valid),env);
    assert.equal(first.status,202);assert.equal(second.status,202);
    assert.equal((await first.json()).message,(await second.json()).message);
    assert.equal(db.sqlite.prepare('SELECT count(*) c FROM applications').get().c,1);
  }finally{globalThis.fetch=saved;}
});

test('não revela a fila do BKO a visitante sem sessão', async () => {
  const res=await worker.fetch(request('/api/bko/applications'), { DB:{} });
  assert.equal(res.status,401);
});

test('rota privada não revela outro perfil a visitante sem sessão', async () => {
  const res=await worker.fetch(request('/api/me'), { DB:{} });
  assert.equal(res.status,401);
});
