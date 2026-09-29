// Terrain worker for the flyover page (landscape_v2.html; index.html in the public repo): fetch compact grids, decode, build meshes off the main thread.
// Every array posted back is a fresh buffer (vendor three ignores typed-array byteOffset).
'use strict';
const BASE = new URL('./', self.location.href).href;
const MAGIC_G = 0x47594c46; // 'FLYG'
const MAGIC_R = 0x52594c46; // 'FLYR'
let near = null; // near grid meta, used to cut detail cells under the Stonehenge sheet

function decodeGrid(buf, name) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC_G) throw new Error(name + ': bad magic');
  const nx = dv.getUint32(8, true), ny = dv.getUint32(12, true);
  const f = (o) => dv.getFloat32(o, true);
  const g = { name, nx, ny, x0: f(16), z0: f(20), dx: f(24), dz: f(28), hmin: f(32), hscale: f(36) };
  const n = nx * ny;
  const q = new Uint16Array(buf, 64, n);
  const h = new Float32Array(n);
  for (let i = 0; i < n; i++) h[i] = g.hmin + q[i] * g.hscale;
  g.h = h;
  // Version 2, flag bit 0: no colour block (far.bin); the caller fills g.rgb.
  const noRgb = dv.getUint32(4, true) >= 2 && (dv.getUint32(40, true) & 1);
  g.rgb = noRgb ? null : new Uint8Array(buf.slice(64 + 2 * n, 64 + 5 * n));
  g.x1 = g.x0 + (nx - 1) * g.dx;
  g.z1 = g.z0 + (ny - 1) * g.dz;
  return g;
}

function span(a, b, step) {
  const out = [];
  for (let v = a; v < b; v += step) out.push(v);
  out.push(b);
  return out;
}

// Build a mesh for columns i0..i1, rows j0..j1 at the given step.
// exclude(xa, za, xb, zb) drops a cell. skirt > 0 adds a curtain below the edges.
function buildMesh(g, i0, j0, i1, j1, step, exclude, skirt, sink) {
  const cols = span(i0, i1, step), rows = span(j0, j1, step);
  const W = cols.length, Hh = rows.length;
  const nSkirt = skirt > 0 ? 2 * (W + Hh) : 0;
  const nv = W * Hh + nSkirt;
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Uint8Array(nv * 3);
  const H = g.h, NX = g.nx, NY = g.ny;
  const at = (i, j) => H[Math.min(NY - 1, Math.max(0, j)) * NX + Math.min(NX - 1, Math.max(0, i))];
  let v = 0;
  function put(i, j, dy) {
    let y = at(i, j);
    // Normals always from neighbouring cells of the full grid (not per tile, not per LOD), so a vertex
    // shared by two tiles or two LODs gets exactly the same normal and the same shade.
    const s = 1;
    const dhdx = (at(i + s, j) - at(i - s, j)) / (2 * s * g.dx);
    const dhdz = (at(i, j + s) - at(i, j - s)) / (2 * s * g.dz);
    let a = -dhdx, b = 1, c = -dhdz;
    const l = Math.hypot(a, b, c);
    const x = g.x0 + i * g.dx, z = g.z0 + j * g.dz;
    // Points under a finer sheet sink below it, so the two never overlap or z-fight.
    if (sink && sink(x, z)) y -= 2;
    pos[v * 3] = x; pos[v * 3 + 1] = y - dy; pos[v * 3 + 2] = g.z0 + j * g.dz;
    nrm[v * 3] = a / l; nrm[v * 3 + 1] = b / l; nrm[v * 3 + 2] = c / l;
    const k = (j * NX + i) * 3;
    col[v * 3] = g.rgb[k]; col[v * 3 + 1] = g.rgb[k + 1]; col[v * 3 + 2] = g.rgb[k + 2];
    return v++;
  }
  for (const j of rows) for (const i of cols) put(i, j, 0);
  const idx = [];
  for (let r = 0; r < Hh - 1; r++) {
    for (let c = 0; c < W - 1; c++) {
      if (exclude) {
        const xa = g.x0 + cols[c] * g.dx, xb = g.x0 + cols[c + 1] * g.dx;
        const za = g.z0 + rows[r] * g.dz, zb = g.z0 + rows[r + 1] * g.dz;
        if (exclude(xa, za, xb, zb)) continue;
      }
      const a = r * W + c;
      idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
    }
  }
  if (skirt > 0) {
    // Skirts face outward on all four sides (front faces), with the normal and colour of the edge above,
    // so where a crack opens between tiles or LODs it is filled with ground of the same shade.
    const edge = (list, flip) => {
      let prevTop = -1, prevBot = -1;
      for (const [r, c] of list) {
        const top = r * W + c;
        const bot = put(cols[c], rows[r], skirt);
        if (prevTop >= 0) {
          if (flip) idx.push(prevTop, top, prevBot, top, bot, prevBot);
          else idx.push(prevTop, prevBot, top, top, prevBot, bot);
        }
        prevTop = top; prevBot = bot;
      }
    };
    const north = [], south = [], west = [], east = [];
    for (let c = 0; c < W; c++) { north.push([0, c]); south.push([Hh - 1, c]); }
    for (let r = 0; r < Hh; r++) { west.push([r, 0]); east.push([r, W - 1]); }
    edge(north, true); edge(south, false); edge(west, false); edge(east, true);
  }
  const index = v < 65536 ? new Uint16Array(idx) : new Uint32Array(idx);
  return { pos: pos.slice(0, v * 3), nrm: nrm.slice(0, v * 3), col: col.slice(0, v * 3), idx: index };
}

