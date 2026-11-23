import assert from 'node:assert/strict';
import test from 'node:test';

const {adminAccessView}=await import('../src/client/portal-access.js').catch(()=>({}));

test('ADMIN sem MFA entra direto no painel e pode optar por ativá-lo',()=>{
  assert.equal(typeof adminAccessView,'function');
  assert.deepEqual(adminAccessView({role:'ADMIN',mfaEnabled:false,mfaRequired:false}),{
    challenge:false,offerEnrollment:true
  });
});

test('ADMIN com MFA ativo precisa de desafio em sessão nova e não vê botão de ativação',()=>{
  assert.equal(typeof adminAccessView,'function');
  assert.deepEqual(adminAccessView({role:'ADMIN',mfaEnabled:true,mfaRequired:true}),{
    challenge:true,offerEnrollment:false
  });
  assert.deepEqual(adminAccessView({role:'ADMIN',mfaEnabled:true,mfaRequired:false}),{
    challenge:false,offerEnrollment:false
  });
});

test('corretor não vê o botão MFA do administrador',()=>{
  assert.equal(typeof adminAccessView,'function');
  assert.deepEqual(adminAccessView({role:'CORRETOR',mfaEnabled:false,mfaRequired:false}),{
    challenge:false,offerEnrollment:false
  });
});
