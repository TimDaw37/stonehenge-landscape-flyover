// The flyover page (landscape_v2.html; index.html in the public repo): free flight over the Stonehenge, Woodhenge and Bulford landscape.
import * as THREE from 'three';
import * as FS from './flyover_sky.js?v=2026-09-28.1845-local';
// Same URL as the import in flyover_sky.js (no ?v=), so both share one module instance.
import * as Sky from '../../skyscape_sky.js';
import { makeAligner, ALIGN_EVENTS, dateLabel, utLabel, REACH_MIN } from './align_core.js?v=2026-09-28.1845-local';
const { starHorizontal, starsAbove } = FS; // stars from flyover_sky (dates right for years 0-99)

// ---------------------------------------------------------------- basics
const FLY = window.__fly = { marks: {}, detailDone: false, bytes: {} };
// Build stamp: the page's <meta name="flyover-build"> must match, or the browser is running cached old code.
const BUILD = '2026-09-28.1845-local';
FLY.build = BUILD;
{
  const want = document.querySelector('meta[name="flyover-build"]');
  if (want && want.content !== BUILD) {
    const w = document.createElement('div');
    w.textContent = 'This page and its code are out of step (cached old files). Press Ctrl+F5 to reload.';
    w.style.cssText = 'position:fixed;left:50%;top:44px;transform:translateX(-50%);z-index:9;background:#8a2f18;color:#fff;padding:6px 12px;border-radius:6px;font:13px system-ui';
    document.body.appendChild(w);
  }
  const b = document.getElementById('buildStamp'); if (b) b.textContent = 'build ' + BUILD;
}
const mark = (k) => { if (FLY.marks[k] == null) FLY.marks[k] = Math.round(performance.now()); };
FLY.slow = [];
function timed(name, fn) { const t = performance.now(); const r = fn(); const d = performance.now() - t; if (d > 25) FLY.slow.push([name, Math.round(t), Math.round(d)]); return r; }
const CE = 412245.35, CN = 142194.11, ORIGIN_OD = 102.588;
const DEG = Math.PI / 180;
const P = window.WOODHENGE_POSTS;
const BU = window.BULFORD_FEATURES || window.BULFORD; // all 39 bulford-posts-3d features (data/flyover/bulford_features.js)
const HZ = window.WOODHENGE_HORIZON;
function localXZ(e, n) { return { x: e - CE, z: -(n - CN) }; }
// Flight limits: the 40 x 36 km far ground (far.bin, E 396000-436000, N 126000-162000) plus a 3 km margin,
// and up to 30 km above sea level, high enough to see the whole ground at once.
const BOUNDS = { x0: 396000 - 412245.35 - 3000, x1: 436000 - 412245.35 + 3000, z0: -(162000 - 142194.11) - 3000, z1: -(126000 - 142194.11) + 3000 };
const MAX_H = 30000;
const isTouch = ('ontouchstart' in window) || matchMedia('(pointer: coarse)').matches;
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');
if (isTouch) document.body.classList.add('touch');

// Logarithmic depth (code review): no artefacts found in side-by-side views (sun and moon at the skyline, river,
// posts, far ground), and it keeps the 20 km far ground from flickering against the wide ground. ?logdepth=0 turns it off.
const LOGDEPTH = new URLSearchParams(location.search).get('logdepth') !== '0';
// Renderer start-up, hardened (2026-09-28): some Chrome set-ups refuse a context with the preferred attributes
// (antialias, logarithmic depth, high-performance GPU) but give one without them, so try a ladder of settings and
// stop at the first that works. Each attempt gets its own canvas so the browser's webglcontextcreationerror
// statusMessage (the real reason, e.g. 'GPU process was unable to boot' or 'blocklisted') can be caught.
const glErrors = []; // { attempt, message, status }
// ---- Graphics quality. Low: no antialias, no shadows, pixel ratio 1, no logarithmic depth (a larger near plane
// instead), coarser ground sooner. Chosen by ?quality=low|high, else a saved choice ('Use full graphics'), else
// automatically after a lost GPU context this session, or for software / integrated GPUs and 'major performance
// caveat' contexts (Chrome's own flag for slow or emulated WebGL).
const QS = new URLSearchParams(location.search);
const GL_LOSS_KEY = 'flyover-gl-losses', Q_KEY = 'flyover-quality';
const ssGet = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };
let glLosses = +(ssGet(GL_LOSS_KEY) || 0);
const SOFT_GPU = /SwiftShader|Basic Render|llvmpipe|softpipe|Software/i;
const WEAK_GPU = /Intel.*(HD|UHD|Iris)|Radeon.*Vega \d+ Graphics|Radeon\(TM\) Graphics|AMD Radeon Graphics|Radeon R[2-7] Graphics/i;
// One small throwaway context: the GPU name and whether Chrome flags a major performance caveat.
function quickProbe() {
  const r = { renderer: '', caveat: false, any: false };
  const tryCtx = (attrs) => { const c = document.createElement('canvas'); c.width = c.height = 1; let gl = null; try { gl = c.getContext('webgl2', attrs) || c.getContext('webgl', attrs); } catch (e) {} return gl; };
  let gl = tryCtx({ failIfMajorPerformanceCaveat: true });
  if (!gl) { gl = tryCtx({}); if (gl) r.caveat = true; }
  if (!gl) return r;
  r.any = true;
  try { const d = gl.getExtension('WEBGL_debug_renderer_info'); r.renderer = String(gl.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : gl.RENDERER)); } catch (e) {}
  const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
  return r;
}
function pickQuality() {
  const q = QS.get('quality');
  if (q === 'low' || q === 'high') return { q, why: 'URL ?quality=' + q };
  if (glLosses >= 1) return { q: 'low', why: 'the 3D view was interrupted earlier in this session' };
  if (lsGet(Q_KEY) === 'high') return { q: 'high', why: 'your choice (Use full graphics)' };
  const p = quickProbe();
  FLY.gpu = p.renderer;
  if (p.caveat) return { q: 'low', why: 'the browser reports slow or emulated WebGL' };
  if (SOFT_GPU.test(p.renderer)) return { q: 'low', why: 'software graphics (' + p.renderer + ')' };
  if (!isTouch && WEAK_GPU.test(p.renderer)) return { q: 'low', why: 'integrated graphics (' + p.renderer + ')' };
  return { q: 'high', why: 'default' };
}
// ?retry=1 (the 'Try again' button) starts even after repeated losses.
const CRASH_LOOP = glLosses >= 2 && QS.get('retry') !== '1';
const QUALITY = CRASH_LOOP ? { q: 'low', why: 'repeated interruptions' } : pickQuality();
let LOWQ = QUALITY.q === 'low';
FLY.quality = QUALITY.q; FLY.qualityWhy = QUALITY.why;
const PR_CAP = () => LOWQ ? 1 : (isTouch ? 1.5 : 2);
function makeRenderer() {
  const AA = !LOWQ, LD = LOGDEPTH && !LOWQ;
  const ladder = [
    { name: 'a: preferred', opts: { antialias: AA, logarithmicDepthBuffer: LD } },
    { name: 'b: antialias off', opts: { antialias: false, logarithmicDepthBuffer: LD } },
    { name: 'c: default GPU, allow slow GPU', opts: { antialias: false, logarithmicDepthBuffer: LD, powerPreference: 'default', failIfMajorPerformanceCaveat: false } },
    { name: 'd: logarithmic depth off', opts: { antialias: false, logarithmicDepthBuffer: false, powerPreference: 'default', failIfMajorPerformanceCaveat: false } },
    { name: 'e: low-power GPU', opts: { antialias: false, logarithmicDepthBuffer: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: false } },
  ];
  for (let i = 0; i < ladder.length; i++) {
    const L = ladder[i], canvas = document.createElement('canvas');
    let status = '';
    canvas.addEventListener('webglcontextcreationerror', (e) => { if (e.statusMessage) status = e.statusMessage; }, false);
    try {
      const r = new THREE.WebGLRenderer({ ...L.opts, canvas });
      FLY.rendererAttempt = L.name; FLY.logDepthOn = !!L.opts.logarithmicDepthBuffer;
      if (i > 0) console.warn('WebGL renderer started on fallback attempt ' + L.name + ' after ' + i + ' failed attempt(s).');
      else console.info('WebGL renderer started (attempt ' + L.name + ').');
      return r;
    } catch (err) {
      glErrors.push({ attempt: L.name, message: String(err && err.message || err), status });
    }
  }
  return null;
}
// What the browser offers, checked on a spare canvas after a failure (and released again).
function probeWebGL() {
  const out = { webgl2: false, webgl1: false, renderer: '', vendor: '', status: [] };
  for (const kind of ['webgl2', 'webgl', 'experimental-webgl']) {
    const c = document.createElement('canvas');
    c.addEventListener('webglcontextcreationerror', (e) => { if (e.statusMessage) out.status.push(kind + ': ' + e.statusMessage); }, false);
    let gl = null;
    try { gl = c.getContext(kind); } catch (e) { out.status.push(kind + ' threw: ' + e.message); }
    if (!gl) continue;
    if (kind === 'webgl2') out.webgl2 = true; else out.webgl1 = true;
    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg && !out.renderer) { out.renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)); out.vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)); }
      else if (!out.renderer) out.renderer = String(gl.getParameter(gl.RENDERER));
    } catch (e) {}
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    if (kind === 'webgl') break; // experimental-webgl adds nothing once webgl works
  }
  return out;
}
// No renderer at all: a specific, accessible message with what to try, and the captured errors in a disclosure.
function showNoWebGL(probe) {
  document.body.classList.add('no-webgl');
  const l = document.getElementById('load'); if (l) l.textContent = 'No 3D graphics (WebGL)';
  const box = document.createElement('div');
  box.id = 'glFail'; box.setAttribute('role', 'alert');
  const some = probe.webgl1 || probe.webgl2;
  const crashed = [...glErrors.map((e) => e.status), ...probe.status].some((t) => /crash|unable to boot|blocked|GPU process/i.test(t || ''));
  const head = crashed ? 'The browser has switched off 3D graphics (WebGL), most likely after its graphics process crashed.'
    : !some ? 'This flyover needs WebGL (3D graphics), and this browser has it switched off or blocked.'
    : !probe.webgl2 ? 'This browser offers only the older WebGL 1, and the flyover could not start its 3D view with it.'
    : 'The browser offers WebGL, but it refused every set of settings the flyover tried.';
  const isChrome = /Chrome\//.test(navigator.userAgent) && !/Edg\//.test(navigator.userAgent);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const details = [
    'Page build: ' + BUILD,
    'Browser: ' + navigator.userAgent,
    'WebGL 2: ' + (probe.webgl2 ? 'available' : 'not available') + ' · WebGL 1: ' + (probe.webgl1 ? 'available' : 'not available'),
    'Graphics: ' + (probe.renderer ? probe.renderer + (probe.vendor ? ' (' + probe.vendor + ')' : '') : 'unknown'),
    ...glErrors.map((e) => 'Attempt ' + e.attempt + ': ' + e.message + (e.status ? ' [browser: ' + e.status + ']' : '')),
    ...probe.status.map((t) => 'Probe ' + t),
  ].join('\n');
  box.innerHTML =
    '<h2>3D view could not start</h2>' +
    '<p>' + esc(head) + '</p>' +
    '<p>Things to try:</p><ol>' +
    '<li>' + (isChrome ? 'In Chrome' : 'In Chrome or Edge') + ', open <b>Settings → System</b>, turn on <b>Use graphics acceleration when available</b>, then press <b>Relaunch</b>.</li>' +
    '<li>Check what the browser reports: type <code id="glGpuUrl">chrome://gpu</code> into the address bar (links to it cannot be clicked from a web page) <button type="button" id="glCopy">Copy</button>. Look for “WebGL: Hardware accelerated”. In Edge the page is <code>edge://gpu</code>.</li>' +
    '<li>If <code>chrome://gpu</code> says the GPU process crashed or was unable to boot, <b>fully quit Chrome</b>: close every window, and quit it from the Chrome icon in the system tray (by the clock) if it is there, then start it again.</li>' +
    '<li>Update the graphics driver (for AMD Radeon: AMD Software: Adrenalin Edition from amd.com; Intel or NVIDIA from their sites; or Windows Update), then restart the computer.</li>' +
    '<li>Or open this page in another browser, such as Microsoft Edge or Firefox.</li>' +
    '</ol>' +
    '<details><summary>Technical details</summary><pre id="glDetails">' + esc(details) + '</pre></details>' +
    '<p><button type="button" id="glReload">Try again (lower quality)</button></p>';
  document.body.appendChild(box);
  const copy = document.getElementById('glCopy');
  copy.onclick = () => {
    const done = () => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText('chrome://gpu').then(done, () => selectCode());
    else selectCode();
  };
  const selectCode = () => { const r = document.createRange(); r.selectNodeContents(document.getElementById('glGpuUrl')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); copy.textContent = 'Selected: press Ctrl+C'; };
  document.getElementById('glReload').onclick = () => { const u = new URL(location.href); u.searchParams.set('quality', 'low'); location.href = u.href; };
}
// Shared panel for 'the graphics keep failing' (start-up after repeated losses, or a loss mid-session).
function showGlPanel(title, text, opts = {}) {
  let box = document.getElementById('glFail');
  if (!box) { box = document.createElement('div'); box.id = 'glFail'; box.setAttribute('role', 'alert'); document.body.appendChild(box); }
  box.innerHTML = '';
  const h = document.createElement('h2'); h.textContent = title; box.appendChild(h);
  for (const t of [].concat(text)) { const p = document.createElement('p'); p.textContent = t; box.appendChild(p); }
  if (opts.advice) {
    const ol = document.createElement('ol');
    for (const t of ['Fully quit Chrome (every window, and the Chrome icon in the system tray by the clock), then start it again.',
      'Update the graphics driver (for AMD Radeon: AMD Software: Adrenalin Edition from amd.com), then restart the computer.',
      'Or open this page in Microsoft Edge or Firefox.']) { const li = document.createElement('li'); li.textContent = t; ol.appendChild(li); }
    box.appendChild(ol);
  }
  const p = document.createElement('p');
  const b = document.createElement('button'); b.type = 'button'; b.id = 'glRetry'; b.textContent = 'Try again (lower quality)';
  b.onclick = () => { const u = new URL(location.href); u.searchParams.set('quality', 'low'); if (glLosses >= 2) u.searchParams.set('retry', '1'); location.href = u.href; };
  p.appendChild(b); box.appendChild(p);
  return box;
}
function hideGlPanel() { const b = document.getElementById('glFail'); if (b) b.remove(); }
if (CRASH_LOOP) {
  document.body.classList.add('no-webgl');
  const l = document.getElementById('load'); if (l) l.textContent = '3D view paused';
  showGlPanel('3D view stopped', ['The graphics system has stopped the 3D view ' + glLosses + ' times in this tab, so it has not been started again automatically, to avoid crashing the browser\u2019s graphics.'], { advice: true });
  console.warn('Flyover not started: ' + glLosses + ' WebGL context losses this session (use Try again, or ?retry=1).');
  throw new Error('Flyover not started after repeated WebGL context losses');
}
let renderer = makeRenderer();
if (!renderer) {
  const probe = probeWebGL();
  FLY.glFail = { errors: glErrors, probe };
  console.error('WebGL renderer could not be created. ' + glErrors.map((e) => '[' + e.attempt + '] ' + e.message + (e.status ? ' (statusMessage: ' + e.status + ')' : '')).join(' ') +
    ' | Probe: webgl2=' + probe.webgl2 + ' webgl1=' + probe.webgl1 + ' renderer=' + (probe.renderer || 'unknown') + (probe.status.length ? ' creation errors: ' + probe.status.join('; ') : ''));
  showNoWebGL(probe);
  throw new Error('No WebGL renderer: ' + (glErrors[0] ? glErrors[0].message : 'unknown'));
}
// The GPU can be reset under the page (driver crash or update, sleep, too many tabs). Stop drawing, count it for
// this session (sessionStorage), and say so with a 'Try again (lower quality)' button. If the browser gives the
// context back after a first loss, carry on in low quality; after a second, stay stopped (no crash loops).
let glDown = false;
{
  const cv = renderer.domElement;
  cv.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    glDown = true; glLosses++; ssSet(GL_LOSS_KEY, String(glLosses)); FLY.contextLost = glLosses;
    console.warn('WebGL context lost (' + glLosses + ' this session); rendering stopped.');
    showGlPanel('3D view interrupted', glLosses >= 2
      ? ['The graphics system has stopped the 3D view again. It will not restart by itself, to avoid crashing the browser\u2019s graphics.']
      : ['The graphics system stopped the 3D view (the graphics processor was reset). Waiting for the browser to restore it\u2026'], { advice: glLosses >= 2 });
  }, false);
  cv.addEventListener('webglcontextrestored', () => {
    console.info('WebGL context restored (' + glLosses + ' loss(es) this session).');
    if (glLosses >= 2) return; // stay stopped; the panel offers a reload in low quality
    setLowQuality(true, 'the 3D view was interrupted');
    hideGlPanel(); glDown = false;
  }, false);
}
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, PR_CAP()));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = !LOWQ;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('c').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x071018);
const cam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 260000);
cam.rotation.order = 'YXZ';

const hemi = new THREE.HemisphereLight(0xc9d4e8, 0x3d4a3a, 0.55);
scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xffe2a8, 1.35);
sunLight.castShadow = !LOWQ;
sunLight.shadow.mapSize.set(LOWQ ? 1024 : 2048, LOWQ ? 1024 : 2048);
// The light sits 1000 m from the focus, so a 500-1500 m depth range is enough. The old 10-2400 m range with
// bias -0.0004 shifted every shadow about 1 m away from its object (much more on the ground with a low sun),
// so stones and posts looked as if they floated. Small depth bias plus a little normal bias keeps them touching.
Object.assign(sunLight.shadow.camera, { near: 500, far: 1500, left: -160, right: 160, top: 160, bottom: -160 });
sunLight.shadow.bias = -0.00003;
sunLight.shadow.normalBias = 0.04;
scene.add(sunLight);
scene.add(sunLight.target);

