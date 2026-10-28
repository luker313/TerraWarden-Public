const keyName='tw.portal.apiKey';
export function readAPIKey(){
  try{const key=JSON.parse(localStorage.getItem(keyName));return typeof key==='string'?key:'';}catch{return '';}
}
export function saveAPIKey(input){
  const key=input.trim();
  if(!/^[A-Za-z0-9_-]{20,200}$/.test(key))throw new Error('Paste a Firebase API key, with no spaces or JSON.');
  try{localStorage.setItem(keyName,JSON.stringify(key));if(localStorage.getItem(keyName)!==JSON.stringify(key))throw new Error('Storage verification failed.');}catch{throw new Error('This browser blocked saving the key. Allow site storage and try again.');}
  return key;
}
export function removeAPIKey(){
  try{localStorage.removeItem(keyName);}catch{throw new Error('This browser could not remove the saved key. Clear this site’s data in browser settings.');}
}
export function readTheme(){try{const value=JSON.parse(localStorage.getItem('tw.portal.theme'));return ['light','dark'].includes(value)?value:null;}catch{return null;}}
export function saveTheme(value){if(!['light','dark'].includes(value))throw new Error('Invalid theme.');localStorage.setItem('tw.portal.theme',JSON.stringify(value));}
export function readLabelAngle(){try{const value=JSON.parse(localStorage.getItem('tw.portal.labelAngle'));return typeof value==='number'&&Number.isFinite(value)?Math.max(-180,Math.min(180,value)):0;}catch{return 0;}}
export function saveLabelAngle(value){if(!Number.isFinite(value)||value < -180||value>180)throw new Error('Invalid label angle.');localStorage.setItem('tw.portal.labelAngle',JSON.stringify(value));}

// This is a best-effort request, not a guarantee against cleared site data.
export async function requestPersistentStorage(storage=globalThis.navigator?.storage){
  try{return storage?.persist ? await storage.persist() : false;}catch{return false;}
}