function sampleGrid(g, x, z) {
  const fx = (x - g.x0) / g.dx, fz = (z - g.z0) / g.dz;
  if (!(fx >= 0 && fz >= 0 && fx <= g.nx - 1 && fz <= g.ny - 1)) return null;
  const i = Math.min(g.nx - 2, Math.floor(fx)), j = Math.min(g.ny - 2, Math.floor(fz));
  const u = fx - i, v = fz - j, a = j * g.nx + i, H = g.h;
  if (u + v <= 1) return H[a] + u * (H[a + 1] - H[a]) + v * (H[a + g.nx] - H[a]);
  const h11 = H[a + g.nx + 1];
  return h11 + (1 - u) * (H[a + g.nx] - h11) + (1 - v) * (H[a + 1] - h11);
}
// Rivers (Avon and Till): one continuous mesh per river, draped on the whole height field rather than on
// any one tile. Every vertex sits a little above the highest ground that can be drawn at that point: the
// Stonehenge sheet, both detail LODs (10 m and 20 m) and the 55 m wide ground where that is still drawn,
// so neither a tile edge, a LOD change nor a skirt can show through. Ribbons are densified to about 12 m
// along and 26 m across. The page adds a depth offset on top (polygonOffset and a small clip-space bias).
const RIVER_LIFT = 0.25;
const RIVER_CAP = 1.5; // never lift a vertex more than this above its own ground (steep banks)
function sampleStride2(g, x, z) { // the 20 m LOD surface (every other point, same triangle split)
  const fx = (x - g.x0) / (2 * g.dx), fz = (z - g.z0) / (2 * g.dz);
  const W = Math.floor((g.nx - 1) / 2), Hn = Math.floor((g.ny - 1) / 2);
  if (!(fx >= 0 && fz >= 0 && fx <= W && fz <= Hn)) return null;
  const i = Math.min(W - 1, Math.floor(fx)), j = Math.min(Hn - 1, Math.floor(fz));
  const u = fx - i, v = fz - j, H = g.h, at = (a, b) => H[(2 * b) * g.nx + 2 * a];
  if (u + v <= 1) return at(i, j) + u * (at(i + 1, j) - at(i, j)) + v * (at(i, j + 1) - at(i, j));
  const h11 = at(i + 1, j + 1);
  return h11 + (1 - u) * (at(i, j + 1) - h11) + (1 - v) * (at(i + 1, j) - h11);
}
function riverGround(G, x, z) {
  let best = -Infinity, h;
  const inNearSheet = G.near && x > G.near.x0 && x < G.near.x1 && z > G.near.z0 && z < G.near.z1;
  if (inNearSheet && (h = sampleGrid(G.near, x, z)) != null) best = h;
  const D = G.detail;
  if (!inNearSheet && D) {
    if ((h = sampleGrid(D, x, z)) != null) best = Math.max(best, h);
    if ((h = sampleStride2(D, x, z)) != null) best = Math.max(best, h);
  }
  // The wide ground is drawn wherever its cell is not wholly under a finer sheet (map edge, detail border).
  const C = G.coarse;
  if (C) {
    const i = Math.floor((x - C.x0) / C.dx), j = Math.floor((z - C.z0) / C.dz);
    const xa = C.x0 + i * C.dx, za = C.z0 + j * C.dz, xb = xa + C.dx, zb = za + C.dz;
    const under = (r) => r && xa >= r.x0 && xb <= r.x1 && za >= r.z0 && zb <= r.z1;
    if (!(under(D) || under(G.near)) && (h = sampleGrid(C, x, z)) != null) best = Math.max(best, h);
  }
  // The far ground (OS Terrain 50) is drawn wherever its cell is not wholly under the wide ground.
  const F = G.far;
  if (F && (!C || best === -Infinity || !(x > C.x0 && x < C.x1 && z > C.z0 && z < C.z1) ||
      (x - C.x0 < F.dx || C.x1 - x < F.dx || z - C.z0 < F.dz || C.z1 - z < F.dz)) && (h = sampleGrid(F, x, z)) != null) best = Math.max(best, h);
  if (best === -Infinity && C) { // just off the map: the nearest edge height, so the ribbon does not drop to 0
    const cx = Math.min(C.x1, Math.max(C.x0, x)), cz = Math.min(C.z1, Math.max(C.z0, z));
    if ((h = sampleGrid(C, cx, cz)) != null) best = h;
  }
  return best === -Infinity ? 0 : best;
}
// runs: arrays of [lx, lz, rx, rz] pairs (left and right bank points). Returns { pos, idx } with every
// triangle facing up.
function riverMesh(G, runs, stepAlong = 12, stepAcross = 26) {
  const pos = [], idx = [];
  for (const run of runs) {
    if (run.length < 2) continue;
    const width = Math.hypot(run[0][2] - run[0][0], run[0][3] - run[0][1]);
    const nA = Math.max(2, Math.ceil(width / stepAcross) + 1);
    // Rows of (x, z) across the ribbon, about stepAlong apart.
    const rows = [];
    for (let k = 0; k < run.length - 1; k++) {
      const a = run[k], b = run[k + 1];
      const L = Math.max(Math.hypot((a[0] + a[2] - b[0] - b[2]) / 2, (a[1] + a[3] - b[1] - b[3]) / 2), 1e-6);
      const nS = Math.max(1, Math.ceil(L / stepAlong));
      for (let s = (k === 0 ? 0 : 1); s <= nS; s++) {
        const t = s / nS, row = [];
        const lx = a[0] + (b[0] - a[0]) * t, lz = a[1] + (b[1] - a[1]) * t, rx = a[2] + (b[2] - a[2]) * t, rz = a[3] + (b[3] - a[3]) * t;
        for (let c = 0; c < nA; c++) { const u = c / (nA - 1); row.push([lx + (rx - lx) * u, lz + (rz - lz) * u]); }
        rows.push(row);
      }
    }
    // Each vertex takes the highest ground at itself and half-way to its neighbours (edges and quad centres),
    // so the flat triangles between vertices stay above the ground as well.
    const base = pos.length / 3;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < nA; c++) {
        const [x, z] = rows[r][c];
        const h0 = riverGround(G, x, z);
        let h = h0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const q = rows[r + dr] && rows[r + dr][c + dc];
          if (q) h = Math.max(h, riverGround(G, (x + q[0]) / 2, (z + q[1]) / 2));
        }
        pos.push(x, Math.min(h, h0 + RIVER_CAP) + RIVER_LIFT, z);
      }
      if (r > 0) for (let c = 0; c < nA - 1; c++) { const p0 = base + (r - 1) * nA + c, r0 = base + r * nA + c; idx.push(p0, r0, p0 + 1, p0 + 1, r0, r0 + 1); }
    }
  }
  faceUp(pos, idx);
  const p32 = new Float32Array(pos);
  return { pos: p32, idx: p32.length / 3 < 65536 ? new Uint16Array(idx) : new Uint32Array(idx) };
}
// Monuments: Historic England aerial mapping (banks, ditches, fields) as flat draped fills, barrow domes,
// scheduled-area outlines where nothing is mapped, and the River Till ribbon. See tools/build_monuments.py.
// Colours are RGBA: the alpha byte carries the period (0-4), which the page's monument shader turns into a fade.
const MON_RGB = [[236, 222, 168], [58, 46, 32], [160, 156, 112], [246, 236, 190]];
const MON_LIFT = [0.35, 0.25, 0.2, 0.4];
// Every triangle faces up (front faces only): flip any whose normal points down.
function faceUp(p, ix) {
  for (let t = 0; t < ix.length; t += 3) {
    const A = ix[t] * 3, B = ix[t + 1] * 3, C = ix[t + 2] * 3;
    const ny = (p[B + 2] - p[A + 2]) * (p[C] - p[A]) - (p[B] - p[A]) * (p[C + 2] - p[A + 2]);
    if (ny < 0) { const k = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = k; }
  }
}
async function buildMonuments(G) {
  const hAt = (x, z) => {
    let h;
    if (G.near && (h = sampleGrid(G.near, x, z)) != null) return h;
    if (G.detail && (h = sampleGrid(G.detail, x, z)) != null) return h;
    if (G.coarse && (h = sampleGrid(G.coarse, x, z)) != null) return h;
    return 0;
  };
  try {
    const [mb, tb] = await Promise.all([get('monuments.bin'), get('till.bin')]);
    const dv = new DataView(mb);
    if (dv.getUint32(0, true) !== 0x4d594c46 || dv.getUint32(4, true) !== 3) throw new Error('monuments.bin: bad magic or version');
    const nv = dv.getUint32(8, true), ni = dv.getUint32(12, true), nd = dv.getUint32(16, true);
    const nr = dv.getUint32(20, true), nrp = dv.getUint32(24, true), nch = dv.getUint32(28, true);
    let o = 32;
    const bounds = new Uint32Array(mb.slice(o, o + (nch + 1) * 8)); o += (nch + 1) * 8;
    const V = new Int16Array(mb.slice(o, o + nv * 4)); o += nv * 4;
    const C = new Uint8Array(mb.slice(o, o + nv)); o += nv + ((4 - nv % 4) % 4);
    const I = new Uint16Array(mb.slice(o, o + ni * 2)); o += ni * 2 + ((ni * 2) % 4);
    const chunks = [], tr = [];
    for (let k = 0; k < nch; k++) {
      const v0 = bounds[k * 2], i0 = bounds[k * 2 + 1], v1 = bounds[k * 2 + 2], i1 = bounds[k * 2 + 3];
      const n = v1 - v0;
      const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Uint8Array(n * 4);
      for (let v = 0; v < n; v++) {
        const x = V[(v0 + v) * 2] / 4, z = V[(v0 + v) * 2 + 1] / 4, cp = C[v0 + v], c = cp & 15;
        pos[v * 3] = x; pos[v * 3 + 1] = hAt(x, z) + MON_LIFT[c]; pos[v * 3 + 2] = z;
        nrm[v * 3 + 1] = 1;
        col[v * 4] = MON_RGB[c][0]; col[v * 4 + 1] = MON_RGB[c][1]; col[v * 4 + 2] = MON_RGB[c][2]; col[v * 4 + 3] = cp >> 4;
      }
      const idx = I.slice(i0, i1);
      chunks.push({ pos, nrm, col, idx }); tr.push(pos.buffer, nrm.buffer, col.buffer, idx.buffer);
    }
    // Domes: x, groundY, z, a, b, h, angle (E/N degrees).
    const domes = new Float32Array(nd * 7);
    for (let k = 0; k < nd; k++) {
      const x = dv.getInt16(o, true) / 4, z = dv.getInt16(o + 2, true) / 4;
      const a = dv.getUint16(o + 4, true) / 20, b = dv.getUint16(o + 6, true) / 20, h = dv.getUint16(o + 8, true) / 100, ang = dv.getInt16(o + 10, true) / 100;
      o += 12;
      // Sit the mound on the lowest of five ground samples, so it never floats on a slope.
      let g = hAt(x, z);
      for (const [dx, dz] of [[a, 0], [-a, 0], [0, b], [0, -b]]) g = Math.min(g, hAt(x + dx, z + dz));
      domes.set([x, g, z, a, b, h, ang], k * 7);
    }
    const domePer = new Uint8Array(mb.slice(o, o + nd)); o += nd;
    // Mounds as ordinary vertex-coloured meshes (no instancing), one per 1.5 km cell: they reuse the ground
    // shader, so their arrival compiles nothing new.
    const SEG = 16, RINGS = 5, perDome = SEG * RINGS + 1;
    const cells = new Map();
    for (let k = 0; k < nd; k++) {
      const key = Math.floor(domes[k * 7] / 1500) + ',' + Math.floor(domes[k * 7 + 2] / 1500);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(k);
    }
    const domeChunks = [];
    for (const list of cells.values()) {
      const n = list.length * perDome;
      const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Uint8Array(n * 4), idx = [];
      let v = 0;
      for (const k of list) {
        const [x, g, z, a, b, h, ang] = domes.subarray(k * 7, k * 7 + 7);
        const r = ang * Math.PI / 180, cr = Math.cos(r), sr = Math.sin(r);
        const base = v, per = domePer[k];
        for (let ri = 0; ri < RINGS; ri++) {
          const phi = (ri / RINGS) * Math.PI / 2, cp = Math.cos(phi), sp = Math.sin(phi);
          for (let si = 0; si < SEG; si++) {
            const th = si / SEG * Math.PI * 2, lx = cp * Math.cos(th), lz = cp * Math.sin(th);
            const px = lx * a, py = sp * h, pz = lz * b;
            let nx = lx / a, ny = sp / h, nz = lz / b; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
            pos[v * 3] = x + px * cr + pz * sr; pos[v * 3 + 1] = g - 0.05 + py; pos[v * 3 + 2] = z - px * sr + pz * cr;
            nrm[v * 3] = nx * cr + nz * sr; nrm[v * 3 + 1] = ny; nrm[v * 3 + 2] = -nx * sr + nz * cr;
            col[v * 4] = 150; col[v * 4 + 1] = 162; col[v * 4 + 2] = 100; col[v * 4 + 3] = per;
            v++;
          }
        }
        pos[v * 3] = x; pos[v * 3 + 1] = g - 0.05 + h; pos[v * 3 + 2] = z; nrm[v * 3 + 1] = 1;
        col[v * 4] = 150; col[v * 4 + 1] = 162; col[v * 4 + 2] = 100; col[v * 4 + 3] = per;
        const apex = v++;
        for (let ri = 0; ri < RINGS - 1; ri++) for (let si = 0; si < SEG; si++) {
          const a0 = base + ri * SEG + si, a1 = base + ri * SEG + (si + 1) % SEG, b0 = a0 + SEG, b1 = a1 + SEG;
          idx.push(a0, b0, a1, a1, b0, b1);
        }
        for (let si = 0; si < SEG; si++) idx.push(base + (RINGS - 1) * SEG + si, apex, base + (RINGS - 1) * SEG + (si + 1) % SEG);
      }
      faceUp(pos, idx);
      const I16 = new Uint16Array(idx);
      domeChunks.push({ pos, nrm, col, idx: I16 }); tr.push(pos.buffer, nrm.buffer, col.buffer, I16.buffer);
    }
    o += (4 - o % 4) % 4;
    const counts = new Uint32Array(mb.slice(o, o + nr * 4)); o += nr * 4;
    const ringPer = new Uint8Array(mb.slice(o, o + nr)); o += nr + ((4 - nr % 4) % 4);
    const RP = new Int16Array(mb.slice(o, o + nrp * 4));
    // Outlines as line segments, densified every 8 m and draped 0.45 m up (0.6 m wide).
    const seg = [];
    let p = 0;
    for (let r = 0; r < nr; r++) {
      for (let k = 0; k < counts[r] - 1; k++) {
        const ax = RP[(p + k) * 2] / 4, az = RP[(p + k) * 2 + 1] / 4, bx = RP[(p + k + 1) * 2] / 4, bz = RP[(p + k + 1) * 2 + 1] / 4;
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 8));
        for (let s = 0; s < n; s++) {
          const x0 = ax + (bx - ax) * s / n, z0 = az + (bz - az) * s / n, x1 = ax + (bx - ax) * (s + 1) / n, z1 = az + (bz - az) * (s + 1) / n;
          seg.push(x0, z0, x1, z1, ringPer[r]);
        }
      }
      p += counts[r];
    }
    // Scheduled-area outlines as 1.2 m ribbons in the same vertex-coloured material (no line shader).
    const nq = seg.length / 5;
    const opos = new Float32Array(nq * 12), onrm = new Float32Array(nq * 12), ocol = new Uint8Array(nq * 16), oidx = [];
    for (let k = 0; k < nq; k++) {
      const [x0, z0, x1, z1, per] = seg.slice(k * 5, k * 5 + 5);
      const l = Math.hypot(x1 - x0, z1 - z0) || 1, px = -(z1 - z0) / l * 0.6, pz = (x1 - x0) / l * 0.6;
      const P = [[x0 + px, z0 + pz], [x0 - px, z0 - pz], [x1 + px, z1 + pz], [x1 - px, z1 - pz]];
      P.forEach(([x, z], j) => { const v = k * 4 + j; opos[v * 3] = x; opos[v * 3 + 1] = hAt(x, z) + 0.45; opos[v * 3 + 2] = z; onrm[v * 3 + 1] = 1; ocol[v * 4] = 240; ocol[v * 4 + 1] = 208; ocol[v * 4 + 2] = 110; ocol[v * 4 + 3] = per; });
      const v0 = k * 4; oidx.push(v0, v0 + 1, v0 + 2, v0 + 2, v0 + 1, v0 + 3);
    }
    faceUp(opos, oidx);
    const outline = { pos: opos, nrm: onrm, col: ocol, idx: new Uint32Array(oidx) };
    if (nq * 4 < 65536) outline.idx = new Uint16Array(oidx);
    tr.push(opos.buffer, onrm.buffer, ocol.buffer, outline.idx.buffer);
    // River Till: left/right pairs per run, one continuous ribbon draped like the Avon.
    const tdv = new DataView(tb);
    if (tdv.getUint32(0, true) !== 0x54594c46) throw new Error('till.bin: bad magic');
    const nRuns = tdv.getUint32(8, true);
    let q = 16; const truns = [];
    for (let r = 0; r < nRuns; r++) {
      const n = tdv.getUint32(q, true); q += 4;
      const run = [];
      for (let k = 0; k < n; k++, q += 8) run.push([tdv.getInt16(q, true) / 4, tdv.getInt16(q + 2, true) / 4, tdv.getInt16(q + 4, true) / 4, tdv.getInt16(q + 6, true) / 4]);
      truns.push(run);
    }
    const tm = riverMesh(G, truns);
    const tillPos = tm.pos, tillIdx = tm.idx;
    self.postMessage({ type: 'monuments', chunks, domeChunks, outline, tillPos, tillIdx, bytes: mb.byteLength + tb.byteLength },
      [...tr, tillPos.buffer, tillIdx.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: 'monuments: ' + String(err && err.message || err) });
  }
}