// ---------------------------------------------------------------- sky dome (follows the camera)
const SKY_R = 150000, DISC_D = 100000, STAR_R = 120000;
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(SKY_R, 48, 32),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, toneMapped: false,
    uniforms: { sunAlt: { value: 20 }, sunDir: { value: new THREE.Vector3(0, 0.3, -1) }, eyePos: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 vWorld;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vWorld; uniform float sunAlt; uniform vec3 sunDir; uniform vec3 eyePos;
      void main(){
        vec3 dir = normalize(vWorld - eyePos);
        float alt = degrees(asin(clamp(dir.y,-1.0,1.0)));
        float day = smoothstep(2.0,16.0,sunAlt);
        float dawn = smoothstep(-3.5,0.8,sunAlt) * (1.0 - smoothstep(3.0,9.0,sunAlt));
        vec3 zenith = mix(vec3(0.012,0.016,0.04), vec3(0.13,0.32,0.58), day);
        vec3 horiz = mix(vec3(0.025,0.032,0.06), vec3(0.40,0.52,0.64), day);
        horiz = mix(horiz, vec3(0.32,0.14,0.08), dawn*0.7);
        float h = smoothstep(22.0,-1.0,alt);
        vec3 col = mix(zenith, horiz, h);
        float glow = pow(max(dot(dir, normalize(sunDir)),0.0),48.0) * smoothstep(-2.0,1.5,sunAlt);
        col += vec3(1.0,0.72,0.38) * glow * 0.35;
        gl_FragColor = vec4(col,1.0);
      }`,
  })
);
skyDome.frustumCulled = false;
skyDome.renderOrder = -2;
scene.add(skyDome);

// Stars: directions from flyover_sky.starsAbove (Stonehenge observer, x east, z minus TRUE north).
// The points turn by the grid convergence so they sit in the grid frame, and follow the camera.
let starsOn = true, starKey = '';
const starGeo = new THREE.BufferGeometry();
const starMat = new THREE.ShaderMaterial({
  uniforms: { sunAlt: { value: -10 } },
  vertexShader: `attribute float mag; varying float vMag;
    void main(){ vMag = mag; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(7.0 - mag, 1.6, 8.0); }`,
  fragmentShader: `varying float vMag; uniform float sunAlt;
    void main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard;
      float a = smoothstep(0.5,0.12,r); float night = 1.0 - smoothstep(-6.0,4.0,sunAlt);
      float bright = clamp((6.2 - vMag)/5.2, 0.45, 1.0); gl_FragColor = vec4(0.96,0.97,1.0, a*bright*night); }`,
  transparent: true, depthWrite: false, depthTest: true,
});
const starPoints = new THREE.Points(starGeo, starMat);
starPoints.frustumCulled = false;
starPoints.renderOrder = 1;
starPoints.visible = false;
scene.add(starPoints);

// ---------------------------------------------------------------- ground sampling
// Grids arrive from the worker: near (Stonehenge, 2.5 m), detail (Woodhenge/Bulford, 10 m), coarse (12 km, 55 m),
// far (OS Terrain 50, 40 x 36 km at 100 m: the skyline beyond the lidar, east and north-east of Bulford).
const grids = { near: null, detail: null, coarse: null, far: null };
let groundVer = 0; // bumped whenever a grid arrives: cached skylines are dropped
function sampleGrid(g, x, z) {
  const fx = (x - g.x0) / g.dx, fz = (z - g.z0) / g.dz;
  if (!(fx >= 0 && fz >= 0 && fx <= g.nx - 1 && fz <= g.ny - 1)) return null;
  const i = Math.min(g.nx - 2, Math.floor(fx)), j = Math.min(g.ny - 2, Math.floor(fz));
  const u = fx - i, v = fz - j, a = j * g.nx + i, H = g.h;
  // Same split as the mesh: triangles (a, a+W, a+1) and (a+1, a+W, a+W+1).
  if (u + v <= 1) return H[a] + u * (H[a + 1] - H[a]) + v * (H[a + g.nx] - H[a]);
  const h11 = H[a + g.nx + 1];
  return h11 + (1 - u) * (H[a + g.nx] - h11) + (1 - v) * (H[a + 1] - h11);
}
function heightAt(x, z) {
  let h;
  if (grids.near && (h = sampleGrid(grids.near, x, z)) != null) return h;
  if (grids.detail && (h = sampleGrid(grids.detail, x, z)) != null) return h;
  if (grids.coarse && (h = sampleGrid(grids.coarse, x, z)) != null) return h;
  if (grids.far && (h = sampleGrid(grids.far, x, z)) != null) return h;
  return null;
}
// Skylines kept per eye point (x, z, eye height), traced lazily, and dropped when finer ground arrives, so
// changing the date, the limb or the epoch re-times against the same skyline instead of re-tracing it.
const skyCache = new Map();
let skyCacheVer = -1;
const skyStats = FLY.skyStats = { made: 0, reused: 0 };
function skylineFor(x, z, eye, conv) {
  if (skyCacheVer !== groundVer) { skyCache.clear(); skyCacheVer = groundVer; }
  const key = x.toFixed(2) + ',' + z.toFixed(2) + ',' + eye.toFixed(2);
  let s = skyCache.get(key);
  if (s) { skyStats.reused++; skyCache.delete(key); skyCache.set(key, s); return s; }
  s = FS.lazySkylineAt(heightAt, x, z, eye, conv);
  skyStats.made++;
  skyCache.set(key, s);
  if (skyCache.size > 24) skyCache.delete(skyCache.keys().next().value);
  return s;
}
const aligner = makeAligner({ FS, heightAt, skyline: skylineFor, hz: window.WOODHENGE_HORIZON });
function groundOr(x, z, fallback) { const h = heightAt(x, z); return h == null ? fallback : h; }

// ---------------------------------------------------------------- periods
// Every monument carries a period (monuments.bin/js, see tools/build_monuments.py and period_rules.md):
// 0 Mesolithic, 1 Early Neolithic, 2 Late Neolithic, 3 Chalcolithic/Early Bronze Age, 4 later or undated.
// One cumulative control shows everything up to the chosen period; groups fade over about 0.5 s.
const MON = window.FLYOVER_MONUMENTS || null;
const PERIODS = (MON && MON.periods) || [];
const NPER = 5;
const periodAlpha = new Float32Array(NPER).fill(1), periodTarget = new Float32Array(NPER).fill(1);
const periodMats = Array.from({ length: NPER }, () => []); // plain materials faded by opacity
function periodMat(mat, p) { periodMats[p].push(mat); return mat; }

// ---------------------------------------------------------------- sites
const RING_COLOUR = { A: 0xc45a1e, B: 0xd4a017, C: 0x2f8f55, D: 0x3d6ea8, E: 0x7a4ea3, F: 0xc43b4a, '?': 0xf4f0e6 };
const centre = localXZ(P.centre.e, P.centre.n);
const WH_GROUND0 = (HZ && HZ.eye && HZ.eye.ground_od) ? HZ.eye.ground_od - ORIGIN_OD : -2.19;
let groundY = WH_GROUND0; // Woodhenge centre ground (label, earthwork)
// Woodhenge posts as on the Woodhenge page (woodhenge/posts.js, Cunnington's plan, seated on the concrete
// markers): 0.64 m thick, one uniform height from the Timber monuments slider (1-12 m, 7.5 m as that page).
// Heights are conjectural. Each post stands on the ground at its own spot (seatWoodhenge).
let postH = 7.5, whPostsOn = true;
const posts = [];
const whRingOn = {}, whRingCount = {};
{
  const mats = {};
  for (const k of Object.keys(RING_COLOUR)) { mats[k] = periodMat(new THREE.MeshLambertMaterial({ color: RING_COLOUR[k] }), 2); whRingOn[k] = true; whRingCount[k] = 0; }
  const geo = new THREE.CylinderGeometry(0.32, 0.32, 3, 12);
  for (const hole of P.posts) {
    const ring = RING_COLOUR[hole.ring] ? hole.ring : '?';
    const p = localXZ(hole.e, hole.n);
    const mesh = new THREE.Mesh(geo, mats[ring]);
    mesh.castShadow = true;
    mesh.position.set(p.x, groundY, p.z);
    mesh.userData.ring = ring;
    mesh.userData.g = groundY; // ground under this post (local heightAt once the ground is in)
    whRingCount[ring]++;
    scene.add(mesh);
    posts.push(mesh);
  }
}
function applyWoodhengePosts() {
  for (const m of posts) {
    m.visible = whPostsOn && whRingOn[m.userData.ring];
    m.scale.y = postH / 3;
    m.position.y = m.userData.g + postH / 2;
  }
}
applyWoodhengePosts();

// Stonehenge stones, present monument: one box per stone from data/locked_poses.js.
const LP = window.LOCKED_POSES;
const S_ORIGIN_OD = (window.SITE_GROUND_OD && window.SITE_GROUND_OD.origin && window.SITE_GROUND_OD.origin.ground_od_m != null)
  ? Number(window.SITE_GROUND_OD.origin.ground_od_m) : 102.588;
const GROUND = (window.SITE_GROUND_OD && window.SITE_GROUND_OD.by_id) ? window.SITE_GROUND_OD.by_id : {};
const LINTEL_SUPPORTS = { '101': ['30','1'], '102': ['1','2'], '105': ['4','5'], '107': ['6','7'], '122': ['21','22'], '130': ['29','30'], '152': ['51','52'], '154': ['53','54'], '158': ['57','58'] };
const OUTER_PRESENT_LINTELS = new Set(['101','102','105','107','122','130']);
const FALLEN_ON_GROUND = new Set(['120','127','160a','160b','160c']);
const TRI_LINTELS = new Set(['152','154','156','158','160a','160b','160c']);
const byId = {};
if (LP) for (const e of LP.array) byId[String(e.id)] = e;
function groundOd(sid) { const g = GROUND[String(sid)]; return (g && g.ground_od_m != null) ? Number(g.ground_od_m) : S_ORIGIN_OD; }
function realHeight(e) { const h = Number(e.height_m); return (Number.isFinite(h) && h > 0) ? h : 0.4; }
function uprightTopRel(sid) { const e = byId[String(sid)]; return (groundOd(sid) - S_ORIGIN_OD) + (e ? realHeight(e) : 0); }
function isFallenLike(e) { const st = String(e.status || ''), id = String(e.id); if (FALLEN_ON_GROUND.has(id)) return true; return st === 'fallen' || st === 'fallen_fragment' || st === 'recumbent' || st === 'on_ground'; }
function isPresentLintel(e) {
  const role = String(e.role || ''), st = String(e.status || '');
  if (role !== 'sarsen_lintel' && role !== 'trilithon_lintel') return false;
  if (isFallenLike(e)) return false;
  return st === 'standing' || st === 'present' || OUTER_PRESENT_LINTELS.has(String(e.id)) || TRI_LINTELS.has(String(e.id));
}
function seatZ(e) {
  const id = String(e.id), H = realHeight(e), gRel = groundOd(id) - S_ORIGIN_OD;
  const supports = (e.supports && e.supports.length >= 2) ? e.supports : LINTEL_SUPPORTS[id];
  if (isPresentLintel(e) && supports) {
    const [a, b] = supports;
    if (byId[a] || byId[b]) return { baseRel: Math.max(uprightTopRel(a), uprightTopRel(b)), H };
  }
  return { baseRel: gRel, H };
}
function colourFor(e) {
  const id = String(e.id);
  if (id === '92' || id === '94') return 0xf0f4fa;
  if (e.role === 'bluestone' || e.role === 'bluestone_lintel' || e.colour_class === 'blue' || e.colour_class === 'blue_bluestone') return 0x3f86b8;
  // Altar Stone: muted green-grey sandstone, distinct from the sarsens without reading as a UI highlight.
  if (id === '80' || e.colour_class === 'altar_pink') return 0x7f8070;
  return 0x8a8e94;
}
if (LP) {
  const matCache = {};
  for (const e of LP.array) {
    const p = localXZ(e.e_m, e.n_m);
    let along = e.footprint_along_m != null ? e.footprint_along_m : (e.width_m || 1);
    let across = e.footprint_across_m != null ? e.footprint_across_m : (e.thickness_m || 1);
    if ((e.status === 'fallen' || e.status === 'recumbent' || e.role === 'altar') && along < across) { const t = along; along = across; across = t; }
    const seat = seatZ(e);
    const geo = e.footprint_shape === 'triangle'
      ? new THREE.CylinderGeometry(Math.max(along, across) * 0.5, Math.max(along, across) * 0.5, seat.H, 3)
      : new THREE.BoxGeometry(along, seat.H, across);
    const c = colourFor(e);
    const mesh = new THREE.Mesh(geo, matCache[c] || (matCache[c] = periodMat(new THREE.MeshLambertMaterial({ color: c }), 2)));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Stones sit on the 1 m DTM ground OD from data/site_ground_od.js.
    mesh.position.set(p.x, seat.baseRel + (S_ORIGIN_OD - ORIGIN_OD) + seat.H / 2, p.z);
    mesh.rotation.y = THREE.MathUtils.degToRad(e.yaw_deg || 0);
    scene.add(mesh);
  }
}

// Bulford pits and the two standing posts, true size, on their surveyed ground OD (bulford-posts-3d data).
// 'Post height boost' (Timber monuments) multiplies the two posts' heights, as the boost on bulford-posts-3d.
const buRings = [], buFeat = [], buLabels = [];
const buGroup = new THREE.Group();
scene.add(buGroup);
let buBoost = 1, buLabelsOn = false, buLabelMode = 'near'; // hole numbers: off by default; 'near' or 'all' when on
if (BU) {
  const kindCol = { post: 0xc42828, base: 0xd97706, axis: 0xdc2626, pit: 0xeab308, henge: 0x44403c };
  const postGeo = new THREE.CylinderGeometry(0.28, 0.3, 1, 10);
  for (const f of BU.features) {
    const p = localXZ(f.e, f.n);
    const y = f.ground - ORIGIN_OD;
    let mesh, h = 0;
    if (f.kind === 'post') {
      h = BU.post_h[f.id] || 2;
      mesh = new THREE.Mesh(postGeo, periodMat(new THREE.MeshLambertMaterial({ color: kindCol.post, emissive: 0x5a1010 }) /* a little self-lit, so the posts read at twilight from the axis */, 2));
      mesh.castShadow = true;
    } else {
      // 'henge' features are pits cut into the two ring ditches (as bulford-posts-3d), not ring centres.
      const r = f.kind === 'base' ? 0.7 : 0.45;
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.35, 12), periodMat(new THREE.MeshLambertMaterial({ color: kindCol[f.kind] || kindCol.pit }), 2));
      mesh.position.set(p.x, y + 0.18, p.z);
    }
    mesh.position.x = p.x; mesh.position.z = p.z;
    buGroup.add(mesh);
    buFeat.push({ f, mesh, x: p.x, z: p.z, y, h });
  }
  // The two henge ring ditches, once each, from BULFORD.henges (x east, z = minus north from the origin).
  for (const h of BU.henges || []) {
    const e = BU.origin_e + h.x, n = BU.origin_n - h.z, p = localXZ(e, n);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(h.r, 0.7, 8, 48), periodMat(new THREE.MeshLambertMaterial({ color: 0x57534e }), 2));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, 97 - ORIGIN_OD, p.z);
    ring.userData.en = [e, n];
    buRings.push(ring);
    buGroup.add(ring);
  }
}
function buTop(b) { return b.y + (b.h ? b.h * buBoost : 0.35); }
function applyBulfordPosts() {
  for (const b of buFeat) if (b.h) { b.mesh.scale.y = b.h * buBoost; b.mesh.position.y = b.y + b.h * buBoost / 2; }
  for (const l of buLabels) l.spr.position.y = buTop(l.b) + 0.6;
  if (BU_AXIS) { BU_AXIS.ha = BU_AXIS.ha0 * buBoost; BU_AXIS.hb = BU_AXIS.hb0 * buBoost; }
}
// Bearing of the two Bulford posts (grid, then true).
let BU_POSTS_TRUE = null;
if (BU) {
  const pp = BU.features.filter(f => f.kind === 'post');
  if (pp.length === 2) {
    const [a, b] = pp[0].n < pp[1].n ? pp : [pp[1], pp[0]];
    const grid = (Math.atan2(b.e - a.e, b.n - a.n) / DEG + 360) % 360;
    const conv = FS.convergenceAt((a.e + b.e) / 2, (a.n + b.n) / 2);
    BU_POSTS_TRUE = { grid, conv, true: grid + conv };
  }
}
FLY.buPosts = BU_POSTS_TRUE;
// The Bulford post axis in local metres: a = SW post (8647), b = NE post (9019), u = unit vector a -> b.
let BU_AXIS = null;
if (BU_POSTS_TRUE) {
  const pp = BU.features.filter(f => f.kind === 'post');
  const [fa, fb] = pp[0].n < pp[1].n ? pp : [pp[1], pp[0]];
  const a = localXZ(fa.e, fa.n), b = localXZ(fb.e, fb.n), L = Math.hypot(b.x - a.x, b.z - a.z);
  BU_AXIS = { a, b, fa, fb, L, ux: (b.x - a.x) / L, uz: (b.z - a.z) / L, az: BU_POSTS_TRUE.true,
    ha: (BU.post_h[fa.id] || 2), hb: (BU.post_h[fb.id] || 2) };
  BU_AXIS.ha0 = BU_AXIS.ha; BU_AXIS.hb0 = BU_AXIS.hb; // true heights; ha/hb follow the boost
}
applyBulfordPosts();

// Labels: fixed screen size, so they read from anywhere in the landscape. Each canvas is sized to its
// measured text (at most LABEL_MAX_W px, wrapped to two lines beyond that) and the sprite keeps its aspect.
const labels = [];
const labelTex = new Map();
const LABEL_MAX_W = 760, LABEL_REF_W = 512; // LABEL_REF_W px of canvas = 'size' screen units (as before)
function labelCanvas(text, big) {
  const fs = big ? 64 : 50, font = (big ? 'bold ' : '600 ') + fs + 'px system-ui,sans-serif';
  const pad = Math.round(fs * 0.3), lh = Math.round(fs * 1.2);
  const c = document.createElement('canvas');
  let g = c.getContext('2d');
  g.font = font;
  const W = (t) => g.measureText(t).width;
  let lines = [text];
  if (W(text) > LABEL_MAX_W) {
    const words = text.split(' ');
    let best = null;
    for (let k = 1; k < words.length; k++) {
      const a = words.slice(0, k).join(' '), b = words.slice(k).join(' ');
      const w = Math.max(W(a), W(b));
      if (!best || w < best.w) best = { w, lines: [a, b] };
    }
    if (best) lines = best.lines;
  }
  const tw = Math.min(LABEL_MAX_W, Math.max(...lines.map(W)));
  c.width = Math.ceil(tw) + pad * 2 + 4;
  c.height = lines.length * lh + pad;
  g = c.getContext('2d');
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => {
    const y = pad / 2 + lh * (i + 0.5);
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText(l, c.width / 2 + 3, y + 3, LABEL_MAX_W);
    g.fillStyle = big ? '#f4f7fb' : '#d8e2c8'; g.fillText(l, c.width / 2, y, LABEL_MAX_W);
  });
  return c;
}
function makeLabel(text, big, size, shared, period = 4) {
  const key = (big ? 'B:' : 'n:') + period + ':' + text;
  let mat = shared ? labelTex.get(key) : null;
  if (!mat) {
    const c = labelCanvas(text, big);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: false });
    mat.userData.aspect = [c.width / LABEL_REF_W, c.height / LABEL_REF_W];
    mat.userData.period = period;
    if (shared) labelTex.set(key, mat);
  }
  const spr = new THREE.Sprite(mat);
  const s = size || (big ? 0.2 : 0.14);
  spr.scale.set(s * mat.userData.aspect[0], s * mat.userData.aspect[1], 1);
  spr.userData.s0 = [spr.scale.x, spr.scale.y];
  spr.renderOrder = 30;
  spr.center.set(0.5, 0);
  spr.userData.period = period;
  scene.add(spr);
  labels.push(spr);
  return spr;
}
// Site labels are made just after the first frame (first canvas text can be slow).
const siteLabels = [];
function makeSiteLabels() {
  siteLabels.push({ spr: makeLabel('Stonehenge', true, 0, false, 2), x: 0, z: 0, y: 12 });
  siteLabels.push({ spr: makeLabel('Woodhenge', true, 0, false, 2), x: centre.x, z: centre.z, y: groundY + 14 });
  if (BU) { const b = localXZ(BU.origin_e, BU.origin_n); siteLabels.push({ spr: makeLabel('Bulford', true, 0, false, 2), x: b.x - 25, z: b.z + 10, y: 95.5 - ORIGIN_OD + 10 }); }
  for (const l of siteLabels) { l.spr.position.set(l.x, l.y, l.z); l.maxD = 1e9; }
  // Every Bulford hole/feature number with its heights (ground OD; the posts' height above ground).
  const KIND = { post: 'post', base: 'base-station pit?', axis: 'axis pit', henge: 'henge pit', pit: 'pit' };
  for (const b of buFeat) {
    const f = b.f, post = f.kind === 'post';
    const dep = post && BU.pit_depth && BU.pit_depth[f.id];
    const t = f.id + ' ' + (KIND[f.kind] || f.kind) + (post ? ' ' + b.h.toFixed(1) + ' m tall (Conjecture)' + (dep ? ', pit ' + dep + ' m deep' : '') : '');
    const spr = makeLabel(t, false, post ? 0.15 : 0.125, false, 2);
    const l = { spr, x: b.x, z: b.z, b, post };
    spr.position.set(b.x, buTop(b) + 0.6, b.z);
    spr.visible = false;
    buLabels.push(l);
  }
  labelVisAt = 0;
}

// Woodhenge bank and ditch (schematic contour). North is shown by the compass.
const earthY0 = groundY;
function addEarthwork(y0) {
  const r0 = 26, r1 = 66, nr = 34, na = 180;
  const positions = [], colors = [];
  function distToArc(r, azDeg, radius) {
    const gap0 = 6, gap1 = 38;
    let clamped = azDeg;
    if (azDeg >= gap0 && azDeg <= gap1) clamped = (azDeg - gap0) < (gap1 - azDeg) ? gap0 : gap1;
    const az = azDeg * DEG, ca = clamped * DEG;
    return Math.hypot(r * Math.sin(az) - radius * Math.sin(ca), r * Math.cos(az) - radius * Math.cos(ca));
  }
  function relief(r, azDeg) {
    const ditch = Math.exp(-0.5 * (distToArc(r, azDeg, 33) / 3.2) ** 2);
    const bank = Math.exp(-0.5 * (distToArc(r, azDeg, 46) / 5.2) ** 2);
    return -0.6 * ditch + 0.95 * bank;
  }
  for (let ia = 0; ia < na; ia++) {
    const az = ia * (360 / na), rad = az * DEG;
    for (let ir = 0; ir < nr; ir++) {
      const r = r0 + ir * (r1 - r0) / (nr - 1);
      const h = relief(r, az);
      positions.push(centre.x + Math.sin(rad) * r, y0 + h, centre.z - Math.cos(rad) * r);
      const s = 0.78 + 0.5 * h;
      colors.push(0.40 * s, 0.48 * s, 0.28 * s);
    }
  }
  const indices = [];
  for (let ia = 0; ia < na; ia++) {
    const ib = (ia + 1) % na;
    for (let ir = 0; ir < nr - 1; ir++) {
      const a = ia * nr + ir, b = ib * nr + ir;
      indices.push(a, b, a + 1, b, b + 1, a + 1); // wound to face up (front faces only)
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, periodMat(new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }), 2));
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  scene.add(mesh);
  return mesh;
}
const earthwork = addEarthwork(earthY0);
function seatWoodhenge() {
  const y = heightAt(centre.x, centre.z);
  if (y == null) return;
  groundY = y;
  // Each post on the ground at its own spot, not one shared level.
  let lo = Infinity, hi = -Infinity;
  for (const m of posts) {
    const g = heightAt(m.position.x, m.position.z);
    m.userData.g = g == null ? y : g;
    lo = Math.min(lo, m.userData.g); hi = Math.max(hi, m.userData.g);
  }
  FLY.whPostGround = [lo + ORIGIN_OD, hi + ORIGIN_OD];
  applyWoodhengePosts();
  earthwork.position.y = y - earthY0;
  for (const r of buRings) { const p = r.position; p.y = groundOr(p.x, p.z, p.y - 0.4) + 0.4; }
  if (siteLabels[1]) siteLabels[1].spr.position.y = y + 14;
}

// ---------------------------------------------------------------- monuments
// Banks, ditches and barrows from the Historic England Aerial Investigation & Mapping data (Stonehenge WHS),
// scheduled areas from the National Heritage List (both OGL); the worker drapes them on the final ground.
const lmGroup = new THREE.Group();
scene.add(lmGroup);
const lmLabels = [];
let labelsOn = true;
// Fills, mounds and outlines: RGBA vertex colours whose alpha byte is the period; the shader looks up that
// period's current opacity (uPA), so fading a period is one uniform change, with no extra meshes.
const monMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, alphaTest: 0.02, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
const periodUniform = { value: periodAlpha };
monMat.onBeforeCompile = (sh) => {
  sh.uniforms.uPA = periodUniform;
  sh.vertexShader = 'uniform float uPA[' + NPER + '];\n' + sh.vertexShader.replace('#include <color_vertex>',
    '#include <color_vertex>\n#ifdef USE_COLOR_ALPHA\n\tvColor.a = uPA[int(color.a * 255.0 + 0.5)];\n#endif');
};
monMat.customProgramCacheKey = () => 'monPeriod';
const stoneMat = periodMat(new THREE.MeshLambertMaterial({ color: 0x9c9486 }), 2);
const stones = [];
if (MON) {
  for (const st of MON.stones) {
    // Both stones lie flat today (Cuckoo Stone; Tor Stone 'now recumbent', Harding et al. 2025): recumbent blocks, true size.
    const m = new THREE.Mesh(new THREE.BoxGeometry(st.len, st.th, st.wid), stoneMat);
    m.rotation.y = (st.ang || 0) * DEG;
    m.position.set(st.x, 0, st.z);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.th = st.th;
    stones.push(m);
    lmGroup.add(m);
  }
}
// Mesolithic posts in the old car park (A, B, C and post-pit 9580): pine posts about 0.75 m thick (the post
// pipes); the 6 m height is a guess. The undated tree hole is a dark disc. All in the Mesolithic period step.
const mesoPostMat = periodMat(new THREE.MeshLambertMaterial({ color: 0x6b4a2e }), 0);
const mesoHoleMat = periodMat(new THREE.MeshLambertMaterial({ color: 0x2e2419, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }), 0);
if (MON && MON.posts) {
  for (const pt of MON.posts) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(pt.d / 2, pt.d / 2 * 1.05, pt.h, 20), mesoPostMat);
    m.position.set(pt.x, 0, pt.z); m.castShadow = true; m.receiveShadow = true;
    m.userData.th = pt.h; m.userData.sink = 0.05;
    stones.push(m); lmGroup.add(m);
  }
  for (const th of MON.treeholes || []) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(th.d / 2, 24), mesoHoleMat);
    m.rotation.x = -Math.PI / 2; m.position.set(th.x, 0, th.z);
    m.userData.th = 0; m.userData.sink = -0.12; // lies just above the ground
    stones.push(m); lmGroup.add(m);
  }
}
function seatStones() { // re-seat the stones and posts whenever better ground arrives
  for (const m of stones) m.position.y = groundOr(m.position.x, m.position.z, 0) + m.userData.th / 2 - (m.userData.sink != null ? m.userData.sink : 0.1);
}
function addMonuments(d) {
  // Spread over frames (one queued step per 1.5 km cell) so the uploads never stall a frame.
  const chunks = d.chunks.slice();
  const step = () => {
    for (let n = 0; n < 12 && chunks.length; n++) { const c = chunks.shift(); const mesh = makeMesh(c, monMat); mesh.renderOrder = 1; mesh.receiveShadow = false; lmGroup.add(mesh); }
    requestAnimationFrame(() => addQueue.push(chunks.length ? step : () => addMonumentExtras(d)));
  };
  addQueue.push(step);
}
function addMonumentExtras(d) {
  // Mounds (merged per cell) and scheduled-area outline ribbons: same vertex-coloured material as the fills.
  for (const c of d.domeChunks) { const mesh = makeMesh(c, monMat); mesh.receiveShadow = true; lmGroup.add(mesh); }
  if (d.outline.pos.length) { const mesh = makeMesh(d.outline, monMat); mesh.renderOrder = 1; mesh.receiveShadow = false; lmGroup.add(mesh); }
  requestAnimationFrame(() => addQueue.push(() => addTill(d)));
}
function addTill(d) {
  if (d.tillPos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.tillPos, 3));
    const nrm = new Float32Array(d.tillPos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(d.tillPos.length), 3, true));
    g.setIndex(new THREE.BufferAttribute(d.tillIdx, 1));
    g.computeBoundingSphere();
    const till = new THREE.Mesh(g, riverMat); // same crisp blue ribbon as the Avon
    till.renderOrder = 2;
    scene.add(till);
  }
  mark('monuments');
  requestAnimationFrame(() => addQueue.push(addMonumentLabels));
}
// Labels: named monuments and barrow cemeteries read from far away; single barrows only within 700 m.
const LABEL_RANGE = { major: 4500, group: 6000, minor: 700, detail: 250 }; // detail: single features close together
function addMonumentLabels() {
  if (!MON) return;
  const queue = MON.labels.slice();
  for (const st of MON.stones) queue.push({ t: st.t, x: st.x, z: st.z, k: 'major', p: st.p });
  const next = () => {
    for (let n = 0; n < 12 && queue.length; n++) {
      const L = queue.shift();
      const big = L.k === 'group';
      const small = L.k === 'minor' || L.k === 'detail';
      const spr = makeLabel(L.t, false, L.k === 'detail' ? 0.12 : small ? 0.1 : big ? 0.15 : 0.13, small, L.p != null ? L.p : 4);
      const l = { spr, x: L.x, z: L.z, maxD: LABEL_RANGE[L.k] || 900 };
      spr.position.set(l.x, groundOr(l.x, l.z, 0) + (L.k === 'minor' ? 5 : L.k === 'detail' ? 8.5 : 9), l.z);
      spr.visible = false;
      lmLabels.push(l);
    }
    labelVisAt = 0;
    if (queue.length) setTimeout(next, 0);
  };
  setTimeout(next, 0);
}
let labelVisAt = 0;
function updateLabelVis(now) {
  if (now - labelVisAt < 200) return;
  labelVisAt = now;
  const on = labelsOn && lmGroup.visible, p = cam.position;
  // In plan view the labels follow the ground in view: named ones everywhere in view, single barrows
  // only while the view is under about 2 km across.
  let viewR = 0, minorOk = true;
  if (plan) {
    const agl = p.y - groundOr(p.x, p.z, p.y - 500);
    viewR = agl * Math.tan(cam.fov * DEG / 2) * Math.max(1, cam.aspect) * 1.15;
    minorOk = viewR < 1700;
  }
  const k = plan ? 1.35 : 1; // a little larger when looking straight down
  const vis = (l, show) => {
    const a = periodAlpha[l.spr.userData.period];
    l.spr.visible = show && a > 0.01;
    l.spr.material.opacity = a;
    const s0 = l.spr.userData.s0;
    if (s0 && l.spr.scale.x !== s0[0] * k) l.spr.scale.set(s0[0] * k, s0[1] * k, 1);
  };
  for (const l of lmLabels) {
    const d = Math.hypot(l.x - p.x, l.z - p.z);
    const range = !plan ? l.maxD
      : l.maxD === LABEL_RANGE.minor ? (minorOk ? Math.max(l.maxD, viewR) : 0)
      : l.maxD === LABEL_RANGE.detail ? (viewR < 220 ? Math.max(l.maxD, viewR) : 0)
      : Math.max(l.maxD, viewR);
    vis(l, on && d < range);
  }
  for (const l of siteLabels) vis(l, labelsOn);
  // Bulford hole numbers: one label per feature, made once (makeSiteLabels). Off by default: none at all until
  // 'Hole numbers' is ticked; then either up close (within 160 m, or a plan view under about 220 m across)
  // or always. Labels that would overlap on screen are stacked upward (up to three deep; posts and nearer
  // features first), and any still without room are hidden until the view comes closer, so none draw on top of each other.
  const buOn = labelsOn && buLabelsOn && buGroup.visible;
  const shown = [];
  for (const l of buLabels) {
    const d = Math.hypot(l.x - p.x, l.z - p.z), d3 = Math.hypot(d, l.spr.position.y - p.y);
    const near = plan ? viewR < 220 : d3 < 160;
    vis(l, buOn && (buLabelMode === 'all' || near));
    l.spr.center.y = 0;
    if (l.spr.visible) shown.push({ l, d: d3 });
  }
  if (shown.length > 1) {
    applyCamera(); cam.updateMatrixWorld();
    const f = innerHeight / 2 / Math.tan(cam.fov * DEG / 2), v = new THREE.Vector3(), placed = [];
    shown.sort((a, b) => (b.l.post - a.l.post) || (a.d - b.d));
    const site = siteLabels[2]; // keep clear of the 'Bulford' site label
    if (site && site.spr.visible) { v.copy(site.spr.position).project(cam); if (v.z <= 1) placed.push({ x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, w: site.spr.scale.x * f, h: site.spr.scale.y * f }); }
    for (const { l } of shown) {
      v.copy(l.spr.position).project(cam);
      if (v.z > 1) continue;
      const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight;
      const w = l.spr.scale.x * f, h = l.spr.scale.y * f;
      let k = 0;
      const hit = (k) => placed.some((r) => Math.abs(r.x - x) < (r.w + w) / 2 && Math.abs(r.y - (y - k * h)) < (r.h + h) / 2 * 0.98);
      while (k < 4 && hit(k)) k++;
      if (k === 4) { l.spr.visible = false; continue; } // no room: hidden until the view comes closer
      l.spr.center.y = -k;
      placed.push({ x, y: y - k * h, w, h });
    }
  }
}
function setLabels(on) {
  labelsOn = on;
  document.getElementById('labelsOn').checked = on;
  labelVisAt = 0;
}
document.getElementById('labelsOn').onchange = (ev) => setLabels(ev.target.checked);
document.getElementById('lmOn').onchange = (ev) => { lmGroup.visible = ev.target.checked; setLabels(labelsOn); };

// ---------------------------------------------------------------- Timber monuments panel
{
  const $ = (id) => document.getElementById(id);
  const whBtn = $('whPostsBtn'), buBtn = $('buPostsBtn');
  const paintBtn = (b, on, name) => { b.classList.toggle('active', on); b.textContent = (on ? 'Hide ' : 'Show ') + name; b.setAttribute('aria-pressed', on ? 'true' : 'false'); };
  // Ring choice, as the Woodhenge page: A-F and Other, with counts and the ring colours.
  const rings = $('whRings');
  for (const k of Object.keys(RING_COLOUR)) {
    if (!whRingCount[k]) continue;
    const lab = document.createElement('label');
    lab.className = 'ring';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = true; cb.dataset.ring = k;
    cb.onchange = () => { whRingOn[k] = cb.checked; applyWoodhengePosts(); };
    const sw = document.createElement('span');
    sw.className = 'sw'; sw.style.background = '#' + RING_COLOUR[k].toString(16).padStart(6, '0');
    lab.append(cb, sw, document.createTextNode((k === '?' ? 'Other' : k) + ' (' + whRingCount[k] + ')'));
    rings.appendChild(lab);
  }
  whBtn.onclick = () => { whPostsOn = !whPostsOn; paintBtn(whBtn, whPostsOn, 'Woodhenge posts'); $('whCtl').hidden = !whPostsOn; applyWoodhengePosts(); };
  $('whPostH').oninput = (ev) => { postH = +ev.target.value; $('whHLbl').textContent = postH.toFixed(1) + ' m'; applyWoodhengePosts(); };
  buBtn.onclick = () => { buGroup.visible = !buGroup.visible; paintBtn(buBtn, buGroup.visible, 'Bulford posts'); $('buCtl').hidden = !buGroup.visible; labelVisAt = 0; };
  $('buLabelsOn').onchange = (ev) => { buLabelsOn = ev.target.checked; $('buLabelMode').disabled = !buLabelsOn; if (buLabelsOn && !labelsOn) setLabels(true); labelVisAt = 0; };
  $('buLabelMode').onchange = (ev) => { buLabelMode = ev.target.value; labelVisAt = 0; };
  $('buBoost').oninput = (ev) => {
    buBoost = +ev.target.value;
    $('buBoostLbl').textContent = buBoost + '\u00d7';
    $('buBoostNote').hidden = buBoost <= 1;
    applyBulfordPosts();
    labelVisAt = 0;
  };
  if (!BU) buBtn.disabled = true;
  paintBtn(whBtn, true, 'Woodhenge posts'); paintBtn(buBtn, !!BU, 'Bulford posts');
}
{
  const cr = document.getElementById('credits');
  const terrain = 'Terrain: EA lidar DTM \u00a9 Environment Agency (OGL v3); OS Terrain 50 and OS Open Rivers, contains OS data \u00a9 Crown copyright and database right 2026 (OGL v3). ';
  const sources = ' Woodhenge posts: Cunnington 1929 plan (heights conjectural). Bulford pits and posts: plan in Harding, Leivers & Silva 2026, \u2018A newly discovered solstitial post alignment in the Stonehenge landscape at Bulford\u2019, PAST 113 (Summer 2026), 2\u20135, Prehistoric Society (post heights conjectural). Tor and Cuckoo Stones: Harding et al. 2025, PPS 90. ';
  const own = 'Viewer and data compilation \u00a9 2026 Tim Daw, CC BY-SA 4.0. A modelling tool, not a reconstruction.';
  if (cr) cr.textContent = terrain + (MON ? MON.credits : '') + sources + own;
}

// ---------------------------------------------------------------- terrain streaming
const loadEl = document.getElementById('load');
const loadState = { coarse: false, near: false, river: false, far: false, tiles: 0, nTiles: 36, error: '' };
function paintLoad() {
  const t = (b) => b ? '✓' : '…';
  loadEl.textContent = loadState.error ? ('Ground: ' + loadState.error)
    : FLY.detailDone ? 'Ground: full detail' + (loadState.far ? '' : ' · horizon …')
    : `Ground: wide ${t(loadState.coarse)} · Stonehenge ${t(loadState.near)} · detail ${loadState.tiles}/${loadState.nTiles}`;
  loadEl.style.opacity = FLY.detailDone ? '0.45' : '1';
}
paintLoad();
// Front faces only: with DoubleSide the back of a skirt was lit with a flipped (downward) normal and
// showed as a dark line wherever it peeped through a crack between tiles.
const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const detailMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
const nearMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
function makeMesh(m, mat) {
  // Worker arrays are fresh buffers (byteOffset 0), and the index is always a BufferAttribute.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(m.nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(m.col, m.col.length === m.pos.length ? 3 : 4, true)); // RGBA for monuments
  geo.setIndex(new THREE.BufferAttribute(m.idx, 1));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}
// Stand-in ground for the first few hundred milliseconds, below all three sites.
const standIn = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshLambertMaterial({ color: 0x3e4a33 }));
standIn.rotation.x = -Math.PI / 2;
standIn.position.y = -9;
scene.add(standIn);

// Flat, clearly blue rivers (0x1a78c2) that ignore the light, for the Avon and the Till. The material reuses the
// ground shader (black diffuse, blue emissive), so no extra shader has to be compiled.
const riverMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0x000000, emissive: 0x1a78c2, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
// Plus a small clip-space depth bias, about 0.2% of the distance to the camera (the bias is 2 x near x 0.002 in
// clip units, which works out as that fraction at every range), so the ground cannot flicker through at seams.
const riverBias = { value: 0 };
let farRiverLines = null; // thin river lines, shown from high up (farRivers message)
riverMat.onBeforeCompile = (sh) => {
  sh.uniforms.uRiverBias = riverBias;
  sh.vertexShader = 'uniform float uRiverBias;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  gl_Position.z -= uRiverBias;');
};
riverMat.customProgramCacheKey = () => 'riverBias';
let coarse = null, coarseFullIdx = null, coarseY = null, sunkUpTo = 0;
const coverRects = [];
let holeDirty = false, holeAt = 0;
// Drop wide-ground cells that the Stonehenge sheet or a detail tile now covers, so the coarse 55 m
// surface cannot poke through. The same index buffer is rewritten and the draw range shortened.
function updateCoarseHole() {
  if (!coarse || !coarseFullIdx) return;
  const g = grids.coarse;
  const inside = (x, z) => coverRects.some(r => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]);
  const attr = coarse.geometry.index, out = attr.array, W = g.nx;
  let n = 0;
  for (let t = 0; t < coarseFullIdx.length; t += 6) {
    const a = coarseFullIdx[t];
    const i = a % W, j = (a - i) / W;
    const xa = g.x0 + i * g.dx, xb = xa + g.dx, za = g.z0 + j * g.dz, zb = za + g.dz;
    if (inside(xa, za) && inside(xb, za) && inside(xa, zb) && inside(xb, zb)) continue;
    for (let k = 0; k < 6; k++) out[n++] = coarseFullIdx[t + k];
  }
  attr.needsUpdate = true;
  coarse.geometry.setDrawRange(0, n);
  // Wide-ground points under a finer sheet sink 3 m, so the edge cells that are still drawn dip under the
  // finer ground (whose skirts close the step) instead of poking through it.
  // Only the cover rectangles added since the last call are tested (coarse grid index range per rectangle).
  const pa = coarse.geometry.attributes.position, P = pa.array;
  for (; sunkUpTo < coverRects.length; sunkUpTo++) {
    const r = coverRects[sunkUpTo];
    const i0 = Math.max(0, Math.ceil((r[0] + 1 - g.x0) / g.dx)), i1 = Math.min(g.nx - 1, Math.floor((r[2] - 1 - g.x0) / g.dx));
    const j0 = Math.max(0, Math.ceil((r[1] + 1 - g.z0) / g.dz)), j1 = Math.min(g.ny - 1, Math.floor((r[3] - 1 - g.z0) / g.dz));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const v = j * g.nx + i; P[v * 3 + 1] = coarseY[v] - 3; }
  }
  pa.needsUpdate = true;
}
const tiles = [];
const addQueue = [];

const worker = new Worker(new URL('./terrain_worker.js?v=' + BUILD, import.meta.url));
worker.onmessage = (ev) => {
  const d = ev.data;
  if (d.type === 'bytes') { FLY.bytes[d.name] = d.bytes; return; }
  if (d.type === 'grid') {
    grids[d.name] = d;
    groundVer++;
    sendGridToAlign(d);
    seatWoodhenge();
    if (d.name === 'far' && FLY.detailDone && !manualTime && document.getElementById('retime').checked && bodyMode !== 'off' && !skyPlay) {
      // The far ground usually lands after the detail ground: re-time rise/set against the longer skyline.
      autoSeekPending = true;
    }
    if (d.name !== 'detail') groundChanged();
    return;
  }
  if (d.type === 'mesh') {
    addQueue.push(() => {
      if (d.name === 'coarse') {
        coarse = makeMesh(d.mesh, terrainMat);
        coarse.renderOrder = -1;
        coarseFullIdx = d.mesh.idx.slice();
        coarseY = new Float32Array(d.mesh.pos.length / 3);
        for (let v = 0; v < coarseY.length; v++) coarseY[v] = d.mesh.pos[v * 3 + 1];
        scene.add(coarse);
        standIn.visible = false;
        loadState.coarse = true; mark('coarse');
      } else if (d.name === 'far') {
        // OS Terrain 50 beyond the lidar: drawn under everything else (cells under the wide ground are left out).
        const far = makeMesh(d.mesh, terrainMat);
        far.renderOrder = -1;
        scene.add(far);
        loadState.far = true; mark('far');
        paintLoad();
      } else if (d.name === 'near') {
        scene.add(makeMesh(d.mesh, nearMat));
        coverRects.push(d.bbox);
        loadState.near = true; mark('near');
      }
      holeDirty = true;
      paintLoad();
    });
    return;
  }
  if (d.type === 'river') {
    addQueue.push(() => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(d.pos.length).fill(0).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(d.pos.length), 3, true));
      // One continuous Avon ribbon, draped in the worker on the whole height field, every triangle facing up.
      geo.setIndex(new THREE.BufferAttribute(d.idx, 1));
      // Flat, clearly blue river (0x1a78c2) that ignores the light. It reuses the ground shader, so no new
      // shader has to be compiled when it arrives: black diffuse, the blue comes from the emissive term.
      const river = new THREE.Mesh(geo, riverMat);
      river.renderOrder = 2;
      river.frustumCulled = false;
      scene.add(river);
      loadState.river = true; mark('river');
    });
    return;
  }
  if (d.type === 'farRivers') {
    // Rivers beyond the wide ground (OS Open Rivers): ribbons draped on the far ground, and every river as a
    // thin line that shows from high up, where the ribbons are narrower than a pixel.
    addQueue.push(() => {
      if (d.idx.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(d.pos.length).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(d.pos.length), 3, true));
        geo.setIndex(new THREE.BufferAttribute(d.idx, 1));
        const m = new THREE.Mesh(geo, riverMat);
        m.renderOrder = 2; m.frustumCulled = false;
        scene.add(m);
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(d.line, 3));
      farRiverLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x3d9be0 }));
      farRiverLines.renderOrder = 3; farRiverLines.frustumCulled = false; farRiverLines.visible = false;
      scene.add(farRiverLines);
      mark('farRivers');
    });
    return;
  }
  if (d.type === 'monuments') { FLY.bytes['monuments+till'] = d.bytes; addQueue.push(() => { if (monReady) addMonuments(d); else pendingMon = d; }); return; }
  if (d.type === 'tilecount') { loadState.nTiles = d.n; paintLoad(); return; }
  if (d.type === 'tile') {
    addQueue.push(() => {
      const meshes = d.lods.map((m) => { const mesh = makeMesh(m, detailMat); mesh.visible = false; scene.add(mesh); return mesh; });
      tiles.push({ bbox: d.bbox, meshes, lod: -1 });
      coverRects.push(d.bbox);
      holeDirty = true;
      loadState.tiles++;
      if (loadState.tiles === 1) mark('firstTile');
      paintLoad();
    });
    return;
  }
  if (d.type === 'done') {
    addQueue.push(() => {
      FLY.detailDone = true; mark('detailDone');
      holeDirty = true;
      seatWoodhenge();
      groundChanged();
      paintLoad();
    });
    return;
  }
  if (d.type === 'error') { loadState.error = d.message; paintLoad(); console.warn('terrain: ' + d.message); }
};
// The worker script itself failed to load or threw outside its own try/catch.
worker.onerror = (e) => { loadState.error = 'worker failed (' + (e.message || 'load error') + ')'; paintLoad(); console.warn('terrain worker failed', e.message || e); };
// Better ground arrived: reseat the stones and redo an automatic rise/set time.
function groundChanged() {
  seatStones();
  if (autoSeekPending && bodyMode !== 'off' && !skyPlay) pendingSeek = true;
}

// ---------------------------------------------------------------- flight
const flight = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, vel: new THREE.Vector3(), yawRate: 0 };
let baseSpeed = 40, minAgl = 2;
const keys = new Set();
const touch = { fwd: 0, turn: 0, up: 0 };
const pad = { fwd: 0, str: 0, turn: 0, tilt: 0, up: 0, fast: false }; // the on-screen pad (new layout)
let flyAnim = null, tour = null;
function lookFrom(pos, target) {
  const d = new THREE.Vector3().subVectors(target, pos);
  return { pos: pos.clone(), yaw: Math.atan2(d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
}
// Camera 'dist' metres from the target on grid bearing 'fromDeg' (target to camera), 'up' metres above the target's ground.
function poseAround(x, z, { dist, fromDeg, up, look = 3 }) {
  const gy = groundOr(x, z, 0);
  const b = fromDeg * DEG;
  const cx = x + Math.sin(b) * dist, cz = z - Math.cos(b) * dist;
  const pos = new THREE.Vector3(cx, Math.max(gy + up, groundOr(cx, cz, gy) + minAgl + 1), cz);
  return lookFrom(pos, new THREE.Vector3(x, gy + look, z));
}
function applyCamera() {
  cam.position.copy(flight.pos);
  cam.rotation.set(flight.pitch, -flight.yaw, 0, 'YXZ');
}
function setPose(p) { flyAnim = null; if (tour) stopTour(); flight.pos.copy(p.pos); flight.yaw = p.yaw; flight.pitch = p.pitch; flight.vel.set(0, 0, 0); applyCamera(); }
const ease = (u) => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
function angLerp(a, b, t) { const d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * t; }
function flyTo(pose, opts = {}) {
  const from = { pos: flight.pos.clone(), yaw: flight.yaw, pitch: flight.pitch };
  const dist = from.pos.distanceTo(pose.pos);
  // prefers-reduced-motion: jump straight to the pose (next frame) instead of an arcing flight.
  const still = REDUCED_MOTION.matches;
  // The Speed slider also paces Go to, double-click and tour flights (x1 at the default 40 m/s).
  const pace = THREE.MathUtils.clamp(Math.sqrt(40 / baseSpeed), 0.4, 2.5);
  const dur = still ? 1e-3 : opts.dur != null ? opts.dur : THREE.MathUtils.clamp(1.2 + Math.sqrt(dist) / 13, 1.2, 7) * pace;
  flyAnim = { from, to: pose, t: 0, dur, arc: still ? 0 : Math.min(450, dist * 0.12), onDone: opts.onDone || null };
  flight.vel.set(0, 0, 0);
}
function stepFlyAnim(dt) {
  const A = flyAnim;
  A.t += dt;
  const u = Math.min(1, A.t / A.dur), e = ease(u);
  flight.pos.lerpVectors(A.from.pos, A.to.pos, e);
  flight.pos.y += A.arc * Math.sin(Math.PI * u);
  flight.yaw = angLerp(A.from.yaw, A.to.yaw, e);
  flight.pitch = THREE.MathUtils.lerp(A.from.pitch, A.to.pitch, e);
  if (u >= 1) { flyAnim = null; if (A.onDone) A.onDone(); }
}
function cancelAuto() {
  restoreFov();
  flyAnim = null;
  if (tour) stopTour();
}
function speedFromSlider(v) { return 2 * Math.pow(400, v / 100); }
function paintSpeed() {
  document.getElementById('spdLbl').textContent = (baseSpeed < 10 ? baseSpeed.toFixed(1) : Math.round(baseSpeed)) + ' m/s (' + Math.round(baseSpeed * 3.6) + ' km/h)';
}
document.getElementById('speed').oninput = (ev) => { baseSpeed = speedFromSlider(+ev.target.value); paintSpeed(); };
document.getElementById('minAgl').oninput = (ev) => { minAgl = +ev.target.value; document.getElementById('minLbl').textContent = minAgl + ' m'; };
baseSpeed = speedFromSlider(+document.getElementById('speed').value); paintSpeed();
minAgl = +document.getElementById('minAgl').value;
document.getElementById('minLbl').textContent = minAgl + ' m';
function nudgeSpeed(f) {
  const v = THREE.MathUtils.clamp(Math.log(baseSpeed * f / 2) / Math.log(400) * 100, 0, 100);
  document.getElementById('speed').value = String(v); baseSpeed = speedFromSlider(v); paintSpeed();
}

const FLIGHT_KEYS = new Set(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','KeyR','KeyF','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight']);
addEventListener('keydown', (ev) => {
  // Keys belong to a focused text or number box or list. A focused slider or tick box keeps only the keys it
  // uses (arrows, Home/End, Page Up/Down; Space), so after moving the Speed slider W/A/S/D, Q/E/R/F and Shift
  // still fly (they used to do nothing until the slider lost focus).
  const tg = ev.target;
  if (tg && (tg.tagName === 'SELECT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
  if (tg && tg.tagName === 'INPUT') {
    const t = tg.type;
    if (t === 'range' ? /^(Arrow|Home|End|Page)/.test(ev.code) : t === 'checkbox' || t === 'radio' ? ev.code === 'Space' : true) return;
  }
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  // During a flight or the tour the left/right arrows turn the view (round its destination) instead of
  // stopping it; N faces north. Neither stops the tour.
  const rk = ROT_KEYS[ev.code];
  if (rk && (flyAnim || tour)) {
    ev.preventDefault();
    if (!ev.repeat) rotStart('k' + ev.code, rk);
    return;
  }
  if (ev.code === 'KeyN') { resetNorth(); return; }
  if (FLIGHT_KEYS.has(ev.code)) {
    keys.add(ev.code);
    if (!ev.code.startsWith('Shift')) cancelAuto();
    ev.preventDefault();
    return;
  }
  if (ev.code === 'KeyL') { setLabels(!labelsOn); return; }
  if (ev.code === 'KeyP') { togglePlan(); return; }
  if (ev.code === 'BracketRight' || ev.key === '+' || ev.key === '=') { nudgeSpeed(1.25); return; }
  if (ev.code === 'BracketLeft' || ev.key === '-') { nudgeSpeed(0.8); return; }
  if (ev.code === 'Space' && tour) { ev.preventDefault(); tour.paused = !tour.paused; }
});
addEventListener('keyup', (ev) => { keys.delete(ev.code); if (ROT_KEYS[ev.code]) rotEnd('k' + ev.code, true); });
addEventListener('blur', () => { keys.clear(); rotClear(); });

// Mouse / touch: left drag grabs the ground and moves the landscape as a block (map style); right drag
// (or Ctrl/Alt + left drag) looks around; middle drag (or Shift + right drag) orbits the grabbed point.
// Plan view: left drag pans, right drag turns the heading. Touch: one finger grabs, two fingers pinch to
// zoom, twist to turn and drag up/down together to tilt.
const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
let drag = null; // { id, mode: 'grab'|'look'|'orbit', x, y, moved, P (grabbed ground point), t0 }
const touches = new Map(); // pointerId -> { x, y }
let pinch = null;
const _o = new THREE.Vector3(), _d = new THREE.Vector3();
// A view ray through a pixel for the camera at flight.pos with the current heading (cam may lag a frame).
function viewRay(clientX, clientY) {
  applyCamera();
  cam.updateMatrixWorld();
  ndc.set(clientX / innerWidth * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, cam);
  _o.copy(ray.ray.origin); _d.copy(ray.ray.direction);
}
function startDrag(ev, mode) {
  restoreFov();
  drag = { id: ev.pointerId, mode, x: ev.clientX, y: ev.clientY, moved: 0, P: null, auto: !!(flyAnim || tour) };
  if (mode === 'grab' || mode === 'orbit') {
    const hit = groundHit(ev.clientX, ev.clientY);
    if (hit) { drag.P = hit; drag.t0 = hit.distanceTo(flight.pos); }
    else if (mode === 'grab' && !plan) drag.mode = 'look'; // sky under the pointer: nothing to grab
  }
  canvas.setPointerCapture(ev.pointerId);
  canvas.classList.add('drag');
}
// Move the camera horizontally so the grabbed point sits under the pointer again.
function grabTo(clientX, clientY) {
  const P = drag.P;
  if (!P) { // plan view fallback: metres per pixel at the ground below
    const dx = clientX - drag.x, dy = clientY - drag.y;
    const agl = flight.pos.y - groundOr(flight.pos.x, flight.pos.z, flight.pos.y - 300);
    const mpp = 2 * agl * Math.tan(cam.fov * DEG / 2) / innerHeight;
    const c = Math.cos(flight.yaw), sn = Math.sin(flight.yaw);
    flight.pos.x -= (dx * c - dy * sn) * mpp; flight.pos.z -= (dx * sn + dy * c) * mpp;
    return;
  }
  viewRay(clientX, clientY);
  // Shallow rays would meet the grab plane near the horizon: cap the reach at 4x the grab distance
  // (and at least 300 m), so a drag toward the horizon slides steadily instead of flinging off.
  const tMax = Math.max(4 * drag.t0, 300);
  let t = _d.y < -1e-4 ? (P.y - _o.y) / _d.y : Infinity;
  if (!(t > 0) || t > tMax) t = tMax;
  const qx = _o.x + _d.x * t, qz = _o.z + _d.z * t;
  flight.pos.x += P.x - qx; flight.pos.z += P.z - qz;
}
function lookBy(dx, dy, touchK) {
  const k = 0.0032 * (cam.fov / 60) * (touchK || 1);
  flight.yaw -= dx * k;
  if (!plan) flight.pitch = THREE.MathUtils.clamp(flight.pitch - dy * k, -1.52, 1.52);
}
// Orbit the camera around ground point P: yaw by dYaw, raise/lower the view by dTilt (radians).
function orbitAround(P, dYaw, dTilt) {
  const v = flight.pos.clone().sub(P);
  const c = Math.cos(dYaw), sn = Math.sin(dYaw);
  const vx = v.x * c - v.z * sn, vz = v.x * sn + v.z * c;
  v.x = vx; v.z = vz;
  flight.yaw += dYaw;
  if (dTilt && !plan) {
    const hd = Math.hypot(v.x, v.z), r = v.length();
    const el = Math.atan2(v.y, hd);
    const el2 = THREE.MathUtils.clamp(el + dTilt, 3 * DEG, 85 * DEG);
    const s2 = Math.cos(el2) * r / Math.max(hd, 1e-6);
    v.x *= s2; v.z *= s2; v.y = Math.sin(el2) * r;
    flight.pitch = THREE.MathUtils.clamp(flight.pitch - (el2 - el), -1.52, 1.52);
  }
  flight.pos.copy(P).add(v);
}
canvas.addEventListener('pointerdown', (ev) => {
  if (ev.pointerType === 'touch') {
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    canvas.setPointerCapture(ev.pointerId);
    if (touches.size === 1) startDrag(ev, 'grab');
    else if (touches.size === 2) { drag = null; canvas.classList.remove('drag'); pinch = pinchState(); }
    return;
  }
  let mode = null;
  if (ev.button === 0) mode = (ev.ctrlKey || ev.altKey || ev.metaKey) ? 'look' : 'grab';
  else if (ev.button === 2) mode = (ev.shiftKey && !plan) ? 'orbit' : 'look';
  else if (ev.button === 1) { mode = plan ? 'look' : 'orbit'; ev.preventDefault(); }
  if (!mode) return;
  startDrag(ev, mode);
});
function pinchState() {
  const [a, b] = [...touches.values()];
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  return { mx, my, dist: Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1), ang: Math.atan2(b.y - a.y, b.x - a.x), P: groundHit(mx, my) };
}
canvas.addEventListener('pointermove', (ev) => {
  if (ev.pointerType === 'touch' && touches.has(ev.pointerId)) {
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (touches.size >= 2 && pinch) {
      const n = pinchState(), o = pinch;
      cancelAuto();
      // pinch: move along the view ray to the point between the fingers, keeping the same share of the distance
      const hit = o.P;
      if (hit) {
        const f = o.dist / n.dist; // < 1 when spreading (zoom in)
        const v = flight.pos.clone().sub(hit);
        const len = v.length();
        const len2 = THREE.MathUtils.clamp(len * f, 8, 60000);
        flight.pos.copy(hit).addScaledVector(v, len2 / Math.max(len, 1e-6));
        let dA = n.ang - o.ang; if (dA > Math.PI) dA -= 2 * Math.PI; if (dA < -Math.PI) dA += 2 * Math.PI;
        orbitAround(hit, -dA, plan ? 0 : (n.my - o.my) * 0.004);
      } else lookBy(n.mx - o.mx, n.my - o.my, 1.3);
      pinch = { ...n, P: hit || n.P };
      return;
    }
  }
  if (!drag || ev.pointerId !== drag.id) return;
  const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  if (!drag.live) {
    if (drag.moved <= 3) return; // a click, not a drag: leave any flight or tour running
    // Start of a real drag: stop flights and the tour, and take the ground point under the pointer now
    // (the camera may have moved since the button went down).
    drag.live = true;
    if (drag.auto) { // the camera was moving: grab what is under the pointer now
      cancelAuto();
      if (drag.mode === 'grab' || drag.mode === 'orbit') {
        const hit = groundHit(ev.clientX, ev.clientY);
        if (hit) { drag.P = hit; drag.t0 = hit.distanceTo(flight.pos); }
      }
      drag.x = ev.clientX; drag.y = ev.clientY;
      return;
    }
  }
  if (drag.mode === 'grab') grabTo(ev.clientX, ev.clientY);
  else if (drag.mode === 'orbit' && drag.P) orbitAround(drag.P, -dx * 0.005, dy * 0.004);
  else lookBy(dx, dy, ev.pointerType === 'touch' ? 1.3 : 1);
  drag.x = ev.clientX; drag.y = ev.clientY;
});
const endDrag = (ev) => {
  if (ev.pointerType === 'touch') {
    touches.delete(ev.pointerId);
    if (touches.size < 2) pinch = null;
    if (touches.size === 1 && !drag) { // lift one of two fingers: carry on grabbing with the other
      const [id, t] = [...touches.entries()][0];
      startDrag({ pointerId: id, clientX: t.x, clientY: t.y }, 'grab');
    }
  }
  if (drag && ev.pointerId === drag.id) { drag = null; canvas.classList.remove('drag'); }
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// March a view ray against the ground grids.
const ndc = new THREE.Vector2(), ray = new THREE.Raycaster();
function groundHit(clientX, clientY) {
  applyCamera(); cam.updateMatrixWorld();
  ndc.set(clientX / innerWidth * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, cam);
  const o = ray.ray.origin, d = ray.ray.direction;
  let prev = 0;
  for (let t = 1; t < 120000; t += Math.max(2, t * 0.01)) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    const h = heightAt(x, z);
    if (h == null) { if (x < BOUNDS.x0 || x > BOUNDS.x1 || z < BOUNDS.z0 || z > BOUNDS.z1) return null; prev = t; continue; }
    if (y <= h) {
      let lo = prev, hi = t;
      for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; const hh = heightAt(o.x + d.x * m, o.z + d.z * m); if (hh != null && o.y + d.y * m <= hh) hi = m; else lo = m; }
      return new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
    }
    prev = t;
  }
  return null;
}
canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  cancelAuto();
  const hit = groundHit(ev.clientX, ev.clientY);
  const dir = ray.ray.direction.clone();
  const sign = ev.deltaY < 0 ? 1 : -1;
  const dist = hit ? hit.distanceTo(flight.pos) : baseSpeed * 20;
  let step = dist * 0.15 * sign;
  if (hit && sign > 0) step = Math.min(step, Math.max(0, dist - 6));
  flight.pos.addScaledVector(dir, step);
}, { passive: false });
canvas.addEventListener('dblclick', (ev) => {
  const hit = groundHit(ev.clientX, ev.clientY);
  if (!hit) return;
  cancelAuto();
  const d = hit.distanceTo(flight.pos);
  const from = Math.atan2(flight.pos.x - hit.x, -(flight.pos.z - hit.z)) / DEG;
  const dist = THREE.MathUtils.clamp(d * 0.35, 40, 700);
  leavePlan();
  flyTo(poseAround(hit.x, hit.z, { dist, fromDeg: from, up: dist * 0.45, look: 2 }));
});

// Touch: the stick moves (up/down = forward/back, left/right = turn); buttons climb and sink. Dragging elsewhere
// grabs the ground (one finger) or pinches, twists and tilts (two fingers), as above.
{
  const stick = document.getElementById('stick'), knob = document.getElementById('knob');
  let sid = null, cx = 0, cy = 0;
  const move = (ev) => {
    if (ev.pointerId !== sid) return;
    let dx = ev.clientX - cx, dy = ev.clientY - cy;
    const l = Math.hypot(dx, dy), R = 55;
    if (l > R) { dx *= R / l; dy *= R / l; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    touch.fwd = -dy / R; touch.turn = dx / R;
  };
  stick.addEventListener('pointerdown', (ev) => { sid = ev.pointerId; const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; stick.setPointerCapture(sid); cancelAuto(); move(ev); });
  stick.addEventListener('pointermove', move);
  const end = (ev) => { if (ev.pointerId !== sid) return; sid = null; touch.fwd = 0; touch.turn = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  for (const [id, v] of [['tUp', 1], ['tDown', -1]]) {
    const b = document.getElementById(id);
    b.addEventListener('pointerdown', (ev) => { touch.up = v; b.setPointerCapture(ev.pointerId); cancelAuto(); });
    const off = () => { touch.up = 0; };
    b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off);
  }
}

// ---------------------------------------------------------------- flight pad (new layout)
// Bottom right, desktop and touch: a round pad (press and hold: forward/back/sideways; drag for an analogue
// move), a centre ball (drag: turn and tilt, faster the further it is pulled), climb/sink buttons and a x4
// speed toggle. Each part carries its keyboard key. ?ui=classic (or the Layout buttons) brings back the old
// help text and touch stick; the pad can be hidden and shown again.
{
  const body = document.body, qs = new URLSearchParams(location.search);
  const setUi = (classic, push) => {
    body.classList.toggle('ui-classic', classic);
    document.getElementById('uiNew').classList.toggle('active', !classic);
    document.getElementById('uiClassic').classList.toggle('active', classic);
    if (push) { const u = new URL(location.href); if (classic) u.searchParams.set('ui', 'classic'); else u.searchParams.delete('ui'); history.replaceState(null, '', u); }
  };
  setUi(qs.get('ui') === 'classic', false);
  document.getElementById('uiNew').onclick = () => setUi(false, true);
  document.getElementById('uiClassic').onclick = () => setUi(true, true);
  let hidden = false; try { hidden = localStorage.getItem('flyover-pad-hidden') === '1'; } catch (e) {}
  const setHidden = (h) => { body.classList.toggle('joy-hidden', h); try { localStorage.setItem('flyover-pad-hidden', h ? '1' : '0'); } catch (e) {} };
  setHidden(hidden);
  document.getElementById('joyHide').onclick = () => setHidden(true);
  document.getElementById('joyShow').onclick = () => setHidden(false);
  const joy = document.getElementById('joy'), padEl = document.getElementById('joyPad'), ball = document.getElementById('joyBall'), dot = document.getElementById('joyDot');
  const R = 58, BR = 34;
  let mv = null, lk = null;
  const padVec = (ev) => {
    const r = padEl.getBoundingClientRect();
    let dx = ev.clientX - (r.left + r.width / 2), dy = ev.clientY - (r.top + r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > R) { dx *= R / l; dy *= R / l; }
    return [dx, dy, l];
  };
  padEl.addEventListener('pointerdown', (ev) => {
    if (ev.target === ball) return;
    ev.preventDefault(); ev.stopPropagation();
    mv = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, drag: false };
    padEl.setPointerCapture(ev.pointerId); cancelAuto(); joy.classList.add('on');
    // A press is a full-strength move in the pressed direction (the nearest of the four); dragging makes it analogue.
    const [dx, dy] = padVec(ev);
    if (Math.abs(dy) >= Math.abs(dx)) { pad.fwd = dy < 0 ? 1 : -1; pad.str = 0; } else { pad.str = dx > 0 ? 1 : -1; pad.fwd = 0; }
    dot.style.display = 'block'; dot.style.transform = `translate(${dx}px,${dy}px)`;
  });
  padEl.addEventListener('pointermove', (ev) => {
    if (!mv || ev.pointerId !== mv.id) return;
    if (!mv.drag && Math.hypot(ev.clientX - mv.x0, ev.clientY - mv.y0) < 6) return;
    mv.drag = true;
    const [dx, dy] = padVec(ev);
    const k = (v) => { const a = Math.abs(v) / R; return Math.sign(v) * (a < 0.12 ? 0 : (a - 0.12) / 0.88); };
    pad.fwd = -k(dy); pad.str = k(dx);
    dot.style.transform = `translate(${dx}px,${dy}px)`;
  });
  const endMv = (ev) => { if (!mv || ev.pointerId !== mv.id) return; mv = null; pad.fwd = 0; pad.str = 0; dot.style.display = 'none'; joy.classList.remove('on'); };
  padEl.addEventListener('pointerup', endMv); padEl.addEventListener('pointercancel', endMv); padEl.addEventListener('lostpointercapture', endMv);
  ball.addEventListener('pointerdown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    lk = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY };
    ball.setPointerCapture(ev.pointerId); cancelAuto(); joy.classList.add('on');
  });
  ball.addEventListener('pointermove', (ev) => {
    if (!lk || ev.pointerId !== lk.id) return;
    let dx = ev.clientX - lk.x0, dy = ev.clientY - lk.y0;
    const l = Math.hypot(dx, dy); if (l > BR) { dx *= BR / l; dy *= BR / l; }
    ball.style.transform = `translate(${dx}px,${dy}px)`;
    const k = (v) => { const a = Math.abs(v) / BR; return Math.sign(v) * (a < 0.1 ? 0 : (a - 0.1) / 0.9); };
    pad.turn = k(dx); pad.tilt = -k(dy);
  });
  const endLk = (ev) => { if (!lk || ev.pointerId !== lk.id) return; lk = null; pad.turn = 0; pad.tilt = 0; ball.style.transform = ''; joy.classList.remove('on'); };
  ball.addEventListener('pointerup', endLk); ball.addEventListener('pointercancel', endLk); ball.addEventListener('lostpointercapture', endLk);
  for (const [id, v] of [['jUp', 1], ['jDown', -1]]) {
    const b = document.getElementById(id);
    b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); pad.up = v; b.setPointerCapture(ev.pointerId); b.classList.add('active'); cancelAuto(); });
    const off = () => { pad.up = 0; b.classList.remove('active'); };
    b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
  }
  // Nothing may stay stuck on if the window loses focus mid-press.
  addEventListener('blur', () => { mv = lk = null; pad.fwd = pad.str = pad.turn = pad.tilt = pad.up = 0; dot.style.display = 'none'; ball.style.transform = ''; joy.classList.remove('on'); });
  const fastB = document.getElementById('jFast');
  fastB.onclick = () => { pad.fast = !pad.fast; fastB.classList.toggle('active', pad.fast); fastB.setAttribute('aria-pressed', String(pad.fast)); };
  // Keys light the matching part of the pad.
  const lit = () => { const k = (c) => keys.has(c); fastB.classList.toggle('active', pad.fast || k('ShiftLeft') || k('ShiftRight'));
    document.getElementById('jUp').classList.toggle('active', pad.up > 0 || k('KeyE') || k('KeyR'));
    document.getElementById('jDown').classList.toggle('active', pad.up < 0 || k('KeyQ') || k('KeyF')); };
  addEventListener('keydown', lit); addEventListener('keyup', lit);
  joy.addEventListener('contextmenu', (ev) => ev.preventDefault());
  FLY.pad = pad;
}

// ---------------------------------------------------------------- turning the view
// The compass (top right) is the turn control, as in Google Earth: drag the ring (or the knob by its N) round
// like a dial and the view turns with it; click or tap it (or press N) to face north. Focused, it is a slider:
// left/right arrows or Q/E turn 15 degrees, Page Up/Down 45, Home (Enter, Space) faces north. When the view looks
// down at the ground the turn goes round the ground point at the centre of the view; looking level or up (eye
// height, the alignment view) or in plan view it turns on the spot. During a flight or the tour the whole
// path turns round its destination, so the tour carries on. Reduced motion: key and north turns jump.
const ROT_KEYS = { ArrowLeft: -1, ArrowRight: 1 };
const ROT_SPEED = 60 * DEG, ROT_STEP = 15 * DEG;
const rot = { src: new Map(), pending: 0, pivot: null, pivotFor: null, held: 0, done: 0, repeatAt: 0, drag: null };
const wrapPi = (a) => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
function rotDir() { let d = 0; for (const v of rot.src.values()) d += v; return Math.sign(d); }
function rotStart(key, dir) {
  if (rot.src.has(key)) return;
  rot.src.set(key, dir); rot.held = 0; rot.done = 0; rot.repeatAt = 0.45;
  if (REDUCED_MOTION.matches) rotateNow(dir * ROT_STEP);
}
// End a hold; a quick tap still turns a full step.
function rotEnd(key, tapStep) {
  const dir = rot.src.get(key); if (dir == null) return;
  rot.src.delete(key);
  if (tapStep && !REDUCED_MOTION.matches && rot.held < 0.3 && Math.abs(rot.done) < ROT_STEP) rot.pending += dir * (ROT_STEP - Math.abs(rot.done));
}
function rotClear() { rot.src.clear(); rot.drag = null; }
function rotStep(dir, step = ROT_STEP) { if (REDUCED_MOTION.matches) rotateNow(dir * step); else rot.pending += dir * step; }
// Face true north (true heading = grid heading + convergence); during a flight, its destination faces north.
function resetNorth() {
  const q = flyAnim ? flyAnim.to : flight;
  flight.yawRate = 0; // no arrow-key turn left coasting past north
  const conv = FS.convergenceAt(CE + q.pos.x, CN - q.pos.z);
  const d = wrapPi(-conv * DEG - q.yaw) - (flyAnim ? 0 : rot.pending);
  if (REDUCED_MOTION.matches) { rot.pending = 0; rotateNow(d); } else rot.pending += d;
}
// The ground point at the centre of the view, if the view looks down at the ground within reach.
function freePivot() {
  if (plan || flight.pitch > -3 * DEG) return null;
  const hit = groundHit(innerWidth / 2, innerHeight / 2);
  if (!hit || Math.hypot(hit.x - flight.pos.x, hit.z - flight.pos.z) > 6000) return null;
  return hit;
}
// The same for the pose a flight is heading to.
function animPivot(A) {
  const q = A.to;
  if (plan || q.pitch > -3 * DEG) return null;
  const agl = q.pos.y - groundOr(q.pos.x, q.pos.z, q.pos.y - 50);
  const h = Math.min(6000, Math.max(0, agl) / Math.tan(-q.pitch));
  return new THREE.Vector3(q.pos.x + Math.sin(q.yaw) * h, 0, q.pos.z - Math.cos(q.yaw) * h);
}
function spinPose(q, P, d) {
  if (P) {
    const vx = q.pos.x - P.x, vz = q.pos.z - P.z, c = Math.cos(d), sn = Math.sin(d);
    q.pos.x = P.x + vx * c - vz * sn; q.pos.z = P.z + vx * sn + vz * c;
  }
  q.yaw += d;
}
// Turn the view by d radians (positive: to the right, heading increases).
function rotateNow(d) {
  const key = flyAnim || 'free';
  if (rot.pivotFor !== key) {
    rot.pivotFor = key;
    if (flyAnim) { flyAnim.to = { ...flyAnim.to, pos: flyAnim.to.pos.clone() }; rot.pivot = animPivot(flyAnim); }
    else rot.pivot = freePivot();
  }
  if (flyAnim) { spinPose(flyAnim.from, rot.pivot, d); spinPose(flyAnim.to, rot.pivot, d); spinPose(flight, rot.pivot, d); }
  else if (rot.pivot) orbitAround(rot.pivot, d, 0);
  else flight.yaw += d;
}
function stepRotate(dt) {
  const dir = rotDir(), still = REDUCED_MOTION.matches;
  let d = 0;
  if (dir) {
    rot.held += dt;
    if (still) { if (rot.held >= rot.repeatAt) { d += dir * ROT_STEP; rot.repeatAt += 0.4; } }
    else d += dir * ROT_SPEED * Math.min(1, 0.35 + rot.held / 0.35) * dt;
    rot.done += d;
  }
  if (rot.pending) {
    if (still) { d += rot.pending; rot.pending = 0; }
    else {
      let take = rot.pending * (1 - Math.exp(-dt / 0.12));
      const minT = 25 * DEG * dt;
      if (Math.abs(take) < minT) take = Math.sign(rot.pending) * Math.min(minT, Math.abs(rot.pending));
      d += take; rot.pending -= take;
      if (Math.abs(rot.pending) < 1e-5) rot.pending = 0;
    }
  }
  if (d) rotateNow(d);
  if (!dir && !rot.pending && !rot.drag) rot.pivotFor = null;
}
{
  const cb = document.getElementById('compassCtl');
  if (cb) {
    let swallow = false;
    const ang = (ev) => { const r = cb.getBoundingClientRect(); const x = ev.clientX - (r.left + r.width / 2), y = ev.clientY - (r.top + r.height / 2); return { a: Math.atan2(y, x), l: Math.hypot(x, y) }; };
    cb.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault(); swallow = false; cb.setPointerCapture(ev.pointerId);
      const { a } = ang(ev);
      rot.drag = { id: ev.pointerId, a, x0: ev.clientX, y0: ev.clientY, live: false };
    });
    cb.addEventListener('pointermove', (ev) => {
      const g = rot.drag; if (!g || ev.pointerId !== g.id) return;
      const { a, l } = ang(ev);
      if (!g.live) { if (Math.hypot(ev.clientX - g.x0, ev.clientY - g.y0) < 5) return; g.live = true; cb.classList.add('drag'); restoreFov(); }
      // The rose turns with the pointer (a dial): clockwise on screen turns the heading anticlockwise.
      if (l > 6) rotateNow(-wrapPi(a - g.a));
      g.a = a;
    });
    const end = (ev) => { const g = rot.drag; if (!g || ev.pointerId !== g.id) return; if (g.live) swallow = true; rot.drag = null; cb.classList.remove('drag'); };
    cb.addEventListener('pointerup', end); cb.addEventListener('pointercancel', end); cb.addEventListener('lostpointercapture', end);
    cb.addEventListener('click', () => { if (swallow) { swallow = false; return; } resetNorth(); });
    cb.addEventListener('contextmenu', (ev) => ev.preventDefault());
    // Slider keys while focused (they do not reach the flight keys).
    const CK = { ArrowLeft: -1, KeyQ: -1, ArrowRight: 1, KeyE: 1, PageUp: -3, PageDown: 3 };
    cb.addEventListener('keydown', (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const k = CK[ev.code];
      if (k) { rotStep(Math.sign(k), Math.abs(k) * ROT_STEP); }
      else if (ev.code === 'Home' || ev.code === 'Enter' || ev.code === 'Space' || ev.code === 'KeyN') { if (!ev.repeat) resetNorth(); }
      else return;
      ev.preventDefault(); ev.stopPropagation();
    });
  }
}

function stepFlight(dt) {
  const has = (c) => keys.has(c);
  const fast = (has('ShiftLeft') || has('ShiftRight') || pad.fast) ? 4 : 1;
  // Faster high up (keys and pad), so a climb to the 30 km ceiling, or a pan up there, does not take minutes.
  const gH = heightAt(flight.pos.x, flight.pos.z), aglNow = flight.pos.y - (gH == null ? 0 : gH);
  const sp = baseSpeed * fast * Math.max(1, aglNow / 400);
  const fwd = (has('KeyW') || has('ArrowUp') ? 1 : 0) - (has('KeyS') || has('ArrowDown') ? 1 : 0) + touch.fwd + pad.fwd;
  const str = (has('KeyD') ? 1 : 0) - (has('KeyA') ? 1 : 0) + pad.str;
  const turn = (has('ArrowRight') ? 1 : 0) - (has('ArrowLeft') ? 1 : 0) + touch.turn + pad.turn;
  const up = (has('KeyE') || has('KeyR') ? 1 : 0) - (has('KeyQ') || has('KeyF') ? 1 : 0) + touch.up + pad.up;
  if (pad.tilt) flight.pitch = THREE.MathUtils.clamp(flight.pitch + pad.tilt * 0.9 * dt, -1.52, 1.52);
  const f = new THREE.Vector3(Math.sin(flight.yaw), 0, -Math.cos(flight.yaw));
  const r = new THREE.Vector3(Math.cos(flight.yaw), 0, Math.sin(flight.yaw));
  const target = f.multiplyScalar(fwd * sp).addScaledVector(r, str * sp);
  target.y = up * sp * 0.6;
  flight.vel.lerp(target, 1 - Math.exp(-dt / 0.25));
  flight.yawRate += (turn * 1.1 - flight.yawRate) * (1 - Math.exp(-dt / 0.15));
  flight.yaw += flight.yawRate * dt;
  flight.pos.addScaledVector(flight.vel, dt);
}
// Keep inside the map and never below the lowest height above the ground.
function clampFlight() {
  const p = flight.pos;
  p.x = THREE.MathUtils.clamp(p.x, BOUNDS.x0, BOUNDS.x1);
  p.z = THREE.MathUtils.clamp(p.z, BOUNDS.z0, BOUNDS.z1);
  const g = heightAt(p.x, p.z);
  const floor = (g == null ? -9 : g) + minAgl;
  if (p.y < floor) { p.y = floor; if (flight.vel.y < 0) flight.vel.y = 0; }
  if (p.y > MAX_H) { p.y = MAX_H; if (flight.vel.y > 0) flight.vel.y = 0; }
  return g;
}

// ---------------------------------------------------------------- places and tour
// Each place is framed from the south-west, looking north-east toward the midsummer sunrise.
const PLACES = {
  sh: { x: 0, z: 0, dist: 115, fromDeg: 230, up: 32, look: 3 },
  wh: { x: centre.x, z: centre.z, dist: 140, fromDeg: 230, up: 45, look: 3 },
};
if (BU) { const b = localXZ(BU.origin_e, BU.origin_n); PLACES.bu = { x: b.x - 25, z: b.z + 10, dist: 125, fromDeg: 230, up: 32, look: 2 }; }
function paintPlace(key) {
  for (const [id, k] of [['goSH', 'sh'], ['goWH', 'wh'], ['goBU', 'bu']]) document.getElementById(id).classList.toggle('active', key === k);
  document.getElementById('goTour').classList.toggle('active', key === 'tour');
}
function goPlace(key) {
  cancelAuto();
  leavePlan();
  paintPlace(key);
  if (key === 'bu' && BU_AXIS) {
    // Eye height (1.6 m) a few metres behind the SW post, looking NE along the post line.
    if (minAgl > 1.5) { minAgl = 1.5; document.getElementById('minAgl').value = '1.5'; document.getElementById('minLbl').textContent = '1.5 m'; }
    const bp = buAxisPose('ne');
    flyTo(bp.pose, { onDone: () => { if (bp.fov) setFov(bp.fov); arrived(); } });
    return;
  }
  const s = PLACES[key];
  flyTo(poseAround(s.x, s.z, s), { onDone: arrived });
}
// Eye point on the Bulford post axis: AXIS_BACK m behind the near post ('ne': SW of post 8647 looking NE;
// 'sw': NE of post 9019 looking SW), AXIS_SIDE m to the right so the near post does not hide the far one,
// 1.6 m above the ground. The view is turned to frame both posts and, if given, the event (grid azimuth);
// on a narrow screen the field of view is widened just enough to fit them.
const AXIS_BACK = 4, AXIS_SIDE = 0.8;
function buAxisPose(end, eventGridAz, eventAlt = 0.5) {
  const A = BU_AXIS, near = end === 'ne' ? A.a : A.b, far = end === 'ne' ? A.b : A.a, sgn = end === 'ne' ? -1 : 1, side = end === 'ne' ? 1 : -1;
  const x = near.x + sgn * A.ux * AXIS_BACK - side * A.uz * AXIS_SIDE;
  const z = near.z + sgn * A.uz * AXIS_BACK + side * A.ux * AXIS_SIDE;
  const brg = (q) => Math.atan2(q.x - x, -(q.z - z)) / DEG;
  const lookGrid = (end === 'ne' ? A.az : A.az + 180) - FS.convergenceAt(CE + x, CN - z);
  const rel = (b) => ((b - lookGrid + 540) % 360) - 180;
  const nearHalf = Math.atan2(0.35, Math.hypot(near.x - x, near.z - z)) / DEG;
  const pts = [rel(brg(near)) - nearHalf, rel(brg(near)) + nearHalf, rel(brg(far))];
  if (eventGridAz != null) pts.push(rel(eventGridAz));
  const lo = Math.min(...pts), hi = Math.max(...pts), mid = (lo + hi) / 2, span = hi - lo + 10;
  const gy = groundOr(x, z, 0), eyeY = gy + 1.6;
  // Vertically: the whole near post (base to top) and the horizon / event.
  const fN = end === 'ne' ? A.fa : A.fb, hN = end === 'ne' ? A.ha : A.hb, dN = Math.hypot(near.x - x, near.z - z);
  const topA = Math.atan2(fN.ground - ORIGIN_OD + hN - eyeY, dN) / DEG, botA = Math.atan2(fN.ground - ORIGIN_OD - eyeY, dN) / DEG;
  const vHi = Math.max(topA, eventAlt + 1), vLo = Math.min(botA, eventAlt - 1), vSpan = vHi - vLo + 6;
  const hfov = 2 * Math.atan(Math.tan(30 * DEG) * cam.aspect) / DEG;
  const fovH = span > hfov ? 2 * Math.atan(Math.tan(span / 2 * DEG) / cam.aspect) / DEG : 60;
  const fovV = Math.max(60, vSpan);
  const fovNeed = Math.max(fovH, fovV);
  const fov = fovNeed > 60.5 ? Math.min(100, fovNeed) : null;
  const pitch = (vHi + vLo) / 2;
  return { x, z, gy, pose: { pos: new THREE.Vector3(x, eyeY, z), yaw: (lookGrid + mid) * DEG, pitch: pitch * DEG }, fov, nearId: (end === 'ne' ? A.fa : A.fb).id, farId: (end === 'ne' ? A.fb : A.fa).id };
}
// A field of view widened for an alignment frame; back to 60 degrees when the user takes over.
let wideFov = false;
function setFov(v) { cam.fov = v; cam.updateProjectionMatrix(); wideFov = v !== 60; }
function restoreFov() { if (wideFov) setFov(60); }
function arrived() {
  if (document.getElementById('retime').checked && bodyMode !== 'off' && !skyPlay && !manualTime) { pendingSeek = true; autoSeekPending = true; }
}
document.getElementById('goSH').onclick = () => goPlace('sh');
document.getElementById('goWH').onclick = () => goPlace('wh');
document.getElementById('goBU').onclick = () => goPlace('bu');

// Tour stops as data: target (OSGB E, N), camera distance, grid bearing target to camera, height, hold, caption.
const TOUR = [
  { en: [412245.35, 142194.11], dist: 5200, fromDeg: 200, up: 1700, look: 30, hold: 4.5, title: 'Chalk between two rivers', date: 'The ground',
    text: 'Twelve kilometres of Environment Agency lidar ground, with Ordnance Survey Terrain 50 out to the horizon. The Till runs down the west side, the Avon down the east.' },
  { en: [412245.35, 142194.11], dist: 900, fromDeg: 230, up: 210, look: 10, hold: 5, title: 'Stonehenge', date: 'c. 2500 BC',
    text: 'The ditch and bank are older, dug about 3000 BC. The sarsens came five centuries later.' },
  { en: [412245.35, 142194.11], dist: 150, fromDeg: 230, up: 22, look: 6, hold: 5, title: 'Along the axis', date: 'c. 2500 BC',
    text: 'Looking out through the entrance toward the midsummer sunrise.' },
  { en: [410900, 142960], dist: 1500, fromDeg: 200, up: 400, look: 6, hold: 5, title: 'The Greater Cursus', date: 'c. 3500 BC',
    text: 'Almost three kilometres of bank and ditch running east to west, a thousand years older than Stonehenge. Outline from Historic England aerial mapping.' },
  { en: [412700, 141300], dist: 1100, fromDeg: 170, up: 280, look: 8, hold: 5, title: 'Barrow cemeteries', date: 'c. 2400 – 1600 BC',
    text: 'Round barrows set along the ridges that overlook Stonehenge. Mounds from Historic England aerial mapping.' },
  { en: [415010, 143721], dist: 900, fromDeg: 200, up: 320, look: 12, hold: 5, title: 'Durrington Walls and Woodhenge', date: 'c. 2500 BC',
    text: 'The great henge beside the Avon, with Woodhenge just to the south.' },
  { en: [P.centre.e, P.centre.n], dist: 140, fromDeg: 230, up: 45, look: 3, hold: 5.5, title: 'Woodhenge', date: 'c. 2635 – 2575 BC',
    text: 'Six oval rings of timber posts, 156 in this model after Maud Cunnington\u2019s plan, with the later bank and ditch around them. No posts survive: the post heights are conjecture.' },
];
if (BU) TOUR.push({ en: [BU.origin_e - 25, BU.origin_n - 10], dist: 125, fromDeg: 230, up: 32, look: 2, hold: 6, title: 'Bulford', date: 'Posts: conjecture',
  text: 'Pits and two post-pits, from the PAST 113 plan. The posts drawn in them are conjecture (1.6 m above ground). The line through the two post positions runs at ' + (BU_POSTS_TRUE ? BU_POSTS_TRUE.true.toFixed(1) : '48.3') + '\u00b0 true, about two degrees south of the modern midsummer sunrise.' });
const capEl = document.getElementById('caption');
function showCaption(s) {
  document.getElementById('capTitle').textContent = s ? s.title : '';
  document.getElementById('capDate').textContent = s ? s.date : '';
  document.getElementById('capText').textContent = s ? s.text : '';
  capEl.classList.toggle('show', !!s);
}
function tourGo(i) {
  if (!tour) return;
  if (i >= TOUR.length) { stopTour(); return; }
  tour.i = i;
  const s = TOUR[i];
  const p = localXZ(s.en[0], s.en[1]);
  showCaption(s);
  flyTo(poseAround(p.x, p.z, s), { dur: i === 0 ? 3 : undefined, onDone: () => { if (tour) tour.holdLeft = s.hold; } });
}
function startTour() { cancelAuto(); leavePlan(); tour = { i: 0, holdLeft: null, paused: false }; paintPlace('tour'); tourGo(0); }
function stopTour() { tour = null; showCaption(null); paintPlace(null); }
function stepTour(dt) {
  if (!tour || flyAnim || tour.holdLeft == null || tour.paused) return;
  tour.holdLeft -= dt;
  if (tour.holdLeft <= 0) { tour.holdLeft = null; tourGo(tour.i + 1); }
}
document.getElementById('goTour').onclick = () => { if (tour) stopTour(); else startTour(); };

// ---------------------------------------------------------------- sun and moon from the camera
const readout = document.getElementById('readout');
const DISC_VERT = `varying vec3 vWorld; varying float vRad;
  void main(){ vRad = length(position.xy); vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const DISC_FRAG = `precision highp float; varying vec3 vWorld; varying float vRad;
  uniform vec3 discCenter; uniform vec3 color; uniform float glow; uniform float moonMode; uniform float phaseCos; uniform vec3 sunInDisc; uniform float discRadius;
  void main(){
    vec3 col = color; float alpha = 1.0;
    if (moonMode > 0.5) { float along = dot(vWorld - discCenter, sunInDisc) / max(discRadius, 0.001); float lit = smoothstep(-0.04, 0.04, along + phaseCos); col = mix(color * 0.07, color, lit); }
    if (glow > 0.5) { alpha = (1.0 - smoothstep(0.55, 1.0, vRad)) * 0.42; if (alpha < 0.02) discard; }
    gl_FragColor = vec4(col, alpha);
  }`;
// Discs sit 100 km out along the true direction (turned into the grid frame), with the depth test on,
// so the real ground hides them wherever the camera is.
function makeDisc(hex, glow) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { discCenter: { value: new THREE.Vector3() }, color: { value: new THREE.Color(hex) }, glow: { value: glow ? 1 : 0 }, moonMode: { value: 0 },
      phaseCos: { value: 1 }, sunInDisc: { value: new THREE.Vector3(1, 0, 0) }, discRadius: { value: 1 } },
    vertexShader: DISC_VERT, fragmentShader: DISC_FRAG,
    transparent: true, depthTest: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 96), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = glow ? 19 : 20;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
}
const sunDisc = makeDisc(0xfff6c8, false), sunGlow = makeDisc(0xffc14d, true), moonDisc = makeDisc(0xe8eef8, false);

