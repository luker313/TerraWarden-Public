export const palette = ['#547c44', '#bd8055', '#6b8ea1', '#a186b4', '#b4a047', '#668e82'];
export const validCoordinate = (p) => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;
export const swiftDate = (seconds) => Number.isFinite(seconds) ? new Date((seconds + 978307200) * 1000) : null;
export const normalizeLongitude = (n) => ((n + 180) % 360 + 360) % 360 - 180;
const unwrap = (lon, origin) => origin + normalizeLongitude(lon - origin);
export function inviteCode(input) {
  let raw = input.trim();
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    const url = new URL(raw);
    const query = url.searchParams.get('code');
    raw = query || url.pathname.split('/').filter(Boolean).at(-1) || '';
  }
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/.test(code)) throw new Error('Enter a valid 12-character TerraWarden invitation code.');
  return code;
}
function safeSegments(path) {
  const parts = path.split('/').filter(Boolean);
  if (parts.some(p => ['__proto__', 'constructor', 'prototype'].includes(p))) throw new Error('Invalid data path.');
  return parts;
}
function replace(old, parts, value) {
  if (!parts.length) return value;
  const [key, ...tail] = parts;
  const copy = { ...(old && typeof old === 'object' ? old : {}) };
  const next = replace(copy[key], tail, value);
  if (next == null) delete copy[key]; else copy[key] = next;
  return Object.keys(copy).length ? copy : null;
}
export function reduceEvent(old, event, frame) {
  if (!frame || typeof frame.path !== 'string' || !frame.path.startsWith('/') || !Object.hasOwn(frame, 'data')) throw new Error('Invalid sync event.');
  const parts = safeSegments(frame.path);
  if (event === 'put') return replace(old, parts, frame.data);
  if (event !== 'patch' || !frame.data || typeof frame.data !== 'object' || Array.isArray(frame.data)) throw new Error('Invalid sync event.');
  return Object.entries(frame.data).reduce((tree, [key, value]) => replace(tree, [...parts, ...safeSegments(key)], value), old);
}
export class SSEParser {
  buffer = ''; event = 'message'; data = []; size = 0; previousCR = false;
  push(text) {
    const frames = [];
    for (const char of text) {
      if (char === '\n' && this.previousCR) { this.previousCR = false; continue; }
      this.previousCR = char === '\r';
      if (char !== '\n' && char !== '\r') {
        this.buffer += char;
        if (++this.size > 32 * 1024 * 1024) throw new Error('Sync event is too large.');
        continue;
      }
      const line = this.buffer; this.buffer = '';
      if (!line) {
        if (this.data.length) frames.push({ event: this.event, data: this.data.join('\n') });
        this.event = 'message'; this.data = []; this.size = 0;
      } else if (!line.startsWith(':')) {
        const i = line.indexOf(':');
        const key = i < 0 ? line : line.slice(0, i);
        let value = i < 0 ? '' : line.slice(i + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (key === 'event') this.event = value;
        if (key === 'data') this.data.push(value);
      }
    }
    return frames;
  }
}
function solve(matrix, values) {
  const rows = matrix.map((r, i) => [...r, values[i]]), n = values.length;
  for (let i = 0; i < n; i++) {
    let best = i;
    for (let j = i + 1; j < n; j++) if (Math.abs(rows[j][i]) > Math.abs(rows[best][i])) best = j;
    [rows[i], rows[best]] = [rows[best], rows[i]];
    if (Math.abs(rows[i][i]) < 1e-12) throw new Error('Choose reference points spread across the map, away from a single straight line.');
    const d = rows[i][i];
    for (let k = i; k <= n; k++) rows[i][k] /= d;
    for (let j = 0; j < n; j++) if (j !== i) {
      const f = rows[j][i];
      for (let k = i; k <= n; k++) rows[j][k] -= f * rows[i][k];
    }
  }
  return rows.map(r => r[n]);
}
function leastSquares(rows, values) {
  const size = rows[0].length;
  return solve(Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0))), Array.from({ length: size }, (_, i) => rows.reduce((s, r, j) => s + r[i] * values[j], 0)));
}
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
export function makeModel(anchors, box, bilinear = false, footprint = null) {
  if (!Array.isArray(anchors) || anchors.length < (bilinear ? 4 : 3) || anchors.length > 100) throw new Error('At least three reference points are needed.');
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) || box[2] <= box[0] || box[3] <= box[1]) throw new Error('Invalid PDF map bounds.');
  if (!anchors.every(p => validCoordinate(p) && Number.isFinite(p.x) && Number.isFinite(p.y))) throw new Error('A reference point has invalid coordinates.');
  const origin = anchors[0];
  const normalized = anchors.map(p => [(p.x - box[0]) / (box[2] - box[0]), (p.y - box[1]) / (box[3] - box[1])]);
  const rows = normalized.map(([x, y]) => bilinear ? [1, x, y, x * y] : [1, x, y]);
  const lon = leastSquares(rows, anchors.map(p => unwrap(p.longitude, origin.longitude) - origin.longitude));
  const lat = leastSquares(rows, anchors.map(p => p.latitude - origin.latitude));
  if (!bilinear) { lon.push(0); lat.push(0); }
  const latAt = (x, y) => origin.latitude + dot(lat, [1, x, y, x * y]);
  const lonAt = (x, y) => origin.longitude + dot(lon, [1, x, y, x * y]);
  const rmsMetres = Math.sqrt(anchors.reduce((sum, p, i) => {
    const [x, y] = normalized[i];
    return sum + ((latAt(x, y) - p.latitude) * 111320) ** 2 + ((lonAt(x, y) - unwrap(p.longitude, origin.longitude)) * 111320 * Math.cos(p.latitude * Math.PI / 180)) ** 2;
  }, 0) / anchors.length);
  return {
    anchors, box, bilinear, footprint, rmsMetres,
    toGeo(px, py) {
      const x = (px - box[0]) / (box[2] - box[0]), y = (py - box[1]) / (box[3] - box[1]);
      return { latitude: latAt(x, y), longitude: normalizeLongitude(lonAt(x, y)) };
    },
    toPDF(latitude, longitude) {
      if (!validCoordinate({ latitude, longitude })) return null;
      const targetLon = unwrap(longitude, origin.longitude);
      let x = .5, y = .5;
      for (let i = 0; i < 25; i++) {
        const dx = lonAt(x, y) - targetLon, dy = latAt(x, y) - latitude;
        if (Math.hypot(dx, dy) < 1e-10) break;
        const a = lon[1] + lon[3] * y, b = lon[2] + lon[3] * x, c = lat[1] + lat[3] * y, d = lat[2] + lat[3] * x;
        const det = a * d - b * c;
        if (Math.abs(det) < 1e-16) return null;
        x -= (d * dx - b * dy) / det; y -= (a * dy - c * dx) / det;
        if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) return null;
      }
      if (Math.hypot(lonAt(x, y) - targetLon, latAt(x, y) - latitude) > 1e-7) return null;
      return [box[0] + x * (box[2] - box[0]), box[1] + y * (box[3] - box[1])];
    }
  };
}
export function inPolygon(point, polygon) {
  if (!polygon?.length) return true;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x, y] = point, [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-7 && x >= Math.min(xi,xj)-1e-7 && x <= Math.max(xi,xj)+1e-7 && y >= Math.min(yi,yj)-1e-7 && y <= Math.max(yi,yj)+1e-7) return true;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function decodeGroup(group) {
  if (!group || group.isDeleted !== false) return [];
  const removals = group.privacyRemovals || {};
  const records = Object.entries(group.items || {});
  const layers = records.filter(([id, v]) => v?.kind === 'layer' && v.isDeleted === false && typeof v.layerID === 'string' && id === `layer-${v.layerID}` && !removals.layers?.[v.layerID] && !removals.items?.[id]).map(([, v], i) => ({ id: v.layerID, name: String(v.name || 'Untitled layer'), color: palette[i % palette.length], pins: [], routes: [] }));
  const byID = new Map(layers.map(l => [l.id, l]));
  for (const [id, v] of records) {
    if (v?.kind !== 'pin' || v.isDeleted !== false || !validCoordinate(v.pin) || removals.items?.[id] || !byID.has(v.layerID) || id !== `pin-${v.layerID}-${v.pin.id}`) continue;
    byID.get(v.layerID).pins.push({ ...v.pin, id, type: 'pin', layerID: v.layerID, name: String(v.pin.name || v.name || 'Unnamed pin') });
  }
  return layers.sort((a,b) => a.name.localeCompare(b.name));
}
export function decodeRoute(chunks, manifest, id) {
  if (manifest?.schemaVersion !== 1 || manifest.routeID !== id || manifest.isDeleted !== false || typeof manifest.revision !== 'string' || /[.#$\[\]/]/.test(manifest.revision) || !Number.isInteger(manifest.chunkCount) || manifest.chunkCount < 1 || manifest.chunkCount > 10000 || !Number.isInteger(manifest.pointCount) || manifest.pointCount < 2 || manifest.pointCount > 5000000 || manifest.lastChunk !== `c${String(manifest.chunkCount-1).padStart(6,'0')}` || manifest.metadata?.documentGeometry) throw new Error('Unsupported or invalid shared route.');
  if (!chunks || Object.keys(chunks).length !== manifest.chunkCount) throw new Error('Route geometry is incomplete.');
  const segments = [], seen = new Set(); let count = 0;
  for (let i=0; i<manifest.chunkCount; i++) {
    const c = chunks[`c${String(i).padStart(6,'0')}`];
    if (c?.schemaVersion !== 1 || c.routeID !== id || c.layerID !== manifest.layerID || c.revision !== manifest.revision || c.index !== i || !Number.isInteger(c.count) || c.count < 1 || c.count > 512 || (i < manifest.chunkCount-1 && c.count !== 512) || Object.keys(c.points || {}).length !== c.count) throw new Error('Invalid route chunk.');
    for (let j=0; j<c.count; j++) {
      const sample = c.points[`p${String(j).padStart(4,'0')}`];
      if (!validCoordinate(sample?.point) || typeof sample.segmentID !== 'string') throw new Error('Invalid route coordinate.');
      if (segments.at(-1)?.id !== sample.segmentID) {
        if (seen.has(sample.segmentID)) throw new Error('Invalid route segment order.');
        seen.add(sample.segmentID); segments.push({ id: sample.segmentID, points: [] });
      }
      segments.at(-1).points.push(sample.point); count++;
    }
  }
  if (count !== manifest.pointCount) throw new Error('Route point count does not match.');
  return { ...manifest.metadata, id, layerID:manifest.layerID, type:manifest.metadata?.geometryKind === 'drawnLine' ? 'line' : 'route', segments, revision:manifest.revision, name:String(manifest.metadata?.name || 'Unnamed route') };
}