// Wide ground beyond the lidar (far.bin, OS Terrain 50 at 100 m): only for the skyline and the distant view.
// Coloured with the wide ground's mean colour; cells wholly under the wide ground are left out and points
// under it sink 2 m, as the other sheets do.
async function buildFar(coarse, G0 = {}) {
  try {
    const far = decodeGrid(await get('far.bin'), 'far');
    if (!far.rgb) {
      let r = 0, g = 0, b = 0; const n = coarse.rgb.length / 3;
      for (let i = 0; i < coarse.rgb.length; i += 3) { r += coarse.rgb[i]; g += coarse.rgb[i + 1]; b += coarse.rgb[i + 2]; }
      r /= n; g /= n; b /= n;
      far.rgb = new Uint8Array(far.nx * far.ny * 3);
      for (let k = 0; k < far.nx * far.ny; k++) {
        // a little lighter on the high chalk, darker in the valleys
        const t = Math.max(-1, Math.min(1, (far.h[k] - 20) / 80)) * 10;
        far.rgb[k * 3] = Math.max(0, Math.min(255, r + t)); far.rgb[k * 3 + 1] = Math.max(0, Math.min(255, g + t)); far.rgb[k * 3 + 2] = Math.max(0, Math.min(255, b + t * 0.6));
      }
    }
    { const gi = gridInfo(far); self.postMessage(gi.msg, gi.tr); }
    const under = (xa, za, xb, zb) => xa >= coarse.x0 && xb <= coarse.x1 && za >= coarse.z0 && zb <= coarse.z1;
    const inside = (x, z) => x > coarse.x0 + 1 && x < coarse.x1 - 1 && z > coarse.z0 + 1 && z < coarse.z1 - 1;
    const fm = buildMesh(far, 0, 0, far.nx - 1, far.ny - 1, 1, under, 0, inside);
    self.postMessage({ type: 'mesh', name: 'far', mesh: fm }, meshTransfer(fm));
    await buildFarRivers({ coarse, far, near: G0.near, detail: G0.detail });
  } catch (err) {
    self.postMessage({ type: 'error', message: 'far ground: ' + String(err && err.message || err) });
  }
}