// 'Modern' is this year (the viewer's clock); years are astronomical (0 = 1 BC, -2499 = 2500 BC).
const MODERN_YEAR = new Date().getUTCFullYear();
// A typed year: any whole number, including 0; only an empty or non-numeric entry falls back.
function parseYear(v, fallback) {
  const t = String(v == null ? '' : v).trim();
  if (t === '' || !/^[-+]?\d+(\.\d*)?$/.test(t)) return fallback;
  const y = Math.trunc(+t);
  return Number.isFinite(y) ? Math.max(-9999, Math.min(9999, y)) : fallback;
}
let epochYear = MODERN_YEAR, doy = 172, minuteUt = 237;
let bodyMode = 'sunrise', limb = 'first_gleam';
let skyPlay = false, playEnd = null;
let pendingSeek = true, autoSeekPending = true, manualTime = false;
let lastSeek = null;

function doyToYMD(d, year) {
  const md = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let n = Math.max(1, Math.min(md.reduce((a, b) => a + b, 0), Math.round(+d) || 1));
  let m = 0;
  while (m < 12 && n > md[m]) { n -= md[m]; m++; }
  return { month: m + 1, day: n };
}
function doyLabel(d) { const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; const ymd = doyToYMD(d, epochYear); return ymd.day + ' ' + names[ymd.month - 1]; }
function formatClock(min) {
  const dayOver = min >= 1440 ? Math.floor(min / 1440) : 0;
  let m = min; if (m < 0) m += 1440;
  const h = Math.floor((m % 1440) / 60), mm = Math.floor(m % 60);
  let ut = String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ' UT';
  if (dayOver > 0) ut += ' +' + dayOver + 'd';
  if (epochYear >= 1970 && epochYear <= 2100) {
    try { const uk = FS.dateFromDoyMinute(epochYear, doy, min).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }); return uk + ' UK · ' + ut; } catch (e) { /* UT only */ }
  }
  return ut;
}
function syncUtUi() {
  const sl = document.getElementById('utMin');
  if (document.activeElement !== sl) sl.value = String(Math.round(Math.min(2160, Math.max(0, minuteUt))));
  document.getElementById('utLbl').textContent = formatClock(minuteUt);
  document.getElementById('doyLbl').textContent = doyLabel(doy);
}
function skyBody() { return (bodyMode === 'moonrise' || bodyMode === 'moonset') ? 'Moon' : 'Sun'; }
function paintSkyButtons() {
  for (const [id, mode] of [['btnSunOff','off'],['btnSunrise','sunrise'],['btnSunset','sunset'],['btnMoonrise','moonrise'],['btnMoonset','moonset']]) document.getElementById(id).classList.toggle('active', bodyMode === mode);
  document.getElementById('btnLimbGleam').classList.toggle('active', limb === 'first_gleam');
  document.getElementById('btnLimbHalf').classList.toggle('active', limb === 'half_orb');
  document.getElementById('btnLimbFull').classList.toggle('active', limb === 'full_orb');
  document.getElementById('btnEpochModern').classList.toggle('active', epochYear === MODERN_YEAR);
  document.getElementById('btnEpoch2500').classList.toggle('active', epochYear === -2499);
}

