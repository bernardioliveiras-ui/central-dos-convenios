import {createClient} from '@supabase/supabase-js';
import './styles.css';

const $=(id)=>document.getElementById(id);
const viewIds=['login-form','password-setup-form','reset-form','mfa-enroll-form','mfa-challenge-form'];
let supabase=null;
let currentRole=null;
let currentFactor=null;
let enrollmentFactor=null;

function showForm(id){for(const formId of viewIds)$(formId).hidden=formId!==id;$('back-to-login').hidden=id==='login-form';$('forgot-password').hidden=id!=='login-form';}
function showMessage(message,isError=true){$('login-result').textContent=message;$('login-result').classList.toggle('error',isError);}
function setLoginNotice(message){$('portal-alert').hidden=!message;$('portal-alert').textContent=message||'';}
function setBusy(form,busy){for(const button of form.querySelectorAll('button'))button.disabled=busy;}
function showSetup(){
  $('portal-setup-alert').hidden=false;
  $('login-title').textContent='Ative seu acesso.';
  $('login-subtitle').textContent='Crie uma senha pessoal para continuar. Não compartilhe com ninguém.';
  $('portal-app').hidden=true;$('portal-login').hidden=false;
  showForm('password-setup-form');
}

async function api(path,options={}){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session)throw Error('Sua sessão expirou. Entre novamente.');
  const res=await fetch(path,{...options,headers:{...(options.body && {'content-type':'application/json'}),'authorization':`Bearer ${session.access_token}`},cache:'no-store'});
  const reply=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(reply.error||'Não foi possível carregar as informações.');
  return reply;
}

async function init(){
  try{
    const res=await fetch('/api/public-config',{cache:'no-store'});
    const config=await res.json();
    if(!res.ok||!config.supabaseUrl||!config.supabaseKey){setLoginNotice('A autenticação ainda não está configurada. O portal permanece fechado por segurança.');return;}
    supabase=createClient(config.supabaseUrl,config.supabaseKey,{
      auth:{flowType:'pkce',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true,
        storage:{getItem:(key)=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:(key)=>sessionStorage.removeItem(key)}}
    });
    setLoginNotice('');
    const {data:{session}}=await supabase.auth.getSession();
    if(session){
      if(new URLSearchParams(location.search).get('setup')==='1')showSetup();
      else await enterPortal();
    }
  }catch{setLoginNotice('Não foi possível verificar o estado do portal. Tente novamente mais tarde.');}
}

async function enterPortal(){
  if(!supabase)return;
  try{
    const profile=await api('/api/me');
    currentRole=profile.role;
    if((profile.role==='BKO'||profile.role==='ADMIN')&&profile.mfaRequired){await requireMfa();return;}
    $('portal-login').hidden=true;$('portal-app').hidden=false;
    $('profile-label').textContent=profile.label||profile.name||'Parceiro';
    $('profile-initial').textContent=(profile.label||profile.name||'C').charAt(0).toUpperCase();
    $('dashboard-title').textContent=profile.role==='CORRETOR'?`Olá, ${profile.name.split(' ')[0]}.`:'Painel de credenciamento.';
    $('dashboard-subtitle').textContent=profile.role==='CORRETOR'?'Seu ambiente de parceria está ativo.':'Revise os pedidos de credenciamento e acompanhe os convites.';
    $('broker-view').hidden=profile.role!=='CORRETOR';$('bko-view').hidden=profile.role==='CORRETOR';
    if(profile.role!=='CORRETOR')await loadApplications();
    showMessage('');
  }catch(e){
    $('portal-app').hidden=true;$('portal-login').hidden=false;
    showForm('login-form');showMessage(e.message);
  }
}

