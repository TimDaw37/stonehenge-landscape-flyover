// index.html: free flight over the Stonehenge, Woodhenge and Bulford landscape.
import * as THREE from 'three';
import * as FS from './flyover_sky.js';
import * as Sky from '../../skyscape_sky.js';
import { starHorizontal, starsAbove } from '../../stars_sky.js';

// ---------------------------------------------------------------- basics
const FLY = window.__fly = { marks: {}, detailDone: false, bytes: {} };
const mark = (k) => { if (FLY.marks[k] == null) FLY.marks[k] = Math.round(performance.now()); };
FLY.slow = [];
function timed(name, fn) { const t = performance.now(); const r = fn(); const d = performance.now() - t; if (d > 25) FLY.slow.push([name, Math.round(t), Math.round(d)]); return r; }
const CE = 412245.35, CN = 142194.11, ORIGIN_OD = 102.588;
const DEG = Math.PI / 180;
const P = window.WOODHENGE_POSTS;
const BU = window.BULFORD;
const HZ = window.WOODHENGE_HORIZON;
function localXZ(e, n) { return { x: e - CE, z: -(n - CN) }; }
const EXTENT = 5950; // stay inside the 12 km ground
const isTouch = ('ontouchstart' in window) || matchMedia('(pointer: coarse)').matches;
if (isTouch) document.body.classList.add('touch');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('c').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x071018);
const cam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 260000);
cam.rotation.order = 'YXZ';

const hemi = new THREE.HemisphereLight(0xc9d4e8, 0x3d4a3a, 0.55);
scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xffe2a8, 1.35);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { near: 10, far: 2400, left: -160, right: 160, top: 160, bottom: -160 });
sunLight.shadow.bias = -0.0004;
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

// Stars: directions from stars_sky (Stonehenge observer, x east, z minus TRUE north).
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
// Grids arrive from the worker: near (Stonehenge, 2.5 m), detail (Woodhenge/Bulford, 10 m), coarse (12 km, 55 m).
const grids = { near: null, detail: null, coarse: null };
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
  return null;
}
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
let groundY = WH_GROUND0; // Woodhenge post seat
const POST_H = 7.5;
const posts = [];
{
  const mats = {};
  for (const k of Object.keys(RING_COLOUR)) mats[k] = periodMat(new THREE.MeshLambertMaterial({ color: RING_COLOUR[k] }), 2);
  const geo = new THREE.CylinderGeometry(0.32, 0.32, 3, 12);
  for (const hole of P.posts) {
    const ring = hole.ring || '?';
    const p = localXZ(hole.e, hole.n);
    const mesh = new THREE.Mesh(geo, mats[ring] || mats['?']);
    mesh.castShadow = true;
    mesh.scale.y = POST_H / 3;
    mesh.position.set(p.x, groundY + POST_H / 2, p.z);
    scene.add(mesh);
    posts.push(mesh);
  }
}

// Stonehenge stones, present monument, same boxes as landscape.html.
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
  if (id === '80' || e.colour_class === 'altar_pink') return 0xff69b4;
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
    // Stones sit on the 1 m DTM ground OD from site_ground_od.js, as on landscape.html.
    mesh.position.set(p.x, seat.baseRel + (S_ORIGIN_OD - ORIGIN_OD) + seat.H / 2, p.z);
    mesh.rotation.y = THREE.MathUtils.degToRad(e.yaw_deg || 0);
    scene.add(mesh);
  }
}

// Bulford pits and the two standing posts, true size, on their surveyed ground OD.
const buRings = [];
if (BU) {
  const kindCol = { post: 0xc42828, base: 0xd97706, pit: 0xeab308, henge: 0x44403c };
  for (const f of BU.features) {
    const p = localXZ(f.e, f.n);
    const y = f.ground - ORIGIN_OD;
    let mesh;
    if (f.kind === 'post') {
      const h = BU.post_h[f.id] || 2;
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, h, 10), periodMat(new THREE.MeshLambertMaterial({ color: kindCol.post }), 2));
      mesh.position.set(p.x, y + h / 2, p.z);
      mesh.castShadow = true;
    } else {
      // 'henge' features are pits cut into the two ring ditches (as bulford-posts-3d), not ring centres.
      const r = f.kind === 'base' ? 0.7 : 0.45;
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.35, 12), periodMat(new THREE.MeshLambertMaterial({ color: kindCol[f.kind] || kindCol.pit }), 2));
      mesh.position.set(p.x, y + 0.18, p.z);
    }
    scene.add(mesh);
  }
  // The two henge ring ditches, once each, from BULFORD.henges (x east, z = minus north from the origin).
  for (const h of BU.henges || []) {
    const e = BU.origin_e + h.x, n = BU.origin_n - h.z, p = localXZ(e, n);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(h.r, 0.7, 8, 48), periodMat(new THREE.MeshLambertMaterial({ color: 0x57534e }), 2));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, 97 - ORIGIN_OD, p.z);
    ring.userData.en = [e, n];
    buRings.push(ring);
    scene.add(ring);
  }
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
  labelVisAt = 0;
}