// Observer at the camera: latitude, longitude, height and grid convergence, refreshed every 20 m of movement.
let camSite = null;
function siteForCamera() {
  const p = flight.pos;
  if (!camSite || Math.hypot(p.x - camSite.x, p.z - camSite.z) > 20 || Math.abs(p.y - camSite.y) > 20) camSite = FS.siteAt(p.x, p.z, p.y);
  return camSite;
}
// Rise/set time for someone standing (eye 1.6 m) on the ground at x,z, against the skyline of the loaded ground
// (align_core.js; the skyline is cached per eye point). Where the ground data stops less than REACH_MIN out
// toward the rise/set point, the skyline there is unknown: near Woodhenge the time then comes from the measured
// Woodhenge skyline (woodhenge/horizon.js), elsewhere it is flagged. The disc is still drawn from the camera.
function seekFrom(x, z, opts) { return aligner.seekFrom(x, z, opts); }
function seekHere() {
  const t0 = performance.now(), made0 = skyStats.made;
  const r = seekFrom(flight.pos.x, flight.pos.z, { body: skyBody(), year: epochYear, doy, rising: bodyMode === 'sunrise' || bodyMode === 'moonrise', limb });
  FLY.seekMs = performance.now() - t0; FLY.seekNewSkyline = skyStats.made > made0;
  if (!r) return false;
  lastSeek = { e: r.site.e, n: r.site.n, hit: r.hit, full: FLY.detailDone, skyline: r.skyline, reach: r.reach, short: r.short };
  if (r.hit) minuteUt = r.hit.minute;
  if (FLY.detailDone) autoSeekPending = false;
  FLY.lastSeek = r.hit ? { e: r.site.e, n: r.site.n, minute: r.hit.minute, geoAz: r.hit.geoAz, sky: r.hit.sky, full: FLY.detailDone, skyline: r.skyline } : null;
  return true;
}
let bodyKey = '', bodyCache = null;
function bodyNow() {
  const site = siteForCamera();
  const key = site.x + ':' + site.z + ':' + site.y + ':' + epochYear + ':' + doy + ':' + minuteUt + ':' + bodyMode;
  if (key !== bodyKey) {
    const body = skyBody();
    const date = FS.dateFromDoyMinute(epochYear, doy, minuteUt);
    const hor = FS.horizontalAt(site, body, date, true);
    const sunHor = body === 'Moon' ? FS.horizontalAt(site, 'Sun', date, true) : hor;
    bodyCache = { body, date, hor, sunHor, site, gridAz: hor.az - site.conv };
    bodyKey = key;
  }
  return bodyCache;
}
function dirFrom(gridAzDeg, altDeg) {
  const az = gridAzDeg * DEG, alt = altDeg * DEG;
  return new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
}
const discPos = new THREE.Vector3(), focus = new THREE.Vector3();
function placeSky() {
  if (pendingSeek && bodyMode !== 'off' && grids.coarse) {
    if (seekHere()) { pendingSeek = false; syncUtUi(); }
  }
  if (bodyMode === 'off') {
    sunDisc.visible = sunGlow.visible = moonDisc.visible = false;
    sunLight.intensity = 0.35;
    skyDome.material.uniforms.sunAlt.value = -8;
    hemi.intensity = 0.3;
    readout.textContent = 'Sky off.';
    return;
  }
  const B = bodyNow();
  const moonNow = B.body === 'Moon';
  const dir = dirFrom(B.gridAz, B.hor.alt);
  const eye = cam.position;
  discPos.copy(eye).addScaledVector(dir, DISC_D);
  const radius = DISC_D * Math.tan(Sky.sdFor(B.body) * DEG);
  const up = B.hor.alt > -0.4;
  sunLight.color.setHex(moonNow ? 0xc8d0dc : 0xffe2a8);
  sunLight.intensity = up ? (moonNow ? 0.55 : 1.35) : 0.08;
  // Shadows cover the ground just ahead of the camera.
  focus.set(eye.x + Math.sin(flight.yaw) * 60, 0, eye.z - Math.cos(flight.yaw) * 60);
  focus.y = groundOr(focus.x, focus.z, eye.y - 2);
  sunLight.target.position.copy(focus);
  const ld = dir.y > 0.02 ? dir : new THREE.Vector3(dir.x, 0.02, dir.z).normalize();
  sunLight.position.copy(focus).addScaledVector(ld, 1000);
  sunLight.target.updateMatrixWorld();
  let phaseCos = 1;
  if (moonNow) { try { phaseCos = Math.cos(Sky.moonPhase(B.date).phaseAngle * DEG); } catch (e) { phaseCos = 1; } }
  const seat = (mesh, isGlow) => {
    mesh.visible = true;
    mesh.position.copy(discPos);
    mesh.scale.setScalar(radius * (isGlow ? 1.45 : 1));
    mesh.lookAt(eye);
    const u = mesh.material.uniforms;
    u.discCenter.value.copy(discPos); u.discRadius.value = radius; u.moonMode.value = moonNow ? 1 : 0; u.phaseCos.value = phaseCos;
  };
  sunDisc.visible = sunGlow.visible = moonDisc.visible = false;
  const disc = moonNow ? moonDisc : sunDisc;
  seat(disc, false);
  if (!moonNow) seat(sunGlow, true);
  const sunDir = moonNow ? dirFrom(B.sunHor.az - B.site.conv, B.sunHor.alt) : dir;
  if (moonNow) {
    const axis = sunDir.clone().sub(dir.clone().multiplyScalar(sunDir.dot(dir)));
    if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0);
    disc.material.uniforms.sunInDisc.value.copy(axis.normalize());
  }
  skyDome.material.uniforms.sunAlt.value = B.sunHor.alt;
  skyDome.material.uniforms.sunDir.value.copy(sunDir);
  hemi.intensity = (moonNow ? 0.18 : 0.22) + 0.5 * Math.max(0, Math.min(1, (B.sunHor.alt + 2) / 14));
  FLY.sun = { body: B.body, az: B.hor.az, alt: B.hor.alt, gridAz: B.gridAz, conv: B.site.conv, e: B.site.e, n: B.site.n, od: B.site.od, lat: B.site.lat, lon: B.site.lon, minute: minuteUt, year: epochYear, doy };
  let txt = B.body + ' ' + B.hor.alt.toFixed(2) + '° high at ' + B.hor.az.toFixed(2) + '° true (grid ' + B.gridAz.toFixed(2) + '°), from the camera. ' + doyLabel(doy) + ' ' + epochYear + '.';
  if (lastSeek && lastSeek.hit) {
    const what = bodyMode.endsWith('rise') ? 'Rise' : 'Set';
    txt += lastSeek.skyline === 'woodhenge'
      ? ' ' + what + ' timed on the Woodhenge skyline: the map ends too close to E ' + Math.round(lastSeek.e) + ' N ' + Math.round(lastSeek.n) + ' in that direction.'
      : ' ' + what + ' timed on the skyline at E ' + Math.round(lastSeek.e) + ' N ' + Math.round(lastSeek.n) + (lastSeek.full ? '' : ' (coarse ground)') +
        (lastSeek.short ? ' (the map ends ' + (lastSeek.reach / 1000).toFixed(1) + ' km out that way, so the skyline may be too low)' : '') + '.';
  }
  else if (lastSeek && !lastSeek.hit) txt += ' No ' + B.body.toLowerCase() + (bodyMode.endsWith('rise') ? 'rise' : 'set') + ' on this date.';
  if (BU_POSTS_TRUE && PLACES.bu && Math.hypot(flight.pos.x - PLACES.bu.x, flight.pos.z - PLACES.bu.z) < 1500) txt += ' Bulford posts line ' + BU_POSTS_TRUE.true.toFixed(1) + '° true.';
  if (txt !== readout.textContent) readout.textContent = txt;
}
// Day arc playback: 'Pause' holds the sky where it is and becomes 'Resume'; any other sky change ends it.
let skyPaused = false;
function paintSkyPlay() {
  const b = document.getElementById('btnSkyPlay');
  b.textContent = skyPaused ? 'Resume' : 'Pause';
  b.disabled = !skyPlay && !skyPaused;
  b.classList.toggle('active', skyPlay);
}
function stopDayPlay() {
  skyPlay = false; playEnd = null; skyPaused = false;
  for (const id of ['btnDaySun', 'btnDayMoon']) document.getElementById(id).classList.remove('active');
  paintSkyPlay();
}
function reseek() { manualTime = false; pendingSeek = bodyMode !== 'off'; autoSeekPending = pendingSeek; }
function setBodyMode(mode) { stopDayPlay(); bodyMode = mode; reseek(); paintSkyButtons(); }
function setEpoch(year) { epochYear = year; document.getElementById('epochYear').value = String(year); stopDayPlay(); reseek(); paintSkyButtons(); starKey = ''; }
function startDay(kind) {
  const body = kind === 'moon' ? 'Moon' : 'Sun';
  stopDayPlay();
  bodyMode = kind === 'moon' ? 'moonrise' : 'sunrise';
  paintSkyButtons();
  const common = { body, year: epochYear, doy };
  const rise = seekFrom(flight.pos.x, flight.pos.z, Object.assign({ rising: true, limb: 'first_gleam' }, common));
  if (!rise || !rise.hit) { readout.textContent = 'No ' + body.toLowerCase() + ' rise on this date.'; return; }
  const set = seekFrom(flight.pos.x, flight.pos.z, Object.assign({ rising: false, limb: 'full_orb', notBefore: rise.hit.minute + 15 }, common));
  minuteUt = Math.max(0, rise.hit.minute - 20);
  playEnd = set && set.hit ? set.hit.minute + 20 : rise.hit.minute + 16 * 60;
  skyPlay = true; pendingSeek = false; autoSeekPending = false; manualTime = true;
  document.getElementById(kind === 'moon' ? 'btnDayMoon' : 'btnDaySun').classList.add('active');
  skyPaused = false; paintSkyPlay();
  syncUtUi();
}
document.getElementById('btnSunOff').onclick = () => setBodyMode('off');
document.getElementById('btnSunrise').onclick = () => setBodyMode('sunrise');
document.getElementById('btnSunset').onclick = () => setBodyMode('sunset');
document.getElementById('btnMoonrise').onclick = () => setBodyMode('moonrise');
document.getElementById('btnMoonset').onclick = () => setBodyMode('moonset');
for (const [id, l] of [['btnLimbGleam', 'first_gleam'], ['btnLimbHalf', 'half_orb'], ['btnLimbFull', 'full_orb']]) {
  document.getElementById(id).onclick = () => { limb = l; reseek(); paintSkyButtons(); };
}
document.getElementById('btnEpochModern').onclick = () => setEpoch(MODERN_YEAR);
document.getElementById('btnEpoch2500').onclick = () => setEpoch(-2499);
document.getElementById('epochYear').onchange = (ev) => setEpoch(parseYear(ev.target.value, epochYear));
document.getElementById('doy').oninput = (ev) => { doy = +ev.target.value; stopDayPlay(); reseek(); syncUtUi(); };
document.querySelectorAll('[data-doy]').forEach((b) => {
  b.onclick = () => {
    doy = +b.dataset.doy;
    document.getElementById('doy').value = String(doy);
    if (doy === 172) setBodyMode('sunrise');
    else if (doy === 355) setBodyMode('sunset');
    else { stopDayPlay(); reseek(); }
    syncUtUi();
  };
});
document.getElementById('utMin').oninput = (ev) => { minuteUt = +ev.target.value; stopDayPlay(); pendingSeek = false; autoSeekPending = false; manualTime = true; lastSeek = null; syncUtUi(); };
document.getElementById('btnDaySun').onclick = () => startDay('sun');
document.getElementById('btnDayMoon').onclick = () => startDay('moon');
document.getElementById('btnSkyPlay').onclick = () => {
  if (skyPlay) { skyPlay = false; skyPaused = true; }
  else if (skyPaused && playEnd != null) { skyPaused = false; skyPlay = true; }
  paintSkyPlay();
};
paintSkyPlay();