// Rivers over the far ground (far_rivers.bin, OS Open Rivers centrelines; tools/build_far_rivers.py).
// Beyond the wide ground each river becomes a ribbon draped like the Avon (78 m wide for the Avon, as its
// ribbon, 40 m for the others), overlapping the wide ground's edge by 60 m so it joins the inner ribbons. Every
// river is also returned as a thin draped line for the page to show from high up, where ribbons are sub-pixel.
const FAR_RIVER_W = [78, 40, 40, 40, 40, 40]; // Avon, Till, Wylye, Nadder, Bourne, Ebble
async function buildFarRivers(G) {
  const buf = await get('far_rivers.bin');
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x57594c46) throw new Error('far_rivers.bin: bad magic');
  const nl = dv.getUint32(8, true), C = G.coarse, OV = 60;
  const inner = (x, z) => x > C.x0 + OV && x < C.x1 - OV && z > C.z0 + OV && z < C.z1 - OV;
  const runs = [], line = [];
  let q = 16;
  for (let l = 0; l < nl; l++) {
    const ri = dv.getUint8(q), n = dv.getUint16(q + 2, true); q += 4;
    const pts = [];
    for (let k = 0; k < n; k++, q += 8) pts.push([dv.getFloat32(q, true), dv.getFloat32(q + 4, true)]);
    // densify to about 40 m
    const d = [pts[0]];
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k], m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 40));
      for (let s = 1; s <= m; s++) d.push([a[0] + (b[0] - a[0]) * s / m, a[1] + (b[1] - a[1]) * s / m]);
    }
    // thin line, every other point, 3 m above the drawn ground (not over the inner Avon and Till ribbons)
    for (let k = 2; k < d.length; k += 2) {
      const a = d[k - 2], b = d[k];
      if (ri <= 1 && inner(a[0], a[1]) && inner(b[0], b[1])) continue;
      line.push(a[0], riverGround(G, a[0], a[1]) + 3, a[1], b[0], riverGround(G, b[0], b[1]) + 3, b[1]);
    }
    // ribbons outside the wide ground (split where the river enters it)
    const w = (FAR_RIVER_W[ri] || 40) / 2;
    let cur = [];
    for (let k = 0; k < d.length; k++) {
      const [x, z] = d[k];
      if (inner(x, z)) { if (cur.length > 1) runs.push(cur); cur = []; continue; }
      const a = d[Math.max(0, k - 1)], b = d[Math.min(d.length - 1, k + 1)];
      const tx = b[0] - a[0], tz = b[1] - a[1], L = Math.hypot(tx, tz) || 1;
      const nx = -tz / L * w, nz = tx / L * w;
      cur.push([x + nx, z + nz, x - nx, z - nz]);
    }
    if (cur.length > 1) runs.push(cur);
  }
  const m = riverMesh(G, runs, 40, 80);
  const lp = new Float32Array(line);
  self.postMessage({ type: 'farRivers', pos: m.pos, idx: m.idx, line: lp }, [m.pos.buffer, m.idx.buffer, lp.buffer]);
}