// Woodhenge bank and ditch (schematic contour), as landscape.html. The ground north arrow is replaced by the compass.
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
  for (const m of posts) m.position.y = y + POST_H / 2;
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
}
function setLabels(on) {
  labelsOn = on;
  document.getElementById('labelsOn').checked = on;
  labelVisAt = 0;
}
document.getElementById('labelsOn').onchange = (ev) => setLabels(ev.target.checked);
document.getElementById('lmOn').onchange = (ev) => { lmGroup.visible = ev.target.checked; setLabels(labelsOn); };
if (MON) { const cr = document.getElementById('credits'); if (cr) cr.textContent = MON.credits; }

// ---------------------------------------------------------------- terrain streaming
const loadEl = document.getElementById('load');
const loadState = { coarse: false, near: false, river: false, tiles: 0, nTiles: 36, error: '' };
function paintLoad() {
  const t = (b) => b ? '✓' : '…';
  loadEl.textContent = loadState.error ? ('Ground: ' + loadState.error)
    : FLY.detailDone ? 'Ground: full detail'
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

const worker = new Worker(new URL('./terrain_worker.js', import.meta.url));
worker.onmessage = (ev) => {
  const d = ev.data;
  if (d.type === 'bytes') { FLY.bytes[d.name] = d.bytes; return; }
  if (d.type === 'grid') {
    grids[d.name] = d;
    seatWoodhenge();
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
  const dur = opts.dur != null ? opts.dur : THREE.MathUtils.clamp(1.2 + Math.sqrt(dist) / 13, 1.2, 7);
  flyAnim = { from, to: pose, t: 0, dur, arc: Math.min(450, dist * 0.12), onDone: opts.onDone || null };
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
  const tg = ev.target;
  if (tg && ((tg.tagName === 'INPUT' && tg.type === 'number') || tg.tagName === 'SELECT')) return;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
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
addEventListener('keyup', (ev) => keys.delete(ev.code));
addEventListener('blur', () => keys.clear());

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
    else if (touches.size === 2) { drag = null; pinch = pinchState(); }
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
        const len2 = THREE.MathUtils.clamp(len * f, 8, 12000);
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
  for (let t = 1; t < 30000; t += Math.max(2, t * 0.01)) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    const h = heightAt(x, z);
    if (h == null) { if (Math.abs(x) > 6100 || Math.abs(z) > 6100) return null; prev = t; continue; }
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

function stepFlight(dt) {
  const has = (c) => keys.has(c);
  const fast = (has('ShiftLeft') || has('ShiftRight')) ? 4 : 1;
  const sp = baseSpeed * fast;
  const fwd = (has('KeyW') || has('ArrowUp') ? 1 : 0) - (has('KeyS') || has('ArrowDown') ? 1 : 0) + touch.fwd;
  const str = (has('KeyD') ? 1 : 0) - (has('KeyA') ? 1 : 0);
  const turn = (has('ArrowRight') ? 1 : 0) - (has('ArrowLeft') ? 1 : 0) + touch.turn;
  const up = (has('KeyE') || has('KeyR') ? 1 : 0) - (has('KeyQ') || has('KeyF') ? 1 : 0) + touch.up;
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
  p.x = THREE.MathUtils.clamp(p.x, -EXTENT, EXTENT);
  p.z = THREE.MathUtils.clamp(p.z, -EXTENT, EXTENT);
  const g = heightAt(p.x, p.z);
  const floor = (g == null ? -9 : g) + minAgl;
  if (p.y < floor) { p.y = floor; if (flight.vel.y < 0) flight.vel.y = 0; }
  if (p.y > 4000) { p.y = 4000; if (flight.vel.y > 0) flight.vel.y = 0; }
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
  const s = PLACES[key];
  flyTo(poseAround(s.x, s.z, s), { onDone: arrived });
}
function arrived() {
  if (document.getElementById('retime').checked && bodyMode !== 'off' && !skyPlay && !manualTime) { pendingSeek = true; autoSeekPending = true; }
}
document.getElementById('goSH').onclick = () => goPlace('sh');
document.getElementById('goWH').onclick = () => goPlace('wh');
document.getElementById('goBU').onclick = () => goPlace('bu');

// Tour stops as data: target (OSGB E, N), camera distance, grid bearing target to camera, height, hold, caption.
const TOUR = [
  { en: [412245.35, 142194.11], dist: 5200, fromDeg: 200, up: 1700, look: 30, hold: 4.5, title: 'Chalk between two rivers', date: 'The ground',
    text: 'Twelve kilometres of Environment Agency lidar ground. The Till runs down the west side, the Avon down the east.' },
  { en: [412245.35, 142194.11], dist: 900, fromDeg: 230, up: 210, look: 10, hold: 5, title: 'Stonehenge', date: 'c. 2500 BC',
    text: 'The ditch and bank are older, dug about 3000 BC. The sarsens came five centuries later.' },
  { en: [412245.35, 142194.11], dist: 150, fromDeg: 230, up: 22, look: 6, hold: 5, title: 'Along the axis', date: 'c. 2500 BC',
    text: 'Looking out through the entrance toward the midsummer sunrise.' },
  { en: [410900, 142960], dist: 1500, fromDeg: 200, up: 400, look: 6, hold: 5, title: 'The Greater Cursus', date: 'c. 3500 BC',
    text: 'Almost three kilometres of bank and ditch running east to west, a thousand years older than Stonehenge. Line from OpenStreetMap.' },
  { en: [412700, 141300], dist: 1100, fromDeg: 170, up: 280, look: 8, hold: 5, title: 'Barrow cemeteries', date: 'c. 2400 – 1600 BC',
    text: 'Round barrows set along the ridges that overlook Stonehenge. Mounds from Historic England aerial mapping.' },
  { en: [415010, 143721], dist: 900, fromDeg: 200, up: 320, look: 12, hold: 5, title: 'Durrington Walls and Woodhenge', date: 'c. 2500 BC',
    text: 'The great henge beside the Avon, with Woodhenge just to the south.' },
  { en: [P.centre.e, P.centre.n], dist: 140, fromDeg: 230, up: 45, look: 3, hold: 5.5, title: 'Woodhenge', date: 'c. 2635 – 2575 BC',
    text: 'Six oval rings of timber posts, 156 in this model after Maud Cunnington\u2019s plan, with the later bank and ditch around them.' },
];
if (BU) TOUR.push({ en: [BU.origin_e - 25, BU.origin_n - 10], dist: 125, fromDeg: 230, up: 32, look: 2, hold: 6, title: 'Bulford', date: '',
  text: 'Pits and two standing posts. The line through the posts runs at ' + (BU_POSTS_TRUE ? BU_POSTS_TRUE.true.toFixed(1) : '48.3') + '\u00b0 true, about two degrees south of the modern midsummer sunrise.' });
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

let epochYear = 2026, doy = 172, minuteUt = 237;
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
    try { const uk = Sky.dateFromDoyMinute(epochYear, doy, min).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }); return uk + ' UK · ' + ut; } catch (e) { /* UT only */ }
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
  document.getElementById('btnEpochModern').classList.toggle('active', epochYear === 2026);
  document.getElementById('btnEpoch2500').classList.toggle('active', epochYear === -2499);
}