function updateStars() {
  const note = document.getElementById('starNote');
  const cat = window.BRIGHT_STARS;
  if (!starsOn || !cat) { starPoints.visible = false; if (note) note.textContent = ''; return; }
  starPoints.visible = true;
  starPoints.position.copy(cam.position);
  const site = siteForCamera();
  starPoints.rotation.y = site.conv * DEG;
  const sunAlt = bodyMode === 'off' ? -10 : bodyNow().sunHor.alt;
  starMat.uniforms.sunAlt.value = sunAlt;
  const key = epochYear + ':' + doy + ':' + Math.round(minuteUt);
  if (key === starKey && starGeo.getAttribute('position')) return;
  starKey = key;
  const rows = starsAbove(cat.s, epochYear, doy, minuteUt, -0.4);
  // One fixed buffer for the whole catalogue, refilled in place: only the stars above the horizon are drawn
  // (setDrawRange), so playing the sky arc does not make a new buffer on every minute.
  if (!starGeo.getAttribute('position') || starGeo.getAttribute('position').count < cat.s.length) {
    starGeo.dispose();
    starGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cat.s.length * 3), 3).setUsage(THREE.DynamicDrawUsage));
    starGeo.setAttribute('mag', new THREE.BufferAttribute(new Float32Array(cat.s.length), 1).setUsage(THREE.DynamicDrawUsage));
  }
  const pa = starGeo.getAttribute('position'), ma = starGeo.getAttribute('mag'), pos = pa.array, mag = ma.array;
  for (let i = 0; i < rows.length; i++) { pos[i * 3] = rows[i].x * STAR_R; pos[i * 3 + 1] = rows[i].y * STAR_R; pos[i * 3 + 2] = rows[i].z * STAR_R; mag[i] = rows[i].mag; }
  pa.needsUpdate = true; ma.needsUpdate = true;
  starGeo.setDrawRange(0, rows.length);
  FLY.starCount = rows.length;
  const which = epochYear < 0 ? 'Thuban' : 'Polaris';
  const idx = cat.names && cat.names[which];
  const s = idx == null ? null : cat.s[idx];
  if (note) note.textContent = s ? which + ' ' + starHorizontal(s[0], s[1], epochYear, doy, minuteUt).alt.toFixed(1) + '°' : '';
}
document.getElementById('starsOn').onchange = (ev) => { starsOn = ev.target.checked; starKey = ''; updateStars(); };


