import './styles.css';
import {estimateDemoPlan} from './simulation.js';
import {adminAccessView} from './portal-access.js';

const $=id=>document.getElementById(id);
const viewIds=['login-form','password-setup-form','reset-form','mfa-password-form','mfa-enroll-form','mfa-challenge-form'];
let activationToken=null;
$('new-password').minLength=12;
$('confirm-password').minLength=12;
function showForm(id){for(const formId of viewIds)$(formId).hidden=formId!==id;$('back-to-login').hidden=['login-form','mfa-password-form','mfa-enroll-form'].includes(id);$('forgot-password').hidden=id!=='login-form';}
function showMessage(message,isError=true){$('login-result').textContent=message;$('login-result').classList.toggle('error',isError);}
function setNotice(message){$('portal-alert').hidden=!message;$('portal-alert').textContent=message||'';}
function setBusy(form,busy){for(const button of form.querySelectorAll('button'))button.disabled=busy;}
function textEl(tag,className,text){const element=document.createElement(tag);if(className)element.className=className;element.textContent=text;return element;}
function showActivation(){
  $('portal-setup-alert').hidden=false;
  $('login-title').textContent='Ative seu acesso.';
  $('login-subtitle').textContent='Crie uma senha individual de pelo menos 12 caracteres. Seu link é de uso único.';
  $('portal-app').hidden=true;$('portal-login').hidden=false;
  showForm('password-setup-form');
}
async function api(path,options={}){
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers:{...(options.body&&{'content-type':'application/json'}),...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Não foi possível concluir a operação.');
  return data;
}
async function init(){
  const fragment=location.hash.match(/^#token=([A-Za-z0-9_-]{43})$/);
  if(fragment){activationToken=fragment[1];history.replaceState({},'',location.pathname);}
  try{
    const config=await api('/api/public-config');
    if(!config.authAvailable){setNotice('A autenticação ainda não foi configurada no Cloudflare. O portal permanece fechado por segurança.');return;}
    setNotice('');
    if(activationToken){showActivation();return;}
    await enterPortal(true);
  }catch{setNotice('Não foi possível verificar o estado do portal. Tente novamente mais tarde.');}
}

async function enterPortal(silent=false){
  try{
    const profile=await api('/api/me');
    const mfaView=adminAccessView(profile);
    if(mfaView.challenge){
      $('portal-login').hidden=false;$('portal-app').hidden=true;
      $('login-title').textContent='Confirme sua identidade.';
      $('login-subtitle').textContent='Digite o código do seu aplicativo autenticador.';
      showForm('mfa-challenge-form');
      return;
    }
    $('portal-login').hidden=true;$('portal-app').hidden=false;
    $('profile-label').textContent=profile.label||profile.name||'Parceiro';
    $('profile-initial').textContent=(profile.label||profile.name||'C').charAt(0).toUpperCase();
    $('dashboard-title').textContent=profile.role==='CORRETOR'?`Olá, ${profile.name.split(' ')[0]}.`:'Painel de credenciamento.';
    $('dashboard-subtitle').textContent=profile.role==='CORRETOR'?'Simule cenários demonstrativos para apresentar aos seus clientes.':'Analise os pedidos, gere acessos e envie as boas-vindas pelo WhatsApp.';
    $('broker-view').hidden=profile.role!=='CORRETOR';$('bko-view').hidden=profile.role==='CORRETOR';
    if(profile.role==='CORRETOR')mountSimulator();else{
      ensureAdminMfaControl().hidden=!mfaView.offerEnrollment;
      await loadApplications();
    }
    showMessage('');
  }catch(e){
    $('portal-app').hidden=true;$('portal-login').hidden=false;
    showForm('login-form');
    if(!silent)showMessage(e.message);
  }
}

function ensureAdminMfaControl(){
  let section=$('admin-security');
  if(section)return section;
  section=document.createElement('section');section.id='admin-security';section.className='admin-security-card';
  const info=textEl('div','','');
  info.append(textEl('strong','','Segurança do administrador'),textEl('p','','A verificação em duas etapas é opcional. Você pode ativá-la quando quiser.'));
  const button=textEl('button','small-outline','Ativar verificação em duas etapas ↗');button.id='enable-admin-mfa';button.type='button';
  button.addEventListener('click',()=>{
    $('portal-app').hidden=true;$('portal-login').hidden=false;
    $('login-title').textContent='Ativar verificação em duas etapas.';
    $('login-subtitle').textContent='Confirme sua senha atual antes de cadastrar um autenticador.';
    showMessage('');showForm('mfa-password-form');$('mfa-password').focus();
  });
  section.append(info,button);$('bko-view').prepend(section);
  return section;
}

async function startMfaSetup(password){
  const enrollment=await api('/api/auth/mfa/setup',{method:'POST',body:JSON.stringify({password})});
  $('mfa-qr').replaceChildren();
  $('mfa-qr').append(textEl('p','', 'No Google Authenticator, Microsoft Authenticator ou outro app TOTP, adicione a chave abaixo:'),textEl('code','mfa-secret',enrollment.secret));
  const tip=textEl('p','', 'Não compartilhe esta chave. Depois, digite o código de seis dígitos gerado pelo aplicativo.');
  $('mfa-qr').append(tip);
  $('login-title').textContent='Proteja seu acesso ADMIN.';
  $('login-subtitle').textContent='Opcional: ao ativar, os próximos logins também pedirão o código do aplicativo.';
  showForm('mfa-enroll-form');
  $('portal-app').hidden=true;$('portal-login').hidden=false;
}

const mfaPasswordForm=document.createElement('form');mfaPasswordForm.id='mfa-password-form';mfaPasswordForm.hidden=true;
const passwordLabel=textEl('label','','Confirme sua senha ADMIN');
const mfaPassword=document.createElement('input');mfaPassword.id='mfa-password';mfaPassword.type='password';mfaPassword.required=true;mfaPassword.autocomplete='current-password';
passwordLabel.append(mfaPassword);
const confirmMfaPassword=textEl('button','btn btn-orange btn-form','Continuar com segurança ↗');confirmMfaPassword.type='submit';
const cancelMfaPassword=textEl('button','text-button','Voltar ao painel');cancelMfaPassword.type='button';
cancelMfaPassword.addEventListener('click',()=>{mfaPassword.value='';enterPortal();});
mfaPasswordForm.append(passwordLabel,confirmMfaPassword,cancelMfaPassword);$('login-form').after(mfaPasswordForm);
mfaPasswordForm.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;setBusy(form,true);showMessage('');
  const password=mfaPassword.value;mfaPassword.value='';
  try{await startMfaSetup(password);}catch(e){showMessage(e.message);}finally{setBusy(form,false);}
});

