import { InputError, validateApplication } from './validation.js';
import { AuthError, authReady,createSession,SESSION_COOKIE,sessionCookie,revokeSession,requireStaff,requireBroker,verifyIdentity } from './auth.js';
import { hashPassword,verifyPassword,validPassword,safeEqual,hashToken,randomToken,newTotpSecret,encryptSecret,decryptSecret,matchingTotpCounter,nowSeconds } from './crypto.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const error = (message,status) => json({error:message},status);
const validLegalUrl=(value)=>typeof value==='string' && /^https:\/\/[^\s/]+\.[^\s/]+\//i.test(value);
const registrationEnabled=(env)=>authReady(env) && env.REGISTRATION_OPEN==='true' && env.LEGAL_APPROVED==='true'
  && Boolean(env.DB&&env.TURNSTILE_SECRET&&env.RATE_LIMIT_SALT&&env.TURNSTILE_SITE_KEY)
  && validLegalUrl(env.PRIVACY_POLICY_URL) && validLegalUrl(env.PARTNER_TERMS_URL)
  && typeof env.COMPANY_LEGAL_NAME==='string' && env.COMPANY_LEGAL_NAME.trim().length>=6;

async function turnstileValid(token, request, env) {
  const body = new FormData();
  body.set('secret',env.TURNSTILE_SECRET);
  body.set('response',token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) body.set('remoteip',ip);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method:'POST', body, signal:AbortSignal.timeout(7000)
  });
  if (!response.ok) return false;
  const result=await response.json();
  return result.success===true && result.hostname===new URL(request.url).hostname && result.action==='broker_signup';
}

async function rateAllowed(request,env) {
  const clientIp=request.headers.get('CF-Connecting-IP') || 'unknown';
  const text = new TextEncoder().encode(`${env.RATE_LIMIT_SALT}:${clientIp}:${Math.floor(Date.now()/3600000)}`);
  const digest=await crypto.subtle.digest('SHA-256',text);
  const bucket=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const expiry=Math.floor(Date.now()/1000)+3700;
  const result=await env.DB.prepare('INSERT INTO request_limits (bucket_id,count,expires_at) VALUES (?,1,?) ON CONFLICT(bucket_id) DO UPDATE SET count=count+1 RETURNING count').bind(bucket,expiry).first();
  return result && result.count <= 8;
}