// ---------------------------------------------------------------- period control
const periodEl = document.getElementById('period'), periodLbl = document.getElementById('periodLbl'), periodCap = document.getElementById('periodCap');
let periodShown = NPER - 1, periodCapUntil = 0;
function setPeriod(v) {
  periodShown = THREE.MathUtils.clamp(Math.round(v), 0, NPER - 1);
  for (let p = 0; p < NPER; p++) periodTarget[p] = p <= periodShown ? 1 : 0;
  const P = PERIODS[periodShown];
  const all = periodShown === NPER - 1;
  const txt = P ? (all ? 'All periods' : 'Up to the ' + P.name + ' (' + P.dates + ')') : '';
  if (periodLbl) periodLbl.textContent = P ? (all ? 'all' : P.name) : '';
  if (periodEl && +periodEl.value !== periodShown) periodEl.value = String(periodShown);
  if (periodCap) {
    periodCap.innerHTML = '';
    if (P) {
      const b = document.createElement('b'); b.textContent = all ? 'All periods' : P.name;
      const d = document.createElement('span'); d.textContent = all ? ' · to today' : ' · ' + P.dates + (periodShown > 0 ? ', with everything older' : '');
      periodCap.append(b, d);
    }
    periodCap.classList.add('show');
    periodCapUntil = all ? performance.now() + 2500 : Infinity;
  }
  FLY.period = { shown: periodShown, caption: txt };
}
if (periodEl) periodEl.oninput = (ev) => setPeriod(+ev.target.value);
// Fade each period toward its target (0.5 s), then push the opacities to the shader, materials and labels.
function stepPeriods(dt, now) {
  let changed = false;
  for (let p = 0; p < NPER; p++) {
    const t = periodTarget[p], a = periodAlpha[p];
    if (a === t) continue;
    periodAlpha[p] = t > a ? Math.min(t, a + dt * 2) : Math.max(t, a - dt * 2);
    changed = true;
    for (const m of periodMats[p]) {
      m.opacity = periodAlpha[p];
      m.transparent = periodAlpha[p] < 1;
      m.visible = periodAlpha[p] > 0.01;
    }
  }
  if (changed) labelVisAt = 0;
  if (periodCap && now > periodCapUntil && periodCap.classList.contains('show')) periodCap.classList.remove('show');
}

// ---------------------------------------------------------------- plan view
// Straight down, true north up (as the compass), over the current spot, high enough that the nearby
// monuments fill the screen. Drag pans, the wheel zooms; the button again (or Back) returns to the view before.
let plan = null;
const planBtn = document.getElementById('planBtn');
function planPoints() {
  const pts = [[0, 0], [centre.x, centre.z]];
  if (PLACES.bu) pts.push([PLACES.bu.x, PLACES.bu.z]);
  if (MON) { for (const l of MON.labels) pts.push([l.x, l.z]); for (const st of MON.stones) pts.push([st.x, st.z]); }
  return pts;
}
function planPose(x, z) {
  const ds = planPoints().map(([px, pz]) => Math.hypot(px - x, pz - z)).sort((a, b) => a - b);
  const R = THREE.MathUtils.clamp((ds[6] != null ? ds[6] : 400) * 1.1, 150, 1600);
  const h = THREE.MathUtils.clamp(R / Math.tan(cam.fov * DEG / 2), 200, 3500);
  const conv = FS.convergenceAt(CE + x, CN - z);
  return { pos: new THREE.Vector3(x, groundOr(x, z, 0) + h, z), yaw: -conv * DEG, pitch: -Math.PI / 2 + 1e-4 };
}
function paintPlan() { if (planBtn) { planBtn.textContent = plan ? 'Back' : 'Plan view'; planBtn.classList.toggle('active', !!plan); } }
function leavePlan() { if (plan) { plan = null; paintPlan(); } }
function togglePlan() {
  if (plan) {
    const back = plan.back;
    plan = null; paintPlan();
    flyTo(back, { dur: 1.6 });
    return;
  }
  const back = { pos: flight.pos.clone(), yaw: flight.yaw, pitch: flight.pitch };
  cancelAuto();
  plan = { back };
  paintPlan();
  flyTo(planPose(flight.pos.x, flight.pos.z), { dur: 1.6 });
}
if (planBtn) planBtn.onclick = togglePlan;

