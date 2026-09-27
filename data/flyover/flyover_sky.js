// Sun and moon from wherever the viewer is. Same maths as ../../skyscape_sky.js
// (astronomy-engine apparent place, refraction on, limb meets the geometric skyline),
// but with an observer at the camera's own latitude, longitude and height.
import * as AE from '../../vendor/astronomy.esm.js';
import { dateFromDoyMinute, refractionDeg, sampleAlt, sdFor, limbTrueOffset } from '../../skyscape_sky.js';
import { osgbToWgs84 } from '../../vendor/osgb_wgs84.js';

export const CE = 412245.35, CN = 142194.11, ORIGIN_OD = 102.588;

/** Grid convergence at a point: true azimuth = grid bearing + conv (degrees). */
export function convergenceAt(e, n) {
  const a = osgbToWgs84(e, n - 50), b = osgbToWgs84(e, n + 50);
  const dLat = b.lat - a.lat;
  const dLonM = (b.lon - a.lon) * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
  return Math.atan2(dLonM, dLat) * 180 / Math.PI;
}

/** Observer for a point in the shared frame (x east, z minus north, y = OD - 102.588). */
export function siteAt(x, z, y) {
  const e = CE + x, n = CN - z;
  const ll = osgbToWgs84(e, n);
  const od = y + ORIGIN_OD;
  return { x, z, y, e, n, od, lat: ll.lat, lon: ll.lon, conv: convergenceAt(e, n), obs: new AE.Observer(ll.lat, ll.lon, od) };
}

export function horizontalAt(site, body, date, refract) {
  const which = body === 'Moon' ? AE.Body.Moon : AE.Body.Sun;
  const eq = AE.Equator(which, date, site.obs, true, true);
  const hor = AE.Horizon(date, site.obs, eq.ra, eq.dec, refract ? 'normal' : null);
  let az = hor.azimuth % 360;
  if (az < 0) az += 360;
  return { az, alt: hor.altitude };
}

/** Same search as skyscape_sky.seekLimb, for this site's observer and skyline (alts by TRUE azimuth). */
export function seekLimbAt(site, { body, year, doy, rising, limb, alts, step, notBefore }) {
  const sd = sdFor(body);
  const off = limbTrueOffset(limb, sd);
  const t0 = Number.isFinite(+notBefore) ? +notBefore : 0;
  const t1 = t0 + (rising ? 20 * 60 : 30 * 60);
  function at(min) {
    const date = dateFromDoyMinute(year, doy, min);
    const geo = horizontalAt(site, body, date, false);
    const limbTrue = geo.alt + off;
    const happ = limbTrue + refractionDeg(limbTrue);
    const sky = sampleAlt(alts, step, geo.az);
    return { minute: min, date, geoAz: geo.az, geoAlt: geo.alt, limbTrue, happ, sky, diff: happ - sky };
  }
  let prev = null;
  for (let m = t0; m <= t1; m += 3) {
    const cur = at(m);
    const sideOk = rising ? (cur.geoAz < 180) : (cur.geoAz >= 180);
    const crossed = prev && (rising ? (prev.diff <= 0 && cur.diff > 0) : (prev.diff > 0 && cur.diff <= 0));
    if (crossed && sideOk) {
      let lo = m - 3, hi = m;
      for (let k = 0; k < 18; k++) {
        const mid = (lo + hi) / 2;
        const above = at(mid).diff > 0;
        if (rising ? above : !above) hi = mid; else lo = mid;
      }
      return at((lo + hi) / 2);
    }
    prev = cur;
  }
  return null;
}

/** Shortest data reach (m) within +-halfWidth degrees of a true azimuth. */
export function minReach(sky, azDeg, halfWidth = 10) {
  let m = Infinity;
  for (let a = azDeg - halfWidth; a <= azDeg + halfWidth; a += sky.step) {
    const i = ((Math.round(a / sky.step) % sky.reach.length) + sky.reach.length) % sky.reach.length;
    m = Math.min(m, sky.reach[i]);
  }
  return m;
}

/**
 * Skyline seen from (x, eyeY, z) over the loaded ground: 1440 altitudes at 0.25 deg,
 * indexed by TRUE azimuth. heightAt(x, z) returns ground y or null off the map.
 * Earth curvature with standard terrestrial refraction (k = 0.13) is applied.
 */