const cancelMfa=textEl('button','text-button','Voltar ao painel sem ativar');
cancelMfa.id='cancel-admin-mfa';cancelMfa.type='button';
cancelMfa.addEventListener('click',()=>enterPortal());
$('mfa-enroll-form').append(cancelMfa);

$('login-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;setBusy(form,true);showMessage('');
  try{
    await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:$('login-email').value.trim(),password:$('login-password').value})});
    $('login-password').value='';await enterPortal();
  }catch(e){showMessage(e.message);}finally{setBusy(form,false);}
});

$('password-setup-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;setBusy(form,true);
  try{
    if(!activationToken)throw Error('Link inválido ou já utilizado. Solicite novo acesso ao administrador.');
    const password=$('new-password').value;
    if(password!==$('confirm-password').value)throw Error('As senhas não coincidem.');
    if(password.length<12)throw Error('Use uma senha de pelo menos 12 caracteres.');
    await api('/api/auth/activate',{method:'POST',body:JSON.stringify({token:activationToken,password})});
    activationToken=null;$('new-password').value='';$('confirm-password').value='';
    $('portal-setup-alert').hidden=true;showForm('login-form');
    $('login-title').textContent='Acesso ativado!';
    $('login-subtitle').textContent='Agora entre com seu e-mail profissional e sua nova senha.';
    showMessage('Senha criada com sucesso. Você já pode entrar no portal.',false);
  }catch(e){showMessage(e.message);}finally{setBusy(form,false);}
});

