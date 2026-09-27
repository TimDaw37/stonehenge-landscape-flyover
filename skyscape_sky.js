// Apparent place for the live viewer, from the vendored astronomy-engine.
import * as AE from './vendor/astronomy.esm.js';

export const SITE = { lat: 51.178851, lon: -1.826177, height: 104 };
export const SOLAR_SD = 0.2667;
export const LUNAR_SD = 0.259;

const obs = new AE.Observer(SITE.lat, SITE.lon, SITE.height);

/** Saemundsson refraction, degrees to add to a true altitude. Same formula as astronomy-engine. */
export function refractionDeg(altDeg) {
  let hd = altDeg;
  if (hd < -1) hd = -1;
  return (1.02 / Math.tan((hd + 10.3 / (hd + 5.11)) * Math.PI / 180)) / 60;
}

export function sampleAlt(alts, stepDeg, az) {
  const n = alts.length;
  let a = az % 360;
  if (a < 0) a += 360;
  const x = a / stepDeg;
  const i0 = Math.floor(x);
  const t = x - i0;
  const i = ((i0 % n) + n) % n;
  const j = (i + 1) % n;
  return alts[i] * (1 - t) + alts[j] * t;
}

function isLeap(year) {
  return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0));
}

/**
 * Match the viewer's day-of-year slider (1 = 1 Jan).
 * Dates before the modern epoch are proleptic Gregorian (Date.UTC leap rule).
 * Stellarium uses the Julian calendar by default for those years. For the major
 * lunar standstill in -2498 the same moon position differs by about 3 minutes,
 * which is acceptable.
 */
export function dateFromDoyMinute(year, doy, minuteUt) {
  const md = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const yearDays = md.reduce((a, b) => a + b, 0);
  let n = Math.max(1, Math.min(yearDays, Math.round(+doy) || 1));
  let m = 0;
  while (m < 12 && n > md[m]) { n -= md[m]; m++; }
  const ms = Date.UTC(year, m, n, 0, 0, 0) + (+minuteUt || 0) * 60000;
  return new Date(ms);
}

export function sdFor(body) {
  return body === 'Moon' ? LUNAR_SD : SOLAR_SD;
}

/** Limb offset added to the centre's true altitude to reach that limb. Gleam = upper limb. */
export function limbTrueOffset(limb, sd) {
  if (limb === 'first_gleam') return sd;
  if (limb === 'full_orb') return -sd;
  return 0;
}

export function horizontal(body, date, refract) {
  const which = body === 'Moon' ? AE.Body.Moon : AE.Body.Sun;
  const eq = AE.Equator(which, date, obs, true, true);
  const hor = AE.Horizon(date, obs, eq.ra, eq.dec, refract ? 'normal' : null);
  let az = hor.azimuth % 360;
  if (az < 0) az += 360;
  return { az, alt: hor.altitude };
}

export function moonPhase(date) {
  const info = AE.Illumination(AE.Body.Moon, date);
  return { phaseAngle: info.phase_angle, phaseFraction: info.phase_fraction };
}

/**
 * Time when the chosen limb meets the Hoyle skyline.
 * Stellarium / Path A: apparent altitude of the limb equals the geometric skyline.
 * rising: first climb through the skyline in the east (az < 180).
 * setting: first descent through the skyline in the west (az >= 180).
 * notBefore: minutes from local-date midnight; use this so moonset is the one after moonrise.
 */
export function seekLimb({ body, year, doy, rising, limb, alts, step, notBefore }) {
  const sd = sdFor(body);
  const off = limbTrueOffset(limb, sd);
  const t0 = Number.isFinite(+notBefore) ? +notBefore : 0;
  const t1 = t0 + (rising ? 20 * 60 : 30 * 60);
  function at(min) {
    const date = dateFromDoyMinute(year, doy, min);
    const geo = horizontal(body, date, false);
    const limbTrue = geo.alt + off;
    const happ = limbTrue + refractionDeg(limbTrue);
    const sky = sampleAlt(alts, step, geo.az);
    return { minute: min, date, geoAz: geo.az, geoAlt: geo.alt, limbTrue, happ, sky, diff: happ - sky };
  }
  let prev = null;
  for (let m = t0; m <= t1; m += 3) {
    const cur = at(m);
    const sideOk = rising ? (cur.geoAz < 180) : (cur.geoAz >= 180);
    const crossed = prev && (rising
      ? (prev.diff <= 0 && cur.diff > 0)
      : (prev.diff > 0 && cur.diff <= 0));
    if (crossed && sideOk) {
      let lo = m - 3;
      let hi = m;
      for (let k = 0; k < 18; k++) {
        const mid = (lo + hi) / 2;
        const above = at(mid).diff > 0;
        if (rising ? above : !above) hi = mid;
        else lo = mid;
      }
      return at((lo + hi) / 2);
    }
    prev = cur;
  }
  return null;
}
