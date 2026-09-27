// Plan-view rays off the main thread: the page posts its ground grids once each ('grid'), then ray requests
// ('rays': origin, event keys, epoch, limb). Each ray's azimuth is posted back as soon as it is found; a newer
// request replaces the one in progress. Same searches as the page's Alignment check (align_core.js).
// Imports carry the page's build (?v=) so a cached old copy is never mixed with new code.
const V = new URL(self.location.href).searchParams.get('v') || '';
const q = V ? '?v=' + encodeURIComponent(V) : '';
let FS = null, CORE = null;
const early = [];
self.onmessage = (ev) => { if (CORE) handle(ev.data); else early.push(ev.data); };
Promise.all([import('./flyover_sky.js' + q), import('./align_core.js' + q)]).then(([fs, core]) => {
  FS = fs; CORE = core;
  for (const m of early.splice(0)) handle(m);
}).catch((e) => self.postMessage({ type: 'error', message: String(e && e.message || e) }));

const grids = {};
const ORDER = ['near', 'detail', 'coarse', 'far'];
function sampleGrid(g, x, z) {
  const fx = (x - g.x0) / g.dx, fz = (z - g.z0) / g.dz;
  if (!(fx >= 0 && fz >= 0 && fx <= g.nx - 1 && fz <= g.ny - 1)) return null;
  const i = Math.min(g.nx - 2, Math.floor(fx)), j = Math.min(g.ny - 2, Math.floor(fz));
  const u = fx - i, v = fz - j, a = j * g.nx + i, H = g.h;
  if (u + v <= 1) return H[a] + u * (H[a + 1] - H[a]) + v * (H[a + g.nx] - H[a]);
  const h11 = H[a + g.nx + 1];
  return h11 + (1 - u) * (H[a + g.nx] - h11) + (1 - v) * (H[a + 1] - h11);
}
function heightAt(x, z) {
  let h;
  for (const k of ORDER) if (grids[k] && (h = sampleGrid(grids[k], x, z)) != null) return h;
  return null;
}
// Skylines kept per eye point until finer ground arrives (same rule as the page).
let skyVer = 0; const skies = new Map();
function skyline(x, z, eye, conv) {
  const key = x.toFixed(2) + ',' + z.toFixed(2) + ',' + eye.toFixed(2);
  let s = skies.get(key);
  if (!s) { s = FS.lazySkylineAt(heightAt, x, z, eye, conv); skies.set(key, s); if (skies.size > 32) skies.delete(skies.keys().next().value); }
  return s;
}
let aligner = null, hz = null;
function ensure() { if (!aligner) aligner = CORE.makeAligner({ FS, heightAt, skyline, hz }); return aligner; }

let current = 0;
const yieldNow = () => new Promise((r) => setTimeout(r, 0));
async function run(req) {
  const A = ensure();
  for (const k of req.keys) {
    await yieldNow(); // lets a newer request (or ground) arrive between rays
    if (req.id !== current) return;
    const t0 = performance.now();
    let r;
    try { r = A.rayAzimuth(req.x, req.z, k, req.year, req.limb); } catch (e) { r = { error: String(e && e.message || e) }; }
    if (req.id !== current) return;
    self.postMessage({ type: 'ray', id: req.id, k, r, ms: performance.now() - t0, stats: A.stats });
  }
  if (req.id === current) self.postMessage({ type: 'raysDone', id: req.id });
}
function handle(m) {
  if (m.type === 'hz') { hz = m.hz; aligner = null; return; }
  if (m.type === 'grid') {
    grids[m.name] = m.g; skies.clear(); skyVer++;
    if (aligner) aligner.resetRayCache();
    return;
  }
  if (m.type === 'rays') { current = m.id; run(m); }
};