// ---------------------------------------------------------------- alignment check
// Pick a site and an event; Go flies down to eye height (1.6 m) there, faces the event's true azimuth and
// sets the sky to the moment the chosen limb meets the local skyline (same sky and skyline maths as above).
// Solstices and equinoxes come from astronomy-engine Seasons(); lunar standstills from the mean lunar node
// for the epoch (major: node at 0 deg, minor: 180 deg), then the month of extreme declination nearest it.
const ALIGN_SITES = { sh: { name: 'Stonehenge centre', en: [CE, CN] }, wh: { name: 'Woodhenge centre', en: [P.centre.e, P.centre.n] } };
if (BU) ALIGN_SITES.bu = { name: 'Bulford', en: [BU.origin_e, BU.origin_n] };
if (MON) for (const st of MON.stones) ALIGN_SITES[st.t.startsWith('Cuckoo') ? 'cuckoo' : 'tor'] = { name: st.t, en: st.en };
const AXES = [
  { site: 'sh', name: 'Stonehenge solstice axis', az: 49.1 },
  { site: 'wh', name: 'Woodhenge axis', az: 49.4 }, { site: 'wh', name: 'Woodhenge axis', az: 43.3 }, { site: 'wh', name: 'Woodhenge axis', az: 38.6 },
];
if (BU_POSTS_TRUE) AXES.push({ site: 'bu', name: 'Bulford posts', az: +BU_POSTS_TRUE.true.toFixed(2) });
// Full alignment search (align_core.js): the event moment, then the limb meeting the skyline from (x, z).
function computeAlignment(x, z, ev, year, limb) { return aligner.computeAlignment(x, z, ev, year, limb); }
// Alignment Go runs in align_worker.js when it can (a moon search takes up to a second and would freeze the page);
// without the worker it runs here. evKey is the ALIGN_EVENTS key.
const alignWaits = new Map(); let alignReqId = 0;
function alignAsync(x, z, evKey, year, limb) {
  if (!alignWorker) return Promise.resolve(computeAlignment(x, z, ALIGN_EVENTS[evKey], year, limb));
  const id = ++alignReqId;
  return new Promise((resolve) => {
    alignWaits.set(id, resolve);
    alignWorker.postMessage({ type: 'align', id, x, z, ev: evKey, year, limb });
  });
}
function alignWorkerLost() {
  // Anything still waiting on the worker is answered here instead.
  for (const [id, res] of alignWaits) { alignWaits.delete(id); res(null); }
}
// Signed offset (event minus axis) from each site axis, taking whichever end of the axis is nearer;
// only axes within 20 degrees are listed, the chosen site's own first.
function axisOffsets(trueAz, siteKey) {
  const rows = AXES.map((a) => {
    const d1 = ((trueAz - a.az + 540) % 360) - 180, d2 = ((trueAz - a.az - 180 + 540) % 360) - 180;
    const back = Math.abs(d2) < Math.abs(d1);
    return { a, d: back ? d2 : d1, back };
  }).filter((r) => Math.abs(r.d) <= 20);
  rows.sort((p, q) => (q.a.site === siteKey) - (p.a.site === siteKey) || Math.abs(p.d) - Math.abs(q.d));
  return rows;
}
const alignEl = document.getElementById('alignOut');
function alignEpochYear() {
  const m = document.getElementById('alEpoch').value;
  if (m === 'modern') return MODERN_YEAR;
  if (m === 'bc2500') return -2499;
  return parseYear(document.getElementById('alYear').value, MODERN_YEAR);
}
let alignRun = 0, alignDetails = false;
function paintAlignDetails(have) {
  const b = document.getElementById('alDetails'); if (!b) return;
  if (have != null) b.hidden = !have;
  b.classList.toggle('active', alignDetails); b.setAttribute('aria-pressed', String(alignDetails));
  alignEl.classList.toggle('brief', !alignDetails);
  const top = alignEl.firstElementChild; if (top && alignEl.children.length > 1) top.hidden = alignDetails;
}
{ const b = document.getElementById('alDetails'); if (b) b.onclick = () => { alignDetails = !alignDetails; paintAlignDetails(); }; }
async function runAlignment() {
  const run = ++alignRun;
  const key = document.getElementById('alSite').value, evKey = document.getElementById('alEvent').value;
  const limbKey = document.getElementById('alLimb').value;
  const ev = ALIGN_EVENTS[evKey], year = alignEpochYear();
  let x, z, siteName;
  if (key === 'here') { x = flight.pos.x; z = flight.pos.z; siteName = 'Here (E ' + Math.round(CE + x) + ' N ' + Math.round(CN - z) + ')'; }
  else { const S = ALIGN_SITES[key]; const p = localXZ(S.en[0], S.en[1]); x = p.x; z = p.z; siteName = S.name; }
  const t0 = performance.now();
  alignEl.textContent = siteName + ': working\u2026'; paintAlignDetails(false);
  const ask = async (ax, az) => (await alignAsync(ax, az, evKey, year, limbKey)) || computeAlignment(ax, az, ev, year, limbKey);
  // Bulford: stand on the post axis, AXIS_BACK m behind the near post, so both posts are ahead with the event
  // beyond. The end comes from the event's azimuth (NE events: SW of post 8647 looking NE; SW events: NE of
  // post 9019 looking SW); 'Swap end' takes the other one. The azimuth is then worked out from that eye point.
  let axis = null;
  if (key === 'bu' && BU_AXIS) {
    const r0 = await ask(x, z);
    if (run !== alignRun) return;
    if (!r0.error) {
      const dNE = angDiff(r0.hit.geoAz, BU_AXIS.az), dSW = angDiff(r0.hit.geoAz, BU_AXIS.az + 180);
      let end = Math.abs(dNE) <= Math.abs(dSW) ? 'ne' : 'sw';
      if (alignSwap) end = end === 'ne' ? 'sw' : 'ne';
      const bp = buAxisPose(end);
      x = bp.x; z = bp.z;
      axis = { end, lookAz: end === 'ne' ? BU_AXIS.az : BU_AXIS.az + 180, nearId: bp.nearId, farId: bp.farId };
      siteName = 'Bulford post axis';
    }
  }
  const r = await ask(x, z);
  if (run !== alignRun) return; // a newer Go replaced this one
  const ms = Math.round(performance.now() - t0);
  if (r.error) { alignEl.textContent = siteName + ': ' + r.error + (r.info ? ' ' + r.info : ''); FLY.align = r; return; }
  const h = r.hit, d = h.date, when = FS.doyMinuteOf(d);
  // Sky: the event's own date and minute, the chosen body and limb; no automatic re-timing afterwards.
  stopDayPlay();
  epochYear = when.year; document.getElementById('epochYear').value = String(when.year);
  doy = when.doy; document.getElementById('doy').value = String(Math.min(365, doy));
  minuteUt = when.minute;
  bodyMode = ev.body === 'Moon' ? (ev.rising ? 'moonrise' : 'moonset') : (ev.rising ? 'sunrise' : 'sunset');
  limb = limbKey;
  pendingSeek = false; autoSeekPending = false; manualTime = true;
  lastSeek = { e: r.obsSite.e, n: r.obsSite.n, hit: h, full: FLY.detailDone, skyline: r.skyline };
  paintSkyButtons(); syncUtUi(); starKey = '';
  // Camera: eye 1.6 m above the ground at the point, facing the event (grid bearing = true - convergence).
  if (minAgl > 1.5) { minAgl = 1.5; document.getElementById('minAgl').value = '1.5'; document.getElementById('minLbl').textContent = '1.5 m'; }
  leavePlan(); cancelAuto(); paintPlace(null);
  alignActive = { key, x, z, name: siteName, axis }; // plan-view rays now start from this site (or the axis eye point)
  const gridAz = h.geoAz - r.site.conv;
  // Face the event; on the post axis, if the event is more than 60 deg off the way the posts lie (after
  // 'Swap end', say), face along the axis instead so the posts stay in view.
  if (axis) {
    // Frame both posts and the event (the event only if it lies within 60 deg of the way the posts run).
    axis.offset = angDiff(h.geoAz, axis.lookAz);
    axis.behind = Math.abs(axis.offset) > 60;
    const bp = buAxisPose(axis.end, axis.behind ? null : gridAz, h.sky);
    flyTo(bp.pose, { onDone: () => { if (bp.fov) setFov(bp.fov); } });
    axis.fov = bp.fov;
  } else flyTo({ pos: new THREE.Vector3(x, r.gy + 1.6, z), yaw: gridAz * DEG, pitch: (h.sky + 1.2) * DEG });
  const uk = (when.year >= 1970 && when.year <= 2100) ? ' (' + d.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }) + ' UK)' : '';
  const limbName = { first_gleam: 'first gleam', half_orb: 'half orb', full_orb: 'full orb' }[limbKey];
  const offs = axisOffsets(h.geoAz, key);
  const lines = [
    siteName + ' \u00b7 ' + ev.label + ' \u00b7 ' + limbName,
    'True azimuth ' + h.geoAz.toFixed(2) + '\u00b0 (grid ' + gridAz.toFixed(2) + '\u00b0)',
    'Skyline altitude ' + h.sky.toFixed(2) + '\u00b0 ' + (r.skyline === 'woodhenge' ? '(Woodhenge measured skyline: the map ends too close in this direction)'
      : '(eye 1.6 m; lidar ground to about 6 km, OS Terrain 50 beyond' + (r.short ? '; the map ends ' + (r.reach / 1000).toFixed(1) + ' km out this way, so the skyline may be too low' : '') + ')'),
    'Time ' + dateLabel(d) + ', ' + utLabel(d) + uk,
    r.info,
    offs.length ? 'Offset from site axes (event minus axis):' : 'No site axis within 20\u00b0 of this event.',
    ...offs.map((o) => { const nd = o.a.site === 'bu' ? 2 : 1; return '  ' + o.a.name + ' ' + (o.back ? (o.a.az + 180).toFixed(nd) : o.a.az.toFixed(nd)) + '\u00b0: ' + (o.d >= 0 ? '+' : '') + o.d.toFixed(2) + '\u00b0'; }),
  ];
  if (axis) {
    const dir = axis.end === 'ne' ? 'SW of post ' + axis.nearId + ', looking NE' : 'NE of post ' + axis.nearId + ', looking SW';
    lines.splice(1, 0, 'Eye ' + AXIS_BACK + ' m ' + dir + ' along the post axis (post ' + axis.nearId + ' near, ' + axis.farId + ' beyond; ' + AXIS_SIDE + ' m to the right so the far post shows beside the near one), E ' + Math.round(CE + x) + ' N ' + Math.round(CN - z),
      'Event minus post axis ' + axis.lookAz.toFixed(2) + '\u00b0: ' + (axis.offset >= 0 ? '+' : '') + axis.offset.toFixed(2) + '\u00b0' + (axis.behind ? ' (the event is off to the side or behind: framing the posts only)' : '') + (axis.fov ? '; view widened to ' + axis.fov.toFixed(0) + '\u00b0 to fit' : ''));
  }
  // Short answer first (what, where it rises or sets, when); the rest behind the Details button.
  const brief = [lines[0], ...lines.filter((t) => t && (t.startsWith('True azimuth') || t.startsWith('Time ')))];
  alignEl.textContent = '';
  const top = document.createElement('div'); top.textContent = brief.join('\n');
  const more = document.createElement('div'); more.className = 'more'; more.textContent = lines.join('\n');
  alignEl.append(top, more);
  paintAlignDetails(true);
  FLY.align = { site: key, event: evKey, limb: limbKey, epoch: year, trueAz: h.geoAz, gridAz, skyAlt: h.sky, skyline: r.skyline,
    date: d.toISOString(), year: when.year, doy: when.doy, minute: when.minute, info: r.info, offsets: offs.map((o) => [o.a.name, o.a.az, +o.d.toFixed(3)]), ms,
    eye: { x, z, e: CE + x, n: CN - z, gy: r.gy }, axis: axis && { ...axis, offset: +axis.offset.toFixed(3) } };
  paintSwap();
}
let alignSwap = false;
function angDiff(a, b) { return ((a - b + 540) % 360) - 180; }
function paintSwap() {
  const b = document.getElementById('alSwap'); if (!b) return;
  b.hidden = document.getElementById('alSite').value !== 'bu';
  b.classList.toggle('active', alignSwap);
}
{
  const selS = document.getElementById('alSite'), selE = document.getElementById('alEvent');
  if (selS && selE) {
    for (const [k, v] of Object.entries(ALIGN_SITES)) selS.add(new Option(v.name, k));
    selS.add(new Option('Here (current position)', 'here'));
    for (const [k, v] of Object.entries(ALIGN_EVENTS)) selE.add(new Option(v.label, k));
    document.getElementById('alEpoch').onchange = (ev) => { document.getElementById('alYear').style.display = ev.target.value === 'custom' ? '' : 'none'; };
    document.getElementById('alGo').onclick = runAlignment;
    selS.addEventListener('change', paintSwap); paintSwap();
    const sw = document.getElementById('alSwap');
    if (sw) sw.onclick = () => { alignSwap = !alignSwap; paintSwap(); if (alignActive && alignActive.key === 'bu') runAlignment(); };
  }
}

// ---------------------------------------------------------------- plan-view alignment rays
// In plan view: a ray on the ground from the view centre (or from the alignment site after Go) along the true
// azimuth of the chosen event, or a fan of the solstice, equinox and lunar standstill directions. Azimuths are
// the alignment check's own (limb meets the skyline seen from that point, eye 1.6 m); the event, epoch and limb
// come from the Alignment check panel. Lines and labels are drawn in screen space (SVG over the canvas), so
// they stay crisp at every zoom, run to the edge of the view and are never hidden by the ground.
const RAY_KINDS = {
  ms: { name: 'Midsummer sun', colour: '#ffd23f' }, mw: { name: 'Midwinter sun', colour: '#ff7b3a' }, eq: { name: 'Equinox sun', colour: '#f2eee4' },
  majN: { name: 'Major standstill, north', colour: '#3fd0ff' }, majS: { name: 'Major standstill, south', colour: '#2f7dff' },
  minN: { name: 'Minor standstill, north', colour: '#d59bff' }, minS: { name: 'Minor standstill, south', colour: '#9a62ff' },
};
function rayKindOf(k) {
  if (k.startsWith('sun-ms')) return 'ms'; if (k.startsWith('sun-mw')) return 'mw'; if (k.startsWith('sun-eq')) return 'eq';
  return (k.includes('major') ? 'maj' : 'min') + (k.includes('north') ? 'N' : 'S');
}
function rayName(k) {
  const ev = ALIGN_EVENTS[k];
  if (ev.body === 'Sun') return ev.label.replace(' (March)', '');
  return (ev.major ? 'Major' : 'Minor') + ' standstill ' + (ev.north ? 'N' : 'S') + ' moon' + (ev.rising ? 'rise' : 'set');
}
const FAN_KEYS = ['sun-ms-rise', 'sun-ms-set', 'sun-mw-rise', 'sun-mw-set', 'sun-eq-rise', 'sun-eq-set',
  'moon-major-north-rise', 'moon-major-north-set', 'moon-major-south-rise', 'moon-major-south-set',
  'moon-minor-north-rise', 'moon-minor-north-set', 'moon-minor-south-rise', 'moon-minor-south-set'];
// The event roughly opposite each one (midsummer sunrise / midwinter sunset, and so on).
const OPPOSITE = { 'sun-ms-rise': 'sun-mw-set', 'sun-mw-set': 'sun-ms-rise', 'sun-ms-set': 'sun-mw-rise', 'sun-mw-rise': 'sun-ms-set',
  'sun-eq-rise': 'sun-eq-set', 'sun-eq-set': 'sun-eq-rise' };
for (const m of ['major', 'minor']) {
  OPPOSITE['moon-' + m + '-north-rise'] = 'moon-' + m + '-south-set'; OPPOSITE['moon-' + m + '-south-set'] = 'moon-' + m + '-north-rise';
  OPPOSITE['moon-' + m + '-north-set'] = 'moon-' + m + '-south-rise'; OPPOSITE['moon-' + m + '-south-rise'] = 'moon-' + m + '-north-set';
}
function epochShort(y) { return y <= 0 ? (1 - y) + ' BC' : 'AD ' + y; }
const raySvg = document.getElementById('raySvg'), rayBox = document.getElementById('rayBox');
const rayFromEl = document.getElementById('rayFrom'), rayLegendEl = document.getElementById('rayLegend');
let rayMode = 'one';          // 'off' | 'one' | 'fan'
let alignActive = null;       // after Go: { key, x, z } (rays start from the alignment site)
let rayState = { key: '', origin: null, results: new Map(), pending: [], year: MODERN_YEAR, limb: 'first_gleam', ev: 'sun-ms-rise' };
let rayDrawKey = '';
const rayStats = FLY.rayStats = { full: 0, quick: 0, updMs: 0, drawMs: 0 };
function rayOrigin() {
  if (alignActive) {
    if (alignActive.axis) return { x: alignActive.x, z: alignActive.z, name: alignActive.name, site: true };
    const k = document.getElementById('alSite').value;
    if (k === 'here' || !ALIGN_SITES[k]) return { x: alignActive.x, z: alignActive.z, name: alignActive.name, site: true };
    const S = ALIGN_SITES[k], q = localXZ(S.en[0], S.en[1]);
    return { x: q.x, z: q.z, name: S.name, site: true };
  }
  return { x: flight.pos.x, z: flight.pos.z, name: 'view centre', site: false };
}
// Ray azimuths come from align_worker.js (same align_core.js searches as the Alignment check), so the fan of 14
// events never blocks the page. Each result arrives on its own; a newer request replaces the one in progress.
// If module workers are not available, the same searches run here, one ray per frame.
let alignWorker = null, rayReqId = 0;
try {
  alignWorker = new Worker(new URL('./align_worker.js?v=' + BUILD, import.meta.url), { type: 'module' });
  alignWorker.onerror = (e) => { console.warn('align worker failed; rays on the main thread', e.message || e); alignWorker = null; rayState.key = ''; alignWorkerLost(); };
  alignWorker.onmessage = (ev) => {
    const d = ev.data;
    if (d.type === 'error') { console.warn('align worker: ' + d.message); alignWorker = null; rayState.key = ''; alignWorkerLost(); return; }
    if (d.type === 'align') { const res = alignWaits.get(d.id); if (res) { alignWaits.delete(d.id); FLY.alignWorkerMs = d.ms; res(d.r); } return; }
    if (d.id !== rayState.id) return;
    if (d.type === 'ray') {
      const w = rayState.want.find((q) => q.k === d.k);
      rayState.results.set(d.k, { ...d.r, date: d.r.date != null ? new Date(d.r.date) : null, main: w ? w.main : true });
      rayState.pending = rayState.pending.filter((q) => q.k !== d.k);
      rayStats.full = d.stats.full; rayStats.quick = d.stats.quick; rayStats.workerMs = (rayStats.workerMs || 0) + d.ms;
      rayDrawKey = '';
    } else if (d.type === 'raysDone') rayState.pending = [];
    publishRays();
  };
  alignWorker.postMessage({ type: 'hz', hz: window.WOODHENGE_HORIZON || null });
} catch (e) { alignWorker = null; }
function sendGridToAlign(g) {
  if (alignWorker) alignWorker.postMessage({ type: 'grid', name: g.name, g: { nx: g.nx, ny: g.ny, x0: g.x0, z0: g.z0, dx: g.dx, dz: g.dz, h: g.h } });
}
function publishRays() {
  FLY.rays = { origin: { e: CE + rayState.origin.x, n: CN - rayState.origin.z, name: rayState.origin.name }, mode: rayMode, epoch: rayState.year, limb: rayState.limb,
    rays: [...rayState.results].map(([k, r]) => ({ k, name: rayName(k), az: r.az, sky: r.sky, skyline: r.skyline, main: r.main })), pending: rayState.pending.length,
    worker: !!alignWorker };
}
function rayWanted() {
  const evKey = document.getElementById('alEvent').value || 'sun-ms-rise';
  if (rayMode === 'fan') return FAN_KEYS.map((k) => ({ k, main: true }));
  const out = [{ k: evKey, main: true }];
  if (OPPOSITE[evKey]) out.push({ k: OPPOSITE[evKey], main: false });
  return out;
}
// Recompute when the centre moves (by more than 0.3% of the view width), the event, epoch, limb or mode change,
// or better ground arrives.
function updateRays(now) {
  if (!plan || rayMode === 'off') return;
  const o = rayOrigin();
  const agl = Math.max(50, flight.pos.y - groundOr(flight.pos.x, flight.pos.z, 0));
  const tol = Math.max(1, agl * Math.tan(cam.fov * DEG / 2) * 2 * cam.aspect * 0.003);
  const year = alignEpochYear(), limbKey = document.getElementById('alLimb').value;
  const want = rayWanted();
  const key = rayMode + '|' + year + '|' + limbKey + '|' + want.map((w) => w.k).join(',') + '|' + o.name + '|' + groundVer;
  const moved = !rayState.origin || Math.hypot(o.x - rayState.origin.x, o.z - rayState.origin.z) > tol;
  if (key !== rayState.key || moved) {
    if (key !== rayState.key) rayState.results = new Map();
    if (heightAt(o.x, o.z) == null) return;
    rayState = { key, origin: o, results: rayState.results, pending: want.slice(), year, limb: limbKey, want, id: ++rayReqId, conv: FS.convergenceAt(CE + o.x, CN - o.z) };
    if (alignWorker) alignWorker.postMessage({ type: 'rays', id: rayState.id, x: o.x, z: o.z, keys: want.map((w) => w.k), year, limb: limbKey });
    publishRays();
  }
  if (alignWorker) return;
  // No worker: one ray per frame here (a full search can take tens of ms).
  if (rayState.pending.length) {
    const w = rayState.pending.shift();
    const r = aligner.rayAzimuth(rayState.origin.x, rayState.origin.z, w.k, rayState.year, rayState.limb);
    rayState.results.set(w.k, { ...r, date: r.date != null ? new Date(r.date) : null, main: w.main });
    rayStats.full = aligner.stats.full; rayStats.quick = aligner.stats.quick;
    rayDrawKey = '';
    publishRays();
  }
}
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, parent) { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; }
const _rv = new THREE.Vector3();
function toScreen(x, y, z) { _rv.set(x, y, z).project(cam); return [(_rv.x + 1) / 2 * innerWidth, (1 - _rv.y) / 2 * innerHeight, _rv.z]; }
function drawRays() {
  const show = !!plan && rayMode !== 'off' && rayState.origin;
  if (raySvg) raySvg.style.display = show ? '' : 'none';
  if (rayBox) rayBox.hidden = !plan;
  if (!show) { rayDrawKey = ''; return; }
  const e = cam.matrixWorld.elements;
  const dk = [e[12], e[13], e[14], e[0], e[2], innerWidth, innerHeight].map((v) => v.toFixed(2)).join(',') + '|' + rayState.key + '|' + rayState.results.size + '|' + rayState.origin.x.toFixed(1) + rayState.origin.z.toFixed(1);
  if (dk === rayDrawKey) return;
  rayDrawKey = dk;
  while (raySvg.firstChild) raySvg.removeChild(raySvg.firstChild);
  const o = rayState.origin, conv = rayState.conv, oy = groundOr(o.x, o.z, 0);
  const W = innerWidth, H = innerHeight;
  const agl = Math.max(50, flight.pos.y - groundOr(flight.pos.x, flight.pos.z, 0));
  const halfDiag = agl * Math.tan(cam.fov * DEG / 2) * Math.hypot(1, cam.aspect);
  const D = Math.min(20000, Math.hypot(o.x - flight.pos.x, o.z - flight.pos.z) + halfDiag * 1.4);
  const [ox, oyS] = toScreen(o.x, oy, o.z);
  // Screen boxes to keep labels off: the panels and buttons over the view.
  const obstacles = [];
  for (const id of ['hud', 'rayBox', 'dock', 'joy', 'compassCtl', 'load', 'credits', 'periodCap', 'caption', 'updown']) {
    const el = document.getElementById(id); if (!el || el.hidden) continue;
    const b = el.getBoundingClientRect(); if (b.width > 0 && b.height > 0 && getComputedStyle(el).display !== 'none' && +getComputedStyle(el).opacity > 0.05) obstacles.push([b.left - 4, b.top - 4, b.right + 4, b.bottom + 4]);
  }
  const fan = rayMode === 'fan';
  const yearTxt = epochShort(rayState.year);
  const mainKey = rayState.want && rayState.want[0] ? rayState.want[0].k : null;
  const mainR = mainKey && rayState.results.get(mainKey);
  const lines = svgEl('g', {}, raySvg), texts = svgEl('g', {}, raySvg);
  for (const [k, r] of rayState.results) {
    if (r.error || r.az == null) continue;
    const kind = RAY_KINDS[rayKindOf(k)];
    const faint = !r.main;
    // In single mode the reverse of the chosen ray is drawn faintly, with the opposite event's own bearing.
    const dirs = faint ? [] : [{ az: r.az, faint: false }];
    if (!fan && !faint) dirs.push({ az: (r.az + 180) % 360, faint: true });
    for (const d of dirs) {
      const gb = (d.az - conv) * DEG, sx = Math.sin(gb), sz = -Math.cos(gb);
      const pts = []; let lastY = oy;
      for (let i = 0; i <= 64; i++) {
        const t = D * i / 64, px = o.x + sx * t, pz = o.z + sz * t;
        const gy = heightAt(px, pz); if (gy != null) lastY = gy;
        const p = toScreen(px, lastY + 0.5, pz);
        if (p[2] > 1) break;
        pts.push(p);
      }
      if (pts.length < 2) continue;
      const P = pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      svgEl('polyline', { points: P, fill: 'none', stroke: 'rgba(0,0,0,0.55)', 'stroke-width': d.faint ? 3 : 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: d.faint ? 0.5 : 1 }, lines);
      svgEl('polyline', { points: P, fill: 'none', stroke: kind.colour, 'stroke-width': d.faint ? 1.5 : 2.5, 'stroke-dasharray': d.faint ? '7 6' : 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: d.faint ? 0.6 : 1 }, lines);
      // Label near where the ray leaves the view: the furthest point along it whose label box is on screen
      // and clear of the panels and of labels already placed.
      let txt;
      if (d.faint) {
        const opp = rayState.results.get(OPPOSITE[k]);
        const dd = opp && opp.az != null ? ((opp.az - d.az + 540) % 360) - 180 : null;
        txt = 'Reverse ' + d.az.toFixed(2) + '\u00b0' + (dd != null ? ' \u00b7 ' + rayName(OPPOSITE[k]) + ' ' + opp.az.toFixed(2) + '\u00b0 (' + (dd >= 0 ? '+' : '') + dd.toFixed(2) + '\u00b0)' : '');
      } else txt = rayName(k) + (fan ? '' : ' ' + yearTxt) + ' ' + r.az.toFixed(2) + '\u00b0';
      const fs = fan ? 12 : 13, estW = txt.length * fs * 0.56;
      let best = null;
      for (let i = pts.length - 1; i >= 1 && !best; i--) {
        const [x, y] = pts[i];
        if (x < 0 || x > W || y < 0 || y > H) continue;
        const dx = x - ox, dy = y - oyS;
        const anchor = Math.abs(dx) < 30 ? 'middle' : dx > 0 ? 'end' : 'start';
        const lx = anchor === 'end' ? x - 6 : anchor === 'start' ? x + 6 : x;
        for (const ly of [y + (dy < 0 ? 15 : -7), y + (dy < 0 ? -7 : 15)]) {
          const x0 = anchor === 'end' ? lx - estW : anchor === 'start' ? lx : lx - estW / 2;
          const bx = [x0 - 2, ly - fs - 1, x0 + estW + 2, ly + 4];
          if (bx[0] < 4 || bx[2] > W - 4 || bx[1] < 4 || bx[3] > H - 4) continue;
          if (obstacles.some((q) => bx[0] < q[2] && bx[2] > q[0] && bx[1] < q[3] && bx[3] > q[1])) continue;
          best = { lx, ly, anchor, bx }; break;
        }
      }
      if (!best) continue;
      obstacles.push(best.bx);
      const t = svgEl('text', { x: best.lx.toFixed(1), y: best.ly.toFixed(1), 'text-anchor': best.anchor, 'font-size': d.faint ? fs - 1 : fs, fill: d.faint ? 'rgba(255,255,255,0.88)' : kind.colour, class: 'rayLbl' }, texts);
      t.textContent = txt;
    }
  }
  // Origin marker.
  svgEl('circle', { cx: ox.toFixed(1), cy: oyS.toFixed(1), r: 5, fill: '#fff', stroke: '#000', 'stroke-width': 2 }, texts);
  // Panel: where from, and the legend.
  if (rayFromEl) {
    rayFromEl.textContent = 'From ' + o.name + (o.site ? '' : '') + ' (E ' + Math.round(CE + o.x) + ' N ' + Math.round(CN - o.z) + ') \u00b7 ' + yearTxt + ' \u00b7 ' +
      ({ first_gleam: 'gleam', half_orb: 'half orb', full_orb: 'full orb' }[rayState.limb] || '') + (rayState.pending.length ? ' \u00b7 working\u2026' : '');
    const btn = document.getElementById('rayCentre'); if (btn) btn.hidden = !alignActive;
  }
  if (rayLegendEl) {
    const want = fan ? Object.keys(RAY_KINDS) : [rayKindOf(mainKey || 'sun-ms-rise')];
    const html = want.map((kk) => '<span class="sw" style="background:' + RAY_KINDS[kk].colour + '"></span>' + RAY_KINDS[kk].name + (fan ? ' (rise and set)' : '')).join('<br>') +
      (fan ? '' : '<br><span class="sw dash"></span>Reverse direction');
    if (rayLegendEl.dataset.h !== html) { rayLegendEl.innerHTML = html; rayLegendEl.dataset.h = html; }
  }
}
function setRayMode(m) {
  rayMode = m; rayDrawKey = ''; rayState.key = '';
  for (const [id, v] of [['rayOff', 'off'], ['rayOne', 'one'], ['rayFan', 'fan']]) { const b = document.getElementById(id); if (b) b.classList.toggle('active', v === m); }
}
for (const [id, v] of [['rayOff', 'off'], ['rayOne', 'one'], ['rayFan', 'fan']]) { const b = document.getElementById(id); if (b) b.onclick = () => setRayMode(v); }
{ const b = document.getElementById('rayCentre'); if (b) b.onclick = () => { alignActive = null; rayState.key = ''; }; }
setRayMode('one');

