// Fork only. J2000 places, precessed by astronomy-engine. Proper motion is off.
import { Observer, Rotation_EQJ_HOR, RotateVector, Vector } from './vendor/astronomy.esm.js';
import { dateFromDoyMinute, SITE } from './skyscape_sky.js';

const obs = new Observer(SITE.lat, SITE.lon, SITE.height);

function eqj(raHours, decDeg) {
  const ra = raHours * 15 * Math.PI / 180;
  const dec = decDeg * Math.PI / 180;
  const cd = Math.cos(dec);
  return new Vector(cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec), 0);
}

/** Horizon vector: x east, y up, z minus north. Unit length. */
export function starHorizontal(raHours, decDeg, year, doy, minuteUt) {
  const date = dateFromDoyMinute(year, doy, minuteUt);
  const hor = RotateVector(Rotation_EQJ_HOR(date, obs), eqj(raHours, decDeg));
  const alt = Math.asin(Math.max(-1, Math.min(1, hor.z))) * 180 / Math.PI;
  let az = Math.atan2(-hor.y, hor.x) * 180 / Math.PI;
  if (az < 0) az += 360;
  return { x: -hor.y, y: hor.z, z: -hor.x, alt, az };
}

export function starsAbove(catalog, year, doy, minuteUt, minAlt) {
  const date = dateFromDoyMinute(year, doy, minuteUt);
  const rot = Rotation_EQJ_HOR(date, obs);
  const floor = minAlt == null ? -0.4 : minAlt;
  const out = [];
  for (const row of catalog) {
    const hor = RotateVector(rot, eqj(row[0], row[1]));
    const alt = Math.asin(Math.max(-1, Math.min(1, hor.z))) * 180 / Math.PI;
    if (alt < floor) continue;
    out.push({ x: -hor.y, y: hor.z, z: -hor.x, mag: row[2], alt });
  }
  return out;
}
