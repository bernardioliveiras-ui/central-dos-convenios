const enc=new TextEncoder();
const dec=new TextDecoder();
const PASSWORD_ITERATIONS=600000;
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const nowSeconds=()=>Math.floor(Date.now()/1000);
export function randomToken(bytes=32){
  const data=crypto.getRandomValues(new Uint8Array(bytes));
  return bytesToBase64Url(data);
}
export function bytesToBase64Url(bytes){
  let value='';for(const b of bytes)value+=String.fromCharCode(b);
  return btoa(value).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function base64UrlToBytes(value){
  const str=atob(value.replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(str,ch=>ch.charCodeAt(0));
}
export function safeEqual(a,b){
  const x=enc.encode(String(a)),y=enc.encode(String(b));
  let mismatch=x.length^y.length;
  for(let i=0;i<Math.max(x.length,y.length);i++)mismatch|=(x[i]||0)^(y[i]||0);
  return mismatch===0;
}
export function validPassword(password){
  return typeof password==='string' && password.length>=12 && password.length<=128 && enc.encode(password).length<=256;
}
async function derivedPassword(password,salt,iterations=PASSWORD_ITERATIONS){
  const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations},key,256));
}
export async function hashPassword(password){
  if(!validPassword(password))throw Error('Senha deve ter de 12 a 128 caracteres.');
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const hash=await derivedPassword(password,salt);
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
}
export async function verifyPassword(password,record){
  if(typeof password!=='string'||password.length>128||!record)return false;
  const parts=record.split('$');
  if(parts.length!==4||parts[0]!=='pbkdf2-sha256'||parts[1]!==String(PASSWORD_ITERATIONS))return false;
  try{
    const salt=base64UrlToBytes(parts[2]),expect=base64UrlToBytes(parts[3]);
    if(salt.length!==16||expect.length!==32)return false;
    const actual=await derivedPassword(password,salt);
    let difference=0;for(let i=0;i<32;i++)difference|=actual[i]^expect[i];
    return difference===0;
  }catch{return false;}
}
export async function hashToken(token,secret){
  if(typeof secret!=='string'||secret.length<32)throw Error('SESSION_SECRET ausente ou insuficiente');
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signed=await crypto.subtle.sign('HMAC',key,enc.encode(token));
  return bytesToBase64Url(new Uint8Array(signed));
}
async function encryptionKey(secret){
  if(typeof secret!=='string'||secret.length<32)throw Error('SESSION_SECRET ausente ou insuficiente');
  const hash=await crypto.subtle.digest('SHA-256',enc.encode(`central-convenios-totp-v1:${secret}`));
  return crypto.subtle.importKey('raw',hash,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function encryptSecret(value,secret){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(secret),enc.encode(value));
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(data))}`;
}
export async function decryptSecret(value,secret){
  const [iv,data]=String(value).split('.');
  if(!iv||!data)throw Error('Segredo inválido');
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64UrlToBytes(iv)},await encryptionKey(secret),base64UrlToBytes(data));
  return dec.decode(plaintext);
}
export function newTotpSecret(){
  const data=crypto.getRandomValues(new Uint8Array(20));
  let bits=0,value=0,out='';
  for(const b of data){value=(value<<8)|b;bits+=8;while(bits>=5){out+=B32[(value>>>(bits-=5))&31];}}
  if(bits)out+=B32[(value<<(5-bits))&31];
  return out;
}
function b32Decode(str){
  let bits=0,value=0;const bytes=[];
  for(const ch of str.replace(/=+$/,'').toUpperCase()){
    const index=B32.indexOf(ch);if(index===-1)throw Error('TOTP inválido');
    value=(value<<5)|index;bits+=5;
    if(bits>=8){bytes.push((value>>>(bits-=8))&255);value&=(1<<bits)-1;}
  }
  return new Uint8Array(bytes);
}
export async function generateTotp(secret,counter=Math.floor(Date.now()/30000)){
  const key=await crypto.subtle.importKey('raw',b32Decode(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']);
  const data=new Uint8Array(8);
  let count=BigInt(counter);
  for(let i=7;i>=0;i--){data[i]=Number(count&255n);count>>=8n;}
  const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,data));
  const offset=mac[19]&15;
  const number=((mac[offset]&127)<<24)|((mac[offset+1]&255)<<16)|((mac[offset+2]&255)<<8)|(mac[offset+3]&255);
  return String(number%1000000).padStart(6,'0');
}
export async function matchingTotpCounter(secret,code,lastCounter=-1){
  if(typeof code!=='string'||!/^\d{6}$/.test(code))return null;
  const now=Math.floor(Date.now()/30000);
  for(const count of [now-1,now,now+1]){
    if(count>lastCounter&&safeEqual(await generateTotp(secret,count),code))return count;
  }
  return null;
}
