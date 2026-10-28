export function filterFeatures(features,{hidden=new Set(),search=''}={}) {
  const query=search.trim().toLocaleLowerCase();
  return features.filter(feature=>!hidden.has(feature.layerID)&&(!query||[feature.name,feature.note,feature.unitID,feature.mineSite,feature.layerName].some(value=>String(value||'').toLocaleLowerCase().includes(query))));
}
