import { inviteCode, SSEParser, reduceEvent } from './core.mjs';
const fail = (message, code) => Object.assign(new Error(message), {code});
function storageGet(key) { try {return JSON.parse(localStorage.getItem(key));} catch {return null;} }
function storageSet(key,value) { localStorage.setItem(key,JSON.stringify(value)); }
function delay(ms,signal) { return new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);reject(new DOMException('Stopped','AbortError'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
  if(signal.aborted) abort(); else signal.addEventListener('abort',abort,{once:true});
}); }
export class ViewerClient {
  constructor(config) {
    const url = new URL(config.databaseURL);
    if(url.protocol!=='https:' || !/\.(?:firebaseio\.com|firebasedatabase\.app)$/.test(url.hostname) || url.username || url.password || url.search || url.hash || url.port || !['','/'].includes(url.pathname)) throw new Error('Invalid Firebase database address.');
    this.config={...config,databaseURL:url.origin};
    this.storageKey=`tw.portal.identity.v1.${url.hostname}`;
    this.identity=storageGet(this.storageKey);
    this.authTask=null;
  }
  get uid() { return this.identity?.uid; }
  async token(force=false) {
    if(this.authTask) return this.authTask;
    if(!force && this.identity?.idToken && this.identity.expiresAt>Date.now()+90000) return this.identity.idToken;
    this.authTask=this.authenticate();
    try {return await this.authTask;} finally {this.authTask=null;}
  }
  async authenticate() {
    const previous=this.identity;
    const refresh=!!previous?.refreshToken;
    const url=refresh ? 'https://securetoken.googleapis.com/v1/token' : 'https://identitytoolkit.googleapis.com/v1/accounts:signUp';
    const response=await fetch(`${url}?key=${encodeURIComponent(this.config.apiKey)}`,{
      method:'POST',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(20000),
      headers:{'Content-Type':refresh?'application/x-www-form-urlencoded':'application/json'},
      body:refresh ? new URLSearchParams({grant_type:'refresh_token',refresh_token:previous.refreshToken}) : JSON.stringify({returnSecureToken:true})
    });
    const value=await response.json();
    if(!response.ok) throw fail('Browser sign-in failed. Check the Web API key and that Anonymous Authentication is enabled. If this identity was removed, clear this site’s saved data and rejoin.', 'auth');
    const next={uid:value[refresh?'user_id':'localId'],refreshToken:value[refresh?'refresh_token':'refreshToken'],idToken:value[refresh?'id_token':'idToken'],expiresAt:Date.now()+Number(value[refresh?'expires_in':'expiresIn'])*1000};
    if(!next.uid || !next.refreshToken || !next.idToken || !Number.isFinite(next.expiresAt) || (previous && next.uid!==previous.uid)) throw fail('The browser identity could not be verified.','auth');
    // Persist before using an identity: a storage failure must not orphan a membership.
    storageSet(this.storageKey,{uid:next.uid,refreshToken:next.refreshToken});
    this.identity=next;
    return next.idToken;
  }
  url(path,token) {
    if(!path || path.split('/').some(p=>!p || /[.#$\[\]]/.test(p))) throw new Error('Invalid sync path.');
    return `${this.config.databaseURL}/sharingV2/${path.split('/').map(encodeURIComponent).join('/')}.json?auth=${encodeURIComponent(token)}`;
  }
  async request(path,{method='GET',body,signal,etag}={}) {
    for(let attempt=0;attempt<2;attempt++) {
      const token=await this.token(attempt>0);
      const headers={'Content-Type':'application/json'};
      if(etag)headers['if-match']=etag;
      const timeout=AbortSignal.timeout(30000);
      const response=await fetch(this.url(path,token),{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:signal?AbortSignal.any([signal,timeout]):timeout,cache:'no-store',referrerPolicy:'no-referrer'});
      const result=await response.json();
      if(response.status===401 && attempt===0 && /expired/i.test(result?.error||''))continue;
      if([401,403].includes(response.status))throw fail('Group access was denied. Ask the owner for a current Read-only invitation.','permission');
      if(response.status===412)throw fail('The membership changed while joining. Try the invitation again.','conflict');
      if(!response.ok)throw fail(`The sharing service could not complete the request (${response.status}).`,'network');
      return result;
    }
    throw fail('Sign-in has expired. Reconnect the group.','auth');
  }
  async join(input,name) {
    const code=inviteCode(input),displayName=name.trim();
    if(!displayName || displayName.length>120)throw new Error('Enter a viewer name of up to 120 characters.');
    await this.token();
    const invite=await this.request(`pinGroupInvites/${code}`);
    if(!invite?.enabled || !invite.groupID || !invite.ownerID)throw new Error('This invitation is unavailable. Ask the owner for a current code.');
    if(invite.role!=='viewer')throw new Error('This code allows editing. Ask the owner to set the invitation to Read-only in TerraWarden and share the new code.');
    const path=`pinGroups/${invite.groupID}/members/${this.uid}`;
    const own=await this.request(path);
    if(own && own.role!=='viewer')throw new Error('This browser already has a different group role. Ask the owner to change it to Read-only.');
    if(!own)await this.request(path,{method:'PUT',etag:'null_etag',body:{uid:this.uid,displayName,role:'viewer',inviteCode:code,joinedAt:{'.sv':'timestamp'}}});
    const group=await this.request(`pinGroups/${invite.groupID}`);
    if(group?.isDeleted!==false || group.ownerID!==invite.ownerID || group.members?.[this.uid]?.role!=='viewer')throw fail('The group invitation or membership is no longer available.','permission');
    return {id:invite.groupID,name:group.name};
  }
  async watch(path,onData,onStatus,signal) {
    let retry=0,force=false;
    while(!signal.aborted) {
      let reader;
      try {
        onStatus('connecting');
        const token=await this.token(force); force=false;
        const response=await fetch(this.url(path,token),{headers:{Accept:'text/event-stream'},cache:'no-store',signal,referrerPolicy:'no-referrer'});
        if([401,403].includes(response.status))throw fail('Group access was denied.','permission');
        if(!response.ok || !response.body)throw fail('Live sync is temporarily unavailable.','network');
        reader=response.body.getReader();
        const decoder=new TextDecoder(), parser=new SSEParser(); let tree=null;
        while(!signal.aborted) {
          const {value,done}=await reader.read();
          if(done)break;
          for(const frame of parser.push(decoder.decode(value,{stream:true}))) {
            if(frame.event==='cancel')throw fail('Group access ended.','permission');
            if(frame.event==='auth_revoked'){force=true;throw fail('Refreshing browser sign-in.','refresh');}
            if(frame.event==='put'||frame.event==='patch'){
              tree=reduceEvent(tree,frame.event,JSON.parse(frame.data));
              onData(tree);retry=0;onStatus('live');
            }
          }
        }
        if(!signal.aborted)throw fail('Live sync disconnected.','network');
      } catch(error) {
        if(signal.aborted)return;
        if(error.code==='permission'||error.code==='auth'){onStatus('denied',error);return;}
        onStatus('reconnecting',error);
      } finally { if(reader)try{await reader.cancel();}catch{} }
      await delay(Math.min(30000,1000*2**Math.min(retry++,5)),signal).catch(()=>{});
    }
  }
}
