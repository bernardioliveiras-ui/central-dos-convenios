export class InputError extends Error {
  constructor(message = 'Dados inválidos. Revise os campos e tente novamente.') {
    super(message);
    this.name = 'InputError';
  }
}

export function validateApplication(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError();
  const str = (field, max) => {
    if (typeof input[field] !== 'string') throw new InputError();
    const value = input[field].trim().replace(/\s+/g, ' ');
    if (!value || value.length > max) throw new InputError();
    return value;
  };
  const name = str('name', 110);
  const email = str('email', 160).toLowerCase();
  const phone = str('phone', 25);
  const city = str('city', 100);
  const state = str('state', 2).toUpperCase();
  const susep = str('susep', 50);
  const profile = str('profile', 12);
  const product = str('product', 18);
  if (name.length < 5 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+?[\d\s()\-]{10,25}$/.test(phone)) throw new InputError();
  if (!/^[\p{L}\p{M}\s.'-]{2,100}$/u.test(city) || !new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')).has(state)) throw new InputError();
  if (!/^[\p{L}\d./-]{4,50}$/u.test(susep)) throw new InputError();
  if (!['cpf', 'cnpj', 'ambos'].includes(profile) || !['saude', 'odontologico', 'pet', 'multiplos'].includes(product)) throw new InputError();
  if (input.privacyAccepted !== true || input.partnerTermsAccepted !== true) throw new InputError('Confirme os termos antes de continuar.');
  return {name, email, phone, city, state, susep, profile, product};
}
