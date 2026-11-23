import assert from 'node:assert/strict';
import test from 'node:test';
import { validateApplication, InputError } from '../src/server/validation.js';

const valid = {
  name: 'Maria Oliveira', email: 'MARIA@example.com', phone: '(11) 99999-9999',
  city: 'Barueri', state: 'SP', susep: '123456', product: 'saude',
  profile: 'cpf', privacyAccepted: true, partnerTermsAccepted: true
};

test('normaliza os dados profissionais e não aceita campos extras', () => {
  const value = validateApplication({ ...valid, email: ' MARIA@Example.com ', role: 'bko', leads: ['123'] });
  assert.equal(value.email, 'maria@example.com');
  assert.equal(value.name, 'Maria Oliveira');
  assert.equal(Object.hasOwn(value, 'role'), false);
  assert.equal(Object.hasOwn(value, 'leads'), false);
});

test('rejeita falta de SUSEP, contato inválido e não aceites', () => {
  for (const changes of [{ susep: '' }, { phone: '12' }, { email: 'invalido' }, { privacyAccepted: false }, { state: 'ZZ' }]) {
    assert.throws(() => validateApplication({ ...valid, ...changes }), InputError);
  }
});

test('rejeita payload excessivo sem ecoar o conteúdo sensível', () => {
  assert.throws(() => validateApplication({ ...valid, name: 'x'.repeat(8000) }), /Dados inválidos/);
});
