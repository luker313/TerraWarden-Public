const keyName='tw.portal.apiKey';
export function readAPIKey(){
  try{const key=JSON.parse(localStorage.getItem(keyName));return typeof key==='string'?key:'';}catch{return '';}
}
export function saveAPIKey(input){
  const key=input.trim();
  if(!/^[A-Za-z0-9_-]{20,200}$/.test(key))throw new Error('Paste a Firebase API key, with no spaces or JSON.');
  try{localStorage.setItem(keyName,JSON.stringify(key));}catch{throw new Error('This browser blocked saving the key. Allow site storage and try again.');}
  return key;
}
export function removeAPIKey(){
  try{localStorage.removeItem(keyName);}catch{throw new Error('This browser could not remove the saved key. Clear this site’s data in browser settings.');}
}
