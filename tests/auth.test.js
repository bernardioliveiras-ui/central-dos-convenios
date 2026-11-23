import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyIdentity,requireStaff,AuthError} from '../src/server/auth.js';
import {createTestDb,tokenFor,apiRequest,testEnv,withFakeAuth} from './db-helper.js';

test('token ausente ou rejeitado pelo provedor não autoriza', async () => {
  const env=testEnv(createTestDb());
  await assert.rejects(()=>verifyIdentity(apiRequest('/api/me'),env), e=>e instanceof AuthError && e.status===401);
  await withFakeAuth(async ()=>{
    await assert.rejects(()=>verifyIdentity(apiRequest('/api/me','GET',null,tokenFor('bko-1')),env),e=>e.status===401);
  },{unauthorized:true});
});

test('token com identidade diferente da verificada pelo provedor é recusado',async ()=>{
  await withFakeAuth(async()=>{
    await assert.rejects(()=>verifyIdentity(apiRequest('/api/me','GET',null,tokenFor('outro')),testEnv(createTestDb())),e=>e.status===401);
  });
});

test('BKO deve ter conta ativa no D1 e MFA AAL2',async ()=>{
  const db=createTestDb(); const env=testEnv(db);
  db.sqlite.prepare('INSERT INTO staff_accounts (auth_user_id,role,label) VALUES (?,?,?)').run('bko-1','BKO','Santana');
  await withFakeAuth(async()=>{
    await assert.rejects(()=>requireStaff(apiRequest('/api/bko/applications','GET',null,tokenFor('bko-1','aal1')),env),e=>e.status===403);
    const staff=await requireStaff(apiRequest('/api/bko/applications','GET',null,tokenFor('bko-1','aal2')),env);
    assert.equal(staff.role,'BKO');
    db.sqlite.prepare('UPDATE staff_accounts SET suspended_at=CURRENT_TIMESTAMP WHERE auth_user_id=?').run('bko-1');
    await assert.rejects(()=>requireStaff(apiRequest('/api/bko/applications','GET',null,tokenFor('bko-1','aal2')),env),e=>e.status===403);
  });
});