async function requireMfa(){
  const {data,error}=await supabase.auth.mfa.listFactors();
  if(error)throw error;
  const verified=data.totp?.find(item=>item.status==='verified');
  $('portal-login').hidden=false;$('portal-app').hidden=true;
  if(verified){currentFactor=verified.id;showForm('mfa-challenge-form');$('login-title').textContent='Confirme sua identidade.';return;}
  const enrollment=await supabase.auth.mfa.enroll({factorType:'totp',friendlyName:'Central dos Convênios BKO'});
  if(enrollment.error)throw enrollment.error;
  enrollmentFactor=enrollment.data.id;
  $('mfa-qr').replaceChildren();
  const qr=enrollment.data.totp?.qr_code;
  if(typeof qr==='string'&&/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(qr)){
    const img=document.createElement('img');img.src=qr;img.alt='QR Code para configurar seu aplicativo autenticador';$('mfa-qr').append(img);
  }
  const secret=document.createElement('code');secret.textContent=enrollment.data.totp?.secret||'Use o QR Code fornecido pelo autenticador.';$('mfa-qr').append(secret);
  $('login-title').textContent='Proteja sua conta.';
  showForm('mfa-enroll-form');
}

async function verifyMfa(factorId,code){
  const {data,error}=await supabase.auth.mfa.challengeAndVerify({factorId,code});
  if(error)throw error;
  if(!data)throw Error('Não foi possível validar o código.');
  await enterPortal();
}

$('login-form').addEventListener('submit',async(event)=>{
  event.preventDefault();if(!supabase)return showMessage('Autenticação indisponível.');
  const form=event.currentTarget;setBusy(form,true);showMessage('');
  try{
    const {error}=await supabase.auth.signInWithPassword({email:$('login-email').value.trim(),password:$('login-password').value});
    if(error)throw Error('Não foi possível entrar. Verifique seus dados e sua autorização.');
    await enterPortal();
  }catch(e){showMessage(e.message);}finally{setBusy(form,false);}
});

$('password-setup-form').addEventListener('submit',async(event)=>{
  event.preventDefault();const form=event.currentTarget;setBusy(form,true);
  try{
    const password=$('new-password').value;
    if(password!==$('confirm-password').value)throw Error('As senhas não coincidem.');
    if(password.length<10)throw Error('Use uma senha com pelo menos 10 caracteres.');
    const {error}=await supabase.auth.updateUser({password});
    if(error)throw error;
    history.replaceState({},'',location.pathname);
    $('portal-setup-alert').hidden=true;
    await enterPortal();
  }catch(e){showMessage(e.message);}finally{setBusy(form,false);}
});

$('forgot-password').addEventListener('click',()=>{showForm('reset-form');$('login-title').textContent='Recupere seu acesso.';$('login-subtitle').textContent='Enviaremos instruções se houver uma conta habilitada.';showMessage('');});
$('back-to-login').addEventListener('click',()=>{showForm('login-form');$('login-title').textContent='Bem-vindo de volta.';$('login-subtitle').textContent='Entre com o e-mail e a senha da sua conta aprovada.';showMessage('');});
$('reset-form').addEventListener('submit',async(event)=>{
  event.preventDefault();const form=event.currentTarget;setBusy(form,true);
  try{
    const {error}=await supabase.auth.resetPasswordForEmail($('reset-email').value.trim(),{redirectTo:new URL('/portal.html',location.origin).toString()});
    if(error)throw error;
    showMessage('Se houver uma conta elegível, as instruções serão enviadas.',false);
  }catch{showMessage('Não foi possível solicitar a recuperação agora.');}finally{setBusy(form,false);}
});

$('mfa-enroll-form').addEventListener('submit',async(event)=>{
  event.preventDefault();const form=event.currentTarget;setBusy(form,true);showMessage('');
  try{await verifyMfa(enrollmentFactor,$('mfa-enroll-code').value.trim());}catch{showMessage('Código inválido ou expirado. Tente novamente.');}finally{setBusy(form,false);}
});
$('mfa-challenge-form').addEventListener('submit',async(event)=>{
  event.preventDefault();const form=event.currentTarget;setBusy(form,true);showMessage('');
  try{await verifyMfa(currentFactor,$('mfa-challenge-code').value.trim());}catch{showMessage('Código inválido ou expirado. Tente novamente.');}finally{setBusy(form,false);}
});