function meshTransfer(m) { return [m.pos.buffer, m.nrm.buffer, m.col.buffer, m.idx.buffer]; }

function gridInfo(g) {
  const h = new Float32Array(g.h);
  return { msg: { type: 'grid', name: g.name, nx: g.nx, ny: g.ny, x0: g.x0, z0: g.z0, dx: g.dx, dz: g.dz, h }, tr: [h.buffer] };
}

// Files the page already started downloading arrive as 'buf' messages; the rest are fetched here.
const early = {};
function earlyBuf(name) {
  if (!early[name]) { let res, rej; const p = new Promise((a, b) => { res = a; rej = b; }); early[name] = { p, res, rej }; }
  return early[name];
}
let earlyNames = [];
// Read a response in chunks, telling the page every 128 KB (for the MB count and the start-up watchdog).
async function readWithProgress(r, name) {
  if (!r.body || !r.body.getReader) return r.arrayBuffer();
  const rd = r.body.getReader(), parts = [];
  let n = 0, told = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    parts.push(value); n += value.byteLength;
    if (n - told >= 131072) { told = n; self.postMessage({ type: 'progress', name, bytes: n }); }
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out.buffer;
}
async function get(name) {
  if (earlyNames.includes(name)) {
    const buf = await earlyBuf(name).p;
    self.postMessage({ type: 'bytes', name, bytes: buf.byteLength });
    return buf;
  }
  const r = await fetch(BASE + name);
  if (!r.ok) throw new Error(name + ' ' + r.status);
  const buf = await readWithProgress(r, name);
  self.postMessage({ type: 'bytes', name, bytes: buf.byteLength });
  return buf;
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === 'buf') {
    const e = earlyBuf(msg.name);
    if (msg.error) e.rej(new Error(msg.error)); else e.res(msg.buf);
    return;
  }
  if (msg.type !== 'start') return;
  const cam = msg.cam;
  earlyNames = msg.early || [];
  try {
    // Start every download at once; process in order of usefulness.
    const pCoarse = get('coarse.bin'), pNear = get('near.bin'), pRiver = get('river.bin'), pDetail = get('detail.bin');

    const coarse = decodeGrid(await pCoarse, 'coarse');
    { const gi = gridInfo(coarse); self.postMessage(gi.msg, gi.tr); }
    const cm = buildMesh(coarse, 0, 0, coarse.nx - 1, coarse.ny - 1, 1, null, 0);
    self.postMessage({ type: 'mesh', name: 'coarse', mesh: cm }, meshTransfer(cm));

    near = decodeGrid(await pNear, 'near');
    { const gi = gridInfo(near); self.postMessage(gi.msg, gi.tr); }
    const nm = buildMesh(near, 0, 0, near.nx - 1, near.ny - 1, 1, null, 5);
    self.postMessage({ type: 'mesh', name: 'near', mesh: nm, bbox: [near.x0, near.z0, near.x1, near.z1] }, meshTransfer(nm));

    const detail = decodeGrid(await pDetail, 'detail');
    { const gi = gridInfo(detail); self.postMessage(gi.msg, gi.tr); }
    {
      // Avon: river.bin's left/right bank pairs (runs split where it jumps), re-draped on the full ground.
      const buf = await pRiver;
      const dv = new DataView(buf);
      if (dv.getUint32(0, true) !== MAGIC_R) throw new Error('river.bin: bad magic');
      const nv = dv.getUint32(8, true);
      const P = new Float32Array(buf.slice(16, 16 + nv * 12));
      const runs = []; let cur = [];
      for (let k = 0; k + 1 < nv; k += 2) {
        const pr = [P[k * 3], P[k * 3 + 2], P[k * 3 + 3], P[k * 3 + 5]];
        if (cur.length) { const q = cur[cur.length - 1]; if (Math.hypot(pr[0] - q[0], pr[1] - q[1]) > 200) { runs.push(cur); cur = []; } }
        cur.push(pr);
      }
      if (cur.length) runs.push(cur);
      const m = riverMesh({ near, detail, coarse }, runs);
      self.postMessage({ type: 'river', pos: m.pos, idx: m.idx }, [m.pos.buffer, m.idx.buffer]);
    }
    const T = 100; // cells per tile side
    const tiles = [];
    for (let j = 0; j < detail.ny - 1; j += T) {
      for (let i = 0; i < detail.nx - 1; i += T) {
        const i1 = Math.min(detail.nx - 1, i + T), j1 = Math.min(detail.ny - 1, j + T);
        const cx = detail.x0 + (i + i1) / 2 * detail.dx, cz = detail.z0 + (j + j1) / 2 * detail.dz;
        tiles.push({ i, j, i1, j1, d: Math.hypot(cx - cam.x, cz - cam.z) });
      }
    }
    tiles.sort((a, b) => a.d - b.d);
    const underNear = (xa, za, xb, zb) => near && xa >= near.x0 && xb <= near.x1 && za >= near.z0 && zb <= near.z1;
    const inNear = (x, z) => near && x > near.x0 + 0.5 && x < near.x1 - 0.5 && z > near.z0 + 0.5 && z < near.z1 - 0.5;
    self.postMessage({ type: 'tilecount', n: tiles.length });
    for (const t of tiles) {
      const lod0 = buildMesh(detail, t.i, t.j, t.i1, t.j1, 1, underNear, 6, inNear);
      const lod1 = buildMesh(detail, t.i, t.j, t.i1, t.j1, 2, underNear, 8, inNear);
      const bbox = [detail.x0 + t.i * detail.dx, detail.z0 + t.j * detail.dz, detail.x0 + t.i1 * detail.dx, detail.z0 + t.j1 * detail.dz];
      self.postMessage({ type: 'tile', key: t.i + ',' + t.j, bbox, lods: [lod0, lod1] }, [...meshTransfer(lod0), ...meshTransfer(lod1)]);
    }
    self.postMessage({ type: 'done' });
    // Monuments and the River Till, draped on the final ground (near > detail > coarse, as the page samples it).
    await buildMonuments({ near, detail, coarse });
    await buildFar(coarse, { near, detail });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