$('forgot-password').addEventListener('click',()=>{
  showMessage('Para sua segurança, solicite ao ADMIN da Central um novo link individual de recuperação pelo WhatsApp.',false);
});
$('back-to-login').addEventListener('click',()=>{
  showForm('login-form');$('login-title').textContent='Bem-vindo de volta.';
  $('login-subtitle').textContent='Entre com o e-mail e a senha da sua conta aprovada.';showMessage('');
});
$('reset-form').addEventListener('submit',event=>{
  event.preventDefault();showForm('login-form');showMessage('Peça ao ADMIN um link individual de recuperação pelo WhatsApp.',false);
});
async function submitMfa(event){
  event.preventDefault();const form=event.currentTarget;setBusy(form,true);showMessage('');
  try{
    const input=form.id==='mfa-enroll-form'?'mfa-enroll-code':'mfa-challenge-code';
    await api('/api/auth/mfa/verify',{method:'POST',body:JSON.stringify({code:$(input).value.trim()})});
    $(input).value='';await enterPortal();
  }catch(e){showMessage(e.message);}finally{setBusy(form,false);}
}
$('mfa-enroll-form').addEventListener('submit',submitMfa);
$('mfa-challenge-form').addEventListener('submit',submitMfa);

function displayAccess(reply,person){
  let container=$('invite-result');
  if(!container){container=textEl('section','access-share','');container.id='invite-result';$('bko-view').prepend(container);}
  container.replaceChildren();
  container.append(textEl('h3','',`Acesso de ${person.name} gerado!`),textEl('p','', 'O link é pessoal, de uso único e válido por 24 horas. Ele NÃO foi enviado automaticamente. Abra o WhatsApp e confirme o envio.'));
  const linkInput=document.createElement('input');linkInput.value=reply.activationUrl;linkInput.readOnly=true;linkInput.setAttribute('aria-label','Link privado de ativação do corretor');container.append(linkInput);
  const actions=textEl('div','share-actions','');
  const whatsapp=textEl('a','btn btn-orange','Enviar boas-vindas pelo WhatsApp ↗');
  whatsapp.href=reply.whatsappUrl;whatsapp.target='_blank';whatsapp.rel='noopener noreferrer';
  const copy=textEl('button','small-outline','Copiar link');copy.type='button';
  copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(linkInput.value);copy.textContent='Link copiado ✓';}catch{linkInput.focus();linkInput.select();copy.textContent='Selecione e copie o link';}});
  actions.append(whatsapp,copy);container.append(actions);
  container.scrollIntoView({behavior:'smooth',block:'start'});
}
async function decide(app,decision){
  let reason;
  if(decision==='approve'){
    if(!confirm(`Aprovar ${app.name}? Confirme o registro na SUSEP e o número de WhatsApp ${app.phone} antes de prosseguir.`))return;
  }else{
    reason=prompt('Motivo interno da reprovação (mínimo de 8 caracteres):');
    if(reason===null)return;
    if(reason.trim().length<8)return alert('Informe um motivo com pelo menos 8 caracteres.');
  }
  try{
    const reply=await api(`/api/bko/applications/${encodeURIComponent(app.id)}/decision`,{method:'POST',body:JSON.stringify({decision,reason})});
    if(reply.activationUrl)displayAccess(reply,app);
    else alert('Decisão registrada.');
  }catch(e){alert(e.message);}await loadApplications();
}
async function regenerate(app,reset=false){
  if(!confirm(`Gerar um NOVO link pessoal para ${app.name}? O anterior deixa de funcionar.`))return;
  try{
    const path=reset?'reset-access':'retry-invite';
    const reply=await api(`/api/bko/applications/${encodeURIComponent(app.id)}/${path}`,{method:'POST',body:'{}'});
    displayAccess(reply,app);
  }catch(e){alert(e.message);}await loadApplications();
}
async function loadApplications(){
  const list=$('applications-list');list.textContent='Carregando solicitações...';
  try{
    const data=await api('/api/bko/applications');
    $('pending-count').textContent=String(data.applications.filter(a=>a.status==='PENDENTE').length);
    $('approved-count').textContent=String(data.applications.filter(a=>a.status==='APROVADO').length);
    list.replaceChildren();
    if(!data.applications.length){list.textContent='Nenhum credenciamento encontrado.';return;}
    for(const app of data.applications){
      const row=textEl('article','application-row','');
      const detail=textEl('div','','');const name=textEl('div','app-name',app.name);
      name.append(textEl('span',`app-tag ${app.status==='PENDENTE'?'pending':''}`,app.status));
      detail.append(name,textEl('div','app-meta',`${app.email} · ${app.phone} · ${app.city}/${app.state}`),textEl('div','app-meta',`SUSEP declarada: ${app.susep} · Perfil: ${app.profile} · Produto: ${app.product}`));
      if(app.status==='APROVADO')detail.append(textEl('div','app-meta',app.account_state==='ACTIVE'?'Conta ativada · link de recuperação disponível':'Convite gerado · aguarda ativação e envio manual'));
      row.append(detail);
      const actions=textEl('div','app-actions','');
      if(app.status==='PENDENTE'){
        const approve=textEl('button','approve-button','✓ Aprovar');approve.type='button';approve.addEventListener('click',()=>decide(app,'approve'));
        const reject=textEl('button','reject-button','Reprovar');reject.type='button';reject.addEventListener('click',()=>decide(app,'reject'));
        actions.append(approve,reject);
      }else if(app.status==='APROVADO'){
        const reset=app.account_state==='ACTIVE';
        const button=textEl('button','approve-button',reset?'↻ Recuperar acesso':'↻ Novo convite');button.type='button';button.addEventListener('click',()=>regenerate(app,reset));actions.append(button);
      }else actions.append(textEl('span','app-tag','Analisado'));
      row.append(actions);list.append(row);
    }
    list.prepend(textEl('div','bko-notice','Antes de aprovar, confirme manualmente o registro na SUSEP e o telefone do corretor. Links e WhatsApp exigem envio manual.'));
  }catch(e){list.textContent=e.message;}
}
$('refresh-applications').addEventListener('click',loadApplications);
$('sign-out').addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST',body:'{}'});}finally{location.href='/portal.html';}});

