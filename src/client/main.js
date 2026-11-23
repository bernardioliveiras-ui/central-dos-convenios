import './styles.css';

const form=document.querySelector('#application-form');
const submit=document.querySelector('#submit-application');
const status=document.querySelector('#application-status');
const unavailable=document.querySelector('#registration-unavailable');
const states='AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const uf=form.elements.state;
for(const state of states){const option=new Option(state,state);uf.add(option);}
document.querySelector('#year').textContent=String(new Date().getFullYear());

let config=null;
let turnstileToken='';
let renderTurnstile=null;

function setStatus(message,isError=false) {
  status.textContent=message;
  status.classList.toggle('error',isError);
}

function loadTurnstile(siteKey) {
  const script=document.createElement('script');
  script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async=true;
  script.defer=true;
  script.onload=()=>{
    renderTurnstile=window.turnstile.render('#turnstile-widget',{
      sitekey:siteKey,theme:'light',language:'pt-BR',action:'broker_signup',
      callback(token){turnstileToken=token;},
      'expired-callback'(){turnstileToken='';},
      'error-callback'(){turnstileToken='';}
    });
  };
  script.onerror=()=>setStatus('A verificação de segurança não carregou. Recarregue a página.',true);
  document.head.append(script);
}

async function loadConfig() {
  try {
    const res=await fetch('/api/public-config',{cache:'no-store'});
    if(!res.ok)throw Error('Configuração indisponível');
    config=await res.json();
    if(config.privacyPolicyUrl){const link=document.querySelector('#privacy-url');link.href=config.privacyPolicyUrl;link.target='_blank';link.rel='noopener noreferrer';}
    if(config.partnerTermsUrl){const link=document.querySelector('#terms-url');link.href=config.partnerTermsUrl;link.target='_blank';link.rel='noopener noreferrer';}
    if(config.companyLegalName)document.querySelector('#legal-company').textContent=config.companyLegalName;
    if(!config.registrationOpen)return;
    unavailable.hidden=true;
    submit.disabled=false;
    loadTurnstile(config.turnstileSiteKey);
  } catch {
    unavailable.textContent='Cadastro temporariamente indisponível. Nossa equipe está concluindo os requisitos para receber solicitações com segurança.';
  }
}

form.addEventListener('submit',async(event)=>{
  event.preventDefault();
  if(!config?.registrationOpen)return setStatus('O credenciamento ainda não está aberto.',true);
  if(!form.reportValidity())return;
  if(!turnstileToken)return setStatus('Conclua a verificação de segurança antes de enviar.',true);
  const data=new FormData(form);
  const payload={
    name:data.get('name'),email:data.get('email'),phone:data.get('phone'),city:data.get('city'),state:data.get('state'),
    susep:data.get('susep'),profile:data.get('profile'),product:data.get('product'),
    privacyAccepted:data.has('privacyAccepted'),partnerTermsAccepted:data.has('partnerTermsAccepted'),turnstileToken
  };
  submit.disabled=true;setStatus('Enviando solicitação...');
  try {
    const res=await fetch('/api/applications',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    const reply=await res.json();
    if(!res.ok)throw Error(reply.error||'Não foi possível enviar sua solicitação.');
    form.reset();setStatus(reply.message||'Solicitação recebida.');
  } catch(e) {setStatus(e.message||'Não foi possível conectar. Tente novamente.',true);}
  finally {
    turnstileToken='';
    if(window.turnstile&&renderTurnstile!==null)window.turnstile.reset(renderTurnstile);
    submit.disabled=false;
  }
});

loadConfig();