export function skylineAt(heightAt, x, z, eyeY, conv, opts = {}) {
  const step = 0.25, n = 1440;
  const alts = new Float32Array(n), reach = new Float32Array(n);
  const bin = skylineBin(heightAt, x, z, eyeY, conv, opts);
  for (let i = 0; i < n; i++) { const b = bin(i); alts[i] = b[0]; reach[i] = b[1]; }
  return { alts, step, reach };
}
function skylineBin(heightAt, x, z, eyeY, conv, opts) {
  const step = 0.25;
  const k = opts.k == null ? 0.13 : opts.k;
  const curve = opts.curvature === false ? 0 : (1 - k) / (2 * 6371000);
  return (i) => {
    const gb = (i * step - conv) * Math.PI / 180;
    const sx = Math.sin(gb), sz = -Math.cos(gb);
    let best = -90, r = 12;
    for (; r < 20000; r += 4 + r * 0.01) {
      const h = heightAt(x + sx * r, z + sz * r);
      if (h == null) break;
      const a = Math.atan2(h - eyeY - curve * r * r, r);
      if (a > best) best = a;
    }
    return [best * 180 / Math.PI, r]; // altitude (deg); how far the ground data runs in this direction
  };
}
/** Same skyline as skylineAt, but each 0.25 deg bin is traced only when first read (for many quick look-ups). */
export function lazySkylineAt(heightAt, x, z, eyeY, conv, opts = {}) {
  const n = 1440, alts = new Float32Array(n).fill(NaN), reach = new Float32Array(n).fill(NaN);
  const bin = skylineBin(heightAt, x, z, eyeY, conv, opts);
  const wrap = (arr) => new Proxy(arr, {
    get(t, p) {
      if (typeof p === 'string') {
        const i = +p;
        if (Number.isInteger(i) && i >= 0 && i < n) { if (Number.isNaN(t[i])) { const b = bin(i); alts[i] = b[0]; reach[i] = b[1]; } return t[i]; }
      }
      const v = Reflect.get(t, p);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  return { alts: wrap(alts), step: 0.25, reach: wrap(reach) };
}

/** A UT Date as the viewer's { year, doy, minute } (same proleptic calendar as dateFromDoyMinute). */
export function doyMinuteOf(date) {
  const year = date.getUTCFullYear();
  const jan1 = dateFromDoyMinute(year, 1, 0).getTime();
  const days = (date.getTime() - jan1) / 864e5;
  const doy = Math.floor(days) + 1;
  return { year, doy, minute: (days - Math.floor(days)) * 1440 };
}

/** Moment of the June solstice ('midsummer'), December solstice ('midwinter') or March equinox ('equinox'). */
export function solarEventDate(year, kind) {
  const s = AE.Seasons(year);
  return (kind === 'midsummer' ? s.jun_solstice : kind === 'midwinter' ? s.dec_solstice : s.mar_equinox).date;
}

// Mean longitude of the Moon's ascending node (Meeus, Astronomical Algorithms 47.7), degrees.
function meanNode(ms) {
  const T = (ms - Date.UTC(2000, 0, 1, 12)) / (36525 * 864e5);
  return 125.0445479 - 1934.1362891 * T + 0.0020754 * T * T + T * T * T / 467441 - T * T * T * T / 60616000;
}
/**
 * Lunar standstill nearest the middle of 'year': the moment the mean node reaches 0 deg (major: the Moon's
 * orbit tilts the same way as the ecliptic, declinations reach +-(obliquity + 5.1)) or 180 deg (minor).
 */
export function standstillEpoch(year, major) {
  const target = major ? 0 : 180;
  let ms = dateFromDoyMinute(year, 182, 720).getTime();
  for (let k = 0; k < 8; k++) {
    const w = ((meanNode(ms) - target) % 360 + 540) % 360 - 180; // the node regresses 360 deg in 6798.38 days
    ms += w / 360 * 6798.38 * 864e5;
  }
  const d = new Date(ms), y = d.getUTCFullYear();
  const y0 = dateFromDoyMinute(y, 1, 0).getTime(), y1 = dateFromDoyMinute(y + 1, 1, 0).getTime();
  return { date: d, yearDecimal: y + (ms - y0) / (y1 - y0) };
}
function geoMoonDec(ms) {
  const d = new Date(ms);
  const v = AE.RotateVector(AE.Rotation_EQJ_EQD(d), AE.GeoMoon(d));
  return AE.EquatorFromVector(v).dec;
}
/** Moment of the most northerly (or southerly) geocentric declination within +-span days of a moment. */
export function moonExtremeNear(centre, north, spanDays = 250) {
  const sg = north ? 1 : -1, c = centre.getTime(), H = 3600e3;
  let best = null;
  for (let t = c - spanDays * 864e5; t <= c + spanDays * 864e5; t += 6 * H) {
    const d = sg * geoMoonDec(t);
    if (!best || d > best.d) best = { t, d };
  }
  let lo = best.t - 6 * H, hi = best.t + 6 * H;
  for (let k = 0; k < 40; k++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (sg * geoMoonDec(m1) < sg * geoMoonDec(m2)) lo = m1; else hi = m2;
  }
  const t = (lo + hi) / 2;
  return { date: new Date(t), dec: geoMoonDec(t) };
}

export { dateFromDoyMinute, sdFor };
