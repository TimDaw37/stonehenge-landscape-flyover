// Parse OSM XML (River Till ways) and convert lat/lon to OSGB E/N by inverting osgbToWgs84 numerically.
import fs from 'fs';
import { osgbToWgs84 } from '../vendor/osgb_wgs84.js';
function toOsgb(lat, lon) {
  let e = 412000, n = 142000;
  for (let k = 0; k < 8; k++) {
    const p = osgbToWgs84(e, n), pe = osgbToWgs84(e + 10, n), pn = osgbToWgs84(e, n + 10);
    const a = (pe.lat - p.lat) / 10, b = (pn.lat - p.lat) / 10, c = (pe.lon - p.lon) / 10, d = (pn.lon - p.lon) / 10;
    const r1 = lat - p.lat, r2 = lon - p.lon, det = a * d - b * c;
    e += (d * r1 - b * r2) / det; n += (-c * r1 + a * r2) / det;
  }
  return [+e.toFixed(2), +n.toFixed(2)];
}
const xml = fs.readFileSync(process.argv[2], 'utf8');
const nodes = new Map();
for (const m of xml.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)" lon="([-\d.]+)"/g)) nodes.set(m[1], [+m[2], +m[3]]);
const ways = [];
for (const m of xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
  const body = m[2];
  if (!/k="name" v="River Till"/.test(body)) continue;
  const ww = (body.match(/k="waterway" v="([^"]+)"/) || [])[1];
  if (!ww) continue;
  const refs = [...body.matchAll(/<nd ref="(\d+)"/g)].map(x => x[1]);
  ways.push({ id: m[1], waterway: ww, pts: refs.map(r => nodes.get(r)).filter(Boolean).map(([la, lo]) => toOsgb(la, lo)) });
}
const extra = JSON.parse(process.argv[3] || '[]').map(([name, la, lo]) => ({ name, en: toOsgb(la, lo) }));
fs.writeFileSync(process.argv[4], JSON.stringify({ ways, points: extra }));
console.log(ways.length, 'ways', ways.map(w => w.waterway + ':' + w.pts.length).join(' '), extra);