async function register(request,env) {
  if (!registrationEnabled(env)) return error('Credenciamento em preparação. Tente novamente em breve.',503);
  const origin=request.headers.get('origin');
  if (origin && origin!==new URL(request.url).origin) return error('Origem não permitida.',403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return error('Envie dados em JSON.',415);
  const raw=await request.text();
  if (raw.length > 5000) return error('Dados inválidos.',413);
  let input;
  try { input=JSON.parse(raw); } catch { return error('Dados inválidos.',400); }
  let value;
  try { value=validateApplication(input); } catch (e) { return error(e instanceof InputError ? e.message:'Dados inválidos.',400); }
  if (typeof input.turnstileToken !== 'string' || input.turnstileToken.length > 4096 || !input.turnstileToken) return error('Confirme a verificação de segurança.',400);
  if (!await turnstileValid(input.turnstileToken,request,env)) return error('Verificação de segurança não aprovada.',400);
  if (!await rateAllowed(request,env)) return error('Muitas tentativas. Aguarde e tente novamente.',429);
  const id=crypto.randomUUID();
  const {name,email,phone,city,state,susep,profile,product}=value;
  try {
    await env.DB.prepare('INSERT INTO applications (id,name,email,phone,city,state,susep,profile,product) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,name,email,phone,city,state,susep,profile,product).run();
  } catch (e) {
    if (!String(e?.message||'').includes('UNIQUE')) throw e;
    // Resposta indistinguível evita enumerar e-mails já cadastrados.
  }
  return json({message:'Solicitação recebida. Nossa equipe entrará em contato após a análise.'},202);
}

function sameOrigin(request,env) {
  const origin=request.headers.get('origin');
  const ref=request.headers.get('referer');
  const expected=new URL(request.url).origin;
  if(env.PORTAL_ORIGIN&&expected!==env.PORTAL_ORIGIN)return false;
  if(origin&&origin!==expected)return false;
  if(ref){try{if(new URL(ref).origin!==expected)return false;}catch{return false;}}
  return true;
}

async function parseSmallJson(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new InputError();
  const raw=await request.text();
  if (raw.length > 1000) throw new InputError();
  try { return JSON.parse(raw); } catch { throw new InputError(); }
}

async function audit(env, actor,action,targetType,targetId,meta={}) {
  await env.DB.prepare(`INSERT INTO audit_events (id,actor_auth_id,action,target_type,target_id,metadata) VALUES (?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(),actor,action,targetType,targetId,JSON.stringify(meta)).run();
}

function requireAuthConfig(env){if(!authReady(env))throw new AuthError('Autenticação ainda não configurada.',503);}
function validateEmail(email){return typeof email==='string'&&/^[^\s@]{1,64}@[^\s@]{1,180}\.[^\s@]{2,}$/u.test(email)&&email.length<=254;}
function requirePassword(password){if(!validPassword(password))throw new InputError('Use senha individual de 12 a 128 caracteres.');}

async function authRate(request,env,kind,subject,limit=10){
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  const current=nowSeconds();
  const source=`${env.RATE_LIMIT_SALT}:${kind}:${ip}:${String(subject||'').toLowerCase()}`;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
  const bucket=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const expires=current+3600;
  const row=await env.DB.prepare(`INSERT INTO request_limits(bucket_id,count,expires_at) VALUES(?,1,?)
    ON CONFLICT(bucket_id) DO UPDATE SET count=CASE WHEN expires_at<? THEN 1 ELSE count+1 END,
    expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING count`)
    .bind(bucket,expires,current,current).first();
  if(!row||row.count>limit)throw new AuthError('Muitas tentativas. Aguarde antes de tentar novamente.',429);
}

async function bootstrap(request,env){
  requireAuthConfig(env);
  const input=await parseSmallJson(request);
  if(typeof env.ADMIN_SETUP_TOKEN!=='string'||env.ADMIN_SETUP_TOKEN.length<32||
    !safeEqual(input.setupToken,env.ADMIN_SETUP_TOKEN))return error('Inicialização não autorizada.',403);
  const existing=await env.DB.prepare("SELECT id FROM auth_users WHERE role='ADMIN'").first();
  if(existing)return error('ADMIN já configurado. Remova o secret ADMIN_SETUP_TOKEN.',409);
  const email='acesso@centraldosconvenios.com.br';
  if(String(input.email||'').toLowerCase()!==email)return error('E-mail do ADMIN não autorizado.',400);
  requirePassword(input.password);
  const id=crypto.randomUUID(),passwordHash=await hashPassword(input.password,env.PASSWORD_PEPPER);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO auth_users(id,email,role,password_hash,state) VALUES (?,?,'ADMIN',?,'ACTIVE')").bind(id,email,passwordHash),
    env.DB.prepare("INSERT INTO audit_events(id,actor_auth_id,action,target_type,target_id) VALUES (?,?,'ADMIN_CREATED','auth_user',?)").bind(crypto.randomUUID(),id,id)
  ]);
  return json({message:'ADMIN criado. Remova o secret ADMIN_SETUP_TOKEN. A verificação em duas etapas pode ser ativada futuramente no painel.'},201);
}

async function login(request,env){
  requireAuthConfig(env);
  const input=await parseSmallJson(request);
  const email=String(input.email||'').trim().toLowerCase();
  const password=input.password;
  if(!validateEmail(email)||typeof password!=='string'||password.length>128)return error('Credenciais inválidas.',401);
  await authRate(request,env,'login-ip','global',30);
  await authRate(request,env,'login-user',email,10);
  const account=await env.DB.prepare('SELECT id,password_hash,state FROM auth_users WHERE email=?').bind(email).first();
  if(!account?.password_hash){
    // Mesmo custo aproximado de derivação para não facilitar enumeração de contas.
    await hashPassword('Senha-Falsa-De-Comparacao-Do-Servidor-2026',env.PASSWORD_PEPPER);
    return error('Credenciais inválidas.',401);
  }
  if(!await verifyPassword(password,account.password_hash,env.PASSWORD_PEPPER)||account.state!=='ACTIVE')return error('Credenciais inválidas.',401);
  const cookie=await createSession(env,account.id);
  const res=json({message:'Acesso autenticado.'});
  res.headers.set('set-cookie',cookie);
  return res;
}

async function logout(request,env){
  await revokeSession(request,env);
  const res=json({message:'Sessão encerrada.'});
  res.headers.set('set-cookie',sessionCookie('',0));
  return res;
}

async function mfaSetup(request,env){
  const identity=await verifyIdentity(request,env);
  if(identity.role!=='ADMIN')throw new AuthError('Acesso não permitido.',403);
  if(identity.mfa_enabled)return error('Autenticador já configurado.',409);
  await authRate(request,env,'mfa-setup',identity.id,8);
  const input=await parseSmallJson(request);
  if(typeof input.password!=='string')return error('Confirme sua senha atual para ativar a proteção.',400);
  const account=await env.DB.prepare('SELECT password_hash FROM auth_users WHERE id=?').bind(identity.id).first();
  if(!account?.password_hash||!await verifyPassword(input.password,account.password_hash,env.PASSWORD_PEPPER))return error('Senha atual incorreta.',401);
  // Troca qualquer chave pendente (inclusive a que possa ter aparecido em uma captura de tela).
  const secret=newTotpSecret();
  const updated=await env.DB.prepare('UPDATE auth_users SET mfa_secret=?, mfa_last_counter=-1 WHERE id=? AND mfa_enabled=0')
    .bind(await encryptSecret(secret,env.SESSION_SECRET),identity.id).run();
  if(updated.meta.changes!==1)return error('O autenticador já foi ativado. Entre novamente.',409);
  const label=encodeURIComponent('Central dos Convenios:acesso@centraldosconvenios.com.br');
  return json({secret,otpauthUrl:`otpauth://totp/${label}?secret=${secret}&issuer=Central%20dos%20Convenios&digits=6&period=30`});
}

async function mfaVerify(request,env){
  const identity=await verifyIdentity(request,env);
  if(identity.role!=='ADMIN')throw new AuthError('Acesso não permitido.',403);
  await authRate(request,env,'mfa',identity.id,12);
  const input=await parseSmallJson(request);
  const user=await env.DB.prepare('SELECT mfa_secret,mfa_last_counter FROM auth_users WHERE id=?').bind(identity.id).first();
  if(!user?.mfa_secret)return error('Configure primeiro seu autenticador.',400);
  const secret=await decryptSecret(user.mfa_secret,env.SESSION_SECRET);
  const counter=await matchingTotpCounter(secret,input.code,Number(user.mfa_last_counter));
  if(counter===null)return error('Código inválido, expirado ou já utilizado.',400);
  const claimed=await env.DB.prepare('UPDATE auth_users SET mfa_last_counter=?,mfa_enabled=1 WHERE id=? AND mfa_last_counter<?')
    .bind(counter,identity.id,counter).run();
  if(claimed.meta.changes!==1)return error('Código já utilizado.',400);
  await env.DB.prepare('UPDATE auth_sessions SET mfa_verified=1 WHERE token_hash=? AND user_id=?')
    .bind(identity.sessionHash,identity.id).run();
  return json({message:'Verificação concluída.'});
}

async function activate(request,env){
  requireAuthConfig(env);
  const input=await parseSmallJson(request);
  if(typeof input.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.token))return error('Convite inválido.',400);
  requirePassword(input.password);
  await authRate(request,env,'activate','global',30);
  const tokenHash=await hashToken(input.token,env.SESSION_SECRET);
  const current=nowSeconds();
  const token=await env.DB.prepare(`SELECT t.user_id,t.purpose,u.state FROM auth_tokens t
    JOIN auth_users u ON u.id=t.user_id WHERE t.token_hash=? AND t.used_at IS NULL AND t.expires_at>?`)
    .bind(tokenHash,current).first();
  if(!token||(token.purpose==='INVITE'&&token.state!=='INVITED')||(token.purpose==='RESET'&&token.state!=='ACTIVE'))return error('Convite inválido ou expirado.',400);
  const passwordHash=await hashPassword(input.password,env.PASSWORD_PEPPER);
  const results=await env.DB.batch([
    env.DB.prepare('UPDATE auth_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?')
      .bind(current,tokenHash,current),
    env.DB.prepare("UPDATE auth_users SET password_hash=?,state='ACTIVE' WHERE id=? AND state=?")
      .bind(passwordHash,token.user_id,token.state),
    env.DB.prepare('DELETE FROM auth_sessions WHERE user_id=?').bind(token.user_id),
    env.DB.prepare("INSERT INTO audit_events(id,actor_auth_id,action,target_type,target_id) VALUES (?,?,?,'auth_user',?)")
      .bind(crypto.randomUUID(),token.user_id,token.purpose==='RESET'?'PASSWORD_RESET':'INVITE_ACTIVATED',token.user_id)
  ]);
  if(results[0].meta.changes!==1||results[1].meta.changes!==1)return error('Convite já utilizado.',400);
  return json({message:'Senha definida. Faça login com seu e-mail profissional.'});
}

async function listApplications(request,env) {
  await requireStaff(request,env);
  const rows=await env.DB.prepare(`SELECT a.id,a.name,a.email,a.phone,a.city,a.state,a.susep,a.profile,a.product,
     a.status,a.created_at,a.invite_status,u.state AS account_state
     FROM applications a LEFT JOIN broker_profiles b ON b.application_id=a.id
     LEFT JOIN auth_users u ON u.id=b.auth_user_id ORDER BY a.created_at DESC LIMIT 200`).all();
  return json({applications:rows.results});
}

function inviteReply(application,token,env,purpose){
  const origin=env.PORTAL_ORIGIN;
  const activationUrl=`${origin}/portal.html#token=${token}`;
  const greeting=purpose==='RESET'?'Aqui está seu novo link para redefinir a senha do portal.':'Seu credenciamento na Central dos Convênios foi aprovado! 🎉';
  const message=`Olá, ${application.name}! 👋\n\n${greeting}\n\nSeu e-mail de acesso: ${application.email}\nCrie sua senha pessoal pelo link abaixo (válido por 24 horas e de uso único):\n${activationUrl}\n\nDepois, entre no portal para acessar as simulações demonstrativas. Não compartilhe esse link nem sua senha.\n\nCentral dos Convênios`;
  const phone=String(application.phone).replace(/\D/g,'');
  const whatsappUrl=`https://wa.me/${phone.startsWith('55')?phone:`55${phone}`}?text=${encodeURIComponent(message)}`;
  return json({status:'APROVADO',inviteStatus:'ENVIADO',purpose,activationUrl,whatsappUrl,expiresInHours:24});
}

async function decideApplication(request,env,id) {
  const staff=await requireStaff(request,env);
  if (!sameOrigin(request,env)) return error('Origem não permitida.',403);
  if(!/^https:\/\/[^/]+$/i.test(env.PORTAL_ORIGIN||''))return error('PORTAL_ORIGIN não configurado.',503);
  const input=await parseSmallJson(request);
  if (!['approve','reject'].includes(input.decision)) return error('Decisão inválida.',400);
  if (input.decision==='reject' && (typeof input.reason!=='string' || input.reason.trim().length<8 || input.reason.length>500)) return error('Informe o motivo interno da reprovação.',400);
  const application=await env.DB.prepare('SELECT id,name,email,phone,status FROM applications WHERE id=?').bind(id).first();
  if (!application) return error('Solicitação não encontrada.',404);
  if (application.status!=='PENDENTE') return error('A solicitação já foi analisada.',409);
  const approve=input.decision==='approve';
  const decisionId=crypto.randomUUID();
  // O D1 executa o batch atomicamente: decisão e auditoria são inseparáveis.
  const userId=crypto.randomUUID(),token=randomToken(),tokenHash=await hashToken(token,env.SESSION_SECRET);
  const expires=nowSeconds()+86400;
  const commands=[
    env.DB.prepare(`UPDATE applications SET status=?,internal_reason=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,invite_status=?,decision_id=? WHERE id=? AND status='PENDENTE'`)
      .bind(approve?'APROVADO':'REPROVADO',approve?null:input.reason.trim(),staff.id,approve?'ENVIADO':'NAO_APLICAVEL',decisionId,id)
  ];
  if(approve){
    commands.push(
      env.DB.prepare(`INSERT INTO auth_users(id,email,role,state)
        SELECT ?,email,'CORRETOR','INVITED' FROM applications WHERE id=? AND decision_id=?`).bind(userId,id,decisionId),
      env.DB.prepare(`INSERT INTO broker_profiles(auth_user_id,application_id)
        SELECT ?,id FROM applications WHERE id=? AND decision_id=?`).bind(userId,id,decisionId),
      env.DB.prepare(`INSERT INTO auth_tokens(token_hash,user_id,purpose,expires_at)
        SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM applications WHERE id=? AND decision_id=?)`)
        .bind(tokenHash,userId,'INVITE',expires,id,decisionId)
    );
  }
  commands.push(env.DB.prepare(`INSERT INTO audit_events (id,actor_auth_id,action,target_type,target_id,metadata)
      SELECT ?,?,?, 'application',?, '{}' FROM applications WHERE id=? AND decision_id=?`)
      .bind(crypto.randomUUID(),staff.id,approve?'APPLICATION_APPROVED':'APPLICATION_REJECTED',id,id,decisionId));
  const results=await env.DB.batch(commands);
  if (results[0].meta.changes!==1) return error('Outra pessoa já analisou esta solicitação.',409);
  if (!approve) return json({status:'REPROVADO'});
  return inviteReply(application,token,env,'INVITE');
}

async function regenerateAccess(request,env,id,purpose='INVITE') {
  const staff=await requireStaff(request,env);
  if(!sameOrigin(request,env))return error('Origem não permitida.',403);
  if(!/^https:\/\/[^/]+$/i.test(env.PORTAL_ORIGIN||''))return error('PORTAL_ORIGIN não configurado.',503);
  const application=await env.DB.prepare(`SELECT a.id,a.name,a.email,a.phone,a.status,a.invite_status,u.id AS user_id,u.state
    FROM applications a JOIN broker_profiles b ON b.application_id=a.id JOIN auth_users u ON u.id=b.auth_user_id WHERE a.id=?`).bind(id).first();
  if(!application)return error('Solicitação não encontrada.',404);
  if(application.status!=='APROVADO'||(purpose==='INVITE'&&application.state!=='INVITED')||(purpose==='RESET'&&application.state!=='ACTIVE'))return error('Acesso não pode ser gerado neste estado.',409);
  const token=randomToken(),hash=await hashToken(token,env.SESSION_SECRET),current=nowSeconds();
  await env.DB.batch([
    env.DB.prepare('UPDATE auth_tokens SET used_at=? WHERE user_id=? AND purpose=? AND used_at IS NULL').bind(current,application.user_id,purpose),
    env.DB.prepare('INSERT INTO auth_tokens(token_hash,user_id,purpose,expires_at) VALUES (?,?,?,?)').bind(hash,application.user_id,purpose,current+86400),
    env.DB.prepare(`INSERT INTO audit_events(id,actor_auth_id,action,target_type,target_id) VALUES (?,?,?,'application',?)`)
      .bind(crypto.randomUUID(),staff.id,purpose==='RESET'?'PASSWORD_RESET_ISSUED':'INVITE_REISSUED',id)
  ]);
  return inviteReply(application,token,env,purpose);
}

async function myProfile(request,env) {
  const identity=await verifyIdentity(request,env);
  if(identity.role==='ADMIN')return json({role:'ADMIN',label:'Central dos Convênios',mfaRequired:Boolean(identity.mfa_enabled&&!identity.mfa_verified),mfaEnabled:Boolean(identity.mfa_enabled)});
  const broker=await requireBroker(request,env);
  return json({role:'CORRETOR',name:broker.name,product:broker.product,quotesEnabled:false,demoSimulation:true});
}

const worker={
  async scheduled(_event,env){
    if(env.DB){
      await env.DB.prepare('DELETE FROM request_limits WHERE expires_at < ?').bind(nowSeconds()).run();
      await env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').bind(nowSeconds()).run();
      await env.DB.prepare('DELETE FROM auth_tokens WHERE expires_at < ?').bind(nowSeconds()-86400).run();
    }
  },
  async fetch(request,env) {
    const url=new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS?.fetch(request) ?? error('Não encontrado.',404);
    try {
      if (url.pathname==='/api/public-config' && request.method==='GET') return json({registrationOpen:registrationEnabled(env),authAvailable:authReady(env),turnstileSiteKey:env.TURNSTILE_SITE_KEY||'',privacyPolicyUrl:registrationEnabled(env)?env.PRIVACY_POLICY_URL:'',partnerTermsUrl:registrationEnabled(env)?env.PARTNER_TERMS_URL:'',companyLegalName:env.COMPANY_LEGAL_NAME||''});
      if (url.pathname==='/api/applications' && request.method==='POST') return await register(request,env);
      if(request.method==='POST'&&!sameOrigin(request,env))return error('Origem não permitida.',403);
      if(url.pathname==='/api/setup/admin'&&request.method==='POST')return await bootstrap(request,env);
      if(url.pathname==='/api/auth/login'&&request.method==='POST')return await login(request,env);
      if(url.pathname==='/api/auth/logout'&&request.method==='POST')return await logout(request,env);
      if(url.pathname==='/api/auth/activate'&&request.method==='POST')return await activate(request,env);
      if(url.pathname==='/api/auth/mfa/setup'&&request.method==='POST')return await mfaSetup(request,env);
      if(url.pathname==='/api/auth/mfa/verify'&&request.method==='POST')return await mfaVerify(request,env);
      if (url.pathname==='/api/me' && request.method==='GET') return await myProfile(request,env);
      if (url.pathname==='/api/bko/applications' && request.method==='GET') return await listApplications(request,env);
      const decision=/^\/api\/bko\/applications\/([a-zA-Z0-9-]{1,80})\/decision$/.exec(url.pathname);
      if (decision && request.method==='POST') return await decideApplication(request,env,decision[1]);
      const retry=/^\/api\/bko\/applications\/([a-zA-Z0-9-]{1,80})\/retry-invite$/.exec(url.pathname);
      if (retry && request.method==='POST') return await regenerateAccess(request,env,retry[1]);
      const reset=/^\/api\/bko\/applications\/([a-zA-Z0-9-]{1,80})\/reset-access$/.exec(url.pathname);
      if (reset&&request.method==='POST') return await regenerateAccess(request,env,reset[1],'RESET');
      return error('Rota não encontrada.',404);
    } catch (e) {
      if (e instanceof AuthError) return error(e.message,e.status);
      if (e instanceof InputError) return error(e.message,400);
      console.error('api_failure', {path:url.pathname, type:e?.name||'Error'});
      return error('Não foi possível processar agora. Tente novamente.',503);
    }
  }
};
export default worker;