function textElement(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;el.textContent=text;return el;}
async function decide(app,decision){
  let reason;
  if(decision==='approve'){
    if(!confirm(`Aprovar o credenciamento de ${app.name}? Confirme o registro na SUSEP antes de prosseguir.`))return;
  } else {
    reason=prompt('Motivo interno da reprovação (mínimo de 8 caracteres):');
    if(reason===null)return;
    if(reason.trim().length<8)return alert('Informe um motivo com pelo menos 8 caracteres.');
  }
  try{
    const reply=await api(`/api/bko/applications/${encodeURIComponent(app.id)}/decision`,{method:'POST',body:JSON.stringify({decision,reason})});
    alert(reply.inviteStatus==='ENVIADO'?'Aprovado. O convite foi solicitado ao serviço de identidade.':'Decisão registrada.');
  }catch(e){alert(e.message);}
  await loadApplications();
}

async function retryInvite(app){
  if(!confirm(`Tentar reenviar o convite para ${app.email}? Confirme antes se o destinatário está correto.`))return;
  try{
    await api(`/api/bko/applications/${encodeURIComponent(app.id)}/retry-invite`,{method:'POST',body:'{}'});
    alert('Convite enviado para processamento pelo serviço de identidade.');
  }catch(e){alert(e.message);}
  await loadApplications();
}

async function loadApplications(){
  const list=$('applications-list');list.textContent='Carregando solicitações...';
  try{
    const data=await api('/api/bko/applications');
    $('pending-count').textContent=String(data.applications.filter(a=>a.status==='PENDENTE').length);
    $('approved-count').textContent=String(data.applications.filter(a=>a.status==='APROVADO').length);
    list.replaceChildren();
    if(!data.applications.length){list.textContent='Nenhum credenciamento encontrado no momento.';return;}
    for(const app of data.applications){
      const row=textElement('article','application-row','');
      const detail=document.createElement('div');
      const name=textElement('div','app-name',app.name);
      name.append(textElement('span',`app-tag ${app.status==='PENDENTE'?'pending':''}`,app.status));
      detail.append(name,textElement('div','app-meta',`${app.email} · ${app.phone} · ${app.city}/${app.state}`),textElement('div','app-meta',`SUSEP declarada: ${app.susep} · Perfil: ${app.profile} · Produto: ${app.product}`));
      if(app.status==='APROVADO')detail.append(textElement('div','app-meta',`Convite: ${app.invite_status==='ERRO'?'falhou — requer análise da equipe':app.invite_status==='ENVIADO'?'enviado ao e-mail':'pendente'}`));
      row.append(detail);
      const actions=textElement('div','app-actions','');
      if(app.status==='PENDENTE'){
        const approve=textElement('button','approve-button','✓ Aprovar');approve.type='button';approve.addEventListener('click',()=>decide(app,'approve'));
        const reject=textElement('button','reject-button','Reprovar');reject.type='button';reject.addEventListener('click',()=>decide(app,'reject'));
        actions.append(approve,reject);
      } else if(app.status==='APROVADO'&&app.invite_status==='ERRO'){
        const retry=textElement('button','approve-button','↻ Reenviar convite');retry.type='button';retry.addEventListener('click',()=>retryInvite(app));actions.append(retry);
      } else actions.append(textElement('span','app-tag','Analisado'));
      row.append(actions);list.append(row);
    }
    const notice=textElement('div','bko-notice','Antes de aprovar, confirme manualmente o registro e a habilitação do profissional no site oficial da SUSEP.');
    list.prepend(notice);
  }catch(e){list.textContent=e.message;}
}

$('refresh-applications').addEventListener('click',loadApplications);
$('sign-out').addEventListener('click',async()=>{if(supabase)await supabase.auth.signOut();location.href='/portal.html';});
init();
