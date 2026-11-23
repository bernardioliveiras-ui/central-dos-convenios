import {hashToken,nowSeconds,randomToken} from './crypto.js';

export class AuthError extends Error{
  constructor(message='Acesso não autorizado.',status=401){super(message);this.name='AuthError';this.status=status;}
}

export const SESSION_COOKIE='__Host-cdc_session';
export const SESSION_SECONDS=12*3600;

export function authReady(env){return Boolean(env.DB&&typeof env.SESSION_SECRET==='string'&&env.SESSION_SECRET.length>=32&&typeof env.PASSWORD_PEPPER==='string'&&env.PASSWORD_PEPPER.length>=32&&typeof env.RATE_LIMIT_SALT==='string'&&env.RATE_LIMIT_SALT.length>=16);}

export function sessionCookie(token,maxAge=SESSION_SECONDS){
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

function readSessionCookie(request){
  const found=(request.headers.get('cookie')||'').match(/(?:^|;\s*)__Host-cdc_session=([A-Za-z0-9_-]{40,80})(?:;|$)/);
  return found?.[1]||null;
}

export async function createSession(env,userId){
  if(!authReady(env))throw new AuthError('Autenticação não configurada.',503);
  const token=randomToken();
  const tokenHash=await hashToken(token,env.SESSION_SECRET);
  await env.DB.prepare('INSERT INTO auth_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
    .bind(tokenHash,userId,nowSeconds()+SESSION_SECONDS).run();
  return sessionCookie(token);
}

export async function verifyIdentity(request,env){
  const token=readSessionCookie(request);
  if(!token)throw new AuthError();
  if(!authReady(env))throw new AuthError('Autenticação não configurada.',503);
  const tokenHash=await hashToken(token,env.SESSION_SECRET);
  const identity=await env.DB.prepare(`SELECT a.id,a.email,a.role,a.state,a.mfa_enabled,s.mfa_verified,s.token_hash
    FROM auth_sessions s INNER JOIN auth_users a ON a.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).bind(tokenHash,nowSeconds()).first();
  if(!identity||identity.state!=='ACTIVE')throw new AuthError();
  return {...identity,sessionHash:tokenHash};
}

export async function revokeSession(request,env){
  const token=readSessionCookie(request);
  if(token&&authReady(env))await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?')
    .bind(await hashToken(token,env.SESSION_SECRET)).run();
}

export async function requireStaff(request,env){
  const identity=await verifyIdentity(request,env);
  if(identity.role!=='ADMIN')throw new AuthError('Conta sem permissão administrativa.',403);
  if(!identity.mfa_enabled||!identity.mfa_verified)throw new AuthError('A verificação de dois fatores é obrigatória.',403);
  return identity;
}

export async function requireBroker(request,env){
  const identity=await verifyIdentity(request,env);
  if(identity.role!=='CORRETOR')throw new AuthError('Conta sem permissão de corretor.',403);
  const profile=await env.DB.prepare(`SELECT b.application_id,a.name,a.status,a.product
    FROM broker_profiles b INNER JOIN applications a ON a.id=b.application_id
    WHERE b.auth_user_id=? AND b.suspended_at IS NULL AND a.status='APROVADO'`)
    .bind(identity.id).first();
  if(!profile)throw new AuthError('Seu acesso ainda não foi liberado ou está suspenso.',403);
  return {...identity,...profile};
}
