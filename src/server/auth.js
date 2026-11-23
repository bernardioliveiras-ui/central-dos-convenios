export class AuthError extends Error {
  constructor(message='Acesso não autorizado.', status=401) {
    super(message); this.name='AuthError'; this.status=status;
  }
}

function parseTrustedClaims(jwt) {
  try {
    const part=jwt.split('.')[1];
    return JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')));
  } catch { throw new AuthError(); }
}

export async function verifyIdentity(request,env) {
  const header=request.headers.get('authorization')||'';
  const match=/^Bearer ([A-Za-z0-9._-]{20,8192})$/.exec(header);
  if (!match) throw new AuthError();
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw new AuthError('Identidade temporariamente indisponível.',503);
  const token=match[1];
  let response;
  try {
    response=await fetch(`${env.SUPABASE_URL.replace(/\/$/,'')}/auth/v1/user`,{
      headers:{'apikey':env.SUPABASE_PUBLISHABLE_KEY,'authorization':`Bearer ${token}`},
      cache:'no-store',signal:AbortSignal.timeout(7000)
    });
  } catch { throw new AuthError('Identidade temporariamente indisponível.',503); }
  if (response.status===401 || response.status===403) throw new AuthError();
  if (!response.ok) throw new AuthError('Identidade temporariamente indisponível.',503);
  let user;
  try { user=await response.json(); } catch { throw new AuthError(); }
  const claims=parseTrustedClaims(token);
  if (!user?.id || typeof user.id!=='string' || claims.sub!==user.id || !claims.exp || claims.exp <= Math.floor(Date.now()/1000)) throw new AuthError();
  return {id:user.id,email:user.email||'',aal:claims.aal||'aal1'};
}

export async function requireStaff(request,env) {
  const identity=await verifyIdentity(request,env);
  // AAL2 é checada APÓS a validação remota da identidade.
  if (identity.aal!=='aal2') throw new AuthError('A verificação de dois fatores é obrigatória para o BKO.',403);
  if (!env.DB) throw new AuthError('Banco temporariamente indisponível.',503);
  const staff=await env.DB.prepare('SELECT auth_user_id,role,label FROM staff_accounts WHERE auth_user_id=? AND suspended_at IS NULL').bind(identity.id).first();
  if (!staff || !['BKO','ADMIN'].includes(staff.role)) throw new AuthError('Conta sem permissão de BKO.',403);
  return {...identity,...staff};
}

export async function requireBroker(request,env) {
  const identity=await verifyIdentity(request,env);
  if (!env.DB) throw new AuthError('Banco temporariamente indisponível.',503);
  const profile=await env.DB.prepare(`SELECT b.application_id,a.name,a.status,a.product
    FROM broker_profiles b INNER JOIN applications a ON a.id=b.application_id
    WHERE b.auth_user_id=? AND b.suspended_at IS NULL AND a.status='APROVADO'`).bind(identity.id).first();
  if (!profile) throw new AuthError('Seu acesso ainda não foi liberado ou está suspenso.',403);
  return {...identity,...profile,role:'CORRETOR'};
}