function mountSimulator(){
  if($('demo-simulator'))return;
  const section=document.createElement('section');section.id='demo-simulator';section.className='demo-simulator';
  section.innerHTML=`<div class="section-toolbar"><div><h2>Simulador de planos</h2><p>Crie cenários na hora, sem cadastrar informações pessoais do cliente.</p></div><span class="demo-label">MODO DEMONSTRAÇÃO</span></div>
    <div class="demo-warning">⚠️ Valores 100% fictícios para apresentação. Não são preços de operadoras, propostas ou cotações oficiais.</div>
    <form id="demo-form" class="demo-form">
      <label>Categoria<select id="demo-category"><option value="saude">Plano de saúde</option><option value="odontologico">Plano odontológico</option><option value="pet">Plano pet</option></select></label>
      <label>Faixa etária ilustrativa<select id="demo-age"><option value="0">Até 18 anos</option><option value="1" selected>19 a 39 anos</option><option value="2">40 a 59 anos</option><option value="3">60 anos ou mais</option></select></label>
      <label>Quantidade de beneficiários<input id="demo-count" type="number" min="1" max="10" value="1" required /></label>
      <button type="submit" class="btn btn-orange">Simular cenário ↗</button>
    </form><div id="demo-result" class="demo-result" role="status" aria-live="polite"></div>`;
  $('broker-view').prepend(section);
  const simNav=document.querySelector('.sidebar-nav button[disabled]');
  if(simNav){simNav.disabled=false;simNav.textContent='◈ Simulador Demo';simNav.addEventListener('click',()=>section.scrollIntoView({behavior:'smooth'}));}
  const labels={saude:'Saúde',odontologico:'Odontológico',pet:'Pet'};
  const currency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
  const calculate=event=>{
    event?.preventDefault();const category=$('demo-category').value;
    const age=Number($('demo-age').value),count=Number($('demo-count').value);
    if(!Number.isInteger(count)||count<1||count>10){$('demo-result').textContent='Informe de 1 a 10 beneficiários.';return;}
    const estimate=estimateDemoPlan(category,age,count);
    $('demo-result').replaceChildren(textEl('span','demo-result-label',`Cenário ilustrativo · ${labels[category]} · ${count} beneficiário(s)`),textEl('strong','demo-price',`${currency.format(estimate.monthly)} / mês`),textEl('small','',`Projeção anual fictícia: ${currency.format(estimate.annual)}. Não representa preço real nem garante cobertura.`));
  };
  $('demo-form').addEventListener('submit',calculate);calculate();
}
init();