// Observer at the camera: latitude, longitude, height and grid convergence, refreshed every 20 m of movement.
let camSite = null;
function siteForCamera() {
  const p = flight.pos;
  if (!camSite || Math.hypot(p.x - camSite.x, p.z - camSite.z) > 20 || Math.abs(p.y - camSite.y) > 20) camSite = FS.siteAt(p.x, p.z, p.y);
  return camSite;
}
// Rise/set time for someone standing (eye 1.6 m) on the ground at x,z, against the skyline of the loaded ground.
// Where the ground data stops less than 2.5 km out toward the rise/set point (Bulford is 1 km from the
// east edge), the skyline there is unknown, so the time comes from the measured Woodhenge skyline
// (woodhenge/horizon.js), as landscape.html did. The disc is still drawn from the camera.
const REACH_MIN = 2500;
const HZ_SKY = (HZ && HZ.alt_deg && HZ.alt_deg.length) ? { alts: HZ.alt_deg, step: HZ.step_deg || 0.25 } : null;
function seekFrom(x, z, opts) {
  const gy = heightAt(x, z);
  if (gy == null) return null;
  const eye = gy + 1.6;
  const site = FS.siteAt(x, z, eye);
  let sky = FS.skylineAt(heightAt, x, z, eye, site.conv);
  let hit = FS.seekLimbAt(site, Object.assign({ alts: sky.alts, step: sky.step }, opts));
  let skyline = 'local';
  if (hit && HZ_SKY && FS.minReach(sky, hit.geoAz, 3) < REACH_MIN) {
    const hzP = localXZ(HZ.eye.e, HZ.eye.n);
    const hzSite = FS.siteAt(hzP.x, hzP.z, HZ.eye.ground_od - ORIGIN_OD + (HZ.eye.agl || 1.6));
    const h2 = FS.seekLimbAt(hzSite, Object.assign({ alts: HZ_SKY.alts, step: HZ_SKY.step }, opts));
    if (h2) { hit = h2; sky = Object.assign({}, HZ_SKY, { reach: null }); skyline = 'woodhenge'; }
  }
  return { site, sky, hit, skyline };
}
function seekHere() {
  const r = seekFrom(flight.pos.x, flight.pos.z, { body: skyBody(), year: epochYear, doy, rising: bodyMode === 'sunrise' || bodyMode === 'moonrise', limb });
  if (!r) return false;
  lastSeek = { e: r.site.e, n: r.site.n, hit: r.hit, full: FLY.detailDone, skyline: r.skyline };
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
    const date = Sky.dateFromDoyMinute(epochYear, doy, minuteUt);
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
      : ' ' + what + ' timed on the skyline at E ' + Math.round(lastSeek.e) + ' N ' + Math.round(lastSeek.n) + (lastSeek.full ? '' : ' (coarse ground)') + '.';
  }
  else if (lastSeek && !lastSeek.hit) txt += ' No ' + B.body.toLowerCase() + (bodyMode.endsWith('rise') ? 'rise' : 'set') + ' on this date.';
  if (BU_POSTS_TRUE && PLACES.bu && Math.hypot(flight.pos.x - PLACES.bu.x, flight.pos.z - PLACES.bu.z) < 1500) txt += ' Bulford posts line ' + BU_POSTS_TRUE.true.toFixed(1) + '° true.';
  if (txt !== readout.textContent) readout.textContent = txt;
}
function stopDayPlay() {
  skyPlay = false; playEnd = null;
  for (const id of ['btnSkyPlay', 'btnDaySun', 'btnDayMoon']) document.getElementById(id).classList.remove('active');
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
  document.getElementById('btnSkyPlay').classList.add('active');
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
document.getElementById('btnEpochModern').onclick = () => setEpoch(2026);
document.getElementById('btnEpoch2500').onclick = () => setEpoch(-2499);
document.getElementById('epochYear').onchange = (ev) => setEpoch(Math.trunc(+ev.target.value) || 2026);
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
document.getElementById('btnSkyPlay').onclick = () => { if (skyPlay) stopDayPlay(); };

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
  const pos = new Float32Array(rows.length * 3), mag = new Float32Array(rows.length);
  for (let i = 0; i < rows.length; i++) { pos[i * 3] = rows[i].x * STAR_R; pos[i * 3 + 1] = rows[i].y * STAR_R; pos[i * 3 + 2] = rows[i].z * STAR_R; mag[i] = rows[i].mag; }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  starGeo.computeBoundingSphere();
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
const ALIGN_EVENTS = {
  'sun-ms-rise': { body: 'Sun', kind: 'midsummer', rising: true, label: 'Midsummer sunrise' },
  'sun-ms-set': { body: 'Sun', kind: 'midsummer', rising: false, label: 'Midsummer sunset' },
  'sun-mw-rise': { body: 'Sun', kind: 'midwinter', rising: true, label: 'Midwinter sunrise' },
  'sun-mw-set': { body: 'Sun', kind: 'midwinter', rising: false, label: 'Midwinter sunset' },
  'sun-eq-rise': { body: 'Sun', kind: 'equinox', rising: true, label: 'Equinox sunrise (March)' },
  'sun-eq-set': { body: 'Sun', kind: 'equinox', rising: false, label: 'Equinox sunset (March)' },
};
for (const [mj, mjn] of [[true, 'major'], [false, 'minor']]) for (const [no, non] of [[true, 'north'], [false, 'south']]) for (const [ri, rin] of [[true, 'rise'], [false, 'set']]) {
  ALIGN_EVENTS['moon-' + mjn + '-' + non + '-' + rin] = { body: 'Moon', major: mj, north: no, rising: ri,
    label: 'Moon' + rin + ', ' + mjn + ' standstill, ' + (no ? 'northern' : 'southern') + ' extreme' };
}
const MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function yearLabel(y) { return y <= 0 ? (1 - y) + ' BC (year ' + y + ')' : 'AD ' + y; }
function dateLabel(d) { return d.getUTCDate() + ' ' + MON3[d.getUTCMonth()] + ' ' + yearLabel(d.getUTCFullYear()); }
function utLabel(d) { return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' UT'; }
// All rise (or set) crossings of the chosen limb within +-30 h of a moment, against one skyline.
function crossingsAround(site, skyAlts, skyStep, ev, limb, when) {
  const s0 = FS.doyMinuteOf(new Date(when.getTime() - 30 * 3600e3));
  const out = [];
  for (let t = s0.minute, end = s0.minute + 60 * 60, guard = 0; t < end && guard < 12; guard++) {
    const h = FS.seekLimbAt(site, { body: ev.body, year: s0.year, doy: s0.doy, rising: ev.rising, limb, alts: skyAlts, step: skyStep, notBefore: t });
    if (!h) { t += 20 * 60; continue; }
    out.push(h);
    t = h.minute + 60;
  }
  return out;
}
function pickCrossing(hits, ev, when) {
  if (!hits.length) return null;
  if (ev.body === 'Sun') return hits.reduce((a, b) => Math.abs(b.date - when) < Math.abs(a.date - when) ? b : a);
  // Moon: the most extreme azimuth (furthest north or south) among the crossings either side of the extreme.
  const northish = ev.north === ev.rising; // north rise and south set have the smallest azimuths
  return hits.reduce((a, b) => (northish ? b.geoAz < a.geoAz : b.geoAz > a.geoAz) ? b : a);
}
// Event moments depend only on the event and the year: kept, so repeated look-ups (plan-view rays) are quick.
const eventWhenCache = new Map();
function eventWhen(ev, year) {
  const key = (ev.body === 'Sun' ? ev.kind : (ev.major ? 'maj' : 'min') + (ev.north ? 'N' : 'S')) + '|' + year;
  let w = eventWhenCache.get(key);
  if (w) return w;
  if (ev.body === 'Sun') {
    const when = FS.solarEventDate(year, ev.kind);
    w = { when, info: (ev.kind === 'equinox' ? 'March equinox ' : ev.kind === 'midsummer' ? 'June solstice ' : 'December solstice ') + dateLabel(when) + ' ' + utLabel(when) };
  } else {
    const ss = FS.standstillEpoch(year, ev.major);
    const ex = FS.moonExtremeNear(ss.date, ev.north);
    w = { when: ex.date, info: (ev.major ? 'Major' : 'Minor') + ' standstill: mean node at ' + (ev.major ? '0' : '180') + '\u00b0 in ' + ss.yearDecimal.toFixed(2) +
      '; ' + (ev.north ? 'northern' : 'southern') + ' extreme declination ' + (ex.dec >= 0 ? '+' : '') + ex.dec.toFixed(2) + '\u00b0 on ' + dateLabel(ex.date) + ' ' + utLabel(ex.date) };
  }
  eventWhenCache.set(key, w);
  return w;
}
// opts.lazy: trace only the skyline bins the search reads (same values as the full skyline).
function computeAlignment(x, z, ev, year, limb, opts = {}) {
  const gy = heightAt(x, z);
  if (gy == null) return { error: 'No ground data at that point.' };
  const eye = gy + 1.6, site = FS.siteAt(x, z, eye);
  const { when, info } = eventWhen(ev, year);
  let sky = (opts.lazy ? FS.lazySkylineAt : FS.skylineAt)(heightAt, x, z, eye, site.conv);
  let hit = pickCrossing(crossingsAround(site, sky.alts, sky.step, ev, limb, when), ev, when);
  let skyline = 'local', obsSite = site;
  if (hit && HZ_SKY && FS.minReach(sky, hit.geoAz, 3) < REACH_MIN) {
    // The map ends too close in that direction (Bulford): time it on the measured Woodhenge skyline, as seekFrom does.
    const hzP = localXZ(HZ.eye.e, HZ.eye.n);
    const hzSite = FS.siteAt(hzP.x, hzP.z, HZ.eye.ground_od - ORIGIN_OD + (HZ.eye.agl || 1.6));
    const h2 = pickCrossing(crossingsAround(hzSite, HZ_SKY.alts, HZ_SKY.step, ev, limb, when), ev, when);
    if (h2) { hit = h2; skyline = 'woodhenge'; obsSite = hzSite; }
  }
  if (!hit) return { error: 'No ' + (ev.rising ? 'rise' : 'set') + ' found near ' + dateLabel(when) + '.', info };
  return { site, obsSite, hit, skyline, info, when, gy };
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
  if (m === 'modern') return 2026;
  if (m === 'bc2500') return -2499;
  return Math.trunc(+document.getElementById('alYear').value) || 2026;
}
function runAlignment() {
  const key = document.getElementById('alSite').value, evKey = document.getElementById('alEvent').value;
  const limbKey = document.getElementById('alLimb').value;
  const ev = ALIGN_EVENTS[evKey], year = alignEpochYear();
  let x, z, siteName;
  if (key === 'here') { x = flight.pos.x; z = flight.pos.z; siteName = 'Here (E ' + Math.round(CE + x) + ' N ' + Math.round(CN - z) + ')'; }
  else { const S = ALIGN_SITES[key]; const p = localXZ(S.en[0], S.en[1]); x = p.x; z = p.z; siteName = S.name; }
  const t0 = performance.now();
  const r = computeAlignment(x, z, ev, year, limbKey);
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
  alignActive = { key, x, z, name: siteName }; // plan-view rays now start from this site
  const gridAz = h.geoAz - r.site.conv;
  flyTo({ pos: new THREE.Vector3(x, r.gy + 1.6, z), yaw: gridAz * DEG, pitch: (h.sky + 1.2) * DEG });
  const uk = (when.year >= 1970 && when.year <= 2100) ? ' (' + d.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }) + ' UK)' : '';
  const limbName = { first_gleam: 'first gleam', half_orb: 'half orb', full_orb: 'full orb' }[limbKey];
  const offs = axisOffsets(h.geoAz, key);
  const lines = [
    siteName + ' \u00b7 ' + ev.label + ' \u00b7 ' + limbName,
    'True azimuth ' + h.geoAz.toFixed(2) + '\u00b0 (grid ' + gridAz.toFixed(2) + '\u00b0)',
    'Skyline altitude ' + h.sky.toFixed(2) + '\u00b0 ' + (r.skyline === 'woodhenge' ? '(Woodhenge measured skyline: the map ends too close in this direction)' : '(lidar ground, eye 1.6 m)'),
    'Time ' + dateLabel(d) + ', ' + utLabel(d) + uk,
    r.info,
    offs.length ? 'Offset from site axes (event minus axis):' : 'No site axis within 20\u00b0 of this event.',
    ...offs.map((o) => '  ' + o.a.name + ' ' + (o.back ? (o.a.az + 180).toFixed(1) : o.a.az.toFixed(1)) + '\u00b0: ' + (o.d >= 0 ? '+' : '') + o.d.toFixed(2) + '\u00b0'),
  ];
  alignEl.textContent = lines.join('\n');
  FLY.align = { site: key, event: evKey, limb: limbKey, epoch: year, trueAz: h.geoAz, gridAz, skyAlt: h.sky, skyline: r.skyline,
    date: d.toISOString(), year: when.year, doy: when.doy, minute: when.minute, info: r.info, offsets: offs.map((o) => [o.a.name, o.a.az, +o.d.toFixed(3)]), ms };
}
{
  const selS = document.getElementById('alSite'), selE = document.getElementById('alEvent');
  if (selS && selE) {
    for (const [k, v] of Object.entries(ALIGN_SITES)) selS.add(new Option(v.name, k));
    selS.add(new Option('Here (current position)', 'here'));
    for (const [k, v] of Object.entries(ALIGN_EVENTS)) selE.add(new Option(v.label, k));
    document.getElementById('alEpoch').onchange = (ev) => { document.getElementById('alYear').style.display = ev.target.value === 'custom' ? '' : 'none'; };
    document.getElementById('alGo').onclick = runAlignment;
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
const rayFirst = new Map();   // event|year|limb -> { date, x, z }: the crossing found first (full search)
let rayState = { key: '', origin: null, results: new Map(), pending: [], year: 2026, limb: 'first_gleam', ev: 'sun-ms-rise' };
let rayDrawKey = '';
const rayStats = FLY.rayStats = { full: 0, quick: 0, updMs: 0, drawMs: 0 };
function rayOrigin() {
  if (alignActive) {
    const k = document.getElementById('alSite').value;
    if (k === 'here' || !ALIGN_SITES[k]) return { x: alignActive.x, z: alignActive.z, name: alignActive.name, site: true };
    const S = ALIGN_SITES[k], q = localXZ(S.en[0], S.en[1]);
    return { x: q.x, z: q.z, name: S.name, site: true };
  }
  return { x: flight.pos.x, z: flight.pos.z, name: 'view centre', site: false };
}
// True azimuth of one event from (x, z): the first time a full alignment search; afterwards the same rise or
// set is re-timed from this point's own skyline (a short search from 40 min before it), which is far quicker.
function rayAzimuth(o, evKey, year, limbKey, sky) {
  const ev = ALIGN_EVENTS[evKey], ck = evKey + '|' + year + '|' + limbKey;
  let f = rayFirst.get(ck);
  if (!f || Math.hypot(f.x - o.x, f.z - o.z) > 2500) {
    rayStats.full++;
    const r = computeAlignment(o.x, o.z, ev, year, limbKey, { lazy: true });
    if (r.error) return { error: r.error };
    rayFirst.set(ck, { date: r.hit.date, x: o.x, z: o.z });
    return { az: r.hit.geoAz, sky: r.hit.sky, skyline: r.skyline, date: r.hit.date };
  }
  rayStats.quick++;
  const s0 = FS.doyMinuteOf(new Date(f.date.getTime() - 40 * 60e3));
  const q = { body: ev.body, year: s0.year, doy: s0.doy, rising: ev.rising, limb: limbKey, notBefore: s0.minute };
  let h = FS.seekLimbAt(sky.site, { ...q, alts: sky.sky.alts, step: sky.sky.step }), skyline = 'local';
  if (h && HZ_SKY && FS.minReach(sky.sky, h.geoAz, 3) < REACH_MIN) {
    const hzP = localXZ(HZ.eye.e, HZ.eye.n);
    const hzSite = FS.siteAt(hzP.x, hzP.z, HZ.eye.ground_od - ORIGIN_OD + (HZ.eye.agl || 1.6));
    const h2 = FS.seekLimbAt(hzSite, { ...q, alts: HZ_SKY.alts, step: HZ_SKY.step });
    if (h2) { h = h2; skyline = 'woodhenge'; }
  }
  if (!h) { rayFirst.delete(ck); return rayAzimuth(o, evKey, year, limbKey, sky); }
  return { az: h.geoAz, sky: h.sky, skyline, date: h.date };
}
function rayWanted() {
  const evKey = document.getElementById('alEvent').value || 'sun-ms-rise';
  if (rayMode === 'fan') return FAN_KEYS.map((k) => ({ k, main: true }));
  const out = [{ k: evKey, main: true }];
  if (OPPOSITE[evKey]) out.push({ k: OPPOSITE[evKey], main: false });
  return out;
}
// Recompute when the centre moves (by more than 0.3% of the view width), or the event, epoch, limb or mode change.
function updateRays(now) {
  if (!plan || rayMode === 'off') return;
  const o = rayOrigin();
  const agl = Math.max(50, flight.pos.y - groundOr(flight.pos.x, flight.pos.z, 0));
  const tol = Math.max(1, agl * Math.tan(cam.fov * DEG / 2) * 2 * cam.aspect * 0.003);
  const year = alignEpochYear(), limbKey = document.getElementById('alLimb').value;
  const want = rayWanted();
  const key = rayMode + '|' + year + '|' + limbKey + '|' + want.map((w) => w.k).join(',') + '|' + o.name;
  const moved = !rayState.origin || Math.hypot(o.x - rayState.origin.x, o.z - rayState.origin.z) > tol;
  if (key !== rayState.key || moved) {
    if (key !== rayState.key) rayState.results = new Map();
    const gy = heightAt(o.x, o.z);
    if (gy == null) return;
    const site = FS.siteAt(o.x, o.z, gy + 1.6);
    rayState = { key, origin: o, results: rayState.results, pending: want.slice(), year, limb: limbKey, want,
      sky: { site, sky: FS.lazySkylineAt(heightAt, o.x, o.z, gy + 1.6, site.conv) } };
  }
  // Work through the list for up to 10 ms a frame.
  const t0 = performance.now();
  while (rayState.pending.length && performance.now() - t0 < 10) {
    const w = rayState.pending.shift();
    const r = rayAzimuth(rayState.origin, w.k, rayState.year, rayState.limb, rayState.sky);
    rayState.results.set(w.k, { ...r, main: w.main });
    rayDrawKey = '';
  }
  FLY.rays = { origin: { e: CE + rayState.origin.x, n: CN - rayState.origin.z, name: rayState.origin.name }, mode: rayMode, epoch: rayState.year, limb: rayState.limb,
    rays: [...rayState.results].map(([k, r]) => ({ k, name: rayName(k), az: r.az, sky: r.sky, skyline: r.skyline, main: r.main })), pending: rayState.pending.length };
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
  const o = rayState.origin, conv = rayState.sky.site.conv, oy = groundOr(o.x, o.z, 0);
  const W = innerWidth, H = innerHeight;
  const agl = Math.max(50, flight.pos.y - groundOr(flight.pos.x, flight.pos.z, 0));
  const halfDiag = agl * Math.tan(cam.fov * DEG / 2) * Math.hypot(1, cam.aspect);
  const D = Math.min(20000, Math.hypot(o.x - flight.pos.x, o.z - flight.pos.z) + halfDiag * 1.4);
  const [ox, oyS] = toScreen(o.x, oy, o.z);
  // Screen boxes to keep labels off: the panels and buttons over the view.
  const obstacles = [];
  for (const id of ['hud', 'flight', 'rayBox', 'planBtn', 'compass', 'load', 'credits', 'periodCap', 'caption', 'updown']) {
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
const compassRose = document.getElementById('compassRose');
let compassConv = 0.15, compassLast = 1e9;
function updateCompass() {
  if (!compassRose) return;
  const hdg = flight.yaw / DEG + compassConv;
  if (Math.abs(hdg - compassLast) < 0.1) return;
  compassLast = hdg;
  compassRose.setAttribute('transform', 'rotate(' + (-hdg).toFixed(2) + ')');
}
let hudAt = 0;
function paintFlight(g) {
  const p = flight.pos, site = siteForCamera();
  const agl = g == null ? null : p.y - g;
  const hdg = ((flight.yaw / DEG + site.conv) % 360 + 360) % 360;
  compassConv = site.conv;
  const spd = flight.vel.length();
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
  document.getElementById('hudToggle').onclick = () => { const closed = hud.classList.toggle('closed'); sessionStorage.setItem('fl_hud_open', closed ? '0' : '1'); };
}

// ---------------------------------------------------------------- frame loop
let last = performance.now(), firstFrame = true;
function tick(now) {
  requestAnimationFrame(tick);
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
  if (flyAnim) stepFlyAnim(dt); else stepFlight(dt);
  stepTour(dt);
  const g = clampFlight();
  applyCamera();
  const agl = g == null ? 50 : flight.pos.y - g;
  const wantNear = THREE.MathUtils.clamp(agl * 0.08, 0.3, 40);
  if (Math.abs(wantNear - cam.near) / cam.near > 0.15) { cam.near = wantNear; cam.updateProjectionMatrix(); }
  riverBias.value = 2 * cam.near * 0.002;
  // Detail tiles: the full 10 m grid near the camera, every other point further away.
  for (const t of tiles) {
    const b = t.bbox;
    const dx = Math.max(b[0] - flight.pos.x, 0, flight.pos.x - b[2]);
    const dz = Math.max(b[1] - flight.pos.z, 0, flight.pos.z - b[3]);
    const lod = Math.hypot(dx, dz, agl * 0.5) < 1800 ? 0 : 1;
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
paintSkyButtons();
syncUtUi();
worker.postMessage({ type: 'start', cam: { x: flight.pos.x, z: flight.pos.z }, early: Object.keys(window.__early || {}) });
for (const [name, p] of Object.entries(window.__early || {})) {
  p.then((buf) => worker.postMessage({ type: 'buf', name, buf }, [buf]))
   .catch((err) => worker.postMessage({ type: 'buf', name, error: String(err && err.message || err) }));
}
requestAnimationFrame(tick);
addEventListener('resize', () => { cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// Hooks for checking from the console and tests.
FLY.api = {
  heightAt, setPose, poseAround, flyTo, goPlace, seekFrom, localXZ, FS, THREE,
  get flight() { return flight; }, get grids() { return grids; }, get tiles() { return tiles; },
  setSky(o) { if (o.year != null) epochYear = o.year; if (o.doy != null) doy = o.doy; if (o.mode) bodyMode = o.mode; if (o.limb) limb = o.limb; paintSkyButtons(); reseek(); syncUtUi(); },
  setMinute(m) { minuteUt = m; pendingSeek = false; autoSeekPending = false; manualTime = true; syncUtUi(); },
  keys, setPeriod, togglePlan, groundHit, get flying() { return !!(flyAnim || tour); }, runAlignment, computeAlignment, ALIGN_EVENTS, setRayMode, get alignActive() { return alignActive; }, clearAlign() { alignActive = null; }, get plan() { return plan; }, get periodAlpha() { return periodAlpha; },
  // Bearing of the drawn sun/moon disc as seen from the camera, read back from the scene.
  programs() { return renderer.info.programs.map((p) => p.name + ' ' + p.usedTimes); },
  discBearing() {
    const d = (moonDisc.visible ? moonDisc : sunDisc).position.clone().sub(cam.position);
    const grid = (Math.atan2(d.x, -d.z) / DEG + 360) % 360;
    const alt = Math.atan2(d.y, Math.hypot(d.x, d.z)) / DEG;
    const conv = siteForCamera().conv;
    return { grid, true: grid + conv, alt, conv, dist: d.length() };
  },
};
