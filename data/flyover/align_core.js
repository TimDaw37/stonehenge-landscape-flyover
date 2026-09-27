// Alignment searches shared by the page (Alignment check) and align_worker.js (plan-view rays), so both give
// the same azimuths. makeAligner() takes the sky module (flyover_sky.js, passed in so page and worker each use
// their own cache-busted copy), the ground sampler and a skyline source; nothing here touches the DOM.

export const ALIGN_EVENTS = {
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
export function yearLabel(y) { return y <= 0 ? (1 - y) + ' BC (year ' + y + ')' : 'AD ' + y; }
export function dateLabel(d) { return d.getUTCDate() + ' ' + MON3[d.getUTCMonth()] + ' ' + yearLabel(d.getUTCFullYear()); }
export function utLabel(d) { return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' UT'; }

// Where the ground data stops less than REACH_MIN metres out within +-REACH_HALF degrees of the rise/set
// point, the skyline there may be too low. 10 km: cutting the ground off at 2.5 km lowers the skyline by up to
// 0.9-1.3 deg in rise/set directions at Woodhenge, Durrington and Bulford, at 5 km by up to 0.6 deg, at 10 km by
// up to 0.2 deg, at 15 km by under 0.1 deg (tested with far.bin). With far.bin every monument has 16 km or more. Near Woodhenge (within HZ_NEAR m) the time then comes from the measured
// Woodhenge skyline (woodhenge/horizon.js); elsewhere the local skyline is used and flagged as short.
export const REACH_MIN = 10000, REACH_HALF = 3, HZ_NEAR = 3000;

/**
 * opts: FS: the flyover_sky.js module; heightAt(x, z) -> ground y or null; skyline(x, z, eyeY, conv) -> lazy skyline (FS.lazySkylineAt, or a
 * cached one); hz: window.WOODHENGE_HORIZON (optional).
 */
export function makeAligner({ FS, heightAt, skyline, hz }) {
  const sky = skyline || ((x, z, eye, conv) => FS.lazySkylineAt(heightAt, x, z, eye, conv));
  const HZ_SKY = (hz && hz.alt_deg && hz.alt_deg.length) ? { alts: hz.alt_deg, step: hz.step_deg || 0.25 } : null;
  let hzSite = null;
  function hzObserver() {
    if (!hzSite && HZ_SKY) hzSite = FS.siteAt(hz.eye.e - FS.CE, FS.CN - hz.eye.n, hz.eye.ground_od - FS.ORIGIN_OD + (hz.eye.agl || 1.6));
    return hzSite;
  }
  // Should this hit be re-timed on the Woodhenge skyline? { use, reach, short }
  function fallback(site, s, geoAz) {
    if (!s.reach) return { use: false, reach: Infinity, short: false };
    const reach = FS.minReach(s, geoAz, REACH_HALF);
    const short = reach < REACH_MIN;
    const o = hzObserver();
    const near = o && Math.hypot(site.x - o.x, site.z - o.z) < HZ_NEAR;
    return { use: short && !!near, reach, short };
  }

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
  // Event moments depend only on the event and the year: kept, so repeated look-ups are quick.
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
  // Full search: the event moment, then the chosen limb meeting the skyline seen from (x, z), eye 1.6 m.
  function computeAlignment(x, z, ev, year, limb) {
    const gy = heightAt(x, z);
    if (gy == null) return { error: 'No ground data at that point.' };
    const eye = gy + 1.6, site = FS.siteAt(x, z, eye);
    const { when, info } = eventWhen(ev, year);
    const s = sky(x, z, eye, site.conv);
    let hit = pickCrossing(crossingsAround(site, s.alts, s.step, ev, limb, when), ev, when);
    let skyline = 'local', obsSite = site, reach = Infinity, short = false;
    if (hit) {
      const f = fallback(site, s, hit.geoAz); reach = f.reach; short = f.short;
      if (f.use) {
        const o = hzObserver();
        const h2 = pickCrossing(crossingsAround(o, HZ_SKY.alts, HZ_SKY.step, ev, limb, when), ev, when);
        if (h2) { hit = h2; skyline = 'woodhenge'; obsSite = o; }
      }
    }
    if (!hit) return { error: 'No ' + (ev.rising ? 'rise' : 'set') + ' found near ' + dateLabel(when) + '.', info };
    return { site, obsSite, hit, skyline, info, when, gy, reach, short };
  }
  // Rise/set on a given day (the sky panel): the chosen limb meeting the skyline from (x, z).
  function seekFrom(x, z, q) {
    const gy = heightAt(x, z);
    if (gy == null) return null;
    const eye = gy + 1.6, site = FS.siteAt(x, z, eye);
    const s = sky(x, z, eye, site.conv);
    let hit = FS.seekLimbAt(site, Object.assign({ alts: s.alts, step: s.step }, q));
    let skyline = 'local', reach = Infinity, short = false, obsSite = site;
    if (hit) {
      const f = fallback(site, s, hit.geoAz); reach = f.reach; short = f.short;
      if (f.use) {
        const o = hzObserver();
        const h2 = FS.seekLimbAt(o, Object.assign({ alts: HZ_SKY.alts, step: HZ_SKY.step }, q));
        if (h2) { hit = h2; skyline = 'woodhenge'; obsSite = o; }
      }
    }
    return { site, obsSite, sky: s, hit, skyline, reach, short };
  }
  // True azimuth of one event from (x, z): the first time a full alignment search; afterwards the same rise or
  // set is re-timed from this point's own skyline (a short search from 40 min before it), which is far quicker.
  const rayFirst = new Map(); // event|year|limb -> { date, x, z }
  let stats = { full: 0, quick: 0 };
  function rayAzimuth(x, z, evKey, year, limbKey) {
    const ev = ALIGN_EVENTS[evKey], ck = evKey + '|' + year + '|' + limbKey;
    const f = rayFirst.get(ck);
    if (!f || Math.hypot(f.x - x, f.z - z) > 2500) {
      stats.full++;
      const r = computeAlignment(x, z, ev, year, limbKey);
      if (r.error) return { error: r.error };
      rayFirst.set(ck, { date: r.hit.date, x, z });
      return { az: r.hit.geoAz, sky: r.hit.sky, skyline: r.skyline, date: r.hit.date.getTime(), short: r.short };
    }
    stats.quick++;
    const s0 = FS.doyMinuteOf(new Date(f.date.getTime() - 40 * 60e3));
    const r = seekFrom(x, z, { body: ev.body, year: s0.year, doy: s0.doy, rising: ev.rising, limb: limbKey, notBefore: s0.minute });
    if (!r || !r.hit) { rayFirst.delete(ck); return rayAzimuth(x, z, evKey, year, limbKey); }
    return { az: r.hit.geoAz, sky: r.hit.sky, skyline: r.skyline, date: r.hit.date.getTime(), short: r.short };
  }
  return { computeAlignment, seekFrom, rayAzimuth, eventWhen, get stats() { return stats; }, resetRayCache() { rayFirst.clear(); } };
}
