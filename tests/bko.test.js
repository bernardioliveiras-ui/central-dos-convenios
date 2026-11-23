import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/server/worker.js';
import {createTestDb,seedApplication,tokenFor,apiRequest,testEnv,withFakeAuth} from './db-helper.js';

function setup() {
  const db=createTestDb(); seedApplication(db);
  db.sqlite.prepare('INSERT INTO staff_accounts (auth_user_id,role,label) VALUES (?,?,?)').run('bko-1','BKO','Santana');
  return {db, env:testEnv(db),jwt:tokenFor('bko-1')};
}

test('sem MFA o BKO não vê cadastros; com MFA vê fila pendente',async()=>{
  const {env,jwt}=setup();
  await withFakeAuth(async()=>{
    const denied=await worker.fetch(apiRequest('/api/bko/applications','GET',null,tokenFor('bko-1','aal1')),env);
    assert.equal(denied.status,403);
    const allowed=await worker.fetch(apiRequest('/api/bko/applications','GET',null,jwt),env);
    assert.equal(allowed.status,200);
    const data=await allowed.json();
    assert.equal(data.applications.length,1);
    assert.equal(data.applications[0].id,'app-1');
  });
});

test('reprovar exige motivo interno e gera auditoria',async()=>{
  const {db,env,jwt}=setup();
  await withFakeAuth(async()=>{
    const denied=await worker.fetch(apiRequest('/api/bko/applications/app-1/decision','POST',{decision:'reject'},jwt),env);
    assert.equal(denied.status,400);
    const res=await worker.fetch(apiRequest('/api/bko/applications/app-1/decision','POST',{decision:'reject',reason:'SUSEP não validada'},jwt),env);
    assert.equal(res.status,200);
    assert.equal(db.sqlite.prepare('SELECT status FROM applications WHERE id=?').get('app-1').status,'REPROVADO');
    assert.equal(db.sqlite.prepare('SELECT count(*) AS c FROM audit_events').get().c,1);
  });
});

test('falha na auditoria não pode registrar decisão sem trilha de revisão',async()=>{
  const {db,env,jwt}=setup();
  db.sqlite.exec("CREATE TRIGGER block_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
  await withFakeAuth(async()=>{
    const res=await worker.fetch(apiRequest('/api/bko/applications/app-1/decision','POST',{decision:'reject',reason:'Documentos insuficientes'},jwt),env);
    assert.equal(res.status,503);
    assert.equal(db.sqlite.prepare('SELECT status FROM applications WHERE id=?').get('app-1').status,'PENDENTE');
  });
});

test('aprovação convida apenas uma vez, e vínculo do corretor é criado no D1',async()=>{
  const {db,env,jwt}=setup();
  await withFakeAuth(async(calls)=>{
    const res=await worker.fetch(apiRequest('/api/bko/applications/app-1/decision','POST',{decision:'approve'},jwt),env);
    assert.equal(res.status,200);
    assert.equal(db.sqlite.prepare('SELECT status,invite_status FROM applications WHERE id=?').get('app-1').invite_status,'ENVIADO');
    assert.equal(db.sqlite.prepare('SELECT auth_user_id FROM broker_profiles WHERE application_id=?').get('app-1').auth_user_id,'broker-1');
    const again=await worker.fetch(apiRequest('/api/bko/applications/app-1/decision','POST',{decision:'approve'},jwt),env);
    assert.equal(again.status,409);
    assert.equal(calls.filter(c=>c.url.includes('/auth/v1/invite')).length,1);
  });
});

test('falha de convite fica visível sem liberar acesso a não vinculados',async()=>{
  const {db,env,jwt}=setup();
  await withFakeAuth(async()=>{
    const res=await worker.fetch(apiRequest('/api/bko/applications/app-1/decision','POST',{decision:'approve'},jwt),env);
    assert.equal(res.status,502);
    assert.equal(db.sqlite.prepare('SELECT invite_status FROM applications WHERE id=?').get('app-1').invite_status,'ERRO');
    assert.equal(db.sqlite.prepare('SELECT count(*) AS c FROM broker_profiles').get().c,0);
  },{inviteFails:true});
});

test('BKO pode reenviar convite falho, mas nunca duplicar o já enviado',async()=>{
  const {db,env,jwt}=setup();
  db.sqlite.prepare(`UPDATE applications SET status='APROVADO',invite_status='ERRO' WHERE id='app-1'`).run();
  await withFakeAuth(async(calls)=>{
    const retry=await worker.fetch(apiRequest('/api/bko/applications/app-1/retry-invite','POST',{},jwt),env);
    assert.equal(retry.status,200);
    assert.equal(db.sqlite.prepare('SELECT invite_status FROM applications WHERE id=?').get('app-1').invite_status,'ENVIADO');
    const duplicate=await worker.fetch(apiRequest('/api/bko/applications/app-1/retry-invite','POST',{},jwt),env);
    assert.equal(duplicate.status,409);
    assert.equal(calls.filter(c=>c.url.includes('/auth/v1/invite')).length,1);
  });
});

test('serviço de convite não configurado registra erro recuperável',async()=>{
  const {db,env,jwt}=setup();
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  await withFakeAuth(async()=>{
    const res=await worker.fetch(apiRequest('/api/bko/applications/app-1/decision','POST',{decision:'approve'},jwt),env);
    assert.equal(res.status,503);
    assert.equal(db.sqlite.prepare('SELECT invite_status FROM applications WHERE id=?').get('app-1').invite_status,'ERRO');
  });
});
