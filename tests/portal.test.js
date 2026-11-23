import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/server/worker.js';
import {createTestDb,seedApplication,tokenFor,apiRequest,testEnv,withFakeAuth} from './db-helper.js';

test('corretor aprovado com vínculo pode ver apenas seu perfil e cotações permanecem desativadas',async()=>{
  const db=createTestDb(); seedApplication(db,'app-a'); seedApplication(db,'app-b');
  db.sqlite.prepare(`UPDATE applications SET status='APROVADO'`).run();
  db.sqlite.prepare('INSERT INTO broker_profiles (auth_user_id,application_id) VALUES (?,?)').run('broker-a','app-a');
  db.sqlite.prepare('INSERT INTO broker_profiles (auth_user_id,application_id) VALUES (?,?)').run('broker-b','app-b');
  await withFakeAuth(async()=>{
    const jwt=tokenFor('broker-a','aal1');
    const response=await worker.fetch(apiRequest('/api/me','GET',null,jwt),testEnv(db));
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(data.role,'CORRETOR');
    assert.equal(data.name,'Maria Oliveira');
    assert.equal(data.quotesEnabled,false);
    assert.equal(JSON.stringify(data).includes('maria-app-b@example.com'),false);
    const forbidden=await worker.fetch(apiRequest('/api/bko/applications','GET',null,jwt),testEnv(db));
    assert.equal(forbidden.status,403);
    const otherQuote=await worker.fetch(apiRequest('/api/broker/quotes/id-do-outro','GET',null,jwt),testEnv(db));
    assert.equal(otherQuote.status,404);
  },{id:'broker-a'});
});

test('pendente ou suspenso é bloqueado mesmo com identidade válida',async()=>{
  const db=createTestDb(); seedApplication(db);
  db.sqlite.prepare('INSERT INTO broker_profiles (auth_user_id,application_id) VALUES (?,?)').run('broker-a','app-1');
  await withFakeAuth(async()=>{
    let res=await worker.fetch(apiRequest('/api/me','GET',null,tokenFor('broker-a')),testEnv(db));
    assert.equal(res.status,403);
    db.sqlite.prepare(`UPDATE applications SET status='APROVADO' WHERE id='app-1'`).run();
    db.sqlite.prepare(`UPDATE broker_profiles SET suspended_at=CURRENT_TIMESTAMP WHERE auth_user_id='broker-a'`).run();
    res=await worker.fetch(apiRequest('/api/me','GET',null,tokenFor('broker-a')),testEnv(db));
    assert.equal(res.status,403);
  },{id:'broker-a'});
});

test('a configuração pública não publica segredo e mantém cadastro fechado por padrão',async()=>{
  const response=await worker.fetch(apiRequest('/api/public-config'),{SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'do-not-expose',TURNSTILE_SECRET:'do-not-expose'});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.registrationOpen,false);
  assert.equal(JSON.stringify(data).includes('do-not-expose'),false);
});
