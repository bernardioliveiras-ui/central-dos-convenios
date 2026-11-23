import { InputError, validateApplication } from './validation.js';
import { AuthError, requireStaff, requireBroker, verifyIdentity } from './auth.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const error = (message,status) => json({error:message},status);
const validLegalUrl=(value)=>typeof value==='string' && /^https:\/\/[^\s/]+\.[^\s/]+\//i.test(value);
const registrationEnabled=(env)=>env.REGISTRATION_OPEN==='true' && env.LEGAL_APPROVED==='true'
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
  return !origin || (origin===new URL(request.url).origin && (!env.PORTAL_ORIGIN || origin===env.PORTAL_ORIGIN));
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

async function listApplications(request,env) {
  await requireStaff(request,env);
  const rows=await env.DB.prepare(`SELECT id,name,email,phone,city,state,susep,profile,product,status,created_at,invite_status
     FROM applications ORDER BY created_at DESC LIMIT 200`).all();
  return json({applications:rows.results});
}

async function sendApprovedInvite(id,application,env,actor) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_URL || !env.PORTAL_ORIGIN) {
    await env.DB.prepare(`UPDATE applications SET invite_status='ERRO',invite_error_code='CONFIGURACAO' WHERE id=?`).bind(id).run();
    await audit(env,actor,'INVITE_FAILED','application',id,{code:'CONFIGURACAO'});
    return error('Serviço de convites não configurado. Solicitação aprovada; o BKO poderá tentar novamente após a configuração.',503);
  }
  let response;
  try {
    const target=new URL('/portal.html?setup=1',env.PORTAL_ORIGIN).toString();
    const url=`${env.SUPABASE_URL.replace(/\/$/,'')}/auth/v1/invite?redirect_to=${encodeURIComponent(target)}`;
    response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`},body:JSON.stringify({email:application.email}),signal:AbortSignal.timeout(9000)});
  } catch {
    await env.DB.prepare(`UPDATE applications SET invite_status='ERRO',invite_error_code='TRANSPORTE' WHERE id=?`).bind(id).run();
    return error('Aprovação registrada, mas o convite não pôde ser enviado.',502);
  }
  if (!response.ok) {
    await env.DB.prepare(`UPDATE applications SET invite_status='ERRO',invite_error_code='PROVEDOR' WHERE id=?`).bind(id).run();
    await audit(env,actor,'INVITE_FAILED','application',id,{code:'PROVEDOR'});
    return error('Aprovação registrada, mas o convite não pôde ser enviado.',502);
  }
  const data=await response.json().catch(()=>null);
  const userId=data?.user?.id || data?.id;
  if (!userId || typeof userId!=='string') {
    await env.DB.prepare(`UPDATE applications SET invite_status='ERRO',invite_error_code='SEM_IDENTIDADE' WHERE id=?`).bind(id).run();
    return error('Convite sem confirmação de identidade. Acione o suporte.',502);
  }
  try {
    await env.DB.prepare('INSERT INTO broker_profiles (auth_user_id,application_id) VALUES (?,?)').bind(userId,id).run();
    await env.DB.prepare(`UPDATE applications SET invite_status='ENVIADO',invite_error_code=NULL WHERE id=?`).bind(id).run();
    await audit(env,actor,'INVITE_SENT','application',id,{authUserId:userId});
  } catch {
    await env.DB.prepare(`UPDATE applications SET invite_status='ERRO',invite_error_code='VINCULO' WHERE id=?`).bind(id).run();
    return error('Convite emitido, mas falhou o vínculo. Contate o suporte.',502);
  }
  return json({status:'APROVADO',inviteStatus:'ENVIADO'});
}

async function decideApplication(request,env,id) {
  const staff=await requireStaff(request,env);
  if (!sameOrigin(request,env)) return error('Origem não permitida.',403);
  const input=await parseSmallJson(request);
  if (!['approve','reject'].includes(input.decision)) return error('Decisão inválida.',400);
  if (input.decision==='reject' && (typeof input.reason!=='string' || input.reason.trim().length<8 || input.reason.length>500)) return error('Informe o motivo interno da reprovação.',400);
  const application=await env.DB.prepare('SELECT id,email,status FROM applications WHERE id=?').bind(id).first();
  if (!application) return error('Solicitação não encontrada.',404);
  if (application.status!=='PENDENTE') return error('A solicitação já foi analisada.',409);
  const approve=input.decision==='approve';
  const decisionId=crypto.randomUUID();
  // O D1 executa o batch atomicamente: decisão e auditoria são inseparáveis.
  const results=await env.DB.batch([
    env.DB.prepare(`UPDATE applications SET status=?,internal_reason=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,invite_status=?,decision_id=? WHERE id=? AND status='PENDENTE'`)
      .bind(approve?'APROVADO':'REPROVADO',approve?null:input.reason.trim(),staff.id,approve?'PENDENTE':'NAO_APLICAVEL',decisionId,id),
    env.DB.prepare(`INSERT INTO audit_events (id,actor_auth_id,action,target_type,target_id,metadata)
      SELECT ?,?,?, 'application',?, '{}' FROM applications WHERE id=? AND decision_id=?`)
      .bind(crypto.randomUUID(),staff.id,approve?'APPLICATION_APPROVED':'APPLICATION_REJECTED',id,id,decisionId)
  ]);
  if (results[0].meta.changes!==1) return error('Outra pessoa já analisou esta solicitação.',409);
  if (!approve) return json({status:'REPROVADO'});
  return await sendApprovedInvite(id,application,env,staff.id);
}

async function retryInvite(request,env,id) {
  const staff=await requireStaff(request,env);
  if(!sameOrigin(request,env))return error('Origem não permitida.',403);
  const application=await env.DB.prepare(`SELECT id,email,status,invite_status FROM applications WHERE id=?`).bind(id).first();
  if(!application)return error('Solicitação não encontrada.',404);
  if(application.status!=='APROVADO'||application.invite_status!=='ERRO')return error('Convite não pode ser reenviado neste estado.',409);
  const linked=await env.DB.prepare('SELECT auth_user_id FROM broker_profiles WHERE application_id=?').bind(id).first();
  if(linked)return error('A conta já está vinculada. Acione o suporte para verificar o convite.',409);
  const claimed=await env.DB.prepare(`UPDATE applications SET invite_status='PENDENTE',invite_error_code=NULL WHERE id=? AND invite_status='ERRO'`).bind(id).run();
  if(claimed.meta.changes!==1)return error('Outra pessoa já está processando o convite.',409);
  await audit(env,staff.id,'INVITE_RETRY','application',id);
  return await sendApprovedInvite(id,application,env,staff.id);
}

async function myProfile(request,env) {
  // Identidade verificada antes da escolha do papel. Papel enviado pelo navegador é ignorado.
  const identity=await verifyIdentity(request,env);
  if (!env.DB) return error('Banco indisponível.',503);
  const staff=await env.DB.prepare('SELECT role,label FROM staff_accounts WHERE auth_user_id=? AND suspended_at IS NULL').bind(identity.id).first();
  if (staff) return json({role:staff.role,label:staff.label,mfaRequired:identity.aal!=='aal2'});
  const broker=await requireBroker(request,env);
  return json({role:'CORRETOR',name:broker.name,product:broker.product,quotesEnabled:false});
}

const worker={
  async scheduled(_event,env){
    if(env.DB)await env.DB.prepare('DELETE FROM request_limits WHERE expires_at < ?').bind(Math.floor(Date.now()/1000)).run();
  },
  async fetch(request,env) {
    const url=new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS?.fetch(request) ?? error('Não encontrado.',404);
    try {
      if (url.pathname==='/api/public-config' && request.method==='GET') return json({registrationOpen:registrationEnabled(env),turnstileSiteKey:env.TURNSTILE_SITE_KEY||'',supabaseUrl:env.SUPABASE_URL||'',supabaseKey:env.SUPABASE_PUBLISHABLE_KEY||'',privacyPolicyUrl:registrationEnabled(env)?env.PRIVACY_POLICY_URL:'',partnerTermsUrl:registrationEnabled(env)?env.PARTNER_TERMS_URL:'',companyLegalName:env.COMPANY_LEGAL_NAME||''});
      if (url.pathname==='/api/applications' && request.method==='POST') return await register(request,env);
      if (url.pathname==='/api/me' && request.method==='GET') return await myProfile(request,env);
      if (url.pathname==='/api/bko/applications' && request.method==='GET') return await listApplications(request,env);
      const decision=/^\/api\/bko\/applications\/([a-zA-Z0-9-]{1,80})\/decision$/.exec(url.pathname);
      if (decision && request.method==='POST') return await decideApplication(request,env,decision[1]);
      const retry=/^\/api\/bko\/applications\/([a-zA-Z0-9-]{1,80})\/retry-invite$/.exec(url.pathname);
      if (retry && request.method==='POST') return await retryInvite(request,env,retry[1]);
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