// ---------------------------------------------------------------- HUD
const flightEl = document.getElementById('flight');
// Compass: turns with the camera heading; N is true north (grid bearing + convergence).
const compassRose = document.getElementById('compassRose'), compassCtl = document.getElementById('compassCtl');
const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
let compassSaid = -1;
// Grid convergence at the camera (true = grid + conv), from the OSGB projection; refreshed with the HUD.
let compassConv = FS.convergenceAt(CE + flight.pos.x, CN - flight.pos.z), compassLast = 1e9;
function updateCompass() {
  if (!compassRose) return;
  const hdg = flight.yaw / DEG + compassConv;
  if (Math.abs(hdg - compassLast) < 0.1) return;
  compassLast = hdg;
  compassRose.setAttribute('transform', 'rotate(' + (-hdg).toFixed(2) + ')');
  // The slider's value is the heading (whole degrees true), for screen readers.
  const said = Math.round((hdg % 360 + 360) % 360) % 360;
  if (compassCtl && said !== compassSaid) {
    compassSaid = said;
    compassCtl.setAttribute('aria-valuenow', String(said));
    compassCtl.setAttribute('aria-valuetext', said + ' degrees true, ' + POINTS[Math.round(said / 45) % 8]);
  }
}
let hudAt = 0;
function paintFlight(g) {
  const p = flight.pos, site = siteForCamera();
  const agl = g == null ? null : p.y - g;
  const hdg = ((flight.yaw / DEG + site.conv) % 360 + 360) % 360;
  compassConv = site.conv;
  const spd = groundSpeed; // measured from the camera's own movement (see tick), not the key/pad velocity
  flightEl.textContent =
    'E ' + (CE + p.x).toFixed(0) + '  N ' + (CN - p.z).toFixed(0) + '\n' +
    'Height ' + (agl == null ? '–' : agl.toFixed(1) + ' m') + ' above ground · ' + (p.y + ORIGIN_OD).toFixed(0) + ' m OD\n' +
    'Heading ' + hdg.toFixed(0).padStart(3, '0') + '° true · ' + (spd < 10 ? spd.toFixed(1) : spd.toFixed(0)) + ' m/s\n' +
    site.lat.toFixed(5) + '° N  ' + Math.abs(site.lon).toFixed(5) + '° W';
}
const hud = document.getElementById('hud');
{
  const saved = sessionStorage.getItem('fl_hud_open');
  const open = saved != null ? saved === '1' : innerWidth > 700;
  hud.classList.toggle('closed', !open);
  const hudBtn = document.getElementById('hudToggle');
  hudBtn.setAttribute('aria-expanded', String(open));
  hudBtn.onclick = () => { const closed = hud.classList.toggle('closed'); hudBtn.setAttribute('aria-expanded', String(!closed)); sessionStorage.setItem('fl_hud_open', closed ? '0' : '1'); };
}

// ---------------------------------------------------------------- graphics quality note
// A small 'Low-graphics mode' button by the title: says why, and switches to full graphics (reloads).
function paintQuality() {
  let b = document.getElementById('qualityBtn');
  if (!LOWQ) { if (b) b.remove(); return; }
  if (!b) {
    b = document.createElement('button'); b.type = 'button'; b.id = 'qualityBtn'; b.textContent = 'Low-graphics mode';
    b.onclick = () => { lsSet(Q_KEY, 'high'); ssSet(GL_LOSS_KEY, '0'); const u = new URL(location.href); u.searchParams.delete('quality'); u.searchParams.delete('retry'); location.href = u.href; };
    const top = document.querySelector('#hud .top b'); if (top) top.appendChild(b);
  }
  const t = 'Low-graphics mode (' + FLY.qualityWhy + '): no shadows or smoothing, lower resolution. Click to use full graphics (the page reloads).';
  b.title = t; b.setAttribute('aria-label', t);
}
// Switch to low quality in place (after a restored context): shadows off, pixel ratio 1, coarser ground.
// Antialias and logarithmic depth are fixed when the renderer is made, so they change on the next load.
function setLowQuality(on, why) {
  if (!on || LOWQ) return;
  LOWQ = true; FLY.quality = 'low'; FLY.qualityWhy = why;
  renderer.shadowMap.enabled = false; sunLight.castShadow = false;
  scene.traverse((o) => { const m = o.material; if (m) for (const mm of [].concat(m)) mm.needsUpdate = true; });
  renderer.setPixelRatio(Math.min(devicePixelRatio, PR_CAP())); renderer.setSize(innerWidth, innerHeight);
  paintQuality();
}
paintQuality();
if (LOWQ) console.info('Low-graphics mode: ' + FLY.qualityWhy + '.');

// Ground speed for the readout: horizontal distance the camera actually moved per second, smoothed (about 0.4 s),
// so drags, the wheel, Go to flights, the tour and orbiting count as well as keys and the pad (flight.vel only
// covers keys and the pad, so the readout used to sit at 0.0 m/s for everything else). Jumps (reduced-motion
// Go to, plan view) are ignored; it settles to 0 when still.
let groundSpeed = 0; const lastPos = new THREE.Vector3(NaN, 0, 0);
function measureSpeed(dt) {
  const d = Math.hypot(flight.pos.x - lastPos.x, flight.pos.z - lastPos.z);
  lastPos.copy(flight.pos);
  if (!(dt > 0) || !Number.isFinite(d)) return;
  const v = d / dt;
  if (v > 5000) return; // a jump, not a flight
  groundSpeed += (v - groundSpeed) * (1 - Math.exp(-dt / (v < groundSpeed ? 0.2 : 0.4))); // falls faster than it rises
  if (groundSpeed < 0.3 && v < 0.05) groundSpeed = 0;
  FLY.groundSpeed = groundSpeed;
}

// ---------------------------------------------------------------- frame loop
let last = performance.now(), firstFrame = true;
function tick(now) {
  requestAnimationFrame(tick);
  if (glDown) { last = now; return; } // context lost: draw nothing until it is back
  FLY.frames = (FLY.frames || 0) + 1;
  const dt = Math.min(0.1, (now - last) / 1000);
  const realDt = Math.min(0.5, (now - last) / 1000); // fades keep to wall-clock time on slow machines
  last = now;
  // Stream: add ground pieces for up to 8 ms per frame.
  const qStart = performance.now();
  while (addQueue.length && performance.now() - qStart < 8) timed('add', addQueue.shift());
  if (holeDirty && now - holeAt > 300) { holeDirty = false; holeAt = now; timed('hole', updateCoarseHole); }
  if (skyPlay && bodyMode !== 'off') {
    minuteUt += dt * 1000 * 0.04;
    if (playEnd != null && minuteUt >= playEnd) { minuteUt = playEnd; stopDayPlay(); }
    syncUtUi();
  }
  stepRotate(dt);
  if (flyAnim) stepFlyAnim(dt); else stepFlight(dt);
  stepTour(dt);
  const g = clampFlight();
  applyCamera();
  measureSpeed(realDt);
  const agl = g == null ? 50 : flight.pos.y - g;
  // Without logarithmic depth (low quality) a larger near plane keeps the far ground from flickering.
  const wantNear = LOWQ && !renderer.capabilities.logarithmicDepthBuffer ? THREE.MathUtils.clamp(agl * 0.12, 1, 60) : THREE.MathUtils.clamp(agl * 0.08, 0.3, 40);
  if (Math.abs(wantNear - cam.near) / cam.near > 0.15) { cam.near = wantNear; cam.updateProjectionMatrix(); }
  riverBias.value = 2 * cam.near * 0.002;
  if (farRiverLines) farRiverLines.visible = agl > 1500;
  // Detail tiles: the full 10 m grid near the camera, every other point further away.
  for (const t of tiles) {
    const b = t.bbox;
    const dx = Math.max(b[0] - flight.pos.x, 0, flight.pos.x - b[2]);
    const dz = Math.max(b[1] - flight.pos.z, 0, flight.pos.z - b[3]);
    const lod = Math.hypot(dx, dz, agl * 0.5) < (LOWQ ? 900 : 1800) ? 0 : 1;
    if (lod !== t.lod) { t.lod = lod; t.meshes[0].visible = lod === 0; t.meshes[1].visible = lod === 1; }
  }
  skyDome.position.copy(cam.position);
  skyDome.material.uniforms.eyePos.value.copy(cam.position);
  timed('sky', placeSky);
  timed('stars', updateStars);
  if (now - hudAt > 100) { hudAt = now; paintFlight(g); }
  updateCompass();
  stepPeriods(realDt, now);
  updateLabelVis(now);
  { const t1 = performance.now(); updateRays(now); const t2 = performance.now(); drawRays(); const t3 = performance.now(); rayStats.updMs += t2 - t1; rayStats.drawMs += t3 - t2; }
  timed('render', () => renderer.render(scene, cam));
  if (firstFrame) { firstFrame = false; mark('firstFrame'); setTimeout(afterFirstFrame, 0); }
}
// Shaders for ground, river and landmark materials are prepared while the ground downloads,
// in the background where the browser supports parallel shader compilation.
let monReady = false, pendingMon = null;
function afterFirstFrame() {
  makeSiteLabels();
  setTimeout(() => { monReady = true; seatStones(); if (pendingMon) { addMonuments(pendingMon); pendingMon = null; } }, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(9), 3, true));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
  const g4 = g.clone(); g4.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(12), 4, true)); // monuments: RGBA (period in A)
  const warm = new THREE.Group();
  for (const m of [terrainMat, detailMat, nearMat, monMat, riverMat]) { const mesh = new THREE.Mesh(m === monMat ? g4 : g, m); mesh.receiveShadow = true; mesh.frustumCulled = false; warm.add(mesh); }
  // Degenerate triangles at one point: nothing is drawn, but compile() only visits visible objects.
  scene.add(warm);
  const done = () => { scene.remove(warm); mark('warm'); };
  if (renderer.extensions.has('KHR_parallel_shader_compile')) renderer.compileAsync(scene, cam).then(done);
  else { renderer.compile(scene, cam); done(); }
}

// ---------------------------------------------------------------- start
setPose(poseAround(PLACES.sh.x, PLACES.sh.z, PLACES.sh));
paintPlace('sh');
setPeriod(NPER - 1);
if (periodCap) { periodCap.classList.remove('show'); periodCapUntil = 0; }
paintPlan();
document.getElementById('epochYear').value = String(MODERN_YEAR);
document.getElementById('btnEpochModern').title = 'This year (' + MODERN_YEAR + ')';
{ const o = document.querySelector('#alEpoch option[value="modern"]'); if (o) o.textContent = 'Modern (' + MODERN_YEAR + ')'; }
paintSkyButtons();
syncUtUi();
worker.postMessage({ type: 'start', cam: { x: flight.pos.x, z: flight.pos.z }, early: Object.keys(window.__early || {}) });
for (const [name, p] of Object.entries(window.__early || {})) {
  p.then((buf) => worker.postMessage({ type: 'buf', name, buf }, [buf]))
   .catch((err) => worker.postMessage({ type: 'buf', name, error: String(err && err.message || err) }));
}
requestAnimationFrame(tick);
addEventListener('resize', () => {
  cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
  // devicePixelRatio changes with browser zoom or a move to another screen; keep the same cap as at start.
  renderer.setPixelRatio(Math.min(devicePixelRatio, PR_CAP()));
  renderer.setSize(innerWidth, innerHeight);
});

// Hooks for checking from the console and tests.
FLY.api = {
  // Timber monuments state, for tests.
  timber() {
    const whVisible = { all: posts.filter((m) => m.visible).length };
    for (const k of Object.keys(whRingCount)) whVisible[k] = posts.filter((m) => m.visible && m.userData.ring === k).length;
    const b = BU ? localXZ(BU.origin_e, BU.origin_n) : null;
    return { whCount: posts.length, whRingCount, whVisible, whH: postH, whGround: FLY.whPostGround, whCentre: [centre.x, centre.z],
      buShown: buGroup.visible, buFeatures: buFeat.length, buLabels: buLabels.length, buLabelsVisible: buLabels.filter((l) => l.spr.visible).length, buStacked: buLabels.filter((l) => l.spr.visible && l.spr.center.y < 0).length, labelSprites: labels.length, buOverlap: (() => { const r = buLabels.filter((l) => l.spr.visible).map((l) => { const q = FLY.api.toScreen(l.spr.position.x, l.spr.position.y, l.spr.position.z); if (!q) return null; const f = innerHeight / 2 / Math.tan(cam.fov * DEG / 2), w = l.spr.scale.x * f, h = l.spr.scale.y * f; return { x: q.x, y: q.y + l.spr.center.y * h, w, h }; }).filter(Boolean); let n = 0; for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) if (Math.abs(r[i].x - r[j].x) < (r[i].w + r[j].w) / 2 - 1 && Math.abs(r[i].y - r[j].y) < (r[i].h + r[j].h) / 2 - 1) n++; return n; })(),
      buPostH: buFeat.filter((q) => q.h).map((q) => +(q.mesh.scale.y).toFixed(2)), axisH: BU_AXIS && [BU_AXIS.ha, BU_AXIS.hb], buCentre: BU_AXIS ? [(BU_AXIS.a.x + BU_AXIS.b.x) / 2 - 30, (BU_AXIS.a.z + BU_AXIS.b.z) / 2] : b && [b.x, b.z] };
  },
  heightAt, setPose, poseAround, flyTo, goPlace, seekFrom, localXZ, FS, THREE,
  get flight() { return flight; }, get grids() { return grids; }, get tiles() { return tiles; },
  setSky(o) { if (o.year != null) epochYear = o.year; if (o.doy != null) doy = o.doy; if (o.mode) bodyMode = o.mode; if (o.limb) limb = o.limb; paintSkyButtons(); reseek(); syncUtUi(); },
  setMinute(m) { minuteUt = m; pendingSeek = false; autoSeekPending = false; manualTime = true; syncUtUi(); },
  keys, setPeriod, togglePlan, groundHit, get flying() { return !!(flyAnim || tour); }, runAlignment, computeAlignment, ALIGN_EVENTS, setRayMode, get alignActive() { return alignActive; }, clearAlign() { alignActive = null; }, get plan() { return plan; }, get periodAlpha() { return periodAlpha; },
  // Bearing of the drawn sun/moon disc as seen from the camera, read back from the scene.
  programs() { return renderer.info.programs.map((p) => p.name + ' ' + p.usedTimes); },
  // Screen position (px) of a world point, and of the drawn sun/moon disc; null when behind the camera.
  toScreen(x, y, z) { applyCamera(); cam.updateMatrixWorld(); const v = new THREE.Vector3(x, y, z).project(cam); if (v.z > 1) return null; return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }; },
  discScreen() { const d = moonDisc.visible ? moonDisc : sunDisc; if (!d.visible) return null; return FLY.api.toScreen(d.position.x, d.position.y, d.position.z); },
  get fov() { return cam.fov; },
  // Turning the view (tests): true heading in degrees, and the same entry points as the compass and keys.
  rotate: { start: rotStart, end: rotEnd, step: rotStep, north: resetNorth, get heading() { return ((flight.yaw / DEG + siteForCamera().conv) % 360 + 360) % 360; }, get busy() { return !!(rot.src.size || rot.pending); } },
  get starAttr() { return starGeo.getAttribute('position'); }, get skyCacheSize() { return skyCache.size; }, get groundVer() { return groundVer; }, get logDepth() { return FLY.logDepthOn; }, get rendererAttempt() { return FLY.rendererAttempt; }, MODERN_YEAR,
  discBearing() {
    const d = (moonDisc.visible ? moonDisc : sunDisc).position.clone().sub(cam.position);
    const grid = (Math.atan2(d.x, -d.z) / DEG + 360) % 360;
    const alt = Math.atan2(d.y, Math.hypot(d.x, d.z)) / DEG;
    const conv = siteForCamera().conv;
    return { grid, true: grid + conv, alt, conv, dist: d.length() };
  },
};
