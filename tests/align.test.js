// Checks for the alignment and rise/set searches (data/flyover/align_core.js). Run with: npm test
// (Node 18 or later, nothing to install). The ground here is made up: flat at y = 0 out to a chosen range,
// nothing beyond, so the numbers depend only on the maths, not on the lidar files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as FS from '../data/flyover/flyover_sky.js';
import { makeAligner, ALIGN_EVENTS, dateLabel, yearLabel, utLabel, HZ_NEAR } from '../data/flyover/align_core.js';

globalThis.window = globalThis.window || {};
new Function(readFileSync(new URL('../woodhenge/horizon.js', import.meta.url), 'utf8'))();
const HZ = window.WOODHENGE_HORIZON;

const flatTo = (range, cx = 0, cz = 0) => (x, z) => (Math.hypot(x - cx, z - cz) <= range ? 0 : null);
const local = (e, n) => ({ x: e - FS.CE, z: FS.CN - n });
const SH = local(FS.CE, FS.CN);
const WH = local(HZ.eye.e, HZ.eye.n);
const BU = local(417476, 143546);

test('date labels', () => {
  const d = new Date(0); d.setUTCFullYear(-2499, 5, 21); d.setUTCHours(3, 7, 0, 0);
  assert.equal(yearLabel(-2499), '2500 BC (year -2499)');
  assert.equal(yearLabel(2026), 'AD 2026');
  assert.equal(dateLabel(d), '21 Jun 2500 BC (year -2499)');
  assert.equal(utLabel(d), '03:07 UT');
});

test('midsummer sunrise at Stonehenge, 2026, wide flat ground', () => {
  const A = makeAligner({ FS, heightAt: flatTo(20000) });
  const r = A.computeAlignment(SH.x, SH.z, ALIGN_EVENTS['sun-ms-rise'], 2026, 'first_gleam');
  assert.ok(!r.error, r.error);
  // First gleam over a flat, slightly dipped horizon: north-east, a little before 04:00 UT.
  assert.ok(r.hit.geoAz > 48 && r.hit.geoAz < 52, 'azimuth ' + r.hit.geoAz);
  assert.equal(r.hit.date.getUTCMonth(), 5);
  const m = r.hit.date.getUTCHours() * 60 + r.hit.date.getUTCMinutes();
  assert.ok(m > 3 * 60 + 20 && m < 4 * 60 + 10, 'time ' + utLabel(r.hit.date));
  assert.equal(r.short, false);
});

test('rise comes before set, and later limbs come later', () => {
  const A = makeAligner({ FS, heightAt: flatTo(20000) });
  const ev = ALIGN_EVENTS['sun-ms-rise'];
  const g = A.computeAlignment(SH.x, SH.z, ev, 2026, 'first_gleam');
  const f = A.computeAlignment(SH.x, SH.z, ev, 2026, 'full_orb');
  assert.ok(f.hit.date > g.hit.date, 'full orb after first gleam');
  const s = A.computeAlignment(SH.x, SH.z, ALIGN_EVENTS['sun-ms-set'], 2026, 'full_orb');
  assert.ok(s.hit.geoAz > 300 && s.hit.geoAz < 314, 'sunset azimuth ' + s.hit.geoAz);
});

test('every event gives an answer at Stonehenge', () => {
  const A = makeAligner({ FS, heightAt: flatTo(20000) });
  for (const [k, ev] of Object.entries(ALIGN_EVENTS)) {
    const r = A.computeAlignment(SH.x, SH.z, ev, -2499, 'half_orb');
    assert.ok(!r.error, k + ': ' + r.error);
    assert.ok(r.hit.geoAz >= 0 && r.hit.geoAz < 360, k);
  }
});

test('the result survives being sent from the worker', () => {
  const A = makeAligner({ FS, heightAt: flatTo(20000) });
  const r = A.computeAlignment(SH.x, SH.z, ALIGN_EVENTS['sun-mw-set'], 2026, 'half_orb');
  const c = structuredClone(r);
  assert.ok(c.hit.date instanceof Date);
  assert.equal(c.hit.date.getTime(), r.hit.date.getTime());
  assert.equal(c.hit.geoAz, r.hit.geoAz);
  assert.equal(c.site.conv, r.site.conv);
});

test('Woodhenge skyline fallback: used at Woodhenge, never at Bulford', () => {
  assert.ok(Math.hypot(BU.x - WH.x, BU.z - WH.z) > HZ_NEAR, 'Bulford lies outside the fallback range');
  const ev = ALIGN_EVENTS['sun-ms-rise'];
  // Ground only 1.5 km round each site, as if far.bin had failed to load.
  const w = makeAligner({ FS, heightAt: flatTo(1500, WH.x, WH.z), hz: HZ }).computeAlignment(WH.x, WH.z, ev, 2026, 'first_gleam');
  assert.ok(!w.error, w.error);
  assert.equal(w.skyline, 'woodhenge');
  const b = makeAligner({ FS, heightAt: flatTo(1500, BU.x, BU.z), hz: HZ }).computeAlignment(BU.x, BU.z, ev, 2026, 'first_gleam');
  assert.ok(!b.error, b.error);
  assert.notEqual(b.skyline, 'woodhenge');
  assert.equal(b.short, true, 'Bulford is flagged as having a short skyline instead');
});
